/* Creatures prototype: procedural motion, as the video describes it (step 6). Nobody animates the walk:
   - feet stay planted until the body gets too far ahead, then step (diagonal pairs take turns);
   - the tail swings on a spring;
   - wings only lift the body when they are big enough for it; too small and it doesn't fly, it tries anyway.
   Plus the pet-sim extras: breathing, blinking, looking around, a happy hop. No DOM. */
(function (root) {
  'use strict';
  const B = typeof module !== 'undefined' && module.exports ? require('./body.js') : root.CreatureBody;

  const STRIDE = 0.55;          // a foot steps when it is this far (x leg length) behind/ahead of where it wants to be
  const STEP_TIME = 0.22;       // seconds per step
  const STEP_HEIGHT = 0.35;     // foot lift during a step (x foot size x 4)
  const WALK_SPEED = 0.32;      // body lengths... in world units per second at scale 1
  const FLY_RATIO = 0.9;        // wing area / body size needed to lift off
  const TAIL_STIFF = 26, TAIL_DAMP = 4.5;

  // How well the wings could carry this body (the video's "wings only lift a body when they're big enough").
  function wingLift(ph) {
    if (!ph.wings || ph.wings.size <= 0) return 0;
    const wingArea = ph.wings.size * (0.6 + 0.8 * ph.wings.span);
    const bodySize = Math.max(...ph.torso.rings.map((r) => r.w * r.h)) * 18 * ph.torso.length + 0.3 * Math.max(...ph.head.rings.map((r) => r.w));
    return wingArea / Math.max(0.05, bodySize);
  }
  function canFly(ph) { return wingLift(ph) >= FLY_RATIO; }

  function createWalker(ph, seed, opts) {
    opts = opts || {};
    const L = B.layout(ph);
    const rnd = mulberry(seed >>> 0 || 1);
    return {
      L, ph, rnd, time: 0, progress: 0, dir: 1, x: opts.x || 0, walking: false, idleFor: 1 + rnd() * 2, walkFor: 0,
      feet: L.feet.map((f) => ({ p: f.slice(), from: f.slice(), to: f.slice(), t: 1, stepping: false })),
      tail: { a: 0, v: 0, lift: 0, lv: 0 }, blinkIn: 1.5 + rnd() * 3, blink: 0, look: 0, lookTo: 0, lookIn: 2,
      lift: 0, flap: 0, flying: false, tries: 0, hop: 0, hopV: 0,
    };
  }
  function mulberry(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // Advance the walker by dt seconds inside [minX, maxX] (world units). Returns the pose for CreatureBody.build plus
  // where to draw it: { pose, x, dir, lift }. opts: { reduced: true } stops walking and hopping (Reduced motion).
  function step(w, dt, minX, maxX, opts) {
    opts = opts || {};
    dt = Math.min(0.1, Math.max(0, dt));
    w.time += dt;
    const s = w.L.s;
    const reduced = !!opts.reduced;
    const moving = !reduced && opts.walk !== false;

    // Decide: idle a while, then walk a while; turn round at the edges.
    if (w.walking) { w.walkFor -= dt; if (w.walkFor <= 0 || !moving) { w.walking = false; w.idleFor = 1.5 + w.rnd() * 4; } }
    else { w.idleFor -= dt; if (w.idleFor <= 0 && moving) { w.walking = true; w.walkFor = 2 + w.rnd() * 5; if (w.rnd() < 0.3) turn(w); } }
    const speed = WALK_SPEED * s * (w.L.feet.length ? 1 : 0.45);
    const fly = canFly(w.ph);
    let v = 0;
    if (w.walking) {
      v = speed;
      const nx = w.x + w.dir * v * dt;
      if (nx < minX || nx > maxX) { turn(w); v = 0; } else { w.x = nx; w.progress += v * dt; }
    }

    // Feet: planted in the world, so in body space they slide back as the body moves forward.
    for (const f of w.feet) { if (!f.stepping) f.p[0] -= v * dt; }
    const reach = STRIDE * w.L.legLen;
    w.feet.forEach((f, i) => {
      const rest = w.L.feet[i];
      if (f.stepping) {
        f.t += dt / STEP_TIME;
        const t = Math.min(1, f.t), e = t * t * (3 - 2 * t);
        f.p = [f.from[0] + (f.to[0] - f.from[0]) * e, rest[1] + Math.sin(Math.PI * t) * STEP_HEIGHT * w.L.footR * 4, f.from[2] + (f.to[2] - f.from[2]) * e];
        if (t >= 1) { f.stepping = false; f.p = f.to.slice(); }
        return;
      }
      const off = Math.abs(f.p[0] - rest[0]);
      // Diagonal gait: a foot waits while its neighbours on the same side or across the same pair are stepping.
      const pair = Math.floor(i / 2), side = i % 2;
      const busy = w.feet.some((g, j) => g.stepping && j !== i && (Math.floor(j / 2) === pair || (j % 2 === side && Math.abs(Math.floor(j / 2) - pair) === 1)));
      if ((off > reach || (!w.walking && off > reach * 0.15)) && !busy) {
        f.stepping = true; f.t = 0; f.from = f.p.slice();
        // Land a little ahead of rest when walking, so the next step comes at the same rhythm.
        f.to = [rest[0] + (w.walking ? reach * 0.6 : 0), rest[1], rest[2]];
      }
    });

    // Flying or trying: big enough wings lift off now and then; small ones flap hard and hop.
    let wingFlap = Math.sin(w.time * 1.3) * 0.05;
    if (w.ph.wings && w.ph.wings.size > 0 && !reduced) {
      if (!w.flying && !w.tries && w.rnd() < dt * 0.06) { if (fly) w.flying = 3 + w.rnd() * 4; else w.tries = 1.4; }
      if (w.flying) { w.flying = Math.max(0, w.flying - dt); wingFlap = Math.sin(w.time * 11) * 0.7; }
      if (w.tries) { w.tries = Math.max(0, w.tries - dt); wingFlap = Math.sin(w.time * 22) * 0.8; if (w.hop === 0 && w.hopV === 0) w.hopV = 0.6 * s; }
    }
    const liftTarget = w.flying ? 0.28 * s + Math.sin(w.time * 2.2) * 0.03 * s : 0;
    w.lift += (liftTarget - w.lift) * Math.min(1, dt * 2.5);

    // A little hop: on request (a level-up), or now and then when happy.
    if (opts.hop && w.hop === 0 && w.hopV === 0 && !reduced) w.hopV = 0.8 * s;
    if (w.hopV !== 0 || w.hop > 0) {
      w.hop += w.hopV * dt; w.hopV -= 6 * s * dt;
      if (w.hop <= 0) { w.hop = 0; w.hopV = 0; }
    }

    // Tail on a spring: it lags behind turns and starts/stops, and sways a bit on its own.
    const tailTarget = Math.sin(w.time * (w.walking ? 5.5 : 1.6)) * (w.walking ? 0.22 : 0.12) * (reduced ? 0.3 : 1);
    w.tail.v += (TAIL_STIFF * (tailTarget - w.tail.a) - TAIL_DAMP * w.tail.v) * dt;
    w.tail.a += w.tail.v * dt;
    const liftT = (w.walking ? 0.12 : 0) + (w.flying ? -0.2 : 0);
    w.tail.lv += (TAIL_STIFF * 0.6 * (liftT - w.tail.lift) - TAIL_DAMP * w.tail.lv) * dt;
    w.tail.lift += w.tail.lv * dt;

    // Blink every few seconds; look around now and then.
    w.blinkIn -= dt;
    if (w.blinkIn <= 0) { w.blink = 0.13; w.blinkIn = 2 + w.rnd() * 4; }
    w.blink = Math.max(0, w.blink - dt);
    w.lookIn -= dt;
    if (w.lookIn <= 0) { w.lookTo = (w.rnd() - 0.5) * 0.7; w.lookIn = 1.5 + w.rnd() * 3; }
    w.look += (w.lookTo - w.look) * Math.min(1, dt * (reduced ? 1 : 4));

    // Tuck the feet up while flying.
    const feet = w.feet.map((f, i) => (w.lift > 0.02 * s ? [w.L.feet[i][0] - 0.03 * s, w.L.feet[i][1] + w.lift * 0.6, w.L.feet[i][2]] : f.p.slice()));
    const pose = {
      breathe: Math.sin(w.time * (reduced ? 1.2 : 2.2)), lookYaw: w.look, tailSway: w.tail.a, tailLift: w.tail.lift,
      wingFlap, feet, blink: w.blink > 0 ? 1 : 0, lift: w.lift + w.hop,
    };
    return { pose, x: w.x, dir: w.dir, lift: pose.lift, flying: !!w.flying, trying: !!w.tries };
  }
  function turn(w) {
    w.dir = -w.dir;
    w.feet.forEach((f, i) => { f.p = w.L.feet[i].slice(); f.stepping = false; });
  }

  const api = { createWalker, step, wingLift, canFly, STRIDE, STEP_TIME, FLY_RATIO, WALK_SPEED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureMotion = api;
})(typeof window !== 'undefined' ? window : globalThis);
