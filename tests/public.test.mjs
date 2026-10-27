// Guards what gets deployed: public/ must never contain the card text in the clear,
// the PDFs, or the table word, and the offline cache must list every served file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const served = walk(PUBLIC);
const rel = (f) => relative(PUBLIC, f).split(sep).join('/');
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

test('no PDFs or plaintext card files are served', () => {
  for (const f of served) {
    assert.ok(!/\.pdf$/i.test(f), `${rel(f)} is a PDF`);
    assert.ok(!/cards\.json$/.test(f), `${rel(f)} looks like the plaintext deck`);
  }
});

test('no served file contains a question or the table word', { skip: !existsSync(join(ROOT, 'local', 'cards.json')) && 'run npm run cards first' }, () => {
  const deck = JSON.parse(readFileSync(join(ROOT, 'local', 'cards.json'), 'utf8'));
  const needles = deck.decks.flatMap((d) => [d.intro, d.tip, ...d.cards.map((c) => c.text)])
    .map((t) => squash(t).slice(0, 40))
    .filter((t) => t.length >= 25);
  const wordFile = join(ROOT, 'local', 'table-word.txt');
  const word = existsSync(wordFile) ? squash(readFileSync(wordFile, 'utf8').split('\n')[0]) : '';
  for (const f of served) {
    const body = squash(readFileSync(f, 'latin1'));
    for (const n of needles) assert.ok(!body.includes(n), `${rel(f)} contains card text`);
    if (word.length >= 6) assert.ok(!body.includes(word), `${rel(f)} contains the table word`);
  }
});

const DECK = join(PUBLIC, 'cards.enc.json');

test('the encrypted deck is present and well formed', { skip: !existsSync(DECK) && 'no deck yet: run npm run cards' }, () => {
  const env = JSON.parse(readFileSync(DECK, 'utf8'));
  assert.equal(env.v, 1);
  assert.equal(env.alg, 'AES-GCM');
  assert.ok(env.iter >= 600000);
  for (const k of ['salt', 'iv', 'ct']) assert.equal(typeof env[k], 'string');
});

test('sw.js pre-caches exactly the served files', () => {
  const sw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');
  const files = JSON.parse(sw.match(/const FILES = (\[.*\]);/)[1]);
  // The deck is git-ignored, so a fresh clone won't have it yet; it is always pre-cached.
  const names = new Set([...served.map(rel), 'cards.enc.json']);
  const expected = ['./', ...[...names].filter((f) => f !== 'sw.js' && !f.split('/').some((p) => p.startsWith('.'))).sort()];
  assert.deepEqual(files, expected, 'run npm run stamp');
});
