// The pure parts of the card gestures: when a stroke counts, how far and fast is enough, and how the card lies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THROW_MAX, band, commitDistance, decide, endAngle, flingDistance, lock, place, pose, softY, throwCurve, tilt, velocity,
} from '../public/swipe.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test('lock waits for the slop, then takes only roughly sideways strokes made promptly', () => {
  assert.equal(lock(5, 5, 100), null);
  assert.equal(lock(10, 0, 100), 'h');
  assert.equal(lock(-10, 7, 100), 'h');   // exactly 0.7
  assert.equal(lock(10, 7.2, 100), 'no');
  assert.equal(lock(0, 12, 100), 'no');   // a scroll
  assert.equal(lock(12, 0, 520), 'no');   // the finger rested first
  assert.equal(lock(3, 0, 600), 'no');
});

test('long cards need a plainer, longer sideways stroke, so a scrolling thumb never slides', () => {
  assert.equal(lock(12, 0, 100, true), null);
  assert.equal(lock(14, 0, 100, true), 'h');
  assert.equal(lock(-20, 10, 100, true), 'no'); // about 27°: a slide on a short card, a scroll on a long one
  assert.equal(lock(-20, 10, 100, false), 'h');
});

test('commit and fling distances scale with the card and are clamped', () => {
  assert.equal(commitDistance(200), 112);
  near(commitDistance(342), 136.8);
  assert.equal(commitDistance(600), 168);
  assert.equal(flingDistance(200), 64);
  near(flingDistance(342), 75.24);
  assert.equal(flingDistance(600), 96);
});

test('decide: far enough, or a real flick; never backwards, against the pull, or mostly vertical', () => {
  const w = 342;
  assert.equal(decide(-137, 0, 0, w), true);
  assert.equal(decide(-136, 0, 0, w), false);
  assert.equal(decide(-80, 0, -0.6, w), true);
  assert.equal(decide(-74, 0, -2, w), false);   // under the fling floor
  assert.equal(decide(-100, 0, -0.5, w), false); // too slow for a flick, too short for a slide
  assert.equal(decide(-200, 0, 0.3, w), false);  // flicked back as it let go
  assert.equal(decide(-200, 0, 0.29, w), true);
  assert.equal(decide(200, 0, -1, w), false);    // the wrong way
  assert.equal(decide(-150, -151, 0, w), false); // skidded off down-left: a phone being taken
  assert.equal(decide(-150, 150, 0, w), true);
  assert.equal(decide(-167, 0, 0, 600), false);
  assert.equal(decide(-168, 0, 0, 600), true);
});

test('velocity uses the last 100 ms up to lift-off, and is 0 when the finger had stopped', () => {
  const pts = (rate, step) => Array.from({ length: 20 }, (_, i) => ({ t: i * step, x: i * step * rate }));
  for (const step of [33, 16.7, 8.3]) {
    const p = pts(-1, step);
    const last = p.at(-1);
    near(velocity(p, last.t + step, (last.t + step) * -1), -1, 0.05);
  }
  const p = pts(-1, 16.7);
  assert.equal(velocity(p, p.at(-1).t + 81, p.at(-1).x), 0);           // stopped, then lifted
  assert.equal(velocity([{ t: 0, x: 0 }], 10, -30), 0);               // too short a span
  assert.equal(velocity([{ t: 0, x: 0 }, { t: 20, x: -400 }], 30, -500), -4); // clamped
  // Samples older than the window don't count: a slow start then a fast finish is fast.
  const mixed = [{ t: 0, x: 0 }, { t: 400, x: -10 }, { t: 450, x: -60 }, { t: 500, x: -110 }];
  near(velocity(mixed, 500, -110), -1, 0.01);
});

test('the card follows 1:1 to the left, resists to the right, and wanders only a little vertically', () => {
  const d = { w: 342, h: 479, gy: -120, flat: false };
  assert.equal(place(-150, 0, d).x, -150);
  let prev = 0;
  for (const x of [10, 40, 100, 300, 1000]) {
    const bx = place(x, 0, d).x;
    assert.ok(bx > prev && bx < Math.min(0.12 * d.w, 48), `${bx}`);
    prev = bx;
  }
  assert.equal(softY(20), 20);
  assert.ok(softY(500) < 48 && softY(-500) > -48);
  assert.deepEqual(place(-150, 30, { ...d, flat: true }), { x: -150, y: 0, a: 0 });
  near(band(0, 40), 0);
});

test('tilt: gripped above centre and pushed left turns anticlockwise; a centre grip does not turn', () => {
  assert.ok(tilt(-150, -100, 342, 479) < 0);
  assert.ok(tilt(-150, 100, 342, 479) > 0);
  assert.equal(Math.abs(tilt(-150, 0, 342, 479)), 0);
  assert.equal(tilt(-5000, -400, 342, 479), 8 * Math.sign(tilt(-5000, -400, 342, 479)));
  assert.ok(Math.abs(tilt(-5000, -400, 342, 479)) <= 8);
});

test('a thrown card keeps turning its way', () => {
  assert.equal(endAngle(0), -4);
  assert.equal(endAngle(-3), -5);
  assert.equal(endAngle(3), 5);
  assert.equal(endAngle(-7), -8);
  assert.equal(endAngle(0.4), -4);
});

test('throwCurve leaves at the finger speed, slows evenly, and stays within the budget', () => {
  const slow = throwCurve(300, 0.05, 'SLOW');
  assert.equal(slow.easing, 'SLOW');
  assert.ok(slow.duration >= 360 && slow.duration <= THROW_MAX);
  for (const [D, out] of [[282, 1.2], [352, 2.5], [300, 4], [500, 0.4], [40, 3]]) {
    const { duration, easing } = throwCurve(D, out, 'SLOW');
    assert.ok(duration >= 280 && duration <= THROW_MAX, `${duration}`);
    const y1 = Number(easing.match(/cubic-bezier\(0\.333, ([\d.]+),/)[1]);
    assert.ok(y1 <= 1);
    if (2 * D / out >= 280 && 2 * D / out <= THROW_MAX) near((D / duration) * (y1 / 0.333), out, out * 0.05);
  }
});

test('every pose has the same five functions, so animations interpolate them one by one', () => {
  const shape = (s) => s.replace(/-?[\d.]+/g, 'n');
  const g = { gx: 12, gy: -80 };
  assert.equal(shape(pose(0, { x: 0, y: 0, a: 0 }, g)), shape(pose(180, { x: -150.25, y: 7, a: -3.3 }, g)));
  assert.ok(pose(180, { x: 0, y: 0, a: 0 }, g).startsWith('rotate(180deg) '));
});
