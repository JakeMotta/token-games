/* Creature Hatchery, version 3: version 2's Argonaut chain seen from straight above.

   Version 2 already moves the creature on a ground plane (x, z): the head is steered, every other joint follows at a
   fixed distance and within an angle limit, and each foot stays planted until its hip has moved a stride on. Seen from
   the side that motion is mostly hidden; seen from above it is the whole picture. This file only DRAWS that walker from
   above (the walker itself is ../prototype-v2/motion2.js, unchanged), plus a rig whose feet stand out to the sides the
   way a lizard's do, so the legs show.

   World to screen: screenX = view.ox + x * view.scale, screenY = view.oy + z * view.scale (z runs down the screen).
   Heading th points along (cos th, -sin th); the creature's right is (sin th, cos th).

   API (browser global CreatureTopdown, or require() in node):
     rig(ph)                          the chain rig with feet splayed out sideways; pass as createWalker(ph, seed, { rig })
     draw(ctx, w, view, opts)         paint walker w; opts = { style: 'original'|'cel'|'pixel', sun, time, skeleton,
                                      shadow (default true), out (the last step() output), pixel (px size, default 3),
                                      canvas (w, h) -> canvas factory for the Pixel look } -> { box } screen bounds
     outline(w, opts)                 the body outline polygon, world coords; .right/.left/.tip carry the side points
     legIK2D(hip, foot, len, side)    two-bone IK in the plane -> { knee, foot, straight }; len is a number or [a, b];
                                      side is +1/-1 (which side of hip->foot) or a direction [x, z] the knee leans to
     shadowOffset(sun, height)        [dx, dz] a point at that height casts its shadow by, away from the light
     shadowAlpha(sun)                 how dark the shadow is for that light
     headOf(w, opts), frameOf(w)      the head and the (tail-swayed) chain, world coords
     paletteOf(ph)                    the genome's colours (the same ramps as versions 1 and 2) */
