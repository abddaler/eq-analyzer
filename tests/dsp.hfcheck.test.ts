import { describe, it, expect } from 'vitest';
import { analyseHighEnd } from '../src/dsp/hf-check';
import { makeBands } from '../src/dsp/octave';

const bands = makeBands(3, 20, 20000);
const noise = bands.map(() => -90);

/** Flat response with an optional brick wall above `cutoff`. */
function response(cutoff: number | null, slopeDbPerBand = 0): number[] {
  return bands.map((b, i) => {
    const base = -40 + slopeDbPerBand * i;
    if (cutoff && b.center > cutoff) {
      const octavesAbove = Math.log2(b.center / cutoff);
      return base - 60 * octavesAbove;
    }
    return base;
  });
}

describe('high-frequency cutoff check', () => {
  it('finds an 8 kHz brick wall', () => {
    const r = analyseHighEnd(bands, response(8000), noise);
    expect(r.cliffHz).not.toBeNull();
    expect(r.cliffHz!).toBeGreaterThan(6000);
    expect(r.cliffHz!).toBeLessThan(12000);
    expect(r.cliffDropDb).toBeGreaterThan(18);
    expect(r.enoughSignal).toBe(true);
  });

  it('does not flag a flat response', () => {
    const r = analyseHighEnd(bands, response(null), noise);
    expect(r.cliffHz).toBeNull();
    expect(r.edgeHz).toBeGreaterThan(18000);
  });

  it('does not flag the gentle roll-off of a normal capsule', () => {
    // About 1 dB per third-octave above 1 kHz: steep for a microphone, still
    // nothing like a filter cliff.
    const levels = bands.map((b) => (b.center <= 1000 ? -40 : -40 - Math.log2(b.center / 1000) * 3));
    const r = analyseHighEnd(bands, levels, noise);
    expect(r.cliffHz).toBeNull();
  });

  it('reports too little signal when the room is quiet', () => {
    const levels = bands.map(() => -85);
    const r = analyseHighEnd(bands, levels, noise);
    expect(r.enoughSignal).toBe(false);
  });
});
