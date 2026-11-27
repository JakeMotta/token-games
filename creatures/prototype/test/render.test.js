// Renderer and motion: the same creature draws the same pixels, every level draws differently, bodies and eggs are
// non-empty with an ink outline, the walker keeps planted feet and only flies with big enough wings, and every look (the
// style switcher) draws creature and egg without touching the genome.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../genome.js');
const R = require('../render.js');
const M = require('../motion.js');

const hash = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
const draw = (ph, opts) => {
  const sc = R.creatureScene(ph, {});
  return R.render(sc, R.frameCamera(sc, 64, 64, { fit: true }), opts || {});
};
const count = (res, m) => res.mask.reduce((n, x) => n + (x === m), 0);

test('the same creature draws the same pixels', () => {
  const ph = G.express(G.randomCreature('px'), { level: 40 });
  assert.equal(hash(draw(ph).rgba), hash(draw(ph).rgba));
});

test('every level draws a different picture (fixed camera)', () => {
  const c = G.randomCreature('lv');
  const adult = R.creatureScene(G.express(c, { level: 100 }), {});
  const cam = R.frameCamera(adult, 64, 64, { px: R.frameCamera(adult, 64, 64, { fit: true }).px, groundRow: 54 });
  let prev = null;
  for (let level = 1; level <= 100; level++) {
    const res = R.render(R.creatureScene(G.express(c, { level }), {}), cam, {});
    const h = hash(res.rgba);
    assert.notEqual(h, prev, 'level ' + level);
    assert.ok(count(res, 1) > 20, 'level ' + level + ' has a body');
    prev = h;
  }
});

test('the body has a dark outline, a shadow, and a see-through background', () => {
  const res = draw(G.express(G.randomCreature('ink'), { level: 100 }));
  assert.ok(count(res, 1) > 300);
  assert.ok(count(res, 2) > 10, 'ground shadow');
  let ink = 0, clear = 0;
  for (let i = 0; i < res.mask.length; i++) {
    const [r, g, b, a] = res.rgba.subarray(i * 4, i * 4 + 4);
    if (res.mask[i] === 1 && r + g + b < 160) ink++;
    if (res.mask[i] === 0 && a === 0) clear++;
  }
  assert.ok(ink > 40, 'outline pixels ' + ink);
  assert.ok(clear > 1000, 'transparent pixels ' + clear);
});

test('all styles draw (the renderer is pluggable)', () => {
  const ph = G.express(G.randomCreature('st'), { level: 70 });
  const seen = new Set();
  for (const style of Object.keys(R.styles)) {
    const res = draw(ph, { style });
    assert.ok(count(res, 1) > 300, style);
    seen.add(hash(res.rgba));
  }
  assert.ok(Object.keys(R.styles).length >= 4);
  assert.equal(seen.size, Object.keys(R.styles).length);
});

test('eggs draw, crack and open', () => {
  const look = G.eggLook(G.randomCreature('egg'));
  const r = (pose) => { const sc = R.eggScene(look, pose); return R.render(sc, R.frameCamera(sc, 48, 48, { fit: true })); };
  const whole = r({}), cracked = r({ crack: 1 }), open = r({ crack: 1, open: 1 });
  assert.ok(count(whole, 1) > 300);
  assert.notEqual(hash(whole.rgba), hash(cracked.rgba));
  assert.notEqual(hash(cracked.rgba), hash(open.rgba));
});

test('walking: feet stay planted, the walker stays inside its strip', () => {
  const ph = G.express(G.randomCreature('walk'), { level: 100 });
  const w = M.createWalker(ph, 7);
  let minX = 0, maxX = 0;
  for (let i = 0; i < 600; i++) {
    const st = M.step(w, 1 / 30, -1, 1);
    minX = Math.min(minX, st.x); maxX = Math.max(maxX, st.x);
    for (const f of st.pose.feet) assert.ok(f.every(Number.isFinite));
  }
  assert.ok(minX >= -1 - 1e-9 && maxX <= 1 + 1e-9);
  assert.ok(maxX - minX > 0.05, 'it moved');
});

// ---------- looks (the style switcher) ----------
const fitCam = (sc) => R.frameCamera(sc, 64, 64, { fit: true });
const colours = (res) => { const s = new Set(); for (let i = 0; i < res.mask.length; i++) if (res.mask[i] === 1) s.add(res.rgba.subarray(i * 4, i * 4 + 3).join()); return s; };
const brightest = (res) => { let b = 0; for (let i = 0; i < res.mask.length; i++) if (res.mask[i] === 1) b = Math.max(b, res.rgba[i * 4] + res.rgba[i * 4 + 1] + res.rgba[i * 4 + 2]); return b; };

