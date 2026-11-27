// The walk: a gait clock per leg count, feet that stay put while they hold the body up, legs that never over-stretch,
// strides that grow with the creature, clean starts, stops and turns, for 2, 4 and 6 legs at every level 1..100.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../genome.js');
const B = require('../body.js');
const M = require('../motion.js');

const SLIP_TOL = 1e-6;   // world units a planted foot may move (none: it is pinned)
const STRETCH_MAX = 0.985; // hip-to-foot over leg length, with the body moving (MAX_STRETCH plus a little for springs)

// Two seeds for each leg count.
const SEEDS = { 2: [], 4: [], 6: [] };
for (let i = 0; i < 400 && Object.values(SEEDS).some((a) => a.length < 2); i++) {
  const n = G.express(G.randomCreature('g' + i), { level: 100 }).legs.pairs * 2;
  if (SEEDS[n] && SEEDS[n].length < 2) SEEDS[n].push('g' + i);
}

// Walk for `secs` (forced), checking every substep: planted feet don't move in the world, legs don't over-stretch.
function walk(ph, secs, mode, check) {
  const w = M.createWalker(ph, 5);
  const pinned = new Map();
  let slip = 0, stretch = 0, lastPhase = 0, wraps = 0;
  const lifts = ph.legs.pairs * 2 ? new Array(ph.legs.pairs * 2).fill(0) : [];
  let prevState = null;
  for (let i = 0; i < secs * 60; i++) {
    const st = M.step(w, 1 / 60, -1e6, 1e6, { force: mode || 'walk' });
    assert.ok(st.gait.phase >= 0 && st.gait.phase < 1, 'phase in [0,1)');
    if (st.gait.phase < lastPhase) wraps++;
    lastPhase = st.gait.phase;
    st.pose.feet.forEach((f, k) => {
      assert.ok(f.every(Number.isFinite));
      const wx = st.x + st.dir * f[0];
      if (st.feetState[k]) { if (pinned.has(k)) slip = Math.max(slip, Math.abs(wx - pinned.get(k))); else pinned.set(k, wx); }
      else pinned.delete(k);
      if (prevState && prevState[k] && !st.feetState[k] && i > 60) lifts[k]++;
    });
    prevState = st.feetState.slice();
    if (check || i % 4 === 0) for (const lg of B.build(ph, st.pose).legs) stretch = Math.max(stretch, lg.stretch);
  }
  return { w, slip, stretch, wraps, lifts };
}

test('gait table: offsets for every leg, duty factors in range, hurry is quicker', () => {
  for (const [fam, n] of [['biped', 2], ['quadruped', 4], ['hexapod', 6]]) {
    for (const mode of ['walk', 'hurry']) {
      const g = M.GAITS[fam][mode];
      assert.equal(g.offsets.length, n, fam + ' ' + mode);
      assert.ok(g.duty > 0.4 && g.duty < 1);
      for (const o of g.offsets) assert.ok(o >= 0 && o < 1);
      // at every moment at least one foot holds the body up
      for (let k = 0; k < 100; k++) assert.ok(M.supports(k / 100, g).some((s) => s > 0) || M.supports((k + 0.5) / 100, g).some((s) => s > 0));
    }
    assert.ok(M.GAITS[fam].hurry.duty < M.GAITS[fam].walk.duty, fam);
  }
  // the sides alternate: left and right of a pair land half a cycle apart
  for (const fam of ['biped', 'quadruped', 'hexapod']) for (const mode of ['walk', 'hurry']) {
    const o = M.GAITS[fam][mode].offsets;
    for (let p = 0; p < o.length; p += 2) assert.equal(Math.abs(o[p] - o[p + 1]), 0.5, fam + ' ' + mode + ' pair ' + p / 2);
  }
});

test('every leg count, every level 1..100: no foot slide in stance, no over-stretched leg', () => {
  for (const n of [2, 4, 6]) {
    assert.equal(SEEDS[n].length, 2, 'found ' + n + '-legged seeds');
    for (const seed of SEEDS[n]) {
      const c = G.randomCreature(seed);
      for (let level = 1; level <= 100; level++) {
        const ph = G.express(c, { level });
        const g = M.gaitParams(ph);
        assert.ok(g.D > 0 && g.speed > 0 && g.f > 0, seed + ' L' + level);
        const r = walk(ph, 1.5, level % 2 ? 'walk' : 'hurry');
        assert.ok(r.slip / ph.scale <= SLIP_TOL, `${seed} L${level}: slip ${r.slip}`);
        assert.ok(r.stretch <= STRETCH_MAX, `${seed} L${level}: stretch ${r.stretch.toFixed(3)}`);
      }
    }
  }
});

test('the phase wraps cleanly and every foot steps once per cycle', () => {
  for (const n of [2, 4, 6]) for (const mode of ['walk', 'hurry']) {
    const ph = G.express(G.randomCreature(SEEDS[n][0]), { level: 80 });
    const r = walk(ph, 6, mode);
    assert.ok(r.wraps >= 3, `${n} legs ${mode}: ${r.wraps} cycles`);
    for (const k of r.lifts) assert.ok(Math.abs(k - (r.wraps - 1)) <= 1, `${n} legs ${mode}: steps ${r.lifts} for ${r.wraps} cycles`);
  }
});

