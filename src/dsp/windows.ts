export type WindowType = 'hann' | 'blackman-harris' | 'flat-top' | 'rectangular';

export interface AnalysisWindow {
  type: WindowType;
  /** Window coefficients, length = FFT size. */
  values: Float64Array;
  /** Sum of coefficients (coherent gain x N). */
  sum: number;
  /** Sum of squared coefficients. */
  sumSquares: number;
  /** Equivalent noise bandwidth in bins: N * sumSquares / sum^2. */
  enbwBins: number;
}

/** Cosine-sum windows, periodic (n/N, not n/(N-1)) as required for spectral analysis. */
function cosineSum(size: number, a: number[]): Float64Array {
  const w = new Float64Array(size);
  for (let n = 0; n < size; n++) {
    const x = (2 * Math.PI * n) / size;
    let v = 0;
    for (let k = 0; k < a.length; k++) {
      v += (k % 2 === 0 ? 1 : -1) * a[k] * Math.cos(k * x);
    }
    w[n] = v;
  }
  return w;
}

const COEFFS: Record<WindowType, number[] | null> = {
  hann: [0.5, 0.5],
  'blackman-harris': [0.35875, 0.48829, 0.14128, 0.01168],
  'flat-top': [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368],
  rectangular: null,
};

const cache = new Map<string, AnalysisWindow>();

export function makeWindow(type: WindowType, size: number): AnalysisWindow {
  const key = `${type}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const coeffs = COEFFS[type];
  const values = coeffs ? cosineSum(size, coeffs) : new Float64Array(size).fill(1);
  let sum = 0;
  let sumSquares = 0;
  for (let i = 0; i < size; i++) {
    sum += values[i];
    sumSquares += values[i] * values[i];
  }
  const win: AnalysisWindow = {
    type,
    values,
    sum,
    sumSquares,
    enbwBins: (size * sumSquares) / (sum * sum),
  };
  cache.set(key, win);
  return win;
}

export const WINDOW_TYPES: WindowType[] = ['hann', 'blackman-harris', 'flat-top', 'rectangular'];
