// Card motion. Decoration only: app.js changes state and content synchronously, then asks
// for a motion to dress the change. With reduced motion, no Web Animations, or a card too
// tall for its area, every motion falls back to a short fade.
//
// Order for a draw: capture() the outgoing card as a ghost BEFORE any DOM write, change
// state and render, then play(kind, ghost). Everything ends within MOTION_MAX, inside the tap guard.
//
// A finger can also hold the card (grab, follow). A throw hands the held card to capture()
// and play() so the draw carries on from where the finger let go; a hold let go short of the
// line springs back (drop), and isn't a motion that blocks anything.
//
// Two fingers can twist the card round flat on the table (twistGrab, twistFollow, twistEnd).
// Let go past the line and it spins on to the half-turn, exactly where Turn would leave it.

import {
  REST_POSE, SPIN_MAX, THROW_MAX, drawAngle, endAngle, pivot, place, pose, softY, spinCurve, throwCurve, twistPose,
} from './swipe.js';

export const MOTION_MAX = 860;

// The pace of a hand at the table: unhurried, about as long as turning over a real card.
const FLIP = 600;  // lift the top card, turn it over, set it down
const EDGE = 0.5;  // the moment in a flip when the card is edge-on and its face starts to show
const FLIP_THROWN = 120; // after a throw the hand is already at the pile
console.assert(Math.max(THROW_MAX, FLIP_THROWN + FLIP) <= MOTION_MAX, 'a thrown draw must end within MOTION_MAX');
console.assert(SPIN_MAX + 40 <= MOTION_MAX, 'a twisted card must land within MOTION_MAX');

const E = {
  slide: 'cubic-bezier(.35,.05,.25,1)', // slid away by hand: a gentle start, then it glides
  place: 'cubic-bezier(.22,.75,.25,1)', // set down by hand
  lift: 'cubic-bezier(.3,0,.4,1)',      // fingertips raise the card before turning it
  rise: 'cubic-bezier(.45,0,.8,.6)',    // first half of a flip
  fall: 'cubic-bezier(.15,.45,.2,1)',   // second half; about the same angular speed at edge-on
  back: 'cubic-bezier(.45,0,.2,1)',
  spin: 'cubic-bezier(0.22, 0.68, 0.3, 1)', // the .card transition: Turn
};
const SLOW = Math.max(1, Number(new URLSearchParams(location.search).get('slow')) || 1); // ?slow=5 to tune by eye
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const landscape = matchMedia('(orientation: landscape) and (max-height: 520px)');
const $ = (s) => document.querySelector(s);

const live = new Set();  // running Web Animations we own
const holds = new Set(); // motions under way; those marked moving put the card screen in "moving" mode
let spinHold = null;
let spinTimer = 0;
let drag = null;         // the card a finger is holding, if any
let tw = null;           // the card two fingers are turning, or that is landing from a twist

const on = () => !reduce.matches && typeof Element.prototype.animate === 'function';
const fits = (el) => el.scrollHeight <= el.clientHeight + 1;
const turnsNow = () => Number($('#card').style.getPropertyValue('--turns')) || 0;
const turned = () => (turnsNow() & 1) === 1; // turns go negative after an anticlockwise twist
const px = (n) => `${Math.round(n * 10) / 10}px`;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const busy = () => holds.size > 0;
export const tall = () => !fits($('#card-area'));

function run(el, frames, opts) {
  const a = el.animate(frames, { ...opts, duration: opts.duration * SLOW, delay: (opts.delay ?? 0) * SLOW });
  live.add(a);
  const forget = () => live.delete(a);
  a.finished.then(forget, forget);
  return a;
}

function sync() {
  $('#screen-card').classList.toggle('moving', [...holds].some((t) => t.moving));
}

// Each motion holds until it releases; finishing one motion never ends another's.
function hold(moving = true) {
  const token = { moving };
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
  drag = null;
  $('#card').classList.remove('lifted', 'bare');
  unTwist();
  for (const t of [...holds]) if (!(keepSpin && t === spinHold)) holds.delete(t);
  if (!keepSpin) {
    clearTimeout(spinTimer);
    spinHold = null;
    for (const a of $('#card').getAnimations()) a.finish();
  }
  sync();
}

