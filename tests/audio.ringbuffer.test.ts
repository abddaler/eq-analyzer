import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/audio/RingBuffer';
import { encodeWav } from '../src/audio/wav';

describe('RingBuffer', () => {
  it('reads back what was written at absolute positions', () => {
    const rb = new RingBuffer(16);
    rb.write([Float32Array.from([1, 2, 3, 4, 5])]);
    const out = new Float32Array(3);
    expect(rb.read(1, out)).toBe(true);
    expect(Array.from(out)).toEqual([2, 3, 4]);
    expect(rb.written).toBe(5);
  });

  it('refuses ranges that are not yet written or already overwritten', () => {
    const rb = new RingBuffer(8);
    rb.write([Float32Array.from([1, 2, 3, 4])]);
    const out = new Float32Array(4);
    expect(rb.read(2, out)).toBe(false); // runs past the end
    rb.write([new Float32Array(10)]);
    expect(rb.oldest).toBe(6);
    expect(rb.read(0, out)).toBe(false); // already overwritten
    expect(rb.read(10, out)).toBe(true);
  });

  it('wraps without losing samples and keeps readLatest aligned', () => {
    const rb = new RingBuffer(10);
    for (let block = 0; block < 5; block++) {
      const chunk = new Float32Array(4);
      for (let i = 0; i < 4; i++) chunk[i] = block * 4 + i;
      rb.write([chunk]);
    }
    expect(rb.written).toBe(20);
    const out = new Float32Array(4);
    expect(rb.readLatest(out)).toBe(true);
    expect(Array.from(out)).toEqual([16, 17, 18, 19]);
  });

  it('keeps channels separate', () => {
    const rb = new RingBuffer(8, 2);
    rb.write([Float32Array.from([1, 2]), Float32Array.from([-1, -2])]);
    const a = new Float32Array(2);
    const b = new Float32Array(2);
    rb.read(0, a, 0);
    rb.read(0, b, 1);
    expect(Array.from(a)).toEqual([1, 2]);
    expect(Array.from(b)).toEqual([-1, -2]);
  });
});

describe('wav encoder', () => {
  it('writes a valid 16-bit mono header', async () => {
    const blob = encodeWav([Float32Array.from([0, 0.5, -0.5, 1])], 48000, 16);
    const view = new DataView(await blob.arrayBuffer());
    const tag = (o: number) =>
      String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44 + 2, true)).toBe(Math.round(0.5 * 32767));
  });
});