test('every look draws the creature, its egg and the hatching, each look differently', () => {
  assert.ok(R.looks.length >= 6);
  const c = G.randomCreature('looks');
  const ph = G.express(c, { level: 80 }), look = G.eggLook(c);
  const seen = new Set();
  for (const style of R.looks) {
    assert.ok(R.styles[style].label, style + ' has a label');
    const res = draw(ph, { style });
    assert.ok(count(res, 1) > 300, style);
    seen.add(hash(res.rgba));
    for (const pose of [{}, { crack: 1 }, { crack: 1, open: 1 }]) {
      const sc = R.eggScene(look, pose);
      assert.ok(count(R.render(sc, fitCam(sc), { style }), 1) > 200, style + ' egg ' + JSON.stringify(pose));
    }
  }
  assert.equal(seen.size, R.looks.length);
});

test('a look is only drawing: the genome and body stay the same', () => {
  const c = G.randomCreature('same');
  const fp = G.fingerprint(c), ph = JSON.stringify(G.express(c, { level: 50 }));
  for (const style of R.looks) for (const palette of [null, 'gameboy']) draw(G.express(c, { level: 50 }), { style, palette, shine: 0.3 });
  assert.equal(G.fingerprint(c), fp);
  assert.equal(JSON.stringify(G.express(c, { level: 50 })), ph);
});

test('the default look is the original at full shine', () => {
  const ph = G.express(G.randomCreature('dflt'), { level: 60 });
  assert.equal(hash(draw(ph).rgba), hash(draw(ph, { style: 'gochi', shine: 1 }).rgba));
});

test('pixel palettes limit the colours: Game Boy is four greens', () => {
  const ph = G.express(G.randomCreature('pal'), { level: 90 });
  const gb = colours(draw(ph, { style: 'pixel', palette: 'gameboy' }));
  assert.ok(gb.size <= 4, 'gameboy ' + gb.size);
  const allowed = new Set(R.PALETTES.gameboy.map((p) => p.join()));
  for (const k of gb) assert.ok(allowed.has(k), k);
  for (const name of ['pico8', 'earth']) {
    const set = colours(draw(ph, { style: 'pixel', palette: name }));
    for (const k of set) assert.ok(R.PALETTES[name].some((p) => p.join() === k), name + ' ' + k);
  }
});

test('the shine slider takes the glint away', () => {
  const ph = G.express(G.randomCreature('shiny'), { level: 100, overrides: { gloss: 1 } });
  const hi = brightest(draw(ph, { shine: 1 })), lo = brightest(draw(ph, { shine: 0 }));
  assert.ok(lo < hi, `shine 0 brightest ${lo} < shine 1 brightest ${hi}`);
  for (const style of ['matte', 'cel']) assert.ok(brightest(draw(ph, { style, shine: 0 })) <= brightest(draw(ph, { style, shine: 1 })), style);
});

test('wings: only big enough wings lift the body', () => {
  let flyer = null, trier = null;
  for (let i = 0; i < 200 && !(flyer && trier); i++) {
    const ph = G.express(G.randomCreature('w' + i), { level: 100 });
    if (ph.wings.size <= 0) continue;
    if (M.canFly(ph)) flyer = flyer || ph; else trier = trier || ph;
  }
  assert.ok(flyer && trier, 'both kinds exist');
  const run = (ph) => { const w = M.createWalker(ph, 3); let up = 0, flapped = false; for (let i = 0; i < 3000; i++) { const s = M.step(w, 1 / 20, -2, 2); if (s.flying) up = Math.max(up, s.lift); if (s.trying) flapped = true; } return { up, flapped }; };
  assert.ok(run(flyer).up > 0.05, 'a flyer flies');
  const t = run(trier);
  assert.ok(t.flapped && t.up === 0, 'too-small wings try but never fly');
});

test('reduced motion: no walking, no flying', () => {
  const ph = G.express(G.randomCreature('calm'), { level: 100 });
  const w = M.createWalker(ph, 1);
  for (let i = 0; i < 400; i++) { const s = M.step(w, 1 / 20, -2, 2, { reduced: true }); assert.equal(s.x, 0); assert.equal(s.flying, false); }
});
