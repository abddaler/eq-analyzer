import type { AudioSource } from '../audio/AudioSource';
import {
  ExponentialAverager,
  LinearAverager,
  PeakHold,
  SlidingAverager,
  TIME_CONSTANTS,
  type Averager,
} from './averaging';
import { correctionGains, levelToSpl, type LevelCalibration, type MicProfile } from './calibration';
import {
  bandEnergy,
  makeBands,
  mapBinsToBands,
  type Band,
  type BandMapping,
  type OctaveFraction,
} from './octave';
import { LowBandRefiner, longFftSizeFor } from './multires';
import { ResonanceDetector, type Resonance } from './peaks';
import { MIN_POWER, powerToDb, SpectrumAnalyzer } from './spectrum';
import { gccPhatDelay, TransferFunction, type DelayEstimate, type TransferResult } from './transfer';
import { weightingDb, weightingGains, type Weighting } from './weighting';
import type { WindowType } from './windows';

export type AveragingMode = 'fast' | 'slow' | 'infinite';
export const FFT_SIZES = [4096, 8192, 16384, 32768];
export const LONG_WINDOW_SECONDS = [10, 20, 30, 60];

export interface EngineSettings {
  fftSize: number;
  windowType: WindowType;
  /** Fraction of the frame that overlaps the previous one: 0.5 or 0.75. */
  overlap: number;
  fraction: OctaveFraction;
  averaging: AveragingMode;
  longWindowSeconds: number;
  weighting: Weighting;
  peakHoldEnabled: boolean;
  peakDecayDbPerSecond: number;
  micProfile: MicProfile | null;
  levelCalibration: LevelCalibration;
  /** Recompute the low bands from a longer FFT (see multires.ts). */
  multiResolution: boolean;
  /** Two-channel mode: channel 1 is the console feed, channel 2 the mic. */
  dualChannel: boolean;
  /** Which captured channel carries the reference. */
  referenceChannel: number;
  /** Alignment between the two channels, in samples. */
  transferDelaySamples: number;
  /** Narrow-peak detector: how far above the local median counts as a peak. */
  resonanceThresholdDb: number;
  /** How long a peak has to hold before it is named. */
  resonanceMinDurationMs: number;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  fftSize: 8192,
  windowType: 'hann',
  overlap: 0.5,
  fraction: 3,
  averaging: 'slow',
  longWindowSeconds: 20,
  weighting: 'Z',
  peakHoldEnabled: true,
  peakDecayDbPerSecond: 12,
  micProfile: null,
  levelCalibration: { splAt0dBFS: null },
  multiResolution: true,
  dualChannel: false,
  referenceChannel: 0,
  transferDelaySamples: 0,
  resonanceThresholdDb: 10,
  resonanceMinDurationMs: 300,
};

export interface Levels {
  /** Broadband level of the calibrated spectrum, dBFS (Z-weighted). */
  zDb: number;
  aDb: number;
  cDb: number;
  /** Equivalent continuous levels since the last reset. */
  aLeq: number;
  cLeq: number;
  /** Sample peak from the capture thread, dBFS. */
  peakDb: number;
  clipping: boolean;
  /** dB SPL when a level calibration exists, otherwise null. */
  spl: number | null;
  splA: number | null;
}

export interface EngineSnapshot {
  revision: number;
  running: boolean;
  frozen: boolean;
  sampleRate: number;
  fftSize: number;
  binWidth: number;
  enbwBins: number;
  binCount: number;
  /** Long-FFT size in use for the low bands, 0 when multi-resolution is off. */
  lowBandFftSize: number;
  lowBandCrossoverHz: number;
  /** Averaged, mic-corrected bin power (for the FFT view). */
  binPower: Float64Array;
  bands: Band[];
  /** Averaged band power, mic-corrected, unweighted. */
  bandPower: Float64Array;
  bandDb: Float64Array;
  /** Long sliding window over band power - the basis for suggestions. */
  longBandDb: Float64Array;
  longFill: number;
  longSeconds: number;
  peakHoldDb: Float64Array;
  /** Measured background noise per band, null until measured. */
  noiseFloorDb: Float64Array | null;
  noiseMeasureLeft: number;
  /** Display weighting per band, dB - applied when drawing, not when analysing. */
  bandWeightingDb: Float64Array;
  levels: Levels;
  /** Narrow peaks currently ringing, strongest first. */
  resonances: Resonance[];
  /** Two-channel result, null unless dual-channel mode is running. */
  transfer: TransferResult | null;
  transferDelayMs: number;
  transferFrames: number;
  /** True when the source really delivers two channels. */
  dualChannelActive: boolean;
  elapsedSeconds: number;
  frames: number;
}

