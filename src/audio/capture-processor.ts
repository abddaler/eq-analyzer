/**
 * Source of the AudioWorklet processor.
 *
 * It is shipped as a string and loaded from a blob URL rather than as a
 * separate bundle entry: the worklet runs in its own realm with no module
 * graph, and a blob keeps it working offline in the installed PWA without any
 * extra build configuration.
 *
 * SharedArrayBuffer would avoid the copy, but it needs cross-origin isolation
 * (COOP/COEP) which we cannot rely on for a statically hosted PWA, so blocks
 * are batched and posted instead - about 47 messages/s at 48 kHz.
 */
export const CAPTURE_PROCESSOR_NAME = 'eq-scope-capture';

export const CAPTURE_PROCESSOR_SOURCE = /* js */ `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.blockSize = opts.blockSize || 1024;
    this.channelCount = opts.channelCount || 1;
    this.buffers = [];
    for (let c = 0; c < this.channelCount; c++) {
      this.buffers.push(new Float32Array(this.blockSize));
    }
    this.filled = 0;
    this.peak = 0;
    this.clipped = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < this.channelCount; c++) {
        const src = input[c] || input[0];
        const v = src[i];
        this.buffers[c][this.filled] = v;
        if (c === 0) {
          const a = v < 0 ? -v : v;
          if (a > this.peak) this.peak = a;
          // Digital clipping: full scale reached at the converter.
          if (a >= 0.999) this.clipped++;
        }
      }
      this.filled++;
      if (this.filled === this.blockSize) {
        const copies = this.buffers.map((b) => b.slice());
        this.port.postMessage(
          { channels: copies, peak: this.peak, clipped: this.clipped },
          copies.map((b) => b.buffer),
        );
        this.peak = 0;
        this.clipped = 0;
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor(${JSON.stringify(CAPTURE_PROCESSOR_NAME)}, CaptureProcessor);
`;

let cachedUrl: string | null = null;

export function captureProcessorUrl(): string {
  if (!cachedUrl) {
    cachedUrl = URL.createObjectURL(
      new Blob([CAPTURE_PROCESSOR_SOURCE], { type: 'application/javascript' }),
    );
  }
  return cachedUrl;
}
