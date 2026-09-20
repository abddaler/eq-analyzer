import { PinkNoise, fillPinkNoise, fillSweep, fillWhiteNoise, type SignalType } from './signals';

export interface GeneratorOptions {
  levelDb: number;
  frequencyHz: number;
  sweepSeconds: number;
  sweepFromHz: number;
  sweepToHz: number;
}

export const DEFAULT_GENERATOR: GeneratorOptions = {
  levelDb: -20,
  frequencyHz: 1000,
  sweepSeconds: 10,
  sweepFromHz: 20,
  sweepToHz: 20000,
};

/** Seconds of noise rendered and looped; long enough not to sound periodic. */
const NOISE_SECONDS = 10;

/**
 * Plays a test signal out of the phone's audio output.
 *
 * Noise and sweeps are pre-rendered into a looping buffer rather than
 * generated in a worklet: the same DSP is then shared with the unit tests,
 * and one fewer worklet has to survive iOS's audio session changes.
 */
export class SignalPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | OscillatorNode | null = null;
  private currentType: SignalType | null = null;

  get playing(): boolean {
    return this.source !== null;
  }

  get type(): SignalType | null {
    return this.currentType;
  }

  async start(type: SignalType, options: GeneratorOptions): Promise<void> {
    this.stop();
    const context = this.context ?? new AudioContext();
    this.context = context;
    if (context.state === 'suspended') await context.resume();

    const gain = context.createGain();
    gain.gain.value = Math.pow(10, options.levelDb / 20);
    gain.connect(context.destination);
    this.gain = gain;

    if (type === 'sine') {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = options.frequencyHz;
      osc.connect(gain);
      osc.start();
      this.source = osc;
    } else {
      const seconds = type === 'sweep' ? options.sweepSeconds : NOISE_SECONDS;
      const length = Math.max(1, Math.floor(seconds * context.sampleRate));
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      if (type === 'pink') fillPinkNoise(data, 1, new PinkNoise());
      else if (type === 'white') fillWhiteNoise(data, 1);
      else {
        fillSweep(data, 1, options.sweepFromHz, options.sweepToHz, seconds, context.sampleRate, {
          position: 0,
          phase: 0,
        });
      }
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.loop = true;
      node.connect(gain);
      node.start();
      this.source = node;
    }
    this.currentType = type;
  }

  setLevel(levelDb: number): void {
    if (this.gain && this.context) {
      // Ramp instead of stepping: a jump in gain is a click through the PA.
      this.gain.gain.setTargetAtTime(Math.pow(10, levelDb / 20), this.context.currentTime, 0.02);
    }
  }

  setFrequency(hz: number): void {
    const osc = this.source;
    if (osc && 'frequency' in osc && this.context) {
      osc.frequency.setTargetAtTime(hz, this.context.currentTime, 0.02);
    }
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // Already stopped.
      }
      this.source.disconnect();
      this.source = null;
    }
    this.gain?.disconnect();
    this.gain = null;
    this.currentType = null;
  }

  async dispose(): Promise<void> {
    this.stop();
    await this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
