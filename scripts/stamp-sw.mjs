#!/usr/bin/env node
// Rewrites the <stamp> block in public/sw.js: the list of files to pre-cache and a
// VERSION hashed from their contents. Any change to a served file gives a new version,
// which is what makes installed phones pick up the update.
//   npm run stamp           update sw.js
//   npm run stamp -- --check  exit 1 if sw.js is out of date (run before deploying)

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SW = join(PUBLIC, 'sw.js');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}

const files = walk(PUBLIC)
  .map((f) => relative(PUBLIC, f).split(sep).join('/'))
  .filter((f) => f !== 'sw.js' && !f.split('/').some((part) => part.startsWith('.')))
  .sort();

const hash = createHash('sha256');
for (const f of files) hash.update(f).update('\0').update(readFileSync(join(PUBLIC, f))).update('\0');
const version = `tc-cards-${hash.digest('hex').slice(0, 10)}`;

const block = `// <stamp>\nconst VERSION = '${version}';\nconst FILES = ${JSON.stringify(['./', ...files])};\n// </stamp>`;
const sw = readFileSync(SW, 'utf8');
const updated = sw.replace(/\/\/ <stamp>[\s\S]*?\/\/ <\/stamp>/, block);
if (updated === sw && !sw.includes(block)) {
  console.error('✗ Could not find the <stamp> block in public/sw.js');
  process.exit(1);
}

if (process.argv.includes('--check')) {
  if (updated !== sw) {
    console.error('✗ public/sw.js is out of date. Run: npm run stamp');
    process.exit(1);
  }
  console.log(`✓ sw.js is current (${version}, ${files.length} files)`);
} else {
  writeFileSync(SW, updated);
  console.log(`• Stamped sw.js: ${version}, ${files.length} files`);
}
