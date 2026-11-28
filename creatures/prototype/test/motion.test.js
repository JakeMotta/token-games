// The walk on the ground plane: a gait clock per leg count, feet that stay put in the world while they hold the body up,
// legs that never over-stretch, strides that grow with the creature, clean starts and stops, real turns (a 180 that
// slows and pivots on planted feet, a rarer 360 spin, arcs while walking), staying inside the habitat, and eating, for
// 2, 4 and 6 legs at every level 1..100.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../genome.js');
const B = require('../body.js');
const M = require('../motion.js');

const SLIP_TOL = 1e-6;   // world units a planted foot may move (none: it is pinned)
const STRETCH_MAX = 0.985; // hip-to-foot over leg length, with the body moving (MAX_STRETCH plus a little for springs)
const BIG = { minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6 };

// Two seeds for each leg count.
const SEEDS = { 2: [], 4: [], 6: [] };
for (let i = 0; i < 400 && Object.values(SEEDS).some((a) => a.length < 2); i++) {
  const n = G.express(G.randomCreature('g' + i), { level: 100 }).legs.pairs * 2;
  if (SEEDS[n] && SEEDS[n].length < 2) SEEDS[n].push('g' + i);
}

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Watches a walk: planted feet don't move in the world, legs don't over-stretch, the gait phase stays in range.
function watcher(ph) {
  const pinned = new Map();
  const r = { slip: 0, stretch: 0, wraps: 0, lifts: new Array(ph.legs.pairs * 2).fill(0), lastPhase: 0, prev: null, n: 0 };
  r.see = (st, checkStretch) => {
    assert.ok(st.gait.phase >= 0 && st.gait.phase < 1, 'phase in [0,1)');
    if (st.gait.phase < r.lastPhase) r.wraps++;
    r.lastPhase = st.gait.phase;
    st.pose.feet.forEach((f, k) => {
      assert.ok(f.every(Number.isFinite));
      const [wx, wz] = M.toWorld(st, f[0], f[2]);
      if (st.feetState[k]) {
        if (pinned.has(k)) { const p = pinned.get(k); r.slip = Math.max(r.slip, Math.hypot(wx - p[0], wz - p[1])); } else pinned.set(k, [wx, wz]);
      } else pinned.delete(k);
      if (r.prev && r.prev[k] && !st.feetState[k] && r.n > 60) r.lifts[k]++;
    });
    r.prev = st.feetState.slice();
    if (checkStretch || r.n % 4 === 0) for (const lg of B.build(ph, st.pose).legs) r.stretch = Math.max(r.stretch, lg.stretch);
    r.n++;
  };
  return r;
}

// Walk for `secs` (forced, straight unless steer is given).
function walk(ph, secs, mode, steer) {
  const w = M.createWalker(ph, 5);
  const r = watcher(ph);
  for (let i = 0; i < secs * 60; i++) r.see(M.step(w, 1 / 60, BIG, null, { force: mode || 'walk', steer }));
  return Object.assign(r, { w });
}

