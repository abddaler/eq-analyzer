/** Musical note names for frequencies - handy when chasing a ringing room. */

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const A4 = 440;

export interface NoteInfo {
  name: string;
  octave: number;
  /** Deviation from the tempered note, in cents. */
  cents: number;
  /** "D#7 +12¢" */
  label: string;
}

export function frequencyToNote(f: number, referenceA4 = A4): NoteInfo | null {
  if (!Number.isFinite(f) || f <= 0) return null;
  const semitones = 12 * Math.log2(f / referenceA4);
  const rounded = Math.round(semitones);
  const cents = Math.round((semitones - rounded) * 100);
  // MIDI note 69 is A4; C-1 is MIDI 0.
  const midi = rounded + 69;
  const name = NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const sign = cents > 0 ? '+' : '';
  return {
    name,
    octave,
    cents,
    label: `${name}${octave}${cents === 0 ? '' : ` ${sign}${cents}¢`}`,
  };
}

/** Nearest band of a 31-band graphic EQ. */
export function nearestGeqBand(f: number, bandCenters: number[]): number {
  let best = bandCenters[0];
  let bestDistance = Infinity;
  for (const c of bandCenters) {
    const d = Math.abs(Math.log2(f / c));
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}