test('a stride takes a whole number of sprite frames', () => {
  for (const n of [2, 4, 6]) for (const level of [1, 50, 100]) {
    const g = M.gaitParams(G.express(G.randomCreature(SEEDS[n][1]), { level }));
    const frames = M.SPRITE_FPS / g.f;
    assert.ok(Math.abs(frames - Math.round(frames)) < 1e-9, `${n} legs L${level}: ${frames} frames`);
  }
});

test('babies waddle, adults stride: stride and speed grow with the body, cadence slows', () => {
  for (const n of [2, 4, 6]) {
    const c = G.randomCreature(SEEDS[n][0]);
    const baby = M.gaitParams(G.express(c, { level: 1 })), adult = M.gaitParams(G.express(c, { level: 100 }));
    assert.ok(baby.D < adult.D, n + ' stride');
    assert.ok(baby.speed < adult.speed, n + ' speed');
    assert.ok(baby.f >= adult.f, n + ' cadence');
    assert.ok(baby.rollAmp > adult.rollAmp, n + ' waddle');
    const hurry = M.gaitParams(G.express(c, { level: 100 }), null, 'hurry');
    assert.ok(hurry.speed > adult.speed && hurry.duty < adult.duty, n + ' hurry');
  }
});

test('starting is gradual, and stopping settles every foot back under its hip', () => {
  for (const n of [2, 4, 6]) {
    const ph = G.express(G.randomCreature(SEEDS[n][1]), { level: 100 });
    const w = M.createWalker(ph, 2);
    const g = M.gaitParams(ph);
    let st = M.step(w, 1 / 60, -50, 50, { force: 'walk' });
    assert.ok(st.gait.speed < g.speed * 0.2, 'no instant start');
    for (let i = 0; i < 180; i++) st = M.step(w, 1 / 60, -50, 50, { force: 'walk' });
    assert.ok(Math.abs(st.gait.speed - g.speed) < 1e-9, 'reaches walking speed');
    w.walking = false; w.idleFor = 1e9;
    let stoppedAt = null;
    for (let i = 0; i < 240; i++) {
      st = M.step(w, 1 / 60, -50, 50, {});
      if (stoppedAt === null && st.gait.settled) stoppedAt = i / 60;
    }
    assert.ok(stoppedAt !== null && stoppedAt < 2.5, `${n} legs settle (${stoppedAt})`);
    assert.equal(st.gait.speed, 0);
    assert.ok(st.feetState.every(Boolean), 'all feet down');
    const L = B.layout(ph);
    st.pose.feet.forEach((f, k) => assert.ok(Math.abs(f[0] - L.feet[k][0]) < 0.08 * L.legLen + 1e-9, `foot ${k} under hip`));
    const x = st.x;
    for (let i = 0; i < 60; i++) st = M.step(w, 1 / 60, -50, 50, {});
    assert.equal(st.x, x, 'stays put');
  }
});

test('turning round at the edge: stops, turns, keeps inside, feet stay planted while turning', () => {
  const ph = G.express(G.randomCreature(SEEDS[4][0]), { level: 100 });
  const w = M.createWalker(ph, 9);
  let turns = 0, dir = w.dir;
  for (let i = 0; i < 60 * 30; i++) {
    const st = M.step(w, 1 / 60, -0.3, 0.3, { force: 'walk' });
    assert.ok(st.x >= -0.3 - 1e-9 && st.x <= 0.3 + 1e-9);
    if (st.dir !== dir) { turns++; dir = st.dir; assert.ok(st.feetState.every(Boolean)); assert.equal(st.gait.speed, 0); }
  }
  assert.ok(turns >= 2, 'turned ' + turns);
});

test('the body moves with the gait: it bobs and sways while walking, and is still when standing', () => {
  for (const n of [2, 4, 6]) {
    const ph = G.express(G.randomCreature(SEEDS[n][0]), { level: 100 });
    const w = M.createWalker(ph, 4);
    const lo = {}, hi = {};
    for (let i = 0; i < 240; i++) {
      const b = M.step(w, 1 / 60, -50, 50, { force: 'walk' }).pose.body;
      if (i > 120) for (const k in b) { lo[k] = Math.min(lo[k] ?? 0, b[k]); hi[k] = Math.max(hi[k] ?? 0, b[k]); }
    }
    assert.ok(hi.bob - lo.bob > 0.003 * ph.scale, n + ' bob');
    assert.ok(hi.roll - lo.roll > 0.01, n + ' roll');
    const calm = M.createWalker(ph, 4);
    const b = M.step(calm, 1 / 60, -50, 50, { walk: false }).pose.body;
    for (const k in b) assert.ok(Math.abs(b[k]) < 1e-12, 'standing ' + k);
  }
});

test('no legs: it scoots, finite and inside its strip', () => {
  const ph = JSON.parse(JSON.stringify(G.express(G.randomCreature(SEEDS[4][0]), { level: 60 })));
  ph.legs.pairs = 0;
  const w = M.createWalker(ph, 1);
  let moved = 0;
  for (let i = 0; i < 300; i++) {
    const st = M.step(w, 1 / 30, -0.5, 0.5, { force: 'walk' });
    assert.equal(st.pose.feet.length, 0);
    assert.ok(Number.isFinite(st.x) && st.x >= -0.5 - 1e-9 && st.x <= 0.5 + 1e-9);
    moved = Math.max(moved, Math.abs(st.x));
    B.build(ph, st.pose);
  }
  assert.ok(moved > 0.05);
});
