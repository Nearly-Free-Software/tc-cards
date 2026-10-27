#!/usr/bin/env node
// Extracts the Table Conversations questions word for word from Practicing the Way's
// free PDF, checks them against the printable booklets, and writes:
//   local/cards.json        plaintext, never uploaded
//   public/cards.enc.json   encrypted with the table word, the only copy that is served
//
// Usage: npm run cards              (reuses the current salt if the word is unchanged)
//        npm run cards -- --rotate  (new salt; every phone must re-enter the word)
// The table word comes from $TABLE_WORD or the first line of local/table-word.txt.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITERATIONS, deriveRaw, decryptJSON, encryptJSON, fromB64, normalizeWord, randomBytes } from '../public/lock.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = join(ROOT, 'local');
const SRC = join(LOCAL, 'source');
const OUT_PLAIN = join(LOCAL, 'cards.json');
const OUT_ENC = join(ROOT, 'public', 'cards.enc.json');
const PRODUCT_URL = 'https://www.practicingtheway.org/tableconversations';

const DECKS = [
  { id: 'ss', title: 'Start Small', titlePage: 3, introPage: 4, firstPage: 5 },
  { id: 'gd', title: 'Go Deeper', titlePage: 55, introPage: 56, firstPage: 57 },
];
const PER_DECK = 50;
const PAGES = 107;

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function check(cond, msg) {
  if (!cond) fail(msg);
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : entities[e] ?? m);

// Only whitespace, ligatures and blank runs are touched; wording is never changed.
function clean(s) {
  return s
    .replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl')
    .replace(/_{2,}/g, ' ____ ')
    .replace(/\s+/g, ' ')
    .replace(/ ([?.!,])/g, '$1')
    .trim();
}

const squash = (s) => s.toLowerCase().normalize('NFKC').replace(/[^a-z0-9]/g, '');

// 1 - edit distance / length of the longer string.
function similarity(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length, 1);
}

