import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pile from '../public/pile.js';

const ids = Array.from({ length: 50 }, (_, i) => `ss-${String(i + 1).padStart(2, '0')}`);

test('shuffle is a permutation', () => {
  const p = pile.newPile(ids);
  assert.equal(p.pos, -1);
  assert.deepEqual([...p.order].sort(), [...ids].sort());
});

test('randomInt stays in range', () => {
  for (let i = 0; i < 2000; i++) {
    const n = 1 + (i % 50);
    const r = pile.randomInt(n);
    assert.ok(r >= 0 && r < n && Number.isInteger(r));
  }
});

test('fresh pile counts: nothing drawn, all left', () => {
  const p = pile.newPile(ids);
  assert.equal(pile.left(p), 50);
  assert.equal(pile.drawn(p), 0);
  assert.equal(pile.current(p), null);
  assert.equal(pile.canGoBack(p), false);
  assert.equal(pile.canSkip(p), false);
});

test('begin shows the first card and counts it as drawn', () => {
  const p = pile.begin(pile.newPile(ids));
  assert.equal(p.pos, 0);
  assert.equal(pile.current(p), p.order[0]);
  assert.equal(pile.drawn(p), 1);
  assert.equal(pile.left(p), 49);
  assert.equal(pile.begin(p), p, 'begin does not move an open pile');
});

test('50 draws never repeat, then the pile is empty', () => {
  let p = pile.begin(pile.newPile(ids));
  const seen = new Set([pile.current(p)]);
  for (let i = 1; i < 50; i++) {
    p = pile.next(p);
    assert.ok(!seen.has(pile.current(p)));
    seen.add(pile.current(p));
  }
  assert.equal(seen.size, 50);
  assert.equal(pile.left(p), 0);
  assert.equal(pile.canSkip(p), false, 'Not this one is disabled on the last card');
  p = pile.next(p);
  assert.equal(pile.isEmpty(p), true);
  assert.equal(pile.current(p), null);
  assert.equal(pile.next(p).pos, 50, 'next stays empty');
  assert.equal(pile.current(pile.back(p)), p.order[49], 'back from empty shows the last card');
});

test('back moves one card and stops at the first', () => {
  let p = pile.next(pile.next(pile.begin(pile.newPile(ids))));
  assert.equal(p.pos, 2);
  p = pile.back(p);
  assert.equal(p.pos, 1);
  p = pile.back(pile.back(p));
  assert.equal(p.pos, 0);
});

test('not this one sends the card to the bottom without counting it', () => {
  let p = pile.next(pile.begin(pile.newPile(ids)));
  const skipped = pile.current(p);
  const following = p.order[p.pos + 1];
  const before = pile.left(p);
  p = pile.skip(p);
  assert.equal(pile.current(p), following);
  assert.equal(p.order.at(-1), skipped);
  assert.equal(pile.left(p), before);
  assert.equal(p.order.length, 50);
});

test('the pile survives a save and reload unchanged', () => {
  const p = pile.next(pile.begin(pile.newPile(ids)));
  const reloaded = pile.repair(JSON.parse(JSON.stringify(p)), ids);
  assert.deepEqual(reloaded, p);
});

test('repair drops unknown and duplicate ids and keeps the current card', () => {
  const order = [...ids];
  const stored = { order: ['zz-99', ...order.slice(0, 5), order[2], ...order.slice(5)], pos: 4 };
  const current = stored.order[4];
  const p = pile.repair(stored, ids);
  assert.equal(p.order.length, 50);
  assert.equal(new Set(p.order).size, 50);
  assert.equal(pile.current(p), current);
});

test('repair adds missing ids after the current card only', () => {
  const stored = pile.next(pile.next(pile.begin({ order: ids.slice(0, 40), pos: -1 })));
  const drawnBefore = stored.order.slice(0, stored.pos + 1);
  const p = pile.repair(stored, ids);
  assert.equal(p.order.length, 50);
  assert.deepEqual(p.order.slice(0, p.pos + 1), drawnBefore);
  assert.equal(pile.current(p), pile.current(stored));
});

test('repair reopens an empty pile when new cards appear', () => {
  const stored = { order: ids.slice(0, 49), pos: 49 };
  const p = pile.repair(stored, ids);
  assert.equal(pile.isEmpty(p), false);
  assert.equal(pile.current(p), ids[48]);
  assert.equal(pile.left(p), 1);
});

test('repair replaces garbage with a fresh pile', () => {
  for (const junk of [null, undefined, {}, { order: 'x', pos: 0 }, { order: [], pos: 0 }, { order: ['nope'], pos: 0 }]) {
    const p = pile.repair(junk, ids);
    assert.equal(p.pos, -1);
    assert.equal(p.order.length, 50);
  }
});
