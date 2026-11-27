// The camera's limits: how far you may zoom out and in, and the view kept inside the world below its strip of sky.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, limits, MAX_SCALE, MAX_VIEW, MIN_VIEW } from '../src/game/camera';
const CHUNK = 64; // cells a side of a map chunk

const big = { x0: 0, y0: 27, x1: 65536, y1: 16384 }; // the largest map, cut below its sky
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('zoomed all the way out, the view holds a fixed area at any window size, so the tiles stay bounded', () => {
  for (const [vw, vh] of [[320, 180], [418, 276], [1280, 720], [2560, 1440], [500, 900]]) {
    const { min } = limits(vw, vh, big);
    const cw = vw / min, ch = vh / min;
    assert.ok(cw <= MAX_VIEW.w + 1e-6 && ch <= MAX_VIEW.h + 1e-6, `${vw}×${vh} shows ${cw}×${ch} cells`);
    const tiles = (Math.ceil(cw / CHUNK) + 1) * (Math.ceil(ch / CHUNK) + 1);
    assert.ok(tiles <= 140, `${vw}×${vh}: ${tiles} chunks on screen`);
  }
});

test('zoomed all the way in, the shorter side still shows a dozen cells, and never past the top scale', () => {
  assert.ok(near(limits(320, 180, big).max, 180 / MIN_VIEW));
  assert.equal(limits(2560, 1440, big).max, MAX_SCALE);
  const small = limits(60, 40, big);
  assert.ok(small.max >= small.min, 'a tiny view still has a range');
});

test('a world smaller than the view is shown whole, not zoomed past', () => {
  const tiny = { x0: 0, y0: 5, x1: 200, y1: 120 }, { min } = limits(1280, 720, tiny);
  assert.ok(near(min, Math.max(1280 / MAX_VIEW.w, 720 / MAX_VIEW.h, Math.min(1280 / 200, 720 / 115))));
  assert.ok(1280 / min <= 200 + 1e-6 || 720 / min <= 115 + 1e-6, 'one side of the world fills the view');
  assert.equal(limits(100, 100, tiny, 3).min, 3, 'the renderer\'s floor wins when it is higher');
});

test('the view stays inside the world: no panning past an edge or up into the cut sky', () => {
  const vw = 640, vh = 360, s = 2;
  const left = clamp({ x: -500, y: -500, s }, big, vw, vh);
  assert.equal(left.x, 0); assert.equal(left.y, big.y0);
  const right = clamp({ x: 1e9, y: 1e9, s }, big, vw, vh);
  assert.equal(right.x, big.x1 - vw / s); assert.equal(right.y, big.y1 - vh / s);
  const inside = clamp({ x: 300, y: 400, s }, big, vw, vh);
  assert.deepEqual(inside, { x: 300, y: 400, s });
  const bar = clamp({ x: 0, y: -500, s }, big, vw, vh, 28);
  assert.equal(bar.y, big.y0 - 28 / s, 'the title bar may cover the sky strip, not the ground');
});

test('a view bigger than the world is centred on it', () => {
  const w = { x0: 0, y0: 10, x1: 100, y1: 60 }, c = clamp({ x: 37, y: -80, s: 2 }, w, 400, 200);
  assert.equal(c.x + 200 / 2, 50);
  assert.equal(c.y + 100 / 2, 35);
});
