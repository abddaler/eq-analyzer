import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnalyzerEngine } from '../src/dsp/engine';
import { RingBuffer } from '../src/audio/RingBuffer';
import type { AudioSource, AudioSourceInfo, CaptureStats } from '../src/audio/AudioSource';
import { PHONE_GENERIC } from '../src/data/mic-profiles';
import { pinkNoise, sine } from './helpers/signals';

const FS = 48000;

/** Feeds a prepared signal into the engine the way the worklet would. */
class FakeSource implements AudioSource {
  readonly backend = 'fake';
  readonly buffer = new RingBuffer(FS * 4, 1);
  readonly sampleRate = FS;
  running = true;
  private position = 0;
  private stats: CaptureStats = { peak: 0, clipped: 0 };

  constructor(private readonly signal: Float64Array) {}

  /** Push `count` more samples, looping over the source material. */
  advance(count: number): void {
    const chunk = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const v = this.signal[this.position % this.signal.length];
      chunk[i] = v;
      this.position++;
      const a = Math.abs(v);
      if (a > this.stats.peak) this.stats.peak = a;
    }
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
    const out = this.stats;
    this.stats = { peak: 0, clipped: 0 };
    return out;
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

afterEach(() => {
  frameCallbacks = [];
});

/** Run the engine loop `ticks` times, feeding `samplesPerTick` each time. */
function run(engine: AnalyzerEngine, source: FakeSource, ticks: number, samplesPerTick: number) {
  for (let i = 0; i < ticks; i++) {
    source.advance(samplesPerTick);
    const pending = frameCallbacks;
    frameCallbacks = [];
    for (const cb of pending) cb(performance.now());
  }
}

describe('AnalyzerEngine', () => {
  it('produces a flat 1/3-octave RTA from pink noise, end to end', () => {
    const source = new FakeSource(pinkNoise(1 << 18, FS, 0.1, 11));
    const engine = new AnalyzerEngine();
    engine.attach(source);
    engine.update({ averaging: 'infinite', micProfile: null, fraction: 3 });
    run(engine, source, 60, 4096);

    const s = engine.snapshot;
    expect(s.frames).toBeGreaterThan(20);
    const idx = s.bands
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.nominal >= 40 && b.nominal <= 16000)
      .map(({ i }) => i);
    const levels = idx.map((i) => s.bandDb[i]);
    const mean = levels.reduce((a, v) => a + v, 0) / levels.length;
    for (let j = 0; j < levels.length; j++) {
      expect(Math.abs(levels[j] - mean), `band ${s.bands[idx[j]].label}`).toBeLessThan(1);
    }
    engine.detach();
  });

  it('applies the microphone correction to the bands it reports', () => {
    const signal = pinkNoise(1 << 18, FS, 0.1, 12);
    const plain = new AnalyzerEngine();
    const plainSource = new FakeSource(signal);
    plain.attach(plainSource);
    plain.update({ averaging: 'infinite', micProfile: null });
    run(plain, plainSource, 40, 4096);

    const corrected = new AnalyzerEngine();
    const correctedSource = new FakeSource(signal);
    corrected.attach(correctedSource);
    corrected.update({ averaging: 'infinite', micProfile: PHONE_GENERIC });
    run(corrected, correctedSource, 40, 4096);

    const at = (e: AnalyzerEngine, nominal: number) => {
      const i = e.snapshot.bands.findIndex((b) => b.nominal === nominal);
      return e.snapshot.bandDb[i];
    };
    // The generic phone profile is 14 dB down at 40 Hz. The band spans
    // 35-45 Hz and the profile is steep there, so the band-summed correction
    // lands a little above the centre-frequency value rather than exactly on
    // it - correcting energy, not a single point.
    const lift = at(corrected, 40) - at(plain, 40);
    expect(lift).toBeGreaterThan(13.5);
    expect(lift).toBeLessThan(16);
    expect(at(corrected, 1000) - at(plain, 1000)).toBeCloseTo(0, 1);
    plain.detach();
    corrected.detach();
  });

  it('reads a full-scale 1 kHz sine as 0 dBFS broadband', () => {
    const source = new FakeSource(sine(FS, 1000, FS, 1));
    const engine = new AnalyzerEngine();
    engine.attach(source);
    engine.update({ averaging: 'infinite', micProfile: null });
    run(engine, source, 30, 4096);
    expect(engine.snapshot.levels.zDb).toBeCloseTo(0, 1);
    // A-weighting is 0 dB at 1 kHz by definition.
    expect(engine.snapshot.levels.aDb).toBeCloseTo(0, 1);
    engine.detach();
  });

  it('stops updating while frozen and resumes afterwards', () => {
    const source = new FakeSource(pinkNoise(1 << 16, FS, 0.1, 13));
    const engine = new AnalyzerEngine();
    engine.attach(source);
    run(engine, source, 20, 4096);
    const frames = engine.snapshot.frames;
    engine.setFrozen(true);
    run(engine, source, 20, 4096);
    expect(engine.snapshot.frames).toBe(frames);
    engine.setFrozen(false);
    run(engine, source, 20, 4096);
    expect(engine.snapshot.frames).toBeGreaterThan(frames);
    engine.detach();
  });

  it('captures a noise floor that can be compared against the signal', () => {
    const quiet = new FakeSource(pinkNoise(1 << 16, FS, 0.001, 14));
    const engine = new AnalyzerEngine();
    engine.attach(quiet);
    engine.update({ micProfile: null });
    run(engine, quiet, 10, 4096);
    engine.measureNoiseFloor(0.5);
    run(engine, quiet, 20, 4096);
    const floor = engine.snapshot.noiseFloorDb;
    expect(floor).not.toBeNull();
    const i1k = engine.snapshot.bands.findIndex((b) => b.nominal === 1000);
    expect(floor![i1k]).toBeLessThan(-60);
    engine.detach();
  });
});
