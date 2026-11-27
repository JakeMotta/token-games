// Version 2's walk: the head leads, the chain follows within its limits, feet stay planted until they are a stride
// behind and then step, turns and spins finish, it stays inside its habitat and eats, for every leg count.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../prototype/genome.js');
const C = require('../chain.js');
const M2 = require('../motion2.js');

const SEEDS = { 0: [], 2: [], 4: [], 6: [] };
for (let i = 0; i < 400 && Object.values(SEEDS).some((a) => a.length < 1); i++) {
  const n = G.express(G.randomCreature('g' + i), { level: 100 }).legs.pairs * 2;
  if (SEEDS[n] && SEEDS[n].length < 1) SEEDS[n].push('g' + i);
}
const legged = [2, 4, 6].filter((n) => SEEDS[n].length);
const BIG = { minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6 };
const DT = 1 / 60;

// Watches every step: finite numbers, links kept, bends within limits, planted feet pinned to the ground.
function watcher(w) {
  const pinned = w.feet.map((f) => (f.planted ? [f.wx, f.wz] : null));
  const r = { slip: 0, steps: 0, bend: 0, link: 0 };
  r.see = (st) => {
    assert.ok(Number.isFinite(st.x) && Number.isFinite(st.z) && Number.isFinite(st.heading), 'finite');
    for (const j of st.pose.joints) assert.ok([j.x, j.y, j.z, j.phi].every(Number.isFinite), 'finite joint');
    const J = w.chain.joints;
    for (let i = 1; i < J.length; i++) {
      r.link = Math.max(r.link, Math.abs(Math.hypot(J[i][0] - J[i - 1][0], J[i][1] - J[i - 1][1]) - w.chain.links[i]) / w.chain.links[i]);
      r.bend = Math.max(r.bend, Math.abs(C.wrap(w.chain.angles[i] - w.chain.angles[i - 1])) - w.R.bend[i]);
    }
    w.feet.forEach((f, i) => {
      if (f.planted && pinned[i]) r.slip = Math.max(r.slip, Math.hypot(f.wx - pinned[i][0], f.wz - pinned[i][1]));
      if (!f.planted && pinned[i]) r.steps++;
      pinned[i] = f.planted ? (pinned[i] || [f.wx, f.wz]) : null;
    });
  };
  return r;
}

test('walking: it moves forward, the chain keeps its links and bend limits, planted feet never slide, every foot steps', () => {
  for (const n of legged) {
    for (const level of [5, 60, 100]) {
      const ph = G.express(G.randomCreature(SEEDS[n][0]), { level });
      const w = M2.createWalker(ph, 3, { x: 0, z: 0, heading: 0 });
      const r = watcher(w), lifted = new Set();
      for (let i = 0; i < 60 * 6; i++) {
        r.see(M2.step(w, DT, BIG, null, { walk: true, force: 'walk' }));
        w.feet.forEach((f, k) => { if (!f.planted) lifted.add(k); });
      }
      assert.ok(Math.hypot(w.x, w.z) > 0.5 * ph.scale, n + ' legs L' + level + ' moved ' + Math.hypot(w.x, w.z));
      assert.ok(r.link < 1e-6, 'links kept ' + r.link);
      assert.ok(r.bend < 1e-6, 'bends within limits ' + r.bend);
      assert.ok(r.slip < 1e-9, 'planted feet pinned ' + r.slip);
      assert.equal(lifted.size, n, n + ' legs L' + level + ': every foot stepped');
    }
  }
});

