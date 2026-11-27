// Camera input maths: what a wheel event means, panning 1:1, zooming about the pointer, drag momentum.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWheel, wheelPixels, panBy, pinchFactor, wheelFactor, easeZoom, zoomDone, Inertia, LINE_PX, FRICTION_MS } from '../src/game/input';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test('wheel events: trackpad scrolls pan, pinches zoom, mouse wheels zoom', () => {
  assert.equal(classifyWheel({ deltaX: 3, deltaY: -7, deltaMode: 0, ctrlKey: false }), 'pan', 'two-finger scroll');
  assert.equal(classifyWheel({ deltaX: 0, deltaY: -2.5, deltaMode: 0, ctrlKey: true }), 'pinch', 'a pinch arrives as ctrl + wheel');
  assert.equal(classifyWheel({ deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false }), 'wheel', 'line mode is a mouse wheel');
  assert.equal(classifyWheel({ deltaX: 0, deltaY: 40, deltaMode: 0, ctrlKey: false, wheelDeltaY: -120 }), 'wheel', 'a notch in pixel mode');
  assert.equal(classifyWheel({ deltaX: 0, deltaY: 13, deltaMode: 0, ctrlKey: false, wheelDeltaY: -39 + 1 }), 'pan', 'a trackpad never lines up with wheelDelta');
});

test('wheel deltas in lines or pages become pixels', () => {
  assert.deepEqual(wheelPixels({ deltaX: 2, deltaY: -3, deltaMode: 0, ctrlKey: false }, 500), { dx: 2, dy: -3 });
  assert.deepEqual(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false }, 500), { dx: 0, dy: 3 * LINE_PX });
  assert.deepEqual(wheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 2, ctrlKey: false }, 500), { dx: 0, dy: 500 });
});

test('panning is 1:1 on screen at any zoom', () => {
  for (const s of [0.25, 1, 6]) {
    const c = panBy({ x: 100, y: 50, s }, 30, -12);
    assert.ok(near((c.x - 100) * s, 30) && near((c.y - 50) * s, -12), 'zoom ' + s);
    assert.equal(c.s, s);
  }
});

test('pinching and the wheel zoom in and out symmetrically', () => {
  assert.ok(pinchFactor(-10) > 1 && pinchFactor(10) < 1);
  assert.ok(near(pinchFactor(-10) * pinchFactor(10), 1));
  assert.ok(wheelFactor(-100) > 1 && near(wheelFactor(-100) * wheelFactor(100), 1));
  assert.ok(pinchFactor(-10) > wheelFactor(-10), 'a pinch is finer-grained per event than a wheel notch is per pixel');
});

test('zoom eases toward its goal and keeps the point under the pointer still', () => {
  const cam = { x: 10, y: 20, s: 1 }, goal = { s: 4, sx: 160, sy: 90 };
  const world = (c: typeof cam) => ({ x: c.x + goal.sx / c.s, y: c.y + goal.sy / c.s });
  const w0 = world(cam);
  let c = cam;
  const first = easeZoom(c, goal, 16);
  assert.ok(first.s > 1 && first.s < 4, 'eases, not a jump');
  for (let i = 0; i < 60 && !zoomDone(c, goal); i++) c = easeZoom(c, goal, 16);
  assert.ok(zoomDone(c, goal), 'arrives within a second');
  const w1 = world(c);
  assert.ok(near(w0.x, w1.x, 1e-6) && near(w0.y, w1.y, 1e-6), 'the pointed-at cell stays under the pointer');
  assert.equal(easeZoom(cam, goal, 16, { instant: true }).s, 4, 'reduced motion: no easing');
  assert.equal(easeZoom(cam, { s: 100, sx: 0, sy: 0 }, 16, { instant: true, max: 24 }).s, 24, 'zoom limits hold');
});

test('a drag released while moving glides on and slows to a stop', () => {
  const m = new Inertia();
  for (let t = 0; t <= 80; t += 16) m.track(8, 0, t); // 0.5 px/ms
  assert.ok(m.release(84));
  assert.ok(m.moving && near(m.vx, 0.5, 0.1));
  const v0 = m.vx;
  let travelled = 0, frames = 0;
  for (let d = m.step(16); d; d = m.step(16)) { travelled += d.dx; frames++; }
  assert.ok(!m.moving);
  assert.ok(Math.abs(travelled - v0 * FRICTION_MS) < v0 * FRICTION_MS * 0.05, 'about speed × friction: ' + travelled);
  assert.ok(frames < 200, 'stops within a few seconds');
});

test('a slow or paused release just stops', () => {
  const m = new Inertia();
  for (let t = 0; t <= 80; t += 16) m.track(0.5, 0, t);
  assert.equal(m.release(84), false);
  const p = new Inertia();
  for (let t = 0; t <= 80; t += 16) p.track(10, 0, t);
  assert.equal(p.release(400), false, 'held still before letting go');
  assert.equal(p.step(16), null);
});
