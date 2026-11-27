/* Creature Hatchery, version 3: the ground seen from straight above, drawn in code (no image files).
   Four floors: grass, dirt, stones and a pond shore. The still ground is drawn once into an offscreen canvas (at a
   third of the size for the Pixel look, then scaled up with hard pixels); a few things move gently on top: grass tips
   and petals in the wind, rings on the water and a slow glint along the shoreline. Reduced motion holds them still.
   The day and night tint (CreatureLight.drawTint) goes over the whole scene afterwards, in app3.js.

   CreatureHabitats3.create(key, { W, H, view, pixel, seed }) -> { key, name, draw(ctx, t, opts), area(a), shoreZ }
     view   { scale, ox, oy } the same world-to-screen map the creature uses (to keep the walk area off the water)
     pixel  1 for smooth, or the Pixel look's pixel size
     area(a) narrows a walk area { minX, maxX, minZ, maxZ } so the creature stays on land */
(function (root) {
  'use strict';
  const LIST = [
    ['grass', 'Grass', 'a meadow lawn: tufts, clover, a few flowers'],
    ['dirt', 'Dirt', 'a packed dirt yard: pebbles, cracks, old tracks'],
    ['stones', 'Stones', 'flat stepping stones in gravel and moss'],
    ['water', 'Pond', 'a pond shore: water, wet sand, ripples'],
  ];
  const KEYS = LIST.map((l) => l[0]);

  function rng(seed) { let a = seed >>> 0 || 7; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function canvas(w, h) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    return { c, ctx: c.getContext('2d') };
  }
  const hsl = (h, s, l, a) => 'hsla(' + h.toFixed(1) + ',' + (s * 100).toFixed(1) + '%,' + (l * 100).toFixed(1) + '%,' + (a == null ? 1 : a) + ')';
  function disc(ctx, x, y, r, col, ry, rot) { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.3, r), Math.max(0.3, ry == null ? r : ry), rot || 0, 0, Math.PI * 2); ctx.fill(); }
  // Soft blotches of near colours: the ground's slow variation.
  function mottle(ctx, W, H, r, n, h, s, l, spread, a) {
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = r() * H, rr = (0.02 + 0.07 * r()) * Math.max(W, H);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      const c = hsl(h + (r() - 0.5) * spread * 30, s * (0.85 + 0.3 * r()), l + (r() - 0.5) * spread * 0.12, a);
      g.addColorStop(0, c); g.addColorStop(1, hsl(h, s, l, 0));
      ctx.fillStyle = g; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
  }
  // Fine grain: many tiny dots, lighter and darker than the ground.
  function grain(ctx, W, H, r, n, h, s, l, d, size) {
    for (let i = 0; i < n; i++) {
      const up = r() < 0.5;
      ctx.fillStyle = hsl(h + (r() - 0.5) * 16, s, l + (up ? d : -d) * (0.5 + r() * 0.5), 0.55);
      const sz = size * (0.6 + r() * 0.8);
      ctx.fillRect(r() * W, r() * H, sz, sz);
    }
  }
  // A grass tuft from above: short blades fanning out from a point, darker at the root.
  function tuft(ctx, x, y, k, r, hue, lean) {
    const n = 4 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const a = lean + (r() - 0.5) * 2.2, L = k * (5 + r() * 6);
      ctx.strokeStyle = hsl(hue + (r() - 0.5) * 14, 0.45, 0.3 + r() * 0.16);
      ctx.lineWidth = Math.max(1, k * 1.2); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * L * 0.5, y + Math.sin(a) * L * 0.5 - k, x + Math.cos(a) * L, y + Math.sin(a) * L); ctx.stroke();
    }
  }
  function stoneShape(r, cx, cy, rx, ry) {
    const n = 9, pts = [], rot = r() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a = rot + i * Math.PI * 2 / n, k = 0.82 + r() * 0.24;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return pts;
  }
  function smooth(ctx, P) {
    const n = P.length; ctx.beginPath();
    ctx.moveTo((P[0][0] + P[n - 1][0]) / 2, (P[0][1] + P[n - 1][1]) / 2);
    for (let i = 0; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
    ctx.closePath();
  }

  // ---------- the floors (drawn in screen pixels at full size; k is pixels per world unit / 80) ----------
  const FLOORS = {
    grass(ctx, W, H, r, k) {
      ctx.fillStyle = hsl(100, 0.36, 0.43); ctx.fillRect(0, 0, W, H);
      mottle(ctx, W, H, r, 70, 98, 0.38, 0.43, 1, 0.55);
      grain(ctx, W, H, r, Math.round(W * H / 40), 96, 0.4, 0.42, 0.1, 1.4 * k);
      // clover patches
      for (let i = 0; i < 18; i++) {
        const x = r() * W, y = r() * H;
        for (let j = 0; j < 6; j++) {
          const px = x + (r() - 0.5) * 30 * k, py = y + (r() - 0.5) * 20 * k;
          for (let l = 0; l < 3; l++) { const a = l * 2.1 + r(); disc(ctx, px + Math.cos(a) * 2 * k, py + Math.sin(a) * 2 * k, 1.8 * k, hsl(118, 0.38, 0.36 + r() * 0.06)); }
        }
      }
      for (let i = 0; i < 160; i++) tuft(ctx, r() * W, r() * H, k * (0.7 + r() * 0.5), r, 96, -1.2 + r() * 0.6);
    },
    dirt(ctx, W, H, r, k) {
      ctx.fillStyle = hsl(30, 0.32, 0.47); ctx.fillRect(0, 0, W, H);
      mottle(ctx, W, H, r, 60, 30, 0.32, 0.46, 1, 0.6);
      grain(ctx, W, H, r, Math.round(W * H / 30), 28, 0.3, 0.46, 0.12, 1.3 * k);
      // old tracks: two faint grooves crossing the yard
      for (let t = 0; t < 2; t++) {
        const y0 = H * (0.25 + 0.5 * r()), y1 = H * (0.25 + 0.5 * r());
        for (const off of [-9, 9]) {
          ctx.strokeStyle = hsl(28, 0.3, 0.4, 0.35); ctx.lineWidth = 4 * k;
          ctx.beginPath(); ctx.moveTo(-10, y0 + off * k); ctx.bezierCurveTo(W * 0.35, y0 + off * k + 30 * k, W * 0.65, y1 + off * k - 30 * k, W + 10, y1 + off * k); ctx.stroke();
        }
      }
      // dry cracks
      ctx.strokeStyle = hsl(26, 0.28, 0.34, 0.5); ctx.lineWidth = Math.max(1, 0.8 * k);
      for (let i = 0; i < 14; i++) {
        let x = r() * W, y = r() * H, a = r() * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let j = 0; j < 5; j++) { a += (r() - 0.5) * 1.4; x += Math.cos(a) * 7 * k; y += Math.sin(a) * 7 * k; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      // pebbles, each with a little shadow down-right and a lit top-left
      for (let i = 0; i < 90; i++) {
        const x = r() * W, y = r() * H, rr = (1.2 + r() * 2.6) * k, h = 25 + r() * 20, l = 0.5 + r() * 0.2;
        disc(ctx, x + rr * 0.35, y + rr * 0.35, rr, hsl(28, 0.3, 0.3, 0.45));
        disc(ctx, x, y, rr, hsl(h, 0.15, l), rr * 0.8, r() * 3);
        disc(ctx, x - rr * 0.3, y - rr * 0.3, rr * 0.4, hsl(h, 0.15, l + 0.12));
      }
      for (let i = 0; i < 26; i++) tuft(ctx, r() * W, r() * H, k * 0.7, r, 70, -1.2);
    },
    stones(ctx, W, H, r, k) {
      ctx.fillStyle = hsl(60, 0.08, 0.5); ctx.fillRect(0, 0, W, H);
      mottle(ctx, W, H, r, 50, 70, 0.12, 0.5, 1, 0.5);
      grain(ctx, W, H, r, Math.round(W * H / 14), 50, 0.08, 0.5, 0.16, 1.5 * k); // gravel
      // moss in the gaps
      for (let i = 0; i < 26; i++) { const x = r() * W, y = r() * H; for (let j = 0; j < 10; j++) disc(ctx, x + (r() - 0.5) * 26 * k, y + (r() - 0.5) * 18 * k, (2 + r() * 4) * k, hsl(95, 0.35, 0.36 + r() * 0.08, 0.8)); }
      // flat stepping stones on a loose grid
      const cols = 6, rows = 4;
      for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
        if (r() < 0.18) continue;
        const cx = (gx + 0.5 + (r() - 0.5) * 0.5) * W / cols, cy = (gy + 0.5 + (r() - 0.5) * 0.5) * H / rows;
        const rx = (22 + r() * 16) * k, ry = (15 + r() * 10) * k, l = 0.56 + r() * 0.1, h = 40 + r() * 30;
        const P = stoneShape(r, cx, cy, rx, ry);
        ctx.save(); ctx.translate(2.5 * k, 3 * k); smooth(ctx, P); ctx.fillStyle = hsl(60, 0.1, 0.28, 0.5); ctx.fill(); ctx.restore();
        smooth(ctx, P); ctx.fillStyle = hsl(h, 0.06, l); ctx.fill();
        ctx.save(); ctx.clip();
        const g = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
        g.addColorStop(0, hsl(h, 0.06, l + 0.1, 0.8)); g.addColorStop(0.55, hsl(h, 0.06, l, 0)); g.addColorStop(1, hsl(h, 0.08, l - 0.1, 0.7));
        ctx.fillStyle = g; ctx.fillRect(cx - rx * 1.2, cy - ry * 1.2, rx * 2.4, ry * 2.4);
        for (let j = 0; j < 14; j++) disc(ctx, cx + (r() - 0.5) * rx * 1.6, cy + (r() - 0.5) * ry * 1.6, (0.6 + r()) * k, hsl(h, 0.05, l + (r() - 0.5) * 0.12, 0.7));
        if (r() < 0.5) for (let j = 0; j < 5; j++) disc(ctx, cx + (r() - 0.5) * rx * 1.4, cy - ry * 0.4 + (r() - 0.5) * ry, (1.5 + r() * 2) * k, hsl(100, 0.25, 0.42, 0.5)); // lichen
        ctx.restore();
        smooth(ctx, P); ctx.strokeStyle = hsl(60, 0.08, 0.34, 0.6); ctx.lineWidth = Math.max(1, k); ctx.stroke();
      }
      for (let i = 0; i < 40; i++) tuft(ctx, r() * W, r() * H, k * 0.65, r, 95, -1.2);
    },
    water(ctx, W, H, r, k, shore) {
      // land first: dry sand fading into grass at the bottom
      ctx.fillStyle = hsl(42, 0.42, 0.68); ctx.fillRect(0, 0, W, H);
      mottle(ctx, W, H, r, 40, 42, 0.42, 0.67, 0.8, 0.5);
      const gg = ctx.createLinearGradient(0, H * 0.72, 0, H);
      gg.addColorStop(0, hsl(90, 0.35, 0.5, 0)); gg.addColorStop(1, hsl(92, 0.36, 0.46, 0.95));
      ctx.fillStyle = gg; ctx.fillRect(0, H * 0.72, W, H * 0.28);
      grain(ctx, W, H, r, Math.round(W * H / 28), 40, 0.35, 0.66, 0.1, 1.2 * k);
      for (let i = 0; i < 40; i++) tuft(ctx, r() * W, H * (0.84 + r() * 0.16), k * 0.8, r, 92, -1.2);
      // shells and pebbles on the sand
      for (let i = 0; i < 24; i++) { const x = r() * W, y = shore(x) + (18 + r() * (H * 0.45)) * 1; disc(ctx, x, y, (1 + r() * 1.6) * k, hsl(30 + r() * 20, 0.2, 0.78 + r() * 0.1), (0.8 + r()) * k, r() * 3); }
      // the wet band: darker sand along the waterline
      const band = (off, col) => {
        ctx.beginPath(); ctx.moveTo(0, 0);
        for (let x = 0; x <= W; x += 4) ctx.lineTo(x, shore(x) + off(x));
        ctx.lineTo(W, 0); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
      };
      band((x) => 16 * k + 4 * k * Math.sin(x * 0.03), hsl(36, 0.36, 0.56, 0.6));
      band((x) => 8 * k + 2 * k * Math.sin(x * 0.05 + 1), hsl(34, 0.34, 0.5, 0.7));
      // the water: shallow green-blue at the edge to deeper blue at the top
      ctx.save();
      band(() => 0, '#000'); ctx.clip();
      const wg = ctx.createLinearGradient(0, 0, 0, shore(W / 2) + 10);
      wg.addColorStop(0, hsl(205, 0.48, 0.34)); wg.addColorStop(0.7, hsl(192, 0.42, 0.44)); wg.addColorStop(1, hsl(178, 0.36, 0.56));
      ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);
      mottle(ctx, W, shore(W / 2), r, 24, 200, 0.45, 0.38, 1, 0.35);
      // the sandy bottom shows through the shallows
      for (let i = 0; i < 6; i++) { const x = r() * W; disc(ctx, x, shore(x) - (10 + r() * 30) * k, (12 + r() * 20) * k, hsl(185, 0.3, 0.52, 0.25), (4 + r() * 6) * k); }
      // lily pads
      for (let i = 0; i < 5; i++) {
        const x = r() * W, y = shore(x) * (0.15 + r() * 0.5), rr = (6 + r() * 6) * k, a = r() * 6;
        ctx.fillStyle = hsl(110, 0.4, 0.34); ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, rr, a + 0.4, a + Math.PI * 2 - 0.1); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = hsl(110, 0.4, 0.26); ctx.lineWidth = Math.max(1, 0.7 * k); ctx.stroke();
        if (r() < 0.35) { disc(ctx, x + rr * 0.2, y - rr * 0.1, rr * 0.35, hsl(335, 0.55, 0.82)); disc(ctx, x + rr * 0.2, y - rr * 0.1, rr * 0.14, hsl(48, 0.8, 0.62)); }
      }
      ctx.restore();
      // foam line at the edge
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = Math.max(1, 1.4 * k);
      ctx.beginPath(); for (let x = 0; x <= W; x += 4) { const y = shore(x) - 1; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke();
      // reeds on the shore at the sides
      for (const side of [0.06, 0.94]) for (let i = 0; i < 14; i++) {
        const x = W * side + (r() - 0.5) * 40 * k, y = shore(x) + (r() - 0.2) * 12 * k;
        disc(ctx, x, y, (2 + r() * 1.5) * k, hsl(95, 0.35, 0.32));
        tuft(ctx, x, y, k * 1.1, r, 80, -1.6);
      }
    },
  };

  function create(key, o) {
    key = KEYS.includes(key) ? key : 'grass';
    const W = o.W, H = o.H, px = Math.max(1, Math.round(o.pixel || 1)), view = o.view || { scale: 80, ox: W / 2, oy: H / 2 };
    const k = view.scale / 80, seed = (o.seed >>> 0) || 1234;
    // the waterline, in screen pixels: a gentle curve across the upper third
    const shore = (x) => H * 0.3 + 10 * k * Math.sin(x / W * Math.PI * 2 + 0.6) + 6 * k * Math.sin(x / W * Math.PI * 5 + 2);
    const shoreMax = H * 0.3 + 16 * k;
    // the ground, once, at full or Pixel size
    const bw = Math.ceil(W / px), bh = Math.ceil(H / px), base = canvas(bw, bh);
    base.ctx.save(); base.ctx.scale(1 / px, 1 / px);
    FLOORS[key](base.ctx, W, H, rng(seed + KEYS.indexOf(key) * 977), k, shore);
    base.ctx.restore();
    // things that move: grass tips and petals (grass), ripples and glints (water)
    const r = rng(seed ^ 0x5bd1e995);
    const swayers = [], ripples = [], glints = [];
    if (key === 'grass') {
      for (let i = 0; i < 60; i++) swayers.push({ x: r() * W, y: r() * H, L: (6 + r() * 6) * k, a: -1.3 + (r() - 0.5) * 1.2, ph: r() * 6, hue: 92 + r() * 14, l: 0.36 + r() * 0.14 });
      for (let i = 0; i < 16; i++) swayers.push({ x: r() * W, y: r() * H, L: 4 * k, a: -1.4, ph: r() * 6, flower: [[48, 0.85, 0.7], [0, 0, 0.96], [330, 0.6, 0.8], [270, 0.4, 0.78]][Math.floor(r() * 4)] });
    } else if (key === 'water') {
      for (let i = 0; i < 7; i++) { const x = r() * W; ripples.push({ x, y: shore(x) * (0.15 + r() * 0.7), ph: r(), per: 5 + r() * 4 }); }
      for (let i = 0; i < 26; i++) { const x = r() * W; glints.push({ x, y: shore(x) * r() * 0.95, ph: r() * 6, L: (3 + r() * 5) * k }); }
    }
    function draw(ctx, t, opts) {
      opts = opts || {};
      const still = !!opts.reduced, tt = still ? 0 : t;
      ctx.save();
      ctx.imageSmoothingEnabled = px === 1;
      ctx.drawImage(base.c, 0, 0, bw * px, bh * px);
      ctx.restore();
      const P = (v) => (px > 1 ? Math.round(v / px) * px : v);
      if (swayers.length) {
        const gust = 0.6 + 0.4 * Math.sin(tt * 0.37) * Math.sin(tt * 0.13 + 1);
        ctx.save(); ctx.lineCap = 'round';
        for (const s of swayers) {
          const a = s.a + (still ? 0 : 0.18 * gust * Math.sin(tt * 1.3 + s.ph + s.x * 0.01));
          const ex = s.x + Math.cos(a) * s.L, ey = s.y + Math.sin(a) * s.L;
          if (s.flower) {
            ctx.strokeStyle = hsl(100, 0.4, 0.3); ctx.lineWidth = Math.max(1, k);
            ctx.beginPath(); ctx.moveTo(P(s.x), P(s.y)); ctx.lineTo(P(ex), P(ey)); ctx.stroke();
            for (let j = 0; j < 5; j++) { const b = j * 1.2566 + s.ph; ctx.fillStyle = hsl(s.flower[0], s.flower[1], s.flower[2]); ctx.fillRect(P(ex + Math.cos(b) * 1.8 * k) - k, P(ey + Math.sin(b) * 1.8 * k) - k, Math.max(px, 2 * k), Math.max(px, 2 * k)); }
            ctx.fillStyle = hsl(45, 0.8, 0.55); ctx.fillRect(P(ex) - k * 0.8, P(ey) - k * 0.8, Math.max(px, 1.6 * k), Math.max(px, 1.6 * k));
          } else {
            ctx.strokeStyle = hsl(s.hue, 0.45, s.l); ctx.lineWidth = Math.max(px > 1 ? px : 1, 1.3 * k);
            ctx.beginPath(); ctx.moveTo(P(s.x), P(s.y)); ctx.quadraticCurveTo(P((s.x + ex) / 2), P((s.y + ey) / 2 - k), P(ex), P(ey)); ctx.stroke();
          }
        }
        ctx.restore();
      }
      if (ripples.length) {
        ctx.save(); ctx.lineWidth = Math.max(px > 1 ? px : 1, 1);
        for (const q of ripples) {
          for (let j = 0; j < 2; j++) {
            const u = still ? 0.35 + j * 0.3 : ((tt / q.per + q.ph + j * 0.5) % 1);
            ctx.strokeStyle = 'rgba(235,250,255,' + (0.3 * (1 - u)).toFixed(3) + ')';
            ctx.beginPath(); ctx.ellipse(P(q.x), P(q.y), (4 + 22 * u) * k, (2 + 9 * u) * k, 0, 0, Math.PI * 2); ctx.stroke();
          }
        }
        for (const g of glints) {
          const a = still ? 0.18 : 0.1 + 0.16 * (0.5 + 0.5 * Math.sin(tt * 0.6 + g.ph));
          ctx.strokeStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
          const dx = still ? 0 : Math.sin(tt * 0.3 + g.ph) * 2 * k;
          ctx.beginPath(); ctx.moveTo(P(g.x + dx), P(g.y)); ctx.lineTo(P(g.x + dx + g.L), P(g.y)); ctx.stroke();
        }
        // the lap of the water on the sand: the foam edge creeps up and back
        const lap = still ? 0 : (0.5 + 0.5 * Math.sin(tt * 0.5)) * 4 * k;
        ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = Math.max(px > 1 ? px : 1, 1.2 * k);
        ctx.beginPath(); for (let x = 0; x <= W; x += 6) { const y = P(shore(x) + lap); if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke();
        ctx.restore();
      }
    }
    // keep the creature (whole body, not just its middle) on land: the walk area's far edge sits below the waterline
    function area(a) {
      if (key !== 'water') return a;
      const zShore = (shoreMax - view.oy) / view.scale;
      return Object.assign({}, a, { minZ: Math.max(a.minZ, zShore + 0.35) });
    }
    return { key, name: LIST[KEYS.indexOf(key)][1], draw, area, shoreZ: key === 'water' ? (shoreMax - view.oy) / view.scale : null, base: base.c };
  }

  const api = { LIST, KEYS, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureHabitats3 = api;
})(typeof window !== 'undefined' ? window : globalThis);
