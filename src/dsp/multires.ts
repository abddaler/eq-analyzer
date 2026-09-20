import { correctionGains, type MicProfile } from './calibration';
import { bandEnergy, mapBinsToBands, type Band, type BandMapping } from './octave';
import { SpectrumAnalyzer } from './spectrum';
import type { WindowType } from './windows';

/**
 * Multi-resolution analysis for the bottom of the spectrum.
 *
 * One FFT length cannot serve the whole band: 8192 points at 48 kHz gives
 * 5.9 Hz bins, so the 40 Hz third-octave band (9 Hz wide) is barely one bin -
 * the low end is guesswork. A longer FFT fixes that but makes the top end
 * sluggish, which is exactly wrong for catching a squeal.
 *
 * So the low bands are recomputed from a longer transform (the idea behind
 * Smaart's multi-time-window display), while everything above the crossover
 * keeps the short, fast one. Both are energy normalised the same way, so the
 * two halves join without a step.
 */

/** A band needs about this many bins before its level means anything. */
const MIN_BINS_PER_BAND = 4;

export class LowBandRefiner {
  readonly fftSize: number;
  readonly crossoverHz: number;
  /** Bands strictly below the crossover, which this refiner owns. */
  readonly bandCount: number;
  private readonly analyser: SpectrumAnalyzer;
  private readonly mapping: BandMapping;
  private readonly gains: Float64Array;
  private readonly corrected: Float64Array;
  private readonly result: Float64Array;
  readonly frame: Float32Array;

  constructor(
    sampleRate: number,
    fftSize: number,
    windowType: WindowType,
    bands: Band[],
    shortFftSize: number,
    micProfile: MicProfile | null,
  ) {
    this.fftSize = fftSize;
    this.analyser = new SpectrumAnalyzer(fftSize, sampleRate, windowType);
    const shortBinWidth = sampleRate / shortFftSize;

    // Below this frequency the short FFT cannot resolve a fractional-octave
    // band; that is exactly where the long one is needed.
    const bandWidthRatio = bands.length > 1 ? bands[0].hi / bands[0].lo - 1 : 0.23;
    this.crossoverHz = (MIN_BINS_PER_BAND * shortBinWidth) / Math.max(bandWidthRatio, 1e-3);

    let count = 0;
    while (count < bands.length && bands[count].center < this.crossoverHz) count++;
    this.bandCount = count;

    const frequencies = new Float64Array(this.analyser.bins);
    for (let k = 0; k < frequencies.length; k++) frequencies[k] = this.analyser.binFrequency(k);
    this.gains = correctionGains(micProfile, frequencies);
    this.mapping = mapBinsToBands(bands.slice(0, count), this.analyser.binWidth, this.analyser.bins);
    this.corrected = new Float64Array(this.analyser.bins);
    this.result = new Float64Array(Math.max(count, 1));
    this.frame = new Float32Array(fftSize);
  }

  /** Analyse the frame currently in `this.frame` and cache the low bands. */
  update(): void {
    if (this.bandCount === 0) return;
    const power = this.analyser.analyse(this.frame);
    for (let k = 0; k < power.length; k++) this.corrected[k] = power[k] * this.gains[k];
    bandEnergy(this.corrected, this.mapping, this.result);
  }

  /** Overwrite the low bands of a band-energy array with the refined values. */
  applyTo(bands: Float64Array): void {
    for (let b = 0; b < this.bandCount; b++) bands[b] = this.result[b];
  }

  get lowBands(): Float64Array {
    return this.result;
  }
}

/** Longest transform worth running on a phone, and the multiplier we aim for. */
export const MAX_LONG_FFT = 32768;

export function longFftSizeFor(shortFftSize: number): number {
  return Math.min(MAX_LONG_FFT, shortFftSize * 4);
}
