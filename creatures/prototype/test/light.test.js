// The light (light.js) and the cast shadow (render.js): the sun crosses from the left at dawn over the top at noon to
// the right at dusk, a faint moon takes over at night, the shadow is cast away from the light, longer when it is low,
// and it is the body's own: it follows the heading and the legs, and each look gets its own kind of edge.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../light.js');
const G = require('../genome.js');
const R = require('../render.js');
const M = require('../motion.js');

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-9), (msg || '') + ` ${a} ≈ ${b}`);
const len = (v) => Math.hypot(v[0], v[1], v[2]);

test('the sun rises on the left, is highest at noon and sets on the right', () => {
  const dawn = L.at(7), noon = L.at(12), dusk = L.at(17);
  assert.equal(dawn.kind, 'sun'); assert.equal(noon.kind, 'sun'); assert.equal(dusk.kind, 'sun');
  assert.ok(dawn.dir[0] < -0.5, 'morning light comes from the left (-x)');
  assert.ok(dusk.dir[0] > 0.5, 'evening light comes from the right (+x)');
  near(noon.dir[0], 0, 1e-9, 'noon is straight over the top');
  assert.ok(noon.elev > dawn.elev && noon.elev > dusk.elev);
  near(dawn.elev, dusk.elev, 1e-9, 'the day is symmetric');
  assert.ok(dawn.sky.x < 0.5 && dusk.sky.x > 0.5 && Math.abs(noon.sky.x - 0.5) < 1e-9, 'the sky picture agrees');
  for (const h of [0, 3, 6, 7.5, 9, 12, 15, 18, 21]) near(len(L.at(h).dir), 1, 1e-9, 'unit dir at ' + h);
});

test('the sweep is smooth: the light moves steadily from left to right through the day', () => {
  let prev = -Infinity;
  for (let h = 6.5; h <= 17.5; h += 0.25) { const x = L.at(h).dir[0]; assert.ok(x > prev, 'x grows at ' + h); prev = x; }
});

test('low sun, long shadow; noon, short shadow; never longer than the floor allows', () => {
  const s = (h) => L.shadowLength(1, L.at(h).dir);
  assert.ok(s(6.5) > 2 * s(12), `dawn ${s(6.5)} vs noon ${s(12)}`);
  assert.ok(s(17.5) > 2 * s(12));
  for (let h = 0; h < 24; h += 0.25) {
    const l = L.at(h);
    assert.ok(l.dir[1] >= Math.sin(L.MIN_ELEV) - 1e-9, 'cast elevation clamped at ' + h);
    assert.ok(L.shadowLength(1, l.dir) <= L.MAX_REACH + 1e-9);
  }
});

test('night: no sun, only a faint moon; dawn is warm and night is cool', () => {
  const night = L.at(23), noon = L.at(12), dawn = L.at(6.4);
  assert.equal(night.kind, 'moon'); assert.equal(night.phase, 'night');
  assert.ok(night.strength > 0 && night.strength < 0.5 * noon.strength);
  assert.ok(night.soft < noon.soft, 'the moon shadow is softer');
  assert.ok(dawn.tint[0] > dawn.tint[2], 'dawn tint is warm');
  assert.ok(night.tint[2] > night.tint[0], 'night tint is cool');
  assert.deepEqual(noon.tint, [255, 255, 255], 'midday is untinted');
  assert.ok(L.at(1).strength >= 0 && L.at(5.5).strength >= 0);
  assert.equal(L.clock(17.5), '17:30'); assert.equal(L.clock(24.25), '00:15');
});

test('ground projection and the body frame', () => {
  const dir = L.at(8).dir, g = L.ground([0.2, 1, -0.1], dir);
  near(g[1], 0, 1e-12);
  assert.ok(g[0] > 0.2, 'a point lit from the left lands to its right');
  near(Math.hypot(g[0] - 0.2, g[2] + 0.1), L.shadowLength(1, dir), 1e-9);
  // Turning the body turns the light the other way, keeping its height; heading 0 is the world frame.
  assert.deepEqual(L.toBody(dir, 0).map((v) => +v.toFixed(12)), dir.map((v) => +v.toFixed(12)));
  const b = L.toBody(dir, 1.1);
  near(b[1], dir[1]); near(len(b), 1, 1e-12);
  const back = L.toBody(b, -1.1);
  for (let i = 0; i < 3; i++) near(back[i], dir[i], 1e-12);
  // The walker moves (cos h, -sin h) in x, z: in its own frame that is straight ahead (+x).
  const fwd = L.toBody([Math.cos(0.7), 0, -Math.sin(0.7)], 0.7);
  near(fwd[0], 1, 1e-12); near(fwd[2], 0, 1e-12);
});

