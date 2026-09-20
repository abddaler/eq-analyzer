import { FFT, getFFT, realForward } from './fft';
import { makeWindow, type WindowType } from './windows';

/**
 * Two-channel (transfer function) analysis.
 *
 * A single-channel RTA cannot separate the system from the music: whatever the
 * band plays is what it measures. Feeding the console's output in as a
 * reference and comparing it against the microphone gives the response of the
 * system and the room alone, plus phase and coherence - and coherence is the
 * part that tells you whether to believe any of it.
 */

export interface DelayEstimate {
  delaySamples: number;
  delayMs: number;
  /** Peak sharpness, 0..1. Below ~0.1 the estimate is not trustworthy. */
  confidence: number;
}

/**
 * Delay between two signals by generalised cross-correlation with phase
 * transform (GCC-PHAT).
 *
 * Plain cross-correlation locks onto whatever is loudest - usually the bass -
 * and smears the peak over milliseconds. Whitening each bin before the inverse
 * transform makes the peak sharp and roughly level-independent, which is what
 * makes this work on music rather than only on noise.
 */
export function gccPhatDelay(
  reference: ArrayLike<number>,
  measurement: ArrayLike<number>,
  sampleRate: number,
  fftSize = 65536,
): DelayEstimate {
  const n = Math.min(fftSize, 1 << Math.floor(Math.log2(Math.min(reference.length, measurement.length))));
  const fft = getFFT(n);
  const xr = new Float64Array(n);
  const xi = new Float64Array(n);
  const yr = new Float64Array(n);
  const yi = new Float64Array(n);
  realForward(fft, reference, xr, xi);
  realForward(fft, measurement, yr, yi);

  // conj(X) * Y, normalised to unit magnitude per bin.
  for (let k = 0; k < n; k++) {
    const re = xr[k] * yr[k] + xi[k] * yi[k];
    const im = xr[k] * yi[k] - xi[k] * yr[k];
    const mag = Math.hypot(re, im);
    if (mag > 1e-20) {
      xr[k] = re / mag;
      xi[k] = im / mag;
    } else {
      xr[k] = 0;
      xi[k] = 0;
    }
  }
  fft.inverse(xr, xi);

  let peak = 0;
  let peakValue = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(xr[i]);
    if (v > peakValue) {
      peakValue = v;
      peak = i;
    }
  }
  // A lag beyond half the window is really a negative lag.
  const lag = peak > n / 2 ? peak - n : peak;

  // Confidence is the peak against the next-best peak elsewhere, not against
  // the mean: for two unrelated signals the correlation is noise whose peak
  // still stands well above its own average, which would look convincing.
  // A real match leaves everything else far behind.
  const guard = 8;
  let runnerUp = 0;
  for (let i = 0; i < n; i++) {
    const distance = Math.min(Math.abs(i - peak), n - Math.abs(i - peak));
    if (distance <= guard) continue;
    const v = Math.abs(xr[i]);
    if (v > runnerUp) runnerUp = v;
  }
  const confidence = peakValue > 0 ? Math.max(0, 1 - runnerUp / peakValue) : 0;

  return { delaySamples: lag, delayMs: (lag / sampleRate) * 1000, confidence };
}

export interface TransferResult {
  /** |H| in dB, one value per bin. */
  magnitudeDb: Float64Array;
  /** Phase of H in degrees, wrapped to -180..180. */
  phaseDeg: Float64Array;
  /** Magnitude-squared coherence, 0..1. */
  coherence: Float64Array;
  frames: number;
  binWidth: number;
  bins: number;
}

/**
 * Averaged transfer function estimator.
 *
 * Coherence only means something once several frames have been averaged: from
 * a single frame it is 1 everywhere by construction, which would be a
 * confident-looking lie.
 */
