import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyzerEngine } from '../src/dsp/engine';
import { RingBuffer } from '../src/audio/RingBuffer';
import type { AudioSource, AudioSourceInfo, CaptureStats } from '../src/audio/AudioSource';
import { pinkNoise } from './helpers/signals';

const FS = 48000;
const DELAY = 120;

/** Stereo source: channel 0 is the console feed, channel 1 the microphone. */
class DualFakeSource implements AudioSource {
  readonly backend = 'fake-dual';
  readonly buffer = new RingBuffer(FS * 4, 2);
  readonly sampleRate = FS;
  running = true;
  private position = 0;

  constructor(
    private readonly signal: Float64Array,
    private readonly delaySamples: number,
    private readonly gain: number,
  ) {}

  advance(count: number): void {
    const reference = new Float32Array(count);
    const measurement = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const n = this.position + i;
      reference[i] = this.signal[n % this.signal.length];
      const m = n - this.delaySamples;
      measurement[i] = m >= 0 ? this.signal[m % this.signal.length] * this.gain : 0;
    }
    this.position += count;
    this.buffer.write([reference, measurement]);
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

function run(source: DualFakeSource, ticks: number, samplesPerTick: number) {
  for (let i = 0; i < ticks; i++) {
    source.advance(samplesPerTick);
    const pending = frameCallbacks;
    frameCallbacks = [];
    for (const cb of pending) cb(performance.now());
  }
}

describe('two-channel mode', () => {
  it('measures the delay and the gain between the two channels', () => {
    const source = new DualFakeSource(pinkNoise(1 << 18, FS, 0.2, 61), DELAY, 0.5);
    const engine = new AnalyzerEngine();
    engine.attach(source);
    engine.update({ dualChannel: true, micProfile: null, multiResolution: false });
    run(source, 30, 4096);

    expect(engine.snapshot.dualChannelActive).toBe(true);

    const estimate = engine.findDelay();
    expect(estimate).not.toBeNull();
    expect(estimate!.delaySamples).toBe(DELAY);

    run(source, 40, 4096);
    const result = engine.snapshot.transfer;
    expect(result).not.toBeNull();
    expect(result!.frames).toBeGreaterThan(8);

    const at = (hz: number) => Math.round(hz / result!.binWidth);
    for (const hz of [200, 1000, 8000]) {
      // Half the amplitude, aligned in time: -6 dB and fully coherent.
      expect(result!.magnitudeDb[at(hz)], `${hz} Hz`).toBeCloseTo(-6.02, 1);
      expect(result!.coherence[at(hz)]).toBeGreaterThan(0.98);
      expect(Math.abs(result!.phaseDeg[at(hz)])).toBeLessThan(5);
    }
    engine.detach();
  });

  it('stays off when the source only has one channel', () => {
    const source = new DualFakeSource(pinkNoise(1 << 16, FS, 0.2, 62), 0, 1);
    const mono = new RingBuffer(FS, 1);
    Object.defineProperty(source, 'buffer', { value: mono, writable: false });
    const engine = new AnalyzerEngine();
    engine.attach(source);
    engine.update({ dualChannel: true });
    expect(engine.snapshot.dualChannelActive).toBe(false);
    expect(engine.findDelay()).toBeNull();
    engine.detach();
  });
});
