/* Creatures prototype, version 2 ("Argonaut technique"): the body is a chain of joints, as in argonaut's video "A simple
   procedural animation technique" (docs/argonaut-technique-analysis.md).
   - Distance constraint: each joint is pulled back to exactly one link length from the joint in front of it, so the
     whole body follows its head like a rope.
   - Angle constraint: each link may bend only so far from the link in front, so the body can't fold into itself.
   - A radius per joint (the video's radius arrays): here read from the genome's ring sizes, so the same seed gives
     the same body outline as version 1 when it stands straight.
   - Legs are two bones solved with FABRIK (forward and backward reaching) from a hip on the chain to a foot on the floor.
   The 3D look is unchanged: the chain is turned into the same round cones version 1 melts together, and version 1's
   head (face, mouth, horns, ears), wings and decorations are carried rigidly by the joint they sit on.
   Coordinates as in body.js: x forward, y up, z to the right; ground y = 0. The chain itself lives on the ground
   plane (x, z) and each joint keeps the height it has standing straight. No DOM. */
(function (root) {
  'use strict';
  const B = root.CreatureBody || (typeof require === 'function' ? require('../prototype/body.js') : null);
  const v = B.v;

  // How far each link may bend from the one in front of it (radians), by body part. A stiff torso, a looser neck and
  // tail: together they set how tight a turn can be.
  const MAX_BEND = { neck: 0.42, torso: 0.2, tail: 0.36 };
  const LINK_FACTOR = 0.55;     // link length is this share of the torso's mean width (the video's "linkSize")
  const MIN_JOINTS = 8, MAX_JOINTS = 26;
  const HEAD_PIECES = { head: 1, jaw: 1, beak: 1, mandible: 1, mouth: 1, tongue: 1, ear: 1, horn: 1, decor: 1 };
  const WING_PIECES = { wing: 1, wingbone: 1 };
  const CHAIN_PIECES = { neck: 1, torso: 1, tail: 1 };
  const LEG_PIECES = { leg: 1, foot: 1, claw: 1 };

  const wrap = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  // Ground headings use the walker's convention: heading th points along (cos th, -sin th) in (x, z).
  const dirOf = (th) => [Math.cos(th), -Math.sin(th)];
  const headingOf = (dx, dz) => Math.atan2(-dz, dx);

  // ---------- the video's constraints ----------
  // Distance constraint: move `p` onto the circle of radius `d` around `anchor` (2D points [x, z]).
  function constrainDistance(p, anchor, d) {
    const dx = p[0] - anchor[0], dz = p[1] - anchor[1], l = Math.hypot(dx, dz);
    if (l < 1e-9) return [anchor[0] - d, anchor[1]];
    return [anchor[0] + dx / l * d, anchor[1] + dz / l * d];
  }
  // Angle constraint: keep `angle` within `limit` radians of `anchor` (shortest way round).
  function constrainAngle(angle, anchor, limit) {
    const d = wrap(angle - anchor);
    return anchor + clamp(d, -limit, limit);
  }
  // Pull a chain after its head: joint 0 goes to (hx, hz) facing `hth`; every other joint keeps its link length to the
  // joint in front and bends at most `bend[i]` from it. Mutates and returns `ch` ({ joints: [[x, z]], angles, links }).
  function follow(ch, hx, hz, hth, bend) {
    const J = ch.joints, A = ch.angles;
    J[0] = [hx, hz]; A[0] = hth;
    for (let i = 1; i < J.length; i++) {
      const cur = headingOf(J[i - 1][0] - J[i][0], J[i - 1][1] - J[i][1]);
      A[i] = constrainAngle(cur, A[i - 1], bend[i]);
      const d = dirOf(A[i]);
      J[i] = [J[i - 1][0] - d[0] * ch.links[i], J[i - 1][1] - d[1] * ch.links[i]];
    }
    return ch;
  }
  // Lay a chain out straight behind a head at (hx, hz) facing hth.
  function straight(ch, hx, hz, hth) {
    const d = dirOf(hth);
    let x = hx, z = hz;
    for (let i = 0; i < ch.joints.length; i++) {
      if (i) { x -= d[0] * ch.links[i]; z -= d[1] * ch.links[i]; }
      ch.joints[i] = [x, z]; ch.angles[i] = hth;
    }
    return ch;
  }

  // FABRIK (Forward And Backward Reaching Inverse Kinematics), as the video shows it: walk the chain from the end to
  // the target keeping bone lengths, then from the base back to where it is fixed; repeat until the end is close
  // enough. points: [[x, y, z], ...] (a starting guess; the first one is the fixed base), lengths[i] between point i and
  // i + 1. Returns { points, reached, error, iterations }.
  function fabrik(points, lengths, target, opts) {
    opts = opts || {};
    const iters = opts.iterations || 12, tol = opts.tolerance != null ? opts.tolerance : 1e-4;
    const P = points.map((p) => p.slice()), n = P.length, base = P[0].slice();
    const total = lengths.reduce((a, b) => a + b, 0);
    const toTarget = v.len(v.sub(target, base));
    if (toTarget >= total) { // out of reach: stretch straight toward it
      const d = v.norm(v.sub(target, base));
      for (let i = 1; i < n; i++) P[i] = v.add(P[i - 1], v.mul(d, lengths[i - 1]));
      return { points: P, reached: false, error: toTarget - total, iterations: 0 };
    }
    let k = 0, err = v.len(v.sub(P[n - 1], target));
    for (; k < iters && err > tol; k++) {
      P[n - 1] = target.slice(); // backward: from the end
      for (let i = n - 2; i >= 0; i--) P[i] = v.add(P[i + 1], v.mul(v.norm(v.sub(P[i], P[i + 1])), lengths[i]));
      P[0] = base.slice();       // forward: from the base
      for (let i = 1; i < n; i++) P[i] = v.add(P[i - 1], v.mul(v.norm(v.sub(P[i], P[i - 1])), lengths[i - 1]));
      err = v.len(v.sub(P[n - 1], target));
    }
    return { points: P, reached: err <= Math.max(tol, 1e-3 * total), error: err, iterations: k };
  }
  // A two-bone leg by FABRIK. The knee guess starts out toward `pole` so the knee bends that way.
  function legFabrik(hip, foot, len, pole) {
    const mid = v.lerp(hip, foot, 0.5), guess = v.add(mid, v.mul(v.norm(pole), len * 0.5));
    const r = fabrik([hip, guess, foot], [len / 2, len / 2], foot, { iterations: 10, tolerance: 1e-5 * Math.max(1, len) });
    return { hip, knee: r.points[1], end: r.points[2], foot, stretch: v.len(v.sub(foot, hip)) / len, reached: r.reached };
  }

  // ---------- the rest chain, from the genome ----------
  // Read version 1's straight body (its neck, torso and tail sausages, which come from the genome's rings), then lay
  // joints along that centre line at one link length apart. Each joint keeps its ring width and height: that list of
  // widths is the video's radius array. Also finds where the head, hips, feet, wings and mouth sit on the chain.
  function rig(ph) {
    const base = B.build(ph, {});
    const L = base.layout, s = L.s;
    const of = (piece) => base.prims.filter((p) => p.piece === piece && p.k === B.CONE);
    const nodes = [];
    const push = (p, w, h, piece) => nodes.push({ p: p.slice(), w, h, piece });
    const neck = of('neck'), torso = of('torso'), tail = of('tail');
    const head0 = base.prims.find((p) => p.piece === 'head').a;
    // head end first: the neck from its top down, the torso from its front back, then the tail out to its tip
    const first = neck.length ? neck[neck.length - 1] : torso[torso.length - 1];
    push([head0[0], head0[1], 0], (first.r2 || first.r1), (first.r2 || first.r1) * first.sy, neck.length ? 'neck' : 'torso');
    for (let i = neck.length - 1; i >= 0; i--) push(neck[i].a, neck[i].r1, neck[i].r1 * neck[i].sy, 'neck');
    for (let i = torso.length - 1; i >= 0; i--) push(torso[i].b, torso[i].r2, torso[i].r2 * torso[i].sy, 'torso');
    if (torso.length) push(torso[0].a, torso[0].r1, torso[0].r1 * torso[0].sy, 'torso');
    for (const t of tail) push(t.b, t.r2, t.r2 * t.sy, 'tail');
    // arc length along the centre line
    const arc = [0];
    for (let i = 1; i < nodes.length; i++) arc.push(arc[i - 1] + v.len(v.sub(nodes[i].p, nodes[i - 1].p)));
    const total = arc[arc.length - 1];
    const meanW = L.torsoR.reduce((a, r) => a + r.w, 0) / L.torsoR.length;
    const n = clamp(Math.round(total / (LINK_FACTOR * meanW)) + 1, MIN_JOINTS, MAX_JOINTS);
    const at = (d) => {
      let i = 1;
      while (i < arc.length - 1 && arc[i] < d) i++;
      const a = nodes[i - 1], b = nodes[i], u = clamp((d - arc[i - 1]) / Math.max(1e-9, arc[i] - arc[i - 1]), 0, 1);
      return { p: v.lerp(a.p, b.p, u), w: a.w + (b.w - a.w) * u, h: a.h + (b.h - a.h) * u, piece: u < 0.5 ? a.piece : b.piece };
    };
    const joints = [];
    for (let i = 0; i < n; i++) {
      const q = at(total * i / (n - 1));
      joints.push({ x: q.p[0], y: q.p[1], w: Math.max(0.004, q.w), h: Math.max(0.004, q.h), piece: q.piece });
    }
    // Links on the ground plane (the chain is flat; height is kept per joint). A near-vertical neck still keeps a
    // small link so the joints never sit on top of each other.
    const links = joints.map((j, i) => (i ? Math.max(0.12 * meanW, Math.abs(joints[i - 1].x - j.x)) : 0));
    const bend = joints.map((j) => MAX_BEND[j.piece] || MAX_BEND.torso);
    // rest x along the chain (rebuilt from the links, so straight rest matches the chain exactly)
    let x = joints[0].x;
    joints.forEach((j, i) => { if (i) x -= links[i]; j.rx = x; });
    const nearest = (px, pieces) => {
      let best = 0, bd = Infinity;
      joints.forEach((j, i) => { if (pieces && !pieces[j.piece]) return; const d = Math.abs(j.rx - px); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    // The anchor: the joint at version 1's body origin (the middle of the torso), where the sprite is drawn.
    const anchor = nearest(0, { torso: 1 });
    // Hips ride on the torso joint nearest to them; feet start where version 1 stands them.
    const hips = L.hips.map((hp, i) => {
      const j = nearest(hp.p[0], { torso: 1 });
      return { joint: j, off: [hp.p[0] - joints[j].rx, hp.p[1], hp.p[2]], foot: [L.feet[i][0] - joints[j].rx, L.feet[i][1], L.feet[i][2]],
        side: hp.side, front: hp.front, t: hp.t };
    });
    const wingRoot = base.prims.find((p) => p.piece === 'wingbone');
    const neckEnd = Math.max(1, joints.findIndex((j) => j.piece === 'torso'));
    return {
      ph, s, L, joints, links, bend, anchor, hips, neckEnd,
      head0: [joints[0].rx, joints[0].y, 0],
      wingJoint: wingRoot ? nearest(wingRoot.a[0], { torso: 1 }) : anchor,
      mouth: base.mouth.p.slice(), mouthAhead: Math.max(0.05 * s, base.mouth.p[0] - joints[0].rx),
      tailStart: joints.findIndex((j) => j.piece === 'tail'),
      legLen: L.legLen, footR: L.footR, legW: ph.legs.width * s, k: base.k,
      radii: joints.map((j) => j.w),
    };
  }

  // The chain at rest, in the body frame: joint i at (rx, y, 0), all facing forward.
  function restPose(R) {
    return { joints: R.joints.map((j) => ({ x: j.rx, y: j.y, z: 0, phi: 0 })), legs: null };
  }

  // ---------- from the chain to the renderer's pieces ----------
  // Moves a rest-pose point carried by joint j to where that joint is now (turned by its heading phi).
  function carrier(R, cur, j) {
    const r = R.joints[j], c = cur[j], ang = c.phi;
    const T = (p) => { const q = v.rotY([p[0] - r.rx, p[1] - r.y, p[2]], [0, 0, 0], ang); return [q[0] + c.x, q[1] + c.y, q[2] + c.z]; };
    const D = (d) => v.rotY(d, [0, 0, 0], ang);
    return { T, D };
  }
  function moveRigid(p, M) {
    p.a = M.T(p.a); if (p.b) p.b = M.T(p.b); if (p.c) p.c = M.T(p.c);
    p.ax = M.D(p.ax); p.u = M.D(p.u); p.side = M.D(p.side);
    p.bs = B.bound(p);
  }

  // Build a scene for the renderer. pose: { joints: [{x, y, z, phi}] (body frame, one per rig joint; omitted = rest),
  // legs: [{hip, knee, foot}] (body frame; omitted = standing at rest), lift, and the face and head fields version 1
  // takes: breathe, lookYaw, headNod, wingFlap, blink, expression, mouthOpen, swallow }.
  function scene(ph, R, pose) {
    pose = pose || {};
    R = R || rig(ph);
    const cur = pose.joints || restPose(R).joints;
    // Version 1 builds the head, face, mouth, wings and decorations; the chain replaces its neck, torso, tail and legs.
    const base = B.build(ph, { breathe: pose.breathe, lookYaw: pose.lookYaw, headNod: pose.headNod, wingFlap: pose.wingFlap,
      blink: pose.blink, expression: pose.expression, mouthOpen: pose.mouthOpen });
    const s = R.s, k = base.k, prims = [];
    const headM = carrier(R, cur, 0), wingM = carrier(R, cur, R.wingJoint);
    const torsoNearest = (x) => {
      let best = R.anchor, bd = Infinity;
      R.joints.forEach((j, i) => { if (j.piece !== 'torso') return; const d = Math.abs(j.rx - x); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    for (const p of base.prims) {
      if (CHAIN_PIECES[p.piece] || LEG_PIECES[p.piece]) continue;
      const M = HEAD_PIECES[p.piece] ? headM : WING_PIECES[p.piece] ? wingM : carrier(R, cur, torsoNearest(p.a[0]));
      moveRigid(p, M);
      prims.push(p);
    }
    const decals = base.decals.map((d) => {
      const o = Object.assign({}, d, { from: headM.T(d.from), dir: headM.D(d.dir) });
      if (d.pts) o.pts = d.pts.map((q) => ({ from: headM.T(q.from), dir: headM.D(q.dir) }));
      return o;
    });
    // The chain's body: a round cone from each joint to the next, the joint's radius at each end (the outline the video
    // draws round its circles, in 3D). Pattern coordinates run along each body part as in version 1.
    const breathe = 1 + (pose.breathe || 0) * 0.03;
    const J = R.joints, n = J.length;
    const span = {};
    J.forEach((j, i) => { const sp = span[j.piece] || (span[j.piece] = { from: i, to: i }); sp.to = i; });
    for (let i = 0; i < n - 1; i++) {
      const a = [cur[i].x, cur[i].y, cur[i].z], b = [cur[i + 1].x, cur[i + 1].y, cur[i + 1].z];
      const piece = J[i + 1].piece === 'tail' && J[i].piece !== 'tail' ? 'torso' : J[i + 1].piece;
      const f = piece === 'torso' ? breathe : 1;
      const r1 = J[i].w * f, r2 = J[i + 1].w * f, sy = ((J[i].h + J[i + 1].h) / 2) / ((J[i].w + J[i + 1].w) / 2);
      const sp = span[piece] || { from: i, to: i + 1 }, m = Math.max(1, sp.to - sp.from + 1);
      // pattern coordinates run tail-to-head like version 1's sausages (t0 at the back end)
      const t1 = clamp(1 - (i - sp.from) / m, 0, 1), t0 = clamp(1 - (i + 1 - sp.from) / m, 0, 1);
      const len = v.len(v.sub(b, a));
      if (len < 1e-4) { prims.push(Object.assign({ k: B.ELLIPSOID, a, rx: r1, ry: J[i].h * f, rz: r1, ax: [1, 0, 0], u: [0, 1, 0], side: [0, 0, 1], piece, mat: B.MAT.BODY, t0, t1, pieceLen: 1, k2: k })); continue; }
      const fr = B.frame(v.sub(a, b), [0, 1, 0]);
      prims.push({ k: B.CONE, a: b, b: a, r1: r2, r2: r1, sy, ax: fr.ax, u: fr.u, side: fr.side, len, piece, mat: B.MAT.BODY,
        t0, t1, pieceLen: len * m, k2: k, tip: piece === 'tail' ? ph.tail.tip : undefined });
    }
    // Legs: hip -> knee -> foot from the walker (FABRIK), else standing at rest; the same round cones, paw and claws as
    // version 1.
    const legs = [];
    const legPose = pose.legs || restLegs(R, cur);
    legPose.forEach((lg, i) => {
      const hp = R.hips[i];
      const ik = lg.knee ? lg : legFabrik(lg.hip, lg.foot, R.legLen, kneePole(R, hp, cur[hp.joint].phi));
      const end = ik.end || ik.foot;
      legs.push({ hip: ik.hip, knee: ik.knee, end, foot: ik.foot, stretch: ik.stretch != null ? ik.stretch : v.len(v.sub(ik.foot, ik.hip)) / R.legLen });
      const legW = R.legW, fr = R.footR, phi = cur[hp.joint].phi;
      const fwd = [Math.cos(phi), 0, -Math.sin(phi)], side = [Math.sin(phi), 0, Math.cos(phi)];
      prims.push(cone(ik.hip, ik.knee, legW * 1.15, legW * 0.85, 'leg', k * 0.5));
      prims.push(cone(ik.knee, end, legW * 0.85, legW * 0.7, 'leg', k * 0.5));
      prims.push(ellipsoidAt(v.add(end, v.mul(fwd, fr * 0.35)), fwd, fr * 1.2, fr * 0.6, fr * 0.85, 'foot', k * 0.4));
      if (ph.claws > 0.45) {
        for (const dz of [-0.5, 0, 0.5]) {
          const b0 = v.add(v.add(end, v.mul(fwd, fr * 1.25)), v.add([0, -fr * 0.15, 0], v.mul(side, dz * fr * 0.7)));
          const tipP = v.add(b0, v.add(v.mul(fwd, fr * 0.55 * ph.claws), [0, -fr * 0.25, 0]));
          const cl = cone(b0, tipP, fr * 0.22, 0.004 * s, 'claw', 0.002); cl.mat = B.MAT.ACCENT; prims.push(cl);
        }
      }
    });
    // Swallowing: a lump slides from the head down the chain into the chest.
    const sw = pose.swallow || 0;
    if (sw > 0 && sw < 1) {
      const to = Math.min(n - 1, R.neckEnd + Math.max(1, Math.round((R.anchor - R.neckEnd) * 0.6)));
      const f = sw * to, i = Math.min(to - 1, Math.floor(f)), u = f - i;
      const c = v.lerp([cur[i].x, cur[i].y, cur[i].z], [cur[i + 1].x, cur[i + 1].y, cur[i + 1].z], u);
      const w0 = J[i].w + (J[i + 1].w - J[i].w) * u, r = w0 * (0.55 + 0.3 * Math.sin(Math.PI * sw));
      prims.push(ellipsoidAt(c, v.sub([cur[i].x, cur[i].y, cur[i].z], [cur[i + 1].x, cur[i + 1].y, cur[i + 1].z]), r * 1.3, r, r, 'neck', k * 0.6));
    }
    for (const p of prims) { if (!p.bs) p.bs = B.bound(p); if (p.k2 == null) p.k2 = k; }
    const out = { prims, decals, k, scale: s, layout: R.L, legs, kind: 'creature', ph, rig: R, chain: cur,
      mouth: { p: headM.T(base.mouth.p), open: base.mouth.open, kind: base.mouth.kind } };
    const lift = pose.lift || 0;
    if (lift) {
      const up = (p) => [p[0], p[1] + lift, p[2]];
      for (const p of prims) { p.a = up(p.a); if (p.b) p.b = up(p.b); if (p.c) p.c = up(p.c); p.bs = [p.bs[0], p.bs[1] + lift, p.bs[2], p.bs[3]]; }
      for (const d of decals) { d.from = up(d.from); if (d.pts) d.pts = d.pts.map((q) => ({ from: up(q.from), dir: q.dir })); }
      out.mouth.p = up(out.mouth.p);
    }
    out.lift = lift;
    return out;
  }
  function cone(a, b, r1, r2, piece, k2) {
    const fr = B.frame(v.sub(b, a));
    return { k: B.CONE, a, b, r1, r2, sy: 1, ax: fr.ax, u: fr.u, side: fr.side, len: v.len(v.sub(b, a)), piece, mat: B.MAT.BODY, t0: 0, t1: 1, pieceLen: 1, k2 };
  }
  function ellipsoidAt(c, axis, rx, ry, rz, piece, k2) {
    const fr = B.frame(axis, [0, 1, 0]);
    return { k: B.ELLIPSOID, a: c, rx, ry, rz, ax: fr.ax, u: fr.u, side: fr.side, piece, mat: B.MAT.BODY, t0: 0, t1: 1, pieceLen: 1, k2 };
  }
  // Where the knee points: outward and a little up, like the video's lizard, leaning forward or back by the knee gene.
  function kneePole(R, hp, phi) {
    const kneeSign = (R.ph.legs.knee >= 0 ? 1 : -1) * (hp.front ? -1 : 1);
    const fwd = [Math.cos(phi), 0, -Math.sin(phi)], side = [Math.sin(phi), 0, Math.cos(phi)];
    return v.norm(v.add(v.add(v.mul(side, hp.side * 0.7), v.mul(fwd, kneeSign * 0.6)), [0, 0.25, 0]));
  }
  // Hip on its joint, in the body frame.
  function hipAt(R, cur, i) {
    const hp = R.hips[i];
    return carrier(R, cur, hp.joint).T([R.joints[hp.joint].rx + hp.off[0], hp.off[1], hp.off[2]]);
  }
  // Standing at rest: each foot where version 1 puts it, carried by its joint.
  function restLegs(R, cur) {
    return R.hips.map((hp, i) => {
      const hip = hipAt(R, cur, i);
      const foot = carrier(R, cur, hp.joint).T([R.joints[hp.joint].rx + hp.foot[0], hp.foot[1], hp.foot[2]]);
      foot[1] = hp.foot[1];
      return legFabrik(hip, foot, R.legLen, kneePole(R, hp, cur[hp.joint].phi));
    });
  }

  const api = { rig, scene, restPose, follow, straight, constrainDistance, constrainAngle, fabrik, legFabrik, kneePole, hipAt,
    carrier, wrap, dirOf, headingOf, MAX_BEND, LINK_FACTOR, MIN_JOINTS, MAX_JOINTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureChain = api;
})(typeof window !== 'undefined' ? window : globalThis);
