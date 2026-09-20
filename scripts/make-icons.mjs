/**
 * Generate the PWA icons as real PNGs.
 *
 * Written by hand with zlib rather than pulled from an image library: it is a
 * handful of lines, runs anywhere, and keeps the dependency list empty.
 * Run with `node scripts/make-icons.mjs` after changing the artwork.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [0x0b, 0x0d, 0x10];
const FG = [0x4e, 0xa8, 0xff];
const BARS = [
  [0.14, 0.53],
  [0.30, 0.37],
  [0.45, 0.22],
  [0.61, 0.42],
  [0.77, 0.59],
];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function icon(size, { maskable = false } = {}) {
  const radius = maskable ? 0 : size * 0.22;
  const inset = maskable ? size * 0.1 : 0; // safe zone for maskable icons
  const px = Buffer.alloc(size * size * 3);
  const rows = Buffer.alloc(size * (size * 3 + 1));

  const inRounded = (x, y) => {
    if (radius === 0) return true;
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = BG;
      if (!inRounded(x + 0.5, y + 0.5)) {
        // Outside the rounded square: transparent is not supported by this
        // minimal writer, so match the background.
        color = BG;
      } else {
        const u = (x - inset) / (size - 2 * inset);
        const v = (y - inset) / (size - 2 * inset);
        for (const [left, top] of BARS) {
          if (u >= left && u <= left + 0.09 && v >= top && v <= 0.8) color = FG;
        }
      }
      const o = (y * size + x) * 3;
      px[o] = color[0];
      px[o + 1] = color[1];
      px[o + 2] = color[2];
    }
    rows[y * (size * 3 + 1)] = 0; // filter: none
    px.copy(rows, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('public/icon-192.png', icon(192));
writeFileSync('public/icon-512.png', icon(512));
writeFileSync('public/icon-maskable-512.png', icon(512, { maskable: true }));
writeFileSync('public/apple-touch-icon.png', icon(180));
console.log('icons written');
