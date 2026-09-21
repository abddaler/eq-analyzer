import { describe, it, expect } from 'vitest';
import {
  correctionGains,
  MAX_CORRECTION_DB,
  interpolateResponse,
  levelToSpl,
  profileFromComparison,
} from '../src/dsp/calibration';
import { PHONE_GENERIC } from '../src/data/mic-profiles';
import { frequencyToNote, nearestGeqBand } from '../src/dsp/notes';
import { GEQ_31_BANDS } from '../src/dsp/octave';

describe('response interpolation', () => {
  const points = [
    { f: 100, db: 0 },
    { f: 1000, db: 10 },
  ];

  it('interpolates linearly in log frequency', () => {
    // 316 Hz is halfway between 100 and 1000 on a log axis.
    expect(interpolateResponse(points, [Math.sqrt(100 * 1000)])[0]).toBeCloseTo(5, 6);
  });

  it('holds the end points outside the measured range', () => {
    expect(interpolateResponse(points, [20])[0]).toBe(0);
    expect(interpolateResponse(points, [20000])[0]).toBe(10);
  });

  it('handles descending queries by resetting its cursor', () => {
    const out = interpolateResponse(points, [1000, 100]);
    expect(Array.from(out)).toEqual([10, 0]);
  });
});

describe('correction gains', () => {
  it('invert the microphone response inside the trusted range', () => {
    // The generic phone profile is 1 dB down at 100 Hz and 2 dB up at
    // 12.5 kHz; both are inside its trusted range, so both are undone.
    const gains = correctionGains(PHONE_GENERIC, [100, 1000, 12500]);
    expect(10 * Math.log10(gains[0])).toBeCloseTo(1, 6);
    expect(10 * Math.log10(gains[1])).toBeCloseTo(0, 6);
    expect(10 * Math.log10(gains[2])).toBeCloseTo(-2, 1);
  });

  it('are unity without a profile', () => {
    expect(Array.from(correctionGains(null, [20, 1000]))).toEqual([1, 1]);
  });
});

describe('phone calibration against a reference', () => {
  it('stores the difference, normalised at 1 kHz', () => {
    const f = [100, 1000, 10000];
    const phone = [-6, -2, -1];
    const reference = [0, 0, 0];
    const profile = profileFromComparison('x', 'x', f, phone, reference);
    expect(profile.points[1].db).toBeCloseTo(0, 6);
    expect(profile.points[0].db).toBeCloseTo(-4, 6);
    expect(profile.points[2].db).toBeCloseTo(1, 6);
  });
});

describe('level calibration', () => {
  it('reports relative dB until calibrated', () => {
    expect(levelToSpl(-30, { splAt0dBFS: null })).toBeNull();
    expect(levelToSpl(-30, { splAt0dBFS: 130 })).toBe(100);
  });
});

describe('note names', () => {
  it('names 2.5 kHz as D#7, as the suggestion text promises', () => {
    const note = frequencyToNote(2500);
    expect(note?.name).toBe('D#');
    expect(note?.octave).toBe(7);
  });

  it('names the tuning reference exactly', () => {
    const note = frequencyToNote(440);
    expect(note?.label).toBe('A4');
  });

  it('snaps to the nearest graphic EQ band', () => {
    expect(nearestGeqBand(300, GEQ_31_BANDS)).toBe(315);
    expect(nearestGeqBand(2400, GEQ_31_BANDS)).toBe(2500);
  });
});

describe('correction limits', () => {
  it('refuses to boost a deaf capsule by more than 15 dB', () => {
    const deaf = {
      id: 'deaf',
      name: 'deaf',
      approximate: true,
      trustedFromHz: 80,
      trustedToHz: 20000,
      points: [
        { f: 20, db: -40 },
        { f: 1000, db: 0 },
      ],
    };
    // Correcting a capsule that is 40 dB down would multiply its own noise by
    // ten thousand; the cap keeps that out of the measurement.
    expect(10 * Math.log10(correctionGains(deaf, [20])[0])).toBeCloseTo(MAX_CORRECTION_DB, 6);
    expect(10 * Math.log10(correctionGains(deaf, [1000])[0])).toBeCloseTo(0, 6);
  });

  it('leaves a well-behaved measurement microphone untouched by the cap', () => {
    const umik = {
      id: 'umik',
      name: 'umik',
      approximate: false,
      trustedFromHz: 20,
      trustedToHz: 20000,
      points: [
        { f: 20, db: -2.5 },
        { f: 1000, db: 0 },
        { f: 20000, db: 3 },
      ],
    };
    expect(10 * Math.log10(correctionGains(umik, [20])[0])).toBeCloseTo(2.5, 6);
    expect(10 * Math.log10(correctionGains(umik, [20000])[0])).toBeCloseTo(-3, 6);
  });
});

describe('correction outside the trusted range', () => {
  it('does not invent low end from a class-average phone profile', () => {
    // The profile says the capsule is 30 dB down at 20 Hz. Correcting that
    // literally would add 15 dB (the cap) to bands the app simultaneously
    // marks as untrusted - a wall of bass that is not in the room.
    const gains = correctionGains(PHONE_GENERIC, [20, 31.5, 40, 63]);
    for (const g of gains) {
      expect(10 * Math.log10(g)).toBeLessThan(3);
    }
  });

  it('holds the correction at the edge of the trusted range', () => {
    const atEdge = 10 * Math.log10(correctionGains(PHONE_GENERIC, [PHONE_GENERIC.trustedFromHz])[0]);
    const below = 10 * Math.log10(correctionGains(PHONE_GENERIC, [20])[0]);
    expect(below).toBeCloseTo(atEdge, 6);
  });

  it('still corrects everywhere inside the trusted range', () => {
    // 12.5 kHz is inside the range and the profile is 2 dB up there.
    expect(10 * Math.log10(correctionGains(PHONE_GENERIC, [12500])[0])).toBeCloseTo(-2, 1);
  });

  it('applies a real calibration file across its whole measured range', () => {
    const umik = {
      id: 'umik',
      name: 'umik',
      approximate: false,
      trustedFromHz: 20,
      trustedToHz: 20000,
      points: [
        { f: 20, db: -2.5 },
        { f: 1000, db: 0 },
        { f: 20000, db: 3 },
      ],
    };
    expect(10 * Math.log10(correctionGains(umik, [20])[0])).toBeCloseTo(2.5, 6);
    expect(10 * Math.log10(correctionGains(umik, [20000])[0])).toBeCloseTo(-3, 6);
  });

  it('leaves a flat third-octave signal flat', () => {
    // The acceptance test that matters: pink noise is flat per third octave,
    // so nothing the correction does may tilt it inside the trusted range.
    const bands = [125, 250, 500, 1000, 2000, 4000, 8000];
    const gains = Array.from(correctionGains(PHONE_GENERIC, bands), (g) => 10 * Math.log10(g));
    expect(Math.max(...gains) - Math.min(...gains)).toBeLessThan(2);
  });
});
