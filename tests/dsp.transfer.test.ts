import { describe, it, expect } from 'vitest';
import { gccPhatDelay, TransferFunction } from '../src/dsp/transfer';
import { pinkNoise, whiteNoise, sine } from './helpers/signals';

const FS = 48000;

function delayed(signal: Float64Array, samples: number): Float64Array {
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    const j = i - samples;
    out[i] = j >= 0 && j < signal.length ? signal[j] : 0;
  }
  return out;
}

/** One-pole low pass: y[n] = (1-a)x[n] + a*y[n-1]. */
function lowpass(signal: Float64Array, cutoffHz: number): Float64Array {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / FS);
  const out = new Float64Array(signal.length);
  let y = 0;
  for (let i = 0; i < signal.length; i++) {
    y = (1 - a) * signal[i] + a * y;
    out[i] = y;
  }
  return out;
}

/**
 * Exact response of that filter, H(z) = (1-a)/(1 - a z^-1).
 *
 * The textbook "-3 dB at cutoff, -6 dB per octave, -45 degrees" describes the
 * analog prototype; the digital filter differs by a few degrees, and the
 * measurement has to agree with the filter that actually ran.
 */
function lowpassResponse(cutoffHz: number, hz: number): { db: number; deg: number } {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / FS);
  const w = (2 * Math.PI * hz) / FS;
  const re = 1 - a * Math.cos(w);
  const im = a * Math.sin(w);
  const mag = (1 - a) / Math.hypot(re, im);
  return { db: 20 * Math.log10(mag), deg: (-Math.atan2(im, re) * 180) / Math.PI };
}

describe('GCC-PHAT delay finder', () => {
  it('recovers a known delay from pink noise to the sample', () => {
    const reference = pinkNoise(1 << 17, FS, 0.2, 41);
    const measurement = delayed(reference, 137);
    const estimate = gccPhatDelay(reference, measurement, FS, 1 << 16);
    expect(estimate.delaySamples).toBe(137);
    expect(estimate.delayMs).toBeCloseTo((137 / FS) * 1000, 6);
    expect(estimate.confidence).toBeGreaterThan(0.5);
  });

  it('handles a negative delay', () => {
    const reference = pinkNoise(1 << 17, FS, 0.2, 42);
    const measurement = delayed(reference, 0);
    const estimate = gccPhatDelay(delayed(reference, 64), measurement, FS, 1 << 16);
    expect(estimate.delaySamples).toBe(-64);
  });

  it('survives a level difference between the two channels', () => {
    const reference = pinkNoise(1 << 17, FS, 0.2, 43);
    const measurement = Float64Array.from(delayed(reference, 500), (v) => v * 0.05);
    expect(gccPhatDelay(reference, measurement, FS, 1 << 16).delaySamples).toBe(500);
  });

  it('reports low confidence for unrelated signals', () => {
    const a = whiteNoise(1 << 16, 0.2, 44);
    const b = whiteNoise(1 << 16, 0.2, 45);
    expect(gccPhatDelay(a, b, FS, 1 << 16).confidence).toBeLessThan(0.3);
  });
});

describe('TransferFunction', () => {
  const N = 8192;

  const accumulate = (reference: Float64Array, measurement: Float64Array) => {
    const tf = new TransferFunction(N, FS, 'hann');
    for (let off = 0; off + N <= reference.length; off += N / 2) {
      tf.push(reference.subarray(off, off + N), measurement.subarray(off, off + N));
    }
    return tf.result();
  };

  const at = (r: { magnitudeDb: Float64Array; binWidth: number }, hz: number) =>
    r.magnitudeDb[Math.round(hz / r.binWidth)];

  it('measures a pure gain as a flat magnitude with full coherence', () => {
    const reference = pinkNoise(1 << 18, FS, 0.2, 46);
    const measurement = Float64Array.from(reference, (v) => v * 0.5);
    const r = accumulate(reference, measurement);
    expect(r.frames).toBeGreaterThan(8);
    for (const hz of [100, 1000, 10000]) {
      expect(at(r, hz), `${hz} Hz`).toBeCloseTo(-6.02, 1);
    }
    const i1k = Math.round(1000 / r.binWidth);
    expect(r.coherence[i1k]).toBeGreaterThan(0.99);
    expect(Math.abs(r.phaseDeg[i1k])).toBeLessThan(1);
  });

  it('measures the magnitude of a known filter', () => {
    const reference = pinkNoise(1 << 19, FS, 0.2, 47);
    const r = accumulate(reference, lowpass(reference, 1000));
    for (const hz of [100, 500, 1000, 2000, 4000, 8000]) {
      expect(at(r, hz), `${hz} Hz`).toBeCloseTo(lowpassResponse(1000, hz).db, 0);
    }
  });

  it('shows the phase lag a filter introduces', () => {
    const reference = pinkNoise(1 << 19, FS, 0.2, 48);
    const r = accumulate(reference, lowpass(reference, 1000));
    for (const hz of [500, 1000, 4000]) {
      const measured = r.phaseDeg[Math.round(hz / r.binWidth)];
      expect(measured, `${hz} Hz`).toBeCloseTo(lowpassResponse(1000, hz).deg, 0);
    }
  });

  it('reports low coherence when the measurement is unrelated noise', () => {
    const reference = pinkNoise(1 << 18, FS, 0.2, 49);
    const measurement = pinkNoise(1 << 18, FS, 0.2, 50);
    const r = accumulate(reference, measurement);
    let sum = 0;
    let count = 0;
    for (let k = 1; k < r.bins; k++) {
      if (k * r.binWidth < 100 || k * r.binWidth > 10000) continue;
      sum += r.coherence[k];
      count++;
    }
    expect(sum / count).toBeLessThan(0.25);
  });

  it('keeps coherence high only where there is signal', () => {
    // Reference is a 1 kHz tone plus quiet noise: away from the tone there is
    // nothing to compare, and coherence must not pretend otherwise.
    const noise = pinkNoise(1 << 18, FS, 0.001, 51);
    const tone = sine(1 << 18, 1000, FS, 0.5);
    const reference = Float64Array.from(noise, (v, i) => v + tone[i]);
    const measurement = Float64Array.from(reference, (v) => v * 0.5);
    const r = accumulate(reference, measurement);
    expect(r.coherence[Math.round(1000 / r.binWidth)]).toBeGreaterThan(0.99);
  });

  it('resets its averages', () => {
    const tf = new TransferFunction(1024, FS);
    const a = new Float64Array(1024).fill(0.1);
    tf.push(a, a);
    expect(tf.frames).toBe(1);
    tf.reset();
    expect(tf.frames).toBe(0);
    expect(tf.result().coherence[10]).toBe(0);
  });
});