test('a 180 U-turn and a 360 spin finish and face the right way', () => {
  for (const n of legged) {
    const ph = G.express(G.randomCreature(SEEDS[n][0]), { level: 70 });
    for (const [angle, want] of [[Math.PI, Math.PI], [2 * Math.PI, 0]]) {
      const w = M2.createWalker(ph, 4, { x: 0, z: 0, heading: 0 });
      const r = watcher(w);
      for (let i = 0; i < 30; i++) r.see(M2.step(w, DT, BIG, null, { walk: true, force: 'walk' }));
      // The head turns (it leads); the body follows it round afterwards.
      const headTh = () => w.chain.angles[0], th0 = headTh();
      if (angle > 4) M2.spin(w, 1); else M2.turn(w, angle);
      let turned = 0, last = headTh(), i = 0;
      for (; i < 60 * 20 && w.mode === 'turn'; i++) {
        r.see(M2.step(w, DT, BIG, null, { walk: true }));
        turned += C.wrap(headTh() - last); last = headTh();
      }
      assert.notEqual(w.mode, 'turn', n + ' legs: turn of ' + angle.toFixed(2) + ' finished');
      assert.ok(Math.abs(Math.abs(turned) - angle) < 0.35, n + ' legs turned ' + turned.toFixed(2) + ' of ' + angle.toFixed(2));
      assert.ok(Math.abs(C.wrap(headTh() - th0 - want)) < 0.35, 'head faces the right way');
      for (let k = 0; k < 90; k++) r.see(M2.step(w, DT, BIG, null, { walk: true, force: 'walk' }));
      assert.ok(Math.abs(C.wrap(w.th - th0 - want)) < 0.6, n + ' legs: the body lined up behind ' + C.wrap(w.th - th0 - want).toFixed(2));
      assert.ok(r.slip < 1e-9 && r.bend < 1e-6, 'feet pinned and bends kept while turning');
    }
  }
});

test('roaming a small habitat: it stays inside', () => {
  for (const n of legged) {
    const ph = G.express(G.randomCreature(SEEDS[n][0]), { level: 60 });
    const s = ph.scale, area = { minX: -2 * s, maxX: 2 * s, minZ: -0.8 * s, maxZ: 0.8 * s };
    const w = M2.createWalker(ph, 7, { x: 0, z: 0, heading: 0 });
    let worst = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const st = M2.step(w, DT, area, null, { walk: true });
      const h = st.head;
      worst = Math.max(worst, area.minX - h.x, h.x - area.maxX, area.minZ - h.z, h.z - area.maxZ);
    }
    assert.ok(worst < 0.35 * s, n + ' legs strayed ' + (worst / s).toFixed(2) + ' scales');
  }
});

test('eating: it walks to food, bites it all, swallows and is happy, and gets less hungry', () => {
  for (const n of legged) {
    const ph = G.express(G.randomCreature(SEEDS[n][0]), { level: 60 });
    const w = M2.createWalker(ph, 6, { x: 0, z: 0, heading: 0, hunger: 0.8 });
    const s = ph.scale, area = { minX: -3 * s, maxX: 3 * s, minZ: -1.2 * s, maxZ: 1.2 * s };
    const food = { x: -1.2 * s, z: 0.5 * s, bites: 3, value: 0.3, kind: 'berry' }; // behind it, so it has to turn
    const events = [];
    let near = Infinity;
    for (let i = 0; i < 60 * 40 && !(food.gone && events.includes('happy')); i++) {
      const st = M2.step(w, DT, area, null, { food: food.gone ? null : food });
      for (const e of st.events) events.push(e.type);
      const m = M2.mouthAt(w); near = Math.min(near, Math.hypot(m[0] - food.x, m[1] - food.z));
    }
    assert.ok(food.gone, n + ' legs ate it (mouth got within ' + (near / s).toFixed(2) + ' scales)');
    assert.ok(events.filter((e) => e === 'bite').length === 3 && events.includes('swallow') && events.includes('happy'), events.join());
    assert.ok(w.hunger < 0.8, 'less hungry');
  }
});

test('legless creatures wriggle forward and stay finite', () => {
  if (!SEEDS[0].length) return;
  const ph = G.express(G.randomCreature(SEEDS[0][0]), { level: 80 });
  const w = M2.createWalker(ph, 2, { x: 0, z: 0, heading: 0 });
  const r = watcher(w);
  for (let i = 0; i < 60 * 5; i++) r.see(M2.step(w, DT, BIG, null, { walk: true, force: 'walk' }));
  assert.ok(Math.hypot(w.x, w.z) > 0.3 * ph.scale && r.bend < 1e-6);
});

test('the same seed walks the same way', () => {
  const ph = G.express(G.randomCreature(SEEDS[legged[0]][0]), { level: 50 });
  const run = () => { const w = M2.createWalker(ph, 9, { x: 0, z: 0, heading: 0 }); for (let i = 0; i < 600; i++) M2.step(w, DT, BIG, null, { walk: true }); return [w.x, w.z, w.th]; };
  assert.deepEqual(run(), run());
});
