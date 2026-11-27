/* Creatures prototype, version 2: how the creature moves, in argonaut's way (docs/argonaut-technique-analysis.md).
   The HEAD is the only thing that is steered. It moves forward at a speed and turns at a rate; every other joint is
   pulled after it by the chain's distance and angle constraints (chain.js), so the body bends along the path the head
   took, and the tail follows last. Legs are not driven by a gait clock as in version 1: each foot stays planted until
   the spot it wants to be (under its hip, a little ahead) is more than a stride away, then steps there, but only while
   its neighbours (the other foot of its pair and the feet next to it on its side) are down. That simple rule gives the
   diagonal, alternating walk of the video's lizard. The knee is solved with FABRIK, bending outward.
   What does not carry over: version 1 pivots on the spot; a chain cannot (the head needs room to lead the body round),
   so a 180° turn here is a tight U-turn and the 360° spin is a small loop.
   Behaviour (idle, wandering, noticing food, the eating sequence, hunger, flying, hops, blinks) is version 1's, copied.
   The walker's output has the same shape as version 1's step() output, plus the chain and legs for chain.scene(). */
(function (root) {
  'use strict';
  const C = root.CreatureChain || (typeof require === 'function' ? require('./chain.js') : null);
  const M1 = root.CreatureMotion || (typeof require === 'function' ? require('../prototype/motion.js') : null);

  const SUBSTEP = 1 / 60;
  const TURN_RADIUS = 0.55;        // body scales: the widest walking arc it will steer (yaw rate <= speed / radius)
  const TIGHT_RADIUS = 0.3;        // body scales: the head's arc in a U-turn or a spin
  const TURN_SPEED = 0.75;         // share of the hurry speed the head keeps in a U-turn or spin
  const TURN_RATE_MAX = 1.8;       // rad/s
  const STEER_GAIN = 2.2;
  const START_TIME = 0.45, STOP_TIME = 0.35;
  const YAW_ACCEL = 5;
  const EDGE_MARGIN = 0.12;
  const TURN_PAUSE = 0.3, HURRY_CHANCE = 0.25, SPIN_CHANCE = 0.08, LOOK_TURN_CHANCE = 0.15;
  const STEP_AT = 1.0;             // a foot steps when its wanted spot is this share of a stride away…
  const STEP_FORCE = 1.5;          // …and even with a neighbour in the air when it is this far
  const LEAD = 0.5;                // the wanted spot leads the hip by this share of a stride (scaled by speed)
  const SETTLE_TOL = 0.08;         // share of the leg: standing still, a foot this far off its rest spot steps back
  const BOB = 0.05;                // share of the leg: the body dips this much per foot in the air (spread over the feet)
  const WIGGLE = 0.45, WIGGLE_RATE = 1.4; // legless: the head swings this many radians, this many times per stride length
  const NOTICE_TIME = 0.5;
  const EAT_LOWER = 0.45, BITE_OPEN = 0.2, BITE_SNAP = 0.08, CHEW_TIME = 0.6, CHEW_RATE = 4;
  const SWALLOW_TIME = 0.6, HAPPY_TIME = 1.3, EAT_NOD = 0.5, EAT_DROP = 0.16;
  const HUNGER_RATE = 1 / 900, HUNGRY = 0.65, POOP_CHANCE = 0.3;
  const TAIL_STIFF = 26, TAIL_DAMP = 4.5;
  const HEAD_LEAD = 0.35;

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const wrap = C.wrap;
  const ease = (u) => u * u * u * (u * (u * 6 - 15) + 10);
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function toWorld(p, lx, lz) { const t = p.th != null ? p.th : p.heading, c = Math.cos(t), s = Math.sin(t); return [p.x + c * lx + s * lz, p.z - s * lx + c * lz]; }
  function toLocal(p, wx, wz) { const t = p.th != null ? p.th : p.heading, c = Math.cos(t), s = Math.sin(t), dx = wx - p.x, dz = wz - p.z; return [c * dx - s * dz, s * dx + c * dz]; }

  // A walker: the chain in world ground coordinates, the head's speed and turn rate, the feet, and version 1's moods.
  function createWalker(ph, seed, opts) {
    opts = opts || {};
    const R = C.rig(ph), L = R.L, s = R.s;
    const rnd = mulberry(seed >>> 0 || 1);
    const gaits = { walk: M1.gaitParams(ph, L, 'walk'), hurry: M1.gaitParams(ph, L, 'hurry') };
    const n = R.joints.length;
    const w = {
      R, L, ph, rnd, gaits, time: 0, x: 0, z: 0, th: 0, v: 0, om: 0, accel: 0, phase: 0, wig: 0,
      chain: { joints: new Array(n), angles: new Array(n), links: R.links },
      hurry: false, mode: 'idle', idleFor: 1 + rnd() * 2, goal: null, goFor: 0, turnLeft: 0, turnSign: 0, spinning: false, after: null,
      straight: 0, pause: 0, settled: true,
      rWalk: TURN_RADIUS * s, rTight: TIGHT_RADIUS * s,
      feet: [], bob: 0, tail: { a: 0, v: 0, lift: 0, lv: 0 }, blinkIn: 1.5 + rnd() * 3, blink: 0, look: 0, lookTo: 0, lookIn: 2,
      lift: 0, flying: false, tries: 0, hop: 0, hopV: 0, tuck: 0,
      hunger: opts.hunger == null ? 0.3 : opts.hunger, notice: 0, eat: null, mouthOpen: 0, swallow: 0, happy: 0,
      eatLean: 0, eatNod: 0, poopIn: 0, events: [],
    };
    place(w, opts.x || 0, opts.z || 0, opts.heading || 0);
    return w;
  }

  // Put the body down straight, its middle (the anchor joint) at (x, z), facing `heading`; feet at rest.
  function place(w, x, z, heading) {
    const R = w.R, d = C.dirOf(heading), ahead = R.joints[0].rx - R.joints[R.anchor].rx;
    C.straight(w.chain, x + d[0] * ahead, z + d[1] * ahead, heading);
    syncAnchor(w);
    w.feet = R.hips.map((hp, i) => { const q = restFoot(w, i); return { wx: q[0], wz: q[1], planted: true, from: null, u: 0, target: null }; });
    w.v = 0; w.om = 0;
  }
  function syncAnchor(w) {
    const a = w.chain.joints[w.R.anchor];
    w.x = a[0]; w.z = a[1]; w.th = w.chain.angles[w.R.anchor];
  }
  // A point carried by joint j: `fx` ahead of the joint along its heading and `lz` to its right.
  function onJoint(w, j, fx, lz) {
    const p = w.chain.joints[j], th = w.chain.angles[j];
    return toWorld({ x: p[0], z: p[1], th }, fx, lz);
  }
  function restFoot(w, i) { const hp = w.R.hips[i]; return onJoint(w, hp.joint, hp.foot[0], hp.foot[2]); }
  function hipGround(w, i) { const hp = w.R.hips[i]; return onJoint(w, hp.joint, hp.off[0], hp.off[2]); }
  const head = (w) => ({ x: w.chain.joints[0][0], z: w.chain.joints[0][1], th: w.chain.angles[0] });
  // Where the mouth is on the ground: ahead of the head joint.
  function mouthAt(w) { const h = head(w); return toWorld(h, w.R.mouthAhead, 0); }

  // Ask for a turn by `angle` radians (+ left). A chain can't pivot: the head swings round a tight arc and the body
  // follows it, so PI is a U-turn and 2*PI a small loop.
  function turn(w, angle, after) { w.mode = 'turn'; w.turnLeft = angle; w.turnSign = Math.sign(angle) || 1; w.spinning = Math.abs(angle) > Math.PI * 1.5; w.after = after || null; }
  function spin(w, sign) { turn(w, (sign || 1) * 2 * Math.PI, null); }

  // The head may go a little past the area the body's middle keeps to (the area is for the anchor joint).
  function headArea(w, area) {
    const m = Math.max(0, w.R.joints[0].rx - w.R.joints[w.R.anchor].rx) * 0.6;
    return area.line ? area : { minX: area.minX - m, maxX: area.maxX + m, minZ: area.minZ - m * 0.5, maxZ: area.maxZ + m * 0.5 };
  }
  function room(p, area, dx, dz) {
    let t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (area.maxX - p.x) / dx); else if (dx < -1e-9) t = Math.min(t, (area.minX - p.x) / dx);
    if (area.line) return Math.max(0, t);
    if (dz > 1e-9) t = Math.min(t, (area.maxZ - p.z) / dz); else if (dz < -1e-9) t = Math.min(t, (area.minZ - p.z) / dz);
    return Math.max(0, t);
  }
  function edgeTurn(w, area, after) {
    const h = head(w), ha = headArea(w, area);
    const left = room(h, ha, -Math.sin(h.th), -Math.cos(h.th)), right = room(h, ha, Math.sin(h.th), Math.cos(h.th));
    turn(w, (left > right ? 1 : -1) * (Math.PI - 0.35 * w.rnd()), after);
  }
  function randomGoal(w, area) {
    for (let k = 0; k < 12; k++) {
      const g = { x: area.minX + (area.maxX - area.minX) * w.rnd(), z: area.minZ + (area.maxZ - area.minZ) * w.rnd() };
      if (Math.hypot(g.x - w.x, g.z - w.z) >= 0.35 * w.R.s) return g;
    }
    return { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 };
  }
  // Is (x, z) inside the circle the head would trace turning its tightest way toward it? Then arcing can't reach it.
  function insideTurn(w, x, z, r) {
    const h = head(w), l = toLocal(h, x, z), side = l[1] >= 0 ? 1 : -1;
    return Math.hypot(l[0], l[1] - side * r) < r * 0.98;
  }

  function step(w, dt, area, maxX, opts) {
    if (typeof area === 'number') area = { minX: area, maxX, minZ: 0, maxZ: 0, line: true };
    else if (maxX && typeof maxX === 'object') opts = maxX;
    opts = opts || {};
    dt = clamp(dt, 0, 0.25);
    const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9));
    for (let k = 0; k < n; k++) tick(w, dt / n, area, k === 0 ? opts : Object.assign({}, opts, { hop: false }));
    return output(w);
  }

  // Behaviour: the head's commanded speed and turn rate. Same moods and choices as version 1.
  function decide(w, dt, area, opts, moving, force, gp, gw) {
    const s = w.R.s, h = head(w);
    const food = opts.food && !opts.food.gone && (opts.food.bites > 0 || (w.eat && w.eat.food === opts.food)) ? opts.food : null;
    if (!food && w.mode === 'eat' && w.eat && w.eat.stage !== 'swallow' && w.eat.stage !== 'happy') { w.mode = 'idle'; w.idleFor = 1; w.eat = null; }
    if (!food && w.goal && w.goal.food) { w.mode = 'idle'; w.idleFor = 1; w.goal = null; }
    if (food && w.mode !== 'eat' && !(w.goal && w.goal.food === food)) {
      w.notice += dt;
      w.lookTo = clamp(wrap(Math.atan2(-(food.z - h.z), food.x - h.x) - h.th), -0.7, 0.7);
      if (w.notice >= NOTICE_TIME && !(w.mode === 'turn' && w.spinning)) {
        w.mode = 'go'; w.goal = { food }; w.goFor = 30; w.hurry = w.hunger > HUNGRY; w.straight = 0;
      }
    } else if (!food) w.notice = 0;
    const decel = gw.speed / STOP_TIME;
    const ha = headArea(w, area);
    const wallAhead = (extra) => room(h, ha, Math.cos(h.th), -Math.sin(h.th)) < w.v * w.v / (2 * decel) + EDGE_MARGIN * s + (extra || 0);
    const steer = (om, v) => { const lim = Math.min(TURN_RATE_MAX, Math.max(v, 0.3 * gw.speed) / w.rWalk); return clamp(om, -lim, lim); };

    if (w.mode === 'turn') {
      if (Math.abs(w.turnLeft) < 0.03) {
        w.turnLeft = 0; w.spinning = false;
        if (w.after === 'force') w.mode = 'go';
        else if (w.after) { w.mode = 'go'; w.goal = w.after === 'ahead' ? randomGoal(w, area) : w.after; w.goFor = 12; }
        else { w.mode = 'idle'; w.idleFor = TURN_PAUSE + w.rnd() * 1.5; }
        w.after = null;
        return { v: w.mode === 'go' ? gp.speed * 0.5 : 0, om: 0 };
      }
      // The head swings round a tight arc; the chain drags the body after it.
      const v = TURN_SPEED * w.gaits.hurry.speed;
      return { v, om: w.turnSign * Math.min(TURN_RATE_MAX, v / w.rTight), turning: true };
    }
    if (force) {
      w.hurry = force === 'hurry';
      if (wallAhead(w.rTight)) { edgeTurn(w, area, 'force'); return { v: gp.speed, om: 0 }; }
      return { v: gp.speed, om: steer(opts.steer || 0, w.v) };
    }
    if (w.mode === 'eat') return { v: 0, om: 0 };
    if (w.mode === 'idle') {
      w.idleFor -= dt;
      if (w.idleFor <= 0 && moving && !opts.reduced) {
        const r = w.rnd(), hungry = w.hunger > HUNGRY;
        if (r < SPIN_CHANCE && !hungry) spin(w, w.rnd() < 0.5 ? 1 : -1);
        else if (r < SPIN_CHANCE + LOOK_TURN_CHANCE) turn(w, (w.rnd() < 0.5 ? 1 : -1) * (0.6 + 1.4 * w.rnd()), null);
        else { w.mode = 'go'; w.goal = randomGoal(w, area); w.goFor = 10 + 5 * w.rnd(); w.hurry = !hungry && w.rnd() < HURRY_CHANCE; }
      }
      return { v: 0, om: 0 };
    }
    if (!w.goal) { w.mode = 'idle'; w.idleFor = 1; return { v: 0, om: 0 }; }
    w.goFor -= dt;
    // Food: the head goes for the food itself and stops when the mouth is over it. A wandering goal: the head goes to it.
    const f = w.goal.food;
    const gx = f ? f.x : w.goal.x, gz = f ? f.z : w.goal.z;
    const diff = wrap(Math.atan2(-(gz - h.z), gx - h.x) - h.th);
    const dist = Math.hypot(gx - h.x, gz - h.z);
    const reach = f ? w.R.mouthAhead : Math.max(0.05 * s, 0.25 * gw.D);
    if (f && moving) {
      const m = mouthAt(w), md = Math.hypot(f.x - m[0], f.z - m[1]);
      // Close and roughly facing it: stop with the mouth over it and eat (the head turns the last bit).
      if ((md < 0.12 * s || dist < reach * 1.05) && Math.abs(diff) < 0.6) {
        if (w.v < 1e-3) { w.mode = 'eat'; w.eat = { stage: 'lower', t: 0, food: f }; w.goal = null; w.lookTo = clamp(diff, -0.6, 0.6); }
        return { v: 0, om: 0 };
      }
    }
    if ((!f && dist < reach) || w.goFor <= 0 || !moving) {
      w.mode = 'idle'; w.idleFor = 1.2 + w.rnd() * 3.5; w.goal = null;
      return { v: 0, om: 0 };
    }
    // Inside the circle the head traces turning its tightest way, steering can't reach the spot: walk straight on until
    // it is outside (the circle slides past it), then come round.
    const r = f ? w.rTight : w.rWalk;
    w.straight = Math.abs(diff) > 0.25 && insideTurn(w, gx, gz, r * (w.straight ? 1.15 : 1)) ? 1 : 0;
    if (wallAhead(w.rTight) && (Math.abs(diff) > 0.5 || w.straight)) { w.straight = 0; edgeTurn(w, area, w.goal); return { v: gp.speed * 0.5, om: 0 }; }
    if (w.straight) return { v: gp.speed * 0.8, om: 0 };
    const slow = Math.max(0.45, 1 - Math.abs(diff) / 2.4);
    const stopAt = f ? reach : reach * 0.5;
    const vArrive = Math.sqrt(2 * decel * Math.max(0, dist - stopAt)) + (f ? 0.2 * gp.speed : 0);
    const v = Math.min(gp.speed * slow, vArrive);
    const lim = Math.min(TURN_RATE_MAX, Math.max(v, 0.3 * gw.speed) / r);
    return { v, om: clamp(STEER_GAIN * diff, -lim, lim) };
  }

  // Version 1's eating sequence: lower the head, bite (the food gets smaller), chew; after the last bite swallow and be
  // happy. Returns the mouth opening and how far the head and body lean down.
  function eating(w, dt, reduced) {
    const e = w.eat, food = e.food;
    e.t += dt;
    let open = 0, nod = 0, lean = 0;
    if (e.stage === 'lower') {
      const u = Math.min(1, e.t / EAT_LOWER);
      nod = u; lean = u; open = 0.5 * u;
      if (e.t >= EAT_LOWER) { e.stage = 'bite'; e.t = 0; }
    } else if (e.stage === 'bite') {
      nod = 1; lean = 1;
      if (e.t < BITE_OPEN) open = 0.5 + 0.5 * e.t / BITE_OPEN;
      else if (e.t < BITE_OPEN + BITE_SNAP) open = 1 - (e.t - BITE_OPEN) / BITE_SNAP;
      else {
        if (!e.bitten) { e.bitten = true; food.bites = Math.max(0, food.bites - 1); food.held = true; w.events.push({ type: 'bite', left: food.bites }); }
        const c = e.t - BITE_OPEN - BITE_SNAP;
        nod = 0.6; open = 0.28 * Math.abs(Math.sin(Math.PI * CHEW_RATE * c));
        if (c >= CHEW_TIME) { e.t = 0; e.bitten = false; if (food.bites <= 0) e.stage = 'swallow'; }
      }
    } else if (e.stage === 'swallow') {
      nod = 0.2 * (1 - e.t / SWALLOW_TIME);
      w.swallow = Math.min(1, e.t / SWALLOW_TIME);
      if (e.t >= SWALLOW_TIME) {
        food.gone = true; w.swallow = 0;
        w.hunger = Math.max(0, w.hunger - (food.value == null ? 0.35 : food.value));
        w.events.push({ type: 'swallow', kind: food.kind });
        e.stage = 'happy'; e.t = 0; w.happy = HAPPY_TIME;
        if (!reduced) w.hopV = 0.6 * w.R.s;
        w.events.push({ type: 'happy' });
        if (w.rnd() < POOP_CHANCE) w.poopIn = 4 + 4 * w.rnd();
      }
    } else if (e.stage === 'happy' && e.t >= HAPPY_TIME * 0.6) { w.mode = 'idle'; w.idleFor = 1.5 + w.rnd() * 2; w.eat = null; }
    return { open, nod, lean };
  }

  function tick(w, dt, area, opts) {
    w.time += dt;
    const R = w.R, s = R.s;
    const reduced = !!opts.reduced;
    const moving = opts.walk !== false;
    const force = moving && !reduced && opts.force;
    w.hunger = Math.min(1, w.hunger + HUNGER_RATE * dt);
    const gw = w.gaits.walk;
    const cmd = w.tries || w.pause > 0 ? { v: 0, om: 0 } : decide(w, dt, area, opts, moving, force, w.gaits[w.hurry ? 'hurry' : 'walk'], gw);
    w.pause = Math.max(0, w.pause - dt);
    const gp = w.gaits[w.hurry ? 'hurry' : 'walk'];
    const v0 = w.v;
    const accel = Math.max(gp.speed, cmd.turning ? cmd.v : 0) / START_TIME, decel = Math.max(gw.speed, w.v) / STOP_TIME;
    w.v = clamp(cmd.v, w.v - decel * dt, w.v + accel * dt);
    w.om = clamp(cmd.om, w.om - YAW_ACCEL * dt, w.om + YAW_ACCEL * dt);
    if (!cmd.om && Math.abs(w.om) < 1e-3) w.om = 0;
    w.accel = (w.v - v0) / Math.max(1e-6, dt);
    // Legless: the head swings side to side as it goes, and the body follows the wave (the video's snake).
    let wig = 0;
    if (!R.hips.length && w.v > 1e-4) {
      w.wig += 2 * Math.PI * WIGGLE_RATE * w.v / Math.max(0.05, R.s) * dt;
      wig = WIGGLE * Math.cos(w.wig) * 2 * Math.PI * WIGGLE_RATE * w.v / Math.max(0.05, R.s) * (reduced ? 0.4 : 1);
    }
    // Move the head and pull the chain after it (distance + angle constraints).
    const h = head(w), om = w.om + wig, dth = om * dt, thm = h.th + dth / 2;
    let hx = h.x + Math.cos(thm) * w.v * dt, hz = h.z - Math.sin(thm) * w.v * dt;
    if (!area.line) {
      const ha = headArea(w, area);
      hx = clamp(hx, ha.minX, ha.maxX); hz = clamp(hz, ha.minZ, ha.maxZ);
    } else hx = clamp(hx, area.minX - 1, area.maxX + 1);
    if (w.mode === 'turn') w.turnLeft -= w.om * dt;
    C.follow(w.chain, hx, hz, h.th + dth, R.bend);
    syncAnchor(w);
    w.phase = (w.phase + w.v * dt / Math.max(1e-3, gp.D || 0.2 * s)) % 1;

    // Feet: each wants a spot under its hip, leading by half a stride when moving. A planted foot steps when that spot
    // is a stride away, if the feet next to it are down; a lifted one swings there over a short arc.
    const tuckTo = w.lift > 0.02 * s ? 1 : 0;
    w.tuck += clamp(tuckTo - w.tuck, -4 * dt, 4 * dt);
    const speedShare = clamp(w.v / Math.max(1e-6, gp.speed), 0, 1.3);
    const D = Math.max(0.05 * gp.legLen, gp.D || 0.3 * gp.legLen);
    const swingT = Math.max(0.09, (1 - gp.duty) / gp.f);
    const moved = w.v > 1e-4;
    const wanted = (i) => {
      const r = restFoot(w, i), th = w.chain.angles[R.hips[i].joint], lead = LEAD * D * speedShare;
      return [r[0] + Math.cos(th) * lead, r[1] - Math.sin(th) * lead];
    };
    const nb = (i) => { const out = [i ^ 1]; if (i - 2 >= 0) out.push(i - 2); if (i + 2 < w.feet.length) out.push(i + 2); return out; };
    const order = w.feet.map((f, i) => { const q = wanted(i); return { i, d: Math.hypot(q[0] - f.wx, q[1] - f.wz) }; }).sort((a, b) => b.d - a.d);
    for (const { i, d } of order) {
      const f = w.feet[i];
      if (w.tuck > 0.01) { const q = restFoot(w, i); f.wx = q[0]; f.wz = q[1]; f.planted = true; f.target = null; continue; }
      if (f.planted) {
        const due = moved ? d > STEP_AT * D : d > SETTLE_TOL * gp.legLen;
        const free = nb(i).every((j) => w.feet[j].planted) || d > STEP_FORCE * D;
        if (due && free) { f.planted = false; f.from = [f.wx, f.wz]; f.u = 0; }
        else continue;
      }
      const q = wanted(i);
      f.target = q;
      f.u = Math.min(1, f.u + dt / swingT);
      const e = ease(f.u);
      f.wx = f.from[0] + (q[0] - f.from[0]) * e; f.wz = f.from[1] + (q[1] - f.from[1]) * e;
      if (f.u >= 1) { f.planted = true; f.target = null; }
    }
    w.settled = !moved && w.feet.every((f) => f.planted);
    // The body dips a little while feet are in the air (weight on fewer legs).
    const air = w.feet.reduce((a, f) => a + (f.planted ? 0 : Math.sin(Math.PI * f.u)), 0) / Math.max(1, w.feet.length);
    const bobT = w.feet.length ? -BOB * gp.legLen * air * 2 : 0.02 * s * Math.max(0, Math.sin(w.wig * 2)) * speedShare;
    w.bob += (bobT - w.bob) * Math.min(1, dt * 20);

    let eat = { open: 0, nod: 0, lean: 0 };
    if (w.mode === 'eat' && w.eat) eat = eating(w, dt, reduced);
    w.mouthOpen += (eat.open - w.mouthOpen) * Math.min(1, dt * 30);
    w.eatLean += (eat.lean - w.eatLean) * Math.min(1, dt * 8);
    w.eatNod += (eat.nod - w.eatNod) * Math.min(1, dt * 8);
    w.happy = Math.max(0, w.happy - dt);
    if (w.poopIn > 0) {
      w.poopIn -= dt;
      if (w.poopIn <= 0) { const j = Math.max(R.anchor, R.tailStart > 0 ? R.tailStart : R.joints.length - 1), p = onJoint(w, j, -0.05 * s, 0); w.events.push({ type: 'poop', x: p[0], z: p[1] }); }
    }

    // Wings and hops: version 1's rules.
    const fly = M1.canFly(w.ph);
    if (w.ph.wings && w.ph.wings.size > 0 && !reduced && w.mode !== 'eat') {
      if (!w.flying && !w.tries && !force && w.rnd() < dt * 0.06) { if (fly) w.flying = 3 + w.rnd() * 4; else w.tries = 1.4; }
      if (w.flying) w.flying = Math.max(0, w.flying - dt);
      else if (w.tries) { w.tries = Math.max(0, w.tries - dt); if (w.hop === 0 && w.hopV === 0) w.hopV = 0.6 * s; }
    }
    const liftTarget = w.flying ? 0.28 * s + Math.sin(w.time * 2.2) * 0.03 * s : 0;
    w.lift += (liftTarget - w.lift) * Math.min(1, dt * 2.5);
    if (opts.hop && w.hop === 0 && w.hopV === 0 && !reduced) w.hopV = 0.8 * s;
    if (w.hopV !== 0 || w.hop > 0) {
      w.hop += w.hopV * dt; w.hopV -= 6 * s * dt;
      if (w.hop <= 0) { w.hop = 0; w.hopV = 0; }
    }

    // The tail tip on a spring: an idle sway and a happy wag (walking, the chain already swings it).
    const idleSway = Math.sin(w.time * 1.6) * 0.18 * (1 - Math.min(1, speedShare)) * (reduced ? 0.3 : 1);
    const tailTarget = idleSway + (w.happy > 0 ? 0.3 * Math.sin(w.time * 14) : 0);
    w.tail.v += (TAIL_STIFF * (tailTarget - w.tail.a) - TAIL_DAMP * w.tail.v) * dt;
    w.tail.a += w.tail.v * dt;
    const liftT = 0.1 * Math.min(1, speedShare) + (w.flying ? -0.15 : 0) + (w.happy > 0 ? 0.15 : 0);
    w.tail.lv += (TAIL_STIFF * 0.6 * (liftT - w.tail.lift) - TAIL_DAMP * w.tail.lv - w.accel * 0.6 / s) * dt;
    w.tail.lift += w.tail.lv * dt;

    w.blinkIn -= dt;
    if (w.blinkIn <= 0) { w.blink = 0.13; w.blinkIn = 2 + w.rnd() * 4; }
    w.blink = Math.max(0, w.blink - dt);
    w.lookIn -= dt;
    if (w.lookIn <= 0 && !w.notice && w.mode !== 'eat') { w.lookTo = (w.rnd() - 0.5) * (w.hunger > HUNGRY ? 1.2 : 0.7); w.lookIn = 1.5 + w.rnd() * 3; }
    const lookFree = w.mode === 'eat' ? w.lookTo : w.v > 0.2 * gw.speed ? w.lookTo * 0.25 : w.lookTo;
    w.look += (clamp(lookFree + HEAD_LEAD * w.om, -0.8, 0.8) - w.look) * Math.min(1, dt * (reduced ? 1 : 4));
  }

  // The chain and legs in the body frame of the anchor joint (x forward, y up, z right), for chain.scene().
  function bodyPose(w) {
    const R = w.R, n = R.joints.length, A = { x: w.x, z: w.z, th: w.th };
    const ts = R.tailStart > 0 ? R.tailStart : n;
    const joints = [];
    for (let i = 0; i < n; i++) {
      const l = toLocal(A, w.chain.joints[i][0], w.chain.joints[i][1]);
      // eating lowers the front of the body toward the food; the tail lifts a little when walking
      const front = Math.max(0, 1 - i / Math.max(1, R.anchor));
      const tailU = i >= ts ? (i - ts + 1) / (n - ts) : 0;
      const y = R.joints[i].y + w.bob - EAT_DROP * R.s * w.eatLean * front * front + w.tail.lift * R.s * 0.5 * tailU * tailU;
      joints.push({ x: l[0], y, z: l[1], phi: wrap(w.chain.angles[i] - w.th) });
    }
    // the tail's spring sway: bend the tail joints round the tail root, more toward the tip
    if (ts < n && Math.abs(w.tail.a) > 1e-4) {
      const o = joints[ts - 1];
      for (let i = ts; i < n; i++) {
        const a = w.tail.a * (i - ts + 1) / (n - ts), c = Math.cos(a), sn = Math.sin(a), x = joints[i].x - o.x, z = joints[i].z - o.z;
        joints[i].x = o.x + c * x + sn * z; joints[i].z = o.z - sn * x + c * z; joints[i].phi += a;
      }
    }
    const legs = w.feet.map((f, i) => {
      const hp = R.hips[i], jt = joints[hp.joint], rest = R.joints[hp.joint];
      const c = Math.cos(jt.phi), sn = Math.sin(jt.phi);
      const ox = hp.off[0], oz = hp.off[2];
      const hip = [jt.x + c * ox + sn * oz, hp.off[1] - rest.y + jt.y, jt.z - sn * ox + c * oz];
      const l = toLocal(A, f.wx, f.wz);
      let y = hp.foot[1];
      if (!f.planted) {
        const reachG = f.from ? Math.hypot((f.target || f.from)[0] - f.from[0], (f.target || f.from)[1] - f.from[1]) : 0;
        const gp = w.gaits[w.hurry ? 'hurry' : 'walk'];
        y += Math.min(gp.stepH || 0.05, Math.max((gp.stepH || 0.05) * 0.35, reachG * 0.6)) * Math.pow(Math.sin(Math.PI * f.u), 0.8);
      }
      let foot = [l[0], y, l[1]];
      if (w.tuck > 0.01) {
        const k = w.tuck * w.tuck * (3 - 2 * w.tuck);
        const t = [hip[0] - 0.03 * R.s, Math.max(y, hip[1] - R.legLen * 0.55), hip[2]];
        foot = [foot[0] + (t[0] - foot[0]) * k, foot[1] + (t[1] - foot[1]) * k, foot[2] + (t[2] - foot[2]) * k];
      }
      return { hip, foot };
    });
    return { joints, legs };
  }

  function output(w) {
    const R = w.R, bp = bodyPose(w);
    const pose = {
      joints: bp.joints, legs: bp.legs,
      breathe: Math.sin(w.time * 2.2), lookYaw: w.look, headNod: -EAT_NOD * w.eatNod, wingFlap: 0,
      blink: w.blink > 0 ? 1 : 0, lift: w.lift + w.hop, mouthOpen: w.mouthOpen, swallow: w.swallow, expression: w.happy > 0 ? 'happy' : null,
    };
    pose.wingFlap = w.flying ? Math.sin(w.time * 11) * 0.7 : w.tries ? Math.sin(w.time * 22) * 0.8 :
      Math.sin(w.time * 1.3) * 0.05 + (w.ph.wings && w.ph.wings.size > 0 ? 0.12 * Math.min(1, w.v / Math.max(1e-6, w.gaits.walk.speed)) * Math.sin(2 * Math.PI * (2 * w.phase + 0.15)) : 0);
    const gp = w.gaits[w.hurry ? 'hurry' : 'walk'];
    const events = w.events; w.events = [];
    const goal = !w.goal ? null : w.goal.food ? { x: w.goal.food.x, z: w.goal.food.z, food: true } : { x: w.goal.x, z: w.goal.z };
    const state = w.mode === 'eat' ? 'eat' : w.mode === 'turn' ? (w.spinning ? 'spin' : 'turn') : w.mode === 'idle' && w.hunger > HUNGRY ? 'hungry' : w.mode;
    const local = (wx, y, wz) => { const l = toLocal(w, wx, wz); return [l[0], y, l[1]]; };
    const h = head(w);
    return {
      pose, x: w.x, z: w.z, th: w.th, heading: w.th, dir: Math.cos(w.th) >= 0 ? 1 : -1, yawRate: w.om, lift: pose.lift, flying: !!w.flying,
      trying: !!w.tries, mode: w.mode, state, hunger: w.hunger, hungry: w.hunger > HUNGRY, events, goal,
      pivot: [h.x, h.z], head: h, // there is no pivot: the head leads; the debug view marks it instead
      feetState: w.feet.map((f) => f.planted && w.tuck <= 0.01),
      targets: w.feet.map((f, i) => (f.target && !f.planted ? local(f.target[0], R.hips[i].foot[1], f.target[1]) : null)),
      chain: w.chain.joints.map((p) => p.slice()),
      gait: { family: gp.family, name: gp.name, phase: w.phase, duty: gp.duty, offsets: gp.offsets.slice(), speed: w.v, cadence: gp.f, stride: gp.D, settled: w.settled },
    };
  }

  const api = { createWalker, step, turn, spin, place, toWorld, toLocal, mouthAt, bodyPose, insideTurn,
    TURN_RADIUS, TIGHT_RADIUS, STEP_AT, LEAD, HUNGRY, HUNGER_RATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureMotion2 = api;
})(typeof window !== 'undefined' ? window : globalThis);
