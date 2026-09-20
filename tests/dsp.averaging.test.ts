import { describe, it, expect } from 'vitest';
import {
  ExponentialAverager,
  LinearAverager,
  PeakHold,
  SlidingAverager,
  TIME_CONSTANTS,
} from '../src/dsp/averaging';

describe('ExponentialAverager', () => {
  it('starts at the first frame instead of ramping up from zero', () => {
    const a = new ExponentialAverager(1, TIME_CONSTANTS.slow);
    a.push([4], 0.05);
    expect(a.value[0]).toBe(4);
  });

  it('reaches 63% of a step after one time constant', () => {
    const a = new ExponentialAverager(1, 1.0);
    a.push([0], 0.01);
    for (let i = 0; i < 100; i++) a.push([1], 0.01);
    expect(a.value[0]).toBeCloseTo(1 - Math.exp(-1), 2);
  });

  it('follows faster with the Fast time constant than with Slow', () => {
    const fast = new ExponentialAverager(1, TIME_CONSTANTS.fast);
    const slow = new ExponentialAverager(1, TIME_CONSTANTS.slow);
    fast.push([0], 0.01);
    slow.push([0], 0.01);
    for (let i = 0; i < 20; i++) {
      fast.push([1], 0.01);
      slow.push([1], 0.01);
    }
    expect(fast.value[0]).toBeGreaterThan(slow.value[0]);
  });
});

describe('LinearAverager', () => {
  it('averages every frame equally and clears on reset', () => {
    const a = new LinearAverager(2);
    a.push([1, 10], 0.1);
    a.push([3, 20], 0.1);
    expect(Array.from(a.value)).toEqual([2, 15]);
    expect(a.elapsed).toBeCloseTo(0.2, 6);
    a.reset();
    expect(Array.from(a.value)).toEqual([0, 0]);
  });
});

describe('SlidingAverager', () => {
  it('is a true boxcar: old frames leave the average entirely', () => {
    const a = new SlidingAverager(1, 3, 0.1);
    a.push([9]);
    a.push([0]);
    a.push([0]);
    expect(a.value[0]).toBeCloseTo(3, 6);
    a.push([0]); // pushes the 9 out of the window
    expect(a.value[0]).toBeCloseTo(0, 6);
    expect(a.full).toBe(true);
  });

  it('reports how full the window is, for the confidence readout', () => {
    const a = new SlidingAverager(1, 4, 0.5);
    a.push([1]);
    a.push([1]);
    expect(a.fill).toBeCloseTo(0.5, 6);
    expect(a.elapsed).toBeCloseTo(1, 6);
  });
});

describe('PeakHold', () => {
  it('holds a peak and decays at the configured rate', () => {
    const p = new PeakHold(1, 10); // 10 dB per second
    p.push([1], 0.1);
    expect(p.value[0]).toBe(1);
    p.push([0], 1.0);
    expect(10 * Math.log10(p.value[0])).toBeCloseTo(-10, 6);
  });
});
