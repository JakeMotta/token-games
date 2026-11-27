// Unit tests for the top-down drawing (topdown.js): pure geometry, the splayed rig, and that draw() runs for every style.
// Run: node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../prototype/genome.js');
const C = require('../../prototype-v2/chain.js');
const M2 = require('../../prototype-v2/motion2.js');
const LT = require('../../prototype-v2/light.js');
const TD = require('../topdown.js');

const SEEDS = ['moss', 'g5', 'g9', 'g12', 'a', 'b', 'test'];
const AREA = { minX: -4, maxX: 4, minZ: -3, maxZ: 3 };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function walker(seed, level, heading) {
  const ph = G.express(G.randomCreature(seed), { level: level || 100 });
  const w = M2.createWalker(ph, G.hashSeed(seed), { rig: TD.rig(ph), heading: heading || 0 });
  return w;
}

// A 2D context that records nothing but checks every number it is given is finite.
function stubCtx(shared) {
  const calls = shared || { n: 0 };
  return new Proxy({}, {
    get(t, k) {
      if (k === 'calls') return calls;
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(200) });
      if (k === 'measureText') return () => ({ width: 10 });
      return (...a) => { calls.n++; for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite argument to ' + String(k)); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const stubCanvas = (calls) => (W, H) => ({ width: W, height: H, getContext: () => stubCtx(calls) });

test('outline of a straight chain is closed and mirror-symmetric about the spine', () => {
  for (const seed of SEEDS) {
    const w = walker(seed, 100, 0);
    M2.place(w, 0, 0, 0); w.tail.a = 0;
    const poly = TD.outline(w);
    const J = w.chain.joints;
    // straight along +x at z = 0
    for (const p of J) assert.ok(Math.abs(p[1]) < 1e-9, seed + ' chain is straight');
    // closed: no gap from the last point back to the first bigger than the longest edge inside it
    let longest = 0;
    for (let i = 1; i < poly.length; i++) longest = Math.max(longest, dist(poly[i], poly[i - 1]));
    assert.ok(dist(poly[poly.length - 1], poly[0]) <= longest + 1e-9, seed + ' outline closes');
    // every point has its mirror image (x, -z) in the polygon
    for (const p of poly) {
      const best = Math.min(...poly.map((q) => Math.hypot(q[0] - p[0], q[1] + p[1])));
      assert.ok(best < 1e-9, seed + ' mirror of ' + p + ' missing (' + best + ')');
    }
    // the tip lies on the spine, behind the last joint
    assert.ok(Math.abs(poly.tip[1]) < 1e-9 && poly.tip[0] < J[J.length - 1][0], seed + ' tail tip on the spine');
  }
});

test('outline width at each joint is the rig radius', () => {
  for (const seed of SEEDS) {
    const w = walker(seed, 60, 0.7);
    for (let i = 0; i < 90; i++) M2.step(w, 1 / 60, AREA, null, { walk: true }); // bent, not straight
    const f = TD.frameOf(w), poly = TD.outline(w, { frame: f });
    f.pts.forEach((p, i) => {
      assert.ok(Math.abs(dist(poly.right[i], p) - w.R.joints[i].w) < 1e-9, seed + ' right width at ' + i);
      assert.ok(Math.abs(dist(poly.left[i], p) - w.R.joints[i].w) < 1e-9, seed + ' left width at ' + i);
      // perpendicular to the spine's heading there
      const d = [poly.right[i][0] - p[0], poly.right[i][1] - p[1]], fw = C.dirOf(f.ang[i]);
      assert.ok(Math.abs(d[0] * fw[0] + d[1] * fw[1]) < 1e-9, seed + ' width is sideways at ' + i);
    });
  }
});

test('legIK2D keeps both bone lengths and bends the knee to the side asked', () => {
  const cases = [[[0, 0], [1.2, 0.3], 0.8], [[1, 1], [1.5, 2.1], [0.7, 0.9]], [[0, 0], [0, -1], 0.6], [[-2, 0.5], [-1.1, 0.9], 0.5]];
  for (const [hip, foot, len] of cases) {
    const a = Array.isArray(len) ? len[0] : len, b = Array.isArray(len) ? len[1] : len;
    for (const side of [1, -1]) {
      const r = TD.legIK2D(hip, foot, len, side);
      assert.ok(Math.abs(dist(hip, r.knee) - a) < 1e-9, 'upper bone length');
      assert.ok(Math.abs(dist(r.knee, r.foot) - b) < 1e-9, 'lower bone length');
      assert.ok(dist(r.foot, foot) < 1e-9, 'foot reached when in reach');
      const u = [foot[0] - hip[0], foot[1] - hip[1]], k = [r.knee[0] - hip[0], r.knee[1] - hip[1]];
      const cross = -u[1] * k[0] + u[0] * k[1]; // dot with n = (-uz, ux)
      assert.ok(Math.sign(cross) === side, 'knee on side ' + side);
    }
  }
  // the knee bends outward: away from the body when asked to lean outward
  const hip = [0, 0.2], foot = [0.3, 0.9], out = [0, 1];
  const r = TD.legIK2D(hip, foot, 0.5, out);
  const mid = [(hip[0] + foot[0]) / 2, (hip[1] + foot[1]) / 2];
  assert.ok((r.knee[0] - mid[0]) * 1 + (r.knee[1] - mid[1]) * 0 !== 0, 'knee is off the line');
  const n = [-(foot[1] - hip[1]), foot[0] - hip[0]];
  assert.ok(Math.sign((r.knee[0] - mid[0]) * n[0] + (r.knee[1] - mid[1]) * n[1]) === Math.sign(n[0] * out[0] + n[1] * out[1]), 'knee leans the way asked');
  // out of reach: the leg goes straight toward the target
  const far = TD.legIK2D([0, 0], [5, 0], [1, 1], 1);
  assert.ok(far.straight && dist(far.foot, [2, 0]) < 1e-9 && Math.abs(far.knee[1]) < 1e-6);
});

test('shadowOffset points away from the light and grows as the sun gets lower', () => {
  const left = LT.sunAt(LT.NAMED.left), noon = LT.sunAt(LT.NAMED.noon), right = LT.sunAt(LT.NAMED.right);
  for (const sun of [left, noon, right, LT.sunAt(LT.NAMED.morning), LT.sunAt(LT.NAMED.afternoon)]) {
    const d = TD.shadowOffset(sun, 1), L = sun.L;
    assert.ok(d[0] * L[0] + d[1] * L[2] < 0, 'away from the light at ' + sun.label);
  }
  assert.ok(TD.shadowOffset(left, 1)[0] > 0 && TD.shadowOffset(right, 1)[0] < 0, 'morning shadow to the right, evening to the left');
  // longer as the sun lowers through the morning
  let prev = 0;
  for (const t of [0.25, 0.2, 0.15, 0.1, 0.06]) {
    const len = Math.hypot(...TD.shadowOffset(LT.sunAt(t), 1));
    assert.ok(len >= prev - 1e-12, 'grows as the sun lowers (t=' + t + ')');
    prev = len;
  }
  assert.ok(Math.hypot(...TD.shadowOffset(left, 1)) > 2 * Math.hypot(...TD.shadowOffset(noon, 1)));
  assert.ok(Math.hypot(...TD.shadowOffset(left, 1)) <= TD.MAX_RATIO + 1e-9, 'capped');
  // scales with height; nothing for no sun or no height
  const a = TD.shadowOffset(left, 0.5), b = TD.shadowOffset(left, 1);
  assert.ok(Math.abs(b[0] - 2 * a[0]) < 1e-12);
  assert.deepEqual(TD.shadowOffset(null, 1), [0, 0]);
  assert.deepEqual(TD.shadowOffset(left, 0), [0, 0]);
  // darker at a low sun than at noon; only faint at night
  const night = LT.sunAt(LT.NAMED.night);
  assert.ok(TD.shadowAlpha(left) > TD.shadowAlpha(noon) * 0.9);
  assert.ok(TD.shadowAlpha(night) < TD.shadowAlpha(noon) * 0.6, 'faint moon shadow');
});

test('rig() splays the feet out to the sides', () => {
  for (const seed of SEEDS) {
    const ph = G.express(G.randomCreature(seed), { level: 100 }), R0 = C.rig(ph), R = TD.rig(ph);
    assert.equal(R.hips.length, R0.hips.length);
    assert.ok(R.topdown);
    R.hips.forEach((hp, i) => {
      const side = hp.side < 0 ? -1 : 1;
      assert.equal(Math.sign(hp.foot[2]), side, seed + ' foot on its own side');
      assert.ok(Math.abs(hp.foot[2]) >= Math.abs(hp.off[2]) + 0.5 * R.legLen, seed + ' foot out past the hip');
      assert.ok(Math.abs(hp.foot[2]) > R.joints[hp.joint].w, seed + ' foot outside the body');
      assert.ok(Math.abs(hp.foot[2]) > Math.abs(R0.hips[i].foot[2]), seed + ' wider than version 2');
    });
  }
});

test('a walker with the splayed rig walks, and its planted feet stay put', () => {
  for (const seed of SEEDS) {
    const w = walker(seed, 100, 0.3);
    const pinned = w.feet.map((f) => [f.wx, f.wz]);
    let slip = 0, steps = 0, moved = 0, linkErr = 0;
    const x0 = w.x, z0 = w.z;
    for (let i = 0; i < 60 * 15; i++) {
      M2.step(w, 1 / 60, AREA, null, { walk: true, drive: i < 60 * 8 ? { v: 0.8, om: 0.4 } : null });
      const air = w.tuck > 0.01; // flying: feet tucked up under the body, not standing
      w.feet.forEach((f, k) => {
        if (air) { pinned[k] = null; return; }
        if (f.planted && pinned[k]) slip = Math.max(slip, dist([f.wx, f.wz], pinned[k]));
        if (!f.planted && pinned[k]) steps++;
        pinned[k] = f.planted ? (pinned[k] || [f.wx, f.wz]) : null;
      });
      const J = w.chain.joints;
      for (let j = 1; j < J.length; j++) linkErr = Math.max(linkErr, Math.abs(dist(J[j], J[j - 1]) - w.chain.links[j]) / w.chain.links[j]);
      moved = Math.max(moved, Math.hypot(w.x - x0, w.z - z0));
    }
    assert.ok(moved > 0.5 * w.R.s, seed + ' walked ' + moved);
    assert.ok(slip < 1e-9, seed + ' planted foot slipped ' + slip);
    if (w.feet.length) assert.ok(steps > 6, seed + ' feet stepped');
    assert.ok(linkErr < 0.02, seed + ' links held');
    // standing feet are out to the side of the spine, not under it
    w.feet.forEach((f, k) => {
      const hp = w.R.hips[k], J = w.chain.joints[hp.joint], r = [Math.sin(w.chain.angles[hp.joint]), Math.cos(w.chain.angles[hp.joint])];
      const lateral = (f.wx - J[0]) * r[0] + (f.wz - J[1]) * r[1];
      assert.ok(Math.abs(lateral) > w.R.joints[hp.joint].w * 0.8, seed + ' foot ' + k + ' out to the side');
    });
  }
});

test('draw() runs on a stub context for every style, with and without the skeleton', () => {
  const view = { scale: 84, ox: 320, oy: 180 };
  for (const seed of SEEDS) {
    for (const level of [1, 40, 100]) {
      const w = walker(seed, level, 1);
      let out;
      for (let i = 0; i < 120; i++) out = M2.step(w, 1 / 60, AREA, null, { walk: true });
      for (const style of TD.STYLES.concat(['gochi'])) {
        for (const time of [LT.NAMED.left, LT.NAMED.noon, LT.NAMED.night]) {
          const ctx = stubCtx(); // the Pixel look paints into small canvases from the factory, so count those too
          const r = TD.draw(ctx, w, view, { style, sun: LT.sunAt(time), out, skeleton: level === 100, canvas: stubCanvas(ctx.calls) });
          assert.ok(ctx.calls.n > 50, seed + ' ' + style + ' drew ' + ctx.calls.n);
          assert.ok(r && r.box && r.box.x1 > r.box.x0 && r.box.y1 > r.box.y0, 'bounds');
        }
      }
      const sk = stubCtx(); TD.skeleton(sk, w, view, { out, sun: LT.sunAt(0.2) });
      assert.ok(sk.calls.n > 10, 'skeleton alone draws');
    }
  }
  // no canvas factory: the Pixel look falls back to drawing straight onto the context
  const w = walker('moss', 100, 0), ctx = stubCtx();
  TD.draw(ctx, w, view, { style: 'pixel', sun: LT.sunAt(0.2) });
  assert.ok(ctx.calls.n > 50);
});
