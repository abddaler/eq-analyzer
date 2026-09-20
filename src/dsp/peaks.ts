import { binDisplayDb, interpolatePeak } from './spectrum';

/**
 * Narrow-peak (resonance / feedback) detector.
 *
 * A room resonance is not just "loud": it is *narrow*, it *stays* at the same
 * frequency, and it stands well above its own neighbourhood. All three have to
 * be true, otherwise every bass note in the programme material would be
 * reported as feedback. Loudness is measured against a local median rather
 * than a mean so that the peak being looked for cannot inflate its own
 * reference.
 */

export interface Resonance {
  id: number;
  /** Interpolated peak frequency, Hz. */
  frequency: number;
  /** How far the peak stands above its local median, dB. */
  prominenceDb: number;
  levelDb: number;
  firstSeen: number;
  lastSeen: number;
  durationMs: number;
  /** Frequency wander since it was first seen, in cents. */
  driftCents: number;
  /** Held long enough to be worth naming. */
  confirmed: boolean;
  frames: number;
}

export interface PeakDetectorOptions {
  /** How far above the local median a bin has to stand. */
  thresholdDb: number;
  /** Half-width of the median window, in octaves. */
  medianWindowOctaves: number;
  /** A peak has to hold this long before it is reported. */
  minDurationMs: number;
  /** Peaks further apart than this are different peaks. */
  matchCents: number;
  /** A peak may vanish for this long and still be the same peak. */
  maxGapMs: number;
  /** A resonance that wanders more than this is programme material. */
  maxDriftCents: number;
  fMin: number;
  fMax: number;
  /** Cap on how many bins the median is computed from, for speed. */
  medianSamples: number;
}

export const DEFAULT_PEAK_OPTIONS: PeakDetectorOptions = {
  thresholdDb: 10,
  medianWindowOctaves: 1 / 3,
  minDurationMs: 300,
  matchCents: 60,
  maxGapMs: 250,
  maxDriftCents: 80,
  fMin: 40,
  fMax: 12000,
  medianSamples: 129,
};

export interface PeakCandidate {
  frequency: number;
  levelDb: number;
  prominenceDb: number;
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/**
 * One frame's worth of narrow peaks. Exported on its own so the detector's
 * memory behaviour can be tested separately from its spectral behaviour.
 */
export function findPeakCandidates(
  power: ArrayLike<number>,
  binWidth: number,
  enbwBins: number,
  options: Partial<PeakDetectorOptions> = {},
): PeakCandidate[] {
  const o = { ...DEFAULT_PEAK_OPTIONS, ...options };
  const bins = power.length;
  const from = Math.max(2, Math.floor(o.fMin / binWidth));
  const to = Math.min(bins - 2, Math.ceil(o.fMax / binWidth));
  const factor = Math.pow(2, o.medianWindowOctaves);
  const out: PeakCandidate[] = [];

  for (let k = from; k <= to; k++) {
    // Local maximum first: it costs nothing and rules out almost every bin.
    if (power[k] <= power[k - 1] || power[k] < power[k + 1]) continue;

    const f = k * binWidth;
    const lo = Math.max(1, Math.floor(f / factor / binWidth));
    const hi = Math.min(bins - 1, Math.ceil((f * factor) / binWidth));
    const count = hi - lo + 1;
    if (count < 5) continue;

    // Subsample wide windows so the cost does not grow with frequency.
    const step = Math.max(1, Math.floor(count / o.medianSamples));
    const window: number[] = [];
    for (let i = lo; i <= hi; i += step) window.push(power[i]);
    const backgroundDb = binDisplayDb(median(window), enbwBins);

    const fit = interpolatePeak(power, k, binWidth, enbwBins);
    const prominence = fit.db - backgroundDb;
    if (prominence < o.thresholdDb) continue;
    out.push({ frequency: fit.frequency, levelDb: fit.db, prominenceDb: prominence });
  }

  // Neighbouring bins of one peak can both survive; keep the strongest.
  return dedupe(out, o.matchCents);
}

function cents(a: number, b: number): number {
  return Math.abs(1200 * Math.log2(a / b));
}

function dedupe(candidates: PeakCandidate[], withinCents: number): PeakCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.prominenceDb - a.prominenceDb);
  const kept: PeakCandidate[] = [];
  for (const c of sorted) {
    if (kept.some((k) => cents(k.frequency, c.frequency) < withinCents)) continue;
    kept.push(c);
  }
  return kept.sort((a, b) => a.frequency - b.frequency);
}