// ---------- the cast shadow ----------
const scene = (seed, pose) => R.creatureScene(G.express(G.randomCreature(seed), { level: 70 }), pose || {});
const camFor = (heading) => ({ w: 160, h: 110, px: 0.022, yaw: -heading, pitch: 0.45, center: [0, 0.3, 0] });
const lightAt = (hours, heading) => { const l = L.at(hours); return { dir: L.toBody(l.dir, heading), strength: l.strength, soft: l.soft, rgb: l.shadowRgb }; };
function shape(res) {
  let bx = 0, bn = 0, sx = 0, sn = 0, alphas = new Set(), x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < res.mask.length; i++) {
    const x = i % res.w;
    if (res.mask[i] === 1) { bx += x; bn++; }
    if (res.mask[i] === 2) { sx += x; sn++; alphas.add(res.rgba[i * 4 + 3]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  }
  return { dx: sx / sn - bx / bn, n: sn, alphas: alphas.size, span: x1 - x0 };
}
const cast = (seed, hours, heading, style, pose) => shape(R.render(scene(seed, pose), camFor(heading), { style, light: lightAt(hours, heading) }));

test('the shadow falls away from the sun, for 2, 4 and 6 legs, from any heading', () => {
  for (const seed of ['g37', 'moss', 'g12']) for (const heading of [-0.8, 0, 1.6, Math.PI]) {
    const am = cast(seed, 8, heading), pm = cast(seed, 16, heading);
    assert.ok(am.n > 50 && pm.n > 50, seed + ' has a shadow');
    assert.ok(am.dx > 2, `${seed} heading ${heading}: morning shadow to the right (${am.dx})`);
    assert.ok(pm.dx < -2, `${seed} heading ${heading}: evening shadow to the left (${pm.dx})`);
  }
});

test('the shadow stretches with a low sun and shrinks at noon', () => {
  const dawn = cast('moss', 6.6, -0.8), noon = cast('moss', 12, -0.8);
  assert.ok(dawn.span > 1.4 * noon.span, `${dawn.span} vs ${noon.span}`);
});

test('the shadow is the body\'s own: legs and turns change it', () => {
  const ph = G.express(G.randomCreature('moss'), { level: 70 }), w = M.createWalker(ph, 3, { heading: 0 });
  const seen = new Set();
  for (let i = 0; i < 36; i++) {
    const st = M.step(w, 1 / 12, { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, null, { walk: true, force: 'walk' });
    if (i % 6 !== 5) continue;
    const res = R.render(R.creatureScene(ph, st.pose), camFor(0), { light: lightAt(9, 0) });
    let h = 0; for (let j = 0; j < res.mask.length; j++) if (res.mask[j] === 2) h = (Math.imul(h, 31) + j * 7 + res.rgba[j * 4 + 3]) >>> 0;
    seen.add(h);
  }
  assert.ok(seen.size >= 4, 'leg poses cast different shadows: ' + seen.size);
  const a = cast('g12', 9, 0), b = cast('g12', 9, Math.PI / 2);
  assert.notEqual(a.n, b.n, 'turning changes the outline');
});

test('soft edge for the Original, one flat tone (plus contact) for Cel and Pixel', () => {
  const soft = cast('moss', 9, -0.8, 'gochi'), cel = cast('moss', 9, -0.8, 'cel'), pix = cast('moss', 9, -0.8, 'pixel');
  assert.ok(soft.alphas > 12, 'soft has a penumbra ' + soft.alphas);
  assert.ok(cel.alphas <= 3, 'cel is flat ' + cel.alphas);
  assert.ok(pix.alphas <= 3, 'pixel is flat ' + pix.alphas);
});

test('night casts only a faint moon shadow; no light means no cast shadow but the contact shade stays', () => {
  const alphaSum = (res) => { let s = 0; for (let i = 0; i < res.mask.length; i++) if (res.mask[i] === 2) s += res.rgba[i * 4 + 3]; return s; };
  const r = (hours, strength) => { const l = lightAt(hours, -0.8); if (strength != null) l.strength = strength; return R.render(scene('moss'), camFor(-0.8), { light: l }); };
  const day = alphaSum(r(12)), night = alphaSum(r(23)), none = alphaSum(r(12, 0));
  assert.ok(night < 0.75 * day, `night ${night} < day ${day}`);
  assert.ok(none > 0 && none < night, 'only contact shade without light');
});

test('a hop lifts the shadow away from the feet', () => {
  const sc = scene('moss'), lifted = scene('moss', { lift: 0.4 });
  const contact = (s) => { const res = R.render(s, camFor(-0.8), { style: 'cel', light: lightAt(12, -0.8) }); let n = 0; for (let i = 0; i < res.mask.length; i++) if (res.mask[i] === 2 && res.rgba[i * 4 + 3] > 120) n++; return n; };
  assert.ok(contact(lifted) < contact(sc), 'less dark contact when lifted');
});
