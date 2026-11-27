// Palettes and the camera: pure, no canvas needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/sim';
import { K } from '../src/sim/world';
import { mapper, ORDER, resolve } from '../src/game/palettes';
import { fit, lerp, near, zoomAt } from '../src/game/camera';
import { PALETTE_IDS } from '../src/shared/settings';

// a grown farm, painted once with its material kinds
const sim = createSim({ seed: 7 });
sim.run(6500);
const n = sim.W * sim.H, SRC = new Uint32Array(n), KIND = new Uint8Array(n);
sim.paint(SRC, { kind: KIND });

const rgb = (c: number) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
const lum = (c: number) => { const [r, g, b] = rgb(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
const chroma = (c: number) => { const [r, g, b] = rgb(c); return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; };
function paint(id: string, o: { dark?: boolean; calm?: number } = {}) { const out = new Uint32Array(n); mapper(id, o).apply(SRC, KIND, out); return out; }
function stats(px: Uint32Array, kinds?: number[]) {
  let m = 0, l = 0, c = 0, lo = 1, hi = 0, white = 0;
  for (let i = 0; i < px.length; i++) {
    if (kinds && !kinds.includes(KIND[i])) continue;
    const y = lum(px[i]); m++; l += y; c += chroma(px[i]); lo = Math.min(lo, y); hi = Math.max(hi, y);
    const [r, g, b] = rgb(px[i]); if (r > 245 && g > 245 && b > 245) white++;
  }
  return { luma: l / m, chroma: c / m, range: hi - lo, white };
}
const CALM = ORDER.filter((id) => id !== 'original');

test('every palette the settings offer exists, in the same order', () => {
  assert.deepEqual([...ORDER], [...PALETTE_IDS]);
});

test('Original is the prototype colours, pixel for pixel', () => {
  assert.deepEqual(paint('original'), SRC);
});

test('the other palettes are calmer: less colour and less contrast than Original, no pure white', () => {
  const o = stats(SRC);
  for (const id of CALM) for (const dark of [true, false]) {
    const s = stats(paint(id, { dark }));
    assert.ok(s.chroma < o.chroma * 0.75 && s.chroma < 0.2, id + ' chroma ' + s.chroma.toFixed(3));
    assert.ok(s.range < o.range, id + ' range');
    assert.equal(s.white, 0, id + ' has pure white');
  }
});

test('the ants still stand out from the tunnel wall in every palette', () => {
  for (const id of ORDER) for (const dark of [true, false]) {
    const px = paint(id, { dark }), ant = stats(px, [K.ANT]).luma, wall = stats(px, [K.WALL]).luma;
    const ratio = (Math.max(ant, wall) + 0.05) / (Math.min(ant, wall) + 0.05);
    assert.ok(ratio > 1.3, id + (dark ? ' dark' : ' light') + ' ant/wall contrast ' + ratio.toFixed(2));
  }
});

test('Calm lowers saturation and contrast in any palette', () => {
  for (const id of ORDER) {
    const a = stats(paint(id)), b = stats(paint(id, { calm: 1 }));
    assert.ok(b.chroma < a.chroma * 0.6, id + ' chroma');
    assert.ok(b.range < a.range, id + ' range');
  }
});

test('Desktop Blend follows the desktop: light on light, dark on dark', () => {
  const l = stats(paint('blend', { dark: false })), d = stats(paint('blend', { dark: true }));
  assert.ok(l.luma > d.luma + 0.3);
  assert.notEqual(resolve('blend', false).ui.back, resolve('blend', true).ui.back);
});

test('a mapper redraws only what changed, and gets the same answer as a fresh one', () => {
  const m = mapper('slate', { calm: 0.3 }), out = new Uint32Array(n);
  m.apply(SRC, KIND, out);
  const s2 = createSim({ seed: 7 }); s2.run(6560);
  const src2 = new Uint32Array(n), kind2 = new Uint8Array(n);
  s2.paint(src2, { kind: kind2 });
  m.apply(src2, kind2, out);
  const fresh = new Uint32Array(n);
  mapper('slate', { calm: 0.3 }).apply(src2, kind2, fresh);
  assert.deepEqual(out, fresh);
});

test('an unknown palette falls back to Original', () => {
  assert.equal(resolve('nope', true).id, 'original');
});

test('camera fit centres the box and snaps big scales to whole numbers', () => {
  const cam = fit({ x: 10, y: 20, w: 100, h: 50 }, 640, 400, { pad: 0 });
  assert.equal(cam.s, 6);
  assert.ok(Math.abs(cam.x + 640 / cam.s / 2 - 60) < 1e-9 && Math.abs(cam.y + 400 / cam.s / 2 - 45) < 1e-9);
});

test('camera zoom keeps the point under the cursor; ease', () => {
  const cam = { x: 5, y: 7, s: 2 }, z = zoomAt(cam, 100, 60, 1.5);
  assert.ok(Math.abs(cam.x + 100 / cam.s - (z.x + 100 / z.s)) < 1e-9);
  let m = { x: 0, y: 0, s: 1 }; const b = { x: 100, y: 50, s: 4 };
  for (let i = 0; i < 200; i++) m = lerp(m, b, 0.1, 400, 300);
  assert.ok(near(m, b));
});
