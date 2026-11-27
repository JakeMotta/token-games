// The light model: where the sun and moon are through the day, and shadows cast from a creature's real pieces that
// point away from the light, run long when it is low and short at noon, soften with height, and follow the legs.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../prototype/genome.js');
const C = require('../chain.js');
const LT = require('../light.js');

const DEG = Math.PI / 180;
const ph = G.express(G.randomCreature('moss'), { level: 70 });
const sceneAt = (pose) => C.scene(ph, null, pose || {});
const blobsAt = (t, scene, at) => LT.shadowBlobs(LT.placeSpheres(LT.sceneSpheres(scene || sceneAt()), at || { x: 0, z: 0, th: 0 }), LT.sunAt(t), ph.scale);

test('the sun rises on the left, is highest at noon, sets on the right; then a dimmer moon', () => {
  const left = LT.sunAt(LT.NAMED.left), noon = LT.sunAt(LT.NAMED.noon), right = LT.sunAt(LT.NAMED.right), night = LT.sunAt(LT.NAMED.night);
  assert.ok(left.L[0] < -0.5 && right.L[0] > 0.5 && Math.abs(noon.L[0]) < 1e-9, 'left to right');
  assert.ok(noon.elev > left.elev && noon.elev > right.elev);
  near(noon.elev, LT.SUN_ELEV, 1e-9);
  for (const s of [left, noon, right, night]) {
    near(Math.hypot(...s.L), 1, 1e-12);
    assert.ok(s.L[1] > 0 && s.elev >= LT.MIN_ELEV - 1e-12, 'always above the horizon');
  }
  assert.equal(night.body, 'moon');
  assert.ok(night.strength < 0.5 * noon.strength && night.strength > 0, 'faint moon light');
  assert.ok(night.elev <= LT.MOON_ELEV + 1e-12);
  assert.ok(LT.sunAt(LT.NAMED.dawn).warm > 0.5 && noon.warm < 0.05, 'warm at dawn, white at noon');
  assert.ok(night.tint[2] > night.tint[0], 'blue at night');
  assert.deepEqual(LT.sunAt(1.25), LT.sunAt(0.25), 'wraps round');
});

test('time from the URL: names, numbers, fallback', () => {
  assert.equal(LT.timeFor('noon', 0), 0.25);
  assert.equal(LT.timeFor('0.4', 0), 0.4);
  assert.equal(LT.timeFor('1.5', 0), 0.5);
  assert.equal(LT.timeFor('sideways', 0.14), 0.14);
  assert.equal(LT.timeFor(null, 0.14), 0.14);
});

test('a point lands on the ground along the light', () => {
  const L = LT.sunAt(LT.NAMED.left).L, g = LT.groundPoint([1, 2, 3], L);
  near(g[0], 1 - L[0] * 2 / L[1], 1e-12);
  near(g[1], 3 - L[2] * 2 / L[1], 1e-12);
  assert.deepEqual(LT.groundPoint([1, 0, 3], L), [1, 3]);
});

test('the shadow is cast by every piece of the body', () => {
  const sc = sceneAt(), spheres = LT.sceneSpheres(sc), b = blobsAt(LT.NAMED.noon, sc);
  const pieces = new Set(sc.prims.map((p) => p.piece));
  for (const piece of pieces) assert.ok(spheres.some((q) => q.piece === piece), 'casts: ' + piece);
  assert.ok(b.length >= sc.prims.length);
  assert.ok(b.every((q) => [q.x, q.z, q.a, q.b, q.soft, q.dens].every(Number.isFinite)));
});

test('shadows point away from the light: long and thin when it is low, short at noon', () => {
  const ex = (t) => LT.extent(blobsAt(t));
  const left = ex(LT.NAMED.left), noon = ex(LT.NAMED.noon), right = ex(LT.NAMED.right);
  assert.ok(left.hx > 0.5 && right.hx < -0.5, 'sun on the left throws it right, and back');
  assert.ok(left.cx > noon.cx && noon.cx > right.cx, 'centre moves across the day');
  assert.ok(left.reach > 2 * noon.reach && right.reach > 2 * noon.reach, 'long at a low sun: ' + [left.reach, noon.reach, right.reach].map((x) => x.toFixed(2)));
  // a single raised ball: the shadow ellipse is r / sin(elevation) long and r wide
  const s = LT.sunAt(LT.NAMED.left), q = LT.blob({ c: [0, 1, 0], r: 0.5 }, s, 1);
  near(q.a, 0.5 / s.L[1], 1e-12);
  near(q.b, 0.5, 1e-12);
});

test('higher pieces cast softer, fainter shadows', () => {
  const s = LT.sunAt(LT.NAMED.noon);
  const low = LT.blob({ c: [0, 0.1, 0], r: 0.1 }, s, 1), high = LT.blob({ c: [0, 1, 0], r: 0.1 }, s, 1);
  assert.ok(high.soft > low.soft && high.dens < low.dens);
});

test('the shadow turns with the body and follows the legs', () => {
  const t = LT.NAMED.noon, a = LT.extent(blobsAt(t, null, { x: 0, z: 0, th: 0 })), b = LT.extent(blobsAt(t, null, { x: 0, z: 0, th: Math.PI / 2 }));
  assert.ok(a.width < a.length || b.width > b.length || Math.abs(a.width - b.width) > 0.05 * ph.scale, 'turning changes its shape');
  const rest = sceneAt(), legs = rest.legs.map((l) => ({ hip: l.hip, foot: [l.foot[0] + 0.3 * ph.scale, l.foot[1], l.foot[2]] }));
  const mid = (bs) => bs.reduce((m, q) => [m[0] + q.x / bs.length, m[1] + q.z / bs.length], [0, 0]);
  const m1 = mid(blobsAt(t, rest)), m2 = mid(blobsAt(t, sceneAt({ legs })));
  assert.ok(m2[0] > m1[0] + 0.005 * ph.scale, 'feet forward, shadow forward');
});

test('no light, no shadow', () => {
  assert.deepEqual(LT.shadowBlobs([{ c: [0, 1, 0], r: 1 }], { strength: 0, L: [0, 1, 0] }, 1), []);
});

test('looks: Pixel is one hard tone, Cel two, the Original soft', () => {
  const vs = Array.from({ length: 101 }, (_, i) => i / 100), tones = (style) => new Set(vs.map((v) => LT.shadeAlpha(v, style, 0.4))).size;
  assert.equal(tones('pixel'), 2);
  assert.equal(tones('cel'), 3);
  assert.ok(tones('gochi') > 50);
});

function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' vs ' + b); }
