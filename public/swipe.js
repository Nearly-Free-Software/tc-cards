// Touch gestures on the card. Slide it toward the reader's left to set it aside (the same as
// "Next card"); twist it round with two fingers to turn it (the same as "Turn"). This file
// recognises gestures and holds the pure maths; motion.js moves the card and app.js decides what
// a gesture does. Nothing touches the DOM until attach(), so node:test can import it.
//
// A passed or picked-up phone must never draw a card, so a slide counts only when every filter
// below agrees: one fingertip, on the card face, clear of the glass's edges, moving promptly and
// sideways, never resting, far or fast enough toward the reader's left, decided when it lifts.

export const SLOP = 10;          // px before a stroke is judged
export const RATIO = 0.7;        // |dy| <= RATIO * |dx|: within about 35° of horizontal
export const SLOP_LONG = 14;     // a long card scrolls, so its slides must be plainer
export const RATIO_LONG = 0.47;  // about 25°
export const STALE = 500;        // ms from touch-down to judging: a resting thumb never slides
export const REST = 600;         // ms a held card may rest short of the line before it's let go
export const EDGE = 32;          // px clear of the glass's left and right edges (OS back gestures, grips)
export const FOOT = 40;          // px clear of the bottom (home indicator)
export const CLEAR = 250;        // ms after the glass is clear before a new slide may start
export const V_FLING = 0.6;      // px/ms toward the set-aside pile that makes a short slide a flick
export const V_BACK = 0.3;       // px/ms back toward the pile at lift-off cancels
export const THROW_MIN = 280;
export const THROW_MAX = 560;
export const REST_POSE = Object.freeze({ x: 0, y: 0, a: 0 });

const WINDOW = 100;  // ms of samples used for the release velocity
const STOPPED = 80;  // ms without a move before lift-off means the finger had stopped
const SPAN = 16;     // ms: shorter windows can't give a velocity
const V_MAX = 4;     // px/ms

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const r1 = (n) => Math.round(n * 10) / 10;

export const commitDistance = (w) => clamp(0.4 * w, 112, 168);
export const flingDistance = (w) => clamp(0.22 * w, 64, 96);

// null: not yet; 'h': a slide; 'no': a scroll, a diagonal brush, or a finger that rested first.
export function lock(dx, dy, dt, long = false) {
  if (dt > STALE) return 'no';
  if (Math.hypot(dx, dy) < (long ? SLOP_LONG : SLOP)) return null;
  return Math.abs(dy) <= (long ? RATIO_LONG : RATIO) * Math.abs(dx) ? 'h' : 'no';
}

// The whole stroke from touch-down, in the reader's frame: x and v negative toward the set-aside pile.
export function decide(x, y, v, w) {
  if (v >= V_BACK || Math.abs(y) > Math.abs(x)) return false;
  return x <= -commitDistance(w) || (x <= -flingDistance(w) && v <= -V_FLING);
}

// Release velocity (px/ms) from {t, x} samples, over the last WINDOW ms up to and including lift-off.
export function velocity(pts, tUp, xUp) {
  const last = pts.at(-1);
  if (!last || tUp - last.t > STOPPED) return 0;
  const first = [...pts, { t: tUp, x: xUp }].find((p) => p.t >= tUp - WINDOW);
  const span = tUp - first.t;
  return span < SPAN ? 0 : clamp((xUp - first.x) / span, -V_MAX, V_MAX);
}

// Soft limit: follows at first, then gives less and less, never passing m.
export const band = (x, m) => Math.sign(x) * m * (1 - 1 / (1 + (0.55 * Math.abs(x)) / m));
export const softY = (y) => (Math.abs(y) <= 24 ? y : Math.sign(y) * (24 + band(Math.abs(y) - 24, 24)));
// Pushed by one fingertip, a card turns about it: gripped above centre and pushed left, it turns anticlockwise.
export const tilt = (x, gy, w, h) => clamp(-10 * (x / w) * clamp(gy / (h / 2), -1, 1), -8, 8);