// Turn on the spot by `angle` (or spin), watching the feet. Returns the heading change and how long it took.
function turnBy(ph, angle, spin) {
  const w = M.createWalker(ph, 3);
  const r = watcher(ph);
  let st = M.step(w, 1 / 60, BIG, null, { walk: false });
  const h0 = st.heading;
  let total = 0, last = h0, t = 0;
  if (spin) M.spin(w, Math.sign(angle)); else M.turn(w, angle);
  for (; t < 20; t += 1 / 60) {
    st = M.step(w, 1 / 60, BIG, null, { walk: false });
    total += angleDiff(st.heading, last); last = st.heading;
    r.see(st, true);
    if (st.mode !== 'turn' && t > 0.1) break;
  }
  return Object.assign(r, { total, t, st, w });
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

test('ground plane: toWorld and toLocal undo each other, heading 0 faces +x, positive heading turns left (-z)', () => {
  const st = { x: 0.3, z: -0.2, heading: 0.7 };
  const [wx, wz] = M.toWorld(st, 0.5, 0.1);
  const [lx, lz] = M.toLocal(st, wx, wz);
  assert.ok(Math.abs(lx - 0.5) < 1e-12 && Math.abs(lz - 0.1) < 1e-12);
  const ahead = M.toWorld({ x: 0, z: 0, heading: 0 }, 1, 0);
  assert.ok(Math.abs(ahead[0] - 1) < 1e-12 && Math.abs(ahead[1]) < 1e-12);
  const left = M.toWorld({ x: 0, z: 0, heading: Math.PI / 2 }, 1, 0);
  assert.ok(Math.abs(left[0]) < 1e-12 && Math.abs(left[1] + 1) < 1e-12);
});

test('every leg count, every level 1..100: no foot slide in stance, no over-stretched leg (straight)', () => {
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

test('walking an arc: the heading turns at the limited rate, feet stay planted, legs stay in reach', () => {
  for (const n of [2, 4, 6]) for (const seed of SEEDS[n]) for (const level of [1, 20, 50, 100]) {
    const ph = G.express(G.randomCreature(seed), { level });
    for (const steer of [1, -1]) {
      const r = walk(ph, 4, 'walk', steer * 0.9);
      const st = M.step(r.w, 1 / 60, BIG, null, { force: 'walk', steer: steer * 0.9 });
      assert.ok(Math.abs(st.yawRate) <= M.TURN_RATE + 1e-9, `${seed} L${level}: yaw rate ${st.yawRate}`);
      assert.ok(Math.sign(st.yawRate) === steer, `${seed} L${level}: turns the asked way`);
      assert.ok(r.slip / ph.scale <= SLIP_TOL, `${seed} L${level} arc: slip ${r.slip}`);
      assert.ok(r.stretch <= STRETCH_MAX, `${seed} L${level} arc: stretch ${r.stretch.toFixed(3)}`);
    }
  }
});

test('a 180 turn completes for 2, 4 and 6 legs at every growth stage: planted feet never slide, legs never over-stretch', () => {
  for (const n of [2, 4, 6]) for (const seed of SEEDS[n]) for (const level of [1, 5, 15, 30, 60, 100]) {
    const ph = G.express(G.randomCreature(seed), { level });
    for (const sign of [1, -1]) {
      const r = turnBy(ph, sign * Math.PI);
      assert.ok(Math.abs(r.total - sign * Math.PI) < 0.12, `${seed} L${level}: turned ${r.total.toFixed(2)}`);
      assert.ok(r.t < 8, `${seed} L${level}: took ${r.t.toFixed(1)}s`);
      assert.ok(r.slip / ph.scale <= SLIP_TOL, `${seed} L${level} 180: slip ${r.slip}`);
      assert.ok(r.stretch <= STRETCH_MAX, `${seed} L${level} 180: stretch ${r.stretch.toFixed(3)}`);
    }
  }
});

test('a 360 spin goes all the way round and settles', () => {
  for (const n of [2, 4, 6]) for (const level of [1, 40, 100]) {
    const ph = G.express(G.randomCreature(SEEDS[n][0]), { level });
    const r = turnBy(ph, 1, true);
    assert.ok(Math.abs(r.total - 2 * Math.PI) < 0.15, `${n} legs L${level}: spun ${r.total.toFixed(2)}`);
    assert.ok(r.slip / ph.scale <= SLIP_TOL, `${n} legs L${level} spin: slip ${r.slip}`);
    assert.ok(r.stretch <= STRETCH_MAX, `${n} legs L${level} spin: stretch ${r.stretch.toFixed(3)}`);
  }
});

test('while turning the head leads, the tail swings the other way and the body curves', () => {
  const ph = G.express(G.randomCreature(SEEDS[4][0]), { level: 100 });
  const w = M.createWalker(ph, 3);
  M.step(w, 1 / 60, BIG, null, { walk: false });
  M.turn(w, Math.PI); // a left turn
  let look = 0, tail = 0, bend = 0;
  for (let i = 0; i < 120; i++) {
    const st = M.step(w, 1 / 60, BIG, null, { walk: false });
    look = Math.max(look, st.pose.lookYaw); tail = Math.max(tail, st.pose.tailSway); bend = Math.max(bend, st.pose.body.bend || 0);
  }
  assert.ok(look > 0.05, 'head leads into the turn ' + look);
  assert.ok(tail > 0.05, 'tail swings out ' + tail);
  assert.ok(bend > 0.02, 'body curves ' + bend);
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
    let st = M.step(w, 1 / 60, BIG, null, { force: 'walk' });
    assert.ok(st.gait.speed < g.speed * 0.2, 'no instant start');
    for (let i = 0; i < 180; i++) st = M.step(w, 1 / 60, BIG, null, { force: 'walk' });
    assert.ok(Math.abs(st.gait.speed - g.speed) < 1e-9, 'reaches walking speed');
    let stoppedAt = null;
    for (let i = 0; i < 240; i++) {
      st = M.step(w, 1 / 60, BIG, null, { walk: false });
      if (stoppedAt === null && st.gait.settled) stoppedAt = i / 60;
    }
    assert.ok(stoppedAt !== null && stoppedAt < 2.5, `${n} legs settle (${stoppedAt})`);
    assert.equal(st.gait.speed, 0);
    assert.ok(st.feetState.every(Boolean), 'all feet down');
    const L = B.layout(ph);
    st.pose.feet.forEach((f, k) => assert.ok(Math.hypot(f[0] - L.feet[k][0], f[2] - L.feet[k][2]) < 0.08 * L.legLen + 1e-9, `foot ${k} under hip`));
    const x = st.x, z = st.z;
    for (let i = 0; i < 60; i++) st = M.step(w, 1 / 60, BIG, null, { walk: false });
    assert.equal(st.x, x, 'stays put');
    assert.equal(st.z, z, 'stays put');
  }
});

test('roaming a small habitat: it turns round at the walls, stays inside, feet never slide', () => {
  for (const n of [2, 4, 6]) {
    const ph = G.express(G.randomCreature(SEEDS[n][0]), { level: 100 });
    const area = { minX: -0.6, maxX: 0.6, minZ: -0.35, maxZ: 0.35 };
    const w = M.createWalker(ph, 9);
    const r = watcher(ph);
    let turns = 0, wasTurning = false;
    for (let i = 0; i < 60 * 40; i++) {
      const st = M.step(w, 1 / 60, area, null, { force: 'walk' });
      r.see(st);
      assert.ok(st.x >= area.minX - 1e-9 && st.x <= area.maxX + 1e-9 && st.z >= area.minZ - 1e-9 && st.z <= area.maxZ + 1e-9,
        `${n} legs inside: ${st.x.toFixed(3)}, ${st.z.toFixed(3)}`);
      if (st.mode === 'turn' && !wasTurning) turns++;
      wasTurning = st.mode === 'turn';
    }
    assert.ok(turns >= 2, n + ' legs turned ' + turns);
    assert.ok(r.slip / ph.scale <= SLIP_TOL, `${n} legs roam: slip ${r.slip}`);
    assert.ok(r.stretch <= STRETCH_MAX, `${n} legs roam: stretch ${r.stretch.toFixed(3)}`);
  }
});

test('wandering on its own: it picks places to go, turns to them and walks there, all inside', () => {
  const ph = G.express(G.randomCreature(SEEDS[4][1]), { level: 70 });
  const area = { minX: -1.2, maxX: 1.2, minZ: -0.5, maxZ: 0.5 };
  const w = M.createWalker(ph, 11);
  const r = watcher(ph);
  const modes = new Set();
  let path = 0, last = null;
  for (let i = 0; i < 60 * 60; i++) {
    const st = M.step(w, 1 / 60, area, null, {});
    r.see(st);
    modes.add(st.mode);
    if (last) path += Math.hypot(st.x - last[0], st.z - last[1]);
    last = [st.x, st.z];
    assert.ok(st.x >= area.minX - 1e-9 && st.x <= area.maxX + 1e-9 && st.z >= area.minZ - 1e-9 && st.z <= area.maxZ + 1e-9);
  }
  assert.ok(modes.has('go') && modes.has('idle'), [...modes].join());
  assert.ok(path > 1, 'walked ' + path.toFixed(2));
  assert.ok(r.slip / ph.scale <= SLIP_TOL, 'slip ' + r.slip);
});

test('the body moves with the gait: it bobs and sways while walking, and is still when standing', () => {
  for (const n of [2, 4, 6]) {
    const ph = G.express(G.randomCreature(SEEDS[n][0]), { level: 100 });
    const w = M.createWalker(ph, 4);
    const lo = {}, hi = {};
    for (let i = 0; i < 240; i++) {
      const b = M.step(w, 1 / 60, BIG, null, { force: 'walk' }).pose.body;
      if (i > 120) for (const k in b) { lo[k] = Math.min(lo[k] ?? 0, b[k]); hi[k] = Math.max(hi[k] ?? 0, b[k]); }
    }
    assert.ok(hi.bob - lo.bob > 0.003 * ph.scale, n + ' bob');
    assert.ok(hi.roll - lo.roll > 0.01, n + ' roll');
    const calm = M.createWalker(ph, 4);
    const b = M.step(calm, 1 / 60, BIG, null, { walk: false }).pose.body;
    for (const k in b) assert.ok(Math.abs(b[k]) < 1e-12, 'standing ' + k);
  }
});

test('eating: it notices food, walks and turns to it, lowers its head, bites, chews, swallows and is happy', () => {
  for (const n of [2, 4, 6]) {
    const ph = G.express(G.randomCreature(SEEDS[n][0]), { level: 60 });
    const w = M.createWalker(ph, 6, { hunger: 0.8 });
    const area = { minX: -1.5, maxX: 1.5, minZ: -0.6, maxZ: 0.6 };
    // food behind it and off to one side, so it has to turn
    const food = { x: -0.7, z: 0.3, bites: 3, value: 0.3, kind: 'berry' };
    const r = watcher(ph);
    const seen = new Set(), events = [];
    let opened = 0, nod = 0, minMouthDist = Infinity;
    for (let i = 0; i < 60 * 30 && !(food.gone && events.includes('happy') && w.mode !== 'eat'); i++) {
      const st = M.step(w, 1 / 60, area, null, { food: food.gone ? null : food });
      r.see(st);
      seen.add(st.state);
      for (const e of st.events) events.push(e.type);
      opened = Math.max(opened, st.pose.mouthOpen);
      nod = Math.min(nod, st.pose.headNod);
      if (st.state === 'eat') {
        const mp = B.build(ph, st.pose).mouth.p;
        const [mx, mz] = M.toWorld(st, mp[0], mp[2]);
        minMouthDist = Math.min(minMouthDist, Math.hypot(mx - food.x, mz - food.z));
      }
    }
    assert.ok(food.gone, n + ' legs ate it all');
    assert.equal(events.filter((e) => e === 'bite').length, 3, n + ' legs: three bites ' + events);
    assert.ok(events.includes('swallow') && events.includes('happy'), events.join());
    assert.ok(seen.has('go') || seen.has('turn'), 'walked or turned to it');
    assert.ok(opened > 0.6, 'mouth opened ' + opened);
    assert.ok(nod < -0.1, 'head went down ' + nod);
    assert.ok(minMouthDist < 0.25 * ph.scale + 0.05, 'mouth reached the food ' + minMouthDist.toFixed(3));
    assert.ok(w.hunger < 0.8, 'less hungry ' + w.hunger);
    assert.ok(r.slip / ph.scale <= SLIP_TOL, n + ' legs eating: slip ' + r.slip);
    assert.ok(r.stretch <= STRETCH_MAX, n + ' legs eating: stretch ' + r.stretch.toFixed(3));
  }
});

test('hunger rises slowly with time and shows as the hungry state', () => {
  const ph = G.express(G.randomCreature(SEEDS[2][0]), { level: 50 });
  const w = M.createWalker(ph, 1, { hunger: M.HUNGRY - 0.01 });
  let st;
  for (let i = 0; i < 60 * 30; i++) st = M.step(w, 1 / 60, BIG, null, { walk: false });
  assert.ok(st.hunger > M.HUNGRY, 'hunger ' + st.hunger);
  assert.equal(st.state, 'hungry');
});

test('no legs: it scoots, finite and inside its habitat', () => {
  const ph = JSON.parse(JSON.stringify(G.express(G.randomCreature(SEEDS[4][0]), { level: 60 })));
  ph.legs.pairs = 0;
  const w = M.createWalker(ph, 1);
  const area = { minX: -0.5, maxX: 0.5, minZ: -0.3, maxZ: 0.3 };
  let moved = 0;
  for (let i = 0; i < 300; i++) {
    const st = M.step(w, 1 / 30, area, null, { force: 'walk' });
    assert.equal(st.pose.feet.length, 0);
    assert.ok(Number.isFinite(st.x) && st.x >= -0.5 - 1e-9 && st.x <= 0.5 + 1e-9 && st.z >= -0.3 - 1e-9 && st.z <= 0.3 + 1e-9);
    moved = Math.max(moved, Math.hypot(st.x, st.z));
    B.build(ph, st.pose);
  }
  assert.ok(moved > 0.05);
});

test('the old one-dimensional call still works (a line from minX to maxX)', () => {
  const ph = G.express(G.randomCreature(SEEDS[4][0]), { level: 100 });
  const w = M.createWalker(ph, 9);
  for (let i = 0; i < 60 * 10; i++) {
    const st = M.step(w, 1 / 60, -0.3, 0.3, { force: 'walk' });
    assert.ok(st.x >= -0.3 - 1e-9 && st.x <= 0.3 + 1e-9);
  }
});
