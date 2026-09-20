import type { Band } from '../dsp/octave';

export interface BandTrust {
  /** Safe to base a suggestion on. */
  trusted: boolean;
  /** Headroom over the measured background noise; Infinity when unmeasured. */
  snrDb: number;
  belowMicRange: boolean;
  aboveMicRange: boolean;
}

export const MIN_SNR_DB = 10;

/**
 * Decide which bands may drive a suggestion.
 *
 * Two independent reasons to distrust a band: it sits outside the range the
 * microphone can measure, or the signal there is not far enough above the
 * room's own noise. Both are shown in the UI rather than silently dropped.
 */
export function bandTrust(
  bands: Band[],
  levelsDb: ArrayLike<number>,
  noiseFloorDb: ArrayLike<number> | null,
  micFromHz: number,
  micToHz: number,
  minSnrDb = MIN_SNR_DB,
): BandTrust[] {
  return bands.map((band, b) => {
    const belowMicRange = band.center < micFromHz;
    const aboveMicRange = band.center > micToHz;
    const snrDb = noiseFloorDb ? levelsDb[b] - noiseFloorDb[b] : Infinity;
    return {
      belowMicRange,
      aboveMicRange,
      snrDb,
      trusted: !belowMicRange && !aboveMicRange && snrDb >= minSnrDb,
    };
  });
}

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface Confidence {
  level: ConfidenceLevel;
  /** Seconds of signal behind the average the suggestion was made from. */
  seconds: number;
  /** How full the long window is, 0..1. */
  windowFill: number;
  /** Worst noise headroom inside the region. */
  minSnrDb: number;
  /** The region reaches into frequencies this microphone cannot measure. */
  touchesUntrustedRange: boolean;
}

export function confidenceLevel(c: Omit<Confidence, 'level'>): ConfidenceLevel {
  if (c.touchesUntrustedRange) return 'low';
  if (c.windowFill >= 0.9 && c.minSnrDb >= 20) return 'high';
  if (c.windowFill >= 0.5 && c.minSnrDb >= MIN_SNR_DB) return 'medium';
  return 'low';
}
