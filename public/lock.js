// Table-word lock: PBKDF2-SHA256 -> AES-GCM-256. Shared by the browser app and
// scripts/build-cards.mjs so encryption and decryption use the same code.

export const ITERATIONS = 600000;

const enc = new TextEncoder();
const dec = new TextDecoder();

// "  Table  Word " and "table word" unlock the same deck; it is spoken aloud.
export function normalizeWord(word) {
  return String(word).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function toB64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveRaw(word, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normalizeWord(word)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  return new Uint8Array(bits);
}

async function aesKey(raw, usage) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]);
}

export async function encryptJSON(data, raw, salt, iterations = ITERATIONS) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(raw, 'encrypt'), enc.encode(JSON.stringify(data)));
  return { v: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iter: iterations, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

// Throws if the key is wrong (AES-GCM authentication fails).
export async function decryptJSON(envelope, raw) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(envelope.iv) }, await aesKey(raw, 'decrypt'), fromB64(envelope.ct));
  return JSON.parse(dec.decode(pt));
}

export async function unlock(envelope, word) {
  if (envelope?.v !== 1 || envelope.alg !== 'AES-GCM' || !(envelope.iter >= 100000)) throw new Error('Unsupported card file');
  const raw = await deriveRaw(word, fromB64(envelope.salt), envelope.iter);
  const data = await decryptJSON(envelope, raw);
  return { raw, data };
}
