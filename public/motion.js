// Card motion. Decoration only: app.js changes state and content synchronously, then asks
// for a motion to dress the change. With reduced motion, no Web Animations, or a card too
// tall for its area, every motion falls back to a short fade.
//
// Order for a draw: capture() the outgoing card as a ghost BEFORE any DOM write, change
// state and render, then play(kind, ghost). Everything ends within MOTION_MAX, inside the tap guard.

export const MOTION_MAX = 860;

// The pace of a hand at the table: unhurried, about as long as turning over a real card.
const FLIP = 600;  // lift the top card, turn it over, set it down
const EDGE = 0.5;  // the moment in a flip when the card is edge-on and its face starts to show

const E = {
  slide: 'cubic-bezier(.35,.05,.25,1)', // slid away by hand: a gentle start, then it glides
  place: 'cubic-bezier(.22,.75,.25,1)', // set down by hand
  lift: 'cubic-bezier(.3,0,.4,1)',      // fingertips raise the card before turning it
  rise: 'cubic-bezier(.45,0,.8,.6)',    // first half of a flip
  fall: 'cubic-bezier(.15,.45,.2,1)',   // second half; about the same angular speed at edge-on
  back: 'cubic-bezier(.45,0,.2,1)',
};
const SLOW = Math.max(1, Number(new URLSearchParams(location.search).get('slow')) || 1); // ?slow=5 to tune by eye
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const landscape = matchMedia('(orientation: landscape) and (max-height: 520px)');
const $ = (s) => document.querySelector(s);

const live = new Set();  // running Web Animations we own
const holds = new Set(); // motions that need the card screen in "moving" mode
let spinHold = null;
let spinTimer = 0;

const on = () => !reduce.matches && typeof Element.prototype.animate === 'function';
const fits = (el) => el.scrollHeight <= el.clientHeight + 1;
const turned = () => (Number($('#card').style.getPropertyValue('--turns')) || 0) % 2 === 1;
const px = (n) => `${Math.round(n * 10) / 10}px`;

function run(el, frames, opts) {
  const a = el.animate(frames, { ...opts, duration: opts.duration * SLOW, delay: (opts.delay ?? 0) * SLOW });
  live.add(a);
  const forget = () => live.delete(a);
  a.finished.then(forget, forget);
  return a;
}

function sync() {
  $('#screen-card').classList.toggle('moving', holds.size > 0);
}

// Each motion holds "moving" mode until it releases; finishing one motion never ends another's.
function hold() {
  const token = {};
  holds.add(token);
  sync();
  const release = () => { holds.delete(token); sync(); };
  release.token = token;
  return release;
}

// Finish every motion immediately, so nothing is ever left half-turned or mid-air.
export function settle({ keepSpin = false } = {}) {
  for (const a of [...live]) {
    try { a.finish(); } catch { a.cancel(); }
  }
  live.clear();
  $('#flight').replaceChildren();
  for (const t of [...holds]) if (!(keepSpin && t === spinHold)) holds.delete(t);
  if (!keepSpin) {
    clearTimeout(spinTimer);
    spinHold = null;
    for (const a of $('#card').getAnimations()) a.finish();
  }
  sync();
}

// Clone the card on screen into the flight layer, frozen at its exact size and place.
// Returns null when there's nothing to animate (fade instead).
export function capture() {
  settle();
  if (!on() || $('#screen-card').hidden || !fits($('#card-area'))) return null;
  const sheet = $('#sheet');
  const r = sheet.getBoundingClientRect();
  const w = sheet.offsetWidth;
  const h = sheet.offsetHeight;
  const g = sheet.cloneNode(true);
  for (const el of [g, ...g.querySelectorAll('[id]')]) el.removeAttribute('id');
  g.classList.add('ghost');
  g.dataset.tier = $('#deck').dataset.tier;
  const B = turned() ? 180 : 0;
  Object.assign(g.style, {
    left: px(r.left + (r.width - w) / 2),
    top: px(r.top + (r.height - h) / 2),
    width: px(w),
    height: px(h),
    padding: getComputedStyle(sheet).padding,
    transform: `rotate(${B}deg)`,
  });
  $('#flight').append(g);
  return { g, r, w, B };
}

