/* Creatures prototype: the habitats behind the creature, drawn in code (no image files). Each one matches the stage's
   ground plane: a far edge (the horizon row, just above yFar) and a near edge at the bottom, with things further back
   drawn smaller. Still layers are drawn once into offscreen canvases; a few things move: grass, flowers and leaves sway
   in the wind, clouds drift, crystals glow and fireflies wander. The far layers slide a little with the creature
   (parallax). With reduced motion the moving bits hold still and nothing slides.
   CreatureHabitats.create(key, { W, H, yFar, yNear }) -> { draw(ctx, t, pan, light), dark } where pan is in stage pixels
   and light (optional, light.js) moves the meadow's sun, or its moon at night, across the sky with the time of day. */
(function (root) {
  'use strict';
  const PAN = 10;                  // the far layers are this much wider on each side, for parallax
  const FAR_SLIDE = 1, MID_SLIDE = 0.5;
  const LIST = [
    ['grass', 'Soft grass', 'low detail: soft hills, a few tufts'],
    ['flat', 'Flat', 'minimal: one wall, one floor'],
    ['meadow', 'Pixel meadow', 'high detail: banded sky, mountains, trees, flowers, clouds'],
    ['cave', 'Cave at night', 'medium detail: rock, stalactites, glowing crystals, fireflies'],
    ['wildwood', 'Wildwood', 'medium detail: chunky outlined pixels like Tap Slay Die\'s forest'],
    ['studio', 'Studio', 'minimal: a soft photo-studio sweep'],
  ];

  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function canvas(w, h) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    return { c, ctx };
  }
  const box = (ctx, x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
  function disc(ctx, cx, cy, r, col, ry) { // a pixel-edged ellipse
    ctx.fillStyle = col; ry = ry == null ? r : ry;
    for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
      const half = Math.round(r * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
      if (half > 0) ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2, 1);
    }
  }
  function vgrad(ctx, y0, y1, stops, x0, x1) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    stops.forEach((s, i) => g.addColorStop(Array.isArray(s) ? s[0] : i / (stops.length - 1), Array.isArray(s) ? s[1] : s));
    ctx.fillStyle = g; ctx.fillRect(x0 || 0, y0, (x1 || ctx.canvas.width) - (x0 || 0), y1 - y0);
  }
  function bands(ctx, y0, y1, cols) { // stepped colour bands with a dithered seam, the pixel-art sky
    const n = cols.length, h = (y1 - y0) / n, W = ctx.canvas.width;
    cols.forEach((c, i) => box(ctx, 0, y0 + i * h, W, h + 1, c));
    for (let i = 1; i < n; i++) {
      const y = Math.round(y0 + i * h);
      ctx.fillStyle = cols[i - 1];
      for (let x = 0; x < W; x += 2) ctx.fillRect(x + (x / 2) % 2, y, 1, 1);
      ctx.fillStyle = cols[i];
      for (let x = 1; x < W; x += 2) ctx.fillRect(x, y - 1, 1, 1);
    }
  }
  // Things on the ground get smaller towards the back, like the creature.
  const depthK = (g, y) => 0.72 + 0.28 * Math.max(0, Math.min(1, (y - g.yFar) / (g.yNear - g.yFar)));
  // A blade or stem that bends in the wind, more at the tip.
  function blade(ctx, x, y, h, lean, col) {
    ctx.fillStyle = col;
    for (let j = 0; j < h; j++) { const u = j / h; ctx.fillRect(Math.round(x + lean * u * u), Math.round(y - j), 1, 1); }
    return [Math.round(x + lean), Math.round(y - h)];
  }
  const gust = (t) => 0.6 + 0.4 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);

  const MAKERS = {
    grass(g) {
      const { W, H } = g, HZ = g.yFar - 10, r = rng(11);
      const far = canvas(W + 2 * PAN, H), ground = canvas(W, H);
      vgrad(far.ctx, 0, HZ + 2, ['#d7ece6', '#eef6e6']);
      far.ctx.globalAlpha = 0.9;
      disc(far.ctx, PAN + W * 0.22, HZ + 8, 150, '#c3dfb0', 24);
      disc(far.ctx, PAN + W * 0.78, HZ + 10, 180, '#b2d6a0', 28);
      vgrad(ground.ctx, HZ, H, ['#a9d38f', '#8cc176']);
      ground.ctx.globalAlpha = 0.14;
      for (let i = 0; i < 16; i++) { const y = HZ + 6 + r() * (H - HZ - 6), k = depthK(g, y); disc(ground.ctx, r() * W, y, (10 + r() * 22) * k, '#e6f6cf', (2 + r() * 4) * k); }
      const tufts = [];
      for (let i = 0; i < 34; i++) { const y = HZ + 4 + Math.pow(r(), 0.8) * (H - HZ - 4); tufts.push({ x: r() * W, y, k: depthK(g, y), p: r() * 6 }); }
      tufts.sort((a, b) => a.y - b.y);
      return {
        dark: false,
        draw(ctx, t, pan) {
          ctx.drawImage(far.c, -PAN + pan * FAR_SLIDE, 0); ctx.drawImage(ground.c, 0, 0);
          const wv = gust(t);
          for (const f of tufts) for (let b = -1; b <= 1; b++) {
            const sway = wv * Math.sin(t * 1.6 + f.x * 0.07 + f.p) * 1.6 * f.k;
            blade(ctx, f.x + b * 1.5 * f.k, f.y, (4 + (b === 0 ? 2 : 0)) * f.k, b * 1.2 * f.k + sway, b === 0 ? '#6aa857' : '#7cb866');
          }
        },
      };
    },

    flat(g) {
      const { W, H } = g, HZ = g.yFar - 10;
      const c = canvas(W, H);
      box(c.ctx, 0, 0, W, HZ, '#efe7da');
      vgrad(c.ctx, HZ, H, ['#e4d9c6', '#d9ccb6']);
      box(c.ctx, 0, HZ, W, 1, '#d2c4ac');
      return { dark: false, draw(ctx) { ctx.drawImage(c.c, 0, 0); } };
    },

    meadow(g) {
      const { W, H } = g, HZ = g.yFar - 10, r = rng(7), FW = W + 2 * PAN;
      const sky = canvas(FW, H), far = canvas(FW, H), mid = canvas(FW, H), ground = canvas(W, H);
      bands(sky.ctx, 0, HZ, ['#6fbbe9', '#7fc6ef', '#92d0f2', '#a7daf4', '#bfe5f6']);
      // The sun sits between the sky and the mountains: still at the upper right, or where the light says it is.
      const sun = (ctx, x, y, moon) => {
        if (moon) { disc(ctx, x, y, 6, '#dfe6f4'); disc(ctx, x + 2, y - 1, 4, '#c9d3e8'); return; }
        disc(ctx, x, y, 9, '#fff6c8'); disc(ctx, x, y, 7, '#fffbe3');
      };
      // Mountains: a stepped ridge, far and pale, then nearer hills.
      let h = 30;
      for (let x = 0; x < FW; x += 2) { h = Math.max(12, Math.min(52, h + (r() - 0.5) * 7)); box(far.ctx, x, HZ - h, 2, h, '#9fc1dd'); if (h > 40) box(far.ctx, x, HZ - h, 2, 3, '#eef6fb'); }
      h = 14;
      for (let x = 0; x < FW; x += 2) { h = Math.max(6, Math.min(24, h + (r() - 0.5) * 4)); box(far.ctx, x, HZ - h, 2, h, '#7cb88a'); box(far.ctx, x, HZ - h, 2, 1, '#9fd6a3'); }
      // A tree line on the horizon.
      for (let x = -6; x < FW + 6; x += 9 + r() * 10) {
        const rr = 5 + r() * 5, y = HZ - 3 - r() * 3;
        box(mid.ctx, x - 1, y, 2, 6, '#5a4632');
        disc(mid.ctx, x, y - rr * 0.6, rr, '#3f8b4e'); disc(mid.ctx, x - rr * 0.3, y - rr * 0.9, rr * 0.55, '#58a865');
      }
      box(ground.ctx, 0, HZ, W, H - HZ, '#7cc55c');
      for (let y = HZ; y < H; y++) { // darker dithered rows towards the front
        const u = (y - HZ) / (H - HZ);
        if (y % 3 === 0) { ground.ctx.fillStyle = u > 0.5 ? '#6db54f' : '#86cd66'; for (let x = (y % 2); x < W; x += 2 + Math.floor(u * 3)) ground.ctx.fillRect(x, y, 1, 1); }
      }
      for (let i = 0; i < 30; i++) { const y = HZ + 3 + r() * (H - HZ - 3), k = depthK(g, y); disc(ground.ctx, r() * W, y, 2 * k, r() < 0.5 ? '#a8a294' : '#8f8a7e', 1.2 * k); }
      const things = [];
      const FLOWER = ['#ff5a7a', '#ffd84a', '#ffffff', '#b48cff', '#ff9a3c'];
      for (let i = 0; i < 64; i++) { const y = HZ + 3 + r() * (H - HZ - 3); things.push({ x: r() * W, y, k: depthK(g, y), p: r() * 6, flower: FLOWER[Math.floor(r() * FLOWER.length)] }); }
      for (let i = 0; i < 120; i++) { const y = HZ + 2 + r() * (H - HZ - 2); things.push({ x: r() * W, y, k: depthK(g, y), p: r() * 6, col: r() < 0.5 ? '#5aa845' : '#93db70' }); }
      things.sort((a, b) => a.y - b.y);
      const clouds = [0, 1, 2].map((i) => ({ x: r() * FW, y: 12 + i * 13 + r() * 6, w: 22 + r() * 18, v: 1.2 + r() * 1.5 }));
      return {
        dark: false,
        draw(ctx, t, pan, light) {
          const ox = -PAN + pan * FAR_SLIDE;
          ctx.drawImage(sky.c, ox, 0);
          if (!light) sun(ctx, ox + FW * 0.82, 26);
          else if (light.sky.visible) sun(ctx, ox + FW * (0.06 + 0.88 * light.sky.x), HZ - 8 - (HZ - 34) * light.sky.up, light.kind === 'moon');
          ctx.drawImage(far.c, ox, 0);
          for (const c of clouds) {
            const x = ((c.x - t * c.v) % (FW + 60) + FW + 60) % (FW + 60) - 30 - PAN + pan * FAR_SLIDE;
            box(ctx, x, c.y, c.w, 5, '#ffffff'); box(ctx, x + c.w * 0.2, c.y - 3, c.w * 0.45, 4, '#ffffff'); box(ctx, x + 2, c.y + 5, c.w - 4, 2, '#e2f1fa');
          }
          ctx.drawImage(mid.c, -PAN + pan * MID_SLIDE, 0);
          ctx.drawImage(ground.c, 0, 0);
          const wv = gust(t);
          for (const f of things) {
            const sway = wv * Math.sin(t * 1.8 + f.x * 0.05 + f.p) * 1.4 * f.k;
            if (f.flower) {
              const tip = blade(ctx, f.x, f.y, (3 + f.p * 0.3) * f.k, sway, '#3f8f3a');
              box(ctx, tip[0] - 1, tip[1] - 1, 2, 2, f.flower);
              if (f.k > 0.9) box(ctx, tip[0], tip[1] - 1, 1, 1, '#fff3b0');
            } else blade(ctx, f.x, f.y, 3 * f.k + 1, sway, f.col);
          }
        },
      };
    },

    cave(g) {
      const { W, H } = g, HZ = g.yFar - 10, r = rng(5), FW = W + 2 * PAN;
      const far = canvas(FW, H), ground = canvas(W, H);
      vgrad(far.ctx, 0, HZ + 2, ['#110f22', '#221d38']);
      for (let i = 0; i < 40; i++) disc(far.ctx, r() * FW, r() * HZ, 6 + r() * 16, r() < 0.5 ? 'rgba(10,8,24,0.55)' : 'rgba(60,52,92,0.35)', 3 + r() * 8);
      for (let x = 0; x < FW; x += 10 + r() * 16) { // stalactites
        const len = 8 + r() * 26, w = 6 + r() * 8;
        for (let j = 0; j < len; j++) {
          const ww = Math.max(1, w * (1 - j / len));
          box(far.ctx, x - ww / 2, j, ww, 1, '#2c2645'); box(far.ctx, x + ww / 2 - Math.max(1, ww * 0.35), j, Math.max(1, ww * 0.35), 1, '#1c1832');
          if (ww > 2) box(far.ctx, x - ww / 2, j, 1, 1, '#4a4270');
        }
      }
      vgrad(ground.ctx, HZ, H, ['#2b2541', '#3a3355']);
      box(ground.ctx, 0, HZ, W, 1, '#4a4268');
      for (let i = 0; i < 18; i++) { const y = HZ + 4 + r() * (H - HZ - 4), k = depthK(g, y), x = r() * W, rr = (3 + r() * 6) * k; disc(ground.ctx, x, y, rr, '#1f1a30', rr * 0.5); disc(ground.ctx, x, y - rr * 0.2, rr * 0.8, '#4a4266', rr * 0.25); }
      const crystals = [];
      for (let i = 0; i < 7; i++) {
        const left = i % 2 === 0, y = HZ + 2 + r() * (H - HZ - 10);
        crystals.push({ x: left ? r() * W * 0.22 : W - r() * W * 0.22, y, k: depthK(g, y), col: r() < 0.55 ? [111, 243, 255] : [255, 122, 224], n: 2 + Math.floor(r() * 3), p: r() * 6 });
      }
      const flies = [];
      for (let i = 0; i < 11; i++) flies.push({ x: r() * W, y: 20 + r() * (H - 40), a: 10 + r() * 20, b: 4 + r() * 8, f: 0.2 + r() * 0.3, p: r() * 6 });
      return {
        dark: true,
        draw(ctx, t, pan) {
          ctx.drawImage(far.c, -PAN + pan * FAR_SLIDE, 0); ctx.drawImage(ground.c, 0, 0);
          for (const c of crystals) {
            const glow = 0.55 + 0.45 * Math.sin(t * 1.5 + c.p), rgb = c.col.join(',');
            const gr = ctx.createRadialGradient(c.x, c.y - 4 * c.k, 0, c.x, c.y - 4 * c.k, 20 * c.k);
            gr.addColorStop(0, 'rgba(' + rgb + ',' + (0.35 * glow) + ')'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
            ctx.fillStyle = gr; ctx.fillRect(c.x - 20 * c.k, c.y - 24 * c.k, 40 * c.k, 40 * c.k);
            for (let j = 0; j < c.n; j++) {
              const x = c.x + (j - (c.n - 1) / 2) * 3 * c.k, h = (6 + ((j * 5 + c.n) % 4) * 2) * c.k, lean = (j - (c.n - 1) / 2) * 1.2 * c.k;
              for (let y = 0; y < h; y++) { const ww = Math.max(1, 2.4 * c.k * (1 - y / h) + 0.6); box(ctx, x + lean * y / h - ww / 2, c.y - y, ww, 1, 'rgb(' + c.col.map((v) => Math.round(v * (0.55 + 0.45 * y / h))).join(',') + ')'); }
              box(ctx, x + lean - 0.5, c.y - h, 1, 1, '#ffffff');
            }
          }
          for (const f of flies) {
            const x = f.x + Math.sin(t * f.f + f.p) * f.a, y = f.y + Math.sin(t * f.f * 1.7 + f.p * 2) * f.b, on = 0.4 + 0.6 * Math.max(0, Math.sin(t * 2.3 + f.p * 3));
            ctx.fillStyle = 'rgba(255,240,150,' + (0.25 * on) + ')'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
            ctx.fillStyle = 'rgba(255,248,190,' + on + ')'; ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
          }
        },
      };
    },

    // Tap Slay Die's forest: chunky pixels (drawn at half size, shown at 2x), black outlines, a teal forest, dark trunks,
    // red mushrooms, a dirt clearing. Drawn from scratch in that style; no game files are used.
    wildwood(g) {
      const { W, H } = g, HZ = g.yFar - 10, r = rng(3), FW = W + 2 * PAN;
      const lw = Math.ceil(FW / 2), lh = Math.ceil(H / 2), hz = Math.round(HZ / 2);
      const farLo = canvas(lw, lh), midLo = canvas(lw, lh), groundLo = canvas(Math.ceil(W / 2), lh);
      const outlined = (ctx, cx, cy, rr, col, hi) => { disc(ctx, cx, cy, rr + 1, '#0b0b10'); disc(ctx, cx, cy, rr, col); if (hi) disc(ctx, cx - rr * 0.3, cy - rr * 0.35, rr * 0.45, hi); };
      bands(farLo.ctx, 0, hz + 1, ['#143236', '#173b3e', '#1b4545', '#20504d']);
      for (let x = -4; x < lw + 4; x += 6 + r() * 6) { const hh = 10 + r() * 14; box(farLo.ctx, x, hz - hh, 5, hh, '#1a4342'); disc(farLo.ctx, x + 2, hz - hh, 5 + r() * 3, '#1f4f4b'); }
      // Trunks and canopy, outlined.
      for (let x = 2; x < lw; x += 16 + r() * 14) {
        const tw = 4 + Math.floor(r() * 3), top = 6 + r() * 10;
        box(midLo.ctx, x - 1, top, tw + 2, hz - top + 2, '#0b0b10'); box(midLo.ctx, x, top, tw, hz - top + 1, '#2c2130'); box(midLo.ctx, x + 1, top, 1, hz - top, '#3d2f42');
        for (let k = 0; k < 3; k++) outlined(midLo.ctx, x + tw / 2 + (k - 1) * 6, top - 2 + (k === 1 ? -4 : 0), 6 + r() * 3, '#2f7a6a', '#44a088');
      }
      const gw = groundLo.c.width;
      box(groundLo.ctx, 0, hz, gw, lh - hz, '#2f6450');
      // The dirt clearing, wider at the front, with a lighter path down the middle.
      for (let y = hz; y < lh; y++) {
        const u = (y - hz) / (lh - hz), half = gw * (0.3 + 0.2 * u), pathHalf = gw * (0.06 + 0.12 * u);
        box(groundLo.ctx, gw / 2 - half - 1, y, 2 * half + 2, 1, '#0b0b10');
        box(groundLo.ctx, gw / 2 - half, y, 2 * half, 1, u < 0.3 ? '#6e4630' : '#7a5038');
        box(groundLo.ctx, gw / 2 - pathHalf, y, 2 * pathHalf, 1, '#9a6a48');
        if (y % 3 === 0) box(groundLo.ctx, gw / 2 - half + r() * half * 2, y, 1, 1, '#5a3826');
      }
      box(groundLo.ctx, 0, hz, gw, 1, '#0b0b10');
      for (let i = 0; i < 8; i++) { // purple rocks
        const left = i % 2 === 0, y = hz + 3 + r() * (lh - hz - 6), x = left ? r() * gw * 0.18 : gw - r() * gw * 0.18;
        disc(groundLo.ctx, x, y, 3.2, '#0b0b10', 2.2); disc(groundLo.ctx, x, y, 2.4, '#5a4a6a', 1.5); box(groundLo.ctx, x - 1, y - 1, 1, 1, '#7d6a90');
      }
      const shrooms = [];
      for (let i = 0; i < 7; i++) { const left = i % 2 === 0, y = hz + 4 + r() * (lh - hz - 6); shrooms.push({ x: left ? 3 + r() * gw * 0.2 : gw - 3 - r() * gw * 0.2, y, s: 1 + Math.round(r()) }); }
      shrooms.sort((a, b) => a.y - b.y);
      for (const m of shrooms) {
        box(groundLo.ctx, m.x - 1, m.y - 3 * m.s, 3, 3 * m.s + 1, '#0b0b10'); box(groundLo.ctx, m.x, m.y - 3 * m.s, 1, 3 * m.s, '#e8d8c0');
        disc(groundLo.ctx, m.x + 0.5, m.y - 3 * m.s, 2.5 * m.s + 1, '#0b0b10', 1.5 * m.s + 1); disc(groundLo.ctx, m.x + 0.5, m.y - 3 * m.s, 2.5 * m.s, '#d8413a', 1.5 * m.s);
        box(groundLo.ctx, m.x - m.s, m.y - 3 * m.s - m.s, 1, 1, '#ffffff'); box(groundLo.ctx, m.x + m.s, m.y - 3 * m.s, 1, 1, '#ffffff');
      }
      const up = (lo, w) => { const c = canvas(w, H); c.ctx.drawImage(lo.c, 0, 0, lo.c.width * 2, lo.c.height * 2); return c; };
      const far = up(farLo, FW), mid = up(midLo, FW), ground = up(groundLo, W);
      const ferns = [];
      for (let i = 0; i < 26; i++) { const left = i % 2 === 0, y = HZ + 4 + r() * (H - HZ - 4); ferns.push({ x: left ? r() * W * 0.24 : W - r() * W * 0.24, y, k: depthK(g, y), p: r() * 6 }); }
      ferns.sort((a, b) => a.y - b.y);
      const motes = [];
      for (let i = 0; i < 9; i++) motes.push({ x: r() * W, y: 20 + r() * (HZ + 30), p: r() * 6 });
      return {
        dark: true,
        draw(ctx, t, pan) {
          ctx.drawImage(far.c, -PAN + pan * FAR_SLIDE, 0); ctx.drawImage(mid.c, -PAN + pan * MID_SLIDE, 0); ctx.drawImage(ground.c, 0, 0);
          const wv = gust(t);
          for (const f of ferns) {
            const sway = wv * Math.sin(t * 1.4 + f.x * 0.06 + f.p) * 2 * f.k;
            for (let b = -1; b <= 1; b++) {
              const x = Math.round((f.x + b * 3 * f.k) / 2) * 2, h = Math.round((b === 0 ? 8 : 6) * f.k / 2) * 2, lean = Math.round((b * 3 * f.k + sway) / 2) * 2;
              for (let j = 0; j < h; j += 2) { const u = j / h; box(ctx, x + Math.round(lean * u * u / 2) * 2 - 1, f.y - j - 1, 4, 2, '#0b0b10'); }
              for (let j = 0; j < h; j += 2) { const u = j / h; box(ctx, x + Math.round(lean * u * u / 2) * 2, f.y - j, 2, 2, b === 0 ? '#3d9b6e' : '#2f7a58'); }
            }
          }
          for (const m of motes) {
            const x = m.x + Math.sin(t * 0.3 + m.p) * 14, y = m.y - ((t * 4 + m.p * 20) % 60), on = 0.5 + 0.5 * Math.sin(t * 2 + m.p);
            ctx.fillStyle = 'rgba(184,255,207,' + (0.35 + 0.5 * on) + ')'; ctx.fillRect(Math.round(x / 2) * 2, Math.round(y / 2) * 2, 2, 2);
          }
        },
      };
    },

    studio(g) {
      const { W, H } = g, HZ = g.yFar - 10;
      const c = canvas(W, H);
      vgrad(c.ctx, 0, H, [[0, '#f7f4f1'], [HZ / H * 0.8, '#f0ebe6'], [Math.min(0.95, (HZ + 24) / H), '#e5dfd9'], [1, '#ece7e2']]);
      const spot = c.ctx.createRadialGradient(W / 2, (g.yFar + g.yNear) / 2, 0, W / 2, (g.yFar + g.yNear) / 2, W * 0.45);
      spot.addColorStop(0, 'rgba(255,255,255,0.55)'); spot.addColorStop(1, 'rgba(255,255,255,0)');
      c.ctx.fillStyle = spot; c.ctx.fillRect(0, 0, W, H);
      const vig = c.ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.7);
      vig.addColorStop(0, 'rgba(60,40,30,0)'); vig.addColorStop(1, 'rgba(60,40,30,0.09)');
      c.ctx.fillStyle = vig; c.ctx.fillRect(0, 0, W, H);
      return { dark: false, draw(ctx) { ctx.drawImage(c.c, 0, 0); } };
    },
  };

  function create(key, geom) { return (MAKERS[key] || MAKERS.grass)(geom); }
  const api = { LIST, create, keys: LIST.map((h) => h[0]), PAN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureHabitats = api;
})(typeof window !== 'undefined' ? window : globalThis);