type Listener = (snapshot: EngineSnapshot) => void;

const NOISE_MEASURE_SECONDS = 3;

/**
 * Owns the measurement pipeline: pulls frames at a fixed hop, corrects for the
 * microphone, sums into bands, averages, and publishes one snapshot.
 *
 * Deliberately not a React component or store - the loop has to run at audio
 * cadence regardless of what the UI is doing, and only the readouts are
 * throttled down to a rate React can handle.
 */
export class AnalyzerEngine {
  private source: AudioSource | null = null;
  private settings: EngineSettings = { ...DEFAULT_SETTINGS };
  private analyser: SpectrumAnalyzer | null = null;
  private mapping: BandMapping | null = null;
  private frequencies: Float64Array = new Float64Array(0);
  private micGains: Float64Array = new Float64Array(0);
  private aGains: Float64Array = new Float64Array(0);
  private cGains: Float64Array = new Float64Array(0);
  private frame: Float32Array = new Float32Array(0);
  private levelFrom = 0;
  private levelTo = 0;
  private corrected: Float64Array = new Float64Array(0);
  private instantBands: Float64Array = new Float64Array(0);

  private binAverager: Averager | null = null;
  private bandAverager: Averager | null = null;
  private longAverager: SlidingAverager | null = null;
  private peakHold: PeakHold | null = null;
  private aLeqAverager = new LinearAverager(1);
  private cLeqAverager = new LinearAverager(1);
  private zSlow = new ExponentialAverager(1, TIME_CONSTANTS.slow);
  private aSlow = new ExponentialAverager(1, TIME_CONSTANTS.slow);
  private cSlow = new ExponentialAverager(1, TIME_CONSTANTS.slow);

  private nextFrame = 0;
  private raf = 0;
  private listeners = new Set<Listener>();
  private frozenFlag = false;
  private noiseAverager: LinearAverager | null = null;
  private noiseFramesLeft = 0;
  private noiseFloor: Float64Array | null = null;
  private transfer: TransferFunction | null = null;
  private transferRef: Float32Array = new Float32Array(0);
  private transferMeas: Float32Array = new Float32Array(0);
  private nextTransferFrame = 0;
  private refiner: LowBandRefiner | null = null;
  private nextLongFrame = 0;
  private detector = new ResonanceDetector();
  private lastPeakDb = -120;
  private clipping = false;
  private clipUntil = 0;

  snapshot: EngineSnapshot = this.emptySnapshot();

  private emptySnapshot(): EngineSnapshot {
    const bands = makeBands(DEFAULT_SETTINGS.fraction);
    return {
      revision: 0,
      running: false,
      frozen: false,
      sampleRate: 0,
      fftSize: DEFAULT_SETTINGS.fftSize,
      binWidth: 0,
      enbwBins: 1.5,
      binCount: 0,
      lowBandFftSize: 0,
      lowBandCrossoverHz: 0,
      binPower: new Float64Array(0),
      bands,
      bandPower: new Float64Array(bands.length),
      bandDb: new Float64Array(bands.length).fill(-140),
      longBandDb: new Float64Array(bands.length).fill(-140),
      longFill: 0,
      longSeconds: DEFAULT_SETTINGS.longWindowSeconds,
      peakHoldDb: new Float64Array(bands.length).fill(-140),
      noiseFloorDb: null,
      noiseMeasureLeft: 0,
      bandWeightingDb: new Float64Array(bands.length),
      levels: {
        zDb: -140,
        aDb: -140,
        cDb: -140,
        aLeq: -140,
        cLeq: -140,
        peakDb: -140,
        clipping: false,
        spl: null,
        splA: null,
      },
      resonances: [],
      transfer: null,
      transferDelayMs: 0,
      transferFrames: 0,
      dualChannelActive: false,
      elapsedSeconds: 0,
      frames: 0,
    };
  }

  get currentSettings(): EngineSettings {
    return this.settings;
  }

  get frozen(): boolean {
    return this.frozenFlag;
  }

  get hopSamples(): number {
    return Math.max(1, Math.round(this.settings.fftSize * (1 - this.settings.overlap)));
  }

