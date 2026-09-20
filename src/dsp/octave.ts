/** Fractional-octave band definitions and band energy summation. */

export type OctaveFraction = 1 | 3 | 6 | 12 | 24;

export const OCTAVE_FRACTIONS: OctaveFraction[] = [1, 3, 6, 12, 24];

export interface Band {
  /** Exact geometric centre, 1000 * 2^(k/fraction). */
  center: number;
  /** Lower band edge. */
  lo: number;
  /** Upper band edge. */
  hi: number;
  /** ISO preferred number for 1/1 and 1/3 octave, otherwise a rounded centre. */
  nominal: number;
  /** Short label for axes and suggestion text ("315", "1k", "12.5k"). */
  label: string;
  /** Index relative to the 1 kHz band. */
  index: number;
}

/** ISO 266 preferred numbers, wide enough to label every band we generate. */
const ISO_NOMINAL_FULL = [
  12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400,
  500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
  10000, 12500, 16000, 20000, 25000,
];
/** Index of the 1 kHz entry; band k maps to ISO_NOMINAL_FULL[k + this]. */
const ISO_1K_INDEX = ISO_NOMINAL_FULL.indexOf(1000);

/** The 31 standard 1/3-octave bands, 20 Hz - 20 kHz. */
export const ISO_THIRD_OCTAVE_NOMINAL = ISO_NOMINAL_FULL.slice(
  ISO_NOMINAL_FULL.indexOf(20),
  ISO_NOMINAL_FULL.indexOf(20000) + 1,
);

/** The bands of a 31-band graphic EQ - identical to the ISO 1/3-octave set. */
export const GEQ_31_BANDS = ISO_THIRD_OCTAVE_NOMINAL;

export function formatFrequency(hz: number): string {
  if (hz >= 10000) return `${Math.round(hz / 100) / 10}k`;
  if (hz >= 1000) return `${Math.round(hz / 100) / 10}k`.replace('.0k', 'k');
  if (hz >= 100) return String(Math.round(hz));
  return String(Math.round(hz * 10) / 10);
}

function nominalFor(fraction: OctaveFraction, index: number, center: number): number {
  // Only whole and third octaves land on ISO preferred numbers; finer
  // fractions fall back to the rounded exact centre.
  if (fraction === 3 || fraction === 1) {
    const i = index * (3 / fraction) + ISO_1K_INDEX;
    if (Number.isInteger(i) && i >= 0 && i < ISO_NOMINAL_FULL.length) return ISO_NOMINAL_FULL[i];
  }
  return center >= 1000 ? Math.round(center / 10) * 10 : Math.round(center * 10) / 10;
}

const bandCache = new Map<string, Band[]>();

/**
 * Bands anchored on 1 kHz. A band is included when it overlaps [fMin, fMax] at
 * all, not when its centre falls inside: the ISO 20 Hz band is centred on
 * 19.84 Hz and the 20 kHz band on 20159 Hz, and both belong in a 20 Hz - 20 kHz
 * set. 1/3-octave over that range gives exactly the 31 ISO bands.
 */
export function makeBands(fraction: OctaveFraction, fMin = 20, fMax = 20000): Band[] {
  const key = `${fraction}:${fMin}:${fMax}`;
  const hit = bandCache.get(key);
  if (hit) return hit;

  const half = Math.pow(2, 1 / (2 * fraction));
  // hi(k) > fMin and lo(k) < fMax, where hi/lo are the band edges.
  const kMin = Math.ceil(fraction * Math.log2(fMin / (1000 * half)) + 1e-9);
  const kMax = Math.floor(fraction * Math.log2((fMax * half) / 1000) - 1e-9);
  const bands: Band[] = [];
  for (let k = kMin; k <= kMax; k++) {
    const center = 1000 * Math.pow(2, k / fraction);
    const nominal = nominalFor(fraction, k, center);
    bands.push({
      center,
      lo: center / half,
      hi: center * half,
      nominal,
      label: formatFrequency(nominal),
      index: k,
    });
  }
  bandCache.set(key, bands);
  return bands;
}

export interface BandMapping {
  bands: Band[];
  /** Per band: bin indices and the fraction of each bin that falls inside. */
  binStart: Int32Array;
  binEnd: Int32Array;
  weights: Float64Array[];
  /** Band width expressed in FFT bins - below ~1 the band is unresolved. */
  binsPerBand: Float64Array;
}

/**
 * Precompute how FFT bins map onto bands. Edge bins are weighted by the share
 * of their width that falls inside the band, which makes the sum an integral
 * of the power spectral density and stays correct when a band is narrower than
 * one bin (it then reads as density x bandwidth rather than dropping to zero).
 */
export function mapBinsToBands(bands: Band[], binWidth: number, binCount: number): BandMapping {
  const binStart = new Int32Array(bands.length);
  const binEnd = new Int32Array(bands.length);
  const weights: Float64Array[] = [];
  const binsPerBand = new Float64Array(bands.length);

  for (let b = 0; b < bands.length; b++) {
    const { lo, hi } = bands[b];
    let start = Math.max(0, Math.floor(lo / binWidth - 0.5));
    let end = Math.min(binCount - 1, Math.ceil(hi / binWidth + 0.5));
    if (start > end) start = end;
    const w = new Float64Array(Math.max(0, end - start + 1));
    for (let k = start; k <= end; k++) {
      const binLo = Math.max(0, (k - 0.5) * binWidth);
      const binHi = (k + 0.5) * binWidth;
      const overlap = Math.min(hi, binHi) - Math.max(lo, binLo);
      w[k - start] = overlap > 0 ? overlap / (binHi - binLo) : 0;
    }
    binStart[b] = start;
    binEnd[b] = end;
    weights.push(w);
    binsPerBand[b] = (hi - lo) / binWidth;
  }
  return { bands, binStart, binEnd, weights, binsPerBand };
}

/** Sum bin power into bands. Power in, power out - never average decibels. */
export function bandEnergy(
  power: ArrayLike<number>,
  mapping: BandMapping,
  out?: Float64Array,
): Float64Array {
  const result = out ?? new Float64Array(mapping.bands.length);
  for (let b = 0; b < mapping.bands.length; b++) {
    const start = mapping.binStart[b];
    const end = mapping.binEnd[b];
    const w = mapping.weights[b];
    let sum = 0;
    for (let k = start; k <= end; k++) {
      sum += power[k] * w[k - start];
    }
    result[b] = sum;
  }
  return result;
}