interface Track {
  id: number;
  frequency: number;
  firstFrequency: number;
  minFrequency: number;
  maxFrequency: number;
  prominenceDb: number;
  levelDb: number;
  firstSeen: number;
  lastSeen: number;
  frames: number;
}

export class ResonanceDetector {
  private options: PeakDetectorOptions;
  private tracks: Track[] = [];
  private closed: Resonance[] = [];
  private nextId = 1;

  constructor(options: Partial<PeakDetectorOptions> = {}) {
    this.options = { ...DEFAULT_PEAK_OPTIONS, ...options };
  }

  configure(options: Partial<PeakDetectorOptions>): void {
    this.options = { ...this.options, ...options };
  }

  get settings(): PeakDetectorOptions {
    return this.options;
  }

  reset(): void {
    this.tracks = [];
    this.closed = [];
  }

  push(power: ArrayLike<number>, binWidth: number, enbwBins: number, now: number): void {
    const candidates = findPeakCandidates(power, binWidth, enbwBins, this.options);
    const matched = new Set<Track>();

    for (const c of candidates) {
      const track = this.tracks.find(
        (t) => !matched.has(t) && cents(t.frequency, c.frequency) <= this.options.matchCents,
      );
      if (track) {
        matched.add(track);
        // Follow the peak slowly: a real resonance sits still, and smoothing
        // keeps the reported frequency from dancing on noise.
        track.frequency += (c.frequency - track.frequency) * 0.3;
        track.minFrequency = Math.min(track.minFrequency, c.frequency);
        track.maxFrequency = Math.max(track.maxFrequency, c.frequency);
        track.prominenceDb = Math.max(track.prominenceDb, c.prominenceDb);
        track.levelDb = c.levelDb;
        track.lastSeen = now;
        track.frames++;
      } else {
        const fresh: Track = {
          id: this.nextId++,
          frequency: c.frequency,
          firstFrequency: c.frequency,
          minFrequency: c.frequency,
          maxFrequency: c.frequency,
          prominenceDb: c.prominenceDb,
          levelDb: c.levelDb,
          firstSeen: now,
          lastSeen: now,
          frames: 1,
        };
        this.tracks.push(fresh);
        matched.add(fresh);
      }
    }

    const survivors: Track[] = [];
    for (const track of this.tracks) {
      if (now - track.lastSeen <= this.options.maxGapMs) {
        survivors.push(track);
        continue;
      }
      const done = this.toResonance(track);
      if (done.confirmed) this.closed.unshift(done);
    }
    this.tracks = survivors;
    if (this.closed.length > 50) this.closed.length = 50;
  }

  private toResonance(track: Track): Resonance {
    const durationMs = track.lastSeen - track.firstSeen;
    const driftCents = cents(track.maxFrequency, track.minFrequency);
    return {
      id: track.id,
      frequency: track.frequency,
      prominenceDb: track.prominenceDb,
      levelDb: track.levelDb,
      firstSeen: track.firstSeen,
      lastSeen: track.lastSeen,
      durationMs,
      driftCents,
      // Programme material drifts; a resonance does not.
      confirmed: durationMs >= this.options.minDurationMs && driftCents <= this.options.maxDriftCents,
      frames: track.frames,
    };
  }

  /** Currently sounding resonances, strongest first. */
  active(): Resonance[] {
    return this.tracks
      .map((t) => this.toResonance(t))
      .filter((r) => r.confirmed)
      .sort((a, b) => b.prominenceDb - a.prominenceDb);
  }

  /** Resonances that have ended - the ring-out list. */
  get history(): Resonance[] {
    return this.closed;
  }
}
