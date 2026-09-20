import type { CalibrationPoint } from './calibration';

/**
 * Parser for microphone calibration files (.txt / .cal / .frd).
 *
 * There is no standard. Real files from miniDSP, Cross-Spectrum, Dayton and
 * REW differ in separators, in whether a phase column exists, in comment
 * markers and in whether there is a sensitivity header. The parser is
 * therefore deliberately forgiving: anything whose first two tokens are
 * numbers is a data point, everything else is a comment.
 */

export interface ParsedCalibration {
  points: CalibrationPoint[];
  /** From a "Sens Factor =" header, dB. */
  sensitivityDb: number | null;
  /** Non-fatal observations worth showing the user. */
  warnings: string[];
  /** Lines that looked like data but could not be read. */
  skippedLines: number;
  hasPhase: boolean;
}

const COMMENT_PREFIXES = ['*', '#', ';', '//', "'"];
// UMIK files write the value as "-.9391", with no leading zero.
const SENS_PATTERN = /sens(?:itivity)?\s*factor\s*=\s*(-?(?:\d+(?:\.\d+)?|\.\d+))/i;

function isComment(line: string): boolean {
  return COMMENT_PREFIXES.some((p) => line.startsWith(p));
}

export function parseCalibrationFile(text: string): ParsedCalibration {
  const points: CalibrationPoint[] = [];
  const warnings: string[] = [];
  let sensitivityDb: number | null = null;
  let skippedLines = 0;
  let hasPhase = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;

    const sens = SENS_PATTERN.exec(line);
    if (sens) {
      sensitivityDb = Number(sens[1]);
      continue;
    }
    if (isComment(line)) continue;

    // Tabs, spaces, commas and semicolons all appear as separators in the
    // wild; a quoted header line is simply not numeric and falls through.
    const tokens = line.replace(/^"|"$/g, '').split(/[\s,;]+/).filter(Boolean);
    if (tokens.length < 2) {
      skippedLines++;
      continue;
    }
    const f = Number(tokens[0]);
    const db = Number(tokens[1]);
    if (!Number.isFinite(f) || !Number.isFinite(db) || f <= 0) {
      // Almost always a column header ("Freq(Hz) SPL(dB)"); not worth a warning.
      continue;
    }
    const point: CalibrationPoint = { f, db };
    if (tokens.length >= 3) {
      const phase = Number(tokens[2]);
      if (Number.isFinite(phase)) {
        point.phase = phase;
        hasPhase = true;
      }
    }
    points.push(point);
  }

  points.sort((a, b) => a.f - b.f);

  // Duplicate frequencies break interpolation; keep the last one.
  const deduped: CalibrationPoint[] = [];
  for (const p of points) {
    const previous = deduped[deduped.length - 1];
    if (previous && Math.abs(previous.f - p.f) < 1e-9) deduped[deduped.length - 1] = p;
    else deduped.push(p);
  }

  if (deduped.length === 0) warnings.push('empty');
  else {
    if (deduped[0].f > 30) warnings.push('missing-low-end');
    if (deduped[deduped.length - 1].f < 15000) warnings.push('missing-high-end');
    if (deduped.length < 10) warnings.push('few-points');
  }
  if (skippedLines > 0) warnings.push('skipped-lines');

  return { points: deduped, sensitivityDb, warnings, skippedLines, hasPhase };
}
