// Minimal PNG encoder shared by make-icons and make-paper (no dependencies).

import { deflateSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function header(w, h, depth, colorType) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  return chunk('IHDR', ihdr);
}

// rows: raw scanlines without filter bytes, each `stride` bytes long.
function image(rows, stride, h) {
  const out = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) rows.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return chunk('IDAT', deflateSync(out, { level: 9 }));
}

// 8-bit RGBA.
export function pngRGBA(w, h, rgba) {
  return Buffer.concat([SIGNATURE, header(w, h, 8, 6), image(rgba, w * 4, h), chunk('IEND', Buffer.alloc(0))]);
}

// 4-bit palette image: `palette` is [[r,g,b,a], ...] (up to 16), `indices` one byte per pixel.
export function pngPalette4(w, h, palette, indices) {
  const stride = Math.ceil(w / 2);
  const rows = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = indices[y * w + x] & 0x0f;
      rows[y * stride + (x >> 1)] |= x & 1 ? v : v << 4;
    }
  }
  const plte = Buffer.from(palette.flatMap(([r, g, b]) => [r, g, b]));
  const trns = Buffer.from(palette.map((c) => c[3] ?? 255));
  return Buffer.concat([SIGNATURE, header(w, h, 4, 3), chunk('PLTE', plte), chunk('tRNS', trns), image(rows, stride, h), chunk('IEND', Buffer.alloc(0))]);
}