// Clone the card on screen into the flight layer, frozen at its exact size and place.
// Returns null when there's nothing to animate (fade instead). A card a finger has just
// thrown is handed over as it is, mid-flight.
export function capture() {
  if (drag?.thrown != null) {
    const d = drag;
    drag = null;
    return d;
  }
  settle();
  if (!on() || $('#screen-card').hidden || !fits($('#card-area'))) return null;
  return clone(false);
}

// A long card is cloned whole inside a band the height of the card area, so only the part in
// view shows and the moving layer stays screen-sized.
function clone(long) {
  const sheet = $('#sheet');
  const r = sheet.getBoundingClientRect();
  const { width: w, height: h } = r; // unrounded, so the clone's lines wrap exactly as the card's
  const g = sheet.cloneNode(true);
  for (const el of [g, ...g.querySelectorAll('[id]')]) el.removeAttribute('id');
  g.classList.add('ghost');
  g.dataset.tier = $('#deck').dataset.tier;
  const B = turned() ? 180 : 0;
  Object.assign(g.style, {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${w}px`,
    height: `${h}px`,
    padding: getComputedStyle(sheet).padding,
    transform: `rotate(${B}deg)`,
  });
  let el = g;
  if (long) {
    const a = $('#card-area').getBoundingClientRect();
    el = document.createElement('div');
    el.className = 'band';
    Object.assign(el.style, { top: px(a.top), height: px(a.height) });
    g.style.top = `${r.top - a.top}px`;
    el.append(g);
  }
  $('#flight').append(el);
  return { g, el, r, w, h, B };
}

// ---------------------------------------------------------------- a card under two fingers

// Straight to the angle --turns gives it, with no transition: the same matrix, so nothing moves.
function unTwist() {
  const t = tw;
  if (!t) return;
  tw = null;
  if (t.flat) return;
  const card = $('#card');
  t.anim?.cancel();
  card.classList.add('still');
  card.style.transform = '';
  void card.offsetWidth;
  card.classList.remove('still', 'twist');
  $('#screen-card').classList.remove('twisting');
}

// Two fingertips have turned the card past the lock, with their midpoint at (px, py). A card too
// tall for its area stays put and turns on release, as Turn does.
export function twistGrab(px, py) {
  if (busy() || $('#screen-card').hidden) return null;
  settle();
  const card = $('#card');
  const r = card.getBoundingClientRect();
  tw = { B: turnsNow() * 180, a: 0, mx: 0, my: 0, flat: tall(), anim: null,
    ...pivot(px - (r.left + r.width / 2), py - (r.top + r.height / 2), card.offsetWidth, card.offsetHeight) };
  if (tw.flat) return tw;
  card.classList.add('twist');
  $('#screen-card').classList.add('twisting');
  card.style.transform = twistPose(tw);
  return tw;
}

// theta: the fingers' turn since they landed; (mx, my): their midpoint's travel since the lock.
// False when the card is no longer held (settle() took it).
export function twistFollow(h, theta, mx, my) {
  if (h !== tw || h.anim) return false;
  if (h.flat) return true;
  Object.assign(h, { a: drawAngle(theta), mx: softY(mx), my: softY(my) });
  $('#card').style.transform = twistPose(h);
  return true;
}

// The fingers let go: n half-turns (+1, -1, or 0 to settle back square) at w deg/ms. apply()
// changes the state at once; the motion only dresses it.
export function twistEnd(h, n, w, apply) {
  if (h !== tw || h.anim) return false;
  if (n && (h.flat || !on())) { spin(apply); return true; } // the button's swap and fade
  if (h.flat) { tw = null; return true; }
  const to = twistPose({ B: h.B, a: n * 180, mx: 0, my: 0, gx: 0, gy: 0 });
  let timing;
  if (n) {
    apply();
    if (spinHold) holds.delete(spinHold);
    const release = hold();
    spinHold = release.token;
    timing = spinCurve(n * 180 - h.a, w, E.spin);
    clearTimeout(spinTimer);
    spinTimer = setTimeout(() => { spinHold = null; release(); }, (timing.duration + 40) * SLOW);
  } else {
    timing = on() ? { duration: clamp(200 + 2.2 * Math.abs(h.a), 220, 420), easing: E.place } : { duration: 160, easing: 'ease-out' };
  }
  h.anim = run($('#card'), [{ transform: twistPose(h) }, { transform: to }], { ...timing, fill: 'forwards' });
  h.anim.finished.then(() => { if (tw === h) unTwist(); }, () => {});
  return true;
}

// ---------------------------------------------------------------- a card under a finger

// A long card's band slides sideways on the screen; any other card lies in the reader's frame.
const dress = (d, p) => (d.long ? `translate(${px(d.s * p.x)}, 0px)` : pose(d.B, p, d));
function lay(d, p) {
  d.pose = p;
  d.el.style.transform = dress(d, p);
}

// The finger takes the top card at (cx, cy). Underneath, the next card waits face down.
export function grab(cx, cy) {
  if (busy() || $('#screen-card').hidden) return null;
  settle();
  const long = tall();
  const c = clone(long);
  const s = c.B ? -1 : 1;
  drag = {
    ...c, s, long,
    flat: long || reduce.matches, // no tilt or lift: a long card or Reduce Motion only slides
    gx: s * (cx - (c.r.left + c.r.width / 2)),
    gy: s * (cy - (c.r.top + c.r.height / 2)),
    pose: REST_POSE,
    thrown: null,
  };
  if (!long) c.g.classList.add('held');
  lay(drag, REST_POSE);
  // Underneath, the next card waits face down; under a long card there's no card-sized back to show.
  $('#card').classList.add('lifted');
  $('#card').classList.toggle('bare', long);
  return drag;
}

// The card follows the finger (x, y: offset since it was taken, in the reader's frame).
// False when the card is no longer held (settle() took it).
export function follow(d, x, y) {
  if (d !== drag) return false;
  lay(d, place(x, y, d));
  return true;
}

// The finger let go to throw it at v px/ms; the next capture() takes it from here.
export function throwOn(d, v) {
  if (d !== drag) return false;
  d.thrown = v;
  return true;
}

// Let go short of the line: the card settles back square on the pile.
export function drop(d) {
  if (d !== drag) return;
  drag = null;
  const a = run(d.el, [{ transform: dress(d, d.pose) }, { transform: dress(d, REST_POSE) }], reduce.matches
    ? { duration: 160, easing: 'ease-out', fill: 'forwards' }
    : { duration: clamp(220 + 0.6 * Math.abs(d.pose.x), 240, 420), easing: E.place, fill: 'forwards' });
  const done = () => {
    d.el.remove();
    if (!drag) $('#card').classList.remove('lifted', 'bare');
  };
  a.finished.then(done, done);
}

// The thrown card carries on at the finger's speed toward the set-aside pile.
function throwAside(d) {
  const { y, a } = d.pose;
  const aEnd = d.flat ? 0 : endAngle(a);
  const X = offLeft(d.r, d.B) + (d.flat ? 0 : d.h * Math.abs(Math.sin((aEnd * Math.PI) / 180))) + 8; // corners clear too
  const { duration, easing } = throwCurve(Math.max(40, X + d.pose.x), Math.max(0, -d.thrown), E.slide);
  run(d.el, [{ transform: dress(d, d.pose) }, { transform: dress(d, { x: -X, y: d.flat ? 0 : y + 0.02 * d.h, a: aEnd }) }],
    { duration, easing, fill: 'forwards' });
}

function playThrown(kind, d) {
  $('#card').classList.remove('lifted', 'bare'); // flipUp's first frame holds the same face-down card
  const flip = kind === 'next' && on() && !d.long && fits($('#card-area'));
  const release = hold(flip); // only a flipping card needs room to lift past the card area
  if (on()) {
    if (kind === 'last' && d.long) run(d.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
    else throwAside(d);
    if (kind === 'last') run($('#empty-heading'), [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 240, fill: 'backwards' });
    else if (flip) flipUp($('#sheet').offsetWidth, FLIP_THROWN);
    else run($('#card'), [{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
  } else {
    run(d.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
    run(kind === 'last' ? $('#empty-heading') : $('#card'), [{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
  }
  const mine = [...live];
  Promise.allSettled(mine.map((a) => a.finished)).then(() => {
    d.el.remove();
    release();
  });
}

function fade(kind, ghost) {
  ghost?.el.remove();
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
  if (ghost?.thrown != null) return playThrown(kind, ghost);
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
    ghost?.el.remove();
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