export class TransferFunction {
  readonly fftSize: number;
  readonly sampleRate: number;
  readonly bins: number;
  readonly binWidth: number;
  private readonly fft: FFT;
  private readonly window: Float64Array;
  private readonly xr: Float64Array;
  private readonly xi: Float64Array;
  private readonly yr: Float64Array;
  private readonly yi: Float64Array;
  private readonly sxx: Float64Array;
  private readonly syy: Float64Array;
  private readonly sxyRe: Float64Array;
  private readonly sxyIm: Float64Array;
  private readonly scratch: Float64Array;
  /** Reused so a result can be produced every frame without allocating. */
  private readonly output: TransferResult;
  private frameCount = 0;

  constructor(fftSize: number, sampleRate: number, windowType: WindowType = 'hann') {
    this.fftSize = fftSize;
    this.sampleRate = sampleRate;
    this.bins = (fftSize >> 1) + 1;
    this.binWidth = sampleRate / fftSize;
    this.fft = getFFT(fftSize);
    this.window = makeWindow(windowType, fftSize).values;
    this.xr = new Float64Array(fftSize);
    this.xi = new Float64Array(fftSize);
    this.yr = new Float64Array(fftSize);
    this.yi = new Float64Array(fftSize);
    this.sxx = new Float64Array(this.bins);
    this.syy = new Float64Array(this.bins);
    this.sxyRe = new Float64Array(this.bins);
    this.sxyIm = new Float64Array(this.bins);
    this.scratch = new Float64Array(fftSize);
    this.output = {
      magnitudeDb: new Float64Array(this.bins),
      phaseDeg: new Float64Array(this.bins),
      coherence: new Float64Array(this.bins),
      frames: 0,
      binWidth: this.binWidth,
      bins: this.bins,
    };
  }

  get frames(): number {
    return this.frameCount;
  }

  reset(): void {
    this.sxx.fill(0);
    this.syy.fill(0);
    this.sxyRe.fill(0);
    this.sxyIm.fill(0);
    this.frameCount = 0;
  }

  /** Accumulate one time-aligned frame pair. */
  push(reference: ArrayLike<number>, measurement: ArrayLike<number>): void {
    for (let i = 0; i < this.fftSize; i++) this.scratch[i] = reference[i] * this.window[i];
    realForward(this.fft, this.scratch, this.xr, this.xi);
    for (let i = 0; i < this.fftSize; i++) this.scratch[i] = measurement[i] * this.window[i];
    realForward(this.fft, this.scratch, this.yr, this.yi);

    for (let k = 0; k < this.bins; k++) {
      const xre = this.xr[k];
      const xim = this.xi[k];
      const yre = this.yr[k];
      const yim = this.yi[k];
      this.sxx[k] += xre * xre + xim * xim;
      this.syy[k] += yre * yre + yim * yim;
      // conj(X) * Y
      this.sxyRe[k] += xre * yre + xim * yim;
      this.sxyIm[k] += xre * yim - xim * yre;
    }
    this.frameCount++;
  }

  /**
   * Current estimate. The arrays are reused between calls - copy them if they
   * have to outlive the next call. Reusing them is what makes it cheap enough
   * to produce a result on every frame instead of on a timer.
   */
  result(): TransferResult {
    const { magnitudeDb, phaseDeg, coherence } = this.output;
    for (let k = 0; k < this.bins; k++) {
      const sxx = this.sxx[k];
      const syy = this.syy[k];
      const re = this.sxyRe[k];
      const im = this.sxyIm[k];
      const magSq = re * re + im * im;
      magnitudeDb[k] = sxx > 1e-30 ? 10 * Math.log10(Math.max(magSq / (sxx * sxx), 1e-30)) : -200;
      phaseDeg[k] = (Math.atan2(im, re) * 180) / Math.PI;
      coherence[k] = sxx > 1e-30 && syy > 1e-30 ? Math.min(1, magSq / (sxx * syy)) : 0;
    }
    this.output.frames = this.frameCount;
    return this.output;
  }
}
