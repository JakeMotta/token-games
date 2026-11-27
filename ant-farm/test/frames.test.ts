// What frames cost and what the farm does about it: the frame meter behind the performance readout, the quality
// governor that draws less when frames run long, and the culling that keeps a frame to what is on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameMeter } from '../src/game/meter';
import { Governor, LEVELS } from '../src/game/quality';
import { limits } from '../src/game/camera';
import { visibleBox, visibleChunks } from '../src/game/render';

test('the frame meter counts the last two seconds and sums up since a reset', () => {
  const m = new FrameMeter(2000);
  for (let t = 0; t < 4000; t += 50) m.add(t, t < 2000 ? 2 : 6); // 20 frames a second, 2 ms then 6 ms
  const r = m.recent(3999);
  assert.ok(Math.abs(r.fps - 20) <= 0.5, 'fps ' + r.fps);
  assert.equal(r.ms, 6, 'only the recent frames count');
  const s = m.summary(4000);
  assert.equal(s.frames, 80); assert.equal(s.fps, 20); assert.equal(s.ms, 4); assert.equal(s.max, 6); assert.equal(s.slow, 0);
  m.add(4000, 30);
  assert.equal(m.summary(4050).slow, 1, 'a frame longer than a screen refresh counts as slow');
  m.reset();
  assert.deepEqual(m.recent(5000), { fps: 0, ms: 0 });
});

test('the governor steps down after frames run long for a while, not after one slow frame', () => {
  const g = new Governor(10, 1500, 10_000);
  let t = 0;
  g.add(80, t); // one hitch
  for (; t < 1000; t += 16) g.add(3, t);
  assert.equal(g.quality.level, 0, 'a single slow frame changes nothing');
  for (; t < 5000; t += 16) g.add(20, t);
  assert.ok(g.quality.level >= 1, 'long frames for seconds: lighter drawing');
  assert.ok(g.quality.dprCap <= 1, 'first to go is the extra resolution');
  for (; t < 12_000; t += 16) g.add(25, t);
  assert.equal(g.quality.level, LEVELS.length - 1);
  assert.equal(g.quality.soft, false, 'then the soft edges');
  assert.equal(LEVELS.every((q) => q.tileBudgetMs > 0), true, 'every level still repaints changed soil');
});

test('the governor comes back up only after a long stretch of easy frames, without flipping back and forth', () => {
  const g = new Governor(10, 1500, 10_000);
  let t = 0, changes = 0, last = 0;
  for (; t < 6000; t += 16) g.add(20, t);
  const low = g.quality.level;
  assert.ok(low > 0);
  for (; t < 12_000; t += 16) g.add(2, t);
  assert.equal(g.quality.level, low, 'a few seconds of easy frames are not enough');
  for (; t < 40_000; t += 16) g.add(2, t);
  assert.equal(g.quality.level, 0, 'back to full quality');
  g.reset();
  // frames hovering around the budget never make it oscillate
  for (t = 0; t < 60_000; t += 16) { g.add(t % 32 ? 7 : 9, t); if (g.quality.level !== last) { changes++; last = g.quality.level; } }
  assert.equal(changes, 0);
});

test('a frame draws only the chunks on screen, and zoomed all the way out that is a bounded number on any map', () => {
  const world = { x0: 0, y0: 27, x1: 65536, y1: 16384 };
  for (const [vw, vh, dpr] of [[320, 180, 2], [1280, 720, 1.5], [2560, 1440, 1]]) {
    const s = limits(vw, vh, world).min, cam = { x: 30000, y: 40, s };
    const b = visibleBox(cam, vw * dpr, vh * dpr, dpr, world.x1, world.y1), c = visibleChunks(b);
    const n = (c.cx1 - c.cx0 + 1) * (c.cy1 - c.cy0 + 1);
    assert.ok(b.x0 >= 30000 && b.x1 <= 30000 + vw / s + 1 && b.y1 <= 40 + vh / s + 1, 'the box is the view');
    assert.ok(n <= 14 * 9, `${vw}×${vh}: ${n} chunks`);
  }
});
