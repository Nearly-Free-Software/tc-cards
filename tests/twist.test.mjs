// The pure parts of the two-finger twist: when it's a twist, how far is enough, and how the card lies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPIN_MAX, SPIN_MIN, bearing, drawAngle, halfTurns, pivot, spinCurve, together, twistLock, twistPose, velocity, wrap,
} from '../public/swipe.js';

test('angles unwrap across the ±180° seam, clockwise positive (screen y is down)', () => {
  assert.deepEqual([190, -190, 180, 359, 721].map(wrap), [-170, 170, -180, -1, 1]);
  assert.equal(bearing({ x: 0, y: 0 }, { x: 1, y: 0 }), 0);
  assert.equal(bearing({ x: 0, y: 0 }, { x: 0, y: 1 }), 90);
  let theta = 0, prev = 170;
  for (const raw of [175, -179, -170, -100]) { theta += wrap(raw - prev); prev = raw; }
  assert.equal(theta, 90);
});

test('twistLock: pinch, pan and resting fingers go to the browser first; 12° is a twist', () => {
  assert.equal(twistLock(11.9, 1, 0, 160, 100), null);
  assert.equal(twistLock(12, 1, 0, 160, 100), 'twist');
  assert.equal(twistLock(-12, 1, 0, 160, 100), 'twist');
  assert.equal(twistLock(20, 1.17, 0, 160, 100), 'pinch');
  assert.equal(twistLock(20, 0.86, 0, 160, 100), 'pinch');
  assert.equal(twistLock(20, 1.16, 0, 160, 100), 'twist');
  assert.equal(twistLock(5, 1, 80, 160, 100), 'pan');
  assert.equal(twistLock(5, 1, 79, 160, 100), null);
  assert.equal(twistLock(5, 1, 47, 60, 100), null);   // the 48 px floor
  assert.equal(twistLock(30, 1, 0, 160, 501), 'rest');
});

test('drawAngle holds for 12°, catches up by 36°, then follows 1:1', () => {
  assert.deepEqual([0, 12, 18, 24, 36, 90, -24, -6].map(drawAngle).map((a) => a + 0), [0, 0, 9, 18, 36, 90, -18, 0]);
  let prev = 0;
  for (let a = 0; a <= 60; a += 0.5) { assert.ok(drawAngle(a) >= prev); prev = drawAngle(a); }
});

test('halfTurns: one half-turn either way, by angle or by a two-finger spin; never a skid', () => {
  const cases = [
    [80, 0, true, 1], [-80, 0, true, -1], [59.9, 0, true, 0], [60, 0, true, 1],
    [30, 0.2, true, 1], [30, 0.19, true, 0],     // thrown: 30 + 150 ms of spin
    [30, 0.4, false, 0], [70, 0, false, 1],     // about one still finger: only by angle
    [24.9, 1.5, true, 0],                       // the floor
    [85, -0.17, true, 0], [100, -0.17, true, 1], [70, -0.1, true, 0], // turning back as you let go
    [-35, -0.3, true, -1], [-35, 0.3, true, 0],
    [300, 0, true, 1],                          // always exactly one half-turn
    [33.7, 0.24, false, 0],                     // a thumb skidding 200 px in 120 ms past a resting one
    [0, 1, true, 0],
  ];
  for (const [th, w, both, n] of cases) assert.equal(halfTurns(th, w, both), n, `${th}, ${w}, ${both}`);
});

test('together: both fingers moved, the shorter at least 0.3 of the longer', () => {
  assert.equal(together(100, 30), true);
  assert.equal(together(100, 29), false);
  assert.equal(together(0, 0), true);
});

test('pivot: the fingertips’ midpoint, at most a quarter of the short side from the centre', () => {
  assert.deepEqual(pivot(200, 0, 342, 479), { gx: 85.5, gy: 0 });
  assert.deepEqual(pivot(5, 10, 342, 479), { gx: 5, gy: 10 });
});

test('twistPose: the same five functions held and at rest, the base turn last', () => {
  const fns = (s) => s.match(/[a-z]+\(/g).join('');
  const held = twistPose({ B: 180, a: 37.5, mx: 3, my: -4, gx: 20, gy: 30 });
  const rest = twistPose({ B: 180, a: 180, mx: 0, my: 0, gx: 0, gy: 0 });
  assert.equal(fns(held), fns(rest));
  assert.ok(rest.endsWith('rotate(180deg)'));
});

test('spinCurve: from the fingers’ speed to a dead stop, within the Turn button’s 720 ms', () => {
  assert.deepEqual(spinCurve(180, 0, 'S'), { duration: 720, easing: 'S' });   // a still release: the button's own curve
  assert.equal(spinCurve(100, 0, 'S').duration, 500);
  assert.equal(spinCurve(20, 0, 'S').duration, 280);
  assert.equal(spinCurve(-50, 0.5, 'S').easing, 'S');                         // moving away from the target
  assert.deepEqual(spinCurve(110, 0.4, 'S'), { duration: 550, easing: 'cubic-bezier(0.333, 0.667, 0.667, 1)' });
  const { duration, easing } = spinCurve(145, 0.37, 'S');
  const y1 = Number(easing.split(',')[1]);
  assert.ok(Math.abs((145 / duration) * (y1 / 0.333) - 0.37) < 0.01 || duration === SPIN_MAX);
  for (const [R, w] of [[1, 1], [179, 0.05], [155, 1.5], [-120, -0.3]]) {
    const d = spinCurve(R, w, 'S').duration;
    assert.ok(d >= SPIN_MIN && d <= SPIN_MAX, `${R} ${w} ${d}`);
  }
});

test('velocity measures angles too: 0.5°/ms, and 0 once the fingers had stopped', () => {
  const pts = Array.from({ length: 12 }, (_, i) => ({ t: i * 16, x: i * 8 }));
  assert.ok(Math.abs(velocity(pts, 192, 96) - 0.5) < 0.01);
  assert.equal(velocity(pts, 176 + 81, 88), 0);
});

test('past the half-turn the card gives less and less, so a long twist settles forward onto it', () => {
  assert.equal(drawAngle(180), 180);
  let prev = 180;
  for (const a of [190, 220, 290, 400, 1000]) {
    const d = drawAngle(a);
    assert.ok(d > prev && d < 204, `${a} -> ${d}`);
    prev = d;
  }
  assert.equal(drawAngle(-290), -drawAngle(290));
});
