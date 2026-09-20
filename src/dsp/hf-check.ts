import type { Band } from './octave';

export interface HfResult {
  edgeHz: number;
  cliffHz: number | null;
  cliffDropDb: number;
  enoughSignal: boolean;
}

/**
 * Locate a high-frequency cliff in a 1/3-octave average.
 *
 * Reference is the 1-4 kHz average, which every phone microphone passes. We
 * then walk upward and look for the first band that drops far below it and
 * never recovers - that is what a system voice mode looks like, as opposed to
 * the gentle roll-off of a normal MEMS capsule.
 */
export function analyseHighEnd(bands: Band[], levelsDb: number[], noiseDb: number[]): HfResult {
  const refIdx = bands
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.nominal >= 1000 && b.nominal <= 4000)
    .map(({ i }) => i);
  const reference = refIdx.reduce((s, i) => s + levelsDb[i], 0) / Math.max(1, refIdx.length);
  const snr = refIdx.reduce((s, i) => s + (levelsDb[i] - noiseDb[i]), 0) / Math.max(1, refIdx.length);

  let edgeHz = 0;
  for (let i = 0; i < bands.length; i++) {
    if (bands[i].nominal < 2000) continue;
    if (levelsDb[i] > reference - 12 && levelsDb[i] > noiseDb[i] + 6) edgeHz = bands[i].hi;
  }

  let cliffHz: number | null = null;
  let cliffDropDb = 0;
  for (let i = 1; i < bands.length; i++) {
    if (bands[i].nominal < 4000 || bands[i].nominal > 16000) continue;
    // Compare one third-octave against the one two steps below it: a real
    // filter cliff loses far more than a capsule roll-off over 2/3 octave.
    const drop = levelsDb[i - 2] - levelsDb[i];
    if (drop >= 18 && levelsDb[i - 2] > reference - 12) {
      cliffHz = bands[i - 1].center;
      cliffDropDb = drop;
      break;
    }
  }

  return { edgeHz, cliffHz, cliffDropDb, enoughSignal: snr >= 10 };
}
