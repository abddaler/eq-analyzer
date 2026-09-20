import { describe, it, expect } from 'vitest';
import { PinkNoise, fillPinkNoise, fillWhiteNoise, fillSine, fillSweep } from '../src/generator/signals';
import { SpectrumAnalyzer, powerToDb } from '../src/dsp/spectrum';
import { bandEnergy, makeBands, mapBinsToBands } from '../src/dsp/octave';

const FS = 48000;
const N = 8192;

function bandLevels(signal: Float32Array): { nominal: number; db: number }[] {
  const analyser = new SpectrumAnalyzer(N, FS, 'hann');
  const acc = new Float64Array(analyser.bins);
  let frames = 0;
  for (let off = 0; off + N <= signal.length; off += N / 2) {
    const p = analyser.analyse(signal.subarray(off, off + N));
    for (let k = 0; k < acc.length; k++) acc[k] += p[k];
    frames++;
  }
  for (let k = 0; k < acc.length; k++) acc[k] /= frames;
  const bands = makeBands(3, 20, 20000);
  const energy = bandEnergy(acc, mapBinsToBands(bands, analyser.binWidth, analyser.bins));
  return bands.map((b, i) => ({ nominal: b.nominal, db: powerToDb(energy[i]) }));
}

describe('pink noise generator', () => {
  it('is flat within 1 dB per third octave from 40 Hz to 16 kHz', () => {
    const out = new Float32Array(1 << 19);
    fillPinkNoise(out, 0.3, new PinkNoise());
    const levels = bandLevels(out).filter((l) => l.nominal >= 40 && l.nominal <= 16000);
    const mean = levels.reduce((s, l) => s + l.db, 0) / levels.length;
    for (const l of levels) {
      expect(Math.abs(l.db - mean), `${l.nominal} Hz`).toBeLessThan(1);
    }
  });

  it('stays inside the available headroom', () => {
    const out = new Float32Array(1 << 16);
    fillPinkNoise(out, 0.5, new PinkNoise());
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(1);
  });
});

describe('white noise generator', () => {
  it('rises 3 dB per octave on a third-octave display', () => {
    const out = new Float32Array(1 << 19);
    fillWhiteNoise(out, 0.2);
    const levels = bandLevels(out);
    const at = (hz: number) => levels.find((l) => l.nominal === hz)!.db;
    for (const [lo, hi] of [[250, 500], [1000, 2000], [4000, 8000]]) {
      expect(at(hi) - at(lo), `${lo} -> ${hi}`).toBeCloseTo(3, 0);
    }
  });
});

describe('sine generator', () => {
  it('keeps phase continuous across blocks', () => {
    const a = new Float32Array(1024);
    const b = new Float32Array(1024);
    const phase = fillSine(a, 0.5, 1000, FS, 0);
    fillSine(b, 0.5, 1000, FS, phase);
    const joined = new Float32Array(2048);
    joined.set(a, 0);
    joined.set(b, 1024);
    // A discontinuity would show up as a step far larger than one sample's
    // worth of a 1 kHz sine at this rate.
    const step = Math.abs(joined[1024] - joined[1023]);
    expect(step).toBeLessThan(0.1);
  });

  it('produces the requested frequency and amplitude', () => {
    const out = new Float32Array(N);
    fillSine(out, 0.25, 1000, FS, 0);
    const levels = bandLevels(out);
    const at1k = levels.find((l) => l.nominal === 1000)!.db;
    expect(at1k).toBeCloseTo(20 * Math.log10(0.25), 0);
  });
});

describe('sweep generator', () => {
  it('walks from the low frequency to the high one and wraps', () => {
    const state = { position: 0, phase: 0 };
    const out = new Float32Array(1024);
    fillSweep(out, 0.5, 20, 20000, 0.1, FS, state);
    expect(state.position).toBeGreaterThan(0);
    expect(state.position).toBeLessThan(1);
    for (let i = 0; i < 10; i++) fillSweep(out, 0.5, 20, 20000, 0.1, FS, state);
    expect(state.position).toBeGreaterThanOrEqual(0);
    expect(state.position).toBeLessThan(1);
  });
});