// Where the card lies for a finger offset (reader's frame). Nothing lies to the right, so it resists.
export function place(x, y, { w, h, gy, flat }) {
  const bx = x > 0 ? band(x, Math.min(0.12 * w, 48)) : x;
  return flat ? { x: bx, y: 0, a: 0 } : { x: bx, y: softY(y), a: tilt(bx, gy, w, h) };
}

// A thrown card keeps turning the way it was turning; a centre grip turns like the button's.
export const endAngle = (a) => (a >= 0.5 ? clamp(a + 2, 4, 8) : clamp(a - 2, -8, -4));

// The same five functions in every frame and keyframe, so animations interpolate each one.
export const pose = (B, { x, y, a }, { gx, gy }) =>
  `rotate(${B}deg) translate(${r1(x)}px, ${r1(y)}px) translate(${r1(gx)}px, ${r1(gy)}px) ` +
  `rotate(${Math.round(a * 100) / 100}deg) translate(${r1(-gx)}px, ${r1(-gy)}px)`;

// Leaves at the finger's speed and slows evenly to a stop D px later, like card stock on cloth:
// cubic-bezier(1/3, 2/3, 2/3, 1) is constant deceleration. A finger that had stopped hands over
// to the button's slide.
export function throwCurve(D, out, slow) {
  if (out < 0.1) return { duration: Math.round(clamp(340 + 0.5 * D, 360, THROW_MAX)), easing: slow };
  const T = clamp((2 * D) / out, THROW_MIN, THROW_MAX);
  return { duration: Math.round(T), easing: `cubic-bezier(0.333, ${Math.min(1, (out * T) / (3 * D)).toFixed(3)}, 0.667, 1)` };
}

// ---------------------------------------------------------------- Turn: a two-finger twist
// Two fingertips turn the card round flat on the table, as you'd turn a real card for the person
// opposite. Screen y points down, so + is clockwise, and clockwise is clockwise for everyone at the
// table: unlike the slide, a twist needs no reader's frame. Decided when the first finger lifts.

export const PAIR = 300;                          // ms: the second fingertip lands this soon after the first
export const SPREAD_MIN = 64, SPREAD_MAX = 360;   // px apart: one hand's thumb and finger, not a grip's two thumbs
export const LOCK_DEG = 12;                       // turned this far before the card moves...
export const CATCH_DEG = 24;                      // ...then it catches up with the fingers over the next 24°
export const PINCH = 0.15;                        // |ln spread ratio| before the lock: a pinch, given back to the browser
export const SPREAD_KEEP = 0.3;                   // |ln spread ratio| allowed at lift-off
export const FLOOR_DEG = 25;                      // never a Turn below this, however fast
export const TURN_DEG = 60;                       // turned, or carried by its spin, this far: it goes round
export const TAU = 150;                           // ms of spin carried on after the fingers lift
export const BOTH = 0.3;                          // both fingers turned it: the shorter travel is at least 0.3 of the longer
export const W_MAX = 1.5;                         // deg/ms
export const SPIN_MIN = 280, SPIN_MAX = 720;      // the release; SPIN_MAX is the Turn button's own 720 ms

export const wrap = (d) => d - 360 * Math.floor((d + 180) / 360);                    // into [-180, 180)
export const bearing = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

// Before the lock: null = not yet; 'twist' = ours; 'rest' | 'pinch' | 'pan' = the browser's.
// Pinch and pan are tested first, so a tie goes to zooming.
export function twistLock(theta, s, drift, d0, dt) {
  if (dt > STALE) return 'rest';
  if (Math.abs(Math.log(s)) >= PINCH) return 'pinch';
  if (drift >= Math.max(48, 0.5 * d0)) return 'pan';
  return Math.abs(theta) >= LOCK_DEG ? 'twist' : null;
}

// Card stock holds still for LOCK_DEG, then turns 1.5x the fingers until it's back under them.
// Past the half-turn it gives less and less (at most 24° more), so a long twist settles forward
// onto the half-turn instead of spinning back against the fingers.
export function drawAngle(theta) {
  const a = Math.abs(theta);
  const d = a <= LOCK_DEG ? 0 : a >= LOCK_DEG + CATCH_DEG ? a : 1.5 * (a - LOCK_DEG);
  return Math.sign(theta) * (d <= 180 ? d : 180 + band(d - 180, 24));
}

