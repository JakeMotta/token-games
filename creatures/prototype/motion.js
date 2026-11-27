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
   pitches and rolls with whichever feet are holding it up; the head steadies against it and the tail follows late.

   It walks on a ground plane (x, z) with a heading: it wanders, goes to food or a spot, and steers away from the walls
   at a limited turn rate. Bigger changes of direction are turns: slow down, then pivot on planted feet (a 180° turn,
   now and then a 360° spin for fun), the head leading and the tail swinging the other way. Food it notices it walks
   to, faces, lowers its head, bites (the food shrinks), chews, swallows (a lump goes down) and is happy; hunger rises
   slowly with time and a meal lowers it. Pass a number pair for min/max x to walk on a line instead. */
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

  // ---------- turning and behaviour ----------
  // The creature walks on a ground plane (world x to the right, z toward the viewer) with a heading `th`
  // (0 = facing right, +PI/2 = facing away, -PI/2 = facing the viewer). It steers with a limited yaw rate, so walking
  // turns are arcs; a big turn (or one at a wall) is a stop and a pivot on planted feet. Positive yaw turns left.
  const TURN_RATE = 1.1;           // rad/s: the fastest it turns while walking
  const TURN_RADIUS = 0.55;        // the tightest walking arc, in body scales (yaw rate <= speed / radius)
  const PIVOT_RATE = 1.5;          // rad/s: turning on the spot (for a LEG_REF leg; longer legs pivot slower)
  const PIVOT_ANGLE = 1.75;        // rad (~100°): a heading error beyond this stops it and pivots instead of arcing
  const PIVOT_DONE = 0.35;         // rad: a pivot ends when the error is this small, then it walks off on an arc
  const PIVOT_SPEED = 0.15;        // share of walking speed under which it may pivot
  const PIVOT_AT = { biped: 'centre', quadruped: 'hind', hexapod: 'centre', legless: 'centre' }; // what it turns about
  const YAW_ACCEL = 4;             // rad/s²: how quickly a turn starts and stops
  const TURN_STRIDE = 0.8;         // turning steps are this share of a straight stride (keeps the outer legs in reach)
  const SKIP_TOL = 0.08;           // share of leg length: a foot whose next spot is this close stays planted (inner legs pivot)
  const REACH_LIMIT = 0.96;        // hip-to-foot share a planted foot may reach before the body waits for it to step
  const STEER_GAIN = 2.2;          // yaw rate per radian of heading error
  const BEND_GAIN = 0.16, BEND_MAX = 0.3; // body curve along the turn (radians at the ends per rad/s of yaw)
  const HEAD_LEAD = 0.35, TAIL_TURN = 0.45; // the head looks into the turn, the tail swings out of it
  const EDGE_MARGIN = 0.12;        // body scales: how far ahead of its stopping point it looks for a wall
  const SPIN_CHANCE = 0.08;        // share of idle choices that are a full 360° spin (play)
  const LOOK_TURN_CHANCE = 0.15;   // share that are a turn on the spot to face somewhere else
  // Eating.
  const NOTICE_TIME = 0.5;         // seconds looking at new food before going for it
  const EAT_LOWER = 0.45, BITE_OPEN = 0.2, BITE_SNAP = 0.08, CHEW_TIME = 0.6, CHEW_RATE = 4; // seconds, chews/s
  const SWALLOW_TIME = 0.6, HAPPY_TIME = 1.3;
  const EAT_NOD = 0.5, EAT_PITCH = 0.12; // head tips down, body leans in
  const HUNGER_RATE = 1 / 900;     // hunger 0..1 rises this much per second (fed to hungry in ~10 minutes)
  const HUNGRY = 0.65;             // hunger above this is the hungry state
  const POOP_CHANCE = 0.3;         // after a meal, now and then a small calm dropping

  const wrap = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

  function createWalker(ph, seed, opts) {
    opts = opts || {};
    const L = B.layout(ph);
    const rnd = mulberry(seed >>> 0 || 1);
    const gaits = { walk: gaitParams(ph, L, 'walk'), hurry: gaitParams(ph, L, 'hurry') };
    const fam = gaits.walk.family;
    const hipX = L.hips.map((h) => h.p[0]);
    const o = L.tsp.pts[Math.floor(L.tsp.pts.length / 2)];
    const pivotX = !hipX.length ? o[0] : PIVOT_AT[fam] === 'hind' ? (hipX[0] + hipX[1]) / 2 : hipX.reduce((a, b) => a + b, 0) / hipX.length;
    const legLen = gaits.walk.legLen;
    const mouth = B.build(ph, {}).mouth;
    const w = {
      L, ph, rnd, gaits, time: 0, progress: 0, x: opts.x || 0, z: opts.z || 0, th: opts.heading || 0, v: 0, om: 0, accel: 0,
      phase: 0, hurry: false, mode: 'idle', idleFor: 1 + rnd() * 2, goal: null, goFor: 0, turnLeft: 0, after: null, pivoting: false,
      pivotX, pc: 0, pivotRate: clamp(PIVOT_RATE * Math.sqrt(LEG_REF / Math.max(0.02, legLen)), 0.8, 2.4),
      rMin: TURN_RADIUS * L.s, pause: 0, settled: true, mouthX: mouth ? mouth.p[0] : 0.3 * L.s,
      offsets: gaits.walk.offsets.slice(), duty: gaits.walk.duty, cadence: 0, stride: 0,
      feet: [], body: { bob: 0, sway: 0, pitch: 0, roll: 0, bend: 0 }, bobV: 0,
      tail: { a: 0, v: 0, lift: 0, lv: 0 }, head: { a: 0, v: 0 }, blinkIn: 1.5 + rnd() * 3, blink: 0, look: 0, lookTo: 0, lookIn: 2,
      lift: 0, flap: 0, flying: false, tries: 0, hop: 0, hopV: 0, tuck: 0,
      hunger: opts.hunger == null ? 0.3 : opts.hunger, notice: 0, eat: null, mouthOpen: 0, swallow: 0, happy: 0,
      eatLean: 0, eatNod: 0, poopIn: 0, events: [],
    };
    w.feet = L.feet.map((f) => { const p = toWorld(w, f[0], f[2]); return { wx: p[0], wz: p[1], y: f[1], planted: true, skip: false, from: null, u: 0, target: null }; });
    return w;
  }
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // Body-local (forward, right) <-> world ground (x, z) for a pose {x, z, th}.
  function toWorld(p, lx, lz) { const t = p.th != null ? p.th : p.heading, c = Math.cos(t), s = Math.sin(t); return [p.x + c * lx + s * lz, p.z - s * lx + c * lz]; }
  function toLocal(p, wx, wz) { const t = p.th != null ? p.th : p.heading, c = Math.cos(t), s = Math.sin(t), dx = wx - p.x, dz = wz - p.z; return [c * dx - s * dz, s * dx + c * dz]; }
  // Where the body is after dt at forward speed v and yaw rate om, turning about the point `pc` along its own axis.
  function advance(p, v, om, pc, dt) {
    const dth = om * dt, thm = p.th + dth / 2, th = p.th + dth;
    const x = p.x + Math.cos(thm) * v * dt + pc * (Math.cos(p.th) - Math.cos(th));
    const z = p.z - Math.sin(thm) * v * dt - pc * (Math.sin(p.th) - Math.sin(th));
    return { x, z, th };
  }
  const headingTo = (w, x, z) => Math.atan2(-(z - w.z), x - w.x);

  // Ask for a turn on the spot by `angle` radians (+ left): PI turns round, 2*PI is the play spin.
  function turn(w, angle, after) { w.mode = 'turn'; w.turnLeft = angle; w.spinning = Math.abs(angle) > Math.PI * 1.5; w.after = after || null; w.pivoting = true; }
  function spin(w, sign) { turn(w, (sign || 1) * 2 * Math.PI, null); }

  // Advance the walker by dt seconds inside `area` ({minX, maxX, minZ, maxZ} for the body origin; the old
  // (minX, maxX) pair still works and means a line). Returns the pose for CreatureBody.build plus where to draw it.
  // opts: { reduced } no wandering, spinning or hopping (Reduced motion); { walk: false } keeps it standing;
  // { force: 'walk' | 'hurry' } walks without stopping (frame strips, tests), { steer: rad/s } turning as it goes;
  // { hop: true } asks for a hop; { food } a food item {x, z, bites, value} it will notice, walk to and eat.
  function step(w, dt, area, maxX, opts) {
    if (typeof area === 'number') area = { minX: area, maxX, minZ: 0, maxZ: 0, line: true };
    else if (maxX && typeof maxX === 'object') opts = maxX;
    opts = opts || {};
    dt = clamp(dt, 0, 0.25);
    const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9));
    for (let k = 0; k < n; k++) tick(w, dt / n, area, k === 0 ? opts : Object.assign({}, opts, { hop: false }));
    return output(w);
  }

  // Room from the body origin to the area's edge along a ground direction.
  function room(w, area, dx, dz) {
    let t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (area.maxX - w.x) / dx); else if (dx < -1e-9) t = Math.min(t, (area.minX - w.x) / dx);
    if (area.line) return Math.max(0, t);
    if (dz > 1e-9) t = Math.min(t, (area.maxZ - w.z) / dz); else if (dz < -1e-9) t = Math.min(t, (area.minZ - w.z) / dz);
    return Math.max(0, t);
  }
  // A turn round at a wall goes toward the side with more room (often sweeping through the front view). On a line it
  // turns exactly round, either way.
  function edgeTurn(w, area, after) {
    if (area.line) {
      const d = wrap((Math.cos(w.th) >= 0 ? Math.PI : 0) - w.th);
      turn(w, Math.abs(d) > Math.PI - 1e-6 ? (w.rnd() < 0.5 ? 1 : -1) * Math.PI : d, after);
      return;
    }
    const left = room(w, area, -Math.sin(w.th), -Math.cos(w.th)), right = room(w, area, Math.sin(w.th), Math.cos(w.th));
    turn(w, (left > right ? 1 : -1) * (Math.PI - 0.35 * w.rnd()), after);
  }
  function randomGoal(w, area, ahead) {
    for (let k = 0; k < 12; k++) {
      const g = { x: area.minX + (area.maxX - area.minX) * w.rnd(), z: area.minZ + (area.maxZ - area.minZ) * w.rnd() };
      const d = Math.hypot(g.x - w.x, g.z - w.z);
      if (d < 0.25 * w.L.s) continue;
      if (ahead && Math.abs(wrap(headingTo(w, g.x, g.z) - w.th)) > PIVOT_ANGLE * 0.8) continue;
      return g;
    }
    return { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 };
  }

  // Behaviour: decide the commanded forward speed and yaw rate for this tick.
  function decide(w, dt, area, opts, moving, force, gp, gw) {
    const s = w.L.s;
    const food = opts.food && !opts.food.gone && (opts.food.bites > 0 || (w.eat && w.eat.food === opts.food)) ? opts.food : null;
    if (!food && w.mode === 'eat' && w.eat && w.eat.stage !== 'swallow' && w.eat.stage !== 'happy') { w.mode = 'idle'; w.idleFor = 1; w.eat = null; }
    if (!food && w.goal && w.goal.food) { w.mode = 'idle'; w.idleFor = 1; w.goal = null; }
    // Food: look at it, then go for it (unless already eating or in the middle of a spin).
    if (food && w.mode !== 'eat' && !(w.goal && w.goal.food === food)) {
      w.notice += dt;
      w.lookTo = clamp(wrap(headingTo(w, food.x, food.z) - w.th), -0.7, 0.7);
      if (w.notice >= NOTICE_TIME && !(w.mode === 'turn' && w.spinning)) {
        w.mode = 'go'; w.goal = { food }; w.goFor = 30; w.hurry = w.hunger > HUNGRY; w.pivoting = false;
      }
    } else if (!food) w.notice = 0;
    const tooFast = (v) => v > PIVOT_SPEED * gw.speed;
    const limitTurn = (om, v, pivot) => { const lim = tooFast(v) ? Math.min(TURN_RATE, v / w.rMin) : pivot ? w.pivotRate : v / w.rMin; return clamp(om, -lim, lim); };
    const decel = gw.speed / STOP_TIME;
    const stopDist = w.v * w.v / (2 * decel) + EDGE_MARGIN * s;
    const wall = () => room(w, area, Math.cos(w.th), -Math.sin(w.th)) < stopDist;
    // A pivot keeps the way it started (a target near straight behind would otherwise flip it back and forth).
    const pivotTo = (diff) => {
      if (w.pivotSign && Math.sign(diff) !== w.pivotSign && Math.abs(diff) > Math.PI / 2) diff += w.pivotSign * 2 * Math.PI;
      w.pivotSign = Math.sign(diff);
      return { v: 0, om: Math.sign(diff) * Math.min(w.pivotRate, Math.sqrt(2 * YAW_ACCEL * Math.abs(diff)) + 0.05, Math.abs(diff) / dt), pivot: true };
    };

    if (w.mode === 'turn') {
      const left = w.turnLeft;
      if (Math.abs(left) < 2e-3) {
        w.turnLeft = 0; w.spinning = false;
        if (w.after === 'force') w.mode = 'go';
        else if (w.after) { w.mode = 'go'; w.goal = w.after === 'ahead' ? randomGoal(w, area, true) : w.after; w.goFor = 12; }
        else { w.mode = 'idle'; w.idleFor = TURN_PAUSE + w.rnd() * 1.5; }
        w.after = null;
        return { v: 0, om: 0 };
      }
      if (tooFast(w.v)) return { v: 0, om: area.line ? 0 : limitTurn(Math.sign(left) * TURN_RATE, w.v, false) };
      return pivotTo(left);
    }
    if (force) {
      w.hurry = force === 'hurry';
      if (w.v > 0 && wall()) { edgeTurn(w, area, 'force'); return { v: 0, om: 0 }; }
      return { v: gp.speed, om: limitTurn(opts.steer || 0, w.v, false) };
    }
    if (w.mode === 'eat') return { v: 0, om: 0 };
    if (w.mode === 'idle') {
      w.idleFor -= dt;
      if (w.idleFor <= 0 && moving && !opts.reduced) {
        const r = w.rnd();
        const hungry = w.hunger > HUNGRY;
        if (r < SPIN_CHANCE && !hungry) spin(w, w.rnd() < 0.5 ? 1 : -1);
        else if (r < SPIN_CHANCE + LOOK_TURN_CHANCE) turn(w, (w.rnd() < 0.5 ? 1 : -1) * (0.6 + 1.4 * w.rnd()), null);
        else { w.mode = 'go'; w.goal = randomGoal(w, area, false); w.goFor = 10 + 5 * w.rnd(); w.hurry = !hungry && w.rnd() < HURRY_CHANCE; }
      }
      return { v: 0, om: 0 };
    }
    if (!w.goal) { w.mode = 'idle'; w.idleFor = 1; return { v: 0, om: 0 }; }
    // Going somewhere: steer toward the goal (for food, the spot where the mouth is over it).
    w.goFor -= dt;
    let gx, gz, face = null;
    if (w.goal.food) {
      // The spot (picked once) a neck's length from the food on this side, so the mouth ends up over it.
      const f = w.goal.food;
      if (!w.goal.at) {
        const d = Math.hypot(f.x - w.x, f.z - w.z);
        const ux = d > 1e-6 ? (w.x - f.x) / d : -Math.cos(w.th), uz = d > 1e-6 ? (w.z - f.z) / d : Math.sin(w.th);
        w.goal.at = { x: clamp(f.x + ux * w.mouthX, area.minX, area.maxX), z: clamp(f.z + uz * w.mouthX, area.minZ, area.maxZ) };
      }
      gx = w.goal.at.x; gz = w.goal.at.z;
      face = f;
    } else { gx = w.goal.x; gz = w.goal.z; }
    const dist = Math.hypot(gx - w.x, gz - w.z);
    const arrive = Math.max(0.03 * s, 0.25 * gw.D);
    if (dist < arrive || w.goFor <= 0 || !moving) {
      if (face && moving) {
        const diff = wrap(headingTo(w, face.x, face.z) - w.th);
        if (tooFast(w.v)) return { v: 0, om: 0 };
        if (Math.abs(diff) > 0.12) return pivotTo(diff);
        if (w.v < 1e-4 && Math.abs(w.om) < 1e-3) { w.mode = 'eat'; w.eat = { stage: 'lower', t: 0, food: face }; w.goal = null; }
        return { v: 0, om: 0 };
      }
      w.mode = 'idle'; w.idleFor = 1.2 + w.rnd() * 3.5; w.goal = null;
      return { v: 0, om: 0 };
    }
    const diff = wrap(Math.atan2(-(gz - w.z), gx - w.x) - w.th);
    if (Math.abs(diff) > PIVOT_ANGLE) w.pivoting = true;
    if (w.pivoting) {
      if (Math.abs(diff) < PIVOT_DONE) w.pivoting = false;
      else {
        if (tooFast(w.v)) return { v: 0, om: limitTurn(Math.sign(diff) * TURN_RATE, w.v, false) };
        return pivotTo(diff);
      }
    }
    if (wall() && Math.abs(diff) > 0.5) { edgeTurn(w, area, w.goal); return { v: 0, om: 0 }; }
    const slow = Math.max(0.3, 1 - Math.abs(diff) / PIVOT_ANGLE);
    const vArrive = Math.sqrt(2 * decel * Math.max(0, dist - arrive * 0.5));
    const v = Math.min(gp.speed * slow, vArrive);
    return { v, om: limitTurn(STEER_GAIN * diff, w.v, false) };
  }

  // The eating sequence, timed: lower the head, bite (open, snap shut: the food gets smaller), chew, and after the
  // last bite swallow (a lump goes down) and be happy. Returns the mouth opening and how far head and body lean down.
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
        if (!reduced) w.hopV = 0.6 * w.L.s;
        w.events.push({ type: 'happy' });
        if (w.rnd() < POOP_CHANCE) w.poopIn = 4 + 4 * w.rnd();
      }
    } else if (e.stage === 'happy' && e.t >= HAPPY_TIME * 0.6) { w.mode = 'idle'; w.idleFor = 1.5 + w.rnd() * 2; w.eat = null; }
    return { open, nod, lean };
  }

  function tick(w, dt, area, opts) {
    w.time += dt;
    const s = w.L.s;
    const reduced = !!opts.reduced;
    const moving = opts.walk !== false;
    const force = moving && !reduced && opts.force;
    w.hunger = Math.min(1, w.hunger + HUNGER_RATE * dt);
    const gw = w.gaits.walk;
    const cmd = w.tries || w.pause > 0 ? { v: 0, om: 0 } : decide(w, dt, area, opts, moving, force, w.gaits[w.hurry ? 'hurry' : 'walk'], gw);
    if (!cmd.pivot) w.pivotSign = 0;
    w.pause = Math.max(0, w.pause - dt);
    const gp = w.gaits[w.hurry ? 'hurry' : 'walk'];
    const vCmd = cmd.v, omCmd = cmd.om;
    const decel = gw.speed / STOP_TIME, accel = gp.speed / START_TIME;
    // Setting off from a stand: start the clock where the left hind foot is due to lift, so the first step is a step.
    if ((vCmd > 0 || omCmd) && w.v === 0 && w.om === 0 && w.settled && w.feet.length && w.tuck < 0.01) w.phase = frac(w.offsets[0] + w.duty);
    const v0 = w.v;
    w.v = clamp(vCmd, w.v - decel * dt, w.v + accel * dt);
    w.om = clamp(omCmd, w.om - YAW_ACCEL * dt, w.om + YAW_ACCEL * dt);
    if (cmd.pivot) w.om = clamp(w.om, -Math.abs(omCmd), Math.abs(omCmd));
    if (Math.abs(w.om) < 1e-6 && !omCmd) w.om = 0;
    // The turn's centre: the pivot point (hind hips for four legs) when slow, the body when walking.
    w.pc = w.pivotX * clamp(1 - w.v / (0.5 * gw.speed), 0, 1);
    // Near a wall (or on a line) the body would swing out of the habitat round that point: turn about itself instead.
    // So does lining up on a spot nearby (the food), where swinging round the hips would keep moving it away.
    if (w.pc) {
      const P = toWorld(w, w.pc, 0), r = Math.abs(w.pc), g = w.goal && (w.goal.at || w.goal);
      if (area.line || P[0] - r < area.minX || P[0] + r > area.maxX || P[1] - r < area.minZ || P[1] + r > area.maxZ ||
        (g && g.x != null && Math.hypot(g.x - w.x, g.z - w.z) < 3 * r + 0.25 * gw.D)) w.pc = 0;
    }
    const stopping = vCmd === 0 && omCmd === 0;

    // Move the body, unless that would pull a planted foot out of reach: then move only as far as it can and let
    // that foot step (it is overdue).
    const BT = B.bodyTransform(w.L, w.body);
    const hips = w.L.hips.map((hp) => (BT ? BT.T(hp.p) : hp.p));
    const reachAt = (p, i) => { const f = w.feet[i], l = toLocal(p, f.wx, f.wz), h = hips[i]; return Math.hypot(l[0] - h[0], f.y - h[1], l[1] - h[2]) / w.L.legLen; };
    let next = advance(w, w.v, w.om, w.pc, dt);
    const overdue = new Set();
    if (w.feet.length && w.tuck < 0.01 && (w.v || w.om)) {
      const bad = (p) => w.feet.some((f, i) => f.planted && reachAt(p, i) > REACH_LIMIT && reachAt(p, i) > reachAt(w, i) + 1e-12);
      if (bad(next)) {
        let lo = 0, hi = 1;
        for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; if (bad(advance(w, w.v * m, w.om * m, w.pc, dt))) hi = m; else lo = m; }
        const over = advance(w, w.v * hi, w.om * hi, w.pc, dt);
        w.feet.forEach((f, i) => { if (f.planted && reachAt(over, i) > REACH_LIMIT) overdue.add(i); });
        w.v *= lo; w.om *= lo;
        next = advance(w, w.v, w.om, w.pc, dt);
      }
    }
    w.accel = (w.v - v0) / Math.max(1e-6, dt);
    if (w.mode === 'turn') w.turnLeft -= next.th - w.th;
    w.x = next.x; w.z = next.z; w.th = next.th;
    w.progress += w.v * dt;

    // The gait: offsets and duty slide toward the current mode's; the clock runs by distance (the fastest hip's), so
    // a planted foot is never left further behind than a stride; turning takes shorter strides.
    const blend = Math.min(1, GAIT_BLEND * dt);
    w.offsets = w.offsets.map((o, i) => { const d = frac(gp.offsets[i] - o + 0.5) - 0.5; return frac(o + d * blend); });
    w.duty += (gp.duty - w.duty) * blend;
    const nFeet = w.feet.length;
    const restOff = (i) => { const l = toLocal(w, w.feet[i].wx, w.feet[i].wz), r = w.L.feet[i]; return Math.hypot(l[0] - r[0], l[1] - r[2]); };
    w.settled = w.v < 1e-4 && Math.abs(w.om) < 1e-4 && w.feet.every((f, i) => f.planted && (f.skip || restOff(i) < SETTLE_TOL * gw.legLen));
    const turnShare = clamp(Math.max(Math.abs(w.om), Math.abs(omCmd)) / w.pivotRate, 0, 1);
    const Dn = gp.D * (1 - (1 - TURN_STRIDE) * turnShare);
    const hipSpeed = (v, om, pc) => {
      let m = nFeet ? 0 : v;
      for (const hp of w.L.hips) m = Math.max(m, Math.hypot(v + om * hp.p[2], om * (hp.p[0] - pc)));
      return m;
    };
    const strideAt = (sp) => Dn * (MIN_STRIDE + (1 - MIN_STRIDE) * Math.min(1, sp / gp.speed));
    const cadenceFor = (v, om, pc) => { const hs = hipSpeed(v, om, pc); return hs > 1e-4 ? hs * w.duty / strideAt(hs) : 0; };
    w.cadence = Math.max(cadenceFor(w.v, w.om, w.pc), stopping && !w.settled ? gp.f * STOP_CADENCE : 0);
    w.stride = w.cadence > 0 ? hipSpeed(w.v, w.om, w.pc) * w.duty / w.cadence : 0;
    if (!nFeet && (w.v > 1e-4 || Math.abs(w.om) > 1e-4)) w.cadence = gp.f;
    w.phase = frac(w.phase + w.cadence * dt);
    // Speeding up (or turning harder): aim each landing for the motion it is heading for.
    const vA = vCmd > w.v ? vCmd : w.v, omA = Math.abs(omCmd) > Math.abs(w.om) ? omCmd : w.om;
    const cA = cadenceFor(vA, omA, w.pc), halfStance = cA > 0 ? w.duty / (2 * cA) : 0;
    const reachR = 0.5 * Math.max(gp.D, gw.D);

    // Feet. Tucked up in flight; otherwise stance or swing by phase.
    const tuckTo = w.lift > 0.02 * s ? 1 : 0;
    w.tuck += clamp(tuckTo - w.tuck, -4 * dt, 4 * dt);
    w.feet.forEach((f, i) => {
      const rest = w.L.feet[i];
      if (w.tuck > 0.01) { const p = toWorld(w, rest[0], rest[2]); f.wx = p[0]; f.wz = p[1]; f.y = rest[1]; f.planted = true; f.skip = false; f.target = null; return; }
      const p = frac(w.phase - w.offsets[i]);
      const wrapped = f.lastP != null && p < f.lastP - 0.5;
      f.lastP = p;
      // Where this foot should land: under its hip half a stance after touchdown, along the predicted arc, kept in reach.
      const tLeft = w.cadence > 0 && !wrapped ? (1 - p) / w.cadence : 0;
      const landing = () => {
        const td = advance(w, w.v, w.om, w.pc, tLeft);
        const at = advance(td, vA, omA, w.pc, halfStance);
        const q = toWorld(at, rest[0], rest[2]);
        const l = toLocal(td, q[0], q[1]), dx = l[0] - rest[0], dz = l[1] - rest[2], d = Math.hypot(dx, dz);
        if (d > reachR) { const k = reachR / d; return toWorld(td, rest[0] + dx * k, rest[2] + dz * k); }
        return q;
      };
      if (f.planted) {
        // Left too far behind, or holding the body back: step now.
        const l = toLocal(w, f.wx, f.wz);
        const behind = (overdue.has(i) || ((w.v > 1e-4 || Math.abs(w.om) > 1e-4) && Math.hypot(l[0] - rest[0], l[1] - rest[2]) > gp.D / 2 + EARLY_TOL * gp.legLen))
          && w.feet.some((o, j) => j !== i && o.planted);
        if (p < w.duty && !behind) { f.skip = false; return; }
        if (!behind) {
          if (f.skip) return;
          // Its turn to step. A foot already where it would land stays down (when stopping, or the inner legs of a pivot).
          if (stopping && restOff(i) < SETTLE_TOL * gw.legLen) { f.skip = true; return; }
          const q = landing();
          if (!stopping && Math.hypot(q[0] - f.wx, q[1] - f.wz) < SKIP_TOL * gw.legLen) { f.skip = true; return; }
        }
        f.planted = false; f.from = [f.wx, f.wz, f.y]; f.u = 0; f.p0 = Math.min(p, w.duty);
      }
      // Swing: from where it lifted to the landing spot, touching down when the clock comes round to this foot.
      const land = landing();
      f.target = [land[0], rest[1], land[1]];
      if (wrapped) { f.wx = land[0]; f.wz = land[1]; f.y = rest[1]; f.planted = true; f.target = null; return; }
      const u = clamp(Math.max(f.u, (p - f.p0) / (1 - f.p0)), 0, 1);
      f.u = u;
      const e = u * u * u * (u * (u * 6 - 15) + 10); // minimum-jerk ease
      const reach = Math.hypot(land[0] - f.from[0], land[1] - f.from[1]);
      const h = Math.min(gp.stepH, Math.max(gp.stepH * 0.35, reach * 0.6));
      f.wx = f.from[0] + (land[0] - f.from[0]) * e;
      f.wz = f.from[1] + (land[1] - f.from[1]) * e;
      f.y = rest[1] + h * Math.pow(Math.sin(Math.PI * Math.min(1, u)), 0.8);
    });

    // Eating sets the mouth and how far the head and body lean down.
    let eat = { open: 0, nod: 0, lean: 0 };
    if (w.mode === 'eat' && w.eat) eat = eating(w, dt, reduced);
    w.mouthOpen += (eat.open - w.mouthOpen) * Math.min(1, dt * 30);
    w.eatLean += (eat.lean - w.eatLean) * Math.min(1, dt * 8);
    w.eatNod += (eat.nod - w.eatNod) * Math.min(1, dt * 8);
    w.happy = Math.max(0, w.happy - dt);
    if (w.poopIn > 0) { w.poopIn -= dt; if (w.poopIn <= 0) { const p = toWorld(w, w.L.tsp.pts[0][0] - 0.05 * s, 0); w.events.push({ type: 'poop', x: p[0], z: p[1] }); } }

    // Body motion from the feet holding it up, faded in with speed (or turning).
    const share = Math.min(1.2, Math.max(w.v / Math.max(1e-6, gw.speed), 0.7 * Math.abs(w.om) / w.pivotRate));
    const body = { bob: 0, sway: 0, pitch: 0, roll: 0, bend: 0 };
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
    // Eating: nose down a little, sinking so the hind hips don't rise.
    if (w.eatLean > 1e-4 && nFeet) {
      const o = w.L.tsp.pts[Math.floor(w.L.tsp.pts.length / 2)];
      const back = Math.max(0, ...w.L.hips.map((hp) => o[0] - hp.p[0]));
      body.pitch -= EAT_PITCH * w.eatLean;
      body.bob -= EAT_PITCH * w.eatLean * back * 1.05;
    }
    // The body curves along the turn: both ends toward its centre.
    body.bend = clamp(BEND_GAIN * w.om, -BEND_MAX, BEND_MAX);
    if (Math.abs(body.bend) < 1e-9) body.bend = 0;
    const prevBobV = w.bobV;
    w.bobV = (body.bob - w.body.bob) / Math.max(1e-6, dt);
    const bobAcc = clamp((w.bobV - prevBobV) / Math.max(1e-6, dt), -40 * s, 40 * s);
    w.body = body;

    // Flying or trying: big enough wings lift off now and then; small ones flap hard and hop.
    const fly = canFly(w.ph);
    if (w.ph.wings && w.ph.wings.size > 0 && !reduced && w.mode !== 'eat') {
      if (!w.flying && !w.tries && !force && w.rnd() < dt * 0.06) { if (fly) w.flying = 3 + w.rnd() * 4; else w.tries = 1.4; }
      if (w.flying) w.flying = Math.max(0, w.flying - dt);
      else if (w.tries) { w.tries = Math.max(0, w.tries - dt); if (w.hop === 0 && w.hopV === 0) w.hopV = 0.6 * s; }
    }
    const liftTarget = w.flying ? 0.28 * s + Math.sin(w.time * 2.2) * 0.03 * s : 0;
    w.lift += (liftTarget - w.lift) * Math.min(1, dt * 2.5);

    // A little hop: on request (a level-up), when trying to fly, or after a meal.
    if (opts.hop && w.hop === 0 && w.hopV === 0 && !reduced) w.hopV = 0.8 * s;
    if (w.hopV !== 0 || w.hop > 0) {
      w.hop += w.hopV * dt; w.hopV -= 6 * s * dt;
      if (w.hop <= 0) { w.hop = 0; w.hopV = 0; }
    }

    // Tail on a spring: it lags the body's lean and bob, swings out of a turn, wags when happy, sways a bit on its own.
    const idleSway = Math.sin(w.time * 1.6) * 0.12 * (1 - Math.min(1, share)) * (reduced ? 0.3 : 1);
    const tailTarget = idleSway + body.roll * 2.2 + TAIL_TURN * w.om + (w.happy > 0 ? 0.25 * Math.sin(w.time * 14) : 0);
    w.tail.v += (TAIL_STIFF * (tailTarget - w.tail.a) - TAIL_DAMP * w.tail.v) * dt;
    w.tail.a += w.tail.v * dt;
    const liftT = 0.12 * Math.min(1, share) + (w.flying ? -0.2 : 0) + (w.happy > 0 ? 0.2 : 0);
    w.tail.lv += (TAIL_STIFF * 0.6 * (liftT - w.tail.lift) - TAIL_DAMP * w.tail.lv - bobAcc * 0.5 / s - w.accel * 0.6 / s) * dt;
    w.tail.lift += w.tail.lv * dt;

    // Head: steadied against the body's pitch, with a small nod that follows each bob.
    const headT = -body.pitch * HEAD_STEADY;
    w.head.v += (HEAD_STIFF * (headT - w.head.a) - HEAD_DAMP * w.head.v - bobAcc * HEAD_NOD / s) * dt;
    w.head.a = clamp(w.head.a + w.head.v * dt, -0.3, 0.3);

    // Blink every few seconds; look around now and then (eyes front while walking, into the turn while turning).
    w.blinkIn -= dt;
    if (w.blinkIn <= 0) { w.blink = 0.13; w.blinkIn = 2 + w.rnd() * 4; }
    w.blink = Math.max(0, w.blink - dt);
    w.lookIn -= dt;
    if (w.lookIn <= 0 && !w.notice) { w.lookTo = (w.rnd() - 0.5) * (w.hunger > HUNGRY ? 1.2 : 0.7); w.lookIn = 1.5 + w.rnd() * 3; }
    const free = w.mode === 'eat' ? 0 : w.v > 0.2 * gw.speed ? w.lookTo * 0.25 : w.lookTo;
    w.look += (clamp(free + HEAD_LEAD * w.om, -0.8, 0.8) - w.look) * Math.min(1, dt * (reduced ? 1 : 4));
  }

  function output(w) {
    const s = w.L.s;
    const tucked = (i) => [w.L.feet[i][0] - 0.03 * s, w.L.feet[i][1] + w.lift * 0.6, w.L.feet[i][2]];
    const local = (wx, y, wz) => { const l = toLocal(w, wx, wz); return [l[0], y, l[1]]; };
    const feet = w.feet.map((f, i) => {
      const g = local(f.wx, f.y, f.wz);
      if (w.tuck <= 0.01) return g;
      const t = tucked(i), k = w.tuck * w.tuck * (3 - 2 * w.tuck);
      return [g[0] + (t[0] - g[0]) * k, g[1] + (t[1] - g[1]) * k, g[2] + (t[2] - g[2]) * k];
    });
    const pose = {
      breathe: Math.sin(w.time * 2.2), lookYaw: w.look, headNod: w.head.a - EAT_NOD * w.eatNod, tailSway: w.tail.a, tailLift: w.tail.lift,
      wingFlap: 0, feet, blink: w.blink > 0 ? 1 : 0, lift: w.lift + w.hop, body: Object.assign({}, w.body),
      mouthOpen: w.mouthOpen, swallow: w.swallow, expression: w.happy > 0 ? 'happy' : null,
    };
    pose.wingFlap = w.flying ? Math.sin(w.time * 11) * 0.7 : w.tries ? Math.sin(w.time * 22) * 0.8 :
      Math.sin(w.time * 1.3) * 0.05 + (w.ph.wings && w.ph.wings.size > 0 ? 0.12 * Math.min(1, w.v / Math.max(1e-6, w.gaits.walk.speed)) * Math.sin(2 * Math.PI * (2 * w.phase + 0.15)) : 0);
    const gp = w.gaits[w.hurry ? 'hurry' : 'walk'];
    const events = w.events; w.events = [];
    const goal = !w.goal ? null : w.goal.food ? { x: w.goal.food.x, z: w.goal.food.z, food: true } : { x: w.goal.x, z: w.goal.z };
    const state = w.mode === 'eat' ? 'eat' : w.mode === 'turn' ? (w.spinning ? 'spin' : 'turn') : w.mode === 'idle' && w.hunger > HUNGRY ? 'hungry' : w.mode;
    return {
      pose, x: w.x, z: w.z, th: w.th, heading: w.th, dir: Math.cos(w.th) >= 0 ? 1 : -1, yawRate: w.om, lift: pose.lift, flying: !!w.flying,
      trying: !!w.tries, mode: w.mode, state, hunger: w.hunger, hungry: w.hunger > HUNGRY, events, pivot: toWorld(w, w.pc, 0), goal,
      feetState: w.feet.map((f) => f.planted && w.tuck <= 0.01), // tucked up in flight is not standing
      targets: w.feet.map((f) => (f.target && !f.planted ? local(f.target[0], f.target[1], f.target[2]) : null)),
      gait: { family: gp.family, name: gp.name, phase: w.phase, duty: w.duty, offsets: w.offsets.slice(), speed: w.v, cadence: w.cadence, stride: w.stride, settled: w.settled },
    };
  }

  const api = { createWalker, step, turn, spin, toWorld, toLocal, gaitParams, supports, wingLift, canFly, GAITS, SPRITE_FPS,
    MAX_STRETCH, FLY_RATIO, STRIDE_WALK, STRIDE_HURRY, CADENCE_REF, BABY_STRIDE, TURN_RATE, TURN_RADIUS, PIVOT_RATE, PIVOT_ANGLE,
    PIVOT_AT, TURN_STRIDE, SKIP_TOL, REACH_LIMIT, HUNGRY, HUNGER_RATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureMotion = api;
})(typeof window !== 'undefined' ? window : globalThis);
