// The video's constraint chain: distance and angle constraints, the follow pass, two-bone FABRIK legs, and the rig and
// scene built from the genome, for 2, 4 and 6 legs.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../prototype/genome.js');
const C = require('../chain.js');

const SEEDS = { 0: [], 2: [], 4: [], 6: [] };
for (let i = 0; i < 400 && Object.values(SEEDS).some((a) => a.length < 1); i++) {
  const n = G.express(G.randomCreature('g' + i), { level: 100 }).legs.pairs * 2;
  if (SEEDS[n] && SEEDS[n].length < 1) SEEDS[n].push('g' + i);
}
const legCounts = Object.keys(SEEDS).filter((n) => SEEDS[n].length).map(Number);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' vs ' + b);

test('distance constraint puts the point on the circle, in the same direction', () => {
  const p = C.constrainDistance([3, 4], [0, 0], 2);
  near(Math.hypot(p[0], p[1]), 2, 1e-12);
  near(p[0] / p[1], 3 / 4, 1e-12);
  const same = C.constrainDistance([0, 0], [0, 0], 1); // degenerate: still at the right distance
  near(Math.hypot(same[0], same[1]), 1, 1e-12);
});

test('angle constraint clamps the shortest way round', () => {
  near(C.constrainAngle(0.5, 0, 0.2), 0.2, 1e-12);
  near(C.constrainAngle(-0.5, 0, 0.2), -0.2, 1e-12);
  near(C.constrainAngle(0.1, 0, 0.2), 0.1, 1e-12);
  // across the ±π seam: 3.1 and -3.1 are 0.083 apart, not 6.2
  near(C.wrap(C.constrainAngle(-3.1, 3.1, 0.2) - 3.1), C.wrap(-3.1 - 3.1), 1e-9);
});

test('follow keeps every link length and never bends a joint past its limit', () => {
  const n = 12, links = [0, ...Array(n - 1).fill(0.1)], bend = Array(n).fill(0.25);
  const ch = C.straight({ joints: Array(n), angles: Array(n), links }, 0, 0, 0);
  // drag the head round a tight circle: the chain must curl but stay within its limits
  for (let i = 0; i < 400; i++) {
    const a = i * 0.05;
    C.follow(ch, 0.3 * Math.cos(a), -0.3 * Math.sin(a), a + Math.PI / 2, bend);
    for (let j = 1; j < n; j++) {
      near(Math.hypot(ch.joints[j][0] - ch.joints[j - 1][0], ch.joints[j][1] - ch.joints[j - 1][1]), 0.1, 1e-9, 'link ' + j);
      assert.ok(Math.abs(C.wrap(ch.angles[j] - ch.angles[j - 1])) <= bend[j] + 1e-9, 'bend ' + j);
    }
  }
});

test('straight lays the chain out behind the head', () => {
  const ch = C.straight({ joints: Array(4), angles: Array(4), links: [0, 1, 1, 1] }, 5, 0, 0);
  assert.deepEqual(ch.joints.map((p) => p[0]), [5, 4, 3, 2]);
  near(C.headingOf(...C.dirOf(1.2)), 1.2, 1e-12);
});

test('FABRIK reaches a target in range, keeping bone lengths, and stretches straight toward one out of range', () => {
  const r = C.fabrik([[0, 0, 0], [0.5, 0.5, 0], [1, 1, 0]], [1, 1], [1.2, -0.4, 0.3]);
  assert.ok(r.reached, 'reached');
  near(Math.hypot(...[0, 1, 2].map((k) => r.points[1][k] - r.points[0][k])), 1, 1e-6);
  near(Math.hypot(...[0, 1, 2].map((k) => r.points[2][k] - r.points[1][k])), 1, 1e-6);
  const far = C.fabrik([[0, 0, 0], [1, 0, 0], [2, 0, 0]], [1, 1], [0, 5, 0]);
  assert.equal(far.reached, false);
  near(far.points[2][1], 2, 1e-12);
  near(far.error, 3, 1e-12);
});

test('a FABRIK leg bends its knee toward the pole', () => {
  const leg = C.legFabrik([0, 1, 0], [0.2, 0, 0], 1.4, [1, 0, 0]);
  assert.ok(leg.reached);
  assert.ok(leg.knee[0] > 0.1, 'knee points forward ' + leg.knee[0]);
  const back = C.legFabrik([0, 1, 0], [0.2, 0, 0], 1.4, [-1, 0, 0]);
  assert.ok(back.knee[0] < leg.knee[0], 'pole flips the knee');
});

test('the rig is deterministic, sized by the genome, and has a hip for every leg', () => {
  for (const n of legCounts) {
    for (const level of [1, 50, 100]) {
      const ph = G.express(G.randomCreature(SEEDS[n][0]), { level });
      const a = C.rig(ph), b = C.rig(ph);
      assert.deepEqual(a.links, b.links, 'same links');
      assert.ok(a.joints.length >= C.MIN_JOINTS && a.joints.length <= C.MAX_JOINTS, n + ' legs: ' + a.joints.length + ' joints');
      assert.equal(a.links[0], 0);
      assert.ok(a.links.slice(1).every((l) => l > 0 && Number.isFinite(l)));
      assert.equal(a.hips.length, ph.legs.pairs * 2, 'hips');
      assert.ok(a.anchor > 0 && a.anchor < a.joints.length - 1, 'anchor inside the chain');
      assert.ok(a.bend.every((x) => x > 0 && x <= Math.max(...Object.values(C.MAX_BEND))));
    }
  }
});

test('the scene draws every leg count, rest and curled, with finite prims', () => {
  for (const n of legCounts) {
    const ph = G.express(G.randomCreature(SEEDS[n][0]), { level: 80 });
    const R = C.rig(ph), rest = C.scene(ph, R, {});
    assert.ok(rest.prims.length > 5 && rest.legs.length === n, n + ' legs');
    // curl the chain to its bend limits and draw again
    const ch = C.straight({ joints: R.joints.map(() => null), angles: R.joints.map(() => 0), links: R.links.slice() }, 0, 0, 0);
    for (let i = 0; i < 200; i++) C.follow(ch, Math.cos(i * 0.1), -Math.sin(i * 0.1), i * 0.1 + Math.PI / 2, R.bend);
    const curled = C.scene(ph, R, { joints: ch.joints.map((p, i) => ({ x: p[0], y: R.joints[i].y, z: p[1], phi: ch.angles[i] })) });
    assert.equal(curled.prims.length, rest.prims.length, 'same pieces when curled');
    for (const p of curled.prims) for (const k of ['a', 'b', 'c']) if (p[k]) assert.ok(p[k].every(Number.isFinite), 'finite ' + p.piece);
  }
});
