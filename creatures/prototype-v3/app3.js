/* Creature Hatchery, version 3: the hatchery seen from straight above.

   The genome, colours and walk are version 1's and 2's (../prototype/genome.js and render.js, ../prototype-v2/chain.js,
   motion2.js and light.js). This page only changes the camera: the floor is the screen, x across and z down, and the
   creature is drawn from above by topdown.js with its feet splayed out to the sides. The egg hatches, the creature
   wanders, notices dropped food, walks over, bites, chews and swallows, and now and then leaves a dropping that fades.

   URL: seed, level, temperament, style (original|cel|pixel), habitat (grass|dirt|stones|water), sun (dawn|left|morning|
   noon|afternoon|right|dusk|night or 0..1), auto=1, theme (light|dark), skeleton=1, pause=1, hunger (0..1), food
   (berry|seed|leaf|apple|fish: one snack in front of it), hatch (seconds into the hatching, a still), heading, test=1.
   ?size= is read by tools/shots.js (the window size), not by the page. */
(function () {
  'use strict';
  const G = window.CreatureGenome, Rn = window.CreatureRender, C = window.CreatureChain, M2 = window.CreatureMotion2;
  const LT = window.CreatureLight, TD = window.CreatureTopdown, HAB = window.CreatureHabitats3;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const TEST = params.get('test') === '1';
  const PAUSE = params.get('pause') === '1' || TEST;
  const reducedMotion = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  if (params.get('theme') === 'dark' || params.get('theme') === 'light') document.documentElement.dataset.theme = params.get('theme');

  const STAGE_W = 640, STAGE_H = 360;
  const VIEW = { scale: 84, ox: STAGE_W / 2, oy: STAGE_H / 2 }; // world to screen: 84 px a world unit, (0, 0) mid-stage
  const PIXEL = 3;                                                 // the Pixel look draws at a third of the size
  const EDGE = 56;                                                 // screen pixels kept clear round the walk area
  const START_HEADING = 0.35;                                      // facing right and a little up the screen
  const PIXEL_FPS = 12;                                            // the Pixel look keeps the video's slow clock
  const HATCH = { wobble: 1.2, crack: [0.5, 1.7], open: [1.7, 2.3], baby: 2.1, fade: [2.4, 3.2], walkOut: [2.15, 3.4] };
  const DAY_SECONDS = 90;
  const EGG_R = 0.25;                                              // world units
  // Food for the prototype's drop-a-snack click (the same bites and values as version 2); size in world units.
  const FOODS = {
    berry: { bites: 2, value: 0.2, size: 0.06 }, seed: { bites: 1, value: 0.1, size: 0.045 }, leaf: { bites: 3, value: 0.25, size: 0.09 },
    apple: { bites: 4, value: 0.4, size: 0.085 }, fish: { bites: 4, value: 0.45, size: 0.11 },
  };
  const MAX_FOOD = 6, DROP_TIME = 0.45, DROP_HEIGHT = 0.9, POOP_LIFE = 9, SPARKLE_LIFE = 1.3, CRUMB_LIFE = 0.5;
  const STYLES = [['original', 'Original'], ['cel', 'Cel'], ['pixel', 'Pixel']];
  const STATE_WORDS = { idle: 'idle', go: 'walking', turn: 'turning', spin: 'spinning!', eat: 'eating', hungry: 'hungry' };

  const styleParam = params.get('style') === 'gochi' ? 'original' : params.get('style');
  const S = {
    creature: null, temperament: 0, level: 1, phase: 'egg', hatchT: 0, ph: null, walker: null, out: null,
    style: STYLES.some((s) => s[0] === styleParam) ? styleParam : 'original',
    habitat: HAB.KEYS.includes(params.get('habitat')) ? params.get('habitat') : 'grass', hab: null, area: null,
    time: LT.timeFor(params.get('sun') || params.get('time'), LT.NAMED.morning), auto: params.get('auto') === '1' && !PAUSE, sun: null,
    skeleton: params.get('skeleton') === '1', walk: !PAUSE, food: 'berry', foods: [], poops: [], fx: [], dirty: true, frameMs: [],
  };

  const stage = $('stage'), sctx = stage.getContext('2d');
  stage.width = STAGE_W; stage.height = STAGE_H;
  const toScreen = (x, z) => [VIEW.ox + x * VIEW.scale, VIEW.oy + z * VIEW.scale];
  const fromScreen = (sx, sy) => [(sx - VIEW.ox) / VIEW.scale, (sy - VIEW.oy) / VIEW.scale];
  const baseArea = () => ({ minX: (EDGE - VIEW.ox) / VIEW.scale, maxX: (STAGE_W - EDGE - VIEW.ox) / VIEW.scale, minZ: (EDGE * 0.8 - VIEW.oy) / VIEW.scale, maxZ: (STAGE_H - EDGE * 0.8 - VIEW.oy) / VIEW.scale });
  const pxSize = () => (S.style === 'pixel' ? PIXEL : 1);
  function makeCanvas(w, h) { return Object.assign(document.createElement('canvas'), { width: w, height: h }); }

  // ---------- the creature ----------
  function phenotypeAt(level) { return G.express(S.creature, { temperament: S.temperament, level }); }
  function refresh() {
    S.ph = phenotypeAt(S.level);
    const w0 = S.walker;
    S.walker = M2.createWalker(S.ph, G.hashSeed(String(S.creature.seed)), {
      rig: TD.rig(S.ph), x: w0 ? w0.x : 0, z: w0 ? w0.z : 0, heading: w0 ? w0.th : START_HEADING,
      hunger: w0 ? w0.hunger : S.startHunger,
    });
    S.out = M2.step(S.walker, 0, S.area, null, { walk: false });
    S.dirty = true;
    updatePanels();
  }
  function setCreature(c, opts) {
    opts = opts || {};
    S.creature = c;
    S.temperament = opts.temperament != null ? opts.temperament : G.genotype(c).temperament;
    S.level = opts.level || 1;
    S.phase = opts.phase || 'egg';
    S.hatchT = 0; S.walker = null; S.foods = []; S.poops = []; S.fx = [];
    $('seed').value = c.parents ? '' : String(c.seed);
    $('temper').value = S.temperament; $('level').value = S.level;
    refresh();
  }
  function newEgg(seed) {
    if (seed == null || seed === '') seed = Math.floor(Math.random() * 1e9).toString(36);
    setCreature(G.randomCreature(seed), { phase: 'egg' });
  }
  function hatch() {
    if (S.phase !== 'egg') return;
    S.level = 1; $('level').value = 1;
    S.walker = null; refresh();
    S.phase = 'hatching'; S.hatchT = 0;
    // the baby starts inside the egg, facing out of it
    M2.place(S.walker, 0, 0, START_HEADING);
    if (reducedMotion) finishHatch();
    S.dirty = true; updatePanels();
  }
  function finishHatch() {
    S.phase = 'creature'; S.level = 1; $('level').value = 1;
    S.dirty = true; updatePanels();
  }

  // ---------- habitat and light ----------
  function setHabitat(key) {
    S.habitat = HAB.KEYS.includes(key) ? key : 'grass';
    S.hab = HAB.create(S.habitat, { W: STAGE_W, H: STAGE_H, view: VIEW, pixel: pxSize(), seed: 4242 });
    S.area = S.hab.area(baseArea());
    if (S.walker) { // step it back onto land if the new floor took its spot
      const w = S.walker;
      if (w.z < S.area.minZ || w.z > S.area.maxZ || w.x < S.area.minX || w.x > S.area.maxX)
        M2.place(w, Math.max(S.area.minX, Math.min(S.area.maxX, w.x)), Math.max(S.area.minZ + 0.2, Math.min(S.area.maxZ, w.z)), w.th);
    }
    for (const f of S.foods) f.z = Math.max(S.area.minZ, f.z);
    S.dirty = true;
  }
  function setTime(t) { S.time = ((t % 1) + 1) % 1; S.sun = LT.sunAt(S.time); S.dirty = true; }
  function setStyle(v) {
    S.style = v;
    $('stage').classList.toggle('pix', v === 'pixel');
    setHabitat(S.habitat);
  }

  // ---------- drawing helpers: the Pixel look draws small things into a small canvas, then scales it up ----------
  const low = makeCanvas(Math.ceil(STAGE_W / PIXEL), Math.ceil(STAGE_H / PIXEL)), lctx = low.getContext('2d', { willReadFrequently: true });
  function layer(fn) {
    if (S.style !== 'pixel') { fn(sctx, VIEW, 1); return; }
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, low.width, low.height);
    fn(lctx, { scale: VIEW.scale / PIXEL, ox: VIEW.ox / PIXEL, oy: VIEW.oy / PIXEL }, PIXEL);
    const d = lctx.getImageData(0, 0, low.width, low.height), a = d.data; // hard edges, like the creature
    for (let i = 3; i < a.length; i += 4) a[i] = a[i] >= 110 ? 255 : 0;
    lctx.putImageData(d, 0, 0);
    sctx.save(); sctx.imageSmoothingEnabled = false; sctx.drawImage(low, 0, 0, low.width * PIXEL, low.height * PIXEL); sctx.restore();
  }
  const rgb = (c, a) => 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : a) + ')';
  function ell(ctx, x, y, rx, ry, rot, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rot || 0, 0, Math.PI * 2); ctx.fill(); }
  function softShadow(ctx, v, x, z, h, rx, rz) {
    const sun = S.sun, d = TD.shadowOffset(sun, h), a = TD.shadowAlpha(sun);
    const p = [v.ox + (x + d[0]) * v.scale, v.oy + (z + d[1]) * v.scale];
    ctx.save();
    if (S.style === 'original') ctx.filter = 'blur(1.5px)';
    ell(ctx, p[0], p[1], rx * v.scale, rz * v.scale, 0, rgb(TD.SHADOW_RGB, a));
    ctx.restore();
  }

  // ---------- the egg, from above ----------
  // An egg standing on its end: from above a round shell, lit from the sun's side, with the genome's marks. It wobbles,
  // a zigzag crack runs across its top, then the two halves fall apart to the sides and the baby walks out.
  function eggLook() { return G.eggLook(S.creature); }
  function drawEgg(ctx, v, pose, alpha) {
    const look = eggLook(), pal = Rn.palette({ kind: 'egg', look }), e = pal.egg, m = pal.mark, inn = pal.inner;
    const k = v.scale, open = pose.open || 0, crack = pose.crack || 0, wob = pose.wobble || 0;
    const r = EGG_R * k, ry = r * (0.86 + 0.14 * look.round);
    const c = [v.ox + wob * 0.25 * r, v.oy];
    const L = S.sun && S.sun.L ? (() => { const h = Math.hypot(S.sun.L[0], S.sun.L[2]) || 1; return [S.sun.L[0] / h, S.sun.L[2] / h]; })() : [-0.6, -0.8];
    ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha;
    if (open < 0.02) softShadow(ctx, v, wob * 0.05, 0, EGG_R * 1.2, EGG_R * 0.95, EGG_R * 0.8);
    const shell = (cx, cy, rot, half) => { // half: 0 whole, -1 upper, +1 lower (the zigzag edge between)
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
      ctx.beginPath();
      if (!half) ctx.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2);
      else {
        ctx.ellipse(0, 0, r, ry, 0, half < 0 ? Math.PI : 0, half < 0 ? Math.PI * 2 : Math.PI);
        for (let i = 0; i <= 8; i++) { const x = half < 0 ? r - i * r / 4 : -r + i * r / 4; ctx.lineTo(x, (i % 2 ? -1 : 1) * r * 0.12); }
      }
      ctx.closePath();
      if (half) { ctx.fillStyle = rgb(inn[3]); ctx.fill(); } // the inside shows as it tips over
      ctx.save(); ctx.clip();
      const off = half ? half * ry * 0.35 * open : 0;
      ctx.translate(0, off);
      if (S.style === 'original') {
        const g = ctx.createRadialGradient(L[0] * r * 0.35, L[1] * r * 0.35, r * 0.1, 0, 0, r * 1.15);
        g.addColorStop(0, rgb(e[5])); g.addColorStop(0.35, rgb(e[4])); g.addColorStop(0.8, rgb(e[3])); g.addColorStop(1, rgb(e[2]));
        ctx.fillStyle = g;
      } else ctx.fillStyle = rgb(e[3]);
      ctx.beginPath(); ctx.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2); ctx.fill();
      // the marks, from the same seed every time
      const rnd = G.makeRng('egg' + S.creature.seed), n = Math.round(6 + 14 * look.markAmount);
      ctx.fillStyle = rgb(m[3]); ctx.strokeStyle = rgb(m[3]); ctx.lineWidth = Math.max(1, r * 0.1);
      if (look.marks === 'bands') for (let i = -1; i <= 1; i++) ctx.fillRect(-r, i * ry * 0.45 - r * 0.06, r * 2, r * 0.12);
      else if (look.marks === 'zigzag') { ctx.beginPath(); for (let i = 0; i <= 8; i++) ctx.lineTo(-r + i * r / 4, (i % 2 ? -1 : 1) * r * 0.14 + ry * 0.4); ctx.stroke(); }
      else for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.85, s = (look.marks === 'spots' ? 0.1 + 0.08 * look.markScale : 0.035) * r * (0.7 + rnd() * 0.6) * 2.2;
        ctx.beginPath(); ctx.ellipse(Math.cos(a) * d * r, Math.sin(a) * d * ry, s, s * 0.85, a, 0, Math.PI * 2); ctx.fill();
      }
      if (S.style === 'cel' || S.style === 'pixel') { // one shadow band on the far side from the light
        ctx.beginPath(); ctx.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2); ctx.ellipse(L[0] * r * 0.35, L[1] * r * 0.35, r * 1.02, ry * 1.02, 0, 0, Math.PI * 2);
        ctx.fillStyle = rgb(e[1], S.style === 'pixel' ? 1 : 0.45); ctx.fill('evenodd');
        if (S.style === 'cel') ell(ctx, L[0] * r * 0.45, L[1] * r * 0.45, r * 0.18, r * 0.11, Math.atan2(L[1], L[0]) + Math.PI / 2, rgb(e[5]));
      }
      ctx.restore();
      if (S.style !== 'pixel') { ctx.strokeStyle = rgb(e[0], S.style === 'cel' ? 1 : 0.7); ctx.lineWidth = S.style === 'cel' ? 2 : 1.1; ctx.stroke(); }
      ctx.restore();
    };
    if (open < 0.02) {
      shell(c[0], c[1], wob, 0);
      if (crack > 0) { // the crack runs across the top, left to right
        ctx.save(); ctx.translate(c[0], c[1]); ctx.rotate(wob);
        ctx.strokeStyle = rgb(e[0]); ctx.lineWidth = Math.max(1, r * 0.06); ctx.lineJoin = 'round';
        ctx.beginPath(); const steps = Math.max(1, Math.round(8 * crack));
        for (let i = 0; i <= steps; i++) { const x = -r + i * r / 4; if (i) ctx.lineTo(x, (i % 2 ? -1 : 1) * r * 0.12); else ctx.moveTo(x, r * 0.12); }
        ctx.stroke(); ctx.restore();
      }
    } else { // the halves fall away up and down the screen and tip over
      const d = open * r * 0.9;
      shell(c[0], c[1] - d, -0.25 * open, -1);
      shell(c[0], c[1] + d, 0.25 * open, 1);
    }
    ctx.restore();
  }

  // ---------- food, droppings, crumbs ----------
  function dropFood(x, z, kind, landed) {
    const f = FOODS[kind] || FOODS.berry, a = S.area;
    if (S.foods.filter((o) => !o.gone).length >= MAX_FOOD) S.foods.shift();
    const food = { kind: FOODS[kind] ? kind : 'berry', x: Math.max(a.minX, Math.min(a.maxX, x)), z: Math.max(a.minZ, Math.min(a.maxZ, z)),
      bites: f.bites, maxBites: f.bites, value: f.value, age: landed ? DROP_TIME : 0, rot: Math.random() * Math.PI * 2 };
    S.foods.push(food); S.dirty = true;
    return food;
  }
  function foodFor(w) {
    if (w.eat && w.eat.food && !w.eat.food.gone) return w.eat.food;
    if (w.goal && w.goal.food && !w.goal.food.gone && w.goal.food.bites > 0) return w.goal.food;
    let best = null, bd = Infinity;
    for (const f of S.foods) {
      if (f.gone || f.bites <= 0 || f.age < DROP_TIME) continue;
      const d = Math.hypot(f.x - w.x, f.z - w.z);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
  // From above: it falls toward us (bigger, its shadow apart from it), then lies on the floor, smaller with each bite.
  function drawFood(ctx, v, f) {
    const def = FOODS[f.kind], u = Math.min(1, f.age / DROP_TIME), up = (1 - u * u) * DROP_HEIGHT;
    const k = v.scale, s = def.size * k * (0.45 + 0.55 * f.bites / f.maxBites) * (1 + 0.6 * up);
    softShadow(ctx, v, f.x, f.z, up + 0.02, def.size * 0.8, def.size * 0.6);
    const x = v.ox + f.x * k, y = v.oy + f.z * k - up * k * 0.15;
    ctx.save(); ctx.translate(x, y); ctx.rotate(f.rot || 0);
    const line = S.style === 'pixel' ? null : 'rgba(40,24,30,0.55)';
    const out = () => { if (line) { ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke(); } };
    if (f.kind === 'berry') {
      for (const [dx, dy, c] of [[-0.35, 0.1, '#b8284a'], [0.35, 0.15, '#d23a5c'], [0, -0.3, '#c9304f']]) { ell(ctx, dx * s, dy * s, s * 0.55, s * 0.55, 0, c); out(); }
      ell(ctx, -0.15 * s, -0.45 * s, s * 0.16, s * 0.16, 0, '#ffd0dc'); ell(ctx, 0, -0.05 * s, s * 0.22, s * 0.12, 0.6, '#5aa845');
    } else if (f.kind === 'seed') {
      ell(ctx, 0, 0, s * 0.8, s * 0.5, 0, '#d9b27a'); out(); ell(ctx, -s * 0.2, -s * 0.15, s * 0.25, s * 0.14, 0, '#f2d9a8');
      ctx.fillStyle = '#9a7444'; ctx.fillRect(-s * 0.5, -0.5, s, 1);
    } else if (f.kind === 'leaf') {
      ell(ctx, 0, 0, s, s * 0.45, 0, '#6cbf4a'); out(); ctx.strokeStyle = '#3f8f2c'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-s * 1.1, 0); ctx.lineTo(s * 0.9, 0); for (let i = -2; i <= 2; i++) { ctx.moveTo(i * s * 0.3, 0); ctx.lineTo(i * s * 0.3 + s * 0.2, (i % 2 ? 1 : -1) * s * 0.3); } ctx.stroke();
    } else if (f.kind === 'apple') {
      ell(ctx, 0, 0, s * 0.9, s * 0.85, 0, '#d83b30'); out(); ell(ctx, -s * 0.3, -s * 0.3, s * 0.25, s * 0.2, 0.5, '#ff9a8a');
      ell(ctx, 0, 0, s * 0.12, s * 0.12, 0, '#5a3a20'); ell(ctx, s * 0.25, -s * 0.1, s * 0.28, s * 0.13, -0.5, '#5aa845');
    } else {
      ell(ctx, -s * 0.1, 0, s * 0.85, s * 0.36, 0, '#8fb3c9'); out(); ell(ctx, -s * 0.1, s * 0.05, s * 0.6, s * 0.15, 0, '#d8e6ee');
      ctx.fillStyle = '#6f93aa'; ctx.beginPath(); ctx.moveTo(s * 0.65, 0); ctx.lineTo(s * 1.15, -s * 0.38); ctx.lineTo(s * 1.15, s * 0.38); ctx.closePath(); ctx.fill();
      ell(ctx, -s * 0.65, -s * 0.08, Math.max(0.8, s * 0.07), Math.max(0.8, s * 0.07), 0, '#1c1c24');
    }
    if (f.bites < f.maxBites) ell(ctx, s * 0.5, -s * 0.3, s * 0.35 * (1 - f.bites / f.maxBites), s * 0.3 * (1 - f.bites / f.maxBites), 0, 'rgba(0,0,0,0)');
    ctx.restore();
  }
  // A small dropping from above: a brown swirl, coiled in rings. It fades.
  function drawPoop(ctx, v, p) {
    const x = v.ox + p.x * v.scale, y = v.oy + p.z * v.scale, k = v.scale / 84;
    ctx.save(); ctx.globalAlpha = Math.min(1, (POOP_LIFE - p.age) / 2);
    ell(ctx, x + 1.5 * k, y + 1.5 * k, 6 * k, 5 * k, 0, 'rgba(30,20,20,0.25)');
    ell(ctx, x, y, 6 * k, 5 * k, 0, '#8a5a3c'); ell(ctx, x - 0.5 * k, y - 0.5 * k, 4.2 * k, 3.5 * k, 0, '#9a6848'); ell(ctx, x - 1 * k, y - 1 * k, 2.2 * k, 1.9 * k, 0, '#b07c58');
    ctx.fillStyle = '#e8d2c0'; ctx.fillRect(x - 2.5 * k, y - 3 * k, Math.max(1, k), Math.max(1, k));
    ctx.restore();
  }
  function onEvents(st) {
    for (const e of st.events) {
      if (e.type === 'bite') {
        const f = S.walker.eat && S.walker.eat.food; if (!f) continue;
        const p = toScreen(f.x, f.z);
        for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2, sp = 18 + Math.random() * 22; S.fx.push({ kind: 'crumb', x: p[0], y: p[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: CRUMB_LIFE, col: f.kind === 'leaf' ? '#6cbf4a' : f.kind === 'fish' ? '#d8e6ee' : f.kind === 'seed' ? '#d9b27a' : '#e05a6a' }); }
      } else if (e.type === 'happy') {
        const p = toScreen(st.x, st.z);
        for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; S.fx.push({ kind: 'spark', x: p[0] + Math.cos(a) * 30, y: p[1] + Math.sin(a) * 22, vx: Math.cos(a) * 8, vy: Math.sin(a) * 8, age: -i * 0.08, life: SPARKLE_LIFE, col: i % 2 ? '#ffe36a' : '#ffffff' }); }
      } else if (e.type === 'poop') S.poops.push({ x: e.x, z: e.z, age: 0 });
    }
  }
  function drawFx(dt) {
    for (const f of S.fx) {
      f.age += dt;
      if (f.age < 0) continue;
      f.x += f.vx * dt; f.y += f.vy * dt; if (f.kind === 'crumb') { f.vx *= 0.9; f.vy *= 0.9; }
      const a = Math.max(0, 1 - f.age / f.life), x = Math.round(f.x), y = Math.round(f.y);
      sctx.globalAlpha = a; sctx.fillStyle = f.col;
      if (f.kind === 'spark') { const r = f.age < f.life * 0.5 ? 3 : 2; sctx.fillRect(x - r, y, 2 * r + 1, 1.5); sctx.fillRect(x, y - r, 1.5, 2 * r + 1); }
      else sctx.fillRect(x - 1, y - 1, 2, 2);
    }
    sctx.globalAlpha = 1;
    S.fx = S.fx.filter((f) => f.age < f.life);
    for (const p of S.poops) p.age += dt;
    S.poops = S.poops.filter((p) => p.age < POOP_LIFE);
    S.foods = S.foods.filter((f) => !f.gone);
    for (const f of S.foods) f.age += dt;
  }

  // ---------- one frame ----------
  function drawCreature(ctx, v, px, out) {
    TD.draw(ctx, S.walker, v, { style: S.style, sun: S.sun, out, pixel: PIXEL, canvas: makeCanvas });
  }
  function paintScene(dt, t, extra) {
    if (!S.sun) S.sun = LT.sunAt(S.time);
    S.hab.draw(sctx, t, { reduced: reducedMotion || PAUSE });
    layer((ctx, v) => { for (const p of S.poops) drawPoop(ctx, v, p); for (const f of S.foods) if (f.age >= DROP_TIME) drawFood(ctx, v, f); });
    if (extra) extra();
    layer((ctx, v) => { for (const f of S.foods) if (f.age < DROP_TIME) drawFood(ctx, v, f); });
    drawFx(dt);
    LT.drawTint(sctx, S.sun, STAGE_W, STAGE_H);
    if (S.skeleton && S.walker && S.phase !== 'egg') TD.skeleton(sctx, S.walker, VIEW, { out: S.out, sun: S.sun });
    $('stageBox').classList.toggle('dark', S.sun.body === 'moon');
  }
  function showMood(st) {
    if (!st) { $('mood').textContent = S.phase === 'egg' ? 'egg' : 'hatching'; $('hungerBar').style.width = '0%'; return; }
    $('hungerBar').style.width = Math.round(st.hunger * 100) + '%';
    $('hungerBar').classList.toggle('low', st.hungry);
    $('mood').textContent = st.state === 'go' && st.goal && st.goal.food ? 'going to food' : STATE_WORDS[st.state] || st.state;
  }
  function frame(dt) {
    const t0 = performance.now();
    const t = reducedMotion || PAUSE ? 0 : t0 / 1000;
    if (S.phase === 'egg') {
      const wob = PAUSE || reducedMotion ? 0 : Math.sin(t * 2.2) * 0.05 * (Math.sin(t * 0.7) > 0.6 ? 1 : 0.25);
      paintScene(dt, t, () => layer((ctx, v) => drawEgg(ctx, v, { wobble: wob })));
      showMood(null);
    } else if (S.phase === 'hatching') {
      S.hatchT += dt;
      const T = S.hatchT, ramp = (a, b) => Math.max(0, Math.min(1, (T - a) / (b - a)));
      const wob = Math.sin(T * 18) * 0.12 * Math.min(1, T / HATCH.wobble) * (1 - ramp(HATCH.open[0], HATCH.open[1]));
      const pose = { wobble: wob, crack: ramp(HATCH.crack[0], HATCH.crack[1]), open: ramp(HATCH.open[0], HATCH.open[1]) };
      const fade = 1 - ramp(HATCH.fade[0], HATCH.fade[1]);
      const out = T < HATCH.baby ? M2.step(S.walker, 0, S.area, null, { walk: false })
        : M2.step(S.walker, dt, S.area, null, { walk: true, hop: T - dt < HATCH.baby, drive: T < HATCH.walkOut[1] ? { v: 0.6, om: 0 } : null });
      S.out = out;
      paintScene(dt, t, () => {
        if (T >= HATCH.open[0]) layer((ctx, v, px) => drawCreature(ctx, v, px, out));
        layer((ctx, v) => drawEgg(ctx, v, pose, T < HATCH.baby ? 1 : fade));
      });
      showMood(null);
      if (T >= HATCH.fade[1]) finishHatch();
    } else {
      const w = S.walker, moving = S.walk && !PAUSE;
      const st = M2.step(w, PAUSE ? 0 : dt, S.area, null, { walk: moving, reduced: reducedMotion || PAUSE, food: foodFor(w) });
      S.out = st;
      onEvents(st);
      paintScene(PAUSE ? 0 : dt, t, () => drawCreature(sctx, VIEW, 1, st));
      showMood(st);
    }
    const ms = performance.now() - t0;
    S.frameMs.push(ms); if (S.frameMs.length > 120) S.frameMs.shift();
  }

  let last = 0, acc = 0;
  function loop(now) {
    const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
    last = now; acc += dt;
    if (S.auto && !PAUSE && dt > 0) { S.time = (S.time + dt / DAY_SECONDS) % 1; S.sun = LT.sunAt(S.time); syncTime(); }
    const step = S.style === 'pixel' ? 1 / PIXEL_FPS : 0;
    if ((!PAUSE && acc >= step) || S.dirty) {
      frame(Math.min(0.25, acc));
      acc = 0; S.dirty = false;
    }
    requestAnimationFrame(loop);
  }

  // ---------- panels ----------
  function updatePanels() {
    if (!S.creature) return;
    const c = S.creature, tr = G.traits(c), stg = G.stageOf(S.level);
    $('name').textContent = S.phase === 'egg' ? 'Egg' : c.name;
    $('stageName').textContent = S.phase === 'egg' ? (c.parents ? 'from ' + c.parents.join(' x ') : 'seed ' + c.seed) : 'Lv ' + S.level + ' · ' + stg;
    $('rarity').textContent = S.phase === 'egg' ? '?' : tr.rarity;
    $('tval').textContent = (S.temperament >= 0 ? '+' : '') + S.temperament.toFixed(2);
    $('lval').textContent = S.level + ' · ' + stg;
    $('hatch').disabled = S.phase !== 'egg';
    const egg = S.phase === 'egg';
    $('aboutName').textContent = egg ? 'An egg' : c.name;
    $('traits').innerHTML = '';
    if (!egg) [tr.rarity].concat(tr.traits).forEach((t, i) => { const s = document.createElement('span'); s.textContent = t; if (i === 0 && t !== 'common') s.className = 'rare'; $('traits').appendChild(s); });
    const R = S.walker ? S.walker.R : TD.rig(S.ph);
    $('chainInfo').textContent = egg ? 'Hatch it to see what is inside.' : 'Chain: ' + R.joints.length + ' joints, ' + R.hips.length + ' legs. Feet stand ' +
      (R.hips.length ? Math.round(Math.abs(R.hips[0].foot[2]) / R.legLen * 100) / 100 : 0) + ' leg lengths out from the spine. Mouth: ' + S.ph.mouth.kind + '.';
    for (const b of $('looks').children) b.classList.toggle('on', b.dataset.v === S.style);
    for (const b of $('habitats').children) b.classList.toggle('on', b.dataset.v === S.habitat);
    for (const b of $('foods').children) b.classList.toggle('on', b.dataset.v === S.food);
    $('skeleton').classList.toggle('on', S.skeleton);
    $('walk').classList.toggle('on', S.walk);
    syncTime();
  }
  function syncTime() {
    if (!S.sun) S.sun = LT.sunAt(S.time);
    $('time').value = S.time.toFixed(3);
    $('timeVal').textContent = S.sun.label + (S.sun.body === 'moon' ? ' (moon)' : '');
    $('autoSun').classList.toggle('on', S.auto);
  }
  function chips(id, items, onPick) {
    const box = $(id); box.innerHTML = '';
    for (const [v, label] of items) {
      const b = document.createElement('button'); b.textContent = label; b.dataset.v = v;
      b.addEventListener('click', () => onPick(v));
      box.appendChild(b);
    }
  }

  chips('looks', STYLES, (v) => { setStyle(v); updatePanels(); });
  chips('habitats', HAB.LIST.map((h) => [h[0], h[1]]), (v) => { setHabitat(v); updatePanels(); });
  for (const b of $('habitats').children) b.title = HAB.LIST.find((h) => h[0] === b.dataset.v)[2];
  // Prototype only: pick a food, then click the floor to drop it there. The game has no such button.
  chips('foods', Object.keys(FOODS).map((k) => [k, k]), (v) => { S.food = v; updatePanels(); });
  stage.addEventListener('click', (e) => {
    if (S.phase !== 'creature') return;
    const r = stage.getBoundingClientRect(), p = fromScreen((e.clientX - r.left) / r.width * STAGE_W, (e.clientY - r.top) / r.height * STAGE_H);
    dropFood(p[0], p[1], S.food);
  });
  $('time').addEventListener('input', () => { S.auto = false; setTime(Number($('time').value)); syncTime(); });
  $('autoSun').addEventListener('click', () => { S.auto = !S.auto; syncTime(); });
  $('skeleton').addEventListener('click', () => { S.skeleton = !S.skeleton; S.dirty = true; updatePanels(); });
  $('walk').addEventListener('click', () => { S.walk = !S.walk; updatePanels(); });
  $('temper').addEventListener('input', () => { S.temperament = Number($('temper').value); refresh(); });
  $('level').addEventListener('input', () => { S.level = Number($('level').value); if (S.phase === 'egg') S.phase = 'creature'; refresh(); });
  $('newEgg').addEventListener('click', () => newEgg());
  $('hatch').addEventListener('click', hatch);
  $('loadSeed').addEventListener('click', () => newEgg($('seed').value.trim()));
  $('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') newEgg($('seed').value.trim()); });

  // ---------- start ----------
  if (params.get('hunger') != null) S.startHunger = Math.max(0, Math.min(1, Number(params.get('hunger')) || 0));
  setStyle(S.style);
  setTime(S.time);
  newEgg(params.get('seed') || undefined);
  if (params.get('temperament') != null) { S.temperament = Number(params.get('temperament')); $('temper').value = S.temperament; }
  if (params.get('level')) { S.phase = 'creature'; S.level = Math.max(1, Math.min(100, Number(params.get('level')) || 1)); $('level').value = S.level; }
  refresh();
  if (params.get('heading') != null && S.walker) M2.place(S.walker, 0, 0, Number(params.get('heading')) || 0);
  if (params.get('hatch') != null && S.phase === 'egg') { // a still of the hatching, this many seconds in
    hatch();
    const T = Math.max(0, Number(params.get('hatch')) || 0);
    for (let s = 0; s < T - 1e-9; s += 1 / 30) frame(Math.min(1 / 30, T - s));
    S.dirty = true;
  }
  if (FOODS[params.get('food')] && S.phase === 'creature') { // one snack in front of its head, already landed
    const w = S.walker, h = w.chain.joints[0], d = C.dirOf(w.chain.angles[0]), k = 0.75 * S.ph.scale;
    dropFood(h[0] + d[0] * k, h[1] + d[1] * k, params.get('food'), true);
    if (params.get('eat') != null) { // a still of it eating: walk it there for this many seconds first
      const T = Number(params.get('eat')) || 0;
      for (let s = 0; s < T; s += 1 / 60) { const st = M2.step(w, 1 / 60, S.area, null, { walk: true, food: foodFor(w) }); onEvents(st); for (const f of S.foods) f.age += 1 / 60; }
      S.fx = [];
    }
  }
  updatePanels();
  requestAnimationFrame(loop);

  const api = { S, newEgg, hatch, finishHatch, refresh, frame, dropFood, foodFor, setHabitat, setStyle, setTime, toScreen, fromScreen, drawEgg };
  window.CreatureHatchery3 = api;
  if (TEST) setTimeout(runChecks, 50);

  // ---------- self-checks (?test=1), read by test/e2e.js ----------
  function runChecks() {
    const checks = [];
    const check = (name, pass, info) => checks.push({ name, pass: !!pass, info: info === undefined ? null : info });
    const hash = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
    const seed = params.get('seed') || 'test';
    const probe = Object.assign(document.createElement('canvas'), { width: STAGE_W, height: STAGE_H }), pctx = probe.getContext('2d', { willReadFrequently: true });
    const pixels = (cv) => { pctx.clearRect(0, 0, STAGE_W, STAGE_H); pctx.drawImage(cv, 0, 0); return pctx.getImageData(0, 0, STAGE_W, STAGE_H).data; };
    const opaque = (d) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; };
    try {
      // The page and its rules: version label, links to the other versions, food marked prototype only, no cheat buttons.
      check('version label and links', /Version 3/.test(document.body.textContent) && !!document.querySelector('a[href^="../prototype/"]') &&
        !!document.querySelector('a[href^="../prototype-v2/"]:not([href*="compare"])') && !!document.querySelector('a[href*="compare.html"]'));
      check('food drop is labelled prototype only', /prototype only/i.test($('foodRow').textContent));
      const cheat = [...document.querySelectorAll('button')].filter((b) => /feed|add tokens|level up/i.test(b.textContent)).map((b) => b.textContent);
      check('no feed or add-tokens buttons', cheat.length === 0, cheat);
      // Same seed, same creature; the egg draws; it hatches through wobble, crack and open into a level 1 baby.
      newEgg(seed);
      const fp = G.fingerprint(S.creature);
      newEgg(seed);
      check('seed recreates the creature', G.fingerprint(S.creature) === fp);
      const eggC = makeCanvas(STAGE_W, STAGE_H), ectx = eggC.getContext('2d');
      drawEgg(ectx, VIEW, {});
      const eggN = opaque(pixels(eggC));
      check('egg is drawn', eggN > 800, eggN);
      hatch();
      const seen = { crack: false, open: false };
      let steps = 0;
      while (S.phase === 'hatching' && steps < 400) {
        frame(1 / 30); steps++;
        if (S.hatchT > HATCH.crack[0] && S.hatchT < HATCH.open[0]) seen.crack = true;
        if (S.hatchT > HATCH.open[1]) seen.open = true;
      }
      const stepped = Math.hypot(S.walker.x, S.walker.z);
      check('the egg hatches: wobble, crack, open, a level 1 baby steps out', S.phase === 'creature' && S.level === 1 && seen.crack && seen.open && stepped > 0.02 * S.ph.scale,
        { phase: S.phase, level: S.level, seconds: S.hatchT, stepped });
      // Grown up, it wanders: links within 2% of their rest length, joints inside their angle limits, planted feet still.
      S.level = 100; refresh();
      const w = S.walker;
      let linkErr = 0, bendOver = 0, slip = 0, stepsTaken = 0, moved = 0;
      const pinned = w.feet.map((f) => (f.planted ? [f.wx, f.wz] : null));
      const x0 = w.x, z0 = w.z;
      for (let i = 0; i < 60 * 25; i++) {
        M2.step(w, 1 / 60, S.area, null, { walk: true });
        const J = w.chain.joints;
        for (let j = 1; j < J.length; j++) {
          linkErr = Math.max(linkErr, Math.abs(Math.hypot(J[j][0] - J[j - 1][0], J[j][1] - J[j - 1][1]) - w.chain.links[j]) / w.chain.links[j]);
          bendOver = Math.max(bendOver, Math.abs(C.wrap(w.chain.angles[j] - w.chain.angles[j - 1])) - w.R.bend[j]);
        }
        const air = w.tuck > 0.01; // flying: the feet are tucked up, not standing
        w.feet.forEach((f, k) => {
          if (air) { pinned[k] = null; return; }
          if (f.planted && pinned[k]) slip = Math.max(slip, Math.hypot(f.wx - pinned[k][0], f.wz - pinned[k][1]));
          if (!f.planted && pinned[k]) stepsTaken++;
          pinned[k] = f.planted ? (pinned[k] || [f.wx, f.wz]) : null;
        });
        moved = Math.max(moved, Math.hypot(w.x - x0, w.z - z0));
      }
      check('links stay within 2% of rest length', linkErr < 0.02, { linkErr });
      check('angle limits hold', bendOver < 1e-6, { bendOver });
      check('a planted foot does not drift', slip < 1e-6 && (w.feet.length === 0 || stepsTaken > 4), { slip, stepsTaken });
      check('it wanders', moved > 0.3 * S.ph.scale, { moved });
      const a = S.area;
      check('it stays in the habitat', w.x > a.minX - 0.5 && w.x < a.maxX + 0.5 && w.z > a.minZ - 0.5 && w.z < a.maxZ + 0.5, { x: w.x, z: w.z, a });
      // The feet splay: every foot stands out to the side of its hip.
      const sideOk = w.R.hips.every((hp) => Math.abs(hp.foot[2]) > Math.abs(hp.off[2]) + 0.5 * w.R.legLen);
      check('the feet stand out to the sides', sideOk, w.R.hips.map((h) => [h.off[2], h.foot[2]]));
      // Food (prototype only): a click drops it; it walks over, bites, chews, swallows; hunger falls.
      w.hunger = 0.9;
      const r = stage.getBoundingClientRect(), h = w.chain.joints[0], d = C.dirOf(w.chain.angles[0]);
      const spot = toScreen(Math.max(a.minX, Math.min(a.maxX, h[0] + d[0] * 1.2 * S.ph.scale)), Math.max(a.minZ, Math.min(a.maxZ, h[1] + d[1] * 1.2 * S.ph.scale)));
      stage.dispatchEvent(new MouseEvent('click', { clientX: r.left + spot[0] / STAGE_W * r.width, clientY: r.top + spot[1] / STAGE_H * r.height, bubbles: true }));
      const meal = S.foods[S.foods.length - 1];
      check('a click drops food on the floor', !!meal && meal.bites > 0, meal && { x: meal.x, z: meal.z });
      let ate = false, bites = 0, swallows = 0, chewed = false, drew = 0;
      const hungerBefore = w.hunger;
      for (let i = 0; i < 60 * 40 && !ate; i++) {
        meal.age = DROP_TIME;
        const st = M2.step(w, 1 / 60, S.area, null, { walk: true, food: foodFor(w) });
        if (st.pose.mouthOpen > 0.3) chewed = true;
        for (const e of st.events) { if (e.type === 'bite') bites++; if (e.type === 'swallow') swallows++; if (e.type === 'happy') ate = true; }
        if (st.pose.swallow > 0.2 && st.pose.swallow < 0.8 && !drew) { S.out = st; frame(0); drew = 1; } // the lump going down draws
      }
      check('it eats dropped food and hunger falls', ate && meal.gone && bites === FOODS[meal.kind].bites && swallows > 0 && chewed && w.hunger < hungerBefore,
        { ate, bites, swallows, chewed, gone: meal.gone, hunger: [hungerBefore, w.hunger] });
      // Every style draws the creature (non-empty), and each differently.
      M2.place(w, 0, (a.minZ + a.maxZ) / 2, 0.4);
      const still = M2.step(w, 0, S.area, null, { walk: false });
      const styleHashes = new Set(), blank = [];
      const cc = makeCanvas(STAGE_W, STAGE_H), cctx = cc.getContext('2d');
      for (const b of $('looks').children) {
        b.click();
        cctx.clearRect(0, 0, STAGE_W, STAGE_H);
        TD.draw(cctx, w, VIEW, { style: S.style, sun: S.sun, out: still, pixel: PIXEL, canvas: makeCanvas });
        const px = pixels(cc), n = opaque(px);
        if (n < 1500) blank.push(S.style + ' ' + n);
        styleHashes.add(hash(px));
      }
      check('each style draws non-empty pixels', blank.length === 0 && styleHashes.size === STYLES.length, { blank, distinct: styleHashes.size });
      $('looks').children[0].click();
      // Every habitat draws, each differently; the pond keeps the creature off the water.
      const habs = new Set();
      for (const b of $('habitats').children) { b.click(); S.out = still; frame(0); habs.add(hash(pixels(stage))); }
      check('each habitat draws', habs.size === HAB.LIST.length && HAB.LIST.length === 4, { habitats: HAB.LIST.length, distinct: habs.size });
      setHabitat('water');
      check('the pond keeps it on land', S.area.minZ > baseArea().minZ + 0.3, { minZ: S.area.minZ, base: baseArea().minZ });
      setHabitat('grass');
      // Light: the shadow falls away from the sun and the night is darker.
      const sl = TD.shadowOffset(LT.sunAt(LT.NAMED.left), 1), sr = TD.shadowOffset(LT.sunAt(LT.NAMED.right), 1), sn = TD.shadowOffset(LT.sunAt(LT.NAMED.noon), 1);
      check('shadow falls away from the sun, longer when it is low', sl[0] > 0 && sr[0] < 0 && Math.hypot(sl[0], sl[1]) > 2 * Math.hypot(sn[0], sn[1]), { left: sl, noon: sn, right: sr });
      const sum = (dd) => { let s = 0; for (let i = 0; i < dd.length; i += 4) s += dd[i] + dd[i + 1] + dd[i + 2]; return s; };
      setTime(LT.NAMED.noon); frame(0); const noon = sum(pixels(stage));
      setTime(LT.NAMED.night); frame(0); const night = sum(pixels(stage));
      check('night tints the scene darker', night < noon * 0.85, { noon, night });
      setTime(LT.NAMED.morning);
      // The skeleton overlay draws.
      frame(0); const plain = hash(pixels(stage));
      S.skeleton = true; frame(0); const bones = hash(pixels(stage)); S.skeleton = false;
      check('skeleton overlay draws', plain !== bones);
      // Frame time: a full frame (habitat, creature, tint) for each style.
      const times = [];
      for (const st of ['original', 'cel', 'pixel']) {
        setStyle(st);
        const t0 = performance.now();
        for (let i = 0; i < 20; i++) frame(1 / 60);
        times.push((performance.now() - t0) / 20);
      }
      setStyle('original');
      check('frame time is reasonable', times.every((ms) => ms < 40), { ms: times.map((x) => Math.round(x * 100) / 100) });
      frame(0);
    } catch (e) { check('no errors', false, String(e && e.stack || e)); }
    const pass = checks.every((c) => c.pass);
    $('result').textContent = JSON.stringify({ checks, pass, seed });
  }
})();
