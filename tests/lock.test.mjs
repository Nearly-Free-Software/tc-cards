import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptJSON, deriveRaw, encryptJSON, fromB64, normalizeWord, randomBytes, toB64, unlock } from '../public/lock.js';

// Fewer iterations keep the tests fast; the app uses ITERATIONS from the envelope.
const ITER = 100000;

async function seal(data, word, salt = randomBytes(16)) {
  return encryptJSON(data, await deriveRaw(word, salt, ITER), salt, ITER);
}

test('normalizeWord ignores case, spacing and Unicode form', () => {
  assert.equal(normalizeWord('  Olive   LANTERN '), 'olive lantern');
  assert.equal(normalizeWord('café'), normalizeWord('café'));
});

test('base64 round trip', () => {
  const bytes = randomBytes(64);
  assert.deepEqual(fromB64(toB64(bytes)), bytes);
});

test('the right word unlocks, however it is typed', async () => {
  const env = await seal({ hello: 'table' }, 'olive lantern');
  const { data, raw } = await unlock(env, ' Olive  Lantern');
  assert.deepEqual(data, { hello: 'table' });
  assert.deepEqual(await decryptJSON(env, raw), { hello: 'table' }, 'the stored key reopens it');
});

test('a wrong word is rejected', async () => {
  const env = await seal({ hello: 'table' }, 'olive lantern');
  await assert.rejects(unlock(env, 'olive lanterns'));
});

test('a key saved before the word was rotated no longer opens the deck', async () => {
  const before = await seal({ v: 1 }, 'first word');
  const { raw } = await unlock(before, 'first word');
  const after = await seal({ v: 1 }, 'second word');
  assert.notEqual(after.salt, before.salt);
  await assert.rejects(decryptJSON(after, raw));
});

test('same word and salt gives the same key, so phones stay unlocked across rebuilds', async () => {
  const salt = randomBytes(16);
  const a = await seal({ v: 1 }, 'same word', salt);
  const b = await seal({ v: 2 }, 'same word', salt);
  assert.notEqual(a.iv, b.iv, 'every encryption gets a fresh IV');
  const { raw } = await unlock(a, 'same word');
  assert.deepEqual(await decryptJSON(b, raw), { v: 2 });
});

test('tampered ciphertext is rejected', async () => {
  const env = await seal({ hello: 'table' }, 'olive lantern');
  const ct = fromB64(env.ct);
  ct[0] ^= 1;
  await assert.rejects(unlock({ ...env, ct: toB64(ct) }, 'olive lantern'));
});

test('unexpected envelopes are refused', async () => {
  await assert.rejects(unlock({ v: 2 }, 'x'));
  await assert.rejects(unlock({ v: 1, alg: 'AES-GCM', iter: 10 }, 'x'));
});
