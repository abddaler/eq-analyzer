import { getFFT } from './fft';
import { makeWindow, type AnalysisWindow, type WindowType } from './windows';

/**
 * Level conventions used everywhere below this point:
 *
 *  - Power values are mean-square (RMS^2) in sample units, energy normalised,
 *    so summing bins across a band or across a tone's main lobe yields the true
 *    mean-square of that part of the signal.
 *  - 0 dBFS is a full-scale sine (peak amplitude 1.0), i.e. mean-square 0.5.
 *    A -20 dBFS sine therefore has peak amplitude 0.1.
 */
export const FULL_SCALE_MEAN_SQUARE = 0.5;
export const MIN_POWER = 1e-20;

export function powerToDb(power: number): number {
  return 10 * Math.log10(Math.max(power, MIN_POWER) / FULL_SCALE_MEAN_SQUARE);
}

export function dbToPower(db: number): number {
  return FULL_SCALE_MEAN_SQUARE * Math.pow(10, db / 10);
}

export interface SpectrumFrame {
  /** Energy-normalised mean-square per bin, length size/2 + 1. */
  power: Float64Array;
  sampleRate: number;
  fftSize: number;
  binWidth: number;
  /** Equivalent noise bandwidth of the window, in bins. */
  enbwBins: number;
}

export class SpectrumAnalyzer {
  readonly fftSize: number;
  readonly sampleRate: number;
  readonly binWidth: number;
  readonly bins: number;
  private readonly window: AnalysisWindow;
  private readonly windowed: Float64Array;
  private readonly magSq: Float64Array;
  private readonly power: Float64Array;
  /** 2 / (N * sum(w^2)) - the energy-correct one-sided normalisation. */
  private readonly norm: number;

  constructor(fftSize: number, sampleRate: number, windowType: WindowType = 'hann') {
    this.fftSize = fftSize;
    this.sampleRate = sampleRate;
    this.binWidth = sampleRate / fftSize;
    this.bins = (fftSize >> 1) + 1;
    this.window = makeWindow(windowType, fftSize);
    this.windowed = new Float64Array(fftSize);
    this.magSq = new Float64Array(this.bins);
    this.power = new Float64Array(this.bins);
    this.norm = 2 / (fftSize * this.window.sumSquares);
  }

  get enbwBins(): number {
    return this.window.enbwBins;
  }

  get windowType(): WindowType {
    return this.window.type;
  }

  binFrequency(bin: number): number {
    return bin * this.binWidth;
  }

  /**
   * Analyse one frame of samples. The returned array is reused between calls -
   * copy it if it has to outlive the next analyse().
   */
  analyse(samples: ArrayLike<number>): Float64Array {
    const w = this.window.values;
    for (let i = 0; i < this.fftSize; i++) {
      this.windowed[i] = samples[i] * w[i];
    }
    getFFT(this.fftSize).realMagnitudeSquared(this.windowed, this.magSq);
    const last = this.bins - 1;
    for (let k = 0; k < this.bins; k++) {
      // DC and Nyquist have no mirrored partner, so they lose the factor of 2.
      const scale = k === 0 || k === last ? this.norm / 2 : this.norm;
      this.power[k] = this.magSq[k] * scale;
    }
    return this.power;
  }

  frame(samples: ArrayLike<number>): SpectrumFrame {
    return {
      power: this.analyse(samples),
      sampleRate: this.sampleRate,
      fftSize: this.fftSize,
      binWidth: this.binWidth,
      enbwBins: this.window.enbwBins,
    };
  }
}

/**
 * Per-bin level for an FFT *display*. Energy normalisation spreads a tone over
 * the window's noise bandwidth, so a single bin under-reads a sine by
 * 10*log10(ENBW). Adding it back makes tone peaks read their true level, which
 * is what the FFT view is for; band sums must not use this.
 */
export function binDisplayDb(power: number, enbwBins: number): number {
  return powerToDb(power * enbwBins);
}

/** Total mean-square across a bin range, used for broadband level readouts. */
export function totalPower(power: Float64Array, from = 0, to = power.length): number {
  let sum = 0;
  for (let k = from; k < to; k++) sum += power[k];
  return sum;
}

export interface InterpolatedPeak {
  frequency: number;
  db: number;
  bin: number;
}

/**
 * Quadratic interpolation over the three bins around a local maximum.
 *
 * A tone almost never sits exactly on a bin centre, and a raw peak bin
 * under-reads it by up to 1.4 dB with a Hann window (scalloping loss). Fitting
 * a parabola through the log magnitudes recovers both the true frequency and
 * the true level to well under 0.1 dB, which is what the cursor, the resonance
 * detector and the sine calibration all need.
 */
export function interpolatePeak(
  power: ArrayLike<number>,
  bin: number,
  binWidth: number,
  enbwBins: number,
): InterpolatedPeak {
  if (bin <= 0 || bin >= power.length - 1) {
    return { frequency: bin * binWidth, db: binDisplayDb(power[bin], enbwBins), bin };
  }
  const y1 = binDisplayDb(power[bin - 1], enbwBins);
  const y2 = binDisplayDb(power[bin], enbwBins);
  const y3 = binDisplayDb(power[bin + 1], enbwBins);
  const denom = y1 - 2 * y2 + y3;
  const delta = denom === 0 ? 0 : (0.5 * (y1 - y3)) / denom;
  const clamped = Math.max(-0.5, Math.min(0.5, delta));
  return {
    frequency: (bin + clamped) * binWidth,
    db: y2 - 0.25 * (y1 - y3) * clamped,
    bin,
  };
}

/** Index of the largest bin within [from, to). */
export function peakBin(power: ArrayLike<number>, from = 1, to = power.length): number {
  let best = from;
  for (let k = from; k < to; k++) if (power[k] > power[best]) best = k;
  return best;
}
