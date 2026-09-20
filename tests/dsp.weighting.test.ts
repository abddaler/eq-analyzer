import { describe, it, expect } from 'vitest';
import { aWeightingDb, cWeightingDb, weightingGains, weightedTotal } from '../src/dsp/weighting';

/**
 * Reference values from IEC 61672-1 table 2. The table is labelled with
 * nominal frequencies but specified at the exact base-ten band centres
 * (10^(n/10)), which is a ~0.1 dB difference at the edges of the range - so
 * the check has to be made at the exact centres too.
 */
const exactCentre = (nominal: number) => Math.pow(10, Math.round(10 * Math.log10(nominal)) / 10);

const A_TABLE: [number, number][] = [
  [31.5, -39.4],
  [63, -26.2],
  [125, -16.1],
  [250, -8.6],
  [500, -3.2],
  [1000, 0],
  [2000, 1.2],
  [4000, 1.0],
  [8000, -1.1],
  [16000, -6.6],
];

const C_TABLE: [number, number][] = [
  [31.5, -3.0],
  [63, -0.8],
  [125, -0.2],
  [1000, 0],
  [4000, -0.8],
  [8000, -3.0],
  [16000, -8.5],
];

describe('frequency weighting', () => {
  it('matches the IEC 61672 A-weighting table', () => {
    for (const [f, expected] of A_TABLE) {
      expect(aWeightingDb(exactCentre(f)), `${f} Hz`).toBeCloseTo(expected, 1);
    }
  });

  it('matches the IEC 61672 C-weighting table', () => {
    for (const [f, expected] of C_TABLE) {
      expect(cWeightingDb(exactCentre(f)), `${f} Hz`).toBeCloseTo(expected, 1);
    }
  });

  it('is exactly 0 dB at 1 kHz for both curves', () => {
    expect(aWeightingDb(1000)).toBeCloseTo(0, 2);
    expect(cWeightingDb(1000)).toBeCloseTo(0, 2);
  });

  it('applies gains in the power domain', () => {
    const gains = weightingGains('A', [1000, exactCentre(31.5)]);
    expect(gains[0]).toBeCloseTo(1, 3);
    expect(10 * Math.log10(gains[1])).toBeCloseTo(-39.4, 1);
    expect(weightedTotal([1, 1], gains)).toBeCloseTo(gains[0] + gains[1], 12);
  });

  it('leaves the signal alone with Z weighting', () => {
    expect(Array.from(weightingGains('Z', [20, 1000, 20000]))).toEqual([1, 1, 1]);
  });
});