function fade(kind, ghost) {
  ghost?.g.remove();
  if (typeof Element.prototype.animate !== 'function') return;
  const el = kind === 'last' ? $('#empty-heading') : $('#card');
  run(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
}

// The top card of the pile is picked up: it lifts off the pile, starts to tip, turns over
// through edge-on, and is set down face up.
function flipUp(w, delay) {
  const P = Math.round(3.5 * w);
  const T = (y, a, s) => `perspective(${P}px) translateY(${y}px) rotateY(${a}deg) scale(${s})`;
  const timing = { duration: FLIP, delay, fill: 'backwards' };
  run($('#sheet'), [
    { transform: T(0, 180, 1), easing: E.lift },
    { transform: T(-8, 174, 1.03), offset: 0.2, easing: E.rise },
    { transform: T(-10, 90, 1.045), offset: EDGE, easing: E.fall },
    { transform: T(0, 0, 1) },
  ], timing);
  // The face shows from the moment the card is edge-on (it has no width then).
  const swap = { duration: FLIP * EDGE, delay, easing: 'step-end', fill: 'backwards' };
  run($('#sheet .face'), [{ opacity: 0 }, { opacity: 1 }], swap);
  run($('#sheet .back'), [{ opacity: 1 }, { opacity: 0 }], swap);
  run($('#deck .lift'), [{ opacity: 0 }, { opacity: 0.9, offset: EDGE }, { opacity: 0 }], timing);
}

// How far a card must travel to leave by the reader's left edge (the right edge if turned).
const offLeft = (r, B) => (B ? innerWidth - r.left : r.right) + 24;

function setAside(ghost) {
  const { g, r, B } = ghost;
  const X = offLeft(r, B);
  const T = (x, y, a) => `rotate(${B}deg) translate(${x}px, ${y}%) rotate(${a}deg)`;
  run(g, [{ transform: T(0, 0, 0) }, { transform: T(-X, 2, -4) }],
    { duration: Math.min(600, Math.max(460, 340 + 0.5 * X)), easing: E.slide, fill: 'forwards' });
}

export function play(kind, ghost) {
  const needsGhost = kind === 'next' || kind === 'last' || kind === 'skip' || kind === 'back';
  if (!ghost) settle();
  if (!on() || (needsGhost && !ghost)) return fade(kind, ghost);
  if (kind !== 'last' && !fits($('#card-area'))) return fade(kind, ghost);

  const release = hold();
  const sheet = $('#sheet');
  const w = sheet.offsetWidth;

  if (kind === 'next') {
    // The old card is slid aside first; the hand comes back for the next one as it goes.
    setAside(ghost);
    flipUp(w, 180);
  } else if (kind === 'last') {
    setAside(ghost);
    run($('#empty-heading'), [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 240, fill: 'backwards' });
  } else if (kind === 'skip') {
    // "Later": out to the side, then slid back under the pile.
    const { g, B } = ghost;
    const out = landscape.matches ? 'translate(0px, calc(100% + 16px)) rotate(0deg)' : 'translate(calc(100% + 16px), -1.5%) rotate(3deg)';
    run(g, [
      { transform: `rotate(${B}deg) translate(0px, 0%) rotate(0deg)`, easing: E.slide },
      { transform: `rotate(${B}deg) ${out}`, offset: 0.42, easing: E.back },
      { transform: `rotate(${B}deg) translate(0px, 3px) rotate(0deg)` },
    ], { duration: 700, fill: 'forwards' });
    run(g, [{ zIndex: 2 }, { zIndex: 2, offset: 0.41 }, { zIndex: 0, offset: 0.41 }, { zIndex: 0 }], { duration: 700, fill: 'forwards' });
    flipUp(w, 250);
  } else if (kind === 'back') {
    // The card on show turns face down onto the pile; the previous one comes back from the left.
    const { g, r, B } = ghost;
    const P = Math.round(3.5 * w);
    const T = (y, a) => `translateY(${y}px) rotate(${B}deg) perspective(${P}px) rotateY(${a}deg)`;
    run(g, [
      { transform: T(0, 0), easing: E.rise },
      { transform: T(-6, 90), offset: 0.4, easing: E.fall },
      { transform: T(3, 180) },
    ], { duration: 380, fill: 'forwards' });
    run(g.querySelector('.face'), [{ opacity: 1 }, { opacity: 0 }], { duration: 152, easing: 'step-end', fill: 'forwards' });
    run(g.querySelector('.back'), [{ opacity: 0 }, { opacity: 1 }], { duration: 152, easing: 'step-end', fill: 'forwards' });
    // Once face down it's part of the pile, so the returning card slides in over it.
    run(g, [{ zIndex: 2 }, { zIndex: 0 }], { duration: 380, easing: 'step-end', fill: 'forwards' });
    const X = offLeft(r, B);
    run(sheet, [{ transform: `translateX(${-X}px) rotate(-4deg)` }, { transform: 'translateX(0px) rotate(0deg)' }],
      { duration: 500, delay: 320, easing: E.place, fill: 'backwards' });
  } else if (kind === 'return') {
    const r = sheet.getBoundingClientRect();
    const X = offLeft(r, turned() ? 180 : 0);
    run(sheet, [{ transform: `translateX(${-X}px) rotate(-4deg)` }, { transform: 'translateX(0px) rotate(0deg)' }],
      { duration: 600, easing: E.place, fill: 'backwards' });
  } else if (kind === 'deal') {
    // A fresh pile is set down, then its top card is picked up and turned over.
    run($('#deck'), [
      { opacity: 0, transform: 'translateY(-10px) scale(1.03)' },
      { opacity: 1, transform: 'translateY(-4px) scale(1.01)', offset: 0.45 },
      { opacity: 1, transform: 'translateY(0px) scale(1)' },
    ], { duration: 340, easing: E.place, fill: 'backwards' });
    flipUp(w, 240);
  }

  const mine = [...live];
  Promise.allSettled(mine.map((a) => a.finished)).then(() => {
    ghost?.g.remove();
    release();
  });
}

// Turn: the card spins flat on the table. A card too tall to spin cleanly just fades round.
export function spin(apply) {
  settle({ keepSpin: true });
  const card = $('#card');
  if (!on() || !fits($('#card-area'))) {
    card.classList.add('still');
    apply();
    void card.offsetWidth; // commit the new angle with no transition
    card.classList.remove('still');
    if (typeof card.animate === 'function') run(card, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    return;
  }
  if (spinHold) holds.delete(spinHold);
  const release = hold();
  spinHold = release.token;
  apply();
  clearTimeout(spinTimer);
  spinTimer = setTimeout(() => { spinHold = null; release(); }, 760 * SLOW); // the .card transition, plus a frame or two
}

// Reshuffle on the lid: the missing edges drop back in, then the deck is knocked square.
export function squareUp(btn, fromDepth) {
  if (!on()) return;
  const spans = [...btn.querySelectorAll('.stack > span')].slice(0, 4 - fromDepth);
  let end = 0;
  spans.forEach((s, i) => {
    const dir = i % 2 ? 1 : -1;
    const delay = i * 60;
    run(s, [
      { opacity: 0, transform: `translate(${5 * dir}px, -6px) rotate(${2 * dir}deg)` },
      { opacity: 1, transform: 'translate(0px, 0px) rotate(0deg)' },
    ], { duration: 340, delay, easing: E.place, fill: 'backwards' });
    end = delay + 340;
  });
  if (fromDepth === 0) {
    run(btn.querySelector('.pile-top'), [
      { opacity: 0, transform: 'translateY(-8px) scale(1.03)' },
      { opacity: 1, transform: 'translateY(0px) scale(1)' },
    ], { duration: 340, delay: end, easing: E.place, fill: 'backwards' });
    end += 340;
  }
  run(btn.querySelector('.pile-art'), [
    { transform: 'translateY(0px)' }, { transform: 'translateY(1.5px)', offset: 0.5 }, { transform: 'translateY(0px)' },
  ], { duration: 180, delay: Math.min(end, 560), easing: 'ease' });
}
