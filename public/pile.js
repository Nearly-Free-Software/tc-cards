// A pile is { order: [cardId, ...], pos }. order[pos] is the card on screen and
// counts as drawn once shown. pos === -1 means nothing drawn yet; pos === order.length
// means every card has been drawn. All functions return new objects.

export function randomInt(n) {
  // Unbiased integer in [0, n) from crypto.getRandomValues.
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

export function shuffle(ids, rand = randomInt) {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newPile(ids, rand = randomInt) {
  return { order: shuffle(ids, rand), pos: -1 };
}

export const size = (p) => p.order.length;
export const left = (p) => Math.max(0, size(p) - (p.pos + 1));
export const drawn = (p) => Math.min(size(p), Math.max(0, p.pos + 1));
export const current = (p) => (p.pos >= 0 && p.pos < size(p) ? p.order[p.pos] : null);
export const isEmpty = (p) => p.pos >= size(p);
export const canGoBack = (p) => p.pos > 0;
export const canSkip = (p) => p.pos >= 0 && p.pos < size(p) - 1;

export function begin(p) {
  return p.pos === -1 ? { ...p, pos: 0 } : p;
}

export function next(p) {
  return { ...p, pos: Math.min(p.pos + 1, size(p)) };
}

export function back(p) {
  return { ...p, pos: Math.max(0, Math.min(p.pos, size(p)) - 1) };
}

// "Not this one": the card goes to the bottom of the pile, uncounted, and the
// next card slides into its place. Disabled on the last remaining card.
export function skip(p) {
  if (!canSkip(p)) return p;
  const order = p.order.slice();
  const [id] = order.splice(p.pos, 1);
  order.push(id);
  return { ...p, order };
}

// Make a stored pile match the current deck: drop unknown or duplicate IDs (keeping
// the on-screen card where possible) and slot missing IDs in at random among the
// cards still to come.
export function repair(stored, ids, rand = randomInt) {
  if (!stored || !Array.isArray(stored.order) || !Number.isInteger(stored.pos)) return newPile(ids, rand);
  const known = new Set(ids);
  const seen = new Set();
  const order = [];
  let pos = -1;
  stored.order.forEach((id, i) => {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
    if (i === stored.pos) pos = order.length - 1;
  });
  if (stored.pos >= stored.order.length) pos = order.length;
  if (!order.length) return newPile(ids, rand);
  const missing = shuffle(ids.filter((id) => !seen.has(id)), rand);
  if (missing.length && pos >= order.length) pos = order.length - 1;
  for (const id of missing) {
    const at = pos + 1 + rand(order.length - pos);
    order.splice(at, 0, id);
  }
  return { order, pos: Math.max(-1, Math.min(pos, order.length)) };
}
