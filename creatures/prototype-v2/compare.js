/* Creatures compare lab, the page (compare.html). Three columns on one clock: version 1 (rings plus limbs), version 2
   (argonaut's chain, 3/4 view) and version 3 (the same chain from straight above). The pure part (scenarios, steering,
   food, measures, verdicts) is lab.js; the cost benchmark and the sprite helpers are bench.js; the measured results
   table reads compare-results.js (made by tools/compare-results.js). This file draws, plays, scrubs, feeds, rolls new
   creatures, switches the debug drawings and records the filmstrip.
   Debug drawings come in groups (bones, joints, body outline, feet, gait meters, trails, path, labels, shadow, floor
   grid), one set per column plus a master switch, all off at first; the choice is remembered in this browser.
   Query: seed, level, scenario, style (gochi|cel|pixel), speed (0.1..2), t (start paused at t seconds), body
   (own|legs-2|legs-4|legs-6|legs-8), s1 s2 s3 (a column's own seed; lock=0), debug=1 (every drawing on), m1 m2 m3
   (1 or 0: a column's drawings), trails (1|0), feed (seconds: feed all three then), test=1 (self-checks into
   <pre id="result">), film=1 (records the filmstrip on load). */
(function () {
  'use strict';
  const R = window.CreatureRender, B = window.CreatureBody, M1 = window.CreatureMotion, Lab = window.CreatureLab;
  const BN = window.CreatureBench, TD = window.CreatureTopdown || null, LT = window.CreatureLight || null;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const TEST = params.get('test') === '1';

  const W = BN.W, H = BN.H, K = BN.K;       // the low-res stage (pixel art), and the overlay's scale over it
  const PITCH = BN.PITCH, CP = Math.cos(PITCH), SP = Math.sin(PITCH);
  const BODY_PX = BN.BODY_PX;                // a body length is this many stage pixels
  const KINDS = ['v1', 'v2', 'v3'];
  const NAMES = { v1: 'Version 1', v2: 'Version 2', v3: 'Version 3' };
  const STYLES = ['gochi', 'cel', 'pixel'];
  const COL = {
    link: '#f4f1ff', joint: 'rgba(143,211,255,0.75)', head: '#3fd8ff', wedge: 'rgba(178,140,255,0.16)', wedgeLine: 'rgba(178,140,255,0.55)',
    limit: 'rgba(255,107,107,0.5)', target: '#ffc857', planted: '#6be38f', swing: '#ff9f43', ring: 'rgba(143,211,255,0.8)', hip: '#ff7ad9',
    trail: 'rgba(255,224,102,0.75)', left: '#9fd8ff', right: '#ffb3d9', path: 'rgba(255,255,255,0.32)', goal: '#ff6b6b', text: 'rgba(255,255,255,0.92)',
    // the floor and its grid are solid colours (no see-through ink when the debug drawings are off)
    floor: '#34304a', grid: '#3e3a53', gridMajor: '#474360',
    berry: '#d9434f', berryDark: '#9e2533', berryLight: '#ff9aa3', leaf: '#5fb85a',
  };
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The debug drawings, in groups. Every group is off until switched on.
  const GROUPS = [
    { id: 'bones', name: 'Bones', key: 'b' },
    { id: 'joints', name: 'Joints & hips', key: 'j' },
    { id: 'body', name: 'Body outline', key: 'o' },
    { id: 'feet', name: 'Feet & steps', key: 'f' },
    { id: 'gait', name: 'Gait meters', key: 'g' },
    { id: 'trails', name: 'Trails', key: 't' },
    { id: 'path', name: 'Path & target', key: 'p' },
    { id: 'labels', name: 'Labels', key: 'l' },
    { id: 'shadow', name: 'Shadow', key: 's' },
    { id: 'grid', name: 'Floor grid', key: 'r' },
  ];
  // How each version eats (each keeps its own technique; the berry and the moment it lands are the same).
  const HOW_IT_EATS = {
    v1: 'Walks to a spot a neck\'s length away, stops, pivots on the spot to face it, lowers its head and bites',
    v2: 'Steers its head to the berry and the chain follows; stops with the mouth over it, turns the head the last bit, the front of the chain dips',
    v3: 'Version 2\'s way, seen from above: the head leads, the body curves after it',
  };

  // ---------- state ----------
  const allOff = () => Object.fromEntries(GROUPS.map((g) => [g.id, false]));
  const S = {
    seed: params.get('seed') || 'moss', level: Number(params.get('level') || 100), scenario: params.get('scenario') || 's-curve',
    style: params.get('style') || 'gochi', speed: Number(params.get('speed') || 1), playing: !params.get('t') && !TEST, loop: true,
    ov: { v1: allOff(), v2: allOff(), v3: allOff() }, lock: true, rollLook: true, body: 'own', seeds: {}, history: [],
    clicks: [], feeds: [], run: null, px: 0, boxes: {}, pulses: [], prevPlanted: {}, drawMs: {}, lastPanel: 0, live: null,
  };
  const STORE = 'creatures-compare-lab';
  function load() {
    if (TEST) return;
    try {
      const v = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!v) return;
      for (const k of KINDS) if (v.ov && v.ov[k]) for (const g of GROUPS) S.ov[k][g.id] = !!v.ov[k][g.id];
      if (typeof v.lock === 'boolean') S.lock = v.lock;
      if (typeof v.rollLook === 'boolean') S.rollLook = v.rollLook;
      if (v.body && Lab.BODIES.some((b) => b.id === v.body)) S.body = v.body;
    } catch (e) { /* private mode or blocked storage: start with the defaults */ }
  }
  function save() {
    if (TEST) return;
    try { localStorage.setItem(STORE, JSON.stringify({ ov: S.ov, lock: S.lock, rollLook: S.rollLook, body: S.body })); } catch (e) { /* not kept */ }
  }
  load();
  // The address wins over what was remembered (and keeps the old m1/m2/m3 and trails switches working).
  if (params.get('debug') === '1') for (const k of KINDS) for (const g of GROUPS) S.ov[k][g.id] = true;
  if (params.get('debug') === '0') for (const k of KINDS) S.ov[k] = allOff();
  KINDS.forEach((k, i) => { const m = params.get('m' + (i + 1)); if (m != null) for (const g of GROUPS) if (!['trails', 'path', 'shadow', 'grid'].includes(g.id)) S.ov[k][g.id] = m !== '0'; });
  if (params.get('trails') != null) for (const k of KINDS) S.ov[k].trails = params.get('trails') !== '0';
  if (params.get('body')) S.body = Lab.bodyById(params.get('body')).id;
  if (params.get('lock') === '0' || KINDS.some((k, i) => params.get('s' + (i + 1)))) S.lock = false;
  KINDS.forEach((k, i) => { S.seeds[k] = S.lock ? S.seed : params.get('s' + (i + 1)) || S.seed; });

  const cols = {};
  for (const k of KINDS) {
    const stage = $('stage-' + k), over = $('over-' + k);
    cols[k] = { stage, over, sctx: stage.getContext('2d'), octx: over.getContext('2d'), sprite: document.createElement('canvas') };
    stage.width = W; stage.height = H; over.width = W * K; over.height = H * K;
    cols[k].spctx = cols[k].sprite.getContext('2d');
  }
  const on = (k, g) => S.ov[k][g];

  // ---------- the run ----------
  const kindsHere = () => KINDS.filter((k) => k !== 'v3' || TD);
  const sameSeeds = () => kindsHere().every((k) => String(S.seeds[k]) === String(S.seed));
  function newRun() {
    const run = Lab.createRun({ scenario: S.scenario, seed: S.seed, level: S.level, kinds: kindsHere(), topRig: TD && TD.rig,
      clicks: S.clicks, feeds: S.feeds, body: S.body, seeds: sameSeeds() ? null : S.seeds });
    run.cam = camTarget(run);
    S.run = run;
    S.px = Lab.bodyLength(run.ph) / BODY_PX;
    S.pulses = []; S.prevPlanted = {};
    const a1 = actor('v1', run), a2 = actor('v2', run);
    S.boxes.v1 = BN.spriteBox(R.withShadow(B.build(a1.ph, {})), S.px);
    S.boxes.v2 = BN.spriteBox(R.withShadow(window.CreatureChain.scene(a2.ph, a2.w.R, {})), S.px);
    for (const k of ['v1', 'v2']) { cols[k].sprite.width = S.boxes[k].w; cols[k].sprite.height = S.boxes[k].h; }
    $('scrub').max = String(run.scn.seconds);
    $('about').textContent = run.scn.about;
    $('followHint').hidden = !run.scn.follow;
    $('feedHint').hidden = !!run.scn.follow;
    stepRun(); // one step so every version has a pose to draw at the start
    return run;
  }
  const actor = (k, run) => (run || S.run).actors.find((a) => a.kind === k);
  function camTarget(run) {
    let x = 0, z = 0;
    for (const a of run.actors) { x += a.w.x; z += a.w.z; }
    return { x: x / run.actors.length, z: z / run.actors.length };
  }
  // One fixed step for everyone, then the shared camera eases toward the creatures (deterministic, so a scrub lands
  // on the same picture).
  function stepRun() {
    const run = S.run;
    Lab.step(run);
    const c = camTarget(run);
    run.cam.x += (c.x - run.cam.x) * 0.06; run.cam.z += (c.z - run.cam.z) * 0.06;
    // step triggers: a foot that was down and is now up
    for (const a of run.actors) {
      const was = S.prevPlanted[a.kind] || [], now = a.out.feetState;
      now.forEach((p, i) => { if (was[i] && !p && a.legs[i]) S.pulses.push({ kind: a.kind, x: a.legs[i].end[0], z: a.legs[i].end[1], t0: run.t }); });
      S.prevPlanted[a.kind] = now.slice();
    }
    S.pulses = S.pulses.filter((p) => run.t - p.t0 < 0.6);
  }
  function seek(t) {
    t = Math.max(0, t);
    if (!S.run || t < S.run.t - 1e-9) newRun();
    let guard = 0;
    while (S.run.t < t - 1e-9 && guard++ < 20000) stepRun();
  }
  // Still busy with food: the scenario does not loop round until every column has finished its meal.
  const busyEating = () => S.run.actors.some((a) => a.food || a.w.mode === 'eat');

  // ---------- 3/4 projection (versions 1 and 2) ----------
  const cam = () => S.run.cam;
  function stage(x, y, z) { return [W / 2 + (x - cam().x) / S.px, H / 2 + 8 - (y * CP - (z - cam().z) * SP) / S.px]; }
  const over = (x, y, z) => { const p = stage(x, y, z); return [p[0] * K, p[1] * K]; };

  // ---------- drawing ----------
  function drawFloor34(ctx, k) {
    ctx.fillStyle = COL.floor; ctx.fillRect(0, 0, W, H);
    if (!on(k, 'grid')) return;
    const g = Lab.bodyLength(S.run.ph) / 4, c = cam();
    const x0 = Math.floor((c.x - W / 2 * S.px) / g) - 1, x1 = Math.ceil((c.x + W / 2 * S.px) / g) + 1;
    const zr = (H / 2 + 12) * S.px / SP, z0 = Math.floor((c.z - zr) / g) - 1, z1 = Math.ceil((c.z + zr) / g) + 1;
    for (let i = x0; i <= x1; i++) { const p = stage(i * g, 0, 0); ctx.fillStyle = i % 4 ? COL.grid : COL.gridMajor; ctx.fillRect(Math.round(p[0]), 0, 1, H); }
    for (let j = z0; j <= z1; j++) { const p = stage(0, 0, j * g); ctx.fillStyle = j % 4 ? COL.grid : COL.gridMajor; ctx.fillRect(0, Math.round(p[1]), W, 1); }
  }
  function drawSprite(k, a) {
    const col = cols[k], box = S.boxes[k];
    a.scene.ph = a.ph; // the renderer takes its colours from the phenotype
    if (on(k, 'shadow')) R.withShadow(a.scene); // the floor footprint the cast shadow needs (the walkers' scenes come without it)
    const res = R.render(a.scene, BN.spriteCam(box, -a.w.th, S.px), { style: S.style, shadow: on(k, 'shadow') });
    const img = col.spctx.createImageData(res.w, res.h);
    img.data.set(res.rgba);
    col.spctx.putImageData(img, 0, 0);
    const p = stage(a.w.x, 0, a.w.z);
    col.sctx.drawImage(col.sprite, Math.round(p[0]) - box.w / 2, Math.round(p[1]) - box.ground);
  }
  // The berry (prototype only): three red berries and a leaf on the floor, smaller after each bite, gone once swallowed.
  function drawBerry(ctx, p, r) {
    const pts = [[-0.45, 0.15], [0.45, 0.15], [0, -0.35]];
    for (const q of pts) {
      ctx.fillStyle = COL.berryDark; ctx.beginPath(); ctx.arc(p[0] + q[0] * r, p[1] + q[1] * r + 0.12 * r, 0.62 * r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COL.berry; ctx.beginPath(); ctx.arc(p[0] + q[0] * r, p[1] + q[1] * r, 0.58 * r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COL.berryLight; ctx.fillRect(Math.round(p[0] + (q[0] - 0.2) * r), Math.round(p[1] + (q[1] - 0.25) * r), Math.max(1, Math.round(0.2 * r)), Math.max(1, Math.round(0.2 * r)));
    }
    ctx.fillStyle = COL.leaf; ctx.beginPath(); ctx.ellipse(p[0] + 0.35 * r, p[1] - 0.95 * r, 0.45 * r, 0.22 * r, -0.5, 0, Math.PI * 2); ctx.fill();
  }
  function foodSize(a) { const f = a.food; return 0.075 * a.BL * (0.45 + 0.55 * f.bites / f.maxBites); }
  function drawFood34(k, a) {
    if (!a.food || a.food.gone) return;
    drawBerry(cols[k].sctx, stage(a.food.x, 0, a.food.z), Math.max(2, foodSize(a) / S.px));
  }
  // Lines on the overlay take a projector (world x, y, z -> overlay px), so the same code draws 3/4 and top-down.
  function poly(ctx, pts, colour, width, dash) {
    if (pts.length < 2) return;
    ctx.strokeStyle = colour; ctx.lineWidth = width || 1; ctx.setLineDash(dash || []);
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.setLineDash([]);
  }
  function disc(ctx, p, r, fill, stroke) {
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function label(ctx, p, text, colour) {
    ctx.font = '600 15px system-ui, sans-serif'; ctx.fillStyle = 'rgba(20,16,30,0.8)';
    const w = ctx.measureText(text).width;
    ctx.fillRect(p[0] - 3, p[1] - 14, w + 6, 18);
    ctx.fillStyle = colour || COL.text; ctx.fillText(text, p[0], p[1]);
  }
  // A horizontal circle on the floor (or at height y) of radius r around (x, z).
  function groundCircle(P, x, y, z, r, n) {
    const out = [];
    for (let i = 0; i <= (n || 28); i++) { const t = i / (n || 28) * Math.PI * 2; out.push(P(x + Math.cos(t) * r, y, z + Math.sin(t) * r)); }
    return out;
  }

  function drawTrails(ctx, a, P) {
    poly(ctx, a.trail.map((q) => P(q[0], 0, q[1])), COL.trail, 1.5);
    for (const f of a.footTrail) { const p = P(f[0], 0, f[1]); ctx.fillStyle = f[2] % 2 ? COL.right : COL.left; ctx.globalAlpha = 0.55; ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2); }
    ctx.globalAlpha = 1;
  }
  function drawPathAndGoal(ctx, P) {
    const run = S.run;
    if (run.path) {
      const pts = [];
      for (let i = 0; i < run.path.pts.length; i += 3) pts.push(P(run.path.pts[i][0], 0, run.path.pts[i][1]));
      poly(ctx, pts, COL.path, 1, [4, 4]);
    }
    const tg = Lab.targetAt(run, run.t);
    if (tg) { poly(ctx, groundCircle(P, tg.x, 0, tg.z, 0.12 * Lab.bodyLength(run.ph)), COL.goal, 2); const p = P(tg.x, 0, tg.z); poly(ctx, [[p[0] - 5, p[1]], [p[0] + 5, p[1]]], COL.goal, 2); poly(ctx, [[p[0], p[1] - 5], [p[0], p[1] + 5]], COL.goal, 2); }
  }
  function drawPulses(ctx, k, P) {
    for (const p of S.pulses) {
      if (p.kind !== k) continue;
      const u = (S.run.t - p.t0) / 0.6, r = Lab.bodyLength(S.run.ph) * (reduced ? 0.05 : 0.04 + 0.12 * u);
      ctx.globalAlpha = Math.max(0, 1 - u) * 0.9;
      poly(ctx, groundCircle(P, p.x, 0, p.z, r, 20), COL.target, 1.5);
      ctx.globalAlpha = 1;
    }
  }

  // Version 1's machinery: the rings its body is made of, the hips the limbs hang from, the gait clock, where each
  // foot is planted or swinging to.
  function machinery1(ctx, a, P) {
    const k = a.kind, sc = a.scene, w = a.w, toW = (p) => { const q = M1.toWorld(w, p[0], p[2]); return P(q[0], p[1], q[1]); };
    const rings = sc.prims.filter((p) => (p.piece === 'torso' || p.piece === 'neck' || p.piece === 'tail') && p.k === B.CONE);
    const spine = [];
    for (const pr of rings) {
      if (on(k, 'body')) {
        const ax = B.v.norm(B.v.sub(pr.b, pr.a));
        let e1 = B.v.cross(ax, [0, 1, 0]); if (B.v.len(e1) < 1e-6) e1 = [0, 0, 1]; e1 = B.v.norm(e1);
        const e2 = B.v.cross(e1, ax), pts = [];
        for (let i = 0; i <= 20; i++) { const t = i / 20 * Math.PI * 2; pts.push(toW(B.v.add(pr.a, B.v.add(B.v.mul(e1, Math.cos(t) * pr.r1), B.v.mul(e2, Math.sin(t) * pr.r1 * (pr.sy || 1)))))); }
        poly(ctx, pts, COL.ring, 1);
      }
      spine.push(toW(pr.a));
    }
    if (rings.length) spine.push(toW(rings[rings.length - 1].b));
    if (on(k, 'bones')) poly(ctx, spine, 'rgba(143,211,255,0.6)', 1.5, [3, 3]);
    drawLegs(ctx, a, P);
    const st = a.out;
    // the body turns round this point when it pivots
    if (on(k, 'joints') && st.pivot) { const p = P(st.pivot[0], 0, st.pivot[1]); poly(ctx, [[p[0] - 4, p[1] - 4], [p[0] + 4, p[1] + 4]], COL.hip, 1.5); poly(ctx, [[p[0] - 4, p[1] + 4], [p[0] + 4, p[1] - 4]], COL.hip, 1.5); }
    if (on(k, 'gait')) gaitDial(ctx, st.gait, st.feetState, on(k, 'labels'));
    // name the parts once: the head it is steered by and the first hip the limbs hang from
    if (on(k, 'labels')) {
      const hd = M1.toWorld(w, w.mouthX, 0), hp = P(hd[0], 0.25 * a.BL, hd[1]);
      label(ctx, [hp[0] + 10, hp[1] - 12], 'head', COL.head);
      if (a.legs[0]) { const q = P(a.legs[0].hip[0], sc.legs ? sc.legs[0].hip[1] : 0.15 * a.BL, a.legs[0].hip[1]); label(ctx, [q[0] + 8, q[1] + 18], 'hip', COL.hip); }
    }
  }
  // The legs: bones, hips, and the feet (green planted, orange in the air, an orange cross where a swing will land).
  function drawLegs(ctx, a, P) {
    const k = a.kind, legs = a.legs, out = a.out, sc = a.scene;
    legs.forEach((lg, i) => {
      const yHip = sc && sc.legs ? sc.legs[i].hip[1] : 0.6 * a.w.R.legLen, yKnee = sc && sc.legs ? sc.legs[i].knee[1] : 0.4 * a.w.R.legLen;
      const hip = P(lg.hip[0], yHip, lg.hip[1]), knee = P(lg.knee[0], yKnee, lg.knee[1]), foot = P(lg.end[0], lg.y, lg.end[1]);
      if (on(k, 'bones')) poly(ctx, [hip, knee, foot], 'rgba(255,255,255,0.85)', 1.5);
      if (on(k, 'joints')) { ctx.fillStyle = COL.hip; ctx.fillRect(hip[0] - 2.5, hip[1] - 2.5, 5, 5); }
      if (!on(k, 'feet')) return;
      const planted = out.feetState[i];
      const g = P(lg.end[0], 0, lg.end[1]);
      if (planted) poly(ctx, groundCircle(P, lg.end[0], 0, lg.end[1], 0.035 * a.BL, 14), COL.planted, 2);
      disc(ctx, g, 2.5, planted ? COL.planted : COL.swing);
      const t = out.targets && out.targets[i];
      if (t && k === 'v1') { const q = M1.toWorld(a.w, t[0], t[2]), p = P(q[0], 0, q[1]); poly(ctx, [[p[0] - 3, p[1] - 3], [p[0] + 3, p[1] + 3]], COL.swing, 1.5); poly(ctx, [[p[0] - 3, p[1] + 3], [p[0] + 3, p[1] - 3]], COL.swing, 1.5); }
    });
  }
  // Version 1's gait clock: one ring per leg, green where that foot is on the ground in the cycle; the hand is now.
  function gaitDial(ctx, g, planted, named) {
    const cx = W * K - 44, cy = 44, n = g.offsets.length;
    disc(ctx, [cx, cy], 32, 'rgba(20,16,30,0.7)');
    for (let i = 0; i < n; i++) {
      const r = 10 + i * (18 / Math.max(1, n - 1 || 1));
      const a0 = -Math.PI / 2 + g.offsets[i] * 2 * Math.PI, a1 = a0 + g.duty * 2 * Math.PI;
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,159,67,0.4)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = planted[i] ? COL.planted : 'rgba(107,227,143,0.55)'; ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
    }
    const h = -Math.PI / 2 + g.phase * 2 * Math.PI;
    poly(ctx, [[cx, cy], [cx + Math.cos(h) * 30, cy + Math.sin(h) * 30]], '#ffffff', 1.5);
    if (named) label(ctx, [cx - 40, cy + 52], 'gait clock');
  }

  // Versions 2 and 3's machinery: the chain (joints, their radii, the fixed link lengths), the angle each link may bend
  // (wedges, red at the limit), the head that is steered, each foot's wanted spot and the stride-behind circle.
  function machinery2(ctx, a, P, top) {
    const k = a.kind, w = a.w, R = w.R, A = w.chain.angles, n = w.chain.joints.length;
    const joints = a.out.pose.joints, y = (i) => (top ? 0 : joints[i].y);
    const at = (i) => { const q = M1.toWorld(w, joints[i].x, joints[i].z); return [q[0], y(i), q[1]]; };
    if (on(k, 'body')) {
      // angle-limit wedges: from joint i-1, the directions joint i may lie in
      for (let i = 1; i < n; i++) {
        const c = at(i - 1), back = A[i - 1] + Math.PI, lim = R.bend[i], rr = R.links[i] * 1.15;
        const atLimit = Math.abs(C_wrap(A[i] - A[i - 1])) > lim * 0.96;
        const pts = [P(c[0], c[1], c[2])];
        for (let j = 0; j <= 10; j++) { const t = back - lim + 2 * lim * j / 10; pts.push(P(c[0] + Math.cos(t) * rr, c[1], c[2] - Math.sin(t) * rr)); }
        ctx.beginPath(); pts.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
        ctx.fillStyle = atLimit ? COL.limit : COL.wedge; ctx.fill();
        ctx.strokeStyle = COL.wedgeLine; ctx.lineWidth = 0.6; ctx.stroke();
      }
      // joint radii (the video's circles)
      for (let i = 0; i < n; i++) { const c = at(i); poly(ctx, groundCircle(P, c[0], c[1], c[2], R.joints[i].w, 20), COL.joint, 1); }
    }
    // the links
    if (on(k, 'bones')) poly(ctx, Array.from({ length: n }, (_, i) => { const c = at(i); return P(c[0], c[1], c[2]); }), COL.link, 1.5);
    const h = at(0);
    if (on(k, 'joints')) {
      for (let i = 0; i < n; i++) { const c = at(i); disc(ctx, P(c[0], c[1], c[2]), i === 0 ? 3.5 : 2, i === 0 ? COL.head : COL.link); }
      // the head is the only part that is steered: its heading
      const L = 0.3 * a.BL, tip = P(h[0] + Math.cos(A[0]) * L, h[1], h[2] - Math.sin(A[0]) * L);
      poly(ctx, [P(h[0], h[1], h[2]), tip], COL.head, 2);
    }
    // feet: wanted spot and the circle a foot may fall behind by before it steps
    if (on(k, 'feet')) for (const r of Lab.stepRings(a)) {
      const c = P(r.wanted[0], 0, r.wanted[1]);
      poly(ctx, groundCircle(P, r.wanted[0], 0, r.wanted[1], r.radius, 24), r.behind > 0.85 ? COL.target : 'rgba(255,200,87,0.55)', r.behind > 0.85 ? 1.6 : 1, [3, 3]);
      ctx.fillStyle = COL.target; ctx.fillRect(c[0] - 1.5, c[1] - 1.5, 3, 3);
      if (r.planted) poly(ctx, [P(r.foot[0], 0, r.foot[1]), c], 'rgba(255,200,87,0.6)', 1);
    }
    drawLegs(ctx, a, P);
    if (on(k, 'gait')) behindBars(ctx, a, on(k, 'labels'));
    // name the part once, near the head
    if (on(k, 'labels')) { const hp = P(h[0], h[1], h[2]); label(ctx, [hp[0] + 10, hp[1] - 12], 'head (steered)', COL.head); }
  }
  const C_wrap = (x) => x - 2 * Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI));
  // Versions 2 and 3 have no clock: each foot steps when it falls a stride behind. The bars show how far behind each
  // foot is; at the line it steps.
  function behindBars(ctx, a, named) {
    const rings = Lab.stepRings(a), n = rings.length;
    if (!n) return;
    ctx.font = '600 15px system-ui, sans-serif';
    const tw = named ? ctx.measureText('how far behind').width : 0, bw = Math.max(n * 9 + 4, tw);
    const x0 = W * K - 12 - bw + (bw - n * 9) / 2, y0 = 12, h = 46;
    ctx.fillStyle = 'rgba(20,16,30,0.7)'; ctx.fillRect(W * K - 18 - bw, y0 - 4, bw + 12, h + (named ? 26 : 8));
    rings.forEach((r, i) => {
      const v = Math.min(1.25, r.behind), bh = v / 1.25 * h;
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x0 + i * 9, y0, 6, h);
      ctx.fillStyle = r.planted ? (r.behind > 0.85 ? COL.target : COL.planted) : COL.swing; ctx.fillRect(x0 + i * 9, y0 + h - bh, 6, bh);
    });
    const ly = y0 + h - h / 1.25;
    poly(ctx, [[x0 - 4, ly], [x0 + n * 9, ly]], '#ffffff', 1, [2, 2]);
    if (named) label(ctx, [W * K - 12 - bw, y0 + h + 18], 'how far behind');
  }

  // ---------- the columns ----------
  function drawColumn34(k) {
    const a = actor(k), col = cols[k];
    const t0 = performance.now();
    drawFloor34(col.sctx, k);
    drawFood34(k, a);
    drawSprite(k, a);
    const ctx = col.octx;
    ctx.clearRect(0, 0, W * K, H * K);
    if (on(k, 'path')) drawPathAndGoal(ctx, over);
    if (on(k, 'trails')) drawTrails(ctx, a, over);
    if (on(k, 'feet')) drawPulses(ctx, k, over);
    if (k === 'v1') machinery1(ctx, a, over); else machinery2(ctx, a, over, false);
    S.drawMs[k] = performance.now() - t0;
  }
  // Version 3 draws itself from above (topdown.js) straight onto the overlay-sized canvas.
  function drawColumnTop() {
    const a = actor('v3'), col = cols.v3;
    if (!a) return;
    const t0 = performance.now();
    const sc = K / S.px, c = cam();
    const P = (x, y, z) => [W * K / 2 + (x - c.x) * sc, H * K / 2 + (z - c.z) * sc];
    col.sctx.clearRect(0, 0, W, H);
    const ctx = col.octx;
    ctx.fillStyle = COL.floor; ctx.fillRect(0, 0, W * K, H * K);
    if (on('v3', 'grid')) {
      const g = Lab.bodyLength(S.run.ph) / 4, x0 = Math.floor((c.x - W * K / 2 / sc) / g) - 1, x1 = Math.ceil((c.x + W * K / 2 / sc) / g) + 1;
      const z0 = Math.floor((c.z - H * K / 2 / sc) / g) - 1, z1 = Math.ceil((c.z + H * K / 2 / sc) / g) + 1;
      for (let i = x0; i <= x1; i++) { const p = P(i * g, 0, 0); ctx.fillStyle = i % 4 ? COL.grid : COL.gridMajor; ctx.fillRect(Math.round(p[0]), 0, 1, H * K); }
      for (let j = z0; j <= z1; j++) { const p = P(0, 0, j * g); ctx.fillStyle = j % 4 ? COL.grid : COL.gridMajor; ctx.fillRect(0, Math.round(p[1]), W * K, 1); }
    }
    if (on('v3', 'path')) drawPathAndGoal(ctx, P);
    if (on('v3', 'trails')) drawTrails(ctx, a, P);
    if (a.food && !a.food.gone) drawBerry(ctx, P(a.food.x, 0, a.food.z), foodSize(a) * sc);
    TD.draw(ctx, a.w, { scale: sc, ox: W * K / 2 - c.x * sc, oy: H * K / 2 - c.z * sc },
      { style: S.style === 'gochi' ? 'original' : S.style, sun: LT ? LT.sunAt(0.42) : null, time: S.run.t, skeleton: false, shadow: on('v3', 'shadow'), out: a.out });
    if (on('v3', 'feet')) drawPulses(ctx, 'v3', P);
    machinery2(ctx, a, P, true);
    S.drawMs.v3 = performance.now() - t0;
  }
  function draw() {
    drawColumn34('v1'); drawColumn34('v2'); drawColumnTop();
    $('time').textContent = S.run.t.toFixed(2) + ' s';
    $('scrub').value = String(Math.min(S.run.t, S.run.scn.seconds));
    for (const a of S.run.actors) { const st = Lab.eatingState(a), el = $('state-' + a.kind); if (el.textContent !== st.text) { el.textContent = st.text; el.dataset.stage = st.stage; } }
    const nowMs = performance.now();
    if (!S.playing || nowMs - S.lastPanel > 250) { S.lastPanel = nowMs; panels(); }
  }

  // ---------- numbers and the "what is different" panel ----------
  const f1 = (x) => (x == null ? '–' : x.toFixed(x < 10 ? 2 : 1));
  function mealRows(a) {
    const meals = a.meals, done = meals.filter((m) => m.done != null), last = meals[meals.length - 1];
    const eating = a.w.mode === 'eat' ? ' (eating now)' : a.food ? ' (on its way)' : '';
    return [
      ['Eating', null, ''],
      ['Meals', meals.length ? done.length + ' of ' + meals.length + ' eaten' + eating : 'none yet: press Feed', 'berries dropped and eaten in this run'],
      ['Reached the food in', last && last.reach != null ? (last.reach - last.drop).toFixed(1) + ' s' : '–', 'from the drop to the first bite: noticing, turning, walking'],
      ['Ate it in', last && last.swallow != null ? (last.swallow - last.reach).toFixed(1) + ' s' : '–', 'lowering the head, two bites, chewing, the swallow'],
      ['How it eats', HOW_IT_EATS[a.kind], 'the technique each version keeps'],
    ];
  }
  function panels() {
    const d = Lab.differences(S.run);
    for (const a of S.run.actors) {
      const s = Lab.summary(a.meter), el = $('nums-' + a.kind);
      const rows = [
        ['Walking', null, ''],
        ['Foot slide', a.ph.legs.pairs ? s.footSlide.toFixed(1) + '% avg · ' + s.footSlideMax.toFixed(1) + '% max' : 'no legs', 'how far a foot on the floor drifts before it lifts, as % of a body length'],
        ['Hip jitter', s.hipJitter.toFixed(2) + ' ‰', 'how much the hips change speed from frame to frame (thousandths of a body length); lower is smoother'],
        ['Step timing spread', s.strideCV == null ? 'not enough steps' : s.strideCV.toFixed(0) + '% (' + s.steps + ' steps)', 'how much the time between one foot\'s steps varies at a steady walk; a clock gives 0'],
        ['Tightest turn', s.tightestTurn == null ? 'not yet' : s.tightestTurn < 0.05 ? 'on the spot' : f1(s.tightestTurn) + ' body', 'radius of the tightest 45° of turning so far'],
        ['Turning now', s.turnNow == null ? 'straight' : f1(s.turnNow) + ' body', 'radius over the last 45° of turning'],
        ['Leg crossings', String(s.crossings), 'times two legs\' shadows crossed'],
        ['Body wobble', s.wobble.toFixed(1) + '°/s', 'jitter of the heading around its smooth turn'],
        ['Spine bend', Math.round(s.bend) + '° (max ' + Math.round(s.bendMax) + '°)', 'how much the body curves along its length'],
        ['Off the path', s.pathError == null ? '–' : f1(s.pathError) + ' body', 'mean distance of the steered point from the path'],
        ['ms per frame', s.ms.toFixed(2) + ' + draw ' + (S.drawMs[a.kind] || 0).toFixed(1), 'motion and body, plus drawing this column (debug drawings included)'],
      ].concat(mealRows(a));
      el.innerHTML = rows.map((r) => (r[1] == null ? '<tr class="group"><th colspan="2">' + r[0] + '</th></tr>' : '<tr title="' + esc(r[2]) + '"><th>' + r[0] + '</th><td>' + esc(r[1]) + '</td></tr>')).join('');
    }
    $('diffs').innerHTML = d.lines.map((l) => '<li' + (l.win ? ' class="w-' + l.win + '"' : '') + '>' + l.text + '</li>').join('') +
      (actor('v3') ? '<li>Version 3 runs version 2\'s motion (the same chain and stepping rule) with its feet set wider so they read from above: compare its columns of numbers with version 2\'s.</li>' : '');
    $('verdict').innerHTML = '<b>' + S.run.scn.name + '.</b> ' + d.byEye + ' ' + d.byNumbers;
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  // ---------- the measured results (compare-results.js, or a live run of the benchmark) ----------
  function results() { return window.CreatureCompareResults || null; }
  function renderResults() {
    const res = results(), tbl = $('resultsTable');
    if (!res) { $('resultsAbout').textContent = 'No results file yet: run node tools/compare-results.js to fill this table.'; tbl.innerHTML = ''; return; }
    const bench = S.live || res.bench, ks = KINDS.filter((k) => res.smooth.byKind[k]);
    const cell = (r, k) => (r.get(k) == null ? null : r.get(k));
    const rows = [];
    const group = (name) => rows.push({ group: name });
    group(S.live ? 'Cost, measured just now in this browser (ms per frame, average · 95th percentile)' : 'Cost in headless Chrome, CPU drawing (ms per frame, average · 95th percentile)');
    const br = (k, n) => bench.results.find((r) => r.kind === k && r.n === n);
    for (const n of bench.counts || [1, 5, 20]) {
      rows.push({ name: 'Update, ' + n + (n === 1 ? ' creature' : ' creatures'), about: 'the walker\'s step and the body it draws', get: (k) => br(k, n) && br(k, n).update.avg, fmt: (v, k) => v.toFixed(2) + ' · ' + br(k, n).update.p95.toFixed(2), low: true });
      rows.push({ name: 'Draw, ' + n + (n === 1 ? ' creature' : ' creatures'), about: 'putting them on the canvas, shadow on', get: (k) => br(k, n) && br(k, n).draw.avg, fmt: (v, k) => v.toFixed(1) + ' · ' + br(k, n).draw.p95.toFixed(1), low: true });
    }
    const big = Math.max(...(bench.counts || [20]));
    rows.push({ name: 'Share of a 60 fps frame, ' + big + ' creatures', about: 'update plus draw, against 16.7 ms', get: (k) => br(k, big) && (br(k, big).update.avg + br(k, big).draw.avg) / (1000 / 60) * 100, fmt: (v) => Math.round(v) + '%', low: true });
    const sm = res.smooth.byKind;
    group('Smoothness, ' + res.smooth.runs + ' runs (' + res.smooth.scenarios.length + ' scenarios × ' + res.smooth.seeds.length + ' creatures); lower is smoother');
    rows.push({ name: 'Foot slip, average', about: 'how far a planted foot drifts, % of a body length', get: (k) => sm[k].footSlide, fmt: (v) => v.toFixed(2) + '%', low: true });
    rows.push({ name: 'Foot slip, worst', about: 'the worst single plant, averaged over runs', get: (k) => sm[k].footSlideMax, fmt: (v) => v.toFixed(1) + '%', low: true });
    rows.push({ name: 'Hip jitter', about: 'frame-to-frame change in hip speed, ‰ of a body length', get: (k) => sm[k].hipJitter, fmt: (v) => v.toFixed(2) + ' ‰', low: true });
    rows.push({ name: 'Heading wobble', about: 'heading jitter around its smooth turn', get: (k) => sm[k].wobble, fmt: (v) => v.toFixed(1) + '°/s', low: true });
    rows.push({ name: 'Step timing spread', about: 'how much one foot\'s time between steps varies at a steady walk (stride regularity)', get: (k) => sm[k].strideCV, fmt: (v) => v.toFixed(0) + '%', low: true });
    rows.push({ name: 'Leg crossings per run', about: 'times two legs\' shadows crossed', get: (k) => sm[k].crossings, fmt: (v) => v.toFixed(1), low: true });
    rows.push({ name: 'Off the path', about: 'mean distance from the path, body lengths', get: (k) => sm[k].pathError, fmt: (v) => v.toFixed(2), low: true });
    rows.push({ name: 'Tightest turn radius', about: 'body lengths; smaller turns tighter (0 is on the spot)', get: (k) => sm[k].tightestTurn, fmt: (v) => v.toFixed(2), low: true });
    const ea = res.eating.byKind;
    group('Eating, ' + res.eating.runs + ' berries each (the same drop for every version)');
    rows.push({ name: 'Reached the berry in', about: 'seconds from the drop to the first bite', get: (k) => ea[k].reach, fmt: (v) => v.toFixed(1) + ' s', low: true });
    rows.push({ name: 'Ate it in', about: 'seconds from the first bite to the swallow', get: (k) => ea[k].eat, fmt: (v) => v.toFixed(1) + ' s', low: true });
    rows.push({ name: 'Berries eaten', about: 'meals finished within 30 s', get: (k) => ea[k].eaten, fmt: (v) => v + ' of ' + res.eating.runs, low: false });
    const head = '<thead><tr><th>Measure</th>' + ks.map((k) => '<th>' + NAMES[k] + '</th>').join('') + '</tr></thead>';
    const body = rows.map((r) => {
      if (r.group) return '<tr class="group"><th colspan="' + (ks.length + 1) + '">' + esc(r.group) + '</th></tr>';
      const vals = ks.map((k) => cell(r, k)), have = vals.filter((v) => v != null);
      const best = have.length ? (r.low ? Math.min(...have) : Math.max(...have)) : null;
      const tie = have.filter((v) => Math.abs(v - best) <= Math.abs(best) * 0.02 + 1e-9).length === have.length;
      return '<tr title="' + esc(r.about) + '"><th>' + esc(r.name) + '</th>' + ks.map((k, i) => {
        const v = vals[i];
        if (v == null) return '<td>–</td>';
        const isBest = !tie && Math.abs(v - best) <= Math.abs(best) * 0.02 + 1e-9;
        return '<td' + (isBest ? ' class="best"' : '') + '>' + esc(r.fmt(v, k)) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    tbl.innerHTML = head + '<tbody>' + body + '</tbody>';
    $('resultsAbout').textContent = 'Measured on ' + res.generated + ' (' + res.machine + '). Hover a row for what it measures. ✓ marks the best in each row (none when they are within 2%).';
    $('verdicts').innerHTML = ks.map((k) => '<li><b class="' + k + '">' + NAMES[k] + ':</b> ' + esc(res.verdict[k]) + '</li>').join('');
    $('pick').innerHTML = '<b>My pick:</b> ' + esc(res.verdict.pick);
    $('caveats').textContent = 'Caveats: ' + res.caveats.join(' ');
  }
  function benchHere() {
    const btn = $('benchHere'), st = $('benchStatus'), was = S.playing;
    btn.disabled = true; S.playing = false; syncButtons();
    st.textContent = 'Measuring…';
    BN.runAsync({ counts: [1, 5, 20], frames: 120, warm: 20, style: 'gochi' }, (i, n, r) => { st.textContent = 'Measuring… ' + i + ' of ' + n + ' (' + NAMES[r.kind] + ', ' + r.n + ')'; })
      .then((out) => {
        S.live = { counts: [1, 5, 20], results: out.results };
        st.textContent = 'Done: the cost rows now show this browser (' + out.results.length + ' runs of 120 frames, GPU as your browser has it).';
        btn.disabled = false; S.playing = was; syncButtons(); renderResults();
      });
  }

  // ---------- playback ----------
  let last = 0, acc = 0;
  function loop(now) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (S.playing) {
      acc += dt * S.speed;
      let n = 0;
      while (acc >= Lab.DT && n < 6) {
        acc -= Lab.DT; n++; stepRun();
        if (S.run.t >= S.run.scn.seconds && !busyEating()) {
          // a lap is done: the next starts clean (a meal already eaten is not served again)
          if (S.loop) { S.feeds = []; newRun(); } else { S.playing = false; syncButtons(); }
          break;
        }
      }
      if (n === 6) acc = 0;
      draw();
    }
    requestAnimationFrame(loop);
  }
  function syncButtons() { $('play').textContent = S.playing ? 'Pause' : 'Play'; }

  // ---------- filmstrip ----------
  // Ten frames, half a second apart, from now: one row per version, so the difference is there to see at once.
  function recordStrip() {
    const t0 = S.run.t, frames = 10, gap = 0.5, cw = 320, ch = 224, lw = 120, top = 48;
    const strip = document.createElement('canvas');
    strip.width = lw + frames * cw; strip.height = top + KINDS.length * ch;
    const x = strip.getContext('2d');
    x.fillStyle = '#1f1c2c'; x.fillRect(0, 0, strip.width, strip.height);
    x.font = '600 16px system-ui, sans-serif'; x.fillStyle = '#ece6f2';
    x.fillText(S.run.scn.name + ' · seed ' + (sameSeeds() ? S.seed : kindsHere().map((k) => S.seeds[k]).join(' / ')), 8, 20);
    const wasPlaying = S.playing; S.playing = false;
    for (let f = 0; f < frames; f++) {
      seek(t0 + gap * (f + 1));
      draw();
      x.fillStyle = '#ece6f2'; x.font = '15px system-ui, sans-serif'; x.fillText(S.run.t.toFixed(1) + ' s', lw + f * cw + 6, top - 8);
      KINDS.forEach((k, r) => {
        const col = cols[k], dx = lw + f * cw, dy = top + r * ch;
        x.imageSmoothingEnabled = false;
        if (k !== 'v3') x.drawImage(col.stage, dx, dy, cw, ch);
        x.imageSmoothingEnabled = true;
        x.drawImage(col.over, dx, dy, cw, ch);
        x.strokeStyle = '#000'; x.strokeRect(dx + 0.5, dy + 0.5, cw - 1, ch - 1);
      });
    }
    KINDS.forEach((k, r) => { x.fillStyle = '#ece6f2'; x.font = '600 16px system-ui, sans-serif'; x.fillText(NAMES[k], 8, top + r * ch + ch / 2); x.font = '14px system-ui, sans-serif'; x.fillStyle = '#a79fb8'; x.fillText(({ v1: 'rings + clock', v2: 'chain, 3/4', v3: 'chain, top-down' })[k], 8, top + r * ch + ch / 2 + 20); });
    seek(t0); draw();
    S.playing = wasPlaying; syncButtons();
    const url = strip.toDataURL('image/png');
    $('strip').src = url; $('stripBox').hidden = false;
    $('stripSave').href = url; $('stripSave').download = 'creatures-' + S.run.scn.id + '-' + S.seed + '.png';
    return { w: strip.width, h: strip.height, url };
  }

  // ---------- new creatures, body presets, food ----------
  // A short pronounceable seed, so it can be read out and typed back in.
  const SYL = ['mo', 'ka', 'ri', 'zu', 'pe', 'lo', 'fen', 'ta', 'vi', 'nu', 'sha', 'or', 'be', 'mi', 'gra', 'te', 'quo', 'ish'];
  function randomSeed() { const r = () => SYL[Math.floor(Math.random() * SYL.length)]; return r() + r() + '-' + (10 + Math.floor(Math.random() * 90)); }
  function remember() { S.history.push({ seed: S.seed, seeds: Object.assign({}, S.seeds), style: S.style }); if (S.history.length > 30) S.history.shift(); }
  // Global (k null) or one column. "Same creature in all three" on: one new seed for every column, whichever button.
  // Off: the global button rolls a different creature for each column, a column's own button only that column.
  function newCreatures(k) {
    remember();
    if (S.lock) { S.seed = randomSeed(); for (const q of KINDS) S.seeds[q] = S.seed; }
    else if (!k) { for (const q of KINDS) S.seeds[q] = randomSeed(); S.seed = S.seeds.v1; }
    else S.seeds[k] = randomSeed();
    if (S.rollLook && (S.lock || !k)) S.style = STYLES[Math.floor(Math.random() * STYLES.length)];
    S.clicks = []; S.feeds = [];
    restart(false);
  }
  function previous() {
    const h = S.history.pop();
    if (!h) return;
    S.seed = h.seed; S.seeds = h.seeds; S.style = h.style;
    S.clicks = []; S.feeds = [];
    restart(false);
  }
  function setLock(v) {
    S.lock = v;
    if (v) for (const q of KINDS) S.seeds[q] = S.seed;
    save(); restart(true);
  }
  function setBody(id) { S.body = Lab.bodyById(id).id; save(); restart(false); }
  function stepBody(d) { const i = Lab.BODIES.findIndex((b) => b.id === S.body), n = Lab.BODIES.length; setBody(Lab.BODIES[(i + d + n) % n].id); }
  // Feed (prototype only): a berry in front of each creature (or one column's, or on a clicked spot). It is recorded
  // with the time, so scrubbing back and forth replays it.
  function feed(k, x, z) {
    const f = { at: S.run.t, kind: k || null };
    if (x != null) { f.x = x; f.z = z; }
    S.feeds.push(f); S.run.feeds.push(f);
    if (!TEST && !S.playing) { S.playing = true; syncButtons(); }
  }

  // ---------- debug drawing switches ----------
  const anyOn = (k) => GROUPS.some((g) => S.ov[k][g.id]);
  const allOnIn = (k) => GROUPS.every((g) => S.ov[k][g.id]);
  function setGroupAll(g, v) { for (const k of KINDS) S.ov[k][g] = v; }
  function toggleGroup(g) { setGroupAll(g, !KINDS.every((k) => S.ov[k][g])); changed(); }
  function togglePanel(k) { const v = !anyOn(k); for (const g of GROUPS) S.ov[k][g.id] = v; changed(); }
  function toggleAll() { const v = !KINDS.some(anyOn); for (const k of KINDS) for (const g of GROUPS) S.ov[k][g.id] = v; changed(); }
  function changed() { save(); syncToggles(); draw(); }
  const pressed = (all, some) => (all ? 'true' : some ? 'mixed' : 'false');
  function buildToggles() {
    $('ovGlobal').innerHTML = GROUPS.map((g) => '<button type="button" class="tg" data-group="' + g.id + '" aria-pressed="false">' + esc(g.name) + '<kbd>' + g.key.toUpperCase() + '</kbd></button>').join('');
    for (const k of KINDS) {
      const row = document.querySelector('[data-ov="' + k + '"]');
      row.innerHTML = '<button type="button" class="tg master" data-panel="' + k + '" aria-pressed="false" title="Every debug drawing in this column">All<kbd>' + (KINDS.indexOf(k) + 1) + '</kbd></button>' +
        GROUPS.map((g) => '<button type="button" class="tg" data-k="' + k + '" data-g="' + g.id + '" aria-pressed="false">' + esc(g.name) + '</button>').join('');
    }
    $('bodies').innerHTML = Lab.BODIES.map((b) => '<button type="button" data-body="' + b.id + '" aria-pressed="false">' + esc(b.id === 'own' ? 'Seed\'s own' : b.name) + '</button>').join('');
  }
  function syncToggles() {
    $('ovAll').setAttribute('aria-pressed', pressed(KINDS.every(allOnIn), KINDS.some(anyOn)));
    document.querySelectorAll('[data-group]').forEach((b) => { const g = b.dataset.group; b.setAttribute('aria-pressed', pressed(KINDS.every((k) => S.ov[k][g]), KINDS.some((k) => S.ov[k][g]))); });
    document.querySelectorAll('[data-panel]').forEach((b) => { const k = b.dataset.panel; b.setAttribute('aria-pressed', pressed(allOnIn(k), anyOn(k))); });
    document.querySelectorAll('[data-k]').forEach((b) => b.setAttribute('aria-pressed', String(S.ov[b.dataset.k][b.dataset.g])));
    document.querySelectorAll('[data-body]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.body === S.body)));
    $('lock').setAttribute('aria-pressed', String(S.lock));
    $('rollLook').setAttribute('aria-pressed', String(S.rollLook));
    $('prev').disabled = !S.history.length;
    for (const k of KINDS) $('seed-' + k).textContent = 'seed ' + S.seeds[k];
    $('seedNote').hidden = sameSeeds();
  }

  // ---------- controls ----------
  function fillScenarios() {
    $('scenario').innerHTML = Lab.SCENARIOS.map((s) => '<option value="' + s.id + '">' + s.name + '</option>').join('');
    $('scenario').value = S.scenario;
  }
  function restart(keepT) {
    const t = keepT ? S.run.t : 0;
    S.run = null; seek(t); draw(); syncUrl(); syncToggles();
    $('seed').value = S.seed; $('style').value = S.style;
  }
  function syncUrl() {
    const q = new URLSearchParams();
    q.set('seed', S.seed); q.set('level', String(S.level)); q.set('scenario', S.scenario);
    if (S.style !== 'gochi') q.set('style', S.style);
    if (S.speed !== 1) q.set('speed', String(S.speed));
    if (S.body !== 'own') q.set('body', S.body);
    if (!S.lock) { q.set('lock', '0'); if (!sameSeeds()) KINDS.forEach((k, i) => q.set('s' + (i + 1), S.seeds[k])); }
    if (!TEST) history.replaceState(null, '', '?' + q);
    $('openV1').href = '../prototype/index.html?seed=' + encodeURIComponent(S.seeds.v1) + '&level=' + S.level;
    $('openV2').href = 'index.html?seed=' + encodeURIComponent(S.seeds.v2) + '&level=' + S.level;
    $('openV3').href = '../prototype-v3/index.html?seed=' + encodeURIComponent(S.seeds.v3) + '&level=' + S.level;
  }
  // The floor spot under a click on a column's view.
  function floorAt(k, e) {
    const r = cols[k].over.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * W * K, sy = (e.clientY - r.top) / r.height * H * K, c = cam();
    if (k === 'v3') { const sc = K / S.px; return [c.x + (sx - W * K / 2) / sc, c.z + (sy - H * K / 2) / sc]; }
    return [c.x + (sx / K - W / 2) * S.px, c.z + (sy / K - H / 2 - 8) * S.px / SP];
  }
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' && e.target.type !== 'range' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const g = GROUPS.find((q) => q.key === key);
    if (key === ' ') { e.preventDefault(); $('play').click(); }
    else if (key === 'n') newCreatures(null);
    else if (key === 'k') setLock(!S.lock);
    else if (key === 'e') feed(null);
    else if (key === 'd') toggleAll();
    else if (key === '1' || key === '2' || key === '3') togglePanel(KINDS[Number(key) - 1]);
    else if (key === '[') stepBody(-1);
    else if (key === ']') stepBody(1);
    else if (key === 'ArrowRight') { e.preventDefault(); $('stepF').click(); }
    else if (key === 'ArrowLeft') { e.preventDefault(); $('stepB').click(); }
    else if (g) toggleGroup(g.id);
    else return;
  }
  function bind() {
    buildToggles();
    $('seed').value = S.seed; $('level').value = String(S.level); $('style').value = S.style; $('speed').value = String(S.speed);
    $('speedOut').textContent = S.speed.toFixed(1) + '×';
    $('f').addEventListener('submit', (e) => {
      e.preventDefault(); remember();
      S.seed = $('seed').value.trim() || 'moss'; for (const k of KINDS) S.seeds[k] = S.seed;
      S.level = Math.max(1, Math.min(100, Number($('level').value) || 100)); S.clicks = []; S.feeds = []; restart(false);
    });
    $('newAll').addEventListener('click', () => newCreatures(null));
    $('prev').addEventListener('click', previous);
    $('lock').addEventListener('click', () => setLock(!S.lock));
    $('rollLook').addEventListener('click', () => { S.rollLook = !S.rollLook; save(); syncToggles(); });
    $('bodies').addEventListener('click', (e) => { const b = e.target.closest('[data-body]'); if (b) setBody(b.dataset.body); });
    document.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => newCreatures(b.dataset.new)));
    document.querySelectorAll('[data-feed]').forEach((b) => b.addEventListener('click', () => feed(b.dataset.feed)));
    $('feedAll').addEventListener('click', () => feed(null));
    $('ovAll').addEventListener('click', toggleAll);
    $('ovGlobal').addEventListener('click', (e) => { const b = e.target.closest('[data-group]'); if (b) toggleGroup(b.dataset.group); });
    document.querySelectorAll('[data-ov]').forEach((row) => row.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.panel) togglePanel(b.dataset.panel);
      else { S.ov[b.dataset.k][b.dataset.g] = !S.ov[b.dataset.k][b.dataset.g]; changed(); }
    }));
    $('scenario').addEventListener('change', () => { S.scenario = $('scenario').value; S.clicks = []; S.feeds = []; restart(false); });
    $('style').addEventListener('change', () => { S.style = $('style').value; draw(); syncUrl(); });
    $('speed').addEventListener('input', () => { S.speed = Number($('speed').value); $('speedOut').textContent = S.speed.toFixed(1) + '×'; syncUrl(); });
    $('play').addEventListener('click', () => { S.playing = !S.playing; if (S.playing && S.run.t >= S.run.scn.seconds && !busyEating()) restart(false); syncButtons(); });
    $('stepF').addEventListener('click', () => { S.playing = false; syncButtons(); stepRun(); draw(); });
    $('stepB').addEventListener('click', () => { S.playing = false; syncButtons(); seek(S.run.t - Lab.DT); draw(); });
    $('restart').addEventListener('click', () => { S.feeds = []; restart(false); });
    $('scrub').addEventListener('input', () => { S.playing = false; syncButtons(); seek(Number($('scrub').value)); draw(); });
    $('record').addEventListener('click', recordStrip);
    $('benchHere').addEventListener('click', benchHere);
    $('full').addEventListener('toggle', () => {
      if (!$('full').open) return;
      for (const [id, a] of [['fv1', 'openV1'], ['fv2', 'openV2'], ['fv3', 'openV3']]) if (!$(id).src) $(id).src = $(a).href;
    });
    // Click a view: in the follow scenario the target jumps there; otherwise a berry lands there for that column.
    // Both are replayed when scrubbing.
    for (const k of KINDS) cols[k].over.addEventListener('click', (e) => {
      const [x, z] = floorAt(k, e);
      if (!S.run.scn.follow) { feed(k, x, z); return; }
      const click = { at: S.run.t, x, z };
      S.clicks.push(click); S.run.clicks.push(click);
    });
    document.addEventListener('keydown', onKey);
  }

  // ---------- self-checks (?test=1) ----------
  function runChecks() {
    const checks = [];
    const check = (name, pass, info) => checks.push({ name, pass: !!pass, info });
    // (read through a copy made for reading, so the live canvases stay fast to draw on)
    const pixels = (cv) => {
      const copy = document.createElement('canvas'); copy.width = cv.width; copy.height = cv.height;
      const cx = copy.getContext('2d', { willReadFrequently: true }); cx.drawImage(cv, 0, 0);
      return cx.getImageData(0, 0, cv.width, cv.height).data;
    };
    const inked = (cv) => { const d = pixels(cv); let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; };
    const hash = (cv) => { const d = pixels(cv); let h = 2166136261; for (let i = 0; i < d.length; i += 7) h = Math.imul(h ^ d[i], 16777619); return h >>> 0; };
    const look = () => ({ v1s: hash(cols.v1.stage), v1o: hash(cols.v1.over), v2s: hash(cols.v2.stage), v2o: hash(cols.v2.over), v3: hash(cols.v3.over) });
    const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    check('three versions on one clock', S.run.actors.length === (TD ? 3 : 2), { actors: S.run.actors.map((a) => a.kind), topdown: !!TD });

    // debug drawings: all off at first, nothing on the overlays of versions 1 and 2, version 3 drawn without them
    seek(2); draw();
    check('debug drawings start off', KINDS.every((k) => !anyOn(k)) && $('ovAll').getAttribute('aria-pressed') === 'false', S.ov);
    check('version 1 and 2 sprites drawn', inked(cols.v1.stage) > 1000 && inked(cols.v2.stage) > 1000, {});
    check('with the drawings off the overlays of versions 1 and 2 are empty', inked(cols.v1.over) === 0 && inked(cols.v2.over) === 0, { v1: inked(cols.v1.over), v2: inked(cols.v2.over) });
    const off = look();
    $('ovAll').click();
    check('All debug turns every drawing on in every column', KINDS.every(allOnIn) && $('ovAll').getAttribute('aria-pressed') === 'true', {});
    check('with the drawings on every column shows them', inked(cols.v1.over) > 500 && inked(cols.v2.over) > 500 && hash(cols.v3.over) !== off.v3, { v1: inked(cols.v1.over), v2: inked(cols.v2.over) });
    $('ovAll').click();
    const back = look();
    check('turned off again, the picture is the same as before', JSON.stringify(back) === JSON.stringify(off), { off, back });
    // every group changes the picture on its own, in every column it applies to
    const quiet = [];
    for (const g of GROUPS) {
      for (const k of KINDS) S.ov[k][g.id] = true;
      draw();
      const now = look();
      for (const k of KINDS) S.ov[k][g.id] = false;
      const changedCols = ['v1', 'v2', 'v3'].filter((k) => (k === 'v3' ? now.v3 !== off.v3 : now[k + 's'] !== off[k + 's'] || now[k + 'o'] !== off[k + 'o']));
      if (changedCols.length < 3) quiet.push(g.id + ': ' + changedCols.join(','));
    }
    draw();
    check('every debug group draws something in every column', !quiet.length, quiet);
    // keys
    key('b');
    const bonesAll = KINDS.every((k) => S.ov[k].bones) && $('ovAll').getAttribute('aria-pressed') === 'mixed';
    key('b'); key('2');
    const panel2 = allOnIn('v2') && !anyOn('v1') && !anyOn('v3') && document.querySelector('[data-panel="v2"]').getAttribute('aria-pressed') === 'true';
    key('2');
    check('keys: B switches bones in every column, 2 one column', bonesAll && panel2 && !KINDS.some(anyOn), { bonesAll, panel2 });
    document.querySelector('[data-k="v1"][data-g="trails"]').click();
    check('a column\'s own switch only changes that column', S.ov.v1.trails && !S.ov.v2.trails && !S.ov.v3.trails, {});
    S.ov.v1.trails = false; changed();

    // new creatures
    const seed0 = S.seed;
    $('newAll').click();
    const locked = S.seed !== seed0 && S.run.actors.every((a) => a.seed === S.seed) && KINDS.every((k) => $('seed-' + k).textContent === 'seed ' + S.seed);
    check('New creatures rolls one new creature for all three', locked, { seed0, seed: S.seed, actors: S.run.actors.map((a) => a.seed) });
    const s1 = S.seed;
    key('k');
    document.querySelector('[data-new="v2"]').click();
    const own = S.run.actors.find((a) => a.kind === 'v2').seed;
    check('unlocked, a column\'s New rolls only that column', !S.lock && own !== s1 && actor('v1').seed === s1 && actor('v3').seed === s1 && !$('seedNote').hidden, { own, s1 });
    $('prev').click();
    check('Previous brings the last creatures back', S.run.actors.every((a) => a.seed === s1), S.run.actors.map((a) => a.seed));
    key('k');
    check('locking again puts the same creature in all three', S.lock && S.run.actors.every((a) => a.seed === S.seed) && $('seedNote').hidden, {});

    // body presets
    const legs = {};
    for (const b of Lab.BODIES) { if (b.pairs == null) continue; setBody(b.id); legs[b.id] = S.run.actors.map((a) => a.w.feet.length); }
    check('body presets set the legs in every version (2, 4, 6, 8)', Lab.BODIES.every((b) => b.pairs == null || legs[b.id].every((n) => n === b.pairs * 2)), legs);
    key(']');
    check('] steps to the next body', S.body === 'own', S.body);

    // feeding: every version notices, walks over and eats with its own technique; the label says so
    S.seed = 'moss'; for (const k of KINDS) S.seeds[k] = 'moss'; S.scenario = 's-curve'; S.feeds = []; restart(false);
    seek(1); $('feedAll').click();
    const seen = { v1: new Set(), v2: new Set(), v3: new Set() }, labels = new Set();
    let berry = false;
    for (let i = 0; i < 60 * 30 && S.run.actors.some((a) => a.food || a.w.mode === 'eat' || !a.meals.length); i++) {
      stepRun();
      if (i % 15 === 0) {
        draw();
        for (const a of S.run.actors) { seen[a.kind].add(Lab.eatingState(a).stage); labels.add($('state-' + a.kind).textContent); }
        if (!berry && actor('v1').food) { const d = pixels(cols.v1.stage); for (let j = 0; j < d.length; j += 4) if (d[j] === 0xd9 && d[j + 1] === 0x43 && d[j + 2] === 0x4f) { berry = true; break; } }
      }
    }
    draw();
    const ate = S.run.actors.map((a) => ({ kind: a.kind, meals: a.meals.length, done: a.meals[0] && a.meals[0].done != null, stages: [...seen[a.kind]] }));
    check('Feed: every version reaches the berry and eats it', ate.every((x) => x.done && ['go', 'bite', 'chew', 'swallow'].every((s) => seen[x.kind].has(s))), ate);
    check('the eating state is labelled under each view', [...labels].some((l) => /^Eating: bites/.test(l)) && [...labels].some((l) => /^Eating: chews/.test(l)) && KINDS.every((k) => /^Fed: /.test($('state-' + k).textContent)), [...labels]);
    check('the berry is drawn', berry, {});
    check('eating rows in the numbers table', KINDS.every((k) => /1 of 1 eaten/.test($('nums-' + k).textContent) && /How it eats/.test($('nums-' + k).textContent)), {});
    // scrubbing replays the feed
    const snap = () => S.run.actors.map((a) => [a.w.x.toFixed(6), a.w.z.toFixed(6), a.w.th.toFixed(6), a.w.mode].join(',')).join('|');
    seek(6); const at6 = snap(); seek(1); seek(6);
    check('scrubbing back and forth lands on the same frame, food and all', snap() === at6, { at6, again: snap() });
    S.feeds = []; restart(false);

    // the results table
    const res = results();
    check('measured results table with a verdict per version', !!res && $('resultsTable').querySelectorAll('tbody tr').length >= 15 && $('verdicts').children.length === 3 && /pick/i.test($('pick').textContent), { res: !!res });

    seek(2); draw();
    const d = Lab.differences(S.run);
    check('what-is-different panel has 4 to 6 lines and a verdict', d.lines.length >= 4 && d.lines.length <= 6 && /By eye/.test($('verdict').textContent), { n: d.lines.length });
    const bad = [];
    for (const s of Lab.SCENARIOS) {
      S.scenario = s.id; S.run = null; seek(1.5); draw();
      for (const a of S.run.actors) if (!isFinite(a.w.x) || !isFinite(a.w.z) || !a.out) bad.push(s.id + ':' + a.kind);
      if (s.pairs) for (const a of S.run.actors) if (a.w.feet.length !== s.pairs * 2) bad.push(s.id + ':' + a.kind + ' legs ' + a.w.feet.length);
    }
    check('every scenario runs in every version', !bad.length, bad);
    S.scenario = 'u-turn'; S.run = null; seek(1);
    const strip = recordStrip();
    check('filmstrip recorded (10 frames × 3 rows)', strip.w > 3000 && strip.h > 600 && strip.url.length > 10000, { w: strip.w, h: strip.h });
    const pass = checks.every((c) => c.pass);
    $('result').textContent = JSON.stringify({ pass, checks });
  }

  // ---------- start ----------
  fillScenarios(); bind();
  newRun();
  // feed() starts a paused lab playing; with t= the page should still open paused at that moment
  if (params.get('feed') != null) { const was = S.playing; seek(Number(params.get('feed'))); feed(null); S.playing = was; }
  seek(Number(params.get('t') || 0));
  draw(); syncUrl(); syncButtons(); syncToggles(); renderResults();
  if (TEST) runChecks();
  else {
    if (params.get('film') === '1') recordStrip();
    requestAnimationFrame(loop);
  }
})();
