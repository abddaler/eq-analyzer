import { describe, it, expect } from 'vitest';
import { makeBands } from '../src/dsp/octave';
import { bandTrust } from '../src/analysis/confidence';
import {
  generateSuggestions,
  qFromOctaves,
  octavesFromQ,
  SuggestionStabilizer,
  type SuggestInput,
} from '../src/analysis/suggest';
import { alignTargetToBands, BUILTIN_TARGETS, findTarget } from '../src/analysis/targets';

const bands = makeBands(3, 20, 20000);
const flatTarget = new Float64Array(bands.length).fill(-40);

/** Measurement that is flat at -40 dB except for a bump/dip we place in it. */
function spectrum(shape: Record<number, number> = {}): Float64Array {
  const out = new Float64Array(bands.length).fill(-40);
  for (const [hz, delta] of Object.entries(shape)) {
    const i = bands.findIndex((b) => b.nominal === Number(hz));
    if (i >= 0) out[i] += delta;
  }
  return out;
}

function input(levels: Float64Array, overrides: Partial<SuggestInput> = {}): SuggestInput {
  return {
    bands,
    levelsDb: levels,
    targetDb: flatTarget,
    trust: bandTrust(bands, levels, null, 20, 20000),
    seconds: 20,
    windowFill: 1,
    ...overrides,
  };
}

describe('Q and bandwidth', () => {
  it('maps one octave to Q ~ 1.41', () => {
    expect(qFromOctaves(1)).toBeCloseTo(1.414, 2);
    expect(qFromOctaves(1 / 3)).toBeCloseTo(4.32, 1);
    expect(qFromOctaves(2)).toBeCloseTo(0.667, 2);
  });

  it('round-trips through octavesFromQ', () => {
    for (const n of [0.25, 1 / 3, 0.5, 1, 2, 3]) {
      expect(octavesFromQ(qFromOctaves(n))).toBeCloseTo(n, 6);
    }
  });
});

describe('suggestion generation', () => {
  it('says nothing about a spectrum that already matches the target', () => {
    expect(generateSuggestions(input(spectrum()))).toEqual([]);
  });

  it('ignores deviations under 3 dB', () => {
    expect(generateSuggestions(input(spectrum({ 315: 2.5 })))).toEqual([]);
  });

  it('turns a +6 dB hump over 250-400 Hz into a ~315 Hz cut of about 4 dB', () => {
    const levels = spectrum({ 250: 4, 315: 6, 400: 4 });
    const [s, ...rest] = generateSuggestions(input(levels));
    expect(rest).toEqual([]);
    expect(s.direction).toBe('excess');
    expect(s.zone).toBe('lowMid');
    expect(s.centerHz).toBeGreaterThan(280);
    expect(s.centerHz).toBeLessThan(355);
    expect(s.gainDb).toBeCloseTo(-4, 0);
    expect(s.q).toBeGreaterThan(1);
    expect(s.q).toBeLessThan(1.5);
    expect(s.severity).toBe('slight');
    // The graphic-EQ form has to name the faders, not just a frequency.
    expect(s.geq.map((g) => g.hz)).toEqual([250, 315, 400]);
    expect(s.geq.every((g) => g.gainDb < 0)).toBe(true);
  });

  it('asks for a boost when a region is missing', () => {
    const [s] = generateSuggestions(input(spectrum({ 4000: -7, 5000: -7 })));
    expect(s.direction).toBe('deficit');
    expect(s.gainDb).toBeGreaterThan(0);
    expect(s.severity).toBe('noticeable');
    expect(s.zone).toBe('presence');
  });

  it('never proposes more than 6 dB', () => {
    const [s] = generateSuggestions(input(spectrum({ 1000: 30, 1250: 30 })));
    expect(s.gainDb).toBe(-6);
  });

  it('is unaffected by overall loudness once the target is aligned', () => {
    const quiet = spectrum({ 250: 4, 315: 6, 400: 4 });
    const loud = Float64Array.from(quiet, (v) => v + 18);
    const live = findTarget('flat')!;
    const a = generateSuggestions(input(quiet, { targetDb: alignTargetToBands(live, bands, quiet) }));
    const b = generateSuggestions(input(loud, { targetDb: alignTargetToBands(live, bands, loud) }));
    expect(b[0].gainDb).toBeCloseTo(a[0].gainDb, 6);
    expect(b[0].centerHz).toBeCloseTo(a[0].centerHz, 6);
  });

  it('keeps at most four suggestions, most significant first', () => {
    const levels = spectrum({
      31.5: 8, 40: 8,
      125: -8, 160: -8,
      630: 7, 800: 7,
      2500: -9, 3150: -9,
      10000: 12, 12500: 12,
    });
    const result = generateSuggestions(input(levels));
    expect(result.length).toBe(4);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].significance).toBeGreaterThanOrEqual(result[i].significance);
    }
  });

  it('refuses to use bands the microphone cannot measure', () => {
    const levels = spectrum({ 31.5: 10, 40: 10 });
    const phoneTrust = bandTrust(bands, levels, null, 80, 16000);
    expect(generateSuggestions(input(levels, { trust: phoneTrust }))).toEqual([]);
  });

  it('refuses to use bands buried in the noise floor', () => {
    const levels = spectrum({ 8000: 8, 10000: 8 });
    // Noise floor only 5 dB below the signal: not enough headroom to judge.
    const noise = Float64Array.from(levels, (v) => v - 5);
    const trust = bandTrust(bands, levels, noise, 20, 20000);
    expect(generateSuggestions(input(levels, { trust }))).toEqual([]);
  });

  it('marks confidence low when the region touches the untrusted low end', () => {
    const levels = spectrum({ 80: 8, 100: 8 });
    const trust = bandTrust(bands, levels, null, 80, 16000);
    const [s] = generateSuggestions(input(levels, { trust }));
    expect(s.confidence.touchesUntrustedRange).toBe(true);
    expect(s.confidence.level).toBe('low');
  });

  it('reports high confidence for a clean, fully accumulated measurement', () => {
    const levels = spectrum({ 630: 6, 800: 6 });
    const noise = Float64Array.from(levels, (v) => v - 40);
    const trust = bandTrust(bands, levels, noise, 20, 20000);
    const [s] = generateSuggestions(input(levels, { trust, seconds: 20, windowFill: 1 }));
    expect(s.confidence.level).toBe('high');
  });
});

