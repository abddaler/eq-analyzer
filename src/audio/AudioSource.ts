import type { RingBuffer } from './RingBuffer';

export interface ProcessingFlags {
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  /** True when every flag we could read is off. Null means the platform hid it. */
  allDisabled: boolean | null;
}

export interface AudioSourceInfo {
  sampleRate: number;
  channelCount: number;
  deviceId: string;
  label: string;
  /** What the platform actually applied, not what we asked for. */
  applied: ProcessingFlags;
  requested: ProcessingFlags;
  /** Raw MediaTrackSettings, shown verbatim on the diagnostics screen. */
  settings: Record<string, unknown>;
  /** Implementation name, e.g. "web-audio" or "native-android". */
  backend: string;
  latencyHint?: number;
}

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
  kind: string;
}

export interface AudioSourceOptions {
  deviceId?: string;
  /** Requested channels; the source may deliver fewer. */
  channelCount?: number;
  /** Seconds of history the ring buffer keeps. */
  bufferSeconds?: number;
}

export interface CaptureStats {
  /** Peak sample magnitude since the last read, channel 0. */
  peak: number;
  /** Count of samples at digital full scale since the last read. */
  clipped: number;
}

/**
 * Everything above this interface is platform independent. The web
 * implementation lives in WebAudioSource; a Capacitor plugin backend can be
 * dropped in behind the same shape without touching the DSP or the UI.
 */
export interface AudioSource {
  readonly backend: string;
  readonly buffer: RingBuffer | null;
  readonly sampleRate: number;
  readonly running: boolean;
  start(options?: AudioSourceOptions): Promise<AudioSourceInfo>;
  stop(): Promise<void>;
  getInfo(): AudioSourceInfo | null;
  listDevices(): Promise<AudioDeviceOption[]>;
  /** Peak/clip counters since the previous call. */
  takeStats(): CaptureStats;
}

export const NO_PROCESSING_REQUEST = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
} as const;
