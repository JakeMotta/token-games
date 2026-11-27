/* Creatures prototype: procedural motion, as the video describes it (step 6). Nobody animates the walk:
   - feet stay planted on the ground until it is their turn to step, then swing to a spot ahead of the hip;
   - the tail swings on a spring;
   - wings only lift the body when they are big enough for it; too small and it doesn't fly, it tries anyway.
   Plus the pet-sim extras: breathing, blinking, looking around, a happy hop. No DOM.

   The walk is a gait: one clock (phase 0..1 per stride) and, for every foot, the point in the cycle where it lands
   (its phase offset) and how much of the cycle it spends on the ground (the duty factor). Stance: the foot is pinned
   to the world while the body moves over it. Swing: it lifts and lands half a stride ahead of its rest spot, where the
   hip will be when it lands. Stride length and cadence come from leg length (long legs stride, short legs patter,
   babies waddle); the stride is capped so a leg is never pulled straighter than MAX_STRETCH. The body bobs, sways,
   pitches and rolls with whichever feet are holding it up; the head steadies against it and the tail follows late. */
(function (root) {
  'use strict';
  const B = typeof module !== 'undefined' && module.exports ? require('./body.js') : root.CreatureBody;

  // ---------- gaits ----------
  // Legs are numbered from the back pair forward, left then right: 0 = left hind, 1 = right hind, 2 = next pair left…
  // offsets[i] = when in the cycle foot i lands; duty = share of the cycle it stays down. `walk` is the stroll,
  // `hurry` the quicker gait used for short dashes.
  const GAITS = {
    biped: {
      walk: { name: 'walk', duty: 0.62, offsets: [0, 0.5] },             // alternate, with a little double support
      hurry: { name: 'jog', duty: 0.5, offsets: [0, 0.5] },
    },
    quadruped: {
      walk: { name: 'walk', duty: 0.75, offsets: [0, 0.5, 0.25, 0.75] }, // lateral sequence LH, LF, RH, RF: 3 feet down
      hurry: { name: 'trot', duty: 0.56, offsets: [0, 0.5, 0.5, 0] },    // diagonal pairs together
    },
    hexapod: {
      walk: { name: 'wave', duty: 0.7, offsets: [0, 0.5, 1 / 3, 5 / 6, 2 / 3, 1 / 6] }, // back-to-front ripple, sides half a cycle apart
      hurry: { name: 'tripod', duty: 0.52, offsets: [0, 0.5, 0.5, 0, 0, 0.5] },        // L3 R2 L1 / R3 L2 R1
    },
    legless: { walk: { name: 'scoot', duty: 1, offsets: [] }, hurry: { name: 'scoot', duty: 1, offsets: [] } },
  };
  const FAMILY = { 0: 'legless', 2: 'biped', 4: 'quadruped', 6: 'hexapod' };

  const SPRITE_FPS = 12;           // the sprite clock; a stride takes a whole number of these frames, so walks loop crisply
  const CADENCE_REF = 1.45;        // strides per second for a leg LEG_REF long (shorter legs step faster: sqrt scaling)
  const LEG_REF = 0.3;
  const CADENCE_MIN = 0.7, CADENCE_MAX = 2.0;
  const HURRY_CADENCE = 1.3;       // the hurry gait steps this much quicker…
  const STRIDE_WALK = 0.62;        // …and the foot sweeps this much of a leg length under the body per stance
  const STRIDE_HURRY = 0.9;
  const BABY_STRIDE = 0.6;         // a level 1 baby takes this share of an adult's stride (it waddles, adults stride)
  const MAX_STRETCH = 0.95;        // hip-to-foot never over this share of the leg length
  const CROUCH_MAX = 0.1;          // the body may sink this share of a leg length while walking to make room for a stride
  const STEP_HEIGHT = 0.16;        // foot lift at mid-swing, share of the leg length
  const BOB_WALK = 0.14, BOB_HURRY = -0.1; // body bob per stride length; walk: highest over the planted foot; hurry: dips
  const PITCH_GAIN = 0.25;         // nose up when the front feet are holding the body
  const ROLL = 0.05, SWAY = 0.035; // lean and shift toward the standing side (radians; share of leg length)
  const BIPED_WADDLE = 1.8, BABY_WADDLE = 1.3; // two legs and youth both make the lean bigger
  const START_TIME = 0.45, STOP_TIME = 0.35;   // seconds to reach walking speed and to stop from it
  const STOP_CADENCE = 0.8;        // stopping: the clock keeps going at this rate until every foot is back under its hip
  const MIN_STRIDE = 0.45;         // walking slowly takes shorter steps: the stride at a crawl, share of the full one
  const LEAN = 0.04;               // radians of lean into a start (and back out of a stop)
  const EARLY_TOL = 0.03;          // a foot this much (share of leg length) past the back of its stride steps early
  const SETTLE_TOL = 0.06;         // a foot this close to its rest spot (share of leg length) needn't step when stopping
  const GAIT_BLEND = 2.5;          // per second: how fast offsets slide between walk and hurry
  const TURN_PAUSE = 0.3;          // seconds standing still after turning round
  const HURRY_CHANCE = 0.25;       // share of walks that are dashes
  const LEGLESS_SPEED = 0.14;      // no legs: it scoots (world units per second at scale 1)
  const SUBSTEP = 1 / 60;
  const FLY_RATIO = 0.9;           // wing area / body size needed to lift off
  const TAIL_STIFF = 26, TAIL_DAMP = 4.5;
  const HEAD_STIFF = 60, HEAD_DAMP = 9, HEAD_STEADY = 0.8, HEAD_NOD = 0.9;

  // How well the wings could carry this body (the video's "wings only lift a body when they're big enough").
  function wingLift(ph) {
    if (!ph.wings || ph.wings.size <= 0) return 0;
    const wingArea = ph.wings.size * (0.6 + 0.8 * ph.wings.span);
    const bodySize = Math.max(...ph.torso.rings.map((r) => r.w * r.h)) * 18 * ph.torso.length + 0.3 * Math.max(...ph.head.rings.map((r) => r.w));
    return wingArea / Math.max(0.05, bodySize);
  }
  function canFly(ph) { return wingLift(ph) >= FLY_RATIO; }

  const frac = (x) => x - Math.floor(x);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // Support of each foot at clock phase `phase`: 0 in the air, rising to 1 at mid-stance.
  function supports(phase, g) {
    return g.offsets.map((o) => { const p = frac(phase - o); return p < g.duty ? Math.sin(Math.PI * p / g.duty) : 0; });
  }
  function supportStats(g) {
    if (!g.offsets.length) return { mean: 0, range: 0 };
    let sum = 0, lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 96; k++) { const s = supports(k / 96, g), m = s.reduce((a, b) => a + b, 0) / s.length; sum += m; lo = Math.min(lo, m); hi = Math.max(hi, m); }
    return { mean: sum / 96, range: hi - lo, up: (hi - sum / 96) / Math.max(1e-6, hi - lo), down: (sum / 96 - lo) / Math.max(1e-6, hi - lo) };
  }

  // Everything about how this body walks in one gait mode ('walk' or 'hurry'): cadence, stride, speed, step height,
  // how much it may crouch, and the body motion amplitudes. Pure, so tests can check it for every creature and level.
  function gaitParams(ph, L, mode) {
    L = L || B.layout(ph);
    const n = L.feet.length, family = FAMILY[n] || 'quadruped';
    const g = GAITS[family][mode === 'hurry' ? 'hurry' : 'walk'];
    const growth = ph.growth == null ? 1 : ph.growth, youth = 1 - growth;
    const s = L.s, legLen = L.legLen;
    if (!n) {
      const f = SPRITE_FPS / Math.round(SPRITE_FPS / 1.4);
      return { family, mode, name: g.name, duty: 1, offsets: [], f, D: 0, speed: LEGLESS_SPEED * s * (mode === 'hurry' ? 1.5 : 1), stepH: 0, crouch: 0,
        bobAmp: 0.035 * s, pitchAmp: 0.06, rollAmp: 0, swayAmp: 0, legLen, mean: 0, range: 1 };
    }
    let f = CADENCE_REF * Math.sqrt(LEG_REF / Math.max(0.02, legLen)) * (mode === 'hurry' ? HURRY_CADENCE : 1);
    f = clamp(f, CADENCE_MIN, CADENCE_MAX * (mode === 'hurry' ? 1.15 : 1));
    f = SPRITE_FPS / Math.round(SPRITE_FPS / f);
    const waddle = (family === 'biped' ? BIPED_WADDLE : 1) * (1 + BABY_WADDLE * youth);
    const rollAmp = Math.min(0.2, ROLL * waddle), swayAmp = SWAY * legLen * waddle;
    const hipsX = L.hips.map((h) => h.p[0]);
    const bodyLen = Math.max(0.1 * s, Math.max(...hipsX) - Math.min(...hipsX));
    const o = L.tsp.pts[Math.floor(L.tsp.pts.length / 2)];
    const Lr = MAX_STRETCH * legLen;
    let D = (mode === 'hurry' ? STRIDE_HURRY : STRIDE_WALK) * legLen * (BABY_STRIDE + (1 - BABY_STRIDE) * growth);
    let crouch = 0, bobAmp = 0, pitchAmp = 0;
    const st = supportStats(g), bobSign = mode === 'hurry' ? BOB_HURRY : BOB_WALK;
    // Shrink the stride (after crouching as far as allowed) until every leg reaches both ends of it.
    for (let it = 0; it < 40; it++) {
      bobAmp = bobSign * D;
      const bobUp = bobAmp > 0 ? bobAmp * st.up : -bobAmp * st.down; // highest the hips get from the bob
      pitchAmp = family === 'biped' ? 0 : Math.min(0.12, PITCH_GAIN * D / bodyLen);
      let need = 0;
      L.hips.forEach((hp, i) => {
        const rest = L.feet[i];
        const rise = bobUp + (pitchAmp + LEAN) * Math.abs(hp.p[0] - o[0]) + rollAmp * Math.abs(hp.p[2]);
        const dy = hp.p[1] + rise - rest[1], dz = Math.abs(hp.p[2] - rest[2]) + swayAmp + rollAmp * Math.abs(hp.p[1] - o[1]);
        const dx = Math.abs(rest[0] - hp.p[0]) + D / 2;
        const room = Lr * Lr - dz * dz - dx * dx;
        need = Math.max(need, room <= 0 ? Infinity : dy - Math.sqrt(room));
      });
      crouch = Math.max(0, need);
      if (crouch <= CROUCH_MAX * legLen) break;
      D *= 0.92;
    }
    return { family, mode, name: g.name, duty: g.duty, offsets: g.offsets.slice(), f, D, speed: D * f / g.duty,
      stepH: STEP_HEIGHT * legLen * (0.7 + 0.3 * growth) * (mode === 'hurry' ? 1.2 : 1), crouch,
      bobAmp, pitchAmp, rollAmp, swayAmp, legLen, mean: st.mean, range: st.range };
  }

  function createWalker(ph, seed, opts) {
    opts = opts || {};
    const L = B.layout(ph);
    const rnd = mulberry(seed >>> 0 || 1);
    const gaits = { walk: gaitParams(ph, L, 'walk'), hurry: gaitParams(ph, L, 'hurry') };
    const x = opts.x || 0;
    return {
      L, ph, rnd, gaits, time: 0, progress: 0, dir: 1, x, v: 0, accel: 0, phase: 0, walking: false, hurry: false,
      idleFor: 1 + rnd() * 2, walkFor: 0, wantTurn: false, pause: 0, settled: true,
      offsets: gaits.walk.offsets.slice(), duty: gaits.walk.duty, cadence: 0, stride: 0,
      feet: L.feet.map((f) => ({ wx: x + f[0], y: f[1], z: f[2], planted: true, skip: false, from: null, u: 0, target: null })),
      body: { bob: 0, sway: 0, pitch: 0, roll: 0 }, bobV: 0, crouchW: 0,
      tail: { a: 0, v: 0, lift: 0, lv: 0 }, head: { a: 0, v: 0 }, blinkIn: 1.5 + rnd() * 3, blink: 0, look: 0, lookTo: 0, lookIn: 2,
      lift: 0, flap: 0, flying: false, tries: 0, hop: 0, hopV: 0, tuck: 0,
    };
  }
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // Body-local x of a foot (the body faces dir along the world x axis).
  const localX = (w, wx) => (wx - w.x) * w.dir;

  // Advance the walker by dt seconds inside [minX, maxX] (world units). Returns the pose for CreatureBody.build plus
  // where to draw it: { pose, x, dir, lift, flying, trying, feetState, targets, gait }.
  // opts: { reduced: true } stops walking and hopping (Reduced motion); { walk: false } keeps it standing;
  // { force: 'walk' | 'hurry' } walks without stopping (frame strips, tests); { hop: true } asks for a hop.
  function step(w, dt, minX, maxX, opts) {
    opts = opts || {};
    dt = clamp(dt, 0, 0.25);
    const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9));
    for (let k = 0; k < n; k++) tick(w, dt / n, minX, maxX, k === 0 ? opts : Object.assign({}, opts, { hop: false }));
    return output(w);
  }

  function tick(w, dt, minX, maxX, opts) {
    w.time += dt;
    const s = w.L.s;
    const reduced = !!opts.reduced;
    const moving = !reduced && opts.walk !== false;
    const force = moving && opts.force;

    // Decide: idle a while, then walk a while (sometimes a dash); now and then turn round; always turn at the edges.
    if (force) { w.walking = true; w.hurry = force === 'hurry'; }
    else if (w.walking) { w.walkFor -= dt; if (w.walkFor <= 0 || !moving) { w.walking = false; w.idleFor = 1.5 + w.rnd() * 4; } }
    else { w.idleFor -= dt; if (w.idleFor <= 0 && moving) { w.walking = true; w.walkFor = 2 + w.rnd() * 5; w.hurry = w.rnd() < HURRY_CHANCE; if (w.rnd() < 0.3) w.wantTurn = true; } }
    const gp = w.gaits[w.hurry ? 'hurry' : 'walk'], gw = w.gaits.walk;
    const decel = gw.speed / STOP_TIME, accel = gp.speed / START_TIME;
    const ahead = w.dir > 0 ? maxX - w.x : w.x - minX;
    if (moving && w.v * w.v / (2 * decel) + 0.02 * s >= ahead) w.wantTurn = true;
    w.pause = Math.max(0, w.pause - dt);
    const vCmd = w.walking && !w.wantTurn && !w.pause && moving && !w.tries ? gp.speed : 0;
    // Setting off from a stand: start the clock where the left hind foot is due to lift, so the first step is a step.
    if (vCmd > 0 && w.v === 0 && w.settled && w.feet.length && w.tuck < 0.01) w.phase = frac(w.offsets[0] + w.duty);
    const v0 = w.v;
    w.v = clamp(vCmd, w.v - decel * dt, w.v + accel * dt);
    w.accel = (w.v - v0) / Math.max(1e-6, dt);
    const nx = w.x + w.dir * w.v * dt;
    if (nx < minX || nx > maxX) { w.v = 0; w.wantTurn = true; } else { w.x = nx; w.progress += w.v * dt; }
    const stopping = vCmd === 0;

    // The gait: offsets and duty slide toward the current mode's; the clock runs at a cadence that grows with speed,
    // and keeps running after a stop until the feet are back under the hips.
    const blend = Math.min(1, GAIT_BLEND * dt);
    w.offsets = w.offsets.map((o, i) => { const d = frac(gp.offsets[i] - o + 0.5) - 0.5; return frac(o + d * blend); });
    w.duty += (gp.duty - w.duty) * blend;
    const nFeet = w.feet.length;
    const restOff = (i) => Math.abs(localX(w, w.feet[i].wx) - w.L.feet[i][0]);
    w.settled = w.v < 1e-4 && w.feet.every((f, i) => f.planted && (f.skip || restOff(i) < SETTLE_TOL * gw.legLen));
    // The clock runs by distance: one stance lasts exactly one stride of travel, so a planted foot can never be left
    // further behind than the stride allows, however the speed changes. Slow walking takes shorter strides.
    const strideAt = (v) => gp.D * (MIN_STRIDE + (1 - MIN_STRIDE) * Math.min(1, v / gp.speed));
    const byDistance = w.v > 1e-4 ? w.v * w.duty / strideAt(w.v) : 0;
    w.cadence = Math.max(byDistance, stopping && !w.settled ? gp.f * STOP_CADENCE : 0);
    w.stride = w.cadence > 0 ? w.v * w.duty / w.cadence : 0;
    // Speeding up: aim each landing for the stride it is heading for, so the body can't outrun the feet.
    w.aim = vCmd > w.v ? strideAt(vCmd) : w.stride;
    if (!nFeet && w.v > 1e-4) w.cadence = gp.f;
    w.phase = frac(w.phase + w.cadence * dt);

    // Turning round: only once stopped and settled, then a short pause before setting off the other way.
    if (w.wantTurn && w.settled && w.v < 1e-4) {
      w.dir = -w.dir; w.wantTurn = false; w.pause = TURN_PAUSE;
      w.feet.forEach((f, i) => { f.wx = w.x + w.dir * w.L.feet[i][0]; f.planted = true; f.skip = false; });
    }

    // Feet. Tucked up in flight (and re-planted under the body for landing); otherwise stance or swing by phase.
    const tuckTo = w.lift > 0.02 * s ? 1 : 0;
    w.tuck += clamp(tuckTo - w.tuck, -4 * dt, 4 * dt);
    w.feet.forEach((f, i) => {
      const rest = w.L.feet[i];
      if (w.tuck > 0.01) { f.wx = w.x + w.dir * rest[0]; f.y = rest[1]; f.z = rest[2]; f.planted = true; f.skip = false; f.target = null; return; }
      const p = frac(w.phase - w.offsets[i]);
      const wrapped = f.lastP != null && p < f.lastP - 0.5;
      f.lastP = p;
      if (f.planted) {
        // Left too far behind (only in the first steps after standing, when feet start under the hips): step now.
        const behind = w.v > 1e-4 && rest[0] - localX(w, f.wx) > gp.D / 2 + EARLY_TOL * gp.legLen && w.feet.some((o, j) => j !== i && o.planted);
        if (p < w.duty && !behind) { f.skip = false; return; }
        if (!behind) {
          if (f.skip) return;
          // Its turn to step. When stopping, a foot already under its hip stays down.
          if (stopping && restOff(i) < SETTLE_TOL * gw.legLen) { f.skip = true; return; }
        }
        f.planted = false; f.from = [f.wx, f.y]; f.u = 0; f.p0 = Math.min(p, w.duty);
      }
      // Swing: from where it lifted to half a stride ahead of the spot under the hip at touchdown, landing when the
      // clock comes round to this foot's offset.
      const tLeft = w.cadence > 0 && !wrapped ? (1 - p) / w.cadence : 0;
      const land = w.x + w.dir * (w.v * tLeft + rest[0] + w.aim / 2);
      f.target = [land, rest[1], rest[2]];
      if (wrapped) { f.wx = land; f.y = rest[1]; f.planted = true; f.target = null; return; }
      const u = clamp(Math.max(f.u, (p - f.p0) / (1 - f.p0)), 0, 1);
      f.u = u;
      const e = u * u * u * (u * (u * 6 - 15) + 10); // minimum-jerk ease
      const reach = Math.abs(land - f.from[0]);
      const h = Math.min(gp.stepH, Math.max(gp.stepH * 0.35, reach * 0.6));
      f.wx = f.from[0] + (land - f.from[0]) * e;
      f.y = rest[1] + h * Math.pow(Math.sin(Math.PI * Math.min(1, u)), 0.8);
      f.z = rest[2];
    });

    // Body motion from the feet holding it up, faded in with speed.
    const share = Math.min(1.2, w.v / Math.max(1e-6, gw.speed));
    const body = { bob: 0, sway: 0, pitch: 0, roll: 0 };
    if (nFeet && w.tuck < 0.99) {
      const sup = supports(w.phase, { offsets: w.offsets, duty: w.duty });
      const mean = sup.reduce((a, b) => a + b, 0) / nFeet;
      const side = (sd) => { let t = 0, c = 0; sup.forEach((x, i) => { if (i % 2 === sd) { t += x; c++; } }); return t / c; };
      const pairs = nFeet / 2;
      const pairS = (pr) => (sup[pr * 2] + sup[pr * 2 + 1]) / 2;
      const bobN = gp.range > 1e-6 ? (mean - gp.mean) / gp.range : 0;
      const stride = w.stride / Math.max(1e-6, gp.D);
      const amp = Math.min(1, share) * (1 - w.tuck);
      body.bob = gp.bobAmp * bobN * stride * amp - gp.crouch * Math.min(1, share * 2) * (1 - w.tuck);
      body.pitch = pairs > 1 ? gp.pitchAmp * (pairS(pairs - 1) - pairS(0)) * stride * amp : 0;
      body.pitch -= clamp(w.accel / Math.max(1e-6, accel), -1, 1) * LEAN; // lean into a start, sit back into a stop
      body.roll = -gp.rollAmp * (side(0) - side(1)) * amp;
      body.sway = -gp.swayAmp * (side(0) - side(1)) * amp;
    } else if (!nFeet) {
      const amp = Math.min(1, share);
      body.bob = gp.bobAmp * (0.5 - 0.5 * Math.cos(2 * Math.PI * w.phase)) * amp;
      body.pitch = gp.pitchAmp * Math.sin(2 * Math.PI * w.phase) * amp;
    }
    const prevBobV = w.bobV;
    w.bobV = (body.bob - w.body.bob) / Math.max(1e-6, dt);
    const bobAcc = clamp((w.bobV - prevBobV) / Math.max(1e-6, dt), -40 * s, 40 * s);
    w.body = body;

    // Flying or trying: big enough wings lift off now and then; small ones flap hard and hop.
    const fly = canFly(w.ph);
    let wingFlap = Math.sin(w.time * 1.3) * 0.05;
    if (w.ph.wings && w.ph.wings.size > 0 && !reduced) {
      if (!w.flying && !w.tries && !force && w.rnd() < dt * 0.06) { if (fly) w.flying = 3 + w.rnd() * 4; else w.tries = 1.4; }
      if (w.flying) { w.flying = Math.max(0, w.flying - dt); wingFlap = Math.sin(w.time * 11) * 0.7; }
      else if (w.tries) { w.tries = Math.max(0, w.tries - dt); wingFlap = Math.sin(w.time * 22) * 0.8; if (w.hop === 0 && w.hopV === 0) w.hopV = 0.6 * s; }
      else wingFlap += 0.12 * Math.min(1, share) * Math.sin(2 * Math.PI * (2 * w.phase + 0.15)); // balance flutter, two per stride
    }
    const liftTarget = w.flying ? 0.28 * s + Math.sin(w.time * 2.2) * 0.03 * s : 0;
    w.lift += (liftTarget - w.lift) * Math.min(1, dt * 2.5);

    // A little hop: on request (a level-up), or when trying to fly.
    if (opts.hop && w.hop === 0 && w.hopV === 0 && !reduced) w.hopV = 0.8 * s;
    if (w.hopV !== 0 || w.hop > 0) {
      w.hop += w.hopV * dt; w.hopV -= 6 * s * dt;
      if (w.hop <= 0) { w.hop = 0; w.hopV = 0; }
    }

    // Tail on a spring: it lags the body's lean and bob, starts and stops, and sways a bit on its own.
    const idleSway = Math.sin(w.time * 1.6) * 0.12 * (1 - Math.min(1, share)) * (reduced ? 0.3 : 1);
    const tailTarget = idleSway + body.roll * 2.2;
    w.tail.v += (TAIL_STIFF * (tailTarget - w.tail.a) - TAIL_DAMP * w.tail.v) * dt;
    w.tail.a += w.tail.v * dt;
    const liftT = 0.12 * Math.min(1, share) + (w.flying ? -0.2 : 0);
    w.tail.lv += (TAIL_STIFF * 0.6 * (liftT - w.tail.lift) - TAIL_DAMP * w.tail.lv - bobAcc * 0.5 / s - w.accel * 0.6 / s) * dt;
    w.tail.lift += w.tail.lv * dt;

    // Head: steadied against the body's pitch, with a small nod that follows each bob.
    const headT = -body.pitch * HEAD_STEADY;
    w.head.v += (HEAD_STIFF * (headT - w.head.a) - HEAD_DAMP * w.head.v - bobAcc * HEAD_NOD / s) * dt;
    w.head.a = clamp(w.head.a + w.head.v * dt, -0.3, 0.3);

    // Blink every few seconds; look around now and then (eyes front while walking).
    w.blinkIn -= dt;
    if (w.blinkIn <= 0) { w.blink = 0.13; w.blinkIn = 2 + w.rnd() * 4; }
    w.blink = Math.max(0, w.blink - dt);
    w.lookIn -= dt;
    if (w.lookIn <= 0) { w.lookTo = (w.rnd() - 0.5) * 0.7; w.lookIn = 1.5 + w.rnd() * 3; }
    const lookTo = w.v > 0.2 * gw.speed ? w.lookTo * 0.25 : w.lookTo;
    w.look += (lookTo - w.look) * Math.min(1, dt * (reduced ? 1 : 4));
  }

  function output(w) {
    const s = w.L.s;
    const tucked = (i) => [w.L.feet[i][0] - 0.03 * s, w.L.feet[i][1] + w.lift * 0.6, w.L.feet[i][2]];
    const feet = w.feet.map((f, i) => {
      const g = [localX(w, f.wx), f.y, f.z];
      if (w.tuck <= 0.01) return g;
      const t = tucked(i), k = w.tuck * w.tuck * (3 - 2 * w.tuck);
      return [g[0] + (t[0] - g[0]) * k, g[1] + (t[1] - g[1]) * k, g[2] + (t[2] - g[2]) * k];
    });
    const pose = {
      breathe: Math.sin(w.time * 2.2), lookYaw: w.look, headNod: w.head.a, tailSway: w.tail.a, tailLift: w.tail.lift,
      wingFlap: 0, feet, blink: w.blink > 0 ? 1 : 0, lift: w.lift + w.hop, body: Object.assign({}, w.body),
    };
    pose.wingFlap = w.flying ? Math.sin(w.time * 11) * 0.7 : w.tries ? Math.sin(w.time * 22) * 0.8 :
      Math.sin(w.time * 1.3) * 0.05 + (w.ph.wings && w.ph.wings.size > 0 ? 0.12 * Math.min(1, w.v / Math.max(1e-6, w.gaits.walk.speed)) * Math.sin(2 * Math.PI * (2 * w.phase + 0.15)) : 0);
    const gp = w.gaits[w.hurry ? 'hurry' : 'walk'];
    return {
      pose, x: w.x, dir: w.dir, lift: pose.lift, flying: !!w.flying, trying: !!w.tries,
      feetState: w.feet.map((f) => f.planted),
      targets: w.feet.map((f) => (f.target && !f.planted ? [localX(w, f.target[0]), f.target[1], f.target[2]] : null)),
      gait: { family: gp.family, name: gp.name, phase: w.phase, duty: w.duty, offsets: w.offsets.slice(), speed: w.v, cadence: w.cadence, stride: w.stride, settled: w.settled },
    };
  }

  const api = { createWalker, step, gaitParams, supports, wingLift, canFly, GAITS, SPRITE_FPS, MAX_STRETCH, FLY_RATIO,
    STRIDE_WALK, STRIDE_HURRY, CADENCE_REF, BABY_STRIDE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureMotion = api;
})(typeof window !== 'undefined' ? window : globalThis);