describe('target curves', () => {
  it('ships the curves the UI offers', () => {
    expect(BUILTIN_TARGETS.map((c) => c.id)).toEqual(['flat', 'live', 'speech']);
  });

  it('aligns a target to the measurement over 500 Hz - 2 kHz', () => {
    const levels = spectrum();
    const aligned = alignTargetToBands(findTarget('flat')!, bands, levels);
    const i1k = bands.findIndex((b) => b.nominal === 1000);
    expect(aligned[i1k]).toBeCloseTo(-40, 6);
  });

  it('keeps the live curve tilted downwards', () => {
    const levels = spectrum();
    const aligned = alignTargetToBands(findTarget('live')!, bands, levels);
    const at = (hz: number) => aligned[bands.findIndex((b) => b.nominal === hz)];
    expect(at(63)).toBeGreaterThan(at(1000));
    expect(at(1000)).toBeGreaterThan(at(8000));
  });
});

describe('SuggestionStabilizer', () => {
  const make = (gain: number) =>
    generateSuggestions(input(spectrum({ 250: gain - 2, 315: gain, 400: gain - 2 })));

  it('publishes the first set immediately', () => {
    const st = new SuggestionStabilizer(2500);
    expect(st.update(make(6), 0).length).toBe(1);
  });

  it('holds the current set until the interval has passed', () => {
    const st = new SuggestionStabilizer(2500);
    st.update(make(6), 0);
    const held = st.update(make(12), 1000);
    expect(held[0].gainDb).toBeCloseTo(-4, 0);
  });

  it('ignores changes too small to matter', () => {
    const st = new SuggestionStabilizer(2500, 1.0);
    st.update(make(6), 0);
    const after = st.update(make(6.5), 5000);
    expect(after[0].gainDb).toBeCloseTo(-4, 0);
  });

  it('adopts a genuinely different picture after the interval', () => {
    const st = new SuggestionStabilizer(2500, 1.0);
    st.update(make(6), 0);
    const after = st.update(make(12), 5000);
    expect(after[0].gainDb).toBe(-6);
  });
});
