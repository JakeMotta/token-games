/* Creatures compare lab: the pure part of the compare page (compare.html). It runs version 1 (rings plus limbs, a gait
   clock), version 2 (argonaut's chain, feet that step when they fall a stride behind) and version 3 (version 2's motion
   with the feet splayed for the top-down view) side by side on one clock, with the same seed and the same scripted
   scenario, and measures what differs: how far planted feet slide, how tight the body turns, how often legs cross,
   how much the heading wobbles, and how far the creature strays from the path it is asked to follow.
   Everything here is deterministic: a fixed step of 1/60 s and seeded walkers, so scrubbing back re-simulates the same
   frames. The scenario only steers (opts.drive: speed and turn rate, or the walkers' own turn() and spin()); it never
   feeds or grows the creature. No DOM. */
(function (root) {
  'use strict';
  const req = (name, file) => root[name] || (typeof require === 'function' ? require(file) : null);
  const G = req('CreatureGenome', '../prototype/genome.js');
  const B = req('CreatureBody', '../prototype/body.js');
  const M1 = req('CreatureMotion', '../prototype/motion.js');
  const C = req('CreatureChain', './chain.js');
  const M2 = req('CreatureMotion2', './motion2.js');

  const DT = 1 / 60;
  const AREA = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 }; // the lab's floor has no walls: the camera follows
  const TURN_WINDOW = Math.PI / 4;   // the turn radius is measured over the shortest stretch that turns this much
  const WOBBLE_WINDOW = 0.4;         // seconds: heading wobble is the yaw rate minus its average over this window
  const wrap = C.wrap;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  // ---------- scenarios ----------
  // Paths are in "path units" u: big enough for the creature's speed and its tightest walking arc (see unitFor).
  // A path is a function of arc-ish parameter returning [x, z]; it is sampled into a polyline once.
  const lemniscate = (k) => (t) => { const s = Math.sin(t), c = Math.cos(t), d = 1 + s * s; return [2.2 * k * c / d, 2.2 * k * s * c / d]; };
  const SCENARIOS = [
    { id: 's-curve', eye: { win: 'v2', why: 'its body curves along the S like a lizard\'s; version 1\'s stays a stiff rod that yaws round its middle' }, name: 'S-curve', seconds: 14, speed: 1.4,
      path: { from: -3, to: 40, fn: (t) => [t, Math.sin(t * 2 * Math.PI / 5) * 1.1] },
      about: 'A long weaving path. Watch how the body bends to follow it and whether the feet stay put.' },
    { id: 'figure-eight', eye: { win: 'v2', why: 'the chain bends one way then the other and the tail sweeps after the head' }, name: 'Figure eight', seconds: 18, speed: 1.4,
      path: { from: 0, to: 4 * Math.PI, fn: lemniscate(1), loop: true },
      about: 'Left and right turns in turn. The chain bends one way then the other; the ring body yaws as a block.' },
    { id: 'u-turn', eye: { win: 'v1', why: 'it turns round on the spot in one tidy movement; versions 2 and 3 need a loop half a body wide' }, name: 'Sharp U-turn', seconds: 10, speed: 1.4, line: true, events: [{ at: 2.5, turn: Math.PI }],
      about: 'Each version turns round its own way: version 1 pivots on planted feet, versions 2 and 3 swing the head round a tight arc.' },
    { id: 'spin', eye: { win: 'v1', why: 'a real spin in place; a chain can only run a small circle' }, name: 'Spin in place', seconds: 10, speed: 1, line: true, events: [{ at: 1.5, spin: 1 }],
      about: 'A full turn. Version 1 turns on the spot; a chain cannot pivot, so versions 2 and 3 draw a small loop.' },
    { id: 'speed-ramp', eye: { win: 'v2', why: 'its step rate rises smoothly with speed; version 1 switches gait at a threshold' }, name: 'Speed ramp', seconds: 12, line: true, ramp: [0.2, 2.2],
      about: 'Slow to fast in a straight line. Version 1 changes gait on its clock; versions 2 and 3 just step more often.' },
    { id: 'stops', eye: { win: 'v1', why: 'its feet settle back under the body in a fixed order; version 2\'s last steps land wherever each foot was due' }, name: 'Sudden stops', seconds: 14, speed: 1.6, stops: { go: 2.2, stop: 1.4 },
      path: { from: -3, to: 40, fn: (t) => [t, Math.sin(t * 2 * Math.PI / 7) * 0.7] },
      about: 'Full speed, then stop dead, again and again. Look at how the feet settle when the body stops.' },
    { id: 'long', eye: { win: 'v2', why: 'a long body only looks alive when it bends along its path' }, name: 'Very long creature', seconds: 14, speed: 1.3, body: 'long',
      path: { from: -3, to: 40, fn: (t) => [t, Math.sin(t * 2 * Math.PI / 5) * 1.1] },
      about: 'Many joints. A long chain trails its tail along the path; a long ring body swings wide.' },
    { id: 'short', eye: { win: 'draw', why: 'with little body to bend, both look alike' }, name: 'Very short creature', seconds: 12, speed: 1.3, body: 'short',
      path: { from: -3, to: 40, fn: (t) => [t, Math.sin(t * 2 * Math.PI / 5) * 1.1] },
      about: 'Few joints. With little chain to bend, the two systems look closest here.' },
    { id: 'legs-2', eye: { win: 'v1', why: 'its biped clock keeps a steady left-right rhythm; version 2 can let a foot drag behind before it steps' }, name: '2 legs', seconds: 12, speed: 1.3, pairs: 1, path: { from: 0, to: 4 * Math.PI, fn: lemniscate(1), loop: true },
      about: 'Two legs: version 1 walks a biped gait clock; versions 2 and 3 alternate because a foot waits for its partner.' },
    { id: 'legs-4', eye: { win: 'v2', why: 'the diagonal steps come from the body\'s own motion, as in the video' }, name: '4 legs', seconds: 12, speed: 1.3, pairs: 2, path: { from: 0, to: 4 * Math.PI, fn: lemniscate(1), loop: true },
      about: 'Four legs, the video\'s lizard. Diagonal pairs step together in both, by different rules.' },
    { id: 'legs-6', eye: { win: 'v1', why: 'its tripod clock keeps six legs tidy; the neighbour rule can let adjacent legs cross' }, name: '6 legs', seconds: 12, speed: 1.3, pairs: 3, path: { from: 0, to: 4 * Math.PI, fn: lemniscate(1), loop: true },
      about: 'Six legs: version 1\'s tripod clock against versions 2 and 3\'s neighbour rule.' },
    { id: 'legs-8', eye: { win: 'v1', why: 'a clocked wave down each side; eight legs on the neighbour rule tangle more' }, name: '8 legs', seconds: 12, speed: 1.3, pairs: 4, path: { from: 0, to: 4 * Math.PI, fn: lemniscate(1), loop: true },
      about: 'Eight legs (only here: the genome grows at most six). A wave runs down each side.' },
    { id: 'follow', eye: { win: 'v2', why: 'the head turns first and the body follows it to the target' }, name: 'Follow a target', seconds: 20, speed: 1.5, follow: true,
      about: 'The target jumps to a new spot every few seconds (click the floor to place it yourself). Each version heads for it.' },
  ];
  const byId = (id) => SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
  // Wavy ground is not offered: every version's feet and shadows assume a flat floor at y = 0.

  // The genome for a scenario: the seed's own creature, with the body or the leg count overridden when the scenario
  // is about that.
  function creatureFor(scn, seed, level) {
    const o = {};
    if (scn.body === 'long') Object.assign(o, { 'neck.length': 0.5, 'torso.length': 1.25, 'tail.length': 1.5 });
    if (scn.body === 'short') Object.assign(o, { 'neck.length': 0, 'torso.length': 0.45, 'tail.length': 0 });
    if (scn.pairs != null) Object.assign(o, { 'legs.pairs': scn.pairs, 'wings.size': 0 });
    o['wings.size'] = 0; // the lab is about walking: no flights or flaps
    return G.express(G.randomCreature(String(seed)), { level: level == null ? 100 : level, overrides: o });
  }

  // Path unit: the arc the creature can walk at the scenario's speed (the slower of a body scale or 0.7 s of travel),
  // so a quick small creature gets a bigger path than a slow big one and each can actually follow it.
  function unitFor(ph, scn) {
    const g = M1.gaitParams(ph, null, 'walk');
    const v = g.speed * (scn.speed || (scn.ramp ? scn.ramp[1] : 1));
    return Math.max(0.9 * ph.scale, 0.75 * v);
  }

  function samplePath(scn, u) {
    if (!scn.path && !scn.line) return null;
    const p = scn.path || { from: -3, to: 60, fn: (t) => [t, 0] };
    const n = 900, pts = [];
    for (let i = 0; i <= n; i++) { const q = p.fn(p.from + (p.to - p.from) * i / n); pts.push([q[0] * u, q[1] * u]); }
    const arc = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, arc, loop: !!p.loop, total: arc[arc.length - 1] };
  }
  // Point on the path at arc length d (wraps on a loop).
  function pathAt(path, d) {
    if (path.loop) d = ((d % path.total) + path.total) % path.total;
    d = clamp(d, 0, path.total);
    let lo = 0, hi = path.arc.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path.arc[m] <= d) lo = m; else hi = m; }
    const a = path.pts[lo], b = path.pts[hi], t = (d - path.arc[lo]) / Math.max(1e-9, path.arc[hi] - path.arc[lo]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  // Nearest arc length to (x, z), searching forward from `from` a little way (the follower never jumps ahead).
  function progressOn(path, x, z, from, reach) {
    let best = from, bd = Infinity;
    const step = path.total / (path.pts.length - 1);
    for (let d = from - step * 4; d <= from + reach; d += step) {
      const p = pathAt(path, d), e = Math.hypot(p[0] - x, p[1] - z);
      if (e < bd) { bd = e; best = d; }
    }
    return { d: Math.max(from, best), err: bd };
  }
  const headingTo = (fx, fz, tx, tz) => Math.atan2(-(tz - fz), tx - fx);

  // The target positions for the follow scenario: a seeded sequence of jumps, plus any clicks (time, x, z).
  function followTargets(seed, u, seconds) {
    const rnd = G.makeRng(G.hashSeed('follow:' + seed));
    const out = [];
    for (let t = 0, i = 0; t < seconds; t += 3.2, i++) {
      const a = rnd.range(0, 2 * Math.PI), r = rnd.range(1.4, 2.4) * u;
      out.push({ at: t, x: Math.cos(a) * r, z: Math.sin(a) * r * 0.8 });
    }
    return out;
  }

  // ---------- actors ----------
  // An actor is one version on the lab clock: its walker, what it drew last, its trails and its meter.
  function makeActor(kind, ph, seed, opts) {
    opts = opts || {};
    const hseed = G.hashSeed(String(seed));
    const BL = bodyLength(ph);
    let w;
    if (kind === 'v1') w = M1.createWalker(ph, hseed, { heading: 0, hunger: 0.2 });
    else w = M2.createWalker(ph, hseed, { heading: 0, hunger: 0.2, rig: kind === 'v3' && opts.topRig ? opts.topRig(ph) : undefined });
    return { kind, ph, w, BL, out: null, scene: null, legs: [], meter: createMeter(BL), progress: 0, trail: [], footTrail: [] };
  }
  // A body length both versions share: the rest chain's length (the same body the genome draws standing straight).
  const lengthCache = new WeakMap();
  function bodyLength(ph) {
    if (!lengthCache.has(ph)) { const R = C.rig(ph); lengthCache.set(ph, R.links.reduce((a, b) => a + b, 0)); }
    return lengthCache.get(ph);
  }
  // The point a version steers by: version 1's body origin, the head of a chain.
  function steerPoint(a) {
    if (a.kind === 'v1') return { x: a.w.x, z: a.w.z, th: a.w.th };
    const j = a.w.chain.joints[0];
    return { x: j[0], z: j[1], th: a.w.chain.angles[0] };
  }

  // A lab run: three (or any) actors, one scenario, one clock.
  function createRun(opts) {
    const scn = typeof opts.scenario === 'string' ? byId(opts.scenario) : opts.scenario;
    const ph = creatureFor(scn, opts.seed, opts.level);
    const u = unitFor(ph, scn);
    const kinds = opts.kinds || ['v1', 'v2'];
    const run = {
      scn, ph, u, seed: opts.seed, t: 0, frame: 0, path: samplePath(scn, u), clicks: (opts.clicks || []).slice(),
      targets: scn.follow ? followTargets(opts.seed, u, scn.seconds) : null, fired: {},
      actors: kinds.map((k) => makeActor(k, ph, opts.seed, opts)), build: opts.build !== false,
    };
    // Start everyone on the path, facing along it.
    const p0 = run.path ? pathAt(run.path, 0) : [0, 0], p1 = run.path ? pathAt(run.path, 0.05 * u) : [1, 0];
    const th0 = headingTo(p0[0], p0[1], p1[0], p1[1]);
    for (const a of run.actors) {
      if (a.kind === 'v1') { a.w.x = p0[0]; a.w.z = p0[1]; a.w.th = th0; resetFeet1(a.w); }
      else M2.place(a.w, p0[0], p0[1], th0);
      if (a.kind !== 'v1') { // place() puts the anchor on the spot; shift so the head starts there like version 1's origin
        const j = a.w.chain.joints[0], dx = p0[0] - j[0], dz = p0[1] - j[1];
        M2.place(a.w, a.w.x + dx, a.w.z + dz, th0);
      }
    }
    return run;
  }
  function resetFeet1(w) {
    w.feet = w.L.feet.map((f) => { const p = M1.toWorld(w, f[0], f[2]); return { wx: p[0], wz: p[1], y: f[1], planted: true, skip: false, from: null, u: 0, target: null }; });
  }

  // Where the target is at time t (follow scenario).
  function targetAt(run, t) {
    if (!run.targets) return null;
    let cur = null;
    for (const p of run.targets) if (p.at <= t) cur = p;
    for (const c of run.clicks) if (c.at <= t && (!cur || c.at >= cur.at)) cur = c;
    return cur;
  }

  // What the scenario asks of an actor at time t: { v (share of walk speed), om (rad/s) } or a native turn.
  function command(run, a, t) {
    const scn = run.scn, g = a.w.gaits.walk;
    let v = scn.speed || 1;
    if (scn.ramp) v = scn.ramp[0] + (scn.ramp[1] - scn.ramp[0]) * clamp(t / (scn.seconds * 0.85), 0, 1);
    if (scn.stops) { const per = scn.stops.go + scn.stops.stop, ph = t % per; if (ph >= scn.stops.go) v = 0; }
    const sp = steerPoint(a);
    let aim = null;
    if (run.targets) {
      const tg = targetAt(run, t);
      if (tg) {
        const d = Math.hypot(tg.x - sp.x, tg.z - sp.z);
        if (d < 0.25 * a.BL) v = 0; // arrived: stand
        else if (d < 0.8 * a.BL) v *= clamp(d / (0.8 * a.BL), 0.35, 1);
        aim = [tg.x, tg.z];
      }
    } else if (run.path) {
      const pr = progressOn(run.path, sp.x, sp.z, a.progress, 1.2 * run.u);
      a.progress = pr.d;
      aim = pathAt(run.path, a.progress + 0.55 * run.u);
    }
    let om = 0;
    if (aim) {
      // pure pursuit: the turn rate that would put the steering point on an arc through the aim point
      // (a far target is looked at from at most 0.8 path units, so the creature turns to face it instead of drifting)
      const alpha = wrap(headingTo(sp.x, sp.z, aim[0], aim[1]) - sp.th), Ld = clamp(Math.hypot(aim[0] - sp.x, aim[1] - sp.z), 1e-3, 0.8 * run.u);
      const vel = Math.max(a.w.v, 0.35 * g.speed * Math.max(v, 0.3));
      om = Math.abs(alpha) > Math.PI / 2 ? Math.sign(alpha) * 2 * vel / Ld : 2 * vel * Math.sin(alpha) / Ld;
      if (v === 0) om = 0;
    }
    return { v, om };
  }

  // Advance the run one fixed step. `build(a)` (optional) makes the actor's scene for drawing and for the leg measures;
  // the default builds it with the body modules (no renderer needed).
  function step(run, hooks) {
    hooks = hooks || {};
    const t = run.t;
    for (const ev of run.scn.events || []) {
      const key = ev.at + ':' + (ev.turn || ev.spin);
      if (t >= ev.at && !run.fired[key]) {
        run.fired[key] = true;
        for (const a of run.actors) { const M = a.kind === 'v1' ? M1 : M2; if (ev.spin) M.spin(a.w, ev.spin); else M.turn(a.w, ev.turn); }
      }
    }
    for (const a of run.actors) {
      const t0 = now();
      const cmd = command(run, a, t);
      const M = a.kind === 'v1' ? M1 : M2;
      a.out = M.step(a.w, DT, AREA, { drive: cmd });
      a.scene = buildScene(a, hooks);
      a.legs = groundLegs(a);
      const ms = now() - t0;
      sampleActor(run, a, ms);
    }
    run.t += DT; run.frame++;
  }
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function buildScene(a, hooks) {
    if (hooks.scene) return hooks.scene(a);
    if (a.kind === 'v1') return B.build(a.ph, a.out.pose);
    if (a.kind === 'v2') return C.scene(a.ph, a.w.R, a.out.pose);
    return null; // version 3 draws in 2D from the walker
  }
  // Each leg on the floor in world coordinates: hip, knee and the foot where the leg actually reaches (end).
  function groundLegs(a) {
    const w = a.w;
    if (a.scene && a.scene.legs) {
      const W = (p) => M1.toWorld(w, p[0], p[2]);
      return a.scene.legs.map((lg) => ({ hip: W(lg.hip), knee: W(lg.knee), end: W(lg.end || lg.foot), y: (lg.end || lg.foot)[1] }));
    }
    // version 3 (no 3D scene): hips from the rig, feet from the walker, the knee halfway and out; a swinging foot gets
    // the height of version 2's arc so the slide measure sees it lift
    const lift = 0.2 * w.R.legLen;
    return w.feet.map((f, i) => {
      const hp = w.R.hips[i], p = w.chain.joints[hp.joint], th = w.chain.angles[hp.joint];
      const hip = M2.toWorld({ x: p[0], z: p[1], th }, hp.off[0], hp.off[2]);
      const end = [f.wx, f.wz];
      return { hip, knee: [(hip[0] + end[0]) / 2, (hip[1] + end[1]) / 2], end, y: f.planted ? 0 : lift * Math.max(0.2, Math.sin(Math.PI * (f.u || 0))) };
    });
  }

  // Versions 2 and 3's stepping rule, made visible: for each foot, the spot it wants (under its hip, leading by half a
  // stride at speed), the circle it may fall behind by before it steps (STEP_AT strides; standing still, a small settle
  // circle), and how far behind it is now (1 = due to step). The same sums as motion2.js's tick.
  const SETTLE_TOL = 0.08; // motion2.js: standing still, a foot this share of the leg off its spot steps back
  function stepRings(a) {
    const w = a.w, R = w.R, gp = w.gaits[w.hurry ? 'hurry' : 'walk'];
    const D = Math.max(0.05 * gp.legLen, gp.D || 0.3 * gp.legLen);
    const share = clamp(w.v / Math.max(1e-6, gp.speed), 0, 1.3), moving = w.v > 1e-4;
    return w.feet.map((f, i) => {
      const hp = R.hips[i], p = w.chain.joints[hp.joint], th = w.chain.angles[hp.joint];
      const r = M2.toWorld({ x: p[0], z: p[1], th }, hp.foot[0], hp.foot[2]), lead = M2.LEAD * D * share;
      const c = [r[0] + Math.cos(th) * lead, r[1] - Math.sin(th) * lead];
      const radius = moving ? M2.STEP_AT * D : SETTLE_TOL * gp.legLen;
      return { wanted: c, radius, foot: [f.wx, f.wz], planted: f.planted, behind: Math.hypot(c[0] - f.wx, c[1] - f.wz) / radius };
    });
  }

  // ---------- the meter ----------
  function createMeter(BL) {
    return {
      BL, n: 0, footY: [], slideSum: 0, slideMax: 0, slideCount: 0, open: [], crossings: 0, crossing: {},
      hist: [], rates: [], wobbleSq: 0, wobbleN: 0, tightest: null, radiusNow: null, errSum: 0, errN: 0,
      msSum: 0, msN: 0, lastTh: null, bendMax: 0, bendNow: 0,
    };
  }
  function sampleActor(run, a, ms) {
    const m = a.meter, out = a.out, BL = m.BL;
    m.n++;
    m.msSum += ms; m.msN++;
    // Foot slide: from the moment a drawn foot touches the floor (its height within a hair of the lowest it gets),
    // how far it drifts until it lifts. This reads what is drawn, not the walker's planted flag, so a foot that scrapes
    // along low or is dragged by a leg that cannot reach counts too.
    const planted = out.feetState || [];
    a.legs.forEach((lg, i) => {
      const was = m.open[i];
      m.footY[i] = Math.min(m.footY[i] == null ? Infinity : m.footY[i], lg.y);
      if (lg.y <= m.footY[i] + 0.012 * BL) {
        if (!was) m.open[i] = { x: lg.end[0], z: lg.end[1], max: 0 };
        else { was.max = Math.max(was.max, Math.hypot(lg.end[0] - was.x, lg.end[1] - was.z)); }
      } else if (was) {
        closePlant(m, was); m.open[i] = null;
      }
    });
    // Leg crossings: two legs' floor shadows (hip, knee, foot) intersecting; each new crossing counts once.
    for (let i = 0; i < a.legs.length; i++) for (let j = i + 1; j < a.legs.length; j++) {
      const k = i + ',' + j, x = legsCross(a.legs[i], a.legs[j]);
      if (x && !m.crossing[k]) m.crossings++;
      m.crossing[k] = x;
    }
    // Body path: the middle of the body (version 1's origin, the chain's anchor joint).
    const th = a.w.th, x = a.w.x, z = a.w.z;
    if (m.lastTh != null) {
      const dth = wrap(th - m.lastTh), ds = Math.hypot(x - m.lastX, z - m.lastZ);
      m.hist.push({ ds, dth });
      if (m.hist.length > 900) m.hist.shift();
      // the tightest stretch: walk back until the heading has turned TURN_WINDOW
      let S = 0, A = 0, r = null;
      for (let i = m.hist.length - 1; i >= 0; i--) {
        S += m.hist[i].ds; A += m.hist[i].dth;
        if (Math.abs(A) >= TURN_WINDOW) { r = S / Math.abs(A); break; }
        if (S > 6 * BL) break;
      }
      m.radiusNow = r == null ? null : r / BL;
      if (r != null && (m.tightest == null || r / BL < m.tightest)) m.tightest = r / BL;
      // wobble: yaw rate minus its running average
      const rate = dth / DT;
      m.rates.push(rate);
      const win = Math.round(WOBBLE_WINDOW / DT);
      if (m.rates.length > win) m.rates.shift();
      const avg = m.rates.reduce((p, q) => p + q, 0) / m.rates.length;
      if (m.rates.length >= win) { const e = (rate - avg) * 180 / Math.PI; m.wobbleSq += e * e; m.wobbleN++; }
    }
    m.lastTh = th; m.lastX = x; m.lastZ = z;
    // Spine bend: how far the body bends along its length (chain: the sum of joint angles; rings: the body's bend).
    if (a.kind === 'v1') m.bendNow = Math.abs((out.pose.body && out.pose.body.bend) || 0) * 180 / Math.PI;
    else { const A = a.w.chain.angles; let s = 0; for (let i = 1; i < A.length; i++) s += Math.abs(wrap(A[i] - A[i - 1])); m.bendNow = s * 180 / Math.PI; }
    m.bendMax = Math.max(m.bendMax, m.bendNow);
    // How far the steering point is from the path.
    if (run.path) { const sp = steerPoint(a), pr = progressOn(run.path, sp.x, sp.z, Math.max(0, a.progress - 0.3 * run.u), 0.6 * run.u); m.errSum += pr.err; m.errN++; }
    // Trails for drawing (world): the body's middle and each planted foot.
    if (run.frame % 3 === 0) {
      a.trail.push([x, z]); if (a.trail.length > 600) a.trail.shift();
      a.legs.forEach((lg, i) => { if (planted[i]) a.footTrail.push([lg.end[0], lg.end[1], i]); });
      if (a.footTrail.length > 2400) a.footTrail.splice(0, a.footTrail.length - 2400);
    }
  }
  function closePlant(m, p) { m.slideSum += p.max; m.slideCount++; m.slideMax = Math.max(m.slideMax, p.max); }

  function segX(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    return o1 * o2 < 0 && o3 * o4 < 0;
  }
  function legsCross(p, q) {
    const P = [p.hip, p.knee, p.end], Q = [q.hip, q.knee, q.end];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) if (segX(P[i], P[i + 1], Q[j], Q[j + 1])) return true;
    return false;
  }

  // The meter's numbers, in body lengths, degrees and milliseconds. Open plants count as they are now.
  function summary(m) {
    let sum = m.slideSum, cnt = m.slideCount, mx = m.slideMax;
    for (const p of m.open) if (p) { sum += p.max; cnt++; mx = Math.max(mx, p.max); }
    return {
      footSlide: cnt ? (sum / cnt) / m.BL * 100 : 0,      // % of a body length, mean per plant
      footSlideMax: mx / m.BL * 100,
      tightestTurn: m.tightest,                          // body lengths (null: never turned 45°)
      turnNow: m.radiusNow,
      crossings: m.crossings,
      wobble: m.wobbleN ? Math.sqrt(m.wobbleSq / m.wobbleN) : 0, // deg/s
      bend: m.bendNow, bendMax: m.bendMax,                // degrees along the body
      pathError: m.errN ? m.errSum / m.errN / m.BL : null, // body lengths
      ms: m.msN ? m.msSum / m.msN : 0,
      frames: m.n,
    };
  }

  // ---------- what is different ----------
  const NAMES = { v1: 'Version 1', v2: 'Version 2', v3: 'Version 3' };
  const pct = (x) => (x < 1 ? x.toFixed(1) : Math.round(x)) + '%';
  // A few plain sentences from the live numbers, and a verdict for the scenario.
  function differences(run) {
    const S = {};
    for (const a of run.actors) S[a.kind] = summary(a.meter);
    const a = S.v1, b = S.v2;
    const lines = [];
    if (!a || !b) return { lines, verdict: '', scores: {} };
    const legs = run.ph.legs.pairs > 0;
    if (legs) {
      const better = a.footSlide > b.footSlide * 1.25 + 0.3 ? 'v2' : b.footSlide > a.footSlide * 1.25 + 0.3 ? 'v1' : null;
      lines.push({ key: 'slide', win: better, text: 'Planted feet drift ' + pct(a.footSlide) + ' of a body length in version 1 and ' + pct(b.footSlide) + ' in version 2' +
        (better ? ': ' + (better === 'v2' ? 'version 2\'s feet stay put, version 1\'s skate when the body turns faster than the clock steps.' : 'version 1\'s clock keeps its feet firmer here.') : ': about the same.') });
    } else lines.push({ key: 'slide', win: null, text: 'No legs: both slither. Version 2\'s whole body follows the head\'s wave; version 1 sways its rings.' });
    const ta = a.tightestTurn, tb = b.tightestTurn;
    if (ta != null || tb != null) {
      const f = (r) => (r == null ? 'never turned 45°' : r < 0.05 ? 'turned on the spot' : 'tightest turn ' + r.toFixed(2) + ' body lengths');
      lines.push({ key: 'turn', win: null, text: 'Turning: version 1 ' + f(ta) + ', version 2 ' + f(tb) + '. ' +
        ((ta != null && tb != null && ta < tb * 0.6) ? 'Version 1 can pivot; a chain needs room, so it arcs.' : 'Both arc through the turn.') });
    }
    lines.push({ key: 'bend', win: null, text: 'The body bends up to ' + Math.round(b.bendMax) + '° along version 2\'s chain, ' + Math.round(a.bendMax) + '° in version 1' +
      (b.bendMax > a.bendMax * 1.5 + 5 ? ': version 2 curves along its path, version 1 yaws as one stiff piece.' : '.') });
    if (legs) {
      const better = a.crossings > b.crossings ? 'v2' : b.crossings > a.crossings ? 'v1' : null;
      lines.push({ key: 'cross', win: better, text: 'Legs crossed ' + a.crossings + ' time' + (a.crossings === 1 ? '' : 's') + ' in version 1 and ' + b.crossings + ' in version 2' + (better ? '.' : ': a tie.') });
    }
    {
      const better = a.wobble > b.wobble * 1.3 + 2 ? 'v2' : b.wobble > a.wobble * 1.3 + 2 ? 'v1' : null;
      lines.push({ key: 'wobble', win: legs ? better : null, text: 'Heading wobble ' + Math.round(a.wobble) + '°/s in version 1, ' + Math.round(b.wobble) + '°/s in version 2' +
        (!legs ? ' (the legless wave is on purpose).' : better ? ' (' + NAMES[better].toLowerCase() + ' is steadier).' : '.') });
    }
    if (a.pathError != null && b.pathError != null) {
      const better = a.pathError > b.pathError * 1.3 + 0.02 ? 'v2' : b.pathError > a.pathError * 1.3 + 0.02 ? 'v1' : null;
      lines.push({ key: 'path', win: better, text: 'It strays ' + a.pathError.toFixed(2) + ' body lengths from the path in version 1, ' + b.pathError.toFixed(2) + ' in version 2' + (better ? '.' : ': both follow it.') });
    }
    lines.push({ key: 'cost', win: null, text: 'Cost: ' + a.ms.toFixed(2) + ' ms a frame for version 1, ' + b.ms.toFixed(2) + ' ms for version 2' + (S.v3 ? ', ' + S.v3.ms.toFixed(2) + ' ms for version 3' : '') + ' (motion and body; drawing not included).' });
    const scores = { v1: 0, v2: 0 };
    for (const l of lines) if (l.win) scores[l.win]++;
    const best = scores.v2 > scores.v1 ? 'v2' : scores.v1 > scores.v2 ? 'v1' : null;
    const why = lines.filter((l) => l.win === best).map((l) => ({ slide: 'feet that stay planted', cross: 'fewer crossed legs', wobble: 'a steadier heading', path: 'closer to the path' })[l.key]);
    // The verdict: what the eye sees in this scenario (written down from watching it), then what the numbers say.
    const eye = run.scn.eye, byEye = !eye || eye.win === 'draw' ? 'By eye: a draw, ' + (eye ? eye.why : 'judge for yourself') + '.' :
      'By eye: ' + NAMES[eye.win].toLowerCase() + ', because ' + eye.why + '.';
    const byNumbers = !best ? 'By the numbers: level.' : 'By the numbers: ' + NAMES[best].toLowerCase() + ' (' + why.join(', ') + ').';
    const verdict = byEye + ' ' + byNumbers;
    return { lines: lines.slice(0, 6), verdict, byEye, byNumbers, eye: eye ? eye.win : null, best, scores, summaries: S };
  }

  const api = { DT, SCENARIOS, byId, creatureFor, unitFor, samplePath, pathAt, createRun, step, targetAt, command, summary,
    differences, legsCross, bodyLength, steerPoint, groundLegs, stepRings };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureLab = api;
})(typeof window !== 'undefined' ? window : globalThis);