function words(pdf, flag) {
  const xml = execFileSync('pdftotext', [flag, pdf, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return xml.split('<page ').slice(1);
}

const WORD_RE = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;

// Pages -> blocks -> lines, with each line's glyph height so intro text and tips can be told apart.
function readLayout(pdf) {
  return words(pdf, '-bbox-layout').map((page) =>
    page.split('<block ').slice(1).map((block) =>
      block.split('<line ').slice(1).map((line) => {
        const ws = [...line.matchAll(WORD_RE)];
        return { h: ws.length ? +ws[0][4] - +ws[0][2] : 0, text: ws.map((w) => unescape(w[5])).join(' ') };
      }).filter((l) => l.text)));
}

const blockText = (block) => clean(block.map((l) => l.text).join(' '));

// The printable booklets set "NN question" in two columns per page, imposed out of order.
// Rebuild each numbered question from word positions.
function readPrintable(pdf) {
  const byNumber = new Map();
  for (const page of words(pdf, '-bbox')) {
    const ws = [...page.matchAll(WORD_RE)].map((m) => ({ x: +m[1], y: +m[2], X: +m[3], t: unescape(m[5]) }));
    const nums = ws.filter((w) => /^\d{1,2}$/.test(w.t) && +w.t >= 1 && +w.t <= PER_DECK);
    for (const n of nums) {
      const column = nums.filter((o) => Math.abs(o.x - n.x) < 6 && o.y > n.y + 2).sort((a, b) => a.y - b.y);
      const bottom = column.length ? column[0].y - 2 : n.y + 90;
      const mine = ws
        .filter((w) => w !== n && w.x > n.x + 4 && w.x < n.x + 178 && w.y > n.y - 4 && w.y < bottom)
        .sort((a, b) => a.y - b.y);
      // Group into lines (words on one line can differ by a point or two in y), then read left to right.
      const lines = [];
      for (const w of mine) {
        const line = lines.find((l) => Math.abs(l.y - w.y) < 4);
        if (line) line.words.push(w);
        else lines.push({ y: w.y, words: [w] });
      }
      const text = lines.map((l) => l.words.sort((a, b) => a.x - b.x).map((w) => w.t).join(' ')).join(' ');
      check(!byNumber.has(+n.t), `${pdf}: number ${n.t} appears twice`);
      byNumber.set(+n.t, text);
    }
  }
  return byNumber;
}

// ---------------------------------------------------------------- extract

const digitalPdf = join(SRC, 'digital.pdf');
check(existsSync(digitalPdf), `Missing ${digitalPdf}. Download the free digital PDF from ${PRODUCT_URL}#download`);
const pages = readLayout(digitalPdf);
check(pages.length === PAGES, `Expected ${PAGES} pages in the digital PDF, found ${pages.length}`);

const pageText = (n) => pages[n - 1].map(blockText).join(' ');
check(squash(pageText(1)) === 'tableconversations', 'Page 1 is not the "Table Conversations" cover');
check(squash(pageText(PAGES)) === 'practicingtheway', `Page ${PAGES} is not the "Practicing the Way" back cover`);

const overridesPath = join(LOCAL, 'overrides.json');
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};
const usedOverrides = new Set();

const decks = DECKS.map((d) => {
  check(squash(pageText(d.titlePage)) === squash(d.title), `Page ${d.titlePage} should be the "${d.title}" title page`);

  // Intro page: subtitle block, then the intro paragraph (larger lines), then the tip (smaller lines).
  const [subtitleBlock, ...rest] = pages[d.introPage - 1];
  const lines = rest.flat();
  const sizes = [...new Set(lines.map((l) => Math.round(l.h)))].sort((a, b) => b - a);
  const big = sizes[0];
  const intro = clean(lines.filter((l) => Math.round(l.h) >= big - 3).map((l) => l.text).join(' '));
  const tip = clean(lines.filter((l) => Math.round(l.h) < big - 3).map((l) => l.text).join(' '));
  const subtitle = blockText(subtitleBlock);
  check(subtitle && intro && tip, `Page ${d.introPage}: could not find subtitle, intro and tip`);

  const cards = [];
  for (let n = 1; n <= PER_DECK; n++) {
    const page = d.firstPage + n - 1;
    const id = `${d.id}-${String(n).padStart(2, '0')}`;
    const blocks = pages[page - 1];
    const heights = new Set(blocks.flat().map((l) => Math.round(l.h)));
    check(heights.size === 1, `Page ${page} (${id}) mixes type sizes; check it by eye and add an override`);
    let paragraphs = blocks.map(blockText).filter(Boolean);
    let hint = null;
    const o = overrides[id];
    if (o) {
      usedOverrides.add(id);
      if (o.text) paragraphs = o.text.split(/\n{2,}/).map(clean);
      if (o.hint) {
        hint = clean(o.hint);
        const before = paragraphs.length;
        paragraphs = paragraphs.filter((p) => p !== hint);
        check(paragraphs.length === before - 1 || o.text, `${id}: hint "${hint}" is not a paragraph on page ${page}`);
      }
    }
    const text = paragraphs.join('\n\n');
    check(/[a-z]/i.test(text), `Page ${page} (${id}) has no question text`);
    check(!/^\d+$/.test(text), `Page ${page} (${id}) looks like a page number, not a question`);
    const h = createHash('sha256').update(text + '|' + (hint ?? '')).digest('hex').slice(0, 8);
    cards.push({ id, n, page, text, hint, h });
  }
  return { id: d.id, title: d.title, subtitle, intro, tip, cards };
});

for (const id of Object.keys(overrides)) check(usedOverrides.has(id), `overrides.json mentions unknown card ${id}`);

const allTexts = decks.flatMap((d) => d.cards.map((c) => squash(c.text)));
check(new Set(allTexts).size === allTexts.length, 'Two cards have identical text; the page mapping is off');

// ---------------------------------------------------------------- cross-check printables

const printables = { ss: 'print-start-small.pdf', gd: 'print-go-deeper.pdf' };
for (const deck of decks) {
  const pdf = join(SRC, printables[deck.id]);
  check(existsSync(pdf), `Missing ${pdf}. Download the printable "${deck.title}" PDF from ${PRODUCT_URL}#download`);
  const printed = readPrintable(pdf);
  check(printed.size === PER_DECK, `${printables[deck.id]}: found ${printed.size} numbered questions, expected ${PER_DECK}`);
  for (const card of deck.cards) {
    const slide = `${card.text} ${card.hint ?? ''}`;
    const print = printed.get(card.n) ?? '';
    // The booklet has the odd typesetting glitch (a word placed out of order, two words
    // fused), so a near-identical match passes with a warning. A different question fails.
    const bag = (s) => s.split(/\s+/).map(squash).filter(Boolean).sort().join(' ');
    if (squash(print) === squash(slide) || bag(print) === bag(slide)) continue;
    const sim = similarity(squash(print), squash(slide));
    check(sim >= 0.9, `${card.id} does not match question ${card.n} in ${printables[deck.id]}:\n  slide: ${card.text}\n  print: ${print}`);
    console.log(`! ${card.id}: printable differs slightly (${Math.round(sim * 100)}% similar); the slide text is used. Check it by eye.`);
  }
}

// ---------------------------------------------------------------- write

const extracted = new Date().toISOString().slice(0, 10);
const source = { title: 'Table Conversations', publisher: 'Practicing the Way', url: PRODUCT_URL, pages: PAGES };
const prev = existsSync(OUT_PLAIN) ? JSON.parse(readFileSync(OUT_PLAIN, 'utf8')) : null;
const plain = { schema: 1, source: { ...source, extracted: prev && JSON.stringify(prev.decks) === JSON.stringify(decks) ? prev.source.extracted : extracted }, decks };
writeFileSync(OUT_PLAIN, JSON.stringify(plain, null, 2) + '\n');

// What phones receive: just what the screens show.
const payload = {
  v: 1,
  source,
  decks: decks.map(({ id, title, subtitle, intro, tip, cards }) => ({
    id, title, subtitle, intro, tip, cards: cards.map(({ id, n, text, hint }) => ({ id, n, text, hint })),
  })),
};

const wordFile = join(LOCAL, 'table-word.txt');
const word = process.env.TABLE_WORD ?? (existsSync(wordFile) ? readFileSync(wordFile, 'utf8').split('\n')[0] : '');
check(normalizeWord(word).length >= 4, 'Set the table word: put it on the first line of local/table-word.txt (or set TABLE_WORD).');

const rotate = process.argv.includes('--rotate');
let salt = null;
let unchanged = false;
if (!rotate && existsSync(OUT_ENC)) {
  // Keep the salt while the word is the same, so phones that already unlocked keep working.
  const old = JSON.parse(readFileSync(OUT_ENC, 'utf8'));
  try {
    const raw = await deriveRaw(word, fromB64(old.salt), old.iter);
    const oldPayload = await decryptJSON(old, raw);
    salt = fromB64(old.salt);
    unchanged = old.iter === ITERATIONS && JSON.stringify(oldPayload) === JSON.stringify(payload);
  } catch {
    console.log('• The table word changed, so phones will be asked for the new word.');
  }
}

if (unchanged) {
  console.log('• public/cards.enc.json is already current; left untouched.');
} else {
  salt ??= randomBytes(16);
  const raw = await deriveRaw(word, salt);
  writeFileSync(OUT_ENC, JSON.stringify(await encryptJSON(payload, raw, salt)) + '\n');
  console.log('• Wrote public/cards.enc.json');
}

// ---------------------------------------------------------------- report (IDs and sizes only)

for (const d of decks) {
  const multi = d.cards.filter((c) => c.text.includes('\n\n')).map((c) => c.id);
  const blanks = d.cards.filter((c) => c.text.includes('____')).map((c) => c.id);
  const hints = d.cards.filter((c) => c.hint).map((c) => c.id);
  const longest = [...d.cards].sort((a, b) => b.text.length - a.text.length).slice(0, 5).map((c) => `${c.id}(${c.text.length})`);
  console.log(`✓ ${d.title}: ${d.cards.length} cards, intro + tip, numbering matches the printable`);
  console.log(`    two paragraphs: ${multi.join(', ') || 'none'} | blanks: ${blanks.join(', ') || 'none'} | hints: ${hints.join(', ') || 'none'}`);
  console.log(`    longest: ${longest.join(', ')}`);
}
console.log('• Wrote local/cards.json. Read each tier against the PDF once by eye before sharing.');
console.log('• Next: npm run stamp (updates the offline cache version).');
