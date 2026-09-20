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
  it('invert the microphone response', () => {
    // The generic phone profile is 14 dB down at 40 Hz, so the correction
    // has to add 14 dB back - just inside the boost cap.
    const gains = correctionGains(PHONE_GENERIC, [40, 1000]);
    expect(10 * Math.log10(gains[0])).toBeCloseTo(14, 6);
    expect(10 * Math.log10(gains[1])).toBeCloseTo(0, 6);
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
