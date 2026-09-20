import type { Band } from '../dsp/octave';
import { GEQ_31_BANDS } from '../dsp/octave';
import { interpolateResponse } from '../dsp/calibration';
import { zoneFor, type ZoneId } from './zones';
import { confidenceLevel, type BandTrust, type Confidence } from './confidence';

export type Severity = 'slight' | 'noticeable';
export type Direction = 'excess' | 'deficit';

export interface GeqMove {
  hz: number;
  gainDb: number;
}

export interface Suggestion {
  /** Stable across updates while the same problem persists. */
  id: string;
  zone: ZoneId;
  direction: Direction;
  centerHz: number;
  lowHz: number;
  highHz: number;
  widthOctaves: number;
  q: number;
  /** Largest deviation inside the region, signed (+ = too much energy). */
  deviationDb: number;
  /** Deviation averaged over the region, weighted by magnitude. */
  meanDeviationDb: number;
  /** Recommended parametric correction, signed and already limited. */
  gainDb: number;
  severity: Severity;
  significance: number;
  geq: GeqMove[];
  confidence: Confidence;
}

export interface SuggestInput {
  bands: Band[];
  levelsDb: ArrayLike<number>;
  targetDb: ArrayLike<number>;
  trust: BandTrust[];
  /** Seconds behind the average, and how full the long window is. */
  seconds: number;
  windowFill: number;
}

export interface SuggestOptions {
  /** A region has to reach this deviation somewhere to be worth mentioning. */
  minDeviationDb: number;
  /** Bands join a region from this deviation upwards. */
  regionInclusionDb: number;
  maxSuggestions: number;
  /** Corrections are deliberately partial - the room is not an EQ curve. */
  correctionFactor: number;
  maxGainDb: number;
  geqBands: number[];
}

export const DEFAULT_SUGGEST_OPTIONS: SuggestOptions = {
  minDeviationDb: 3,
  regionInclusionDb: 1.5,
  maxSuggestions: 4,
  correctionFactor: 0.65,
  maxGainDb: 6,
  geqBands: GEQ_31_BANDS,
};

/**
 * Q from bandwidth in octaves, the standard parametric relation:
 * Q = 2^(N/2) / (2^N - 1).
 */
export function qFromOctaves(octaves: number): number {
  const n = Math.max(octaves, 1e-3);
  return Math.pow(2, n / 2) / (Math.pow(2, n) - 1);
}

export function octavesFromQ(q: number): number {
  // Inverse of the above, solved for N.
  const x = 1 / (2 * q);
  return (2 * Math.log(x + Math.sqrt(x * x + 1))) / Math.LN2;
}

function clamp(v: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, v));
}

