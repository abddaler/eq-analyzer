import { describe, it, expect } from 'vitest';
import { parseCalibrationFile } from '../src/dsp/cal-file';

/** A miniDSP UMIK-1 file: sensitivity header, tab separated, no phase. */
const UMIK = `"Sens Factor =-.9391dB, SERIAL: 7031234"
20.000\t0.9564
25.000\t0.8123
1000.000\t0.0000
20000.000\t-2.4310
`;

/** A Cross-Spectrum style file: star comments, whitespace, phase column. */
const WITH_PHASE = `* Calibration file for microphone 1234
* Generated 2024-01-01
   20.0     1.20    0.0
   100.0    0.30   -1.4
   1000.0   0.00    0.0
   10000.0 -0.80    3.2
   20000.0 -3.10    7.9
`;

/** An FRD export: column header text, comma separated, blank lines. */
const FRD = `Freq(Hz),SPL(dB),Phase(deg)

20,2.5,0
1000,0,0

16000,-1.5,0
`;

describe('calibration file parser', () => {
  it('reads a UMIK-1 file including its sensitivity header', () => {
    const r = parseCalibrationFile(UMIK);
    expect(r.sensitivityDb).toBeCloseTo(-0.9391, 6);
    expect(r.points).toHaveLength(4);
    expect(r.points[0]).toEqual({ f: 20, db: 0.9564 });
    expect(r.points[3]).toEqual({ f: 20000, db: -2.431 });
    expect(r.hasPhase).toBe(false);
  });

  it('reads a file with comments and a phase column', () => {
    const r = parseCalibrationFile(WITH_PHASE);
    expect(r.points).toHaveLength(5);
    expect(r.hasPhase).toBe(true);
    expect(r.points[1]).toEqual({ f: 100, db: 0.3, phase: -1.4 });
    expect(r.sensitivityDb).toBeNull();
  });

  it('reads a comma separated file and ignores its column header', () => {
    const r = parseCalibrationFile(FRD);
    expect(r.points.map((p) => p.f)).toEqual([20, 1000, 16000]);
    expect(r.points[0].db).toBe(2.5);
  });

  it('sorts points and drops duplicate frequencies', () => {
    const r = parseCalibrationFile('1000 1\n20 0\n1000 2\n');
    expect(r.points).toEqual([
      { f: 20, db: 0 },
      { f: 1000, db: 2 },
    ]);
  });

  it('warns about a curve that does not cover the audio band', () => {
    const r = parseCalibrationFile('100 0\n5000 0\n');
    expect(r.warnings).toContain('missing-low-end');
    expect(r.warnings).toContain('missing-high-end');
  });

  it('reports an empty or unreadable file instead of pretending it worked', () => {
    const r = parseCalibrationFile('this is not a calibration file\n\n');
    expect(r.points).toEqual([]);
    expect(r.warnings).toContain('empty');
  });
});