(function (root) {
  'use strict';
  const C = root.CreatureChain || require('../prototype-v2/chain.js');
  const Rn = root.CreatureRender || require('../prototype/render.js');

  const SPLAY = 0.72;        // a foot stands this share of a leg out past its hip
  const FORE = 0.2;          // front feet this share of a leg ahead of the hip, hind feet behind
  const BONE = 0.52;         // each leg bone, share of the leg (the two together reach a bit past the rest foot)
  const MAX_RATIO = 2.4;     // a shadow reaches at most this many times the height out (the low sun is not endless)
  const SHADOW_RGB = [22, 24, 44];
  const EYE_WHITE = [246, 244, 236], PUPIL = [26, 22, 36];
  const STYLES = ['original', 'cel', 'pixel'];

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  const rgb = (c, a) => (a == null || a >= 1 ? 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'
    : 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + Math.max(0, a).toFixed(3) + ')');
  const fwdOf = (th) => [Math.cos(th), -Math.sin(th)];
  const rightOf = (th) => [Math.sin(th), Math.cos(th)];
  function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const numHash = (xs) => { let h = 2166136261; for (const x of xs) h = Math.imul(h ^ Math.round((x || 0) * 100003), 16777619); return h >>> 0; };
  const normStyle = (s) => (s === 'gochi' ? 'original' : STYLES.includes(s) ? s : 'original');

  // ---------- the rig ----------
  // Version 2's rig, with each foot moved out to the side (and a little forward for front legs, back for hind legs).
  // The walker plants feet at hips[i].foot in the hip joint's frame, so this is all it takes for them to splay.
  function rig(ph) {
    const R = C.rig(ph), L = R.legLen;
    const hindJ = R.hips.length ? Math.max.apply(null, R.hips.map((h) => h.joint)) : -1;
    R.hips = R.hips.map((hp) => {
      const jw = R.joints[hp.joint].w;
      const lat = Math.max(Math.abs(hp.off[2]) + SPLAY * L, jw + 0.3 * L);
      const fwd = hp.front ? FORE * L : hp.joint === hindJ ? -FORE * L : 0;
      return Object.assign({}, hp, { foot: [hp.off[0] + fwd, hp.foot[1], (hp.side < 0 ? -1 : 1) * lat] });
    });
    R.topdown = true;
    return R;
  }

  // ---------- pure geometry ----------
  // Two bones in the plane: the knee sits where both bone lengths hold; `side` picks which side of the hip->foot line.
  function legIK2D(hip, foot, len, side) {
    const a = Array.isArray(len) ? len[0] : len, b = Array.isArray(len) ? len[1] : len;
    let dx = foot[0] - hip[0], dz = foot[1] - hip[1], d = Math.hypot(dx, dz);
    if (d < 1e-9) { dx = 1e-9; dz = 0; d = 1e-9; }
    const ux = dx / d, uz = dz / d, nx = -uz, nz = ux;
    const dd = clamp(d, Math.abs(a - b) + 1e-9, a + b);
    const along = (a * a - b * b + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, a * a - along * along));
    let sg = Array.isArray(side) ? (nx * side[0] + nz * side[1] >= 0 ? 1 : -1) : side < 0 ? -1 : 1;
    const knee = [hip[0] + ux * along + nx * h * sg, hip[1] + uz * along + nz * h * sg];
    const reach = d > a + b ? [hip[0] + ux * (a + b), hip[1] + uz * (a + b)] : d < Math.abs(a - b) ? [hip[0] + ux * dd, hip[1] + uz * dd] : [foot[0], foot[1]];
    return { knee, foot: reach, straight: d >= a + b };
  }

  // A point `height` above the ground casts its shadow this far along the ground, away from the light.
  function shadowOffset(sun, height) {
    if (!sun || !sun.L || !(height > 0)) return [0, 0];
    const L = sun.L, horiz = Math.hypot(L[0], L[2]);
    if (horiz < 1e-9) return [0, 0];
    const ratio = Math.min(MAX_RATIO, horiz / Math.max(1e-6, L[1]));
    const k = height * ratio / horiz;
    return [-L[0] * k, -L[2] * k];
  }
  // Darker and a little darker still at a low sun; a faint moon shadow at night.
  function shadowAlpha(sun) {
    if (!sun) return 0.28;
    const low = 1 - clamp(sun.L[1], 0, 1);
    return clamp(sun.strength * (1.25 + 0.9 * low) * (sun.body === 'moon' ? 0.75 : 1), 0, 0.62);
  }

  // The chain in world coords, with the tail's spring sway (version 2 bends it in bodyPose; the chain itself stays put).
  function frameOf(w, o) {
    o = o || {};
    const R = w.R, n = R.joints.length;
    const pts = w.chain.joints.map((p) => [p[0], p[1]]), ang = w.chain.angles.slice(0, n);
    const ts = R.tailStart > 0 ? R.tailStart : n, ta = o.noSway ? 0 : (w.tail && w.tail.a) || 0;
    if (ts < n && Math.abs(ta) > 1e-6) {
      const pv = pts[ts - 1];
      for (let i = ts; i < n; i++) {
        const a = ta * (i - ts + 1) / (n - ts), c = Math.cos(a), sn = Math.sin(a), x = pts[i][0] - pv[0], z = pts[i][1] - pv[1];
        pts[i] = [pv[0] + c * x + sn * z, pv[1] - sn * x + c * z]; ang[i] += a;
      }
    }
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, ang, wid: R.joints.map((j) => j.w), cum, total: cum[n - 1] || 1e-6, n, ts };
  }
  // A point on the body at arc length u (from joint 0) and v half-widths to the right.
  function spineAt(f, u, v) {
    const n = f.n;
    let i = 0;
    while (i < n - 2 && f.cum[i + 1] < u) i++;
    const seg = Math.max(1e-9, f.cum[i + 1] - f.cum[i]), t = n > 1 ? clamp((u - f.cum[i]) / seg, 0, 1) : 0;
    const a = f.pts[i], b = f.pts[Math.min(n - 1, i + 1)];
    let da = (f.ang[Math.min(n - 1, i + 1)] - f.ang[i]); da = Math.atan2(Math.sin(da), Math.cos(da));
    const th = f.ang[i] + da * t, wd = lerp(f.wid[i], f.wid[Math.min(n - 1, i + 1)], t), r = rightOf(th);
    const p = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
    return { p: [p[0] + r[0] * v * wd, p[1] + r[1] * v * wd], th, w: wd, c: p };
  }

  // The body outline: right side head to tail, the tail tip, left side back up, a round cap over joint 0.
  // opts.widthScale(i) and opts.shift(i) -> [dx, dz] (for the shadow) adjust it; with neither it is the rig's radii.
  function outline(w, o) {
    o = o || {};
    const f = o.frame || frameOf(w, o), n = f.n, s = w.R.s, ph = w.R.ph;
    const P = (i) => { if (!o.shift) return f.pts[i]; const d = o.shift(i); return [f.pts[i][0] + d[0], f.pts[i][1] + d[1]]; };
    const wid = f.wid.map((v, i) => v * (o.widthScale ? o.widthScale(i) : 1));
    const right = [], left = [];
    for (let i = 0; i < n; i++) {
      const r = rightOf(f.ang[i]), p = P(i);
      right.push([p[0] + r[0] * wid[i], p[1] + r[1] * wid[i]]);
      left.push([p[0] - r[0] * wid[i], p[1] - r[1] * wid[i]]);
    }
    const tipGene = ph.tail ? ph.tail.tip || 0 : 0, thE = f.ang[n - 1], pe = P(n - 1);
    const tipLen = wid[n - 1] + Math.max(0.5 * wid[n - 1], (0.03 + 0.05 * tipGene) * s);
    const tip = [pe[0] - Math.cos(thE) * tipLen, pe[1] + Math.sin(thE) * tipLen];
    const cap = [], p0 = P(0), f0 = fwdOf(f.ang[0]), r0 = rightOf(f.ang[0]);
    for (let k = 1; k < 6; k++) {
      const phi = Math.PI * (1 - k / 6); // left (pi) over the front (pi/2) to right (0)
      cap.push([p0[0] + wid[0] * (r0[0] * Math.cos(phi) + f0[0] * Math.sin(phi)), p0[1] + wid[0] * (r0[1] * Math.cos(phi) + f0[1] * Math.sin(phi))]);
    }
    const poly = right.concat([tip], left.slice().reverse(), cap);
    poly.right = right; poly.left = left; poly.tip = tip;
    return poly;
  }

  // The head: rings from the genome laid out ahead of joint 0, turned by where it looks; at(fx, lz) is a point on it.
  function headOf(w, o) {
    o = o || {};
    const R = w.R, ph = R.ph, s = R.s, f = o.frame || frameOf(w);
    const src = ph.head && ph.head.rings && ph.head.rings.length ? ph.head.rings : [{ w: 0.12 }, { w: 0.1 }];
    const rings = src.map((r) => Math.max(0.035 * s, r.w * s)), m = rings.length;
    const nod = clamp(o.nod || 0, 0, 1);
    const reach = Math.max(R.mouthAhead, rings[m - 1] * 1.2) * (1 - 0.16 * nod);
    const back = -0.3 * rings[0], last = reach - rings[m - 1] * 0.75;
    const st = rings.map((r, k) => ({ fx: m > 1 ? lerp(back, last, k / (m - 1)) : 0, r }));
    const sh = o.shift || [0, 0];
    const p0 = [f.pts[0][0] + sh[0], f.pts[0][1] + sh[1]], th = f.ang[0] + (o.look || 0);
    const fw = fwdOf(th), rt = rightOf(th);
    const at = (fx, lz) => [p0[0] + fw[0] * fx + rt[0] * lz, p0[1] + fw[1] * fx + rt[1] * lz];
    const rAt = (fx) => {
      if (fx <= st[0].fx) return st[0].r;
      for (let k = 1; k < m; k++) if (fx <= st[k].fx) return lerp(st[k - 1].r, st[k].r, (fx - st[k - 1].fx) / Math.max(1e-9, st[k].fx - st[k - 1].fx));
      return st[m - 1].r;
    };
    const front = st[m - 1].fx + st[m - 1].r, rmax = Math.max.apply(null, rings);
    // outline: right side back to front, a cap round the nose, left side front to back, a cap round the back
    const pts = [];
    st.forEach((q) => pts.push(at(q.fx, q.r)));
    for (let k = 1; k < 6; k++) { const a = Math.PI / 2 - Math.PI * k / 6; pts.push(at(st[m - 1].fx + Math.cos(a) * st[m - 1].r, Math.sin(a) * st[m - 1].r)); }
    for (let k = m - 1; k >= 0; k--) pts.push(at(st[k].fx, -st[k].r));
    for (let k = 1; k < 6; k++) { const a = -Math.PI / 2 - Math.PI * k / 6; pts.push(at(st[0].fx + Math.cos(a) * st[0].r, Math.sin(a) * st[0].r)); }
    return { p0, th, st, at, rAt, front, back: st[0].fx - st[0].r, rmax, pts, fw, rt };
  }

  // ---------- colours and markings ----------
  const palCache = new WeakMap();
  function paletteOf(ph) {
    let p = palCache.get(ph);
    if (!p) {
      p = Rn.palette({ ph, kind: 'creature' });
      const c = ph.colour;
      p.rim = mix(p.body[1], p.belly[2], c.belly > 0.15 ? 0.6 : 0.2);
      p.horn = Rn.ramp(42, 0.3, 0.8);
      p.beak = Rn.ramp(38, 0.62, 0.62);
      p.pollen = Rn.ramp(48, 0.8, 0.66);
      palCache.set(ph, p);
    }
    return p;
  }
  // Markings in body coordinates (u = share of the body's arc, v = half-widths to the right), fixed per genome, so they
  // bend and stretch with the chain.
  const patCache = new WeakMap();
  function patternOf(ph) {
    let out = patCache.get(ph);
    if (out) return out;
    const pt = ph.pattern || { kind: 'none' }, c = ph.colour || {};
    const rnd = rng(numHash([c.hue, c.sat, pt.scale, pt.amount, ph.scale]));
    const amt = clamp(pt.amount || 0.3, 0, 1), sc = clamp(pt.scale || 0.5, 0, 1);
    out = [];
    if (pt.kind === 'spots') {
      const n = Math.round(6 + amt * 10);
      for (let i = 0; i < n; i++) out.push({ u: 0.08 + 0.84 * (i + rnd()) / n, v: (rnd() * 2 - 1) * 0.62, r: (0.14 + 0.12 * rnd()) * (0.7 + 0.7 * sc) });
    } else if (pt.kind === 'speckles') {
      const n = Math.round(22 + amt * 36);
      for (let i = 0; i < n; i++) out.push({ u: 0.04 + 0.92 * rnd(), v: (rnd() * 2 - 1) * 0.85, r: 0.045 + 0.04 * rnd() });
    } else if (pt.kind === 'patches') {
      const n = 3 + Math.round(amt * 3);
      for (let i = 0; i < n; i++) {
        const u = 0.1 + 0.8 * (i + 0.5 * rnd()) / n, v = (i % 2 ? 1 : -1) * (0.25 + 0.4 * rnd()), r = 0.38 + 0.28 * rnd();
        for (let k = 0; k < 3; k++) out.push({ u: u + (rnd() - 0.5) * 0.06, v: v + (rnd() - 0.5) * 0.4, r: r * (0.6 + 0.4 * rnd()), patch: true });
      }
    } else if (pt.kind === 'stripes') {
      const n = Math.round(5 + amt * 6 + (1 - sc) * 3);
      for (let i = 0; i < n; i++) out.push({ u: 0.06 + 0.88 * (i + 0.5) / n, du: (0.32 + 0.2 * rnd()) * 0.88 / n, stripe: true });
    }
    patCache.set(ph, out);
    return out;
  }

  // ---------- building the creature for one frame (world coords) ----------
  function build(w, opts) {
    const R = w.R, ph = R.ph, s = R.s, out = opts.out, pose = out && out.pose;
    const f = frameOf(w);
    const breathe = pose ? pose.breathe || 0 : 0;
    const swallow = pose ? pose.swallow || 0 : w.swallow || 0;
    const lump = swallow > 0 ? 0.04 + 0.5 * swallow : -1;
    const ts = f.ts;
    const widthScale = (i) => {
      let k = 1;
      if (i >= R.neckEnd && i < ts) k += 0.018 * breathe;
      if (lump >= 0) { const d = (f.cum[i] / f.total - lump) / 0.07; k += 0.24 * Math.exp(-d * d); }
      return k;
    };
    const body = outline(w, { frame: f, widthScale });
    const look = pose ? pose.lookYaw || 0 : w.look || 0;
    const nod = clamp(pose ? -(pose.headNod || 0) * 3 : (w.eatNod || 0), 0, 1);
    const head = headOf(w, { frame: f, look, nod });
    const lift = Math.max(0, pose ? pose.lift || 0 : (w.lift || 0) + (w.hop || 0));
    const bob = w.bob || 0;
    // legs: hip on its torso joint, foot where the walker put it, knee out and back
    const legs = R.hips.map((hp, i) => {
      const j = hp.joint, p = f.pts[j], fw = fwdOf(f.ang[j]), rt = rightOf(f.ang[j]);
      const hip = [p[0] + fw[0] * hp.off[0] + rt[0] * hp.off[2], p[1] + fw[1] * hp.off[0] + rt[1] * hp.off[2]];
      const ft = w.feet[i] || { wx: hip[0], wz: hip[1], planted: true };
      const foot = [ft.wx, ft.wz];
      const out2 = [rt[0] * (hp.side < 0 ? -1 : 1), rt[1] * (hp.side < 0 ? -1 : 1)];
      const pref = [out2[0] - 0.55 * fw[0] * (hp.front ? 1 : -0.4), out2[1] - 0.55 * fw[1] * (hp.front ? 1 : -0.4)];
      const ik = legIK2D(hip, foot, [BONE * R.legLen, BONE * R.legLen], pref);
      let up = 0;
      if (pose && pose.legs && pose.legs[i]) up = Math.max(0, pose.legs[i].foot[1] - hp.foot[1]);
      else if (!ft.planted) up = 0.04 * s * Math.sin(Math.PI * (ft.u || 0));
      return { hip, knee: ik.knee, foot, up, planted: ft.planted !== false, side: hp.side, front: hp.front, fw, out: out2, hipY: hp.off[1] + bob, joint: j };
    });
    return { w, R, ph, s, f, body, head, legs, lift, bob, look, nod, swallow, lump, pose, pal: paletteOf(ph),
      mouthOpen: pose ? pose.mouthOpen || 0 : w.mouthOpen || 0, blink: pose ? !!pose.blink : w.blink > 0,
      happy: pose ? pose.expression === 'happy' : w.happy > 0, widthScale };
  }

  // ---------- canvas helpers ----------
  function makeMap(view, g) {
    const sc = view.scale, ox = view.ox, oy = view.oy;
    const a = g.w.chain.joints[g.R.anchor] || g.w.chain.joints[0];
    const k = 1 + 0.45 * g.lift / Math.max(0.2, g.s);
    const ax = ox + a[0] * sc, ay = oy + a[1] * sc;
    const S = (p) => [ax + (ox + p[0] * sc - ax) * k, ay + (oy + p[1] * sc - ay) * k];
    S.k = sc * k;
    S.plain = (p) => [ox + p[0] * sc, oy + p[1] * sc];
    return S;
  }
  // A closed Catmull-Rom curve through the points.
  function smoothPath(ctx, P, fresh) {
    const n = P.length;
    if (fresh !== false) ctx.beginPath();
    if (n < 3) return;
    ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    ctx.closePath();
  }
  function polyPath(ctx, P, fresh) {
    if (fresh !== false) ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
    ctx.closePath();
  }
  function ellipse(ctx, x, y, rx, ry, rot, fresh) {
    if (fresh !== false) ctx.beginPath();
    ctx.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
    ctx.ellipse(x, y, Math.max(0.3, rx), Math.max(0.3, ry), rot, 0, Math.PI * 2);
  }
  const area2 = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a; };
  const cw = (P) => (area2(P) >= 0 ? P : P.slice().reverse());
  function softDisc(ctx, x, y, r, col, a, hard) {
    if (!(r > 0.2)) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgb(col, a)); g.addColorStop(hard == null ? 0.55 : hard, rgb(col, a)); g.addColorStop(1, rgb(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  function lightDir(sun) {
    if (sun && sun.L) { const h = Math.hypot(sun.L[0], sun.L[2]); if (h > 0.05) return [sun.L[0] / h, sun.L[2] / h]; }
    return [-0.6, -0.8];
  }

  // A tube (body or head): a fill, markings, shading toward the light, an outline.
  function paintTube(ctx, T, style, light) {
    const b = T.ramp, lx = light[0], ly = light[1];
    ctx.save();
    smoothPath(ctx, T.path);
    if (style === 'original') {
      ctx.fillStyle = rgb(T.rim); ctx.fill();
      ctx.clip();
      for (const q of T.spine) softDisc(ctx, q.x + lx * q.r * 0.16, q.y + ly * q.r * 0.16, q.r * 1.04, b[3], 1, 0.6);
      if (T.marks) T.marks(ctx);
      for (const q of T.spine) softDisc(ctx, q.x + lx * q.r * 0.34, q.y + ly * q.r * 0.34, q.r * 0.62, b[4], 0.75, 0.25);
      if (T.gloss > 0.2) for (let i = 0; i < T.spine.length; i += 2) { const q = T.spine[i]; softDisc(ctx, q.x + lx * q.r * 0.5, q.y + ly * q.r * 0.5, q.r * 0.22, b[5], 0.55 * T.gloss, 0.2); }
      ctx.restore();
      smoothPath(ctx, T.path); ctx.strokeStyle = rgb(b[0], 0.8); ctx.lineWidth = 1.1; ctx.stroke();
      return;
    }
    ctx.fillStyle = rgb(b[3]); ctx.fill();
    ctx.clip();
    if (T.marks) T.marks(ctx);
    // the shadow band: the outline minus itself moved toward the light leaves a crescent on the far side
    const d = T.band;
    smoothPath(ctx, T.path);
    smoothPath(ctx, T.path.map((p) => [p[0] + lx * d, p[1] + ly * d]), false);
    ctx.fillStyle = style === 'pixel' ? rgb(b[2]) : rgb(b[1], 0.5);
    ctx.fill('evenodd');
    if (style === 'cel' && T.gloss > 0.35) for (let i = 1; i < T.spine.length; i += 3) { const q = T.spine[i]; ellipse(ctx, q.x + lx * q.r * 0.45, q.y + ly * q.r * 0.45, q.r * 0.16, q.r * 0.1, Math.atan2(ly, lx) + Math.PI / 2); ctx.fillStyle = rgb(b[5]); ctx.fill(); }
    ctx.restore();
    if (style === 'cel') { smoothPath(ctx, T.path); ctx.strokeStyle = rgb(b[0]); ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke(); }
  }

  // ---------- the creature's parts ----------
  function bodySpine(g, S) {
    const f = g.f, out = [];
    for (let i = 0; i < f.n; i++) {
      const p = S(f.pts[i]); out.push({ x: p[0], y: p[1], r: f.wid[i] * g.widthScale(i) * S.k });
      if (i < f.n - 1) { const q = S(f.pts[i + 1]); out.push({ x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, r: (f.wid[i] * g.widthScale(i) + f.wid[i + 1] * g.widthScale(i + 1)) / 2 * S.k }); }
    }
    const tp = S(g.body.tip), e = out[out.length - 1];
    out.push({ x: (e.x + tp[0]) / 2, y: (e.y + tp[1]) / 2, r: e.r * 0.5 });
    return out;
  }
  function bodyMarks(g, S, style) {
    const f = g.f, pal = g.pal, ph = g.ph, feats = patternOf(ph);
    const tip = ph.tail && ph.tail.tip > 0.3 && f.ts < f.n ? ph.tail.tip : 0;
    return (ctx) => {
      const a = style === 'original' ? 0.92 : 1;
      for (const q of feats) {
        if (q.stripe) {
          const P = [], u0 = (q.u - q.du / 2) * f.total, u1 = (q.u + q.du / 2) * f.total;
          for (let k = 0; k <= 4; k++) P.push(S(spineAt(f, lerp(u0, u1, k / 4), -1.3).p));
          for (let k = 4; k >= 0; k--) P.push(S(spineAt(f, lerp(u0, u1, k / 4) + (k === 2 ? 0.02 * f.total : 0), 1.3).p));
          polyPath(ctx, P); ctx.fillStyle = rgb(pal.mark[3], a); ctx.fill();
        } else {
          const sp = spineAt(f, q.u * f.total, q.v), p = S(sp.p), r = q.r * sp.w * S.k;
          ellipse(ctx, p[0], p[1], r * 1.15, r * 0.9, Math.atan2(-Math.sin(sp.th), Math.cos(sp.th)));
          ctx.fillStyle = rgb(q.patch ? pal.mark[2] : pal.mark[3], a); ctx.fill();
        }
      }
      if (tip) { // the tail's tip colour (version 1's tip ramp), from where the tip begins to the end
        const u0 = f.cum[f.ts] + (f.total - f.cum[f.ts]) * (1 - tip * 0.5), P = [];
        for (let k = 0; k <= 5; k++) P.push(S(spineAt(f, lerp(u0, f.total, k / 5), 1.4).p));
        P.push(S(g.body.tip));
        for (let k = 5; k >= 0; k--) P.push(S(spineAt(f, lerp(u0, f.total, k / 5), -1.4).p));
        polyPath(ctx, P); ctx.fillStyle = rgb(pal.tip[3]); ctx.fill();
      }
      if (g.lump >= 0) { // the swallowed bite: a soft round lump sliding down the neck into the body
        const sp = spineAt(f, g.lump * f.total, 0), p = S(sp.c), r = sp.w * S.k * 0.7;
        if (style === 'original') softDisc(ctx, p[0], p[1], r, pal.body[4], 0.6, 0.3);
        else { ellipse(ctx, p[0], p[1], r * 0.8, r * 0.6, 0); ctx.strokeStyle = rgb(pal.body[2]); ctx.lineWidth = 1; ctx.stroke(); }
      }
    };
  }

  function drawLegs(ctx, g, S, style) {
    const pal = g.pal, b = pal.body, lw = Math.max(1.2, g.R.legW * S.k), fr = Math.max(1.2, g.R.footR * S.k * 0.85);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const L of g.legs) {
      const h = S(L.hip), k = S(L.knee), ft = S(L.foot), lift = 1 + 1.4 * L.up / Math.max(0.1, g.s);
      const fdir = Math.atan2(ft[1] - k[1], ft[0] - k[0]);
      const toes = [];
      const nToe = 3, spread = 0.55;
      for (let t = 0; t < nToe; t++) {
        const a = fdir + (t - (nToe - 1) / 2) * spread;
        toes.push([ft[0] + Math.cos(a) * fr * 1.05 * lift, ft[1] + Math.sin(a) * fr * 1.05 * lift, a]);
      }
      const limb = (col, extra) => {
        ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(h[0], h[1]); ctx.lineTo(k[0], k[1]); ctx.lineWidth = lw * 1.35 + extra; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(k[0], k[1]); ctx.lineTo(ft[0], ft[1]); ctx.lineWidth = lw + extra; ctx.stroke();
        for (const q of toes) { ctx.beginPath(); ctx.arc(q[0], q[1], fr * 0.42 * lift + extra / 2, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); }
        ctx.beginPath(); ctx.arc(ft[0], ft[1], fr * lift + extra / 2, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
      };
      const ink = style === 'cel' ? 3 : style === 'original' ? 2 : 0;
      if (ink) limb(rgb(b[0], style === 'original' ? 0.8 : 1), ink);
      limb(rgb(style === 'pixel' ? b[2] : b[2]), 0);
      if (style !== 'pixel') { // a lit edge on the upper leg and the foot
        const l = lightDir(g.sun);
        ctx.strokeStyle = rgb(b[3]); ctx.lineWidth = Math.max(1, lw * 0.55);
        ctx.beginPath(); ctx.moveTo(h[0] + l[0] * lw * 0.25, h[1] + l[1] * lw * 0.25); ctx.lineTo(k[0] + l[0] * lw * 0.25, k[1] + l[1] * lw * 0.25); ctx.stroke();
        ctx.beginPath(); ctx.arc(ft[0] + l[0] * fr * 0.25, ft[1] + l[1] * fr * 0.25, fr * 0.6 * lift, 0, Math.PI * 2); ctx.fillStyle = rgb(b[3]); ctx.fill();
      }
      if (g.ph.legs && g.ph.legs.claws > 0.45) {
        ctx.fillStyle = rgb(pal.horn[style === 'pixel' ? 3 : 4]);
        for (const q of toes) { ctx.beginPath(); ctx.arc(q[0] + Math.cos(q[2]) * fr * 0.42, q[1] + Math.sin(q[2]) * fr * 0.42, Math.max(0.6, fr * 0.2), 0, Math.PI * 2); ctx.fill(); }
      }
    }
  }

  // Wings folded on the back: two leaves lying along the body from the shoulders, the right one over the left.
  function drawWings(ctx, g, S, style) {
    const ph = g.ph, wg = ph.wings;
    if (!wg || !(wg.size > 0)) return;
    const f = g.f, pal = g.pal, wr = pal.wing;
    const u0 = f.cum[Math.min(f.n - 1, g.R.wingJoint || g.R.anchor)] - 0.06 * g.s;
    const len = Math.min(f.total - u0, (0.35 + 0.5 * wg.size) * (wg.span || 1) * g.s);
    for (const side of [-1, 1]) {
      const P = [], ribs = [];
      for (let k = 0; k <= 8; k++) { const t = k / 8; P.push(S(spineAt(f, u0 + len * t, side * (0.06 + 0.98 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.75) * (1 - 0.25 * t))).p)); }
      for (let k = 8; k >= 0; k--) { const t = k / 8; P.push(S(spineAt(f, u0 + len * t, side * 0.05).p)); }
      const nf = clamp(Math.round(wg.fingers || 3), 2, 5);
      for (let k = 1; k <= nf; k++) ribs.push([S(spineAt(f, u0 + len * 0.04, side * 0.1).p), P[Math.round(k * 8 / (nf + 1))]]);
      smoothPath(ctx, P);
      ctx.fillStyle = rgb(wr[style === 'original' ? 3 : 3]); ctx.fill();
      if (style === 'original') { ctx.save(); ctx.clip(); const l = lightDir(g.sun), m = P[4]; softDisc(ctx, m[0] + l[0] * 6, m[1] + l[1] * 6, len * S.k * 0.45, wr[4], 0.6, 0.2); ctx.restore(); }
      ctx.strokeStyle = rgb(wr[1]); ctx.lineWidth = 1;
      for (const r of ribs) { ctx.beginPath(); ctx.moveTo(r[0][0], r[0][1]); ctx.lineTo(r[1][0], r[1][1]); ctx.stroke(); }
      if (style !== 'pixel') { smoothPath(ctx, P); ctx.strokeStyle = rgb(wr[0], style === 'cel' ? 1 : 0.8); ctx.lineWidth = style === 'cel' ? 1.6 : 1; ctx.stroke(); }
    }
  }
  function drawSpikes(ctx, g, S, style) {
    const f = g.f, ph = g.ph, pal = g.pal;
    const u0 = f.cum[Math.max(0, g.R.neckEnd - 1)], u1 = f.cum[f.ts < f.n ? Math.min(f.n - 1, f.ts + 1) : f.n - 1];
    const n = Math.max(3, Math.round((u1 - u0) / (0.11 * g.s)));
    for (let k = 0; k < n; k++) {
      const u = lerp(u0, u1, (k + 0.5) / n), sp = spineAt(f, u, 0), sz = sp.w * (0.22 + 0.25 * (ph.decor.size || 0.5));
      const fw = fwdOf(sp.th), rt = rightOf(sp.th), c = sp.c;
      const P = [[c[0] + fw[0] * sz, c[1] + fw[1] * sz], [c[0] + rt[0] * sz * 0.45, c[1] + rt[1] * sz * 0.45], [c[0] - fw[0] * sz * 1.4, c[1] - fw[1] * sz * 1.4], [c[0] - rt[0] * sz * 0.45, c[1] - rt[1] * sz * 0.45]].map(S);
      polyPath(ctx, P); ctx.fillStyle = rgb(pal.accent[style === 'pixel' ? 3 : 4]); ctx.fill();
      if (style !== 'pixel') { ctx.strokeStyle = rgb(pal.accent[1]); ctx.lineWidth = 1; ctx.stroke(); }
    }
  }

  function drawEars(ctx, g, S, style) {
    const ph = g.ph, H = g.head, pal = g.pal, kind = ph.ears && ph.ears.kind;
    if (!kind || kind === 'none') return;
    const es = Math.max(0.05 * g.s, ph.ears.size * g.s), fx = lerp(H.back, H.front, 0.28), r = H.rAt(fx), ang = ph.ears.angle || 0;
    const ink = style === 'pixel' ? null : rgb(pal.body[0], style === 'cel' ? 1 : 0.8);
    for (const side of [-1, 1]) {
      let P, I;
      if (kind === 'pointed') {
        const tip = H.at(fx - es * (0.55 - 0.35 * ang), side * (r * 0.75 + es * 1.05));
        P = [H.at(fx + es * 0.45, side * r * 0.55), tip, H.at(fx - es * 0.5, side * r * 0.6)];
        I = [H.at(fx + es * 0.25, side * r * 0.7), H.at(fx - es * (0.45 - 0.3 * ang), side * (r * 0.75 + es * 0.75)), H.at(fx - es * 0.3, side * r * 0.72)];
        polyPath(ctx, P.map(S)); ctx.fillStyle = rgb(pal.body[3]); ctx.fill(); if (ink) { ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke(); }
        polyPath(ctx, I.map(S)); ctx.fillStyle = rgb(pal.belly[style === 'pixel' ? 3 : 4]); ctx.fill();
      } else if (kind === 'round') {
        const c = S(H.at(fx - es * 0.15, side * (r * 0.72 + es * 0.4))), rr = es * 0.62 * S.k;
        ellipse(ctx, c[0], c[1], rr, rr, 0); ctx.fillStyle = rgb(pal.body[3]); ctx.fill(); if (ink) { ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke(); }
        ellipse(ctx, c[0], c[1], rr * 0.55, rr * 0.55, 0); ctx.fillStyle = rgb(pal.belly[style === 'pixel' ? 3 : 4]); ctx.fill();
      } else { // long: lying back along the neck
        const c = S(H.at(fx - es * 0.95, side * (r * 0.62 + es * 0.22))), rot = Math.atan2(-H.fw[1], -H.fw[0]) + side * (-0.32 - 0.2 * ang) * -1;
        const a = Math.atan2(H.fw[1], H.fw[0]) + Math.PI - side * (0.3 + 0.2 * ang);
        ellipse(ctx, c[0], c[1], es * 1.25 * S.k, es * 0.4 * S.k, a); ctx.fillStyle = rgb(pal.body[3]); ctx.fill(); if (ink) { ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke(); }
        ellipse(ctx, c[0], c[1], es * 0.9 * S.k, es * 0.18 * S.k, a); ctx.fillStyle = rgb(pal.belly[style === 'pixel' ? 3 : 4]); ctx.fill();
        void rot;
      }
    }
  }
  function drawHorns(ctx, g, S, style) {
    const ph = g.ph, H = g.head, pal = g.pal, hn = ph.horns;
    if (!hn || !(hn.count > 0) || !(hn.length > 0.015)) return;
    const hl = hn.length * g.s, hw = Math.max(0.018 * g.s, hn.width * g.s * (0.6 + 0.4 * Math.min(1, hn.length * 4)));
    const list = hn.count === 1 ? [{ side: 0, t: 0.55 }] : [{ side: -1, t: 0.32 }, { side: 1, t: 0.32 }];
    for (const h of list) {
      const fx = lerp(H.back, H.front, h.t), r = H.rAt(fx), lz = h.side * r * (0.4 + 0.3 * (hn.spread || 0));
      // seen from above a horn points mostly up, so it shows short: forward for one, back and out for two
      const len = hl * (h.side ? 0.75 : 0.5);
      const dirA = h.side ? Math.PI - h.side * (0.45 + 0.6 * (hn.spread || 0)) : 0;
      const cu = (hn.curve || 0) * 0.6 * (h.side || 1);
      const d = [Math.cos(dirA), Math.sin(dirA)], dn = [-d[1], d[0]];
      const base = [fx, lz];
      const loc = (a, b) => H.at(base[0] + d[0] * a + dn[0] * b, base[1] + d[1] * a + dn[1] * b);
      const P = [loc(0, -hw), loc(len * 0.5, -hw * 0.6 + cu * len * 0.25), loc(len, cu * len * 0.45), loc(len * 0.5, hw * 0.6 + cu * len * 0.25), loc(0, hw)].map(S);
      smoothPath(ctx, P); ctx.fillStyle = rgb(pal.horn[3]); ctx.fill();
      if (style !== 'pixel') { ctx.strokeStyle = rgb(pal.horn[0], style === 'cel' ? 1 : 0.85); ctx.lineWidth = style === 'cel' ? 1.5 : 1; ctx.stroke(); }
      const tipP = S(loc(len * 0.75, cu * len * 0.35));
      ctx.fillStyle = rgb(pal.horn[5]); ctx.beginPath(); ctx.arc(tipP[0], tipP[1], Math.max(0.6, hw * S.k * 0.3), 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawDecor(ctx, g, S, style) {
    const ph = g.ph, H = g.head, pal = g.pal, d = ph.decor;
    if (!d || d.kind === 'none' || d.kind === 'spikes') return;
    const sz = (0.06 + 0.12 * (d.size || 0.5)) * g.s;
    if (d.kind === 'antennae') {
      const L = (0.12 + 0.22 * (d.size || 0.5)) * g.s;
      for (const side of [-1, 1]) {
        const fx = lerp(H.back, H.front, 0.62), r = H.rAt(fx);
        const a = S(H.at(fx, side * r * 0.35)), c = S(H.at(fx + L * 0.55, side * (r * 0.45 + L * 0.15))), e = S(H.at(fx + L * 0.85, side * (r * 0.5 + L * 0.5)));
        ctx.strokeStyle = rgb(pal.dark[style === 'pixel' ? 1 : 1]); ctx.lineWidth = Math.max(1, 0.012 * g.s * S.k); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(c[0], c[1], e[0], e[1]); ctx.stroke();
        ctx.beginPath(); ctx.arc(e[0], e[1], Math.max(1, 0.03 * g.s * S.k), 0, Math.PI * 2); ctx.fillStyle = rgb(pal.petal[3]); ctx.fill();
      }
    } else if (d.kind === 'sprout') {
      const c = H.at(lerp(H.back, H.front, 0.4), 0), cs = S(c);
      for (const side of [-1, 1]) {
        const tip = S(H.at(lerp(H.back, H.front, 0.4) - sz * 0.6, side * sz * 0.9)), mx = (cs[0] + tip[0]) / 2, my = (cs[1] + tip[1]) / 2;
        ellipse(ctx, mx, my, Math.hypot(tip[0] - cs[0], tip[1] - cs[1]) / 2 + 0.5, sz * S.k * 0.28, Math.atan2(tip[1] - cs[1], tip[0] - cs[0]));
        ctx.fillStyle = rgb(pal.leaf[3]); ctx.fill();
        if (style !== 'pixel') { ctx.strokeStyle = rgb(pal.leaf[1]); ctx.lineWidth = 1; ctx.stroke(); }
      }
      ctx.beginPath(); ctx.arc(cs[0], cs[1], Math.max(1, sz * S.k * 0.16), 0, Math.PI * 2); ctx.fillStyle = rgb(pal.leaf[1]); ctx.fill();
    } else if (d.kind === 'flower') {
      const fx = lerp(H.back, H.front, 0.38), c = S(H.at(fx, 0)), pr = sz * S.k * 0.42;
      for (let k = 0; k < 5; k++) {
        const a = H.th * -1 + k * Math.PI * 2 / 5;
        const p = [c[0] + Math.cos(a) * pr, c[1] + Math.sin(a) * pr];
        ellipse(ctx, p[0], p[1], pr * 0.75, pr * 0.55, a); ctx.fillStyle = rgb(pal.petal[style === 'pixel' ? 3 : 4]); ctx.fill();
        if (style === 'cel') { ctx.strokeStyle = rgb(pal.petal[1]); ctx.lineWidth = 1; ctx.stroke(); }
      }
      ctx.beginPath(); ctx.arc(c[0], c[1], pr * 0.5, 0, Math.PI * 2); ctx.fillStyle = rgb(pal.pollen[3]); ctx.fill();
    }
  }
  function drawMouth(ctx, g, S, style) {
    const ph = g.ph, H = g.head, pal = g.pal, kind = (ph.mouth && ph.mouth.kind) || 'jaw', mo = clamp(g.mouthOpen, 0, 1);
    const st = H.st[H.st.length - 1], rl = st.r, fx = H.front, s = g.s;
    const dark = rgb(pal.dark[1]), inner = rgb(pal.tongue[1]);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const line = (pts, col, wd) => { const P = pts.map(S); ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]); ctx.strokeStyle = col; ctx.lineWidth = wd; ctx.stroke(); };
    const wid = (ph.mouth && ph.mouth.width) || 0.2;
    if (kind === 'beak') {
      const bl = rl * (0.9 + 1.2 * wid), half = rl * 0.62;
      for (const side of [-1, 1]) {
        const swing = side * mo * 0.35;
        const tip = H.at(fx - rl * 0.1 + Math.cos(swing) * bl, Math.sin(swing) * bl * 0.6 + side * mo * rl * 0.1);
        const P = [H.at(fx - rl * 0.55, side * half), tip, H.at(fx - rl * 0.35, side * 0.02 * rl)].map(S);
        polyPath(ctx, P); ctx.fillStyle = rgb(pal.beak[3]); ctx.fill();
        if (style !== 'pixel') { ctx.strokeStyle = rgb(pal.beak[0], 0.85); ctx.lineWidth = 1; ctx.stroke(); }
      }
      if (mo > 0.15) line([H.at(fx - rl * 0.3, 0), H.at(fx + bl * 0.6, 0)], inner, Math.max(1, mo * rl * S.k * 0.5));
      const n = S(H.at(fx - rl * 0.25, rl * 0.25)); ctx.fillStyle = rgb(pal.beak[1]); ctx.fillRect(n[0], n[1], 1, 1);
      return;
    }
    if (kind === 'mandibles') {
      for (const side of [-1, 1]) {
        const open = 0.25 + 0.5 * mo;
        line([H.at(fx - rl * 0.35, side * rl * 0.55), H.at(fx + rl * 0.25, side * rl * (0.6 + open * 0.4)), H.at(fx + rl * 0.7, side * rl * (0.2 + open * 0.35))], rgb(pal.dark[style === 'pixel' ? 1 : 0]), Math.max(1.4, 0.028 * s * S.k));
      }
      return;
    }
    if (kind === 'slit') {
      if (mo > 0.12) { const c = S(H.at(fx - rl * 0.28, 0)); ellipse(ctx, c[0], c[1], rl * 0.18 * S.k * (0.5 + mo), rl * 0.45 * S.k, H.th * -1); ctx.fillStyle = inner; ctx.fill(); }
      line([H.at(fx - rl * 0.28, -rl * 0.45), H.at(fx - rl * 0.22, 0), H.at(fx - rl * 0.28, rl * 0.45)], dark, 1);
      return;
    }
    if (kind === 'tongue') {
      if (mo > 0.1) {
        const tl = rl * (0.4 + 0.9 * mo), c = H.at(fx + tl * 0.4, 0), cs = S(c);
        ellipse(ctx, cs[0], cs[1], tl * 0.6 * S.k, rl * 0.22 * S.k, Math.atan2(H.fw[1], H.fw[0])); ctx.fillStyle = rgb(pal.tongue[3]); ctx.fill();
        line([H.at(fx + tl * 0.8, 0), H.at(fx + tl * 1.05, rl * 0.12)], rgb(pal.tongue[2]), 1);
        line([H.at(fx + tl * 0.8, 0), H.at(fx + tl * 1.05, -rl * 0.12)], rgb(pal.tongue[2]), 1);
      }
      line([H.at(fx - rl * 0.3, -rl * 0.3), H.at(fx - rl * 0.18, 0), H.at(fx - rl * 0.3, rl * 0.3)], dark, 1);
      return;
    }
    // jaw: from above the lower jaw drops and the mouth shows as a dark crescent at the snout's front
    if (mo > 0.1) {
      const c = S(H.at(fx - rl * 0.3, 0));
      ellipse(ctx, c[0], c[1], rl * S.k * 0.22 * (0.4 + mo), rl * S.k * (0.5 + 0.2 * wid), Math.atan2(H.fw[1], H.fw[0])); ctx.fillStyle = inner; ctx.fill();
    }
    const smile = (ph.mouth && ph.mouth.smile) || 0;
    line([H.at(fx - rl * (0.5 + 0.2 * smile), -rl * 0.62), H.at(fx - rl * 0.2, -rl * 0.3), H.at(fx - rl * 0.12, 0), H.at(fx - rl * 0.2, rl * 0.3), H.at(fx - rl * (0.5 + 0.2 * smile), rl * 0.62)], dark, 1);
    if (ph.fangs > 0.4) for (const side of [-1, 1]) {
      const P = [H.at(fx - rl * 0.22, side * rl * 0.32), H.at(fx - rl * 0.24, side * rl * 0.18), H.at(fx + rl * 0.05 * ph.fangs, side * rl * 0.25)].map(S);
      polyPath(ctx, P); ctx.fillStyle = rgb(pal.horn[5]); ctx.fill();
    }
  }
  function drawEyes(ctx, g, S, style) {
    const ph = g.ph, H = g.head, pal = g.pal, e = ph.eyes || { size: 0.5, spacing: 0.5, height: 0.5, round: 0.5, slant: 0 };
    const eyeT = 0.5 + 0.15 * (1 - e.spacing), fx = lerp(H.back, H.front, eyeT), r = H.rAt(fx);
    let eR = Math.min(0.55 * H.rmax, Math.max(0.022 * g.s, e.size * H.rmax * 0.42)) * 1.4;
    eR = Math.min(eR, r * 0.55);
    const lat = clamp(r * (0.32 + 0.45 * e.spacing) * (1 - 0.25 * (e.height || 0)), eR * 1.05, r - eR * 0.55);
    const l = lightDir(g.sun), th = Math.atan2(H.fw[1], H.fw[0]);
    for (const side of [-1, 1]) {
      const c = S(H.at(fx, side * lat)), rx = eR * S.k * (1.05 + 0.15 * (1 - e.round)), ry = eR * S.k * (0.82 + 0.15 * e.round);
      const rot = th + side * (e.slant || 0) * 0.35;
      if (g.happy && !g.blink) { // happy: closed, curved up
        ctx.beginPath(); ctx.ellipse(c[0], c[1], rx * 0.75, ry * 0.75, rot, Math.PI * 0.1 + (side > 0 ? 0 : 0), Math.PI * 0.9); ctx.strokeStyle = rgb(PUPIL); ctx.lineWidth = Math.max(1, eR * S.k * 0.35); ctx.stroke();
        continue;
      }
      if (style !== 'pixel') { ellipse(ctx, c[0], c[1], rx + 1, ry + 1, rot); ctx.fillStyle = rgb(pal.body[0], 0.9); ctx.fill(); }
      if (g.blink) {
        ellipse(ctx, c[0], c[1], rx, ry, rot); ctx.fillStyle = rgb(pal.body[2]); ctx.fill();
        ctx.beginPath(); ctx.moveTo(c[0] - Math.sin(rot) * ry * -1 - Math.cos(rot) * rx * 0.8, c[1] - Math.sin(rot) * rx * 0.8); ctx.lineTo(c[0] + Math.cos(rot) * rx * 0.8, c[1] + Math.sin(rot) * rx * 0.8);
        ctx.strokeStyle = rgb(pal.body[0]); ctx.lineWidth = 1; ctx.stroke();
        continue;
      }
      ellipse(ctx, c[0], c[1], rx, ry, rot); ctx.fillStyle = rgb(EYE_WHITE); ctx.fill();
      // the pupil looks ahead, toward where the head is turning
      const pr = Math.min(rx, ry) * 0.62, look = clamp(g.look, -0.8, 0.8);
      const px = c[0] + Math.cos(th) * rx * 0.28 + Math.cos(th + Math.PI / 2) * -look * ry * 0.3, py = c[1] + Math.sin(th) * rx * 0.28 + Math.sin(th + Math.PI / 2) * -look * ry * 0.3;
      ellipse(ctx, px, py, pr, pr * (0.9 + 0.1 * e.round), rot);
      ctx.fillStyle = e.glow > 0.3 ? rgb(mix(PUPIL, pal.petal[4], 0.5)) : rgb(PUPIL); ctx.fill();
      if (style !== 'pixel' || pr > 1.2) { ctx.beginPath(); ctx.arc(px + l[0] * pr * 0.4, py + l[1] * pr * 0.4, Math.max(0.6, pr * 0.32), 0, Math.PI * 2); ctx.fillStyle = rgb(EYE_WHITE); ctx.fill(); }
    }
    if (ph.blush > 0.35 && style !== 'pixel') for (const side of [-1, 1]) {
      const c = S(H.at(fx - eR * 1.2, side * Math.min(r * 0.85, lat + eR * 0.9)));
      ellipse(ctx, c[0], c[1], eR * S.k * 0.8, eR * S.k * 0.5, th); ctx.fillStyle = rgb(pal.tongue[4], 0.35 * Math.min(1, ph.blush)); ctx.fill();
    }
  }

  function headTube(g, S) {
    const H = g.head, spine = [];
    for (let k = 0; k < H.st.length; k++) {
      const q = H.st[k], p = S(H.at(q.fx, 0)); spine.push({ x: p[0], y: p[1], r: q.r * S.k });
      if (k < H.st.length - 1) { const q2 = H.st[k + 1], p2 = S(H.at((q.fx + q2.fx) / 2, 0)); spine.push({ x: p2[0], y: p2[1], r: (q.r + q2.r) / 2 * S.k }); }
    }
    return spine;
  }

  // The creature itself (no shadow): legs, body, wings, head and face.
  function paintCreature(ctx, g, S, style) {
    const pal = g.pal, light = lightDir(g.sun);
    drawLegs(ctx, g, S, style);
    const avgW = g.f.wid.reduce((a, b) => a + b, 0) / g.f.n;
    paintTube(ctx, { path: g.body.map(S), spine: bodySpine(g, S), ramp: pal.body, rim: pal.rim, marks: bodyMarks(g, S, style), gloss: g.ph.gloss || 0, band: avgW * S.k * 0.42 }, style, light);
    if (g.ph.decor && g.ph.decor.kind === 'spikes') drawSpikes(ctx, g, S, style);
    drawWings(ctx, g, S, style);
    drawEars(ctx, g, S, style);
    paintTube(ctx, { path: g.head.pts.map(S), spine: headTube(g, S), ramp: pal.body, rim: pal.rim, gloss: g.ph.gloss || 0, band: g.head.rmax * S.k * 0.4 }, style, light);
    drawMouth(ctx, g, S, style);
    drawHorns(ctx, g, S, style);
    drawDecor(ctx, g, S, style);
    drawEyes(ctx, g, S, style);
  }

  // The shadow silhouette as one path (a union: overlapping parts don't darken twice).
  function shadowPath(ctx, g, view) {
    const sun = g.sun, R = g.R, M = (p) => [view.ox + p[0] * view.scale, view.oy + p[1] * view.scale];
    const lift = g.lift, bob = g.bob;
    const so = (h) => shadowOffset(sun, Math.max(0, h));
    const body = cw(outline(g.w, { frame: g.f, widthScale: g.widthScale, shift: (i) => so(R.joints[i].y + bob + lift) }).map(M));
    smoothPath(ctx, body);
    const hd = headOf(g.w, { frame: g.f, look: g.look, nod: g.nod, shift: so(R.joints[0].y + bob + lift + 0.02 * g.s) });
    smoothPath(ctx, cw(hd.pts.map(M)), false);
    const lr = Math.max(0.8, R.legW * view.scale * 0.55);
    for (const L of g.legs) {
      const hs = so(L.hipY + lift), fs = so(L.up), ks = so((L.hipY + lift) * 0.55 + L.up * 0.45);
      const pts = [[L.hip[0] + hs[0], L.hip[1] + hs[1]], [L.knee[0] + ks[0], L.knee[1] + ks[1]], [L.foot[0] + fs[0], L.foot[1] + fs[1]]].map(M);
      for (let sgm = 0; sgm < 2; sgm++) for (let k = 0; k <= 6; k++) {
        const t = k / 6, x = lerp(pts[sgm][0], pts[sgm + 1][0], t), y = lerp(pts[sgm][1], pts[sgm + 1][1], t);
        ctx.moveTo(x + lr, y); ctx.arc(x, y, lr, 0, Math.PI * 2);
      }
      const fr = Math.max(1, R.footR * view.scale * 0.9);
      ctx.moveTo(pts[2][0] + fr, pts[2][1]); ctx.arc(pts[2][0], pts[2][1], fr, 0, Math.PI * 2);
    }
  }
  function paintShadow(ctx, g, view, style) {
    const a = shadowAlpha(g.sun);
    if (a <= 0.01) return;
    ctx.save();
    ctx.fillStyle = rgb(SHADOW_RGB, a);
    if (style === 'original') {
      const blur = 1.2 + 2.2 * (g.sun ? clamp(1 - g.sun.L[1], 0, 1) : 0.5) * view.scale / 80;
      ctx.filter = 'blur(' + blur.toFixed(1) + 'px)';
    }
    ctx.beginPath(); shadowPath(ctx, g, view); ctx.fill('nonzero');
    ctx.restore();
  }

  // ---------- the skeleton overlay ----------
  function drawSkeleton(ctx, g, view, out) {
    const w = g.w, R = g.R, f = g.f, M = (p) => [view.ox + p[0] * view.scale, view.oy + p[1] * view.scale], k = view.scale;
    ctx.save();
    ctx.lineWidth = 1; ctx.lineCap = 'round';
    // per-joint radius circles
    ctx.strokeStyle = 'rgba(120,220,255,0.55)';
    f.pts.forEach((p, i) => { const q = M(p); ctx.beginPath(); ctx.arc(q[0], q[1], f.wid[i] * k, 0, Math.PI * 2); ctx.stroke(); });
    // angle-limit wedges: how far joint i may turn from joint i-1, drawn behind it
    for (let i = 1; i < f.n; i++) {
      const q = M(f.pts[i]), base = f.ang[i - 1] + Math.PI, lim = R.bend[i] || 0.3, rr = Math.max(5, (w.chain.links[i] || 0.1) * k * 0.75);
      const a0 = -(base + lim), a1 = -(base - lim); // screen angles (y down)
      ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.arc(q[0], q[1], rr, a0, a1); ctx.closePath();
      ctx.fillStyle = 'rgba(255,214,90,0.22)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,214,90,0.6)'; ctx.stroke();
      const dir = -(f.ang[i] + Math.PI);
      ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0] + Math.cos(dir) * rr, q[1] + Math.sin(dir) * rr); ctx.strokeStyle = 'rgba(255,150,60,0.9)'; ctx.stroke();
    }
    // the links and the joints
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); f.pts.forEach((p, i) => { const q = M(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke();
    f.pts.forEach((p, i) => { const q = M(p); ctx.beginPath(); ctx.arc(q[0], q[1], i === R.anchor ? 3 : 2, 0, Math.PI * 2); ctx.fillStyle = i === 0 ? '#ff7a9a' : i === R.anchor ? '#ffd45a' : '#ffffff'; ctx.fill(); });
    // heading of the head
    const h0 = M(f.pts[0]), fw = fwdOf(f.ang[0]);
    ctx.beginPath(); ctx.moveTo(h0[0], h0[1]); ctx.lineTo(h0[0] + fw[0] * 0.5 * R.s * k, h0[1] + fw[1] * 0.5 * R.s * k); ctx.strokeStyle = '#ff7a9a'; ctx.stroke();
    // legs: bones, step radius round each rest spot, the swing target, planted (filled) or swinging (hollow)
    const D = Math.max(0.05 * R.legLen, (w.gaits && w.gaits.walk && w.gaits.walk.D) || 0.3 * R.legLen);
    g.legs.forEach((L, i) => {
      const hp = R.hips[i], p = f.pts[hp.joint], fwj = fwdOf(f.ang[hp.joint]), rt = rightOf(f.ang[hp.joint]);
      const rest = [p[0] + fwj[0] * hp.foot[0] + rt[0] * hp.foot[2], p[1] + fwj[1] * hp.foot[0] + rt[1] * hp.foot[2]];
      const rs = M(rest);
      ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(160,255,170,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(rs[0], rs[1], 1.0 * D * k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      const a = M(L.hip), b = M(L.knee), c = M(L.foot);
      ctx.strokeStyle = 'rgba(160,255,170,0.95)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
      ctx.beginPath(); ctx.arc(b[0], b[1], 2, 0, Math.PI * 2); ctx.fillStyle = '#a0ffaa'; ctx.fill();
      ctx.beginPath(); ctx.arc(c[0], c[1], 3, 0, Math.PI * 2);
      if (L.planted) { ctx.fillStyle = '#5fe07a'; ctx.fill(); } else { ctx.strokeStyle = '#ffffff'; ctx.stroke(); }
      const ft = w.feet[i];
      if (ft && ft.target && !ft.planted) {
        const t = M(ft.target); ctx.strokeStyle = '#ffe36a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(t[0] - 3, t[1] - 3); ctx.lineTo(t[0] + 3, t[1] + 3); ctx.moveTo(t[0] + 3, t[1] - 3); ctx.lineTo(t[0] - 3, t[1] + 3); ctx.stroke();
      }
    });
    // the goal, if it has one
    const goal = out && out.goal;
    if (goal) { const q = M([goal.x, goal.z]); ctx.strokeStyle = goal.food ? '#ff9a6a' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }

  // ---------- the Pixel look ----------
  function canvasMaker(opts) {
    if (opts.canvas) return opts.canvas;
    if (typeof OffscreenCanvas !== 'undefined') return (w, h) => new OffscreenCanvas(w, h);
    if (typeof document !== 'undefined') return (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
    return null;
  }
  const quantCache = new WeakMap();
  function quantColours(pal) {
    let q = quantCache.get(pal);
    if (!q) {
      q = [];
      for (const k of ['body', 'belly', 'mark', 'dark', 'wing', 'accent', 'tongue', 'petal', 'leaf', 'tip', 'horn', 'beak', 'pollen']) if (pal[k]) for (let i = 1; i < 6; i++) q.push(pal[k][i].map(Math.round));
      q.push(EYE_WHITE, PUPIL);
      quantCache.set(pal, q);
    }
    return q;
  }
  // Snap every pixel to the genome's ramps, make alpha hard, and put a 1px ink line round the outside.
  function quantise(cx, W, H, pal, ink) {
    const img = cx.getImageData(0, 0, W, H), d = img.data, cols = quantColours(pal), memo = new Map();
    const solid = new Uint8Array(W * H);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      if (d[i + 3] < 110) { d[i + 3] = 0; continue; }
      const a = d[i + 3] / 255, r = d[i] / a, gg = d[i + 1] / a, b = d[i + 2] / a; // un-premultiply the edge pixels
      const key = ((r >> 2) << 12) | ((gg >> 2) << 6) | (b >> 2);
      let c = memo.get(key);
      if (!c) { let bd = Infinity; for (const q of cols) { const e = (q[0] - r) ** 2 * 0.3 + (q[1] - gg) ** 2 * 0.59 + (q[2] - b) ** 2 * 0.11; if (e < bd) { bd = e; c = q; } } memo.set(key, c); }
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; solid[p] = 1;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (solid[p]) continue;
      if ((x > 0 && solid[p - 1]) || (x < W - 1 && solid[p + 1]) || (y > 0 && solid[p - W]) || (y < H - 1 && solid[p + W])) {
        d[p * 4] = ink[0]; d[p * 4 + 1] = ink[1]; d[p * 4 + 2] = ink[2]; d[p * 4 + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
  }
  function hardAlpha(cx, W, H) {
    const img = cx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 100 ? 255 : 0;
    cx.putImageData(img, 0, 0);
  }

  // Screen bounds of everything drawn (with the shadow), for the Pixel look's small canvas.
  function boundsOf(g, view, S) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (q) => { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; };
    g.body.forEach((p) => add(S(p))); g.head.pts.forEach((p) => add(S(p)));
    g.legs.forEach((L) => { add(S(L.foot)); add(S(L.knee)); });
    const reach = (g.R.joints[0].y + g.lift + 0.1 * g.s) * MAX_RATIO * view.scale;
    const pad = 0.4 * g.s * view.scale + 4;
    return { x0: x0 - reach - pad, y0: y0 - reach - pad, x1: x1 + reach + pad, y1: y1 + reach + pad };
  }

  function drawPixel(ctx, g, view, opts) {
    const make = canvasMaker(opts);
    if (!make) return false;
    const px = Math.max(1, Math.round(opts.pixel || 3));
    const box = boundsOf(g, view, makeMap(view, g));
    const X0 = Math.floor(box.x0 / px) * px, Y0 = Math.floor(box.y0 / px) * px;
    const W = Math.max(1, Math.ceil((box.x1 - X0) / px) + 1), H = Math.max(1, Math.ceil((box.y1 - Y0) / px) + 1);
    const low = { scale: view.scale / px, ox: (view.ox - X0) / px, oy: (view.oy - Y0) / px };
    const Sl = makeMap(low, g);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (opts.shadow !== false) {
      const sc = make(W, H), sx = sc.getContext('2d', { willReadFrequently: true });
      sx.fillStyle = '#000'; sx.beginPath(); shadowPath(sx, g, low); sx.fill('nonzero');
      hardAlpha(sx, W, H);
      ctx.globalAlpha = shadowAlpha(g.sun) * 0.9;
      ctx.drawImage(sc, X0, Y0, W * px, H * px);
      ctx.globalAlpha = 1;
    }
    const cc = make(W, H), cx = cc.getContext('2d', { willReadFrequently: true });
    paintCreature(cx, g, Sl, 'pixel');
    quantise(cx, W, H, g.pal, g.pal.body[0]);
    ctx.drawImage(cc, X0, Y0, W * px, H * px);
    ctx.restore();
    return { x0: X0, y0: Y0, x1: X0 + W * px, y1: Y0 + H * px };
  }

  // ---------- draw ----------
  function draw(ctx, w, view, opts) {
    opts = opts || {};
    const style = normStyle(opts.style);
    const g = build(w, opts);
    g.sun = opts.sun || null;
    const S = makeMap(view, g);
    let box = null;
    if (style === 'pixel') box = drawPixel(ctx, g, view, opts);
    if (!box) {
      if (opts.shadow !== false) paintShadow(ctx, g, view, style);
      ctx.save();
      paintCreature(ctx, g, S, style === 'pixel' ? 'pixel' : style);
      ctx.restore();
      box = boundsOf(g, view, S);
    }
    if (opts.skeleton) drawSkeleton(ctx, g, view, opts.out);
    return { box, head: S(g.head.at(g.head.front, 0)), style };
  }

  // Only the skeleton overlay (for drawing it above the day/night tint).
  function skeleton(ctx, w, view, opts) {
    opts = opts || {};
    const g = build(w, opts); g.sun = opts.sun || null;
    drawSkeleton(ctx, g, view, opts.out);
  }

  const api = { rig, draw, skeleton, outline, legIK2D, shadowOffset, shadowAlpha, frameOf, headOf, spineAt, paletteOf, patternOf, build,
    STYLES, SPLAY, FORE, BONE, MAX_RATIO, SHADOW_RGB };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureTopdown = api;
})(typeof window !== 'undefined' ? window : globalThis);