function round(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/**
 * Turn a deviation-from-target curve into a handful of EQ moves.
 *
 * Deliberately conservative: only bands the measurement can vouch for take
 * part, corrections are a fraction of the measured deviation and hard-limited,
 * and at most a few of the most significant regions are reported. An analyser
 * that suggests nine simultaneous 9 dB cuts is not being helpful.
 */
export function generateSuggestions(
  input: SuggestInput,
  options: Partial<SuggestOptions> = {},
): Suggestion[] {
  const o = { ...DEFAULT_SUGGEST_OPTIONS, ...options };
  const { bands, levelsDb, targetDb, trust } = input;

  const deviation = new Float64Array(bands.length);
  for (let b = 0; b < bands.length; b++) {
    deviation[b] = levelsDb[b] - targetDb[b];
  }

  const suggestions: Suggestion[] = [];
  let start = -1;
  let sign = 0;

  const flush = (end: number) => {
    if (start < 0) return;
    const region = { from: start, to: end };
    start = -1;
    sign = 0;
    const built = buildSuggestion(region, bands, deviation, trust, input, o);
    if (built) suggestions.push(built);
  };

  for (let b = 0; b < bands.length; b++) {
    const usable = trust[b].trusted && Math.abs(deviation[b]) >= o.regionInclusionDb;
    const thisSign = Math.sign(deviation[b]);
    if (!usable || (sign !== 0 && thisSign !== sign)) {
      flush(b - 1);
      if (!usable) continue;
    }
    if (start < 0) {
      start = b;
      sign = thisSign;
    }
  }
  flush(bands.length - 1);

  return suggestions
    .sort((a, b) => b.significance - a.significance)
    .slice(0, o.maxSuggestions);
}

function buildSuggestion(
  region: { from: number; to: number },
  bands: Band[],
  deviation: Float64Array,
  trust: BandTrust[],
  input: SuggestInput,
  o: SuggestOptions,
): Suggestion | null {
  const { from, to } = region;
  let weightSum = 0;
  let logSum = 0;
  let devSum = 0;
  let peak = 0;
  let peakIndex = from;
  let minSnr = Infinity;
  let touchesUntrusted = false;

  for (let b = from; b <= to; b++) {
    const dev = deviation[b];
    const w = Math.abs(dev);
    weightSum += w;
    logSum += w * Math.log(bands[b].center);
    devSum += w * dev;
    if (Math.abs(dev) > Math.abs(peak)) {
      peak = dev;
      peakIndex = b;
    }
    minSnr = Math.min(minSnr, trust[b].snrDb);
  }
  if (weightSum === 0 || Math.abs(peak) < o.minDeviationDb) return null;

  // A region that sits next to a band the microphone cannot measure is
  // suspect even if every band inside it is fine.
  const neighbourBelow = trust[Math.max(0, from - 1)];
  const neighbourAbove = trust[Math.min(trust.length - 1, to + 1)];
  touchesUntrusted = neighbourBelow.belowMicRange || neighbourAbove.aboveMicRange;

  const centerHz = Math.exp(logSum / weightSum);
  const lowHz = bands[from].lo;
  const highHz = bands[to].hi;
  const widthOctaves = Math.log2(highHz / lowHz);
  const meanDeviationDb = devSum / weightSum;
  const gainDb = round(clamp(-peak * o.correctionFactor, o.maxGainDb), 0.5);
  const direction: Direction = peak > 0 ? 'excess' : 'deficit';

  const partial: Omit<Confidence, 'level'> = {
    seconds: input.seconds,
    windowFill: input.windowFill,
    minSnrDb: minSnr,
    touchesUntrustedRange: touchesUntrusted,
  };

  return {
    id: `${zoneFor(centerHz).id}:${direction}`,
    zone: zoneFor(centerHz).id,
    direction,
    centerHz,
    lowHz,
    highHz,
    widthOctaves,
    q: qFromOctaves(widthOctaves),
    deviationDb: peak,
    meanDeviationDb,
    gainDb,
    severity: Math.abs(peak) > 6 ? 'noticeable' : 'slight',
    significance: Math.abs(peak) * Math.max(widthOctaves, 1 / 6),
    geq: geqMoves(bands, deviation, from, to, bands[peakIndex].center, o),
    confidence: { ...partial, level: confidenceLevel(partial) },
  };
}

/** Which faders of a 31-band graphic EQ to move, and by how much. */
function geqMoves(
  bands: Band[],
  deviation: Float64Array,
  from: number,
  to: number,
  _peakHz: number,
  o: SuggestOptions,
): GeqMove[] {
  const points = bands.map((band, b) => ({ f: band.center, db: deviation[b] }));
  const lowHz = bands[from].lo;
  const highHz = bands[to].hi;
  const targets = o.geqBands.filter((hz) => hz >= lowHz && hz <= highHz);
  if (targets.length === 0) return [];
  const devAt = interpolateResponse(points, targets);
  const moves: GeqMove[] = [];
  for (let i = 0; i < targets.length; i++) {
    const gain = round(clamp(-devAt[i] * o.correctionFactor, o.maxGainDb), 0.5);
    // A fader move under half a dB is noise, not advice.
    if (Math.abs(gain) >= 0.5) moves.push({ hz: targets[i], gainDb: gain });
  }
  return moves;
}

/**
 * Keeps the cards still.
 *
 * Suggestions are recomputed continuously, but a card that flickers between
 * "-3.5 dB" and "-4.0 dB" twice a second is unreadable and untrustworthy. A
 * new set is published only after a minimum interval and only when it actually
 * says something different.
 */
export class SuggestionStabilizer {
  private current: Suggestion[] = [];
  private lastChange = -Infinity;
  private minIntervalMs: number;
  private changeThresholdDb: number;

  constructor(minIntervalMs = 2500, changeThresholdDb = 1.0) {
    this.minIntervalMs = minIntervalMs;
    this.changeThresholdDb = changeThresholdDb;
  }

  get value(): Suggestion[] {
    return this.current;
  }

  reset(): void {
    this.current = [];
    this.lastChange = -Infinity;
  }

  update(next: Suggestion[], now: number): Suggestion[] {
    if (this.current.length === 0 && next.length > 0) {
      this.current = next;
      this.lastChange = now;
      return this.current;
    }
    if (now - this.lastChange < this.minIntervalMs) return this.current;
    if (this.differs(next)) {
      this.current = next;
      this.lastChange = now;
    }
    return this.current;
  }

  private differs(next: Suggestion[]): boolean {
    if (next.length !== this.current.length) return true;
    for (let i = 0; i < next.length; i++) {
      const a = next[i];
      const b = this.current[i];
      if (a.id !== b.id) return true;
      if (Math.abs(a.gainDb - b.gainDb) >= this.changeThresholdDb) return true;
      if (Math.abs(Math.log2(a.centerHz / b.centerHz)) > 1 / 6) return true;
      if (a.severity !== b.severity) return true;
    }
    return false;
  }
}
