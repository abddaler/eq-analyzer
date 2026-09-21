import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyzerEngine, WARMUP_SECONDS } from '../src/dsp/engine';
import { RingBuffer } from '../src/audio/RingBuffer';
import type { AudioSource, AudioSourceInfo, CaptureStats } from '../src/audio/AudioSource';
import { pinkNoise, sine } from './helpers/signals';

const FS = 48000;
const HOP = 4096;

/**
 * A one-off `prefix` (what opening a microphone sounds like) followed by an
 * endlessly looping `room`. The prefix must not be part of the loop, or the
 * startup artefact would come back every few seconds and the test would be
 * measuring the harness.
 */
class FakeSource implements AudioSource {
  readonly backend = 'fake';
  readonly buffer = new RingBuffer(FS * 4, 1);
  readonly sampleRate = FS;
  running = true;
  private position = 0;
  private readonly room: Float64Array;
  private readonly prefix: Float64Array;

  constructor(room: Float64Array, prefix: Float64Array = new Float64Array(0)) {
    this.room = room;
    this.prefix = prefix;
  }

  advance(count: number): void {
    const chunk = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const n = this.position + i;
      chunk[i] = n < this.prefix.length ? this.prefix[n] : this.room[(n - this.prefix.length) % this.room.length];
    }
    this.position += count;
    this.buffer.write([chunk]);
  }

  async start(): Promise<AudioSourceInfo> {
    throw new Error('not used');
  }
  async stop(): Promise<void> {}
  getInfo(): AudioSourceInfo | null {
    return null;
  }
  async listDevices() {
    return [];
  }
  takeStats(): CaptureStats {
    return { peak: 0, clipped: 0 };
  }
}

let frameCallbacks: FrameRequestCallback[] = [];

beforeEach(() => {
  frameCallbacks = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frameCallbacks.push(cb);
    return frameCallbacks.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

function run(source: FakeSource, seconds: number) {
  const ticks = Math.round((seconds * FS) / HOP);
  for (let i = 0; i < ticks; i++) {
    source.advance(HOP);
    const pending = frameCallbacks;
    frameCallbacks = [];
    for (const cb of pending) cb(performance.now());
  }
}

function start(room: Float64Array, prefix?: Float64Array) {
  const source = new FakeSource(room, prefix);
  const engine = new AnalyzerEngine();
  engine.attach(source);
  // Smaller transform, no multi-resolution: this is about when the engine
  // starts measuring, not about resolution, and it keeps the test quick.
  engine.update({
    micProfile: null,
    averaging: 'slow',
    longWindowSeconds: 10,
    fftSize: 4096,
    multiResolution: false,
  });
  return { engine, source };
}

const room = pinkNoise(1 << 18, FS, 0.05, 71);
const silence = (seconds: number) => new Float64Array(Math.round(seconds * FS));

/** The input climbing to its real level, as an opening audio session does. */
function rampPrefix(seconds: number): Float64Array {
  const n = Math.round(seconds * FS);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = room[i % room.length] * (i / n);
  return out;
}

const at1k = (engine: AnalyzerEngine) => {
  const s = engine.snapshot;
  return s.longBandDb[s.bands.findIndex((b) => b.nominal === 1000)];
};

// Each case pushes tens of seconds of audio through the whole pipeline.
describe('capture warm-up', { timeout: 30000 }, () => {
  it('measures nothing while the input is still digital silence', () => {
    const { engine, source } = start(room, silence(2));
    run(source, 1.5);
    expect(engine.snapshot.warmingUp).toBe(true);
    expect(engine.snapshot.frames).toBe(0);
    expect(engine.snapshot.elapsedSeconds).toBe(0);
    engine.detach();
  });

  it('starts measuring once the input is live and settled', () => {
    const { engine, source } = start(room, silence(2));
    run(source, 2 + WARMUP_SECONDS + 1);
    expect(engine.snapshot.warmingUp).toBe(false);
    expect(engine.snapshot.frames).toBeGreaterThan(0);
    engine.detach();
  });

  /**
   * The defect this guards against: a dead first second averaged into a long
   * window makes the level climb for the length of that window in a room
   * where nothing changed.
   */
  it('gives the same reading whether or not the capture started dead', () => {
    const clean = start(room);
    run(clean.source, 13);
    const dead = start(room, silence(1.5));
    run(dead.source, 13 + 1.5);

    // Tolerance is for where the averaging window happens to land in the
    // noise, not for the startup artefact - that has to be gone entirely.
    expect(Math.abs(at1k(dead.engine) - at1k(clean.engine))).toBeLessThan(0.2);
    expect(
      Math.abs(dead.engine.snapshot.levels.zDb - clean.engine.snapshot.levels.zDb),
    ).toBeLessThan(0.2);
    clean.engine.detach();
    dead.engine.detach();
  });

  it('throws away an input ramp instead of averaging it in', () => {
    const clean = start(room);
    run(clean.source, 13);
    const ramped = start(room, rampPrefix(WARMUP_SECONDS));
    run(ramped.source, 13 + WARMUP_SECONDS);

    expect(Math.abs(at1k(ramped.engine) - at1k(clean.engine))).toBeLessThan(0.2);
    clean.engine.detach();
    ramped.engine.detach();
  });

  it('does not drift on a constant input once it is running', () => {
    // A sine is exactly constant, so any movement here is the analyser's.
    const { engine, source } = start(sine(FS, 1000, FS, 0.2));
    run(source, 6);
    const early = { long: at1k(engine), z: engine.snapshot.levels.zDb };
    run(source, 25);
    const late = { long: at1k(engine), z: engine.snapshot.levels.zDb };

    expect(Math.abs(late.long - early.long)).toBeLessThan(0.1);
    expect(Math.abs(late.z - early.z)).toBeLessThan(0.1);
    engine.detach();
  });
});
