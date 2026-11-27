/* Creatures, version 2: the light. A sun crosses the sky from up-left to up-right (dawn to dusk), then a dim moon does
   the same at night. Shadows are cast by the creature's actual pieces: every body segment, leg, foot, head part, wing
   and tail cone is sampled as a row of small spheres, each sphere is projected onto the ground along the light, and the
   union of those projections is the shadow. So a low sun gives a long thin shadow, noon a short tight one, it points
   away from the light, and it moves with the legs, the turns and hops. Pieces higher above the ground give softer,
   fainter shadow. Pixel look gets a hard-edged pixel shadow, Cel a two-tone one, the Original a soft one.
   The body's own shading still uses the renderer's fixed light (version 1's render.js is shared and unchanged); only
   the cast shadow, the sky marker and the scene tint follow the sun.

   time of day t in [0, 1): 0 sunrise (left), 0.25 noon, 0.5 sunset (right), 0.5..1 night (the moon, left to right).
   World axes as in the page: x across (screen right), y up, z towards the viewer. */
(function (root) {
  'use strict';
  const DEG = Math.PI / 180;
  const MIN_ELEV = 10 * DEG, SUN_ELEV = 64 * DEG, MOON_ELEV = 42 * DEG;
  const BACK = 0.45;              // the light sits a little behind the scene, so shadows fall a little towards us
  const SUN_STRENGTH = 0.4, MOON_STRENGTH = 0.13;
  const PENUMBRA = 0.14;          // how fast shadow softens with height (an exaggerated sun size, for looks)
  const NAMED = { dawn: 0.02, left: 0.06, morning: 0.14, noon: 0.25, afternoon: 0.36, right: 0.44, dusk: 0.48, night: 0.75 };
  const WHITE = [255, 255, 255], HORIZON = [255, 198, 160], NIGHT = [124, 138, 196];
  const SHADOW_RGB = [22, 24, 44];

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

  // The light at time t: direction towards it (unit, y > 0), elevation, strength of direct light, the scene's tint
  // (multiplied over the picture), and where its marker goes in the sky (u: 0 left .. 1 right).
  function sunAt(t) {
    t = ((Number(t) % 1) + 1) % 1;
    const day = t < 0.5, u = day ? t / 0.5 : (t - 0.5) / 0.5, a = Math.PI * u;
    const elev = MIN_ELEV + ((day ? SUN_ELEV : MOON_ELEV) - MIN_ELEV) * Math.sin(a);
    const hx = -Math.cos(a), hz = -BACK, hl = Math.hypot(hx, hz);
    const ce = Math.cos(elev);
    const L = [hx / hl * ce, Math.sin(elev), hz / hl * ce];
    const edge = Math.min(u, 1 - u);   // 0 at the horizon
    const strength = day ? SUN_STRENGTH * (0.6 + 0.4 * smooth(MIN_ELEV, 40 * DEG, elev)) * smooth(0, 0.05, edge) : MOON_STRENGTH * smooth(0, 0.08, edge);
    const tint = day ? mix(HORIZON, WHITE, smooth(0, 0.2, edge)) : mix(HORIZON, NIGHT, smooth(0, 0.12, edge));
    const label = !day ? 'night' : u < 0.1 ? 'dawn' : u < 0.4 ? 'morning' : u < 0.6 ? 'noon' : u < 0.9 ? 'afternoon' : 'dusk';
    return { t, day, body: day ? 'sun' : 'moon', u, elev, L, strength, tint, label, warm: day ? 1 - smooth(0, 0.2, edge) : 0 };
  }
  // ?sun=left|noon|right|night or ?time=0..1 -> a time; anything else -> the fallback.
  function timeFor(v, fallback) {
    if (v == null || v === '') return fallback;
    if (NAMED[v] != null) return NAMED[v];
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return n >= 0 && n < 1 ? n : ((n % 1) + 1) % 1; // wrap only when needed: the wrap itself can round 0.4 to 0.3999…
  }

  // ---------- casters: a scene's pieces as spheres ----------
  const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  // Spheres (in the scene's own frame) that stand in for each piece: cones as a row along their length, ellipsoids as
  // a row along their long axis, thin plates (wings) as a small grid. `maxPer` caps the row length.
  function sceneSpheres(scene, maxPer) {
    const cap = maxPer || 10, out = [];
    for (const p of scene.prims) {
      if (p.k === 0) { // cone
        const rMin = Math.max(1e-4, Math.min(p.r1, p.r2));
        const n = clamp(Math.ceil(p.len / (rMin * 1.2)), 1, cap);
        for (let i = 0; i <= n; i++) { const k = i / n; out.push({ c: lerp3(p.a, p.b, k), r: (p.r1 + (p.r2 - p.r1) * k) * Math.sqrt(Math.max(1, p.sy || 1)), piece: p.piece }); }
      } else if (p.k === 1) { // ellipsoid
        const r = Math.max(1e-4, (p.ry + p.rz) / 2), long = p.rx - r;
        const n = long > r * 0.3 ? clamp(Math.ceil(long / (r * 0.6)), 1, cap) : 0;
        if (!n) out.push({ c: p.a.slice(), r: Math.max(r, p.rx * 0.9), piece: p.piece });
        else for (let i = 0; i <= n; i++) { const k = -1 + 2 * i / n; out.push({ c: [p.a[0] + p.ax[0] * long * k, p.a[1] + p.ax[1] * long * k, p.a[2] + p.ax[2] * long * k], r, piece: p.piece }); }
      } else { // triangle plate
        const e = Math.max(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]), Math.hypot(p.c[0] - p.a[0], p.c[1] - p.a[1], p.c[2] - p.a[2]), Math.hypot(p.c[0] - p.b[0], p.c[1] - p.b[1], p.c[2] - p.b[2]));
        for (let i = 0; i <= 3; i++) for (let j = 0; i + j <= 3; j++) {
          const wa = (3 - i - j) / 3, wb = i / 3, wc = j / 3;
          out.push({ c: [0, 1, 2].map((q) => p.a[q] * wa + p.b[q] * wb + p.c[q] * wc), r: e / 7 + p.r1, piece: p.piece });
        }
      }
    }
    return out;
  }
  // Scene frame (x forward, y up, z right) -> world, for a body standing at (x, z) facing th. Same maths as the walker.
  function placeSpheres(spheres, at) {
    const c = Math.cos(at.th), s = Math.sin(at.th), y0 = at.y || 0;
    return spheres.map((q) => ({ c: [at.x + c * q.c[0] + s * q.c[2], q.c[1] + y0, at.z - s * q.c[0] + c * q.c[2]], r: q.r * (at.scale || 1), piece: q.piece }));
  }

  // ---------- shadows ----------
  // Where a point lands on the ground, followed along the light.
  function groundPoint(c, L) { const k = Math.max(0, c[1]) / L[1]; return [c[0] - L[0] * k, c[2] - L[2] * k]; }
  // One sphere's shadow on the ground: an ellipse stretched away from the light by 1/sin(elevation), softer and fainter
  // the higher the sphere floats. `size` is the creature's size, so fading is the same at every scale.
  function blob(q, sun, size) {
    const L = sun.L, hl = Math.hypot(L[0], L[2]) || 1, g = groundPoint(q.c, L);
    const air = Math.max(0, q.c[1] - q.r);
    const along = q.r / Math.max(0.17, L[1]);
    return {
      x: g[0], z: g[1], hx: -L[0] / hl, hz: -L[2] / hl, a: along, b: q.r,
      reach: Math.hypot(g[0] - q.c[0], g[1] - q.c[2]) + along, // how far the shadow runs past the piece's own foot
      soft: 0.08 * q.r + PENUMBRA * air / Math.max(0.17, L[1]),
      dens: 1 / (1 + 1.6 * air / Math.max(1e-6, size || 1)),
    };
  }
  function shadowBlobs(worldSpheres, sun, size) {
    if (!(sun.strength > 0.004)) return [];
    return worldSpheres.filter((q) => q.c[1] + q.r > -1e-6).map((q) => blob(q, sun, size));
  }
  // A summary for checks: the shadow's centre, its length along the light, its width across it and how far it
  // reaches past the pieces (world units).
  function extent(blobs) {
    if (!blobs.length) return null;
    const hx = blobs[0].hx, hz = blobs[0].hz;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, cx = 0, cz = 0, reach = 0;
    for (const q of blobs) {
      const along = q.x * hx + q.z * hz, across = -q.x * hz + q.z * hx;
      a0 = Math.min(a0, along - q.a); a1 = Math.max(a1, along + q.a); b0 = Math.min(b0, across - q.b); b1 = Math.max(b1, across + q.b);
      cx += q.x; cz += q.z; reach = Math.max(reach, q.reach);
    }
    return { cx: cx / blobs.length, cz: cz / blobs.length, length: a1 - a0, width: b1 - b0, reach, hx, hz };
  }
  // How dark a shadow pixel is for a coverage value v (0..1) in each look: Pixel is hard-edged (one tone, no
  // in-between), Cel has two tones, the Original keeps the soft edge.
  function shadeAlpha(v, style, strength) {
    if (style === 'pixel') return v > 0.38 ? strength : 0;
    if (style === 'cel') return v > 0.6 ? strength : v > 0.22 ? strength * 0.55 : 0;
    return v * strength;
  }

  // ---------- drawing (browser only) ----------
  // A shadow layer the size of the stage. draw() paints all blobs (as a union: overlapping pieces don't double up)
  // onto the stage context, mapped to the floor by `toStage(x, z) -> {x, y}`.
  function createLayer(W, H) {
    const make = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const cov = make(), cctx = cov.getContext('2d', { willReadFrequently: true });
    const out = make(), octx = out.getContext('2d');
    const img = octx.createImageData(W, H);
    function draw(ctx, blobs, sun, toStage, opts) {
      opts = opts || {};
      if (!blobs.length) return;
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.globalCompositeOperation = 'source-over';
      cctx.fillStyle = '#000'; cctx.fillRect(0, 0, W, H);
      cctx.globalCompositeOperation = 'lighten';
      const d = 0.01;
      for (const q of blobs) {
        const o = toStage(q.x, q.z), px = toStage(q.x + d, q.z), pz = toStage(q.x, q.z + d);
        const jx = [(px.x - o.x) / d, (px.y - o.y) / d], jz = [(pz.x - o.x) / d, (pz.y - o.y) / d];
        const ax = [jx[0] * q.hx + jz[0] * q.hz, jx[1] * q.hx + jz[1] * q.hz];        // along the light, per world unit
        const bx = [jx[0] * -q.hz + jz[0] * q.hx, jx[1] * -q.hz + jz[1] * q.hx];      // across it
        const s = Math.min(3, q.soft / Math.max(1e-6, q.b)), R = 1 + s * 0.5, inner = Math.max(0, 1 - s * 0.5) / R;
        cctx.setTransform(ax[0] * q.a, ax[1] * q.a, bx[0] * q.b, bx[1] * q.b, o.x, o.y);
        const v = Math.round(255 * clamp(q.dens / (1 + s * 0.35), 0, 1));
        const g = cctx.createRadialGradient(0, 0, 0, 0, 0, R);
        g.addColorStop(0, 'rgb(' + v + ',' + v + ',' + v + ')');
        g.addColorStop(inner, 'rgb(' + v + ',' + v + ',' + v + ')');
        g.addColorStop(1, 'rgb(0,0,0)');
        cctx.fillStyle = g;
        cctx.beginPath(); cctx.arc(0, 0, R, 0, Math.PI * 2); cctx.fill();
      }
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      const src = cctx.getImageData(0, 0, W, H).data, dst = img.data;
      const strength = sun.strength * (opts.dark ? 0.8 : 1), style = opts.style, block = style === 'pixel' ? (opts.block || 2) : 1;
      for (let y = 0; y < H; y += block) for (let x = 0; x < W; x += block) {
        const sx = Math.min(W - 1, x + (block >> 1)), sy = Math.min(H - 1, y + (block >> 1));
        const a = Math.round(255 * shadeAlpha(src[(sy * W + sx) * 4] / 255, style, strength));
        for (let yy = y; yy < Math.min(H, y + block); yy++) for (let xx = x; xx < Math.min(W, x + block); xx++) {
          const i = (yy * W + xx) * 4;
          dst[i] = SHADOW_RGB[0]; dst[i + 1] = SHADOW_RGB[1]; dst[i + 2] = SHADOW_RGB[2]; dst[i + 3] = a;
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.drawImage(out, 0, 0);
    }
    return { draw, coverage: cov, layer: out };
  }

  // The sun or moon in the sky: left at dawn, high at noon, right at dusk. `horizon` is the stage row it sets behind.
  function drawSky(ctx, sun, W, horizon, opts) {
    opts = opts || {};
    const x = Math.round(26 + (W - 52) * sun.u), y = Math.round(horizon - 6 - Math.sin(Math.PI * sun.u) * (horizon - 30));
    const fade = clamp(Math.min(sun.u, 1 - sun.u) / 0.04, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.85 * fade;
    if (sun.body === 'sun') {
      const col = sun.warm > 0.3 ? '#ffb36b' : '#ffe27a';
      if (!opts.pixel) {
        const g = ctx.createRadialGradient(x, y, 2, x, y, 14);
        g.addColorStop(0, 'rgba(255,230,150,0.55)'); g.addColorStop(1, 'rgba(255,230,150,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#e8ecf8'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(x + 2, y - 1, 3.4, 0, Math.PI * 2); ctx.fill(); // a crescent
    }
    ctx.restore();
    return { x, y };
  }
  // The colour of the light over the whole picture: warm at dawn and dusk, blue at night, nothing at noon.
  function drawTint(ctx, sun, W, H) {
    if (sun.tint.every((c) => c >= 254)) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(' + sun.tint.join(',') + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  const api = { sunAt, timeFor, sceneSpheres, placeSpheres, groundPoint, blob, shadowBlobs, extent, shadeAlpha, createLayer, drawSky, drawTint,
    NAMED, MIN_ELEV, SUN_ELEV, MOON_ELEV, SUN_STRENGTH, MOON_STRENGTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureLight = api;
})(typeof window !== 'undefined' ? window : globalThis);
