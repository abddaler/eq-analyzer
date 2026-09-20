/**
 * Averagers operate on linear power, never on decibels: averaging dB values
 * is a different (and wrong) quantity, and it is the classic way to make an
 * analyser read low on anything that is not a steady tone.
 */

export interface Averager {
  readonly length: number;
  push(frame: ArrayLike<number>, dt: number): void;
  readonly value: Float64Array;
  reset(): void;
  /** Seconds of signal currently represented, for the confidence readout. */
  readonly elapsed: number;
}

/** Exponential (running) average - "Fast" 125 ms and "Slow" 1 s. */
export class ExponentialAverager implements Averager {
  readonly value: Float64Array;
  elapsed = 0;
  private primed = false;

  readonly length: number;
  tau: number;

  constructor(length: number, tau: number) {
    this.length = length;
    this.tau = tau;
    this.value = new Float64Array(length);
  }

  push(frame: ArrayLike<number>, dt: number): void {
    if (!this.primed) {
      for (let i = 0; i < this.length; i++) this.value[i] = frame[i];
      this.primed = true;
      this.elapsed = dt;
      return;
    }
    const a = 1 - Math.exp(-dt / Math.max(this.tau, 1e-6));
    for (let i = 0; i < this.length; i++) {
      this.value[i] += a * (frame[i] - this.value[i]);
    }
    this.elapsed = Math.min(this.elapsed + dt, this.tau * 5);
  }

  reset(): void {
    this.value.fill(0);
    this.primed = false;
    this.elapsed = 0;
  }
}

/** Unbounded linear average with an explicit reset - the "infinite" mode. */
export class LinearAverager implements Averager {
  readonly value: Float64Array;
  private sum: Float64Array;
  private count = 0;
  elapsed = 0;

  readonly length: number;

  constructor(length: number) {
    this.length = length;
    this.value = new Float64Array(length);
    this.sum = new Float64Array(length);
  }

  get frames(): number {
    return this.count;
  }

  push(frame: ArrayLike<number>, dt: number): void {
    this.count++;
    this.elapsed += dt;
    for (let i = 0; i < this.length; i++) {
      this.sum[i] += frame[i];
      this.value[i] = this.sum[i] / this.count;
    }
  }

  reset(): void {
    this.sum.fill(0);
    this.value.fill(0);
    this.count = 0;
    this.elapsed = 0;
  }
}

/**
 * Sliding window average over a fixed number of frames.
 *
 * This is what the mix suggestions are built on: music moves constantly, and a
 * decision about the balance has to be made over 10-60 seconds, not over one
 * frame. The window is a true boxcar, so old material leaves the average
 * completely instead of trailing off exponentially.
 */
export class SlidingAverager implements Averager {
  readonly value: Float64Array;
  private readonly frames: Float64Array;
  private readonly sum: Float64Array;
  private readonly capacity: number;
  private write = 0;
  private filled = 0;
  elapsed = 0;

  readonly length: number;
  private readonly frameSeconds: number;

  constructor(length: number, capacityFrames: number, frameSeconds: number) {
    this.length = length;
    this.frameSeconds = frameSeconds;
    this.capacity = Math.max(1, Math.floor(capacityFrames));
    this.value = new Float64Array(length);
    this.sum = new Float64Array(length);
    this.frames = new Float64Array(this.capacity * length);
  }

  get full(): boolean {
    return this.filled === this.capacity;
  }

  get fill(): number {
    return this.filled / this.capacity;
  }

  push(frame: ArrayLike<number>, dt = this.frameSeconds): void {
    const base = this.write * this.length;
    const dropping = this.filled === this.capacity;
    for (let i = 0; i < this.length; i++) {
      if (dropping) this.sum[i] -= this.frames[base + i];
      this.frames[base + i] = frame[i];
      this.sum[i] += frame[i];
    }
    this.write = (this.write + 1) % this.capacity;
    if (!dropping) this.filled++;
    for (let i = 0; i < this.length; i++) this.value[i] = this.sum[i] / this.filled;
    this.elapsed = Math.min(this.elapsed + dt, this.capacity * this.frameSeconds);
  }

  reset(): void {
    this.frames.fill(0);
    this.sum.fill(0);
    this.value.fill(0);
    this.write = 0;
    this.filled = 0;
    this.elapsed = 0;
  }
}

/** Peak hold with a configurable decay, in dB per second. */
export class PeakHold {
  readonly value: Float64Array;

  readonly length: number;
  decayDbPerSecond: number;

  constructor(length: number, decayDbPerSecond = 12) {
    this.length = length;
    this.decayDbPerSecond = decayDbPerSecond;
    this.value = new Float64Array(length);
  }

  push(frame: ArrayLike<number>, dt: number): void {
    const factor = Math.pow(10, (-this.decayDbPerSecond * dt) / 10);
    for (let i = 0; i < this.length; i++) {
      const decayed = this.value[i] * factor;
      this.value[i] = frame[i] > decayed ? frame[i] : decayed;
    }
  }

  reset(): void {
    this.value.fill(0);
  }
}

export const TIME_CONSTANTS = { fast: 0.125, slow: 1.0 } as const;