export const together = (da, db) => Math.min(da, db) >= BOTH * Math.max(da, db);

// Half-turns to add when the first finger lifts: +1, -1, or 0 to settle back square. Spin toward the
// turn only counts when both fingers turned it, so one thumb skidding past a resting one never turns
// it; spin away from the turn always counts, so turning back as you let go cancels.
export function halfTurns(theta, w, both) {
  const dir = Math.sign(theta), a = Math.abs(theta);
  const out = clamp(w * dir, -W_MAX, both ? W_MAX : 0);
  return a >= FLOOR_DEG && a + TAU * out >= TURN_DEG ? dir : 0;
}

// The card turns about the point between the fingertips, kept within a quarter of its short side of
// its centre, so the spots under the fingers stay under them.
export function pivot(dx, dy, w, h) {
  const k = Math.min(1, (0.25 * Math.min(w, h)) / (Math.hypot(dx, dy) || 1));
  return { gx: dx * k, gy: dy * k };
}

// The same five functions in every frame and keyframe; B is where Turn left it.
export const twistPose = ({ B, a, mx, my, gx, gy }) =>
  `translate(${r1(mx)}px, ${r1(my)}px) translate(${r1(gx)}px, ${r1(gy)}px) rotate(${Math.round(a * 100) / 100}deg) ` +
  `translate(${r1(-gx)}px, ${r1(-gy)}px) rotate(${B}deg)`;

// R degrees still to go: on at the fingers' w deg/ms, slowing evenly to a dead stop (the throw's maths).
// Fingers that had stopped hand over to the Turn button's own curve, 720 ms for a whole half-turn.
export function spinCurve(R, w, still) {
  const D = Math.abs(R), out = w * Math.sign(R);
  if (out < 0.05) return { duration: Math.round(clamp(220 + 2.8 * D, SPIN_MIN, SPIN_MAX)), easing: still };
  const T = clamp((2 * D) / out, SPIN_MIN, SPIN_MAX);
  return { duration: Math.round(T), easing: `cubic-bezier(0.333, ${Math.min(1, (out * T) / (3 * D)).toFixed(3)}, 0.667, 1)` };
}

