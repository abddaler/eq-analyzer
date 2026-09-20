import { describe, it, expect } from 'vitest';
import { SpectrumAnalyzer, powerToDb, interpolatePeak, peakBin } from '../src/dsp/spectrum';
import { makeBands, mapBinsToBands, bandEnergy, ISO_THIRD_OCTAVE_NOMINAL } from '../src/dsp/octave';
import { sine, pinkNoise, whiteNoise } from './helpers/signals';

const FS = 48000;
const N = 8192;

/** Average many overlapping frames so noise tests are not dominated by variance. */
function averagePower(signal: Float64Array, analyser: SpectrumAnalyzer, hop = N / 4): Float64Array {
  const acc = new Float64Array(analyser.bins);
  let frames = 0;
  for (let off = 0; off + N <= signal.length; off += hop) {
    const p = analyser.analyse(signal.subarray(off, off + N));
    for (let k = 0; k < acc.length; k++) acc[k] += p[k];
    frames++;
  }
  for (let k = 0; k < acc.length; k++) acc[k] /= frames;
  return acc;
}

describe('spectrum levels', () => {
  it('puts a 1 kHz -20 dBFS sine in the right bin at the right level', () => {
    const a = new SpectrumAnalyzer(N, FS, 'hann');
    // -20 dBFS means peak amplitude 0.1 under the full-scale-sine convention.
    const p = a.analyse(sine(N, 1000, FS, 0.1));

    const peak = peakBin(p);
    expect(Math.abs(a.binFrequency(peak) - 1000)).toBeLessThanOrEqual(a.binWidth / 2);

    // A tone spreads over the window main lobe; its energy is the sum there.
    let energy = 0;
    for (let k = peak - 4; k <= peak + 4; k++) energy += p[k];
    expect(powerToDb(energy)).toBeCloseTo(-20, 1);

    // Interpolating across the peak recovers frequency and level exactly
    // enough to meet the +/-0.5 dB acceptance criterion.
    const fit = interpolatePeak(p, peak, a.binWidth, a.enbwBins);
    expect(fit.frequency).toBeCloseTo(1000, 0);
    expect(Math.abs(fit.db - -20)).toBeLessThan(0.5);
  });

  it('reads a full-scale sine as 0 dBFS', () => {
    const a = new SpectrumAnalyzer(N, FS, 'hann');
    const p = a.analyse(sine(N, 997, FS, 1));
    let energy = 0;
    for (let k = 0; k < p.length; k++) energy += p[k];
    expect(powerToDb(energy)).toBeCloseTo(0, 1);
  });

  it('conserves broadband energy (Parseval)', () => {
    const a = new SpectrumAnalyzer(N, FS, 'hann');
    const noise = whiteNoise(N * 8, 0.1, 7);
    const p = averagePower(noise, a);
    let total = 0;
    for (let k = 0; k < p.length; k++) total += p[k];
    expect(Math.sqrt(total)).toBeCloseTo(0.1, 2);
  });
});

describe('fractional-octave bands', () => {
  it('generates the 31 standard ISO 1/3-octave bands', () => {
    const bands = makeBands(3, 20, 20000);
    expect(bands.length).toBe(31);
    expect(bands.map((b) => b.nominal)).toEqual(ISO_THIRD_OCTAVE_NOMINAL);
    const k1000 = bands.find((b) => b.nominal === 1000)!;
    expect(k1000.center).toBeCloseTo(1000, 6);
    expect(k1000.hi / k1000.lo).toBeCloseTo(Math.pow(2, 1 / 3), 6);
  });

  it('shows pink noise as flat within 1 dB on 1/3 octave (40 Hz - 16 kHz)', () => {
    const a = new SpectrumAnalyzer(N, FS, 'hann');
    const signal = pinkNoise(1 << 19, FS, 0.1, 3);
    const p = averagePower(signal, a);
    const bands = makeBands(3, 20, 20000);
    const mapping = mapBinsToBands(bands, a.binWidth, a.bins);
    const energy = bandEnergy(p, mapping);

    const idx = bands
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.nominal >= 40 && b.nominal <= 16000)
      .map(({ i }) => i);
    const levels = idx.map((i) => powerToDb(energy[i]));
    const mean = levels.reduce((s, v) => s + v, 0) / levels.length;
    for (let j = 0; j < levels.length; j++) {
      expect(Math.abs(levels[j] - mean), `band ${bands[idx[j]].label} Hz`).toBeLessThan(1);
    }
  });

  it('shows white noise rising 3 dB per octave on 1/3 octave', () => {
    const a = new SpectrumAnalyzer(N, FS, 'hann');
    const signal = whiteNoise(1 << 19, 0.1, 5);
    const p = averagePower(signal, a);
    const bands = makeBands(3, 20, 20000);
    const mapping = mapBinsToBands(bands, a.binWidth, a.bins);
    const energy = bandEnergy(p, mapping);

    const get = (nominal: number) => powerToDb(energy[bands.findIndex((b) => b.nominal === nominal)]);
    for (const [lo, hi] of [[125, 250], [500, 1000], [2000, 4000], [4000, 8000]]) {
      expect(get(hi) - get(lo), `${lo} -> ${hi} Hz`).toBeCloseTo(3, 0);
    }
  });

  it('keeps band energy equal to the tone energy it contains', () => {
    const a = new SpectrumAnalyzer(N, FS, 'hann');
    const p = a.analyse(sine(N, 1000, FS, 0.1));
    const bands = makeBands(3, 20, 20000);
    const mapping = mapBinsToBands(bands, a.binWidth, a.bins);
    const energy = bandEnergy(p, mapping);
    const i1k = bands.findIndex((b) => b.nominal === 1000);
    expect(powerToDb(energy[i1k])).toBeCloseTo(-20, 1);
  });
});
