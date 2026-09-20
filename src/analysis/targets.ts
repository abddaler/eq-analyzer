import targetsData from '../data/targets.json';
import { interpolateResponse, type CalibrationPoint } from '../dsp/calibration';
import type { Band } from '../dsp/octave';

export type BuiltinTargetId = 'flat' | 'live' | 'speech';

export interface TargetCurve {
  id: string;
  /** Builtin curves are named through i18n; user curves carry their own name. */
  customName?: string;
  points: CalibrationPoint[];
  builtin: boolean;
}

function parse(): TargetCurve[] {
  return targetsData.curves.map((c) => ({
    id: c.id,
    points: c.points.map(([f, db]) => ({ f, db })),
    builtin: true,
  }));
}

export const BUILTIN_TARGETS: TargetCurve[] = parse();

export function findTarget(id: string, extra: TargetCurve[] = []): TargetCurve | null {
  return [...BUILTIN_TARGETS, ...extra].find((t) => t.id === id) ?? null;
}

/** Bands used to match levels: the range where a mix is most stable. */
export const ALIGN_FROM_HZ = 500;
export const ALIGN_TO_HZ = 2000;

function meanInRange(bands: Band[], values: ArrayLike<number>, from: number, to: number): number | null {
  let sum = 0;
  let count = 0;
  for (let b = 0; b < bands.length; b++) {
    if (bands[b].center < from || bands[b].center > to) continue;
    if (!Number.isFinite(values[b])) continue;
    sum += values[b];
    count++;
  }
  return count === 0 ? null : sum / count;
}

/**
 * Project a target onto the analysis bands and slide it vertically until its
 * 500 Hz - 2 kHz average matches the measurement's.
 *
 * Without this the comparison would be about loudness, and every suggestion
 * would read "turn everything up". What we want to compare is shape.
 */
export function alignTargetToBands(
  curve: TargetCurve,
  bands: Band[],
  measuredDb: ArrayLike<number>,
): Float64Array {
  const centers = bands.map((b) => b.center);
  const raw = interpolateResponse(curve.points, centers);
  const targetMean = meanInRange(bands, raw, ALIGN_FROM_HZ, ALIGN_TO_HZ);
  const measuredMean = meanInRange(bands, measuredDb, ALIGN_FROM_HZ, ALIGN_TO_HZ);
  if (targetMean === null || measuredMean === null) return raw;
  const offset = measuredMean - targetMean;
  const out = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] + offset;
  return out;
}

/** Turn a measured spectrum into a target curve ("this mix sounded right"). */
export function targetFromSnapshotLevels(
  id: string,
  name: string,
  bands: Band[],
  levelsDb: ArrayLike<number>,
): TargetCurve {
  const points: CalibrationPoint[] = [];
  for (let b = 0; b < bands.length; b++) {
    if (Number.isFinite(levelsDb[b])) points.push({ f: bands[b].center, db: levelsDb[b] });
  }
  return { id, customName: name, points, builtin: false };
}