// ready(): may a slide start now? key(): what's on the table (a slide dies if it changes).
// commit(): draw the next card. turn(n): turn the card n half-turns (+ clockwise).
export function attach(card, motion, { ready, key, commit, turn }) {
  if (!('PointerEvent' in window) || typeof Element.prototype.animate !== 'function') return;
  const touch = (e) => e.pointerType === 'touch';
  const down = new Map();  // every touch on the glass, wherever it landed: id -> { x0, y0, x, y, t0, face }
  let quiet = false;       // a second touch was seen: no slide starts until the glass is clear
  let clearAt = -Infinity; // when the last finger lifted
  let g = null;            // the stroke: { id, x0, y0, t0, k, long, lx, ly, drag, pts, still }
  let tw = null;           // two fingertips on the card: { a, b, d0, m0, raw, theta, s, t2, h, lx, ly, pts }

  const forget = () => { const d = g?.drag; g = null; if (d) motion.drop(d); };
  // A card held still short of the line and then moved on is a phone changing hands, not a slide.
  // Judged where it rested, so a skid that arrives in one event (or only at lift-off) counts too.
  const rested = (s, e) => e.timeStamp - s.still.t > REST && s.drag.s * (s.still.x - s.x0) > -commitDistance(s.drag.w);
  const onFace = (e) => card.contains(e.target) && e.clientX >= EDGE && e.clientX <= innerWidth - EDGE && e.clientY <= innerHeight - FOOT;
  const zoomed = () => (visualViewport?.scale ?? 1) > 1.01;
  const moved = (c) => Math.hypot(c.x - c.x0, c.y - c.y0);
  const ours = (e) => tw && (e.pointerId === tw.a || e.pointerId === tw.b);

  // Two contacts are down: may they turn the card? '' if so, otherwise why not.
  function pairBlocked() {
    const [a, b] = down.values();
    const d0 = Math.hypot(b.x - a.x, b.y - a.y);
    return !a.face || !b.face ? 'off the face' : b.t0 - a.t0 > PAIR ? 'late' : moved(a) >= SLOP ? 'first moved'
      : a.t0 - clearAt < CLEAR ? 'settling' : d0 < SPREAD_MIN || d0 > SPREAD_MAX ? 'spread'
      : g?.drag ? 'sliding' : zoomed() || motion.busy() ? 'not now' : '';
  }
  // The twist is over: n half-turns at w deg/ms, or 0 to settle back square. Whatever finger is
  // left on the glass does nothing until it is clear.
  function untwist(n = 0, w = 0) {
    const t = tw;
    tw = null;
    quiet = true;
    if (t.h) motion.twistEnd(t.h, n, w, () => turn(n));
  }
  function twistMove(e, sample = true) {
    const A = down.get(tw.a), B = down.get(tw.b), raw = bearing(A, B);
    tw.theta += wrap(raw - tw.raw);
    tw.raw = raw;
    tw.s = Math.hypot(B.x - A.x, B.y - A.y) / tw.d0;
    const mx = (A.x + B.x) / 2 - tw.m0.x, my = (A.y + B.y) / 2 - tw.m0.y;
    if (sample) {
      tw.pts.push({ t: e.timeStamp, x: tw.theta });
      while (tw.pts[0].t < e.timeStamp - 150) tw.pts.shift();
    }
    if (!tw.h) {
      const k = twistLock(tw.theta, tw.s, Math.hypot(mx, my), tw.d0, e.timeStamp - tw.t2);
      if (!k) return;
      if (k !== 'twist' || !(tw.h = motion.twistGrab(tw.m0.x + mx, tw.m0.y + my))) { tw = null; return; } // the browser's now
      tw.lx = mx; // the card starts from where it lies (decided from touch-down, drawn from here)
      tw.ly = my;
    }
    if (!motion.twistFollow(tw.h, tw.theta, mx - tw.lx, my - tw.ly)) tw = null; // settle() took the card
  }

  addEventListener('pointerdown', (e) => {
    if (!touch(e)) return;
    if (e.isPrimary) { if (tw) untwist(); forget(); down.clear(); quiet = false; } // a fresh touch sequence; drops ids that never lifted
    down.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp, face: onFace(e) });
    if (down.size === 1) return;
    if (tw) return untwist();                       // a third contact: the card goes back square
    if (down.size === 2 && !quiet && !pairBlocked()) {
      const [[a, A], [b, B]] = down;
      tw = { a, b, d0: Math.hypot(B.x - A.x, B.y - A.y), m0: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, raw: bearing(A, B),
        theta: 0, s: 1, t2: e.timeStamp, h: null, pts: [{ t: e.timeStamp, x: 0 }] };
    }
    quiet = true;
    forget();                                       // a pending slide is forgotten; a held one springs back
  }, true);
  addEventListener('pointermove', (e) => {
    const c = touch(e) && down.get(e.pointerId);
    if (!c) return;
    c.x = e.clientX;
    c.y = e.clientY;
    if (ours(e)) twistMove(e);
  }, true);
  for (const type of ['pointerup', 'pointercancel']) {
    addEventListener(type, (e) => {
      if (!touch(e)) return;
      if (ours(e)) {
        const c = down.get(e.pointerId);
        if (type === 'pointercancel' || !tw.h) untwist();
        else {
          c.x = e.clientX;
          c.y = e.clientY;
          twistMove(e, false); // the lift point is drawn and counts (fix #9)
          if (tw) {
            const w = velocity(tw.pts, e.timeStamp, tw.theta);
            const both = together(moved(down.get(tw.a)), moved(down.get(tw.b)));
            untwist(Math.abs(Math.log(tw.s)) > SPREAD_KEEP ? 0 : halfTurns(tw.theta, w, both), w);
          }
        }
      }
      if (!down.delete(e.pointerId) || down.size) return;
      quiet = false;
      clearAt = e.timeStamp;
    }, true);
  }

  card.addEventListener('pointerdown', (e) => {
    if (!touch(e) || !e.isPrimary || quiet || down.size !== 1 || e.timeStamp - clearAt < CLEAR) return;
    if (e.clientX < EDGE || e.clientX > innerWidth - EDGE || e.clientY > innerHeight - FOOT) return;
    if ((visualViewport?.scale ?? 1) > 1.01 || !ready() || motion.busy()) return;
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, k: key(), long: motion.tall(), drag: null, pts: [{ t: e.timeStamp, x: e.clientX }] };
  });

  card.addEventListener('pointermove', (e) => {
    if (e.pointerId !== g?.id) return;
    for (const c of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) g.pts.push({ t: c.timeStamp, x: c.clientX });
    while (g.pts.length > 2 && g.pts[0].t < e.timeStamp - 150) g.pts.shift();
    if (!g.drag) {
      const l = lock(e.clientX - g.x0, e.clientY - g.y0, e.timeStamp - g.t0, g.long);
      if (!l) return;
      if (l === 'no' || !ready() || key() !== g.k || !(g.drag = motion.grab(e.clientX, e.clientY))) { g = null; return; }
      g.lx = e.clientX; // the card starts from where it lies, so it never jumps
      g.ly = e.clientY;
      g.still = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    } else if (Math.hypot(e.clientX - g.still.x, e.clientY - g.still.y) >= 8) {
      if (rested(g, e)) return forget();
      g.still = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    }
    const s = g.drag.s;
    if (!motion.follow(g.drag, s * (e.clientX - g.lx), s * (e.clientY - g.ly))) g = null; // settle() took the card
  });

  card.addEventListener('pointerup', (e) => {
    if (e.pointerId !== g?.id) return;
    const { drag, pts, x0, y0, lx, ly, k, still } = g;
    g = null;
    if (!drag) return;
    const s = drag.s;
    if (!motion.follow(drag, s * (e.clientX - lx), s * (e.clientY - ly))) return; // the throw starts where the card lies
    const v = s * velocity(pts, e.timeStamp, e.clientX);
    const skid = Math.hypot(e.clientX - still.x, e.clientY - still.y) >= 8 && rested({ drag, x0, still }, e);
    const go = !skid && key() === k && decide(s * (e.clientX - x0), s * (e.clientY - y0), v, drag.w);
    if (go && motion.throwOn(drag, v)) commit();
    motion.drop(drag); // springs back, unless commit() took the card
  });

  card.addEventListener('pointercancel', (e) => { if (e.pointerId === g?.id) forget(); });
  addEventListener('resize', () => {
    const held = g?.drag || tw?.h;
    if (g?.drag) g = null;
    if (tw) { tw = null; quiet = true; } // the glass turned under the fingers: not a twist
    if (held) motion.settle();
  });

  // Two fingertips turning the card are ours from the moment they land: no zoom or pan until a
  // pinch or pan shape gives them back. (Chrome cancels every two-finger touch on a pan-y
  // pinch-zoom element otherwise.) One finger: on iPhones a sideways stroke on a long card can
  // still turn into a scroll, so claim it first.
  const IOS = CSS.supports('-webkit-touch-callout', 'none');
  card.addEventListener('touchmove', (e) => {
    if (!e.cancelable) return;
    if (tw) return e.preventDefault();
    if (!IOS || !g || e.touches.length !== 1) return;
    if (g.drag) return e.preventDefault();
    // WebKit gives up scrolling for the whole touch once one move is prevented, so judge only
    // after real travel, and only strokes the slide itself would take.
    const t = e.touches[0], dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (Math.hypot(dx, dy) < 6) return;
    if (Math.abs(dy) <= (g.long ? RATIO_LONG : RATIO) * Math.abs(dx)) e.preventDefault();
    else g = null;
  }, { passive: false });
  if ('ongesturestart' in window) {
    for (const type of ['gesturestart', 'gesturechange']) card.addEventListener(type, (e) => { if (tw) e.preventDefault(); });
  }

  // A zoomed-in page needs its fingers back for panning.
  const zoom = () => document.documentElement.classList.toggle('zoomed', (visualViewport?.scale ?? 1) > 1.01);
  visualViewport?.addEventListener('resize', zoom);
  zoom();
}
