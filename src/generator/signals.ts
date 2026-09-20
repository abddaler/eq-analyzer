/**
 * Test signal generator.
 *
 * Meant to be fed into the console over a cable or a USB interface. The
 * phone's own speaker is useless for checking a PA - it is tiny, directional
 * and nowhere near flat - and the UI says so.
 */

export type SignalType = 'pink' | 'white' | 'sine' | 'sweep';

export const SIGNAL_TYPES: SignalType[] = ['pink', 'white', 'sine', 'sweep'];

/**
 * Paul Kellet's refined pink-noise filter: white noise shaped to -3 dB per
 * octave, accurate to a fraction of a dB across the audio band and cheap
 * enough to run per sample in an AudioWorklet.
 */
export class PinkNoise {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;

  next(white: number): number {
    this.b0 = 0.99886 * this.b0 + white * 0.0555179;
    this.b1 = 0.99332 * this.b1 + white * 0.0750759;
    this.b2 = 0.969 * this.b2 + white * 0.153852;
    this.b3 = 0.8665 * this.b3 + white * 0.3104856;
    this.b4 = 0.55 * this.b4 + white * 0.5329522;
    this.b5 = -0.7616 * this.b5 - white * 0.016898;
    const out = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5362;
    this.b6 = white * 0.115926;
    // The filter's output is roughly 3x the input amplitude; scale it back so
    // the level control means the same thing for every signal type.
    return out * 0.11;
  }

  reset(): void {
    this.b0 = this.b1 = this.b2 = this.b3 = this.b4 = this.b5 = this.b6 = 0;
  }
}

export function fillWhiteNoise(out: Float32Array, amplitude: number): void {
  for (let i = 0; i < out.length; i++) out[i] = (Math.random() * 2 - 1) * amplitude;
}

export function fillPinkNoise(out: Float32Array, amplitude: number, state: PinkNoise): void {
  for (let i = 0; i < out.length; i++) {
    out[i] = state.next(Math.random() * 2 - 1) * amplitude;
  }
}

/** Continuous sine; returns the phase to carry into the next block. */
export function fillSine(
  out: Float32Array,
  amplitude: number,
  frequency: number,
  sampleRate: number,
  phase: number,
): number {
  const step = (2 * Math.PI * frequency) / sampleRate;
  let p = phase;
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.sin(p) * amplitude;
    p += step;
    if (p > 2 * Math.PI) p -= 2 * Math.PI;
  }
  return p;
}

/**
 * Logarithmic sweep. `position` runs 0..1 over the sweep; the caller advances
 * it so the sweep can be restarted or paused without glitching.
 */
export function fillSweep(
  out: Float32Array,
  amplitude: number,
  fromHz: number,
  toHz: number,
  seconds: number,
  sampleRate: number,
  state: { position: number; phase: number },
): void {
  const ratio = Math.log(toHz / fromHz);
  const total = Math.max(1, seconds * sampleRate);
  for (let i = 0; i < out.length; i++) {
    const f = fromHz * Math.exp(ratio * state.position);
    out[i] = Math.sin(state.phase) * amplitude;
    state.phase += (2 * Math.PI * f) / sampleRate;
    if (state.phase > 2 * Math.PI) state.phase -= 2 * Math.PI;
    state.position += 1 / total;
    if (state.position >= 1) state.position = 0;
  }
}
