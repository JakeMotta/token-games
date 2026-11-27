// Unit tests for the colour palettes (palettes.js). Run: node --test prototype/ant-farm/test/palette.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const AntSim = require('../sim.js');
const Pal = require('../palettes.js');

// a grown farm, painted once with its material kinds
function frame(seed) {
  const sim = AntSim.createSim({ seed: seed || 7 });
  sim.run(6500);
  const n = sim.W * sim.H, src = new Uint32Array(n), kind = new Uint8Array(n);
  sim.paint(src, { kind });
  return { sim, src, kind };
}
const F = frame();
const rgb = (c) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
const lum = (c) => { const [r, g, b] = rgb(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
const chroma = (c) => { const [r, g, b] = rgb(c); return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; };
function paint(id, o) { const out = new Uint32Array(F.src.length); Pal.mapper(id, o).apply(F.src, F.kind, out); return out; }
function stats(px, kinds) {
  let n = 0, l = 0, c = 0, lo = 1, hi = 0, white = 0;
  for (let i = 0; i < px.length; i++) {
    if (kinds && !kinds.includes(F.kind[i])) continue;
    const y = lum(px[i]); n++; l += y; c += chroma(px[i]); lo = Math.min(lo, y); hi = Math.max(hi, y);
    const [r, g, b] = rgb(px[i]); if (r > 245 && g > 245 && b > 245) white++;
  }
  return { luma: l / n, chroma: c / n, range: hi - lo, white };
}
const NEW = Pal.ORDER.filter((id) => id !== 'original');

test('there are at least five new palettes, plus Original', () => {
  assert.ok(NEW.length >= 5, NEW.join());
  assert.strictEqual(Pal.ORDER[0], 'original');
  for (const id of Pal.ORDER) assert.ok(Pal.PALETTES[id].name && Pal.PALETTES[id].note, id);
});

test('the painter marks what each pixel shows', () => {
  const has = (k) => F.kind.includes(k);
  for (const k of ['SKY', 'WALL', 'SOIL', 'ANT', 'QUEEN', 'GLASS']) assert.ok(has(Pal.K[k]), k);
  const q = F.sim.ants.find((a) => a.queen) || F.sim.ants[0];
  assert.strictEqual(F.kind[q.y * F.sim.W + q.x], Pal.K.QUEEN);
});

test('Original is the prototype colours, pixel for pixel', () => {
  assert.deepStrictEqual(paint('original'), F.src);
});

test('the new palettes are calmer: less colour and less contrast than Original, no pure white', () => {
  const o = stats(F.src);
  for (const id of NEW) for (const dark of [true, false]) {
    const s = stats(paint(id, { dark }));
    assert.ok(s.chroma < o.chroma * 0.75, id + ' chroma ' + s.chroma.toFixed(3) + ' vs ' + o.chroma.toFixed(3));
    assert.ok(s.chroma < 0.2, id + ' mean chroma ' + s.chroma.toFixed(3));
    assert.ok(s.range < o.range, id + ' range ' + s.range.toFixed(3) + ' vs ' + o.range.toFixed(3));
    assert.strictEqual(s.white, 0, id + ' has pure white');
  }
});

test('the ants still stand out from the tunnel wall in every palette', () => {
  const K = Pal.K;
  for (const id of Pal.ORDER) for (const dark of [true, false]) {
    const px = paint(id, { dark }), ant = stats(px, [K.ANT]).luma, wall = stats(px, [K.WALL]).luma;
    const ratio = (Math.max(ant, wall) + 0.05) / (Math.min(ant, wall) + 0.05);
    assert.ok(ratio > 1.3, id + (dark ? ' dark' : ' light') + ' ant/wall contrast ' + ratio.toFixed(2));
  }
});

test('Calm lowers saturation and contrast in any palette', () => {
  for (const id of Pal.ORDER) {
    const a = stats(paint(id)), b = stats(paint(id, { calm: 1 }));
    assert.ok(b.chroma < a.chroma * 0.6, id + ' chroma ' + a.chroma.toFixed(3) + ' → ' + b.chroma.toFixed(3));
    assert.ok(b.range < a.range, id + ' range');
  }
});

test('Desktop Blend follows the desktop: light on light, dark on dark', () => {
  const l = stats(paint('blend', { dark: false })), d = stats(paint('blend', { dark: true }));
  assert.ok(l.luma > d.luma + 0.3, l.luma.toFixed(2) + ' vs ' + d.luma.toFixed(2));
  assert.notStrictEqual(Pal.resolve('blend', false).ui.back, Pal.resolve('blend', true).ui.back);
});

test('a mapper redraws only what changed, and gets the same answer as a fresh one', () => {
  const m = Pal.mapper('slate', { calm: 0.3 }), out = new Uint32Array(F.src.length);
  m.apply(F.src, F.kind, out);
  F.sim.run(60);
  const src2 = new Uint32Array(F.src.length), kind2 = new Uint8Array(F.src.length);
  F.sim.paint(src2, { kind: kind2 });
  m.apply(src2, kind2, out);
  const fresh = new Uint32Array(F.src.length);
  Pal.mapper('slate', { calm: 0.3 }).apply(src2, kind2, fresh);
  assert.deepStrictEqual(out, fresh);
});

test('an unknown palette falls back to Original', () => {
  assert.strictEqual(Pal.resolve('nope').id, 'original');
});
