import { FFT } from '../../src/dsp/fft';

/** Deterministic PRNG so failures are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function sine(length: number, freq: number, sampleRate: number, peak = 1, phase = 0): Float64Array {
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = peak * Math.sin((2 * Math.PI * freq * i) / sampleRate + phase);
  }
  return out;
}

export function whiteNoise(length: number, rms = 0.1, seed = 1): Float64Array {
  const rand = mulberry32(seed);
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) out[i] = gaussian(rand) * rms;
  return out;
}

/**
 * Pink noise synthesised in the frequency domain: exact 1/f power, so it can be
 * used as ground truth when checking the band summation itself.
 * `length` must be a power of two; the result is periodic.
 */
export function pinkNoise(length: number, sampleRate: number, rms = 0.1, seed = 2): Float64Array {
  const rand = mulberry32(seed);
  const fft = new FFT(length);
  const re = new Float64Array(length);
  const im = new Float64Array(length);
  const binWidth = sampleRate / length;
  for (let k = 1; k <= length / 2; k++) {
    const f = k * binWidth;
    const amp = 1 / Math.sqrt(f);
    const phase = 2 * Math.PI * rand();
    const a = amp * Math.cos(phase);
    const b = amp * Math.sin(phase);
    re[k] = a;
    im[k] = b;
    if (k < length / 2) {
      re[length - k] = a;
      im[length - k] = -b;
    } else {
      im[k] = 0;
    }
  }
  fft.inverse(re, im);
  let sum = 0;
  for (let i = 0; i < length; i++) sum += re[i] * re[i];
  const scale = rms / Math.sqrt(sum / length);
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) out[i] = re[i] * scale;
  return out;
}

export function addSine(base: Float64Array, freq: number, sampleRate: number, peak: number): Float64Array {
  const out = Float64Array.from(base);
  for (let i = 0; i < out.length; i++) {
    out[i] += peak * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}
