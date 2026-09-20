/** Frequency weighting curves per IEC 61672. */

export type Weighting = 'Z' | 'A' | 'C';

export const WEIGHTINGS: Weighting[] = ['Z', 'A', 'C'];

const F1 = 20.598997;
const F2 = 107.65265;
const F3 = 737.86223;
const F4 = 12194.217;
/** Normalisation so that both curves read exactly 0 dB at 1 kHz. */
const A_OFFSET = 2.0;
const C_OFFSET = 0.0619;

export function aWeightingDb(f: number): number {
  if (f <= 0) return -Infinity;
  const f2 = f * f;
  const num = F4 * F4 * f2 * f2;
  const den =
    (f2 + F1 * F1) * Math.sqrt((f2 + F2 * F2) * (f2 + F3 * F3)) * (f2 + F4 * F4);
  return 20 * Math.log10(num / den) + A_OFFSET;
}

export function cWeightingDb(f: number): number {
  if (f <= 0) return -Infinity;
  const f2 = f * f;
  const num = F4 * F4 * f2;
  const den = (f2 + F1 * F1) * (f2 + F4 * F4);
  return 20 * Math.log10(num / den) + C_OFFSET;
}

export function weightingDb(weighting: Weighting, f: number): number {
  switch (weighting) {
    case 'A':
      return aWeightingDb(f);
    case 'C':
      return cWeightingDb(f);
    default:
      return 0;
  }
}

/** Linear power gains for a set of frequencies, ready to multiply a spectrum. */
export function weightingGains(weighting: Weighting, frequencies: ArrayLike<number>): Float64Array {
  const out = new Float64Array(frequencies.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = weighting === 'Z' ? 1 : Math.pow(10, weightingDb(weighting, frequencies[i]) / 10);
  }
  return out;
}

/** Weighted total of a power spectrum, as a mean-square value. */
export function weightedTotal(power: ArrayLike<number>, gains: ArrayLike<number>): number {
  let sum = 0;
  for (let k = 0; k < power.length; k++) sum += power[k] * gains[k];
  return sum;
}
