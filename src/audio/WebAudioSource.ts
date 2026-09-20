import {
  NO_PROCESSING_REQUEST,
  type AudioDeviceOption,
  type AudioSource,
  type AudioSourceInfo,
  type AudioSourceOptions,
  type CaptureStats,
  type ProcessingFlags,
} from './AudioSource';
import { RingBuffer } from './RingBuffer';
import { CAPTURE_PROCESSOR_NAME, captureProcessorUrl } from './capture-processor';

function readFlags(settings: MediaTrackSettings): ProcessingFlags {
  const get = (key: keyof MediaTrackSettings): boolean | null => {
    const v = settings[key];
    return typeof v === 'boolean' ? v : null;
  };
  const ec = get('echoCancellation');
  const ns = get('noiseSuppression');
  const agc = get('autoGainControl');
  const known = [ec, ns, agc].filter((v): v is boolean => v !== null);
  return {
    echoCancellation: ec,
    noiseSuppression: ns,
    autoGainControl: agc,
    allDisabled: known.length === 0 ? null : known.every((v) => v === false),
  };
}

/**
 * getUserMedia + AudioWorklet capture.
 *
 * AnalyserNode is deliberately not used: it hides the window, the overlap and
 * the averaging, all of which we need to control to make a measurement mean
 * anything. This class only moves samples; every level decision happens in /dsp.
 */
export class WebAudioSource implements AudioSource {
  readonly backend = 'web-audio';
  buffer: RingBuffer | null = null;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private info: AudioSourceInfo | null = null;
  private stats: CaptureStats = { peak: 0, clipped: 0 };

  get sampleRate(): number {
    return this.context?.sampleRate ?? 0;
  }

  get running(): boolean {
    return this.node !== null;
  }

  getInfo(): AudioSourceInfo | null {
    return this.info;
  }

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof AudioWorkletNode !== 'undefined'
    );
  }

  async listDevices(): Promise<AudioDeviceOption[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        // Labels stay empty until permission is granted at least once.
        label: d.label || `Вход ${i + 1}`,
        kind: d.kind,
      }));
  }

  async start(options: AudioSourceOptions = {}): Promise<AudioSourceInfo> {
    await this.stop();
    const channelCount = options.channelCount ?? 1;

    const audio: MediaTrackConstraints = {
      ...NO_PROCESSING_REQUEST,
      channelCount: { ideal: channelCount },
    };
    if (options.deviceId) audio.deviceId = { exact: options.deviceId };

    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();

    // Never assume 48 kHz: the context follows the hardware, and the DSP is
    // built entirely from context.sampleRate.
    const context = new AudioContext({ latencyHint: 'interactive' });
    this.context = context;
    if (context.state === 'suspended') await context.resume();

    await context.audioWorklet.addModule(captureProcessorUrl());

    const actualChannels = Math.max(1, Math.min(channelCount, settings.channelCount ?? channelCount));
    this.buffer = new RingBuffer(
      Math.ceil(context.sampleRate * (options.bufferSeconds ?? 4)),
      actualChannels,
    );

    const node = new AudioWorkletNode(context, CAPTURE_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: actualChannels,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      processorOptions: { blockSize: 1024, channelCount: actualChannels },
    });
    node.port.onmessage = (event) => {
      const { channels, peak, clipped } = event.data as {
        channels: Float32Array[];
        peak: number;
        clipped: number;
      };
      this.buffer?.write(channels);
      if (peak > this.stats.peak) this.stats.peak = peak;
      this.stats.clipped += clipped;
    };
    this.node = node;

    this.sourceNode = context.createMediaStreamSource(stream);
    this.sourceNode.connect(node);

    const requested = readFlags(NO_PROCESSING_REQUEST as MediaTrackSettings);
    this.info = {
      sampleRate: context.sampleRate,
      channelCount: actualChannels,
      deviceId: settings.deviceId ?? options.deviceId ?? '',
      label: track.label || 'Микрофон',
      applied: readFlags(settings),
      requested: { ...requested, allDisabled: true },
      settings: settings as unknown as Record<string, unknown>,
      backend: this.backend,
      latencyHint: context.baseLatency,
    };
    return this.info;
  }

  async stop(): Promise<void> {
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = null;
    }
    this.buffer = null;
    this.info = null;
    this.stats = { peak: 0, clipped: 0 };
  }

  takeStats(): CaptureStats {
    const out = this.stats;
    this.stats = { peak: 0, clipped: 0 };
    return out;
  }
}
