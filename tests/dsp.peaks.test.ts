import { describe, it, expect } from 'vitest';
import { SpectrumAnalyzer } from '../src/dsp/spectrum';
import { findPeakCandidates, ResonanceDetector } from '../src/dsp/peaks';
import { addSine, pinkNoise } from './helpers/signals';

const FS = 48000;
const N = 8192;

function averagePower(signal: Float64Array, analyser: SpectrumAnalyzer): Float64Array {
  const acc = new Float64Array(analyser.bins);
  let frames = 0;
  for (let off = 0; off + N <= signal.length; off += N / 2) {
    const p = analyser.analyse(signal.subarray(off, off + N));
    for (let k = 0; k < acc.length; k++) acc[k] += p[k];
    frames++;
  }
  for (let k = 0; k < acc.length; k++) acc[k] /= frames;
  return acc;
}

describe('narrow peak detection', () => {
  const analyser = new SpectrumAnalyzer(N, FS, 'hann');
  const noise = pinkNoise(1 << 18, FS, 0.05, 21);

  it('finds a 2.5 kHz tone standing ~15 dB over pink noise', () => {
    // Amplitude chosen so the peak clears its local median by about 15 dB,
    // which is what a squeal just starting to ring looks like.
    const withTone = addSine(noise, 2500, FS, 0.008);
    const peaks = findPeakCandidates(
      averagePower(withTone, analyser),
      analyser.binWidth,
      analyser.enbwBins,
    );
    expect(peaks.length).toBeGreaterThan(0);
    const strongest = peaks.reduce((a, b) => (b.prominenceDb > a.prominenceDb ? b : a));
    expect(strongest.frequency).toBeCloseTo(2500, -1);
    expect(strongest.prominenceDb).toBeGreaterThan(13);
    expect(strongest.prominenceDb).toBeLessThan(20);
  });

  it('finds nothing in pink noise alone', () => {
    const peaks = findPeakCandidates(
      averagePower(noise, analyser),
      analyser.binWidth,
      analyser.enbwBins,
    );
    expect(peaks).toEqual([]);
  });

  it('ignores a peak that is too low to matter', () => {
    // Half the amplitude that would just reach the 10 dB threshold.
    const quietTone = addSine(noise, 2500, FS, 0.002);
    const peaks = findPeakCandidates(
      averagePower(quietTone, analyser),
      analyser.binWidth,
      analyser.enbwBins,
    );
    expect(peaks.every((p) => Math.abs(p.frequency - 2500) > 50)).toBe(true);
  });
});

describe('ResonanceDetector', () => {
  const analyser = new SpectrumAnalyzer(N, FS, 'hann');
  const noise = pinkNoise(1 << 17, FS, 0.05, 22);
  const tonePower = averagePower(addSine(noise, 2500, FS, 0.02), analyser);
  const noisePower = averagePower(noise, analyser);

  const feed = (detector: ResonanceDetector, power: Float64Array, frames: number, start = 0, stepMs = 100) => {
    for (let i = 0; i < frames; i++) {
      detector.push(power, analyser.binWidth, analyser.enbwBins, start + i * stepMs);
    }
    return start + frames * stepMs;
  };

  it('waits for a peak to hold before reporting it', () => {
    const d = new ResonanceDetector({ minDurationMs: 300 });
    feed(d, tonePower, 2); // 100 ms held so far
    expect(d.active()).toEqual([]);
    feed(d, tonePower, 4, 200);
    const active = d.active();
    expect(active.length).toBe(1);
    expect(active[0].frequency).toBeCloseTo(2500, -1);
    expect(active[0].durationMs).toBeGreaterThanOrEqual(300);
  });

  it('moves a peak into the ring-out history once it stops', () => {
    const d = new ResonanceDetector({ minDurationMs: 300, maxGapMs: 250 });
    const end = feed(d, tonePower, 8);
    expect(d.active().length).toBe(1);
    feed(d, noisePower, 6, end + 400);
    expect(d.active()).toEqual([]);
    expect(d.history.length).toBe(1);
    expect(d.history[0].frequency).toBeCloseTo(2500, -1);
  });

  it('stays quiet on pink noise', () => {
    const d = new ResonanceDetector();
    feed(d, noisePower, 20);
    expect(d.active()).toEqual([]);
    expect(d.history).toEqual([]);
  });

  it('clears everything on reset', () => {
    const d = new ResonanceDetector();
    feed(d, tonePower, 8);
    d.reset();
    expect(d.active()).toEqual([]);
    expect(d.history).toEqual([]);
  });
});
