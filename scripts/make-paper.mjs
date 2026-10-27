#!/usr/bin/env node
// Writes the paper assets in public/paper/: two tiling grain textures (card stock and
// table) and the printed card backs for each pile. Seeded, so the output never changes
// unless this script does (which keeps the offline cache version stable).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngPalette4 } from './png.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'paper');
mkdirSync(OUT, { recursive: true });

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Per-pixel specks, each slightly lighter or darker than whatever is underneath, so one
// tile works on both themes. Index 0 is clear; 1-7 warm light; 8-14 near-black.
function grain(seed, maxAlpha, size = 128) {
  const rnd = mulberry32(seed);
  const palette = [[0, 0, 0, 0]];
  for (let i = 1; i <= 7; i++) palette.push([255, 246, 232, Math.round((maxAlpha * i) / 7)]);
  for (let i = 1; i <= 7; i++) palette.push([20, 12, 6, Math.round((maxAlpha * i) / 7)]);
  const idx = new Uint8Array(size * size);
  for (let p = 0; p < idx.length; p++) {
    const light = rnd() < 0.5;
    const level = Math.floor(rnd() ** 1.6 * 8);
    idx[p] = level === 0 ? 0 : light ? level : 7 + level;
  }
  return pngPalette4(size, size, palette, idx);
}

const FRAME = '<rect x="14" y="14" width="222" height="322" rx="10" fill="none" stroke="#fff3e2" stroke-opacity=".22" stroke-width="1.5"/>'
  + '<rect x="20" y="20" width="210" height="310" rx="7" fill="none" stroke="#fff3e2" stroke-opacity=".12" stroke-width="1"/>';
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" preserveAspectRatio="xMidYMid slice">${body}${FRAME}</svg>\n`;

// Start Small: a fine diamond lattice. Go Deeper: concentric rings. Both are symmetric,
// so a back seen mid-flip (mirrored) still looks right. Colour comes from CSS.
const backSS = svg(
  '<defs><pattern id="p" width="14" height="14" patternUnits="userSpaceOnUse">'
  + '<path d="M7 0L14 7L7 14L0 7Z" fill="none" stroke="#fff3e2" stroke-opacity=".09"/>'
  + '<circle cx="7" cy="7" r="1.1" fill="#fff3e2" fill-opacity=".10"/></pattern></defs>'
  + '<rect x="14" y="14" width="222" height="322" rx="10" fill="url(#p)"/>',
);
const rings = Array.from({ length: 16 }, (_, k) => `<circle cx="125" cy="175" r="${18 + 12 * k}"/>`).join('');
const backGD = svg(
  '<defs><clipPath id="c"><rect x="14" y="14" width="222" height="322" rx="10"/></clipPath></defs>'
  + `<g clip-path="url(#c)" fill="none" stroke="#fff3e2" stroke-opacity=".09" stroke-width="1.2">${rings}</g>`,
);

const files = {
  'grain-card.png': grain(7, 22),
  'grain-table.png': grain(11, 14),
  'back-ss.svg': backSS,
  'back-gd.svg': backGD,
};
for (const [name, data] of Object.entries(files)) writeFileSync(join(OUT, name), data);
console.log(`• Wrote ${Object.keys(files).length} files to public/paper`);
