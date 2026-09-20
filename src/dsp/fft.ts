/**
 * Iterative radix-2 Cooley-Tukey FFT with precomputed twiddle factors.
 *
 * Self-contained on purpose: the transform is the one piece of the signal
 * chain we must be able to reason about exactly when a measurement looks
 * wrong, and it is small enough not to warrant a dependency.
 */
export class FFT {
  readonly size: number;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly reverse: Uint32Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;
    const half = size >> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size);
    }
    this.reverse = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | ((i >>> b) & 1);
      }
      this.reverse[i] = r;
    }
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
  }

  /** In-place forward complex transform (sign convention e^{-i2*pi*kn/N}). */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    const rev = this.reverse;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const step = n / len;
      for (let base = 0; base < n; base += len) {
        for (let j = 0, k = 0; j < halfLen; j++, k += step) {
          const wr = this.cosTable[k];
          const wi = -this.sinTable[k];
          const a = base + j;
          const b = a + halfLen;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }


  /** In-place inverse complex transform, normalised by 1/N. */
  inverse(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    // conj -> forward -> conj -> scale
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.transform(re, im);
    const s = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= s;
      im[i] *= -s;
    }
  }

  /**
   * Squared magnitude of the one-sided spectrum of a real input, without any
   * normalisation. Length is size/2 + 1. The caller applies the window and the
   * normalisation it needs (see spectrum.ts).
   */
  realMagnitudeSquared(input: ArrayLike<number>, out?: Float64Array): Float64Array {
    const n = this.size;
    if (input.length !== n) {
      throw new Error(`expected ${n} samples, got ${input.length}`);
    }
    const re = this.re;
    const im = this.im;
    for (let i = 0; i < n; i++) {
      re[i] = input[i];
      im[i] = 0;
    }
    this.transform(re, im);
    const bins = (n >> 1) + 1;
    const result = out ?? new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      result[k] = re[k] * re[k] + im[k] * im[k];
    }
    return result;
  }
}

const cache = new Map<number, FFT>();

/** FFT instances are expensive to build and cheap to share; keep one per size. */
export function getFFT(size: number): FFT {
  let f = cache.get(size);
  if (!f) {
    f = new FFT(size);
    cache.set(size, f);
  }
  return f;
}
