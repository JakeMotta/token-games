/* Creatures prototype: from body numbers (a phenotype) to a 3D shape made of simple pieces (the video's "step 2:
   parts"). Each body piece is a stack of rings joined by round cones (a sausage); legs, wings, horns, ears and
   decorations are added on; the renderer melts them together with a smooth union (step 3) and asks every pixel
   whether it is inside (step 4). Eyes, mouth and blush are flat face marks (decals) placed on the surface.
   Coordinates: x forward (the way the creature faces), y up, z to its right; the ground is y = 0. No DOM. */
(function (root) {
  'use strict';

  // Primitive kinds.
  const CONE = 0;      // round cone between a and b, radii r1 -> r2, cross-section squashed by sy along frame u
  const ELLIPSOID = 1; // centre a, radii rx (along axis), ry (along u), rz (along side)
  const TRI = 2;       // a thin plate: triangle a, b, c with half thickness r1

  // Materials (what colour a piece takes).
  const MAT = { BODY: 0, ACCENT: 1, WING: 2, LEAF: 3, PETAL: 4, DARK: 5, EGG: 6, SHELL_IN: 7 };

  const v = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    // rotate p around the vertical axis through o by angle
    rotY: (p, o, ang) => { const c = Math.cos(ang), s = Math.sin(ang), x = p[0] - o[0], z = p[2] - o[2]; return [o[0] + c * x + s * z, p[1], o[2] - s * x + c * z]; },
    // rotate p around the x axis through o
    rotX: (p, o, ang) => { const c = Math.cos(ang), s = Math.sin(ang), y = p[1] - o[1], z = p[2] - o[2]; return [p[0], o[1] + c * y - s * z, o[2] + s * y + c * z]; },
    // rotate p around the z axis through o (positive tips +x up)
    rotZ: (p, o, ang) => { const c = Math.cos(ang), s = Math.sin(ang), x = p[0] - o[0], y = p[1] - o[1]; return [o[0] + c * x - s * y, o[1] + s * x + c * y, p[2]]; },
  };

  // A frame for a segment: axis along it, u its "up" (in the plane of the body), side across.
  function frame(axis, upHint) {
    const ax = v.norm(axis);
    let side = v.cross(ax, upHint || [0, 1, 0]);
    if (v.len(side) < 1e-4) side = v.cross(ax, [1, 0, 0]);
    side = v.norm(side);
    const u = v.norm(v.cross(side, ax));
    return { ax, u, side };
  }

  function cone(a, b, r1, r2, sy, piece, mat, extra) {
    const f = frame(v.sub(b, a), extra && extra.upHint);
    const p = { k: CONE, a, b, r1, r2, sy: sy || 1, ax: f.ax, u: f.u, side: f.side, len: v.len(v.sub(b, a)), piece, mat,
      t0: 0, t1: 1, pieceLen: 1 };
    return Object.assign(p, extra || {});
  }
  function ellipsoid(c, axis, rx, ry, rz, piece, mat, extra) {
    const f = frame(axis, extra && extra.upHint);
    return Object.assign({ k: ELLIPSOID, a: c, rx, ry, rz, ax: f.ax, u: f.u, side: f.side, piece, mat, t0: 0, t1: 1, pieceLen: 1 }, extra || {});
  }
  function tri(a, b, c, th, piece, mat) {
    const f = frame(v.sub(b, a), v.cross(v.sub(b, a), v.sub(c, a)));
    return { k: TRI, a, b, c, r1: th, ax: f.ax, u: f.u, side: f.side, piece, mat, t0: 0, t1: 1, pieceLen: 1 };
  }

  // Bounding sphere of a primitive (used by the renderer to skip pieces a ray can't touch).
  function bound(p) {
    if (p.k === CONE) { const c = v.lerp(p.a, p.b, 0.5); return [c[0], c[1], c[2], p.len / 2 + Math.max(p.r1, p.r2) * Math.max(1, p.sy)]; }
    if (p.k === ELLIPSOID) return [p.a[0], p.a[1], p.a[2], Math.max(p.rx, p.ry, p.rz)];
    const c = v.mul(v.add(v.add(p.a, p.b), p.c), 1 / 3);
    return [c[0], c[1], c[2], Math.max(v.len(v.sub(p.a, c)), v.len(v.sub(p.b, c)), v.len(v.sub(p.c, c))) + p.r1];
  }

  // A spine in the x-y plane: n points from `start`, heading `angle` (radians from +x, counter-clockwise toward +y),
  // turning by `curve` radians over its length.
  function spine(start, angle, length, curve, n) {
    const pts = [start], dirs = [];
    const seg = length / Math.max(1, n - 1);
    let p = start;
    for (let i = 0; i < n - 1; i++) {
      const a = angle + curve * ((i + 0.5) / Math.max(1, n - 1));
      const d = [Math.cos(a), Math.sin(a), 0];
      dirs.push(d);
      p = v.add(p, v.mul(d, seg));
      pts.push(p);
    }
    if (!dirs.length) dirs.push([Math.cos(angle), Math.sin(angle), 0]);
    dirs.push(dirs[dirs.length - 1]);
    return { pts, dirs };
  }

  // Joins a ring stack into round cones. rings: [{w, h}] already scaled.
  function sausage(prims, sp, rings, piece, mat, k, upHint) {
    const n = rings.length;
    const total = sp.pts.length > 1 ? sp.pts.reduce((s, p, i) => (i ? s + v.len(v.sub(p, sp.pts[i - 1])) : 0), 0) : 0;
    for (let i = 0; i < n - 1; i++) {
      const a = sp.pts[i], b = sp.pts[i + 1];
      const r1 = rings[i].w, r2 = rings[i + 1].w;
      const sy = ((rings[i].h + rings[i + 1].h) / 2) / ((r1 + r2) / 2);
      if (v.len(v.sub(b, a)) < 1e-4) {
        prims.push(ellipsoid(a, [1, 0, 0], r1, rings[i].h, r1, piece, mat, { k2: k, t0: i / (n - 1), t1: i / (n - 1), pieceLen: total }));
        continue;
      }
      prims.push(cone(a, b, r1, r2, sy, piece, mat, { k2: k, t0: i / (n - 1), t1: (i + 1) / (n - 1), pieceLen: total, upHint }));
    }
  }

  // Point on a spine at fraction t (0..1) and the ring size there.
  function along(sp, rings, t) {
    const n = sp.pts.length, f = Math.max(0, Math.min(0.9999, t)) * (n - 1), i = Math.floor(f), u = f - i;
    const j = Math.min(n - 1, i + 1);
    return { p: v.lerp(sp.pts[i], sp.pts[j], u), d: v.norm(v.lerp(sp.dirs[i], sp.dirs[j], u)),
      w: rings[i].w + (rings[j].w - rings[i].w) * u, h: rings[i].h + (rings[j].h - rings[i].h) * u };
  }

  // Two-bone leg from hip to foot (two equal bones, len in all); the knee bends toward `bend` (a unit vector).
  // `stretch` is hip-to-foot over the leg length: above 1 the foot can't be reached and `end` stops short of it.
  function legIK(hip, foot, len, bend) {
    const d = v.sub(foot, hip), stretch = v.len(d) / len, dist = Math.min(v.len(d), len * 0.999);
    const dir = v.norm(d), mid = v.add(hip, v.mul(dir, dist / 2));
    const h = Math.sqrt(Math.max(0, (len / 2) ** 2 - (dist / 2) ** 2));
    // bend direction made perpendicular to the leg
    const b = v.norm(v.sub(bend, v.mul(dir, v.dot(bend, dir))));
    const knee = v.add(mid, v.mul(b, h));
    const end = v.add(hip, v.mul(dir, dist));
    return { knee, end, stretch };
  }

  // The walk moves the body on its legs: bob (up), sway (sideways), pitch (nose up) and roll (lean right), about the
  // middle of the torso. Feet stay where the walker put them; only hips, torso, head, tail and wings move.
  function bodyTransform(L, body) {
    body = body || {};
    const bob = body.bob || 0, sway = body.sway || 0, pitch = body.pitch || 0, roll = body.roll || 0;
    if (!bob && !sway && !pitch && !roll) return null;
    const o = L.tsp.pts[Math.floor(L.tsp.pts.length / 2)];
    const R = (d) => v.rotX(v.rotZ(d, [0, 0, 0], pitch), [0, 0, 0], roll);
    const T = (p) => { const q = v.rotX(v.rotZ(p, o, pitch), o, roll); return [q[0], q[1] + bob, q[2] + sway]; };
    return { T, R };
  }

  // Rest layout shared by the body and the walker: hip points and where each foot stands.
  function layout(ph) {
    const s = ph.scale;
    const R = (rs) => rs.map((r) => ({ w: r.w * s, h: r.h * s }));
    const torsoR = R(ph.torso.rings), maxH = Math.max(...torsoR.map((r) => r.h));
    const legLen = ph.legs.length * s;
    const pairs = ph.legs.pairs;
    const tLen = ph.torso.length * s;
    // Torso spine built at height 0 first.
    const tsp0 = spine([-tLen / 2 * Math.cos(ph.torso.angle), -tLen / 2 * Math.sin(ph.torso.angle), 0], ph.torso.angle - ph.torso.curve / 2, tLen, ph.torso.curve, torsoR.length);
    const legTs = pairs === 1 ? [0.5] : pairs === 2 ? [0.18, 0.82] : pairs === 3 ? [0.12, 0.5, 0.88] : [];
    const hips0 = [];
    for (const t of legTs) {
      const q = along(tsp0, torsoR, t);
      for (const side of [-1, 1]) hips0.push({ t, side, p: v.add(q.p, [0, -q.h * 0.35, side * q.w * 0.62 * ph.legs.spread]), front: t > 0.5 });
    }
    let H;
    if (pairs > 0) {
      const avgHipY = hips0.reduce((s2, hp) => s2 + hp.p[1], 0) / hips0.length;
      H = legLen * 0.9 - avgHipY;
    } else H = maxH * 0.92;
    const lift = [0, H, 0];
    const tsp = { pts: tsp0.pts.map((p) => v.add(p, lift)), dirs: tsp0.dirs };
    const hips = hips0.map((hp) => Object.assign({}, hp, { p: v.add(hp.p, lift) }));
    const footR = Math.max(ph.legs.foot, ph.legs.width * 0.9) * s;
    const feet = hips.map((hp) => [hp.p[0] + (hp.front ? 0.02 : -0.02) * s, footR * 0.55, hp.p[2] * 1.12]);
    // Legs long enough to reach the ground from where the hips ended up.
    const reach = Math.max(legLen, ...hips.map((hp) => (hp.p[1] - footR * 0.55) / 0.97));
    return { s, torsoR, tsp, hips, feet, legLen: reach, footR, H };
  }

  // Build the creature. pose: { breathe, lookYaw, headNod, tailSway, tailLift, wingFlap, feet (local, like
  // layout().feet, on the ground frame), body: { bob, sway, pitch, roll } (see bodyTransform), blink, expression }.
  // The scene reports each leg's hip, knee, foot and stretch in `legs` (for the walk's debug overlay and tests).
  function build(ph, pose) {
    pose = pose || {};
    const L = layout(ph);
    const s = L.s, prims = [], decals = [];
    const k = (0.035 + 0.06 * ph.fluff) * Math.max(0.6, s); // melt amount for the smooth union
    const breathe = 1 + (pose.breathe || 0) * 0.03;
    const R = (rs, f) => rs.map((r) => ({ w: r.w * s * (f || 1), h: r.h * s * (f || 1) }));

    // Torso
    const torsoR = R(ph.torso.rings, breathe);
    const tsp = L.tsp;
    sausage(prims, tsp, torsoR, 'torso', MAT.BODY, k);
    const front = { p: tsp.pts[tsp.pts.length - 1], d: tsp.dirs[tsp.dirs.length - 1], w: torsoR[torsoR.length - 1].w, h: torsoR[torsoR.length - 1].h };
    const back = { p: tsp.pts[0], d: tsp.dirs[0], w: torsoR[0].w, h: torsoR[0].h };

    // Neck: from the front of the torso, angled up.
    const neckR = R(ph.neck.rings);
    const neckLen = ph.neck.length * s;
    const torsoEndAngle = Math.atan2(front.d[1], front.d[0]);
    let headStart;
    const neckBase = v.add(front.p, v.mul(front.d, -front.w * 0.25));
    if (neckLen > 0.03 * s) {
      const nsp = spine(v.add(neckBase, [0, front.h * 0.2, 0]), torsoEndAngle + ph.neck.angle, neckLen + front.w * 0.5, ph.neck.curve, neckR.length);
      sausage(prims, nsp, neckR, 'neck', MAT.BODY, k);
      headStart = nsp.pts[nsp.pts.length - 1];
    } else headStart = v.add(front.p, v.add(v.mul(front.d, front.w * 0.35), [0, front.h * 0.45, 0]));

    // Head: starts where the neck ends, pointing forward (head.angle tips the snout up or down).
    const headR = R(ph.head.rings);
    const headLen = ph.head.length * s;
    const look = pose.lookYaw || 0;
    let hsp = spine(v.add(headStart, v.mul([Math.cos(ph.head.angle), Math.sin(ph.head.angle), 0], -headR[0].w * 0.2)), ph.head.angle, headLen, ph.head.curve, headR.length);
    const nod = pose.headNod || 0;
    if (nod) hsp = { pts: hsp.pts.map((p) => v.rotZ(p, headStart, nod)), dirs: hsp.dirs.map((d) => v.rotZ(d, [0, 0, 0], nod)) };
    if (look) hsp = { pts: hsp.pts.map((p) => v.rotY(p, headStart, look)), dirs: hsp.dirs.map((d) => v.rotY(d, [0, 0, 0], look)) };
    sausage(prims, hsp, headR, 'head', MAT.BODY, k);

    // Tail: from the back of the torso, pointing back.
    const tailR = R(ph.tail.rings);
    const tailLen = ph.tail.length * s;
    if (tailLen > 0.03 * s) {
      const backAngle = Math.atan2(-back.d[1], -back.d[0]);
      const lift = pose.tailLift || 0;
      let tsp2 = spine(v.add(back.p, v.mul(back.d, back.w * 0.3)), backAngle - ph.tail.angle - lift, tailLen + back.w * 0.3, -ph.tail.curve, tailR.length);
      const sway = pose.tailSway || 0;
      if (sway) tsp2 = { pts: tsp2.pts.map((p, i) => v.rotY(p, tsp2.pts[0], sway * (i / (tsp2.pts.length - 1)))), dirs: tsp2.dirs };
      sausage(prims, tsp2, tailR, 'tail', MAT.BODY, k);
      prims[prims.length - 1].tip = ph.tail.tip;
      for (const p of prims) if (p.piece === 'tail') p.tip = ph.tail.tip;
    }

    // Legs: two round cones each and a paw; the paw stands where the walker put it, the hip rides on the moving body.
    const legW = ph.legs.width * s;
    const BT = bodyTransform(L, pose.body);
    const legs = [];
    L.hips.forEach((hp, i) => {
      const foot = (pose.feet && pose.feet[i]) || L.feet[i];
      const hip = BT ? BT.T(hp.p) : hp.p;
      const kneeSign = (ph.legs.knee >= 0 ? 1 : -1) * (hp.front ? -1 : 1);
      const ik = legIK(hip, foot, L.legLen, [kneeSign, 0, hp.side * 0.25]);
      legs.push({ hip, knee: ik.knee, end: ik.end, foot, stretch: ik.stretch });
      prims.push(cone(hip, ik.knee, legW * 1.15, legW * 0.85, 1, 'leg', MAT.BODY, { k2: k * 0.5 }));
      prims.push(cone(ik.knee, ik.end, legW * 0.85, legW * 0.7, 1, 'leg', MAT.BODY, { k2: k * 0.5 }));
      prims.push(ellipsoid(v.add(ik.end, [L.footR * 0.35, 0, 0]), [1, 0, 0], L.footR * 1.2, L.footR * 0.6, L.footR * 0.85, 'foot', MAT.BODY, { k2: k * 0.4 }));
      if (ph.claws > 0.45) {
        for (const dz of [-0.5, 0, 0.5]) {
          const base = v.add(ik.end, [L.footR * 1.25, -L.footR * 0.15, dz * L.footR * 0.7]);
          prims.push(cone(base, v.add(base, [L.footR * 0.55 * ph.claws, -L.footR * 0.25, 0]), L.footR * 0.22, 0.004 * s, 1, 'claw', MAT.ACCENT, { k2: 0.002 }));
        }
      }
    });

    // Wings: a shoulder, an elbow and finger bones with a membrane between them (a bat's wing).
    if (ph.wings.size > 0) {
      const q = along(tsp, torsoR, 0.68);
      const span = ph.wings.span * (0.55 + 0.75 * ph.wings.size) * s * 1.1;
      const flap = pose.wingFlap || 0;
      for (const side of [-1, 1]) {
        const S = v.add(q.p, [0, q.h * 0.55, side * q.w * 0.35]);
        const elev = ph.wings.angle + flap;
        const out = [0, Math.sin(elev), side * Math.cos(elev)];
        const E = v.add(S, v.add(v.mul(out, span * 0.42), [-span * 0.05, 0, 0]));
        const nF = ph.wings.fingers;
        const tips = [];
        for (let f = 0; f < nF; f++) {
          const a = (f / Math.max(1, nF - 1)); // 0: along the arm, 1: swept back
          const dir = v.norm(v.add(v.mul(out, 1 - a * 0.75), [-a * 1.1 - 0.15, -a * 0.25, 0]));
          tips.push(v.add(E, v.mul(dir, span * (0.62 - a * 0.18))));
        }
        const th = 0.008 * s + 0.004;
        const bw = Math.max(0.012 * s, legW * 0.35);
        prims.push(cone(S, E, bw * 1.3, bw, 1, 'wingbone', MAT.WING, { k2: k * 0.4, bone: true }));
        tips.forEach((t) => prims.push(cone(E, t, bw * 0.8, bw * 0.3, 1, 'wingbone', MAT.WING, { k2: 0.003, bone: true })));
        for (let f = 0; f < tips.length - 1; f++) prims.push(tri(E, tips[f], tips[f + 1], th, 'wing', MAT.WING));
        const backAttach = v.add(along(tsp, torsoR, 0.3).p, [0, q.h * 0.5, side * q.w * 0.2]);
        prims.push(tri(S, E, tips[tips.length - 1], th, 'wing', MAT.WING));
        prims.push(tri(S, tips[tips.length - 1], backAttach, th, 'wing', MAT.WING));
      }
    }

    // Head features are placed on the head's rings.
    const hAt = (t) => along(hsp, headR, t);
    const top = (t, side, spread) => { const q = hAt(t); const f = frame(q.d); return v.add(q.p, v.add(v.mul(f.u, q.h * 0.82), v.mul(f.side, side * q.w * spread))); };

    // Horns: round cones that bend, bone coloured.
    if (ph.horns.count > 0 && ph.horns.length > 0.015) {
      const hl = ph.horns.length * s, hw = ph.horns.width * s * (0.6 + 0.4 * Math.min(1, ph.horns.length * 4));
      const list = ph.horns.count === 1 ? [{ side: 0, t: 0.55 }] : [{ side: -1, t: 0.3 }, { side: 1, t: 0.3 }];
      for (const h of list) {
        const base = top(h.t, h.side, 0.45 + 0.3 * ph.horns.spread);
        let dir = v.norm([h.side === 0 ? 0.35 : -0.55, 1, h.side * (0.15 + ph.horns.spread * 0.7)]);
        const mid = v.add(base, v.mul(dir, hl * 0.5));
        dir = v.norm(v.add(dir, [-0.6 * ph.horns.curve, -0.2 * Math.abs(ph.horns.curve), 0]));
        const tip = v.add(mid, v.mul(dir, hl * 0.5));
        prims.push(cone(base, mid, hw, hw * 0.6, 1, 'horn', MAT.ACCENT, { k2: 0.004 }));
        prims.push(cone(mid, tip, hw * 0.6, 0.003 * s + 0.002, 1, 'horn', MAT.ACCENT, { k2: 0.002 }));
      }
    }

    // Ears.
    if (ph.ears.kind !== 'none') {
      const es = ph.ears.size * s;
      for (const side of [-1, 1]) {
        const base = top(0.22, side, 0.55);
        if (ph.ears.kind === 'pointed') {
          const dir = v.norm([-0.15 + ph.ears.angle * 0.3, 1, side * 0.45]);
          prims.push(cone(base, v.add(base, v.mul(dir, es * 1.3)), es * 0.42, 0.006 * s, 0.38, 'ear', MAT.BODY, { k2: k * 0.6, upHint: [1, 0, 0] }));
        } else if (ph.ears.kind === 'round') {
          const c = v.add(base, v.mul(v.norm([0, 1, side * 0.5]), es * 0.45));
          prims.push(ellipsoid(c, [0, 1, side * 0.5], es * 0.55, es * 0.2, es * 0.5, 'ear', MAT.BODY, { k2: k * 0.6, upHint: [1, 0, 0] }));
        } else {
          const dir = v.norm([-0.6, 0.1 - 0.5 * (ph.ears.angle + 0.6), side * 0.8]);
          prims.push(cone(base, v.add(base, v.mul(dir, es * 1.8)), es * 0.3, es * 0.22, 0.45, 'ear', MAT.BODY, { k2: k * 0.6, upHint: [0, 1, 0] }));
        }
      }
    }

    // Decorations.
    const ds = 0.35 + 0.65 * ph.decor.size;
    if (ph.decor.kind === 'sprout' || ph.decor.kind === 'flower') {
      const base = top(0.35, 0, 0);
      const stemTop = v.add(base, [0, 0.07 * s * ds, 0]);
      if (ph.decor.kind === 'sprout') {
        prims.push(cone(base, stemTop, 0.012 * s, 0.01 * s, 1, 'decor', MAT.LEAF, { k2: 0.004 }));
        for (const side of [-1, 1]) {
          const c = v.add(stemTop, [0.02 * s * side, 0.03 * s * ds, side * 0.045 * s * ds]);
          prims.push(ellipsoid(c, [0.3 * side, 0.6, side], 0.06 * s * ds, 0.012 * s, 0.032 * s * ds, 'decor', MAT.LEAF, { k2: 0.005 }));
        }
      } else {
        const c = v.add(base, [0, 0.025 * s * ds, 0]);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          prims.push(ellipsoid(v.add(c, [Math.cos(a) * 0.04 * s * ds, 0.005 * s, Math.sin(a) * 0.04 * s * ds]), [Math.cos(a), 0.2, Math.sin(a)],
            0.035 * s * ds, 0.016 * s * ds, 0.03 * s * ds, 'decor', MAT.PETAL, { k2: 0.006 }));
        }
        prims.push(ellipsoid(v.add(c, [0, 0.015 * s * ds, 0]), [1, 0, 0], 0.02 * s * ds, 0.016 * s * ds, 0.02 * s * ds, 'decor', MAT.ACCENT, { k2: 0.004 }));
      }
    } else if (ph.decor.kind === 'antennae') {
      for (const side of [-1, 1]) {
        const base = top(0.4, side, 0.35);
        const tip = v.add(base, [0.06 * s * ds, 0.2 * s * ds, side * 0.07 * s * ds]);
        prims.push(cone(base, tip, 0.009 * s, 0.006 * s, 1, 'decor', MAT.DARK, { k2: 0.003 }));
        prims.push(ellipsoid(tip, [1, 0, 0], 0.025 * s * ds, 0.025 * s * ds, 0.025 * s * ds, 'decor', MAT.PETAL, { k2: 0.003 }));
      }
    } else if (ph.decor.kind === 'spikes') {
      const n = 3 + Math.round(ph.decor.size * 4);
      for (let i = 0; i < n; i++) {
        const q = along(tsp, torsoR, 0.15 + 0.75 * (i / Math.max(1, n - 1)));
        const f = frame(q.d);
        const base = v.add(q.p, v.mul(f.u, q.h * 0.85));
        const hgt = (0.05 + 0.07 * ds) * s * (0.6 + 0.4 * Math.sin(Math.PI * (i + 0.5) / n));
        prims.push(cone(base, v.add(base, v.add(v.mul(f.u, hgt), v.mul(f.ax, -hgt * 0.35))), hgt * 0.4, 0.003 * s, 0.5, 'spike', MAT.ACCENT, { k2: 0.006, upHint: [1, 0, 0] }));
      }
    }

    for (const p of prims) { p.bs = bound(p); if (p.k2 == null) p.k2 = k; }

    // Face marks: anchors on the head; the renderer snaps them to the surface and draws them in pixels.
    // Eyes sit toward the front of the head so both show from the 3/4 view, like the video's creatures.
    const eyeT = 0.45 + 0.15 * (1 - ph.eyes.spacing);
    const eq = hAt(eyeT), ef = frame(eq.d);
    const eyeHead = Math.max(eq.w, eq.h);
    const eyeR = Math.min(0.55 * eyeHead, Math.max(0.022 * s, ph.eyes.size * eyeHead * 0.42));
    for (const side of [-1, 1]) {
      const dir = v.norm(v.add(v.add(v.mul(ef.ax, 0.6 + 0.4 * (1 - ph.eyes.spacing)), v.mul(ef.u, 0.1 + 0.55 * ph.eyes.height)), v.mul(ef.side, side * (0.3 + 0.5 * ph.eyes.spacing))));
      decals.push({ kind: 'eye', from: eq.p, dir, r: eyeR, side, round: ph.eyes.round, slant: ph.eyes.slant, glow: ph.eyes.glow,
        blink: pose.blink || 0, expression: pose.expression || ph.expression });
      if (ph.blush > 0.25) {
        const bdir = v.norm(v.add(dir, v.add(v.mul(ef.u, -0.5), v.mul(ef.side, side * 0.25))));
        decals.push({ kind: 'blush', from: eq.p, dir: bdir, r: eyeR * 0.9, amount: ph.blush, side });
      }
    }
    // Mouth: a line through three anchors (one jaw corner, the chin, the other corner); the renderer joins whichever show.
    const mq = hAt(0.96), mf = frame(mq.d), cq = hAt(0.8 - 0.25 * ph.mouth.width), cf = frame(cq.d);
    const corner = (side) => ({ from: cq.p, dir: v.norm(v.add(v.add(v.mul(cf.ax, 0.35), v.mul(cf.u, -0.45)), v.mul(cf.side, side * 0.8))) });
    decals.push({ kind: 'mouth', pts: [corner(-1), { from: mq.p, dir: v.norm(v.add(v.mul(mf.ax, 0.8), v.mul(mf.u, -0.55))) }, corner(1)],
      from: mq.p, dir: mf.ax, width: (0.4 + 0.8 * ph.mouth.width) * Math.max(mq.w, 0.04 * s),
      smile: ph.mouth.smile, fangs: ph.fangs, expression: pose.expression || ph.expression });

    if (BT) moveBody(prims, decals, BT);
    return { prims, decals, k, scale: s, layout: L, legs, kind: 'creature' };
  }

  // Apply the walk's body transform to everything but the legs (which were solved from the moved hips).
  function moveBody(prims, decals, BT) {
    const LEG = { leg: 1, foot: 1, claw: 1 };
    for (const p of prims) {
      if (LEG[p.piece]) continue;
      p.a = BT.T(p.a); if (p.b) p.b = BT.T(p.b); if (p.c) p.c = BT.T(p.c);
      p.ax = BT.R(p.ax); p.u = BT.R(p.u); p.side = BT.R(p.side);
      p.bs = bound(p);
    }
    for (const d of decals) {
      d.from = BT.T(d.from); d.dir = BT.R(d.dir);
      if (d.pts) d.pts = d.pts.map((q) => ({ from: BT.T(q.from), dir: BT.R(q.dir) }));
    }
  }

  // The egg: one ellipsoid with a shell pattern; `crack` (0..1) grows a zigzag crack, `open` (0..1) lifts the cap.
  function buildEgg(look, pose) {
    pose = pose || {};
    const prims = [];
    const H = 0.34, W = H * look.round;
    const c = [0, H, 0];
    const wob = pose.wobble || 0;
    const up = v.norm([Math.sin(wob), Math.cos(wob), 0]);
    const egg = ellipsoid(v.add([0, 0, 0], c), up, H, W, W, 'egg', MAT.EGG, { k2: 0.001, upHint: [1, 0, 0], look });
    // The egg's long axis is its frame axis; the renderer's pattern uses frame coordinates.
    if ((pose.open || 0) > 0) {
      // Split: a lower shell and a cap, cut along a zigzag at 62% height; the cap rises and tips away.
      egg.cut = { y: 0.25 * H, below: true };
      const cap = Object.assign({}, egg, { cut: { y: 0.25 * H, below: false } });
      const o = pose.open;
      cap.a = v.add(cap.a, [-0.12 * o, 0.28 * o, 0]);
      // Tip the cap away by turning its frame about the z axis.
      const ang = 0.9 * o, rz = (d) => [d[0] * Math.cos(ang) - d[1] * Math.sin(ang), d[0] * Math.sin(ang) + d[1] * Math.cos(ang), d[2]];
      cap.ax = rz(cap.ax); cap.u = rz(cap.u); cap.side = rz(cap.side);
      prims.push(egg, cap);
    } else prims.push(egg);
    for (const p of prims) p.bs = [p.a[0], p.a[1], p.a[2], H * 1.05];
    return { prims, decals: pose.crack ? [{ kind: 'crack', amount: pose.crack, center: c, H, W }] : [], k: 0.001, scale: 1, kind: 'egg', look };
  }

  const api = { build, buildEgg, layout, legIK, bodyTransform, spine, frame, bound, v, CONE, ELLIPSOID, TRI, MAT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureBody = api;
})(typeof window !== 'undefined' ? window : globalThis);
