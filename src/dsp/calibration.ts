/**
 * Microphone response correction.
 *
 * A profile stores the microphone's *measured response* (the same convention
 * as a UMIK-1 .txt calibration file), so the correction applied to a
 * measurement is the negative of it.
 */

export interface CalibrationPoint {
  f: number;
  db: number;
  phase?: number;
}

export interface MicProfile {
  id: string;
  name: string;
  /** Response of the microphone in dB, ascending in frequency. */
  points: CalibrationPoint[];
  /** Below this the capsule cannot be trusted; the UI greys those bands out. */
  trustedFromHz: number;
  trustedToHz: number;
  /** Generic profiles are guesses about a class of device, not a measurement. */
  approximate: boolean;
  /** Sensitivity from a "Sens Factor" header, dB. */
  sensitivityDb?: number;
  source?: 'builtin' | 'imported' | 'measured';
}

/**
 * Interpolate a response onto arbitrary frequencies.
 *
 * Interpolation is linear in log(frequency) and in dB, which is how these
 * curves are read and drawn; doing it linearly in Hz would smear the bottom
 * two octaves where all the correction is.
 */
export function interpolateResponse(
  points: CalibrationPoint[],
  frequencies: ArrayLike<number>,
  out?: Float64Array,
): Float64Array {
  const result = out ?? new Float64Array(frequencies.length);
  if (points.length === 0) {
    result.fill(0);
    return result;
  }
  if (points.length === 1) {
    result.fill(points[0].db);
    return result;
  }
  let i = 0;
  for (let n = 0; n < frequencies.length; n++) {
    const f = frequencies[n];
    if (f <= points[0].f) {
      result[n] = points[0].db;
      continue;
    }
    if (f >= points[points.length - 1].f) {
      result[n] = points[points.length - 1].db;
      continue;
    }
    // Frequencies arrive ascending in every caller, so the cursor only moves
    // forward; reset it when that assumption does not hold.
    if (points[i].f > f) i = 0;
    while (i < points.length - 2 && points[i + 1].f < f) i++;
    const a = points[i];
    const b = points[i + 1];
    const t = Math.log(f / a.f) / Math.log(b.f / a.f);
    result[n] = a.db + t * (b.db - a.db);
  }
  return result;
}

/**
 * Linear power gains that undo the microphone response.
 * Multiply a power spectrum by these before summing into bands.
 */
export function correctionGains(
  profile: MicProfile | null,
  frequencies: ArrayLike<number>,
): Float64Array {
  const out = new Float64Array(frequencies.length);
  if (!profile) {
    out.fill(1);
    return out;
  }
  const response = interpolateResponse(profile.points, frequencies);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.pow(10, -response[i] / 10);
  }
  return out;
}

export interface LevelCalibration {
  /** dB SPL that corresponds to 0 dBFS. Null means "relative dB only". */
  splAt0dBFS: number | null;
}

export const NO_LEVEL_CALIBRATION: LevelCalibration = { splAt0dBFS: null };

/**
 * Android's UNPROCESSED source is specified so that a 1 kHz tone at 94 dB SPL
 * reads -36 dBFS. That makes a usable starting point before a real calibrator.
 */
export const ANDROID_UNPROCESSED_SPL_AT_0DBFS = 94 + 36;

export function levelToSpl(dbfs: number, cal: LevelCalibration): number | null {
  return cal.splAt0dBFS === null ? null : dbfs + cal.splAt0dBFS;
}

/** Difference between a reference measurement and the phone's, as a profile. */
export function profileFromComparison(
  id: string,
  name: string,
  frequencies: ArrayLike<number>,
  phoneDb: ArrayLike<number>,
  referenceDb: ArrayLike<number>,
  trustedFromHz = 40,
): MicProfile {
  const points: CalibrationPoint[] = [];
  for (let i = 0; i < frequencies.length; i++) {
    points.push({ f: frequencies[i], db: phoneDb[i] - referenceDb[i] });
  }
  // Only the shape matters; normalise at 1 kHz so the comparison does not also
  // apply a level shift.
  const at1k = interpolateResponse(points, [1000])[0];
  for (const p of points) p.db -= at1k;
  return {
    id,
    name,
    points,
    trustedFromHz,
    trustedToHz: 20000,
    approximate: false,
    source: 'measured',
  };
}
