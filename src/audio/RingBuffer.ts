/**
 * Multi-channel ring buffer addressed by absolute sample position.
 *
 * The analysis loop needs to step through the stream at a fixed hop (for 50-75%
 * overlap) rather than just grabbing "the latest N samples" whenever a frame is
 * painted, so reads are keyed on an absolute index and report when the data has
 * already been overwritten.
 */
export class RingBuffer {
  readonly capacity: number;
  readonly channelCount: number;
  private readonly data: Float32Array[];
  private writePos = 0;
  private total = 0;

  constructor(capacity: number, channelCount = 1) {
    this.capacity = capacity;
    this.channelCount = channelCount;
    this.data = Array.from({ length: channelCount }, () => new Float32Array(capacity));
  }

  /** Absolute number of frames written since the buffer was created. */
  get written(): number {
    return this.total;
  }

  clear(): void {
    for (const ch of this.data) ch.fill(0);
    this.writePos = 0;
    this.total = 0;
  }

  /** Append one block; `chunks[c]` holds the samples for channel c. */
  write(chunks: ArrayLike<number>[]): void {
    const n = chunks[0]?.length ?? 0;
    if (n === 0) return;
    let pos = this.writePos;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < this.channelCount; c++) {
        const src = chunks[c] ?? chunks[0];
        this.data[c][pos] = src[i];
      }
      pos = pos + 1 === this.capacity ? 0 : pos + 1;
    }
    this.writePos = pos;
    this.total += n;
  }

  /** Oldest absolute position still held in the buffer. */
  get oldest(): number {
    return Math.max(0, this.total - this.capacity);
  }

  /**
   * Copy `out.length` samples starting at absolute position `start`.
   * Returns false when that range has been overwritten or is not yet written.
   */
  read(start: number, out: Float32Array, channel = 0): boolean {
    const n = out.length;
    if (start < this.oldest || start + n > this.total) return false;
    const src = this.data[Math.min(channel, this.channelCount - 1)];
    let pos = (start % this.capacity + this.capacity) % this.capacity;
    for (let i = 0; i < n; i++) {
      out[i] = src[pos];
      pos = pos + 1 === this.capacity ? 0 : pos + 1;
    }
    return true;
  }

  /** Copy the most recent `out.length` samples; false if not enough data yet. */
  readLatest(out: Float32Array, channel = 0): boolean {
    return this.read(this.total - out.length, out, channel);
  }
}
