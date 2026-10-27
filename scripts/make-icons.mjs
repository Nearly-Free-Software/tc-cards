#!/usr/bin/env node
// Draws the app icon (two cards on a candlelit background) with no dependencies:
// a tiny rasteriser with 4×4 supersampling and a minimal PNG encoder. Also writes icon.svg.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const BG = [0x17, 0x12, 0x0e];
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// Shapes in unit space (0..1), drawn back to front.
const SHAPES = [
  { cx: 0.43, cy: 0.5, w: 0.4, h: 0.56, r: 0.05, rot: -12, color: [0x6b, 0x54, 0x40] },
  { cx: 0.56, cy: 0.51, w: 0.4, h: 0.56, r: 0.05, rot: 7, color: [0xf2, 0xe6, 0xd3] },
  { parent: 1, cx: 0, cy: -0.09, w: 0.25, h: 0.035, r: 0.0175, color: [0xb9, 0xa5, 0x8a] },
  { parent: 1, cx: -0.035, cy: -0.02, w: 0.18, h: 0.035, r: 0.0175, color: [0xb9, 0xa5, 0x8a] },
];

function place(shape) {
  if (shape.parent === undefined) return shape;
  const p = SHAPES[shape.parent];
  const a = (p.rot * Math.PI) / 180;
  return {
    ...shape,
    cx: p.cx + shape.cx * Math.cos(a) - shape.cy * Math.sin(a),
    cy: p.cy + shape.cx * Math.sin(a) + shape.cy * Math.cos(a),
    rot: p.rot,
  };
}
const placed = SHAPES.map(place);

function inside(s, x, y) {
  const a = (-s.rot * Math.PI) / 180;
  const dx = x - s.cx, dy = y - s.cy;
  const px = Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) - (s.w / 2 - s.r);
  const py = Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) - (s.h / 2 - s.r);
  return Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - s.r < 0;
}

function render(size, scale) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Map into unit space, shrinking the artwork toward the centre by `scale`.
          const u = ((x + (sx + 0.5) / SS) / size - 0.5) / scale + 0.5;
          const v = ((y + (sy + 0.5) / SS) / size - 0.5) / scale + 0.5;
          let c = BG;
          for (const s of placed) if (inside(s, u, v)) c = s.color;
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
        }
      }
      const i = (y * size + x) * 4;
      px[i] = Math.round(acc[0] / (SS * SS));
      px[i + 1] = Math.round(acc[1] / (SS * SS));
      px[i + 2] = Math.round(acc[2] / (SS * SS));
      px[i + 3] = 255;
    }
  }
  return png(size, size, px);
}

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
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = {
  'icon-192.png': render(192, 1),
  'icon-512.png': render(512, 1),
  'maskable-512.png': render(512, 0.78), // keep the cards inside the maskable safe circle
  'apple-touch-icon.png': render(180, 1),
};
for (const [name, data] of Object.entries(files)) writeFileSync(join(OUT, name), data);

const rect = (s) => {
  return `<rect x="${((s.cx - s.w / 2) * 100).toFixed(2)}" y="${((s.cy - s.h / 2) * 100).toFixed(2)}" width="${(s.w * 100).toFixed(2)}" height="${(s.h * 100).toFixed(2)}" rx="${(s.r * 100).toFixed(2)}" fill="${hex(s.color)}" transform="rotate(${s.rot} ${(s.cx * 100).toFixed(2)} ${(s.cy * 100).toFixed(2)})"/>`;
};
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${hex(BG)}"/>${placed.map(rect).join('')}</svg>\n`;
writeFileSync(join(OUT, 'icon.svg'), svg);

console.log(`• Wrote ${Object.keys(files).length + 1} icons to public/icons`);