  get frameSeconds(): number {
    const rate = this.analyser?.sampleRate ?? 48000;
    return this.hopSamples / rate;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  attach(source: AudioSource): void {
    this.source = source;
    this.rebuild();
    this.startLoop();
  }

  detach(): void {
    this.stopLoop();
    this.source = null;
    this.analyser = null;
    this.snapshot = { ...this.emptySnapshot(), revision: this.snapshot.revision + 1 };
    this.publish();
  }

  update(patch: Partial<EngineSettings>): void {
    const structural =
      (patch.fftSize !== undefined && patch.fftSize !== this.settings.fftSize) ||
      (patch.windowType !== undefined && patch.windowType !== this.settings.windowType) ||
      (patch.overlap !== undefined && patch.overlap !== this.settings.overlap) ||
      (patch.fraction !== undefined && patch.fraction !== this.settings.fraction) ||
      (patch.micProfile !== undefined && patch.micProfile?.id !== this.settings.micProfile?.id) ||
      (patch.longWindowSeconds !== undefined &&
        patch.longWindowSeconds !== this.settings.longWindowSeconds) ||
      (patch.averaging !== undefined && patch.averaging !== this.settings.averaging) ||
      (patch.multiResolution !== undefined && patch.multiResolution !== this.settings.multiResolution) ||
      (patch.dualChannel !== undefined && patch.dualChannel !== this.settings.dualChannel);
    this.settings = { ...this.settings, ...patch };
    if (this.peakHold) this.peakHold.decayDbPerSecond = this.settings.peakDecayDbPerSecond;
    this.detector.configure({
      thresholdDb: this.settings.resonanceThresholdDb,
      minDurationMs: this.settings.resonanceMinDurationMs,
    });
    if (structural) this.rebuild();
    else this.publishSoon();
  }

  setFrozen(frozen: boolean): void {
    this.frozenFlag = frozen;
    // Skip whatever accumulated while the picture was held, otherwise the
    // analyser spends the next seconds catching up on stale audio.
    if (!frozen) this.nextFrame = 0;
    this.publishSoon();
  }

  resetAveraging(): void {
    this.binAverager?.reset();
    this.bandAverager?.reset();
    this.longAverager?.reset();
    this.peakHold?.reset();
    this.aLeqAverager.reset();
    this.cLeqAverager.reset();
    this.snapshot.frames = 0;
    this.snapshot.elapsedSeconds = 0;
    this.publishSoon();
  }

  resetPeakHold(): void {
    this.peakHold?.reset();
  }

  /**
   * Estimate the alignment between the reference and the microphone from the
   * last second and a bit of audio, and adopt it.
   */
  findDelay(): DelayEstimate | null {
    const buffer = this.source?.buffer;
    const rate = this.analyser?.sampleRate;
    if (!buffer || !rate || buffer.channelCount < 2) return null;
    const length = Math.min(1 << 16, 1 << Math.floor(Math.log2(Math.max(1, buffer.written))));
    if (length < 4096) return null;
    const start = buffer.written - length;
    const reference = new Float32Array(length);
    const measurement = new Float32Array(length);
    const refChannel = this.settings.referenceChannel;
    if (!buffer.read(start, reference, refChannel)) return null;
    if (!buffer.read(start, measurement, refChannel === 0 ? 1 : 0)) return null;
    const estimate = gccPhatDelay(reference, measurement, rate, length);
    this.settings = { ...this.settings, transferDelaySamples: estimate.delaySamples };
    this.transfer?.reset();
    this.nextTransferFrame = 0;
    return estimate;
  }

  resetTransfer(): void {
    this.transfer?.reset();
    this.nextTransferFrame = 0;
    this.snapshot.transfer = null;
    this.snapshot.transferFrames = 0;
    this.publishSoon();
  }

  /** The ring-out list: peaks that have already stopped. */
  get resonanceHistory(): Resonance[] {
    return this.detector.history;
  }

  resetResonances(): void {
    this.detector.reset();
    this.snapshot.resonances = [];
    this.publishSoon();
  }

  /** Start a background-noise measurement; bands below it are not trusted. */
  measureNoiseFloor(seconds = NOISE_MEASURE_SECONDS): void {
    if (!this.mapping) return;
    this.noiseAverager = new LinearAverager(this.mapping.bands.length);
    this.noiseFramesLeft = Math.max(1, Math.round(seconds / this.frameSeconds));
  }

  clearNoiseFloor(): void {
    this.noiseFloor = null;
    this.noiseAverager = null;
    this.noiseFramesLeft = 0;
    this.publishSoon();
  }

  private rebuild(): void {
    const rate = this.source?.sampleRate ?? 0;
    if (!this.source || !rate) return;
    const { fftSize, windowType, fraction } = this.settings;

    this.analyser = new SpectrumAnalyzer(fftSize, rate, windowType);
    const bins = this.analyser.bins;
    this.frequencies = new Float64Array(bins);
    for (let k = 0; k < bins; k++) this.frequencies[k] = this.analyser.binFrequency(k);

    const bands = makeBands(fraction, 20, Math.min(20000, rate / 2));
    this.mapping = mapBinsToBands(bands, this.analyser.binWidth, bins);
    this.micGains = correctionGains(this.settings.micProfile, this.frequencies);
    // Broadband level is integrated only over what the microphone can
    // actually hear: outside that range there is correction applied to noise,
    // and letting it into the SPL reading would inflate it by several dB.
    const micFrom = this.settings.micProfile?.trustedFromHz ?? 20;
    const micTo = this.settings.micProfile?.trustedToHz ?? rate / 2;
    this.levelFrom = Math.max(1, Math.floor(micFrom / this.analyser.binWidth));
    this.levelTo = Math.min(bins, Math.ceil(micTo / this.analyser.binWidth) + 1);
    this.aGains = weightingGains('A', this.frequencies);
    this.cGains = weightingGains('C', this.frequencies);
    this.frame = new Float32Array(fftSize);
    this.corrected = new Float64Array(bins);
    this.instantBands = new Float64Array(bands.length);

    const tau = this.settings.averaging === 'fast' ? TIME_CONSTANTS.fast : TIME_CONSTANTS.slow;
    const makeAverager = (length: number): Averager =>
      this.settings.averaging === 'infinite'
        ? new LinearAverager(length)
        : new ExponentialAverager(length, tau);
    this.binAverager = makeAverager(bins);
    this.bandAverager = makeAverager(bands.length);
    this.longAverager = new SlidingAverager(
      bands.length,
      Math.ceil(this.settings.longWindowSeconds / this.frameSeconds),
      this.frameSeconds,
    );
    this.peakHold = new PeakHold(bands.length, this.settings.peakDecayDbPerSecond);
    this.refiner = this.settings.multiResolution
      ? new LowBandRefiner(
          rate,
          longFftSizeFor(fftSize),
          windowType,
          bands,
          fftSize,
          this.settings.micProfile,
        )
      : null;
    this.nextLongFrame = 0;

    const channels = this.source?.buffer?.channelCount ?? 1;
    const dualActive = this.settings.dualChannel && channels >= 2;
    this.transfer = dualActive ? new TransferFunction(fftSize, rate, windowType) : null;
    this.transferRef = dualActive ? new Float32Array(fftSize) : new Float32Array(0);
    this.transferMeas = dualActive ? new Float32Array(fftSize) : new Float32Array(0);
    this.nextTransferFrame = 0;
    this.noiseFloor = null;
    this.detector.reset();
    this.nextFrame = 0;

    const weightingPerBand = new Float64Array(bands.length);
    for (let b = 0; b < bands.length; b++) {
      weightingPerBand[b] = weightingDb(this.settings.weighting, bands[b].center);
    }

    this.snapshot = {
      ...this.snapshot,
      sampleRate: rate,
      fftSize,
      binWidth: this.analyser.binWidth,
      enbwBins: this.analyser.enbwBins,
      binCount: bins,
      dualChannelActive: this.transfer !== null,
      transfer: null,
      transferFrames: 0,
      lowBandFftSize: this.refiner && this.refiner.bandCount > 0 ? this.refiner.fftSize : 0,
      lowBandCrossoverHz: this.refiner && this.refiner.bandCount > 0 ? this.refiner.crossoverHz : 0,
      binPower: new Float64Array(bins),
      bands,
      bandPower: new Float64Array(bands.length),
      bandDb: new Float64Array(bands.length).fill(-140),
      longBandDb: new Float64Array(bands.length).fill(-140),
      longSeconds: this.settings.longWindowSeconds,
      peakHoldDb: new Float64Array(bands.length).fill(-140),
      noiseFloorDb: null,
      bandWeightingDb: weightingPerBand,
      frames: 0,
      elapsedSeconds: 0,
    };
    this.publishSoon();
  }

  private startLoop(): void {
    if (this.raf) return;
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.process();
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private process(): void {
    const source = this.source;
    const analyser = this.analyser;
    const mapping = this.mapping;
    if (!source?.buffer || !analyser || !mapping) return;
    if (analyser.sampleRate !== source.sampleRate) {
      this.rebuild();
      return;
    }

    const stats = source.takeStats();
    if (stats.peak > 0) {
      this.lastPeakDb = 20 * Math.log10(Math.max(stats.peak, 1e-7));
    }
    if (stats.clipped > 0) {
      this.clipping = true;
      // Hold the warning briefly so a single clipped block is still visible.
      this.clipUntil = performance.now() + 1200;
    } else if (performance.now() > this.clipUntil) {
      this.clipping = false;
    }

    if (this.frozenFlag) {
      this.publish();
      return;
    }

    const buffer = source.buffer;
    const hop = this.hopSamples;
    const size = this.settings.fftSize;
    if (this.nextFrame === 0) this.nextFrame = Math.max(0, buffer.written - size);
    if (buffer.written - this.nextFrame > hop * 16) {
      // The tab was backgrounded or the device stalled; resync rather than
      // burn a second of CPU catching up on audio nobody heard.
      this.nextFrame = Math.max(0, buffer.written - size);
    }

    // The long transform for the low bands runs on its own, slower schedule;
    // its result is held between updates so the averagers see a continuous
    // stream.
    const refiner = this.refiner;
    if (refiner && refiner.bandCount > 0) {
      const longSize = refiner.fftSize;
      if (this.nextLongFrame === 0) this.nextLongFrame = Math.max(0, buffer.written - longSize);
      if (buffer.written - this.nextLongFrame > longSize * 4) {
        this.nextLongFrame = Math.max(0, buffer.written - longSize);
      }
      while (this.nextLongFrame + longSize <= buffer.written) {
        if (!buffer.read(this.nextLongFrame, refiner.frame)) break;
        refiner.update();
        this.nextLongFrame += longSize >> 1;
      }
    }

    this.updateTransfer(buffer, size, hop);

    let processed = 0;
    const dt = this.frameSeconds;
    while (this.nextFrame + size <= buffer.written && processed < 8) {
      if (!buffer.read(this.nextFrame, this.frame)) break;
      const power = analyser.analyse(this.frame);
      for (let k = 0; k < power.length; k++) this.corrected[k] = power[k] * this.micGains[k];

      bandEnergy(this.corrected, mapping, this.instantBands);
      refiner?.applyTo(this.instantBands);
      // Resonances are looked for in the instantaneous spectrum: averaging
      // would smear exactly the narrow, steady peaks we are hunting.
      this.detector.push(this.corrected, analyser.binWidth, analyser.enbwBins, performance.now());
      this.binAverager?.push(this.corrected, dt);
      this.bandAverager?.push(this.instantBands, dt);
      this.longAverager?.push(this.instantBands, dt);
      if (this.settings.peakHoldEnabled) this.peakHold?.push(this.instantBands, dt);

      let zTotal = 0;
      let aTotal = 0;
      let cTotal = 0;
      for (let k = this.levelFrom; k < this.levelTo; k++) {
        const p = this.corrected[k];
        zTotal += p;
        aTotal += p * this.aGains[k];
        cTotal += p * this.cGains[k];
      }
      this.zSlow.push([zTotal], dt);
      this.aSlow.push([aTotal], dt);
      this.cSlow.push([cTotal], dt);
      this.aLeqAverager.push([aTotal], dt);
      this.cLeqAverager.push([cTotal], dt);

      if (this.noiseAverager) {
        this.noiseAverager.push(this.instantBands, dt);
        if (--this.noiseFramesLeft <= 0) {
          this.noiseFloor = Float64Array.from(this.noiseAverager.value);
          this.noiseAverager = null;
        }
      }

      this.snapshot.frames++;
      this.snapshot.elapsedSeconds += dt;
      this.nextFrame += hop;
      processed++;
    }

    if (processed > 0) this.updateSnapshot();
    this.publish();
  }

  /**
   * Feed time-aligned frame pairs to the transfer estimator.
   *
   * The microphone hears the console's signal `delay` samples late, so the
   * reference frame at `start` is compared against the measurement frame at
   * `start + delay`. Without that alignment the phase would wrap many times
   * per octave and coherence would collapse.
   */
  private updateTransfer(
    buffer: NonNullable<AudioSource['buffer']>,
    size: number,
    hop: number,
  ): void {
    const transfer = this.transfer;
    if (!transfer) return;
    const delay = Math.round(this.settings.transferDelaySamples);
    const refChannel = this.settings.referenceChannel;
    const measChannel = refChannel === 0 ? 1 : 0;
    const earliest = Math.max(buffer.oldest, buffer.oldest - Math.min(0, delay));

    if (this.nextTransferFrame < earliest) {
      this.nextTransferFrame = Math.max(earliest, buffer.written - size - Math.max(delay, 0));
    }
    let processed = 0;
    while (
      this.nextTransferFrame + size <= buffer.written &&
      this.nextTransferFrame + delay + size <= buffer.written &&
      processed < 4
    ) {
      const start = this.nextTransferFrame;
      if (
        buffer.read(start, this.transferRef, refChannel) &&
        buffer.read(start + delay, this.transferMeas, measChannel)
      ) {
        transfer.push(this.transferRef, this.transferMeas);
      }
      this.nextTransferFrame += hop;
      processed++;
    }
  }

  private updateSnapshot(): void {
    const s = this.snapshot;
    const bandPower = this.bandAverager?.value;
    const longPower = this.longAverager?.value;
    const peak = this.peakHold?.value;
    if (bandPower) {
      s.bandPower.set(bandPower);
      for (let b = 0; b < bandPower.length; b++) s.bandDb[b] = powerToDb(bandPower[b]);
    }
    if (longPower) {
      for (let b = 0; b < longPower.length; b++) s.longBandDb[b] = powerToDb(longPower[b]);
    }
    if (peak) {
      for (let b = 0; b < peak.length; b++) s.peakHoldDb[b] = powerToDb(Math.max(peak[b], MIN_POWER));
    }
    if (this.binAverager) s.binPower.set(this.binAverager.value);
    s.longFill = this.longAverager?.fill ?? 0;
    s.longSeconds = this.settings.longWindowSeconds;

    if (this.noiseFloor) {
      if (!s.noiseFloorDb || s.noiseFloorDb.length !== this.noiseFloor.length) {
        s.noiseFloorDb = new Float64Array(this.noiseFloor.length);
      }
      for (let b = 0; b < this.noiseFloor.length; b++) {
        s.noiseFloorDb[b] = powerToDb(this.noiseFloor[b]);
      }
    } else {
      s.noiseFloorDb = null;
    }
    s.noiseMeasureLeft = this.noiseAverager ? this.noiseFramesLeft * this.frameSeconds : 0;

    const cal = this.settings.levelCalibration;
    const zDb = powerToDb(this.zSlow.value[0]);
    const aDb = powerToDb(this.aSlow.value[0]);
    s.levels = {
      zDb,
      aDb,
      cDb: powerToDb(this.cSlow.value[0]),
      aLeq: powerToDb(this.aLeqAverager.value[0]),
      cLeq: powerToDb(this.cLeqAverager.value[0]),
      peakDb: this.lastPeakDb,
      clipping: this.clipping,
      spl: levelToSpl(zDb, cal),
      splA: levelToSpl(aDb, cal),
    };
    s.resonances = this.detector.active();

    if (this.transfer) {
      const rate = this.analyser?.sampleRate ?? 48000;
      s.transferFrames = this.transfer.frames;
      s.transferDelayMs = (this.settings.transferDelaySamples / rate) * 1000;
      // The estimator reuses its arrays, so there is nothing to save by
      // refreshing this on a timer - and a timer would make a reset take a
      // quarter of a second to become visible.
      s.transfer = this.transfer.frames > 0 ? this.transfer.result() : null;
    } else {
      s.transfer = null;
      s.transferFrames = 0;
    }
    s.running = true;
    s.frozen = this.frozenFlag;
    s.revision++;
  }

  private publishScheduled = false;

  /** Coalesce settings-driven republishes into the next frame. */
  private publishSoon(): void {
    if (this.publishScheduled) return;
    this.publishScheduled = true;
    queueMicrotask(() => {
      this.publishScheduled = false;
      this.snapshot.revision++;
      this.snapshot.frozen = this.frozenFlag;
      this.publish();
    });
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }

  /** Per-band level with the display weighting applied. */
  static weightedBandDb(snapshot: EngineSnapshot, source: Float64Array): Float64Array {
    const out = new Float64Array(source.length);
    for (let b = 0; b < source.length; b++) out[b] = source[b] + snapshot.bandWeightingDb[b];
    return out;
  }
}
