import { describe, it, expect } from 'vitest';
import { LowBandRefiner, longFftSizeFor } from '../src/dsp/multires';
import { makeBands } from '../src/dsp/octave';
import { powerToDb } from '../src/dsp/spectrum';
import { pinkNoise } from './helpers/signals';

const FS = 48000;
const bands = makeBands(3, 20, 20000);

describe('LowBandRefiner', () => {
  it('takes over exactly where the short FFT runs out of resolution', () => {
    const refiner = new LowBandRefiner(FS, 32768, 'hann', bands, 8192, null);
    // 8192 at 48 kHz gives 5.86 Hz bins; a third octave is 23% wide, so four
    // bins per band are only available above roughly 100 Hz.
    expect(refiner.crossoverHz).toBeGreaterThan(80);
    expect(refiner.crossoverHz).toBeLessThan(130);
    expect(bands[refiner.bandCount - 1].center).toBeLessThan(refiner.crossoverHz);
    expect(bands[refiner.bandCount].center).toBeGreaterThanOrEqual(refiner.crossoverHz);
  });

  it('measures the low bands of pink noise at the same level as the rest', () => {
    const refiner = new LowBandRefiner(FS, 32768, 'hann', bands, 8192, null);
    const signal = pinkNoise(1 << 19, FS, 0.1, 31);

    const acc = new Float64Array(refiner.bandCount);
    let frames = 0;
    for (let off = 0; off + 32768 <= signal.length; off += 16384) {
      for (let i = 0; i < 32768; i++) refiner.frame[i] = signal[off + i];
      refiner.update();
      for (let b = 0; b < refiner.bandCount; b++) acc[b] += refiner.lowBands[b];
      frames++;
    }
    for (let b = 0; b < acc.length; b++) acc[b] /= frames;

    // Pink noise is flat per third octave, so the refined low bands must sit
    // on the same line as the bands the short FFT handles.
    const levels = Array.from(acc, powerToDb).filter((_, b) => bands[b].nominal >= 40);
    const mean = levels.reduce((s, v) => s + v, 0) / levels.length;
    for (const level of levels) expect(Math.abs(level - mean)).toBeLessThan(1);
  });

  it('caps the long transform at a size a phone can still run', () => {
    expect(longFftSizeFor(8192)).toBe(32768);
    expect(longFftSizeFor(16384)).toBe(32768);
    expect(longFftSizeFor(32768)).toBe(32768);
    expect(longFftSizeFor(4096)).toBe(16384);
  });
});
