import { describe, it, expect } from 'vitest';
import { analyseLevelStability } from '../src/dsp/stability';

const INTERVAL = 200;

/** `seconds` of samples produced by `shape(t)`. */
function samples(seconds: number, shape: (t: number) => number): number[] {
  const n = Math.round((seconds * 1000) / INTERVAL);
  return Array.from({ length: n }, (_, i) => shape((i * INTERVAL) / 1000));
}

describe('level stability check', () => {
  it('passes a steady level', () => {
    const r = analyseLevelStability(samples(10, () => -40), INTERVAL);
    expect(r.verdict).toBe('stable');
    expect(r.driftDb).toBeCloseTo(0, 6);
  });

  it('tolerates the wobble of real programme material', () => {
    const r = analyseLevelStability(samples(10, (t) => -40 + Math.sin(t * 3)), INTERVAL);
    expect(r.verdict).toBe('stable');
  });

  it('catches a level that climbs, which is what AGC looks like', () => {
    // 8 dB over the first four seconds, then steady - a gain control settling.
    const r = analyseLevelStability(samples(10, (t) => -48 + Math.min(t, 4) * 2), INTERVAL);
    expect(r.verdict).toBe('drifting');
    expect(r.driftDb).toBeGreaterThan(6);
  });

  it('catches a level that falls', () => {
    const r = analyseLevelStability(samples(10, (t) => -35 - Math.min(t, 5)), INTERVAL);
    expect(r.verdict).toBe('drifting');
    expect(r.driftDb).toBeLessThan(-3);
  });

  it('refuses to judge when the room itself is not steady', () => {
    // Swings 10 dB but ends where it started: that is the material, not gain.
    const r = analyseLevelStability(samples(12, (t) => -40 + 5 * Math.sin((t * Math.PI) / 6)), INTERVAL);
    expect(r.verdict).toBe('unstable-source');
    expect(r.spreadDb).toBeGreaterThan(6);
  });

  it('refuses to judge silence', () => {
    expect(analyseLevelStability(samples(10, () => -95), INTERVAL).verdict).toBe('too-quiet');
  });

  it('needs more than one segment', () => {
    expect(analyseLevelStability([-40, -40], INTERVAL).verdict).toBe('too-quiet');
  });
});
