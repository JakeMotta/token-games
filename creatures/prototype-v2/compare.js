/* Creatures compare lab, the page (compare.html). Three columns on one clock: version 1 (rings plus limbs), version 2
   (argonaut's chain, 3/4 view) and version 3 (the same chain from straight above). The pure part (scenarios, steering,
   measures, verdicts) is lab.js; this file draws, plays, scrubs and records the filmstrip.
   Query: seed, level, scenario, style (gochi|cel|pixel), speed (0.1..2), t (start paused at t seconds), m1 m2 m3 (0 hides
   a version's machinery), trails (0 hides them), theme, test=1 (self-checks into <pre id="result">), film=1 (records the
   filmstrip on load). */
(function () {
  'use strict';
  const R = window.CreatureRender, B = window.CreatureBody, M1 = window.CreatureMotion, Lab = window.CreatureLab;
  const TD = window.CreatureTopdown || null, LT = window.CreatureLight || null;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const TEST = params.get('test') === '1';
  if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');

  const W = 240, H = 168, K = 2;            // the low-res stage (pixel art), and the overlay's scale over it
  const PITCH = 0.45, CP = Math.cos(PITCH), SP = Math.sin(PITCH);
  const BODY_PX = 70;                        // a body length is this many stage pixels
  const KINDS = ['v1', 'v2', 'v3'];
  const COL = {
    link: '#f4f1ff', joint: 'rgba(143,211,255,0.75)', head: '#3fd8ff', wedge: 'rgba(178,140,255,0.16)', wedgeLine: 'rgba(178,140,255,0.55)',
    limit: 'rgba(255,107,107,0.5)', target: '#ffc857', planted: '#6be38f', swing: '#ff9f43', ring: 'rgba(143,211,255,0.8)', hip: '#ff7ad9',
    trail: 'rgba(255,224,102,0.75)', left: '#9fd8ff', right: '#ffb3d9', path: 'rgba(255,255,255,0.32)', goal: '#ff6b6b', text: 'rgba(255,255,255,0.88)',
    floor: '#34304a', grid: 'rgba(255,255,255,0.07)', gridMajor: 'rgba(255,255,255,0.13)',
  };
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- state ----------
  const S = {
    seed: params.get('seed') || 'moss', level: Number(params.get('level') || 100), scenario: params.get('scenario') || 's-curve',
    style: params.get('style') || 'gochi', speed: Number(params.get('speed') || 1), playing: !params.get('t') && !TEST, loop: true,
    mach: { v1: params.get('m1') !== '0', v2: params.get('m2') !== '0', v3: params.get('m3') !== '0' }, trails: params.get('trails') !== '0',
    clicks: [], run: null, cam: null, px: 0, boxes: {}, pulses: [], prevPlanted: {}, drawMs: {}, lastPanel: 0,
  };
  const cols = {};
  for (const k of KINDS) {
    const stage = $('stage-' + k), over = $('over-' + k);
    cols[k] = { stage, over, sctx: stage.getContext('2d'), octx: over.getContext('2d'), sprite: document.createElement('canvas') };
    stage.width = W; stage.height = H; over.width = W * K; over.height = H * K;
    cols[k].spctx = cols[k].sprite.getContext('2d');
  }

  // ---------- the run ----------
  function newRun() {
    const run = Lab.createRun({ scenario: S.scenario, seed: S.seed, level: S.level, kinds: KINDS.filter((k) => k !== 'v3' || TD),
      topRig: TD && TD.rig, clicks: S.clicks });
    run.cam = camTarget(run);
    S.run = run;
    S.px = Lab.bodyLength(run.ph) / BODY_PX;
    S.pulses = []; S.prevPlanted = {};
    S.boxes.v1 = spriteBox(B.build(run.ph, {}), S.px);
    const a2 = actor('v2', run);
    S.boxes.v2 = spriteBox(window.CreatureChain.scene(run.ph, a2.w.R, {}), S.px);
    for (const k of ['v1', 'v2']) { cols[k].sprite.width = S.boxes[k].w; cols[k].sprite.height = S.boxes[k].h; }
    $('scrub').max = String(run.scn.seconds);
    $('about').textContent = run.scn.about;
    $('followHint').hidden = !run.scn.follow;
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

  // ---------- 3/4 projection (versions 1 and 2) ----------
  const cam = () => S.run.cam;
  function stage(x, y, z) { return [W / 2 + (x - cam().x) / S.px, H / 2 + 8 - (y * CP - (z - cam().z) * SP) / S.px]; }
  const over = (x, y, z) => { const p = stage(x, y, z); return [p[0] * K, p[1] * K]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function spriteBox(scene, px) {
    let half = 0, top = 0, bottom = 0;
    const pts = scene.prims.map((p) => p.bs);
    if (scene.shadow) pts.push([scene.shadow.cx, 0, 0, Math.max(scene.shadow.rx, scene.shadow.rz)]);
    for (let i = 0; i < 8; i++) {
      const c = R.camera({ w: 1, h: 1, px, yaw: i * Math.PI / 4, pitch: PITCH, center: [0, 0, 0] });
      for (const b of pts) { const rx = dot(b, c.r), uy = dot(b, c.u); half = Math.max(half, Math.abs(rx) + b[3]); top = Math.max(top, uy + b[3]); bottom = Math.max(bottom, b[3] - uy); }
    }
    const w = Math.ceil(2 * half * 1.06 / px) + 4, ground = Math.ceil(top * 1.1 / px) + 2;
    return { w: w + (w % 2), h: ground + Math.ceil(bottom * 1.06 / px) + 3, ground };
  }
  function spriteCam(box, yaw) {
    const c = R.camera({ w: box.w, h: box.h, px: S.px, yaw, pitch: PITCH, center: [0, 0, 0] }), off = (box.ground - box.h / 2) * S.px;
    return { w: box.w, h: box.h, px: S.px, yaw, pitch: PITCH, center: [c.u[0] * off, c.u[1] * off, c.u[2] * off] };
  }

  // ---------- drawing ----------
  function drawFloor34(ctx) {
    ctx.fillStyle = COL.floor; ctx.fillRect(0, 0, W, H);
    const g = Lab.bodyLength(S.run.ph) / 4, c = cam();
    const x0 = Math.floor((c.x - W / 2 * S.px) / g) - 1, x1 = Math.ceil((c.x + W / 2 * S.px) / g) + 1;
    const zr = (H / 2 + 12) * S.px / SP, z0 = Math.floor((c.z - zr) / g) - 1, z1 = Math.ceil((c.z + zr) / g) + 1;
    for (let i = x0; i <= x1; i++) { const p = stage(i * g, 0, 0); ctx.fillStyle = i % 4 ? COL.grid : COL.gridMajor; ctx.fillRect(Math.round(p[0]), 0, 1, H); }
    for (let j = z0; j <= z1; j++) { const p = stage(0, 0, j * g); ctx.fillStyle = j % 4 ? COL.grid : COL.gridMajor; ctx.fillRect(0, Math.round(p[1]), W, 1); }
  }
  function drawSprite(k, a) {
    const col = cols[k], box = S.boxes[k];
    a.scene.ph = a.ph; // the renderer takes its colours from the phenotype
    const res = R.render(a.scene, spriteCam(box, -a.w.th), { style: S.style, shadow: false });
    const img = col.spctx.createImageData(res.w, res.h);
    img.data.set(res.rgba);
    col.spctx.putImageData(img, 0, 0);
    const p = stage(a.w.x, 0, a.w.z);
    col.sctx.drawImage(col.sprite, Math.round(p[0]) - box.w / 2, Math.round(p[1]) - box.ground);
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
    ctx.font = '600 10px system-ui, sans-serif'; ctx.fillStyle = 'rgba(20,16,30,0.75)';
    const w = ctx.measureText(text).width;
    ctx.fillRect(p[0] - 2, p[1] - 9, w + 4, 12);
    ctx.fillStyle = colour || COL.text; ctx.fillText(text, p[0], p[1]);
  }
  // A horizontal circle on the floor (or at height y) of radius r around (x, z).
  function groundCircle(P, x, y, z, r, n) {
    const out = [];
    for (let i = 0; i <= (n || 28); i++) { const t = i / (n || 28) * Math.PI * 2; out.push(P(x + Math.cos(t) * r, y, z + Math.sin(t) * r)); }
    return out;
  }

  function drawTrails(ctx, a, P) {
    if (!S.trails) return;
    poly(ctx, a.trail.map((q) => P(q[0], 0, q[1])), COL.trail, 1.5);
    const n = a.w.feet.length;
    for (const f of a.footTrail) { const p = P(f[0], 0, f[1]); ctx.fillStyle = f[2] % 2 ? COL.right : COL.left; ctx.globalAlpha = 0.55; ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2); }
    ctx.globalAlpha = 1;
    void n;
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
    const sc = a.scene, w = a.w, toW = (p) => { const q = M1.toWorld(w, p[0], p[2]); return P(q[0], p[1], q[1]); };
    const rings = sc.prims.filter((p) => (p.piece === 'torso' || p.piece === 'neck' || p.piece === 'tail') && p.k === B.CONE);
    const spine = [];
    for (const pr of rings) {
      const ax = B.v.norm(B.v.sub(pr.b, pr.a));
      let e1 = B.v.cross(ax, [0, 1, 0]); if (B.v.len(e1) < 1e-6) e1 = [0, 0, 1]; e1 = B.v.norm(e1);
      const e2 = B.v.cross(e1, ax), pts = [];
      for (let i = 0; i <= 20; i++) { const t = i / 20 * Math.PI * 2; pts.push(toW(B.v.add(pr.a, B.v.add(B.v.mul(e1, Math.cos(t) * pr.r1), B.v.mul(e2, Math.sin(t) * pr.r1 * (pr.sy || 1)))))); }
      poly(ctx, pts, COL.ring, 1);
      spine.push(toW(pr.a));
    }
    if (rings.length) spine.push(toW(rings[rings.length - 1].b));
    poly(ctx, spine, 'rgba(143,211,255,0.45)', 1, [2, 3]);
    drawLegs(ctx, a, P, true);
    const st = a.out;
    // the body turns round this point when it pivots
    if (st.pivot) { const p = P(st.pivot[0], 0, st.pivot[1]); poly(ctx, [[p[0] - 4, p[1] - 4], [p[0] + 4, p[1] + 4]], COL.hip, 1.5); poly(ctx, [[p[0] - 4, p[1] + 4], [p[0] + 4, p[1] - 4]], COL.hip, 1.5); }
    gaitDial(ctx, st.gait, st.feetState);
  }
  // The legs: bones, hips, and the feet (green planted, orange in the air, an orange cross where a swing will land).
  function drawLegs(ctx, a, P, hips) {
    const legs = a.legs, out = a.out, sc = a.scene;
    legs.forEach((lg, i) => {
      const yHip = sc && sc.legs ? sc.legs[i].hip[1] : 0.6 * a.w.R.legLen, yKnee = sc && sc.legs ? sc.legs[i].knee[1] : 0.4 * a.w.R.legLen;
      const hip = P(lg.hip[0], yHip, lg.hip[1]), knee = P(lg.knee[0], yKnee, lg.knee[1]), foot = P(lg.end[0], lg.y, lg.end[1]);
      poly(ctx, [hip, knee, foot], 'rgba(255,255,255,0.85)', 1.5);
      if (hips) { ctx.fillStyle = COL.hip; ctx.fillRect(hip[0] - 2.5, hip[1] - 2.5, 5, 5); }
      const planted = out.feetState[i];
      const g = P(lg.end[0], 0, lg.end[1]);
      if (planted) poly(ctx, groundCircle(P, lg.end[0], 0, lg.end[1], 0.035 * a.BL, 14), COL.planted, 2);
      disc(ctx, g, 2.5, planted ? COL.planted : COL.swing);
      const t = out.targets && out.targets[i];
      if (t && a.kind === 'v1') { const q = M1.toWorld(a.w, t[0], t[2]), p = P(q[0], 0, q[1]); poly(ctx, [[p[0] - 3, p[1] - 3], [p[0] + 3, p[1] + 3]], COL.swing, 1.5); poly(ctx, [[p[0] - 3, p[1] + 3], [p[0] + 3, p[1] - 3]], COL.swing, 1.5); }
    });
  }
  // Version 1's gait clock: one ring per leg, green where that foot is on the ground in the cycle; the hand is now.
  function gaitDial(ctx, g, planted) {
    const cx = W * K - 40, cy = 40, n = g.offsets.length;
    disc(ctx, [cx, cy], 30, 'rgba(20,16,30,0.6)');
    for (let i = 0; i < n; i++) {
      const r = 10 + i * (18 / Math.max(1, n - 1 || 1));
      const a0 = -Math.PI / 2 + g.offsets[i] * 2 * Math.PI, a1 = a0 + g.duty * 2 * Math.PI;
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,159,67,0.4)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = planted[i] ? COL.planted : 'rgba(107,227,143,0.55)'; ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
    }
    const h = -Math.PI / 2 + g.phase * 2 * Math.PI;
    poly(ctx, [[cx, cy], [cx + Math.cos(h) * 30, cy + Math.sin(h) * 30]], '#ffffff', 1.5);
    label(ctx, [cx - 26, cy + 44], 'gait clock');
  }

  // Versions 2 and 3's machinery: the chain (joints, their radii, the fixed link lengths), the angle each link may bend
  // (wedges, red at the limit), the head that is steered, each foot's wanted spot and the stride-behind circle.
  function machinery2(ctx, a, P, top) {
    const w = a.w, R = w.R, J = w.chain.joints, A = w.chain.angles, n = J.length;
    const joints = a.out.pose.joints, y = (i) => (top ? 0 : joints[i].y);
    const at = (i) => { const q = M1.toWorld(w, joints[i].x, joints[i].z); return [q[0], y(i), q[1]]; };
    // angle-limit wedges: from joint i-1, the directions joint i may lie in
    for (let i = 1; i < n; i++) {
      const c = at(i - 1), back = A[i - 1] + Math.PI, lim = R.bend[i], rr = R.links[i] * 1.15;
      const atLimit = Math.abs(C_wrap(A[i] - A[i - 1])) > lim * 0.96;
      const pts = [P(c[0], c[1], c[2])];
      for (let k = 0; k <= 10; k++) { const t = back - lim + 2 * lim * k / 10; pts.push(P(c[0] + Math.cos(t) * rr, c[1], c[2] - Math.sin(t) * rr)); }
      ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
      ctx.fillStyle = atLimit ? COL.limit : COL.wedge; ctx.fill();
      ctx.strokeStyle = COL.wedgeLine; ctx.lineWidth = 0.6; ctx.stroke();
    }
    // joint radii (the video's circles) and the links
    for (let i = 0; i < n; i++) { const c = at(i); poly(ctx, groundCircle(P, c[0], c[1], c[2], R.joints[i].w, 20), COL.joint, 1); }
    poly(ctx, Array.from({ length: n }, (_, i) => { const c = at(i); return P(c[0], c[1], c[2]); }), COL.link, 1.5);
    for (let i = 0; i < n; i++) { const c = at(i); disc(ctx, P(c[0], c[1], c[2]), i === 0 ? 3.5 : 2, i === 0 ? COL.head : COL.link); }
    // the head is the only part that is steered: its heading
    const h = at(0), L = 0.3 * a.BL, tip = P(h[0] + Math.cos(A[0]) * L, h[1], h[2] - Math.sin(A[0]) * L);
    poly(ctx, [P(h[0], h[1], h[2]), tip], COL.head, 2);
    // feet: wanted spot and the circle a foot may fall behind by before it steps
    for (const r of Lab.stepRings(a)) {
      const c = P(r.wanted[0], 0, r.wanted[1]);
      poly(ctx, groundCircle(P, r.wanted[0], 0, r.wanted[1], r.radius, 24), r.behind > 0.85 ? COL.target : 'rgba(255,200,87,0.55)', r.behind > 0.85 ? 1.6 : 1, [3, 3]);
      ctx.fillStyle = COL.target; ctx.fillRect(c[0] - 1.5, c[1] - 1.5, 3, 3);
      if (r.planted) poly(ctx, [P(r.foot[0], 0, r.foot[1]), c], 'rgba(255,200,87,0.6)', 1);
    }
    drawLegs(ctx, a, P, true);
    behindBars(ctx, a);
    // name the parts once, near the head
    const hp = P(h[0], h[1], h[2]);
    label(ctx, [hp[0] + 8, hp[1] - 10], 'head (steered)', COL.head);
  }
  const C_wrap = (x) => x - 2 * Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI));
  // Versions 2 and 3 have no clock: each foot steps when it falls a stride behind. The bars show how far behind each
  // foot is; at the line it steps.
  function behindBars(ctx, a) {
    const rings = Lab.stepRings(a), n = rings.length;
    if (!n) return;
    ctx.font = '600 10px system-ui, sans-serif';
    const tw = ctx.measureText('how far behind').width, bw = Math.max(n * 9 + 4, tw);
    const x0 = W * K - 12 - bw + (bw - n * 9) / 2, y0 = 12, h = 46;
    ctx.fillStyle = 'rgba(20,16,30,0.6)'; ctx.fillRect(W * K - 18 - bw, y0 - 4, bw + 12, h + 22);
    rings.forEach((r, i) => {
      const v = Math.min(1.25, r.behind), bh = v / 1.25 * h;
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x0 + i * 9, y0, 6, h);
      ctx.fillStyle = r.planted ? (r.behind > 0.85 ? COL.target : COL.planted) : COL.swing; ctx.fillRect(x0 + i * 9, y0 + h - bh, 6, bh);
    });
    const ly = y0 + h - h / 1.25;
    poly(ctx, [[x0 - 4, ly], [x0 + n * 9, ly]], '#ffffff', 1, [2, 2]);
    label(ctx, [W * K - 12 - bw, y0 + h + 14], 'how far behind');
  }

  // ---------- the columns ----------
  function drawColumn34(k) {
    const a = actor(k), col = cols[k];
    const t0 = performance.now();
    drawFloor34(col.sctx);
    drawSprite(k, a);
    const ctx = col.octx;
    ctx.clearRect(0, 0, W * K, H * K);
    drawPathAndGoal(ctx, over);
    drawTrails(ctx, a, over);
    if (S.mach[k]) { drawPulses(ctx, k, over); if (k === 'v1') machinery1(ctx, a, over); else machinery2(ctx, a, over, false); }
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
    const g = Lab.bodyLength(S.run.ph) / 4, x0 = Math.floor((c.x - W * K / 2 / sc) / g) - 1, x1 = Math.ceil((c.x + W * K / 2 / sc) / g) + 1;
    const z0 = Math.floor((c.z - H * K / 2 / sc) / g) - 1, z1 = Math.ceil((c.z + H * K / 2 / sc) / g) + 1;
    for (let i = x0; i <= x1; i++) { const p = P(i * g, 0, 0); ctx.fillStyle = i % 4 ? COL.grid : COL.gridMajor; ctx.fillRect(Math.round(p[0]), 0, 1, H * K); }
    for (let j = z0; j <= z1; j++) { const p = P(0, 0, j * g); ctx.fillStyle = j % 4 ? COL.grid : COL.gridMajor; ctx.fillRect(0, Math.round(p[1]), W * K, 1); }
    drawPathAndGoal(ctx, P);
    drawTrails(ctx, a, P);
    TD.draw(ctx, a.w, { scale: sc, ox: W * K / 2 - c.x * sc, oy: H * K / 2 - c.z * sc },
      { style: S.style === 'gochi' ? 'original' : S.style, sun: LT ? LT.sunAt(0.42) : null, time: S.run.t, skeleton: false, out: a.out });
    if (S.mach.v3) { drawPulses(ctx, 'v3', P); machinery2(ctx, a, P, true); }
    S.drawMs.v3 = performance.now() - t0;
  }
  function draw() {
    drawColumn34('v1'); drawColumn34('v2'); drawColumnTop();
    $('time').textContent = S.run.t.toFixed(2) + ' s';
    $('scrub').value = String(Math.min(S.run.t, S.run.scn.seconds));
    const nowMs = performance.now();
    if (!S.playing || nowMs - S.lastPanel > 250) { S.lastPanel = nowMs; panels(); }
  }

  // ---------- numbers and the "what is different" panel ----------
  const f1 = (x) => (x == null ? '–' : x.toFixed(x < 10 ? 2 : 1));
  function panels() {
    const d = Lab.differences(S.run);
    for (const a of S.run.actors) {
      const s = Lab.summary(a.meter), el = $('nums-' + a.kind);
      const rows = [
        ['Foot slide', a.ph.legs.pairs ? s.footSlide.toFixed(1) + '% avg · ' + s.footSlideMax.toFixed(1) + '% max' : 'no legs', 'how far a foot on the floor drifts before it lifts, as % of a body length'],
        ['Tightest turn', s.tightestTurn == null ? 'not yet' : s.tightestTurn < 0.05 ? 'on the spot' : f1(s.tightestTurn) + ' body', 'radius of the tightest 45° of turning so far'],
        ['Turning now', s.turnNow == null ? 'straight' : f1(s.turnNow) + ' body', 'radius over the last 45° of turning'],
        ['Leg crossings', String(s.crossings), 'times two legs\' shadows crossed'],
        ['Body wobble', s.wobble.toFixed(1) + '°/s', 'jitter of the heading around its smooth turn'],
        ['Spine bend', Math.round(s.bend) + '° (max ' + Math.round(s.bendMax) + '°)', 'how much the body curves along its length'],
        ['Off the path', s.pathError == null ? '–' : f1(s.pathError) + ' body', 'mean distance of the steered point from the path'],
        ['ms per frame', s.ms.toFixed(2) + ' + draw ' + (S.drawMs[a.kind] || 0).toFixed(1), 'motion and body, plus drawing this column'],
      ];
      el.innerHTML = rows.map((r) => '<tr title="' + r[2] + '"><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>').join('');
    }
    $('diffs').innerHTML = d.lines.map((l) => '<li' + (l.win ? ' class="w-' + l.win + '"' : '') + '>' + l.text + '</li>').join('') +
      (actor('v3') ? '<li>Version 3 runs version 2\'s motion (the same chain and stepping rule) with its feet set wider so they read from above: compare its columns of numbers with version 2\'s.</li>' : '');
    $('verdict').innerHTML = '<b>' + S.run.scn.name + '.</b> ' + d.byEye + ' ' + d.byNumbers;
  }

  // ---------- playback ----------
  let last = 0, acc = 0;
  function loop(now) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (S.playing) {
      acc += dt * S.speed;
      let n = 0;
      while (acc >= Lab.DT && n < 6) { acc -= Lab.DT; n++; stepRun(); if (S.run.t >= S.run.scn.seconds) { if (S.loop) { newRun(); } else { S.playing = false; syncButtons(); } break; } }
      if (n === 6) acc = 0;
      draw();
    }
    requestAnimationFrame(loop);
  }
  function syncButtons() { $('play').textContent = S.playing ? 'Pause' : 'Play'; }

  // ---------- filmstrip ----------
  // Ten frames, half a second apart, from now: one row per version, so the difference is there to see at once.
  function recordStrip() {
    const t0 = S.run.t, frames = 10, gap = 0.5, cw = 320, ch = 224, lw = 96, top = 44;
    const strip = document.createElement('canvas');
    strip.width = lw + frames * cw; strip.height = top + KINDS.length * ch;
    const x = strip.getContext('2d');
    x.fillStyle = '#1f1c2c'; x.fillRect(0, 0, strip.width, strip.height);
    x.font = '600 14px system-ui, sans-serif'; x.fillStyle = '#ece6f2';
    x.fillText(S.run.scn.name + ' · seed ' + S.seed, 8, 18);
    const wasPlaying = S.playing; S.playing = false;
    for (let f = 0; f < frames; f++) {
      seek(t0 + gap * (f + 1));
      draw();
      x.fillStyle = '#ece6f2'; x.font = '12px system-ui, sans-serif'; x.fillText(S.run.t.toFixed(1) + ' s', lw + f * cw + 6, top - 7);
      KINDS.forEach((k, r) => {
        const col = cols[k], dx = lw + f * cw, dy = top + r * ch;
        x.imageSmoothingEnabled = false;
        if (k !== 'v3') x.drawImage(col.stage, dx, dy, cw, ch);
        x.imageSmoothingEnabled = true;
        x.drawImage(col.over, dx, dy, cw, ch);
        x.strokeStyle = '#000'; x.strokeRect(dx + 0.5, dy + 0.5, cw - 1, ch - 1);
      });
    }
    KINDS.forEach((k, r) => { x.fillStyle = '#ece6f2'; x.font = '600 13px system-ui, sans-serif'; x.fillText(({ v1: 'Version 1', v2: 'Version 2', v3: 'Version 3' })[k], 8, top + r * ch + ch / 2); x.font = '11px system-ui, sans-serif'; x.fillStyle = '#9188a3'; x.fillText(({ v1: 'rings + clock', v2: 'chain, 3/4', v3: 'chain, top-down' })[k], 8, top + r * ch + ch / 2 + 16); });
    seek(t0); draw();
    S.playing = wasPlaying; syncButtons();
    const url = strip.toDataURL('image/png');
    $('strip').src = url; $('stripBox').hidden = false;
    $('stripSave').href = url; $('stripSave').download = 'creatures-' + S.run.scn.id + '-' + S.seed + '.png';
    return { w: strip.width, h: strip.height, url };
  }

  // ---------- controls ----------
  function fillScenarios() {
    $('scenario').innerHTML = Lab.SCENARIOS.map((s) => '<option value="' + s.id + '">' + s.name + '</option>').join('');
    $('scenario').value = S.scenario;
  }
  function restart(keepT) {
    const t = keepT ? S.run.t : 0;
    S.run = null; seek(t); draw(); syncUrl();
  }
  function syncUrl() {
    const q = new URLSearchParams();
    q.set('seed', S.seed); q.set('level', String(S.level)); q.set('scenario', S.scenario);
    if (S.style !== 'gochi') q.set('style', S.style);
    if (S.speed !== 1) q.set('speed', String(S.speed));
    for (const k of KINDS) if (!S.mach[k]) q.set('m' + k.slice(1), '0');
    if (!S.trails) q.set('trails', '0');
    if (params.get('theme')) q.set('theme', params.get('theme'));
    if (!TEST) history.replaceState(null, '', '?' + q);
    $('openV1').href = '../prototype/index.html?seed=' + encodeURIComponent(S.seed) + '&level=' + S.level;
    $('openV2').href = 'index.html?seed=' + encodeURIComponent(S.seed) + '&level=' + S.level;
    $('openV3').href = '../prototype-v3/index.html?seed=' + encodeURIComponent(S.seed) + '&level=' + S.level;
  }
  function bind() {
    $('seed').value = S.seed; $('level').value = String(S.level); $('style').value = S.style; $('speed').value = String(S.speed);
    $('speedOut').textContent = S.speed.toFixed(1) + '×';
    for (const k of KINDS) $('mach-' + k).checked = S.mach[k];
    $('trails').checked = S.trails;
    $('f').addEventListener('submit', (e) => { e.preventDefault(); S.seed = $('seed').value.trim() || 'moss'; S.level = Math.max(1, Math.min(100, Number($('level').value) || 100)); S.clicks = []; restart(false); });
    $('scenario').addEventListener('change', () => { S.scenario = $('scenario').value; S.clicks = []; restart(false); });
    $('style').addEventListener('change', () => { S.style = $('style').value; draw(); syncUrl(); });
    $('speed').addEventListener('input', () => { S.speed = Number($('speed').value); $('speedOut').textContent = S.speed.toFixed(1) + '×'; syncUrl(); });
    $('play').addEventListener('click', () => { S.playing = !S.playing; if (S.playing && S.run.t >= S.run.scn.seconds) restart(false); syncButtons(); });
    $('stepF').addEventListener('click', () => { S.playing = false; syncButtons(); stepRun(); draw(); });
    $('stepB').addEventListener('click', () => { S.playing = false; syncButtons(); seek(S.run.t - Lab.DT); draw(); });
    $('restart').addEventListener('click', () => restart(false));
    $('scrub').addEventListener('input', () => { S.playing = false; syncButtons(); seek(Number($('scrub').value)); draw(); });
    for (const k of KINDS) $('mach-' + k).addEventListener('change', () => { S.mach[k] = $('mach-' + k).checked; draw(); syncUrl(); });
    $('trails').addEventListener('change', () => { S.trails = $('trails').checked; draw(); syncUrl(); });
    $('record').addEventListener('click', recordStrip);
    $('full').addEventListener('toggle', () => {
      if (!$('full').open) return;
      for (const [id, a] of [['fv1', 'openV1'], ['fv2', 'openV2'], ['fv3', 'openV3']]) if (!$(id).src) $(id).src = $(a).href;
    });
    // Click the floor in the follow scenario: the target jumps there (the click is replayed when scrubbing).
    for (const k of KINDS) cols[k].over.addEventListener('click', (e) => {
      if (!S.run.scn.follow) return;
      const r = cols[k].over.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * W * K, sy = (e.clientY - r.top) / r.height * H * K, c = cam();
      let x, z;
      if (k === 'v3') { const sc = K / S.px; x = c.x + (sx - W * K / 2) / sc; z = c.z + (sy - H * K / 2) / sc; }
      else { x = c.x + (sx / K - W / 2) * S.px; z = c.z + (sy / K - H / 2 - 8) * S.px / SP; }
      const click = { at: S.run.t, x, z };
      S.clicks.push(click); S.run.clicks.push(click);
    });
  }

  // ---------- self-checks (?test=1) ----------
  function runChecks() {
    const checks = [];
    const check = (name, pass, info) => checks.push({ name, pass: !!pass, info });
    // (read through a copy made for reading, so the live canvases stay fast to draw on)
    const inked = (cv) => {
      const copy = document.createElement('canvas'); copy.width = cv.width; copy.height = cv.height;
      const cx = copy.getContext('2d', { willReadFrequently: true }); cx.drawImage(cv, 0, 0);
      const d = cx.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; };
    check('three versions on one clock', S.run.actors.length === (TD ? 3 : 2), { actors: S.run.actors.map((a) => a.kind), topdown: !!TD });
    seek(2); draw();
    check('version 1 and 2 sprites drawn', inked(cols.v1.stage) > 1000 && inked(cols.v2.stage) > 1000, {});
    check('machinery overlays drawn', KINDS.every((k) => !actor(k) || inked(cols[k].over) > 500), KINDS.map((k) => inked(cols[k].over)));
    const snap = () => S.run.actors.map((a) => [a.w.x.toFixed(6), a.w.z.toFixed(6), a.w.th.toFixed(6)].join(',')).join('|');
    seek(3); const at3 = snap(); seek(1); seek(3);
    check('scrubbing back and forth lands on the same frame', snap() === at3, { at3, again: snap() });
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
  seek(Number(params.get('t') || 0));
  draw(); syncUrl(); syncButtons();
  if (TEST) runChecks();
  else {
    if (params.get('film') === '1') recordStrip();
    requestAnimationFrame(loop);
  }
})();
