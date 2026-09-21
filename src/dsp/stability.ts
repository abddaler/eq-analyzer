/**
 * Level stability check.
 *
 * Automatic gain control is the one piece of OS processing that a spectrum
 * alone will not reveal: the shape stays right while the whole measurement
 * slides. With a steady source in the room, the level must not move. If it
 * climbs over the first seconds and then sits still, that is AGC settling -
 * and every level this app reports during that time is wrong.
 *
 * Browsers are also allowed to say nothing about `autoGainControl`, which is
 * exactly when this check is needed.
 */

export type StabilityVerdict = 'stable' | 'drifting' | 'unstable-source' | 'too-quiet';

export interface StabilityResult {
  /** Level change from the first segment to the last, dB. */
  driftDb: number;
  /** Spread between the quietest and loudest segment, dB. */
  spreadDb: number;
  firstDb: number;
  lastDb: number;
  /** Per-second means, for the little graph on the diagnostics screen. */
  segmentsDb: number[];
  verdict: StabilityVerdict;
}

/** Below this there is nothing to judge. */
export const TOO_QUIET_DB = -80;
/** A steady source that moves this much is not being measured honestly. */
export const DRIFT_LIMIT_DB = 3;
/** Beyond this the room itself changed and the check cannot conclude. */
export const SOURCE_SPREAD_LIMIT_DB = 6;

/**
 * @param samplesDb  broadband level samples, evenly spaced
 * @param intervalMs spacing between samples
 * @param segmentSeconds length of the blocks the samples are averaged into
 */
export function analyseLevelStability(
  samplesDb: number[],
  intervalMs: number,
  segmentSeconds = 1,
): StabilityResult {
  const perSegment = Math.max(1, Math.round((segmentSeconds * 1000) / intervalMs));
  const segments: number[] = [];
  for (let i = 0; i + perSegment <= samplesDb.length; i += perSegment) {
    let sum = 0;
    for (let j = 0; j < perSegment; j++) sum += samplesDb[i + j];
    segments.push(sum / perSegment);
  }
  if (segments.length < 2) {
    return {
      driftDb: 0,
      spreadDb: 0,
      firstDb: samplesDb[0] ?? -140,
      lastDb: samplesDb[samplesDb.length - 1] ?? -140,
      segmentsDb: segments,
      verdict: 'too-quiet',
    };
  }

  const firstDb = segments[0];
  const lastDb = segments[segments.length - 1];
  const driftDb = lastDb - firstDb;
  const spreadDb = Math.max(...segments) - Math.min(...segments);
  const mean = segments.reduce((a, v) => a + v, 0) / segments.length;

  let verdict: StabilityVerdict;
  if (mean < TOO_QUIET_DB) {
    verdict = 'too-quiet';
  } else if (Math.abs(driftDb) >= DRIFT_LIMIT_DB) {
    // A steady climb or fall is the signature of gain control, whatever the
    // browser claims about autoGainControl.
    verdict = 'drifting';
  } else if (spreadDb > SOURCE_SPREAD_LIMIT_DB) {
    // It wanders but does not end up anywhere: the source is not steady.
    verdict = 'unstable-source';
  } else {
    verdict = 'stable';
  }

  return { driftDb, spreadDb, firstDb, lastDb, segmentsDb: segments, verdict };
}
