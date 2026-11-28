/* Creatures compare lab: the cost benchmark, and the sprite helpers the compare page draws versions 1 and 2 with (so the
   page and the benchmark draw the same way).
   CreatureBench.measure(kind, n, opts) times n creatures of one version for opts.frames frames after opts.warm frames:
     update = the walker's step plus the body it draws (lab.js advance(): rings for version 1, the chain's pieces for 2;
              version 3 has no 3D body, its pose is the walker itself),
     draw   = putting every creature on a canvas the way the compare page does: versions 1 and 2 ray-march each body
              into a sprite (render.js) on the 240 × 168 pixel stage; version 3 paints itself with canvas paths
              (topdown.js) at the overlay's 480 × 336.
   Every frame ends by reading one pixel back, so the canvas has really finished drawing before the clock stops.
   Returns { kind, n, frames, update: { avg, p95 }, draw: { avg, p95 } } in milliseconds per frame (all n creatures).
   CreatureBench.run(opts) does every version at opts.counts (1, 5 and 20) and returns { results, env }.
   No DOM is touched outside the canvases it makes itself. */
(function (root) {
  'use strict';
  const R = root.CreatureRender, B = root.CreatureBody, C = root.CreatureChain, Lab = root.CreatureLab;
  const TD = root.CreatureTopdown || null, LT = root.CreatureLight || null;
  const W = 240, H = 168, K = 2, PITCH = 0.45, BODY_PX = 70;
  const KINDS = ['v1', 'v2', 'v3'];

  // ---------- sprite helpers (shared with compare.js) ----------
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // The box a body fits in from any yaw: width, height and where the ground line sits.
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
  function spriteCam(box, yaw, px) {
    const c = R.camera({ w: box.w, h: box.h, px, yaw, pitch: PITCH, center: [0, 0, 0] }), off = (box.ground - box.h / 2) * px;
    return { w: box.w, h: box.h, px, yaw, pitch: PITCH, center: [c.u[0] * off, c.u[1] * off, c.u[2] * off] };
  }

  // ---------- timing ----------
  const now = () => performance.now();
  function stats(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    return { avg: xs.reduce((p, q) => p + q, 0) / xs.length, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] };
  }
  // The steering every creature gets: a steady walk that weaves, each one a little out of step with the next.
  const driveAt = (t, i) => ({ v: 1.2, om: 0.8 * Math.sin(0.7 * t + i * 0.9) });

  function setup(kind, n, opts) {
    const actors = [];
    for (let i = 0; i < n; i++) {
      const seed = 'bench-' + i, ph = Lab.creatureFor(Lab.byId('s-curve'), seed, opts.level || 100, opts.body || 'own');
      actors.push(Lab.makeActor(kind, ph, seed, { topRig: TD && TD.rig }));
    }
    const px = Lab.bodyLength(actors[0].ph) / BODY_PX;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d', { willReadFrequently: false });
    if (kind === 'v3') { cv.width = W * K; cv.height = H * K; } else { cv.width = W; cv.height = H; }
    const sprites = actors.map((a) => {
      if (kind === 'v3') return null;
      const scene = R.withShadow(kind === 'v1' ? B.build(a.ph, {}) : C.scene(a.ph, a.w.R, {})); // room for the shadow
      const box = spriteBox(scene, px), sc = document.createElement('canvas');
      sc.width = box.w; sc.height = box.h;
      return { box, sc, sctx: sc.getContext('2d') };
    });
    return { kind, actors, px, cv, ctx, sprites, t: 0 };
  }
  function update(b) {
    b.actors.forEach((a, i) => Lab.advance(a, driveAt(b.t, i)));
    b.t += Lab.DT;
  }
  // Every creature drawn near the middle, a few pixels apart, the way the page draws one (its floor, its shadow).
  function draw(b, opts) {
    const ctx = b.ctx, style = opts.style || 'gochi', shadow = opts.shadow !== false;
    ctx.fillStyle = '#34304a'; ctx.fillRect(0, 0, b.cv.width, b.cv.height);
    b.actors.forEach((a, i) => {
      const ox = ((i % 5) - 2) * 10, oy = (Math.floor(i / 5) - 1.5) * 8;
      if (b.kind === 'v3') {
        const sc = K / b.px;
        TD.draw(ctx, a.w, { scale: sc, ox: W * K / 2 + ox * K - a.w.x * sc, oy: H * K / 2 + oy * K - a.w.z * sc },
          { style: style === 'gochi' ? 'original' : style, sun: LT ? LT.sunAt(0.42) : null, time: b.t, skeleton: false, shadow, out: a.out });
      } else {
        const sp = b.sprites[i];
        a.scene.ph = a.ph;
        if (shadow) R.withShadow(a.scene); // the floor footprint the cast shadow needs (the walkers' scenes come without it)
        const res = R.render(a.scene, spriteCam(sp.box, -a.w.th, b.px), { style, shadow });
        const img = sp.sctx.createImageData(res.w, res.h);
        img.data.set(res.rgba);
        sp.sctx.putImageData(img, 0, 0);
        ctx.drawImage(sp.sc, Math.round(W / 2 + ox - sp.box.w / 2), Math.round(H / 2 + 8 + oy - sp.box.ground));
      }
    });
    ctx.getImageData(0, 0, 1, 1); // wait for the canvas to finish
  }
  function measure(kind, n, opts) {
    opts = opts || {};
    const frames = opts.frames || 300, warm = opts.warm == null ? 60 : opts.warm;
    const b = setup(kind, n, opts), up = [], dr = [];
    for (let f = 0; f < warm + frames; f++) {
      const t0 = now(); update(b); const t1 = now(); draw(b, opts); const t2 = now();
      if (f >= warm) { up.push(t1 - t0); dr.push(t2 - t1); }
    }
    return { kind, n, frames, update: stats(up), draw: stats(dr) };
  }
  // The same, a version and a count at a time, giving the page a moment in between so it stays responsive.
  function plan(opts) {
    const counts = opts.counts || [1, 5, 20], kinds = (opts.kinds || KINDS).filter((k) => k !== 'v3' || TD), jobs = [];
    for (const n of counts) for (const k of kinds) jobs.push([k, n]);
    return jobs;
  }
  function env() {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    let tick = Infinity, a = now();
    for (let i = 0; i < 2000; i++) { const b = now(); if (b > a) { tick = Math.min(tick, b - a); a = b; } }
    return { userAgent: nav.userAgent || '', cores: nav.hardwareConcurrency || null, timerResolutionMs: isFinite(tick) ? +tick.toFixed(4) : null };
  }
  function run(opts) {
    opts = opts || {};
    return { results: plan(opts).map(([k, n]) => measure(k, n, opts)), env: env(), opts: { frames: opts.frames || 300, warm: opts.warm == null ? 60 : opts.warm, style: opts.style || 'gochi', shadow: opts.shadow !== false } };
  }
  function runAsync(opts, onProgress) {
    opts = opts || {};
    const jobs = plan(opts), results = [];
    return new Promise((resolve) => {
      const next = () => {
        if (results.length === jobs.length) { resolve({ results, env: env(), opts: { frames: opts.frames || 300, warm: opts.warm == null ? 60 : opts.warm } }); return; }
        const [k, n] = jobs[results.length];
        results.push(measure(k, n, opts));
        if (onProgress) onProgress(results.length, jobs.length, results[results.length - 1]);
        setTimeout(next, 30);
      };
      setTimeout(next, 30);
    });
  }

  root.CreatureBench = { measure, run, runAsync, spriteBox, spriteCam, driveAt, W, H, K, PITCH, BODY_PX };
})(typeof window !== 'undefined' ? window : globalThis);
