/* Creatures prototype: the renderer. Signed distance fields, asked once per pixel (the video's "step 4: ask every
   pixel"): for each pixel of a small grid, a ray marches through the smooth union of the creature's pieces; if it hits,
   the pixel gets a colour, banded light and, on edges, ink (step 5). Misses stay see-through, except the ground shadow.
   Styles are pluggable: `gochi` is the video's finished look; `inside`, `flat` and `pieces` are the video's
   in-between views (silhouette, one colour, coloured by body position). No DOM: it returns an RGBA buffer. */
(function (root) {
  'use strict';
  const B = typeof module !== 'undefined' && module.exports ? require('./body.js') : root.CreatureBody;
  const { CONE, ELLIPSOID, TRI, MAT } = B;

  // ---------- colour helpers ----------
  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  // A colour ramp from one base colour: ink, shadow, mid shadow, base, light, highlight. Shadows lean cool, lights warm.
  function ramp(h, s, l) {
    const toward = (h0, target, amt) => { let d = ((target - h0 + 540) % 360) - 180; return h0 + d * amt; };
    return [
      hsl(toward(h, 250, 0.15), Math.min(1, s * 1.05 + 0.1), Math.min(0.15, l * 0.26)),
      hsl(toward(h, 250, 0.12), Math.min(1, s * 1.02), l * 0.62),
      hsl(toward(h, 250, 0.05), s, l * 0.81),
      hsl(h, s, l),
      hsl(toward(h, 55, 0.08), s * 0.95, l + (1 - l) * 0.22),
      hsl(toward(h, 55, 0.12), s * 0.7, l + (1 - l) * 0.6),
    ];
  }

  // ---------- noise for markings ----------
  function hash3(x, y, z) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v2 = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const L = (a, b, t) => a + (b - a) * t;
    const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
    return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v2), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v2), w);
  }

  // ---------- distance functions ----------
  function prep(p) {
    const q = { k: p.k, k2: p.k2, mat: p.mat, piece: p.piece, src: p,
      ax: p.a[0], ay: p.a[1], az: p.a[2], fx: p.ax[0], fy: p.ax[1], fz: p.ax[2], ux: p.u[0], uy: p.u[1], uz: p.u[2],
      sx: p.side[0], sy2: p.side[1], sz: p.side[2] };
    if (p.k === CONE) {
      q.len = p.len; q.r1 = p.r1; q.r2 = p.r2; q.sy = p.sy; q.scale = Math.min(1, p.sy);
      const b = (p.r1 - p.r2) / Math.max(1e-6, p.len);
      q.degenerate = Math.abs(b) >= 0.999;
      q.cb = b; q.ca = Math.sqrt(Math.max(0, 1 - b * b));
    } else if (p.k === ELLIPSOID) {
      q.rx = p.rx; q.ry = p.ry; q.rz = p.rz; q.cut = p.cut || null; q.shell = p.piece === 'egg' ? 0.012 : 0;
    } else {
      const a = p.a, b = p.b, c = p.c;
      const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], cb = [c[0] - b[0], c[1] - b[1], c[2] - b[2]], ac = [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
      const nor = B.v.cross(ba, ac);
      Object.assign(q, { bx: b[0], by: b[1], bz: b[2], cx: c[0], cy: c[1], cz: c[2], ba, cb, ac, nor,
        n1: B.v.cross(ba, nor), n2: B.v.cross(cb, nor), n3: B.v.cross(ac, nor), dba: B.v.dot(ba, ba), dcb: B.v.dot(cb, cb), dac: B.v.dot(ac, ac),
        dnor: B.v.dot(nor, nor) || 1e-9, th: p.r1 });
    }
    return q;
  }

  // Distance from (x,y,z) to one prepared primitive. Writes frame coordinates into `out` when given.
  function dist(q, x, y, z, out) {
    const px = x - q.ax, py = y - q.ay, pz = z - q.az;
    if (q.k === CONE) {
      const along = px * q.fx + py * q.fy + pz * q.fz;
      const up = (px * q.ux + py * q.uy + pz * q.uz) / q.sy;
      const sd = px * q.sx + py * q.sy2 + pz * q.sz;
      const rad = Math.sqrt(up * up + sd * sd);
      if (out) { out.along = along; out.up = up * q.sy; out.side = sd; }
      let d;
      if (q.degenerate) {
        d = Math.min(Math.hypot(rad, along) - q.r1, Math.hypot(rad, along - q.len) - q.r2);
      } else {
        const k = -q.cb * rad + q.ca * along;
        if (k < 0) d = Math.hypot(rad, along) - q.r1;
        else if (k > q.ca * q.len) d = Math.hypot(rad, along - q.len) - q.r2;
        else d = q.ca * rad + q.cb * along - q.r1;
      }
      return d * q.scale;
    }
    if (q.k === ELLIPSOID) {
      const lx = px * q.fx + py * q.fy + pz * q.fz, ly = px * q.ux + py * q.uy + pz * q.uz, lz = px * q.sx + py * q.sy2 + pz * q.sz;
      if (out) { out.along = lx; out.up = ly; out.side = lz; }
      const ax = lx / q.rx, ay = ly / q.ry, az = lz / q.rz;
      const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
      const k1 = Math.sqrt((ax / q.rx) ** 2 + (ay / q.ry) ** 2 + (az / q.rz) ** 2) || 1e-9;
      let d = (k0 * (k0 - 1)) / k1;
      if (q.shell) {
        if (out) out.inner = d < -q.shell * 0.3;
        d = Math.abs(d + q.shell) - q.shell;
      }
      if (q.cut) {
        const ang = Math.atan2(lz, ly);
        const zig = q.rx * 0.07 * (Math.abs(((ang / (Math.PI * 2)) * 14) % 2 - 1) * 2 - 1);
        const plane = q.cut.below ? lx - (q.cut.y + zig) : (q.cut.y + zig) - lx;
        d = Math.max(d, plane);
      }
      return d;
    }
    // thin triangle
    const pa = [px, py, pz];
    const pb = [x - q.bx, y - q.by, z - q.bz], pc = [x - q.cx, y - q.cy, z - q.cz];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const sgn = (t) => (t > 0 ? 1 : t < 0 ? -1 : 0);
    let d2;
    if (sgn(dot(q.n1, pa)) + sgn(dot(q.n2, pb)) + sgn(dot(q.n3, pc)) < 2) {
      const seg = (e, p, de) => { const t = Math.max(0, Math.min(1, dot(e, p) / de)); const a = e[0] * t - p[0], b = e[1] * t - p[1], c = e[2] * t - p[2]; return a * a + b * b + c * c; };
      d2 = Math.min(seg(q.ba, pa, q.dba), seg(q.cb, pb, q.dcb), seg(q.ac, pc, q.dac));
    } else { const t = dot(q.nor, pa); d2 = (t * t) / q.dnor; }
    if (out) { out.along = px * q.fx + py * q.fy + pz * q.fz; out.up = 0; out.side = 0; }
    return Math.sqrt(d2) - q.th;
  }

  // Polynomial smooth minimum: the "melt" that joins the pieces into one body.
  function smin(a, b, k) {
    if (k <= 0) return Math.min(a, b);
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  }

  // The whole field over a list of prepared primitives. Returns the distance; scene.best gets the nearest piece.
  function field(list, x, y, z, ctx) {
    let d = 1e9, best = -1, bestD = 1e9;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      const di = dist(q, x, y, z, null);
      if (di < bestD) { bestD = di; best = i; }
      d = i === 0 ? di : smin(d, di, q.k2);
    }
    if (ctx) ctx.best = best;
    return d;
  }

  // ---------- camera ----------
  function camera(c) {
    const yaw = c.yaw != null ? c.yaw : 1.0, pitch = c.pitch != null ? c.pitch : 0.45;
    const toCam = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const d = [-toCam[0], -toCam[1], -toCam[2]];
    const r = B.v.norm(B.v.cross(d, [0, 1, 0]));
    const u = B.v.cross(r, d);
    return { w: c.w, h: c.h, px: c.px, center: c.center || [0, 0.3, 0], d, r, u, toCam };
  }
  // World point -> pixel position and depth along the view.
  function project(cam, p) {
    const q = [p[0] - cam.center[0], p[1] - cam.center[1], p[2] - cam.center[2]];
    return { x: cam.w / 2 + B.v.dot(q, cam.r) / cam.px, y: cam.h / 2 - B.v.dot(q, cam.u) / cam.px, z: B.v.dot(q, cam.d) };
  }

  // ---------- styles ----------
  // A style turns a hit (material, position in the piece, normal, light) into a colour, and says what ink to draw.
  const styles = {};
  function registerStyle(name, s) { styles[name] = s; }

  // Body colours from the phenotype (or egg look).
  function palette(scene) {
    const ph = scene.ph;
    if (scene.kind === 'egg') {
      const e = scene.look;
      return { egg: ramp(e.hue, e.sat, e.light), mark: ramp(e.markHue, 0.5, e.markLight), inner: ramp(e.hue, 0.15, 0.9) };
    }
    const c = ph.colour, hue = c.hue + c.hueShift;
    const body = ramp(hue, c.sat, c.light);
    const belly = ramp(hue + 8, c.sat * 0.6, c.light + (1 - c.light) * (0.25 + 0.4 * c.belly));
    const bone = ramp(45, 0.25, 0.86);
    const accentSrc = c.accent < 0.5 ? bone : ramp(hue + 15, c.sat * 0.8, c.light * 0.75);
    const markL = ph.pattern.light >= 0 ? c.light + (1 - c.light) * (0.35 + 0.4 * ph.pattern.light) : c.light * (0.75 + 0.3 * ph.pattern.light);
    return {
      body, belly, accent: accentSrc,
      wing: ramp(hue + c.wing, c.sat * 0.9, c.light * 0.85 + 0.05),
      leaf: ramp(108 + (ph.decor.hue - 180) * 0.08, 0.6, 0.45),
      petal: ramp(ph.decor.hue, 0.65, 0.7),
      dark: ramp(hue, c.sat * 0.4, 0.2),
      tongue: ramp(350, 0.62, 0.66),
      tip: ramp(40, 0.25, 0.92),
      mark: ramp(hue + (ph.pattern.light >= 0 ? 0 : 10), c.sat * (ph.pattern.light >= 0 ? 0.45 : 1.05), markL),
    };
  }

  // Which ramp a body pixel uses: belly, tail tip, markings or plain body.
  function bodyRamp(scene, pal, h) {
    const ph = scene.ph;
    const q = h.q, pr = q.src;
    const s = scene.scale || 1;
    if (q.mat === MAT.ACCENT) return pal.accent;
    if (q.mat === MAT.WING) return pal.wing;
    if (q.mat === MAT.LEAF) return pal.leaf;
    if (q.mat === MAT.PETAL) return pal.petal;
    if (q.mat === MAT.DARK) return pal.dark;
    if (q.mat === MAT.TONGUE) return pal.tongue;
    const tAlong = pr.t0 + (pr.t1 - pr.t0) * Math.max(0, Math.min(1, h.fc.along / Math.max(1e-6, q.len || 1)));
    if (q.piece === 'tail' && pr.tip > 0.3 && tAlong > 1 - pr.tip * 0.5) return pal.tip;
    const main = q.piece === 'torso' || q.piece === 'neck' || q.piece === 'head' || q.piece === 'tail';
    if (main && ph.colour.belly > 0.15) {
      const rr = Math.max(1e-6, (q.r1 + (q.r2 - q.r1) * Math.max(0, Math.min(1, h.fc.along / (q.len || 1)))) * q.sy);
      if (h.fc.up / rr < -0.3 + (q.piece === 'head' ? 0.05 : 0)) return pal.belly;
    }
    const pk = ph.pattern.kind, amt = ph.pattern.amount;
    if (pk !== 'none' && amt > 0.02 && (main || q.piece === 'leg')) {
      const off = scene.patternOffset;
      const along = (h.fc.along + (pr.t0 || 0) * (pr.pieceLen || 0)) / s, up = h.fc.up / s, side = h.fc.side / s;
      const pieceOff = { torso: 0, neck: 17, head: 31, tail: 47, leg: 63 }[q.piece] || 0;
      const f = 5 + 9 * ph.pattern.scale;
      const X = along * f + off[0] + pieceOff, Y = up * f + off[1], Z = side * f + off[2];
      let on = false;
      if (pk === 'spots') on = vnoise(X, Y, Z) > 0.78 - amt * 0.3;
      else if (pk === 'stripes') on = h.fc.up > -0.2 * s * 0.1 && Math.sin(along * f * 1.6 + vnoise(X * 0.5, Y * 0.5, Z * 0.5) * 3) > 1 - amt * 0.9;
      else if (pk === 'patches') on = vnoise(X * 0.45, Y * 0.45, Z * 0.45) > 0.66 - amt * 0.22;
      else if (pk === 'speckles') on = vnoise(X * 2.2, Y * 2.2, Z * 2.2) > 0.86 - amt * 0.12;
      if (on) return pal.mark;
    }
    return pal.body;
  }

  // The ramp a hit uses: eggs have shell, markings and the inside; creatures their body ramps.
  function rampOf(scene, pal, h) {
    if (scene.kind === 'egg') return h.inner ? pal.inner : eggMark(scene, h) ? pal.mark : pal.egg;
    return bodyRamp(scene, pal, h);
  }
  const glossOf = (scene) => (scene.kind === 'egg' ? scene.look.gloss : scene.ph.gloss);
  // ro.shine (0..1, default 1) scales the highlights: 1 is the video's look, 0 no glint and no top light band.
  const shineOf = (ro) => (ro && ro.shine != null ? Math.max(0, Math.min(1, ro.shine)) : 1);
  function gochiBand(scene, h, ro, L) {
    const shine = shineOf(ro);
    let band = L < 0.18 ? 1 : L < 0.45 ? 2 : L < 0.8 + (1 - shine) * 0.4 ? 3 : 4;
    const gloss = glossOf(scene);
    if (gloss > 0.25 && shine > 0 && h.spec > (shine === 1 ? 0.985 - gloss * 0.04 : 1 - (0.015 + gloss * 0.04) * shine)) band = 5;
    return band;
  }
  // 4x4 ordered (Bayer) dither threshold for a pixel, 0..1.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // Finished looks (the app's style switcher), in order. Each is the same genome, body and light; only the drawing
  // changes. Fields: label, shade(scene, pal, hit, opts) -> { rgb, ink }, inkEdges, inkWidth (outline pixels),
  // decals (draw eyes, mouth, blush, cracks), pixel (render at 1/k size and blow up), post(res, scene, pal, opts).
  const looks = [];
  function registerLook(name, s) { registerStyle(name, Object.assign({ decals: true, inkEdges: true }, s)); looks.push(name); }

  registerLook('gochi', {
    label: 'Original',
    // Banded light: four tones from a cool shadow to a warm light, plus a glint where the surface is glossy.
    shade(scene, pal, h, ro) {
      const rp = rampOf(scene, pal, h);
      return { rgb: rp[gochiBand(scene, h, ro, h.light)], ink: rp[0] };
    },
  });
  registerLook('cel', {
    label: 'Cel',
    // Cartoon cel: two hard tones split at the terminator, a bold outline, one small hard highlight.
    shade(scene, pal, h, ro) {
      const rp = rampOf(scene, pal, h);
      let rgb = h.light < 0.42 ? rp[2] : rp[4];
      if (shineOf(ro) > 0.2 && h.spec > 1 - 0.008 * shineOf(ro) * (0.5 + glossOf(scene))) rgb = [255, 255, 250];
      return { rgb, ink: mix(rp[0], [20, 16, 24], 0.5) };
    },
    inkWidth: 2,
  });
  registerLook('pixel', {
    label: 'Pixel',
    // Pixel art: drawn at half size (a 75x60 sprite in the overlay), blown up with hard edges; four tones of the
    // creature's own ramp blended with an ordered dither; a 1px outline. opts.palette swaps in a fixed palette.
    pixel: 2,
    shade(scene, pal, h, ro) {
      const rp = rampOf(scene, pal, h);
      return { rgb: rp[gochiBand(scene, h, ro, h.light + (bayer(h.x, h.y) - 0.5) * 0.22)], ink: rp[0] };
    },
    post: (res, scene, pal, ro) => quantise(res, ro && ro.palette),
  });
  // Fixed palettes for the pixel looks ('own' keeps the creature's colours).
  const PALETTES = {
    gameboy: [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]],
    pico8: [[0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81], [171, 82, 54], [95, 87, 79], [194, 195, 199], [255, 241, 232],
      [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54], [41, 173, 255], [131, 118, 156], [255, 119, 168], [255, 204, 170]],
    earth: [[38, 28, 26], [92, 58, 42], [150, 92, 56], [196, 138, 78], [226, 196, 140], [118, 124, 70], [72, 90, 66], [240, 228, 200]],
  };
  function quantise(res, name) {
    const P = PALETTES[name];
    if (!P) return;
    const luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    // Game Boy: four greens by brightness, stretched over this sprite's own darkest to lightest pixel.
    const byLuma = name === 'gameboy';
    let lo = 255, hi = 0;
    if (byLuma) for (let i = 0; i < res.w * res.h; i++) if (res.mask[i] === 1) { const l = luma([res.rgba[i * 4], res.rgba[i * 4 + 1], res.rgba[i * 4 + 2]]); lo = Math.min(lo, l); hi = Math.max(hi, l); }
    for (let i = 0; i < res.w * res.h; i++) {
      if (res.mask[i] !== 1) continue;
      const c = [res.rgba[i * 4], res.rgba[i * 4 + 1], res.rgba[i * 4 + 2]];
      let best = P[0];
      if (byLuma) best = P[Math.max(0, Math.min(3, Math.floor(((luma(c) - lo) / Math.max(1, hi - lo)) * 3.999)))];
      else {
        let bd = Infinity;
        for (const q of P) { const d = 2 * (c[0] - q[0]) ** 2 + 4 * (c[1] - q[1]) ** 2 + 3 * (c[2] - q[2]) ** 2; if (d < bd) { bd = d; best = q; } }
      }
      res.rgba[i * 4] = best[0]; res.rgba[i * 4 + 1] = best[1]; res.rgba[i * 4 + 2] = best[2];
    }
  }
  registerStyle('inside', { shade: () => ({ rgb: [42, 36, 46], ink: [42, 36, 46] }), inkEdges: false });
  registerStyle('flat', { shade: (scene, pal) => ({ rgb: scene.kind === 'egg' ? pal.egg[3] : [128, 78, 168], ink: [128, 78, 168] }), inkEdges: false });
  registerStyle('pieces', {
    // The video's "smooth union" view: every pixel coloured by where along the body it is (tail -> head rainbow).
    shade(scene, pal, h) {
      const order = { tail: 0, torso: 1, neck: 2, head: 3 };
      const pr = h.q.src;
      const t = h.q.piece in order ? (order[h.q.piece] + pr.t0 + (pr.t1 - pr.t0) * Math.max(0, Math.min(1, h.fc.along / (h.q.len || 1)))) / 4 : 0.35;
      const base = hsl(200 + 300 * t, 0.75, 0.62);
      const lit = 0.75 + 0.35 * h.light;
      return { rgb: base.map((c) => Math.min(255, c * lit)), ink: base.map((c) => c * 0.4) };
    },
    inkEdges: false,
  });

  function eggMark(scene, h) {
    const e = scene.look;
    const lx = h.fc.along, ly = h.fc.up, lz = h.fc.side;
    const H = 0.34;
    const a = lx / H, ang = Math.atan2(lz, ly);
    const f = 4 + 8 * e.markScale;
    if (e.marks === 'speckles') return vnoise(lx * f * 9, ly * f * 9, lz * f * 9) > 0.86 - e.markAmount * 0.08;
    if (e.marks === 'spots') return vnoise(lx * f * 5 + 5, ly * f * 5, lz * f * 5) > 0.8 - e.markAmount * 0.18;
    if (e.marks === 'zigzag') { const z = 0.12 * (Math.abs(((ang / (Math.PI * 2)) * 10) % 2 - 1) * 2 - 1); return Math.abs(a - 0.1 - z) < 0.07 + 0.06 * e.markAmount; }
    if (e.marks === 'bands') return Math.sin(a * (5 + 6 * e.markScale)) > 1 - e.markAmount * 0.8;
    return false;
  }

  // ---------- the renderer ----------
  // scene: from CreatureBody.build/buildEgg (plus .ph for creatures). cam: { w, h, px, yaw, pitch, center }.
  // opts: { style, shine: 0..1, palette: 'own' | 'gameboy' | 'pico8' | 'earth', shadow: true }.
  // Returns { w, h, rgba, depth, mask, info, cam, stats }.
  function render(scene, camIn, opts) {
    opts = opts || {};
    const style = styles[opts.style || 'gochi'] || styles.gochi;
    if (style.pixel > 1 && !opts.lowRes) return renderPixel(scene, camIn, opts, style.pixel);
    const cam = camera(camIn);
    const W = cam.w, H = cam.h, N = W * H;
    const rgba = new Uint8ClampedArray(N * 4), depth = new Float32Array(N).fill(Infinity), mask = new Uint8Array(N);
    const ink = new Array(N), info = new Array(N);
    const list = scene.prims.map(prep);
    const pal = palette(scene);
    if (!scene.patternOffset) {
      const p = scene.ph ? scene.ph.pattern : { scale: 0, amount: 0 };
      scene.patternOffset = [p.scale * 97.3 + 3.1, p.amount * 41.7 + 7.7, (scene.ph ? scene.ph.colour.hue : 0) * 0.37 + 1.3];
    }

    // Which primitives can each pixel's ray touch? (bounding spheres projected onto the grid)
    const cand = new Array(N);
    const tRange = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { tRange[i * 2] = Infinity; tRange[i * 2 + 1] = -Infinity; }
    const D = 6; // rays start this far in front of the centre
    list.forEach((q, idx) => {
      const bs = q.src.bs, R = bs[3] + q.k2 * 0.6 + cam.px;
      const pr = project(cam, [bs[0], bs[1], bs[2]]);
      const rp = R / cam.px;
      const x0 = Math.max(0, Math.floor(pr.x - rp)), x1 = Math.min(W - 1, Math.ceil(pr.x + rp));
      const y0 = Math.max(0, Math.floor(pr.y - rp)), y1 = Math.min(H - 1, Math.ceil(pr.y + rp));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - pr.x, dy = y + 0.5 - pr.y;
        if (dx * dx + dy * dy > (rp + 0.75) * (rp + 0.75)) continue;
        const i = y * W + x;
        (cand[i] || (cand[i] = [])).push(q);
        const tc = D + pr.z;
        if (tc - R < tRange[i * 2]) tRange[i * 2] = tc - R;
        if (tc + R > tRange[i * 2 + 1]) tRange[i * 2 + 1] = tc + R;
      }
    });

    // Light from the upper left, a little toward the viewer.
    const Lw = B.v.norm(B.v.add(B.v.add(B.v.mul(cam.r, -0.65), B.v.mul(cam.u, 1)), B.v.mul(cam.toCam, 0.55)));
    const Hv = B.v.norm(B.v.add(Lw, cam.toCam));
    const eps = cam.px * 0.5;
    let steps = 0, hits = 0;
    const fc = { along: 0, up: 0, side: 0, inner: false };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, lst = cand[i];
      if (!lst) continue;
      // Sort near-to-far is not needed: the union is order-free except for melt amounts; keep the build order.
      const ox = cam.center[0] + cam.r[0] * (x + 0.5 - W / 2) * cam.px + cam.u[0] * (H / 2 - y - 0.5) * cam.px - cam.d[0] * D;
      const oy = cam.center[1] + cam.r[1] * (x + 0.5 - W / 2) * cam.px + cam.u[1] * (H / 2 - y - 0.5) * cam.px - cam.d[1] * D;
      const oz = cam.center[2] + cam.r[2] * (x + 0.5 - W / 2) * cam.px + cam.u[2] * (H / 2 - y - 0.5) * cam.px - cam.d[2] * D;
      let t = Math.max(0, tRange[i * 2]), tmax = tRange[i * 2 + 1];
      let hit = false, n = 0;
      const sorted = lst.length > 1 ? lst.slice().sort((a, b) => list.indexOf(a) - list.indexOf(b)) : lst;
      while (t <= tmax && n < 96) {
        const px = ox + cam.d[0] * t, py = oy + cam.d[1] * t, pz = oz + cam.d[2] * t;
        const d = field(sorted, px, py, pz, null);
        n++;
        if (d < eps * 0.35) { hit = true; break; }
        t += Math.max(d * 0.85, eps * 0.2);
      }
      steps += n;
      if (!hit) continue;
      hits++;
      const px = ox + cam.d[0] * t, py = oy + cam.d[1] * t, pz = oz + cam.d[2] * t;
      // Normal from four samples (tetrahedron).
      const e = eps * 0.6;
      const f1 = field(sorted, px + e, py - e, pz - e), f2 = field(sorted, px - e, py - e, pz + e), f3 = field(sorted, px - e, py + e, pz - e), f4 = field(sorted, px + e, py + e, pz + e);
      const nrm = B.v.norm([f1 - f2 - f3 + f4, -f1 - f2 + f3 + f4, -f1 + f2 - f3 + f4]);
      const ctx = {};
      field(sorted, px, py, pz, ctx);
      const q = sorted[ctx.best];
      dist(q, px, py, pz, fc);
      const lam = B.v.dot(nrm, Lw);
      const h = { q, fc: { along: fc.along, up: fc.up, side: fc.side }, inner: fc.inner, n: nrm, p: [px, py, pz],
        light: lam * 0.62 + 0.38 * Math.max(0, nrm[1]) + 0.12, spec: B.v.dot(nrm, Hv), x, y };
      const c = style.shade(scene, pal, h, opts);
      rgba[i * 4] = c.rgb[0]; rgba[i * 4 + 1] = c.rgb[1]; rgba[i * 4 + 2] = c.rgb[2]; rgba[i * 4 + 3] = 255;
      depth[i] = t - D; mask[i] = 1; ink[i] = c.ink; info[i] = h;
    }

    // Ink: outline pixels on the silhouette, and where a piece passes in front of another one far behind it.
    // inkWidth 2 thickens the silhouette line (the inner lines stay one pixel).
    if (style.inkEdges) {
      const thr = Math.max(cam.px * 5, 0.07 * (scene.scale || 1));
      const out = new Uint8Array(N);
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const far = style.inkWidth > 1 ? [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, 1], [1, -1], [-1, -1]] : [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!mask[i]) continue;
        let edge = false;
        for (const [dx, dy] of near) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) { edge = true; break; }
          const j = yy * W + xx;
          if (!mask[j] || depth[j] - depth[i] > thr) { edge = true; break; }
        }
        if (!edge) for (const [dx, dy] of far) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && !mask[yy * W + xx]) { edge = true; break; }
        }
        if (edge) out[i] = 1;
      }
      for (let i = 0; i < N; i++) if (out[i]) { const k = ink[i]; rgba[i * 4] = k[0]; rgba[i * 4 + 1] = k[1]; rgba[i * 4 + 2] = k[2]; }
    }

    // Ground shadow: a flat ellipse under the body, see-through.
    if (opts.shadow !== false && scene.shadow) {
      const sh = scene.shadow;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (mask[i]) continue;
        const ox = cam.center[0] + cam.r[0] * (x + 0.5 - W / 2) * cam.px + cam.u[0] * (H / 2 - y - 0.5) * cam.px;
        const oy = cam.center[1] + cam.r[1] * (x + 0.5 - W / 2) * cam.px + cam.u[1] * (H / 2 - y - 0.5) * cam.px;
        const oz = cam.center[2] + cam.r[2] * (x + 0.5 - W / 2) * cam.px + cam.u[2] * (H / 2 - y - 0.5) * cam.px;
        if (cam.d[1] >= 0) continue;
        const tt = (sh.y - oy) / cam.d[1];
        const gx = ox + cam.d[0] * tt, gz = oz + cam.d[2] * tt;
        const ex = (gx - sh.cx) / sh.rx, ez = (gz - sh.cz) / sh.rz;
        if (ex * ex + ez * ez < 1) { rgba[i * 4 + 3] = Math.round(255 * (sh.alpha || 0.2)); mask[i] = 2; }
      }
    }

    const res = { w: W, h: H, rgba, depth, mask, info, cam, stats: { steps, hits } };
    if (style.decals) drawDecals(scene, list, res);
    if (style.post) style.post(res, scene, pal, opts);
    return res;
  }

  // Pixel looks: render at 1/k size with the same centre and k times the world size per pixel, then blow it up with
  // hard edges, so the sprite keeps its size and place but is made of k x k blocks (outline and eyes included).
  function renderPixel(scene, camIn, opts, k) {
    const full = camera(camIn), W = full.w, H = full.h;
    const lw = Math.ceil(W / k), lh = Math.ceil(H / k);
    const low = render(scene, Object.assign({}, camIn, { w: lw, h: lh, px: full.px * k }), Object.assign({}, opts, { lowRes: true }));
    const N = W * H, rgba = new Uint8ClampedArray(N * 4), depth = new Float32Array(N).fill(Infinity), mask = new Uint8Array(N), info = new Array(N);
    for (let y = 0; y < H; y++) {
      const jy = Math.floor((y + 0.5 - H / 2) / k + lh / 2);
      if (jy < 0 || jy >= lh) continue;
      for (let x = 0; x < W; x++) {
        const jx = Math.floor((x + 0.5 - W / 2) / k + lw / 2);
        if (jx < 0 || jx >= lw) continue;
        const i = y * W + x, j = jy * lw + jx;
        rgba[i * 4] = low.rgba[j * 4]; rgba[i * 4 + 1] = low.rgba[j * 4 + 1]; rgba[i * 4 + 2] = low.rgba[j * 4 + 2]; rgba[i * 4 + 3] = low.rgba[j * 4 + 3];
        depth[i] = low.depth[j]; mask[i] = low.mask[j]; info[i] = low.info[j];
      }
    }
    return { w: W, h: H, rgba, depth, mask, info, cam: full, stats: low.stats, low };
  }

  // ---------- face marks ----------
  function put(res, x, y, rgb, a) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= res.w || y >= res.h) return;
    const i = y * res.w + x;
    if (res.mask[i] !== 1) return; // marks only land on the body
    const k = i * 4, al = a == null ? 1 : a;
    res.rgba[k] = res.rgba[k] * (1 - al) + rgb[0] * al; res.rgba[k + 1] = res.rgba[k + 1] * (1 - al) + rgb[1] * al; res.rgba[k + 2] = res.rgba[k + 2] * (1 - al) + rgb[2] * al;
  }
  // From an anchor inside the head, walk out along dir to the surface.
  function snap(list, from, dir, maxT) {
    let t = 0, prev = field(list, from[0], from[1], from[2]);
    if (prev > 0) return { p: from, ok: true };
    const step = maxT / 48;
    for (let k = 0; k < 48; k++) {
      t += step;
      const p = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
      const d = field(list, p[0], p[1], p[2]);
      if (d >= 0) {
        let lo = t - step, hi = t;
        for (let j = 0; j < 10; j++) { const m = (lo + hi) / 2; const q = [from[0] + dir[0] * m, from[1] + dir[1] * m, from[2] + dir[2] * m]; if (field(list, q[0], q[1], q[2]) >= 0) hi = m; else lo = m; }
        return { p: [from[0] + dir[0] * hi, from[1] + dir[1] * hi, from[2] + dir[2] * hi], ok: true };
      }
    }
    return { ok: false };
  }
  // From a point outside, walk in along dir until the surface (for hollow things like the egg shell).
  function snapIn(list, from, dir, maxT) {
    const step = maxT / 64;
    for (let t = 0; t <= maxT; t += step) {
      const p = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
      if (field(list, p[0], p[1], p[2]) < 0) return { p, ok: true };
    }
    return { ok: false };
  }
  function normalAt(list, p, e) {
    const f = (x, y, z) => field(list, x, y, z);
    return B.v.norm([f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]), f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]), f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e)]);
  }
  function drawDecals(scene, list, res) {
    if (!scene.decals || !scene.decals.length) return;
    const cam = res.cam;
    const pal = palette(scene);
    // Snap an anchor to the surface and check it faces the camera and isn't hidden behind another piece.
    const place = (from, dir) => {
      const sn = snap(list, from, dir, 1.5);
      if (!sn.ok) return null;
      const facing = B.v.dot(normalAt(list, sn.p, cam.px * 0.5), cam.toCam);
      const pr = project(cam, sn.p);
      const i = Math.round(pr.y) * res.w + Math.round(pr.x);
      const vis = facing > 0.05 && pr.x >= 0 && pr.y >= 0 && pr.x < res.w && pr.y < res.h && res.mask[i] === 1 && pr.z <= res.depth[i] + cam.px * 3;
      return { sx: pr.x, sy: pr.y, facing, vis, p: sn.p };
    };
    const placed = [];
    for (const dc of scene.decals) {
      if (dc.kind === 'crack') { drawCrack(scene, list, res, dc); continue; }
      if (dc.pts) {
        const pts = dc.pts.map((a) => place(a.from, a.dir));
        const mid = pts[1] || pts.find(Boolean);
        if (!mid) continue;
        placed.push(Object.assign({}, dc, mid, { pts, vis: pts.some((q) => q && q.vis) }));
        continue;
      }
      const q = place(dc.from, dc.dir);
      if (q) placed.push(Object.assign({}, dc, q));
    }
    res.decals = placed;
    const eyes = placed.filter((d) => d.kind === 'eye');
    const ink = pal.body ? pal.body[0] : [30, 20, 30];
    // blush first, then eyes, then the mouth
    for (const d of placed) if (d.kind === 'blush' && d.vis) {
      const rp = Math.max(1, d.r / cam.px);
      const rx = rp * 1.1 * Math.max(0.45, d.facing), ry = Math.max(0.6, rp * 0.45);
      for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) for (let x = -Math.ceil(rx); x <= Math.ceil(rx); x++)
        if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) put(res, d.sx + x, d.sy + y, [242, 128, 150], 0.55 * Math.min(1, d.amount * 1.2));
    }
    for (const d of eyes) if (d.vis) {
      const other = eyes.find((e) => e !== d);
      const inner = other ? Math.sign(other.sx - d.sx) || 1 : 1;
      drawEye(res, d, cam, inner, ink);
    }
    for (const d of placed) if (d.kind === 'mouth' && d.vis) drawMouth(res, d, ink);
  }

  function line(res, x0, y0, x1, y1, c) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
    for (let k = 0; k <= n; k++) put(res, x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, c);
  }

  function drawEye(res, d, cam, inner, ink) {
    const rp = Math.max(1.4, d.r / cam.px);
    const sq = Math.max(0.42, Math.pow(Math.max(0, d.facing), 0.6));
    const rx = Math.max(0.6, rp * sq), ry = Math.max(0.8, rp * (1.05 + 0.15 * d.round - 0.35 * d.slant));
    const dark = [26, 18, 30], white = [250, 246, 238];
    const cx = d.sx, cy = d.sy;
    const ex = d.expression;
    if (d.blink > 0.5 || ex === 'sleepy') {
      line(res, cx - rx, cy + (ex === 'sleepy' ? 0 : 0), cx + rx, cy + (ex === 'sleepy' ? 0.6 : 0), dark);
      return;
    }
    if (ex === 'happy') {
      line(res, cx - rx, cy + ry * 0.3, cx, cy - ry * 0.5, dark); line(res, cx, cy - ry * 0.5, cx + rx, cy + ry * 0.3, dark);
      return;
    }
    const surprised = ex === 'surprised';
    const angry = ex === 'angry' || d.slant > 0.55;
    const R = surprised ? 1.15 : 1;
    for (let y = -Math.ceil(ry * R); y <= Math.ceil(ry * R); y++) for (let x = -Math.ceil(rx * R); x <= Math.ceil(rx * R); x++) {
      const e = (x / (rx * R)) ** 2 + (y / (ry * R)) ** 2;
      if (e > 1.05) continue;
      // A slanted brow cuts the top of the eye on the inner side (angry / scary).
      if (angry && y < -ry * 0.2 + (x * inner) * 0.55 * (0.6 + d.slant)) continue;
      let c = dark;
      if (surprised) c = e < 0.3 ? dark : white;
      else if (d.glow > 0.35 && e < 0.6 && rp >= 1.5) c = [235, 70 + 60 * (1 - d.glow), 60];
      put(res, cx + x, cy + y, c);
    }
    // Highlights: big round cute eyes get two glints.
    if (!surprised && rp >= 1.2 && !(d.glow > 0.35)) {
      put(res, cx - Math.max(0, rx * 0.35) * inner * -1 - 0.2, cy - ry * 0.4, white);
      if (d.round > 0.4 && rp >= 2.4) { put(res, cx - rx * 0.35 * -inner + 1, cy - ry * 0.4, white); put(res, cx + rx * 0.3 * -inner, cy + ry * 0.45, white, 0.8); }
    }
    if (angry) line(res, cx - rx * inner * 1.1, cy - ry * 1.0 - 0.5 - 0.5 * inner * 0, cx + rx * inner * 0.9, cy - ry * 0.1 - 1, ink);
  }

  // The mouth: a line from the visible jaw corner(s) through the chin. A smile lifts the corners, anger drops them.
  function drawMouth(res, d, ink) {
    const ex = d.expression;
    const chin = d.pts[1];
    if (ex === 'surprised') {
      if (chin && chin.vis) for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(res, chin.sx + x, chin.sy + y, [40, 20, 30]);
      return;
    }
    const smile = ex === 'happy' ? 1 : ex === 'angry' ? -0.8 : ex === 'sleepy' ? 0 : d.smile;
    const vis = d.pts.map((q, i) => (q && q.vis ? { x: q.sx, y: q.sy - (i === 1 ? 0 : smile * 1.4), mid: i === 1 } : null)).filter(Boolean);
    if (vis.length === 1) { line(res, vis[0].x - 1, vis[0].y, vis[0].x + 1, vis[0].y, ink); return; }
    // An open mouth (biting, chewing) parts below the line: a dark gap, deepest in the middle, pink at the bottom
    // for a tongue. The 3D jaw, beak, mandibles or tongue open with it.
    if (d.open > 0.15) {
      const n = 24, span = vis.length - 1;
      for (let k = 0; k <= n; k++) {
        const t = (k / n) * span, i = Math.min(span - 1, Math.floor(t)), u = t - i;
        const x = vis[i].x + (vis[i + 1].x - vis[i].x) * u, y = vis[i].y + (vis[i + 1].y - vis[i].y) * u;
        const gap = Math.round(d.open * 3.2 * Math.sin(Math.PI * k / n));
        for (let g = 1; g <= gap; g++) put(res, x, y + g, d.mouth === 'tongue' && g === gap && gap > 1 ? [226, 110, 132] : [58, 22, 34]);
      }
    }
    for (let i = 0; i + 1 < vis.length; i++) line(res, vis[i].x, vis[i].y, vis[i + 1].x, vis[i + 1].y, ink);
    if (d.fangs > 0.35) {
      const len = d.fangs > 0.75 ? 2 : 1;
      for (let i = 0; i + 1 < vis.length; i++) {
        const a = vis[i], b = vis[i + 1], f = a.mid ? 0.3 : 0.7;
        const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
        for (let k = 1; k <= len; k++) put(res, x, y + k, [246, 242, 226]);
      }
    }
  }

  function drawCrack(scene, list, res, dc) {
    const cam = res.cam;
    const n = 80, H = dc.H;
    const span = Math.PI * 2 * Math.min(1, dc.amount);
    const start = Math.atan2(cam.toCam[2], cam.toCam[0]) - span / 2;
    let last = null;
    for (let k = 0; k <= n; k++) {
      const a = start + span * (k / n);
      const zig = H * 0.07 * (Math.abs(((k / n) * span / (Math.PI * 2) * 14) % 2 - 1) * 2 - 1);
      const y = dc.center[1] + 0.25 * H + zig;
      const dir = [Math.cos(a), 0, Math.sin(a)];
      const sn = snapIn(list, [dir[0] * 0.6, y, dir[2] * 0.6], [-dir[0], 0, -dir[2]], 0.6);
      if (!sn.ok) continue;
      const pr = project(cam, sn.p);
      const i = Math.round(pr.y) * res.w + Math.round(pr.x);
      if (pr.x < 0 || pr.y < 0 || pr.x >= res.w || pr.y >= res.h || res.mask[i] !== 1 || pr.z > res.depth[i] + cam.px * 2) { last = null; continue; }
      if (last) {
        const m = Math.max(1, Math.ceil(Math.hypot(pr.x - last.x, pr.y - last.y) * 1.5));
        for (let j = 0; j <= m; j++) put(res, last.x + (pr.x - last.x) * j / m, last.y + (pr.y - last.y) * j / m, [60, 44, 40]);
      }
      last = pr;
    }
  }

  // Shadow and framing helpers for a built scene.
  function withShadow(scene) {
    if (scene.kind === 'egg') { scene.shadow = { cx: 0, cz: 0, rx: 0.3, rz: 0.24, y: 0, alpha: 0.2 }; return scene; }
    const L = scene.layout;
    let xmin = Infinity, xmax = -Infinity, zmax = 0;
    for (const p of scene.prims) if (p.piece === 'torso' || p.piece === 'foot' || p.piece === 'head') {
      xmin = Math.min(xmin, p.bs[0] - p.bs[3] * 0.7); xmax = Math.max(xmax, p.bs[0] + p.bs[3] * 0.7); zmax = Math.max(zmax, Math.abs(p.bs[2]) + p.bs[3] * 0.6);
    }
    const lift = scene.lift || 0;
    scene.shadow = { cx: (xmin + xmax) / 2, cz: 0, rx: Math.max(0.1, (xmax - xmin) / 2 * 0.8) * (1 - Math.min(0.5, lift)), rz: Math.max(0.08, zmax * 1.05, (xmax - xmin) * 0.3) * (1 - Math.min(0.5, lift)), y: 0, alpha: 0.22 - Math.min(0.12, lift * 0.3) };
    return scene;
  }

  // A creature scene ready to render: body + phenotype + shadow.
  function creatureScene(ph, pose) {
    const scene = B.build(ph, pose || {});
    scene.ph = ph;
    scene.lift = (pose && pose.lift) || 0;
    // Hopping or flying lifts the whole body (feet too) off the ground; the shadow stays on the ground.
    if (scene.lift) {
      const up = (p) => [p[0], p[1] + scene.lift, p[2]];
      for (const p of scene.prims) { p.a = up(p.a); if (p.b) p.b = up(p.b); if (p.c) p.c = up(p.c); p.bs = [p.bs[0], p.bs[1] + scene.lift, p.bs[2], p.bs[3]]; }
      for (const d of scene.decals) { d.from = up(d.from); if (d.pts) d.pts = d.pts.map((q) => ({ from: up(q.from), dir: q.dir })); }
    }
    return withShadow(scene);
  }
  function eggScene(look, pose) { return withShadow(B.buildEgg(look, pose || {})); }

  // A camera that frames a scene in a w x h grid. Fixed `px` (world units per pixel) keeps sizes honest across levels,
  // so a baby looks small next to its adult self; `fit: true` instead zooms the scene to fill the grid.
  function frameCamera(scene, w, h, o) {
    o = o || {};
    const base = { w, h, px: o.px || 0.0125, yaw: o.yaw != null ? o.yaw : 1.0, pitch: o.pitch != null ? o.pitch : 0.45 };
    const cam = camera(Object.assign({}, base, { center: [0, 0, 0] }));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const pts = scene.prims.map((p) => p.bs).concat(scene.shadow ? [[scene.shadow.cx - scene.shadow.rx, 0, 0, 0], [scene.shadow.cx + scene.shadow.rx, 0, 0, 0]] : []);
    for (const b of pts) {
      const rx = B.v.dot(b, cam.r), uy = B.v.dot(b, cam.u), R = b[3];
      x0 = Math.min(x0, rx - R); x1 = Math.max(x1, rx + R); y0 = Math.min(y0, uy - R); y1 = Math.max(y1, uy + R);
    }
    let cu;
    if (o.fit) {
      base.px = Math.max((x1 - x0) / (w * 0.88), (y1 - y0) / (h * 0.88));
      cu = (y0 + y1) / 2;
    } else cu = ((o.groundRow != null ? o.groundRow : h * 0.8) - h / 2) * base.px; // the ground origin sits on groundRow
    base.center = B.v.add(B.v.mul(cam.r, (x0 + x1) / 2), B.v.mul(cam.u, cu));
    return base;
  }

  // Paint a render result onto a 2D canvas context at (x, y) with an integer pixel size.
  function blit(ctx2d, res, x, y, size) {
    const img = ctx2d.createImageData(res.w, res.h);
    img.data.set(res.rgba);
    if (size === 1) { ctx2d.putImageData(img, x, y); return; }
    const off = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(res.w, res.h) : Object.assign(document.createElement('canvas'), { width: res.w, height: res.h });
    off.getContext('2d').putImageData(img, 0, 0);
    ctx2d.imageSmoothingEnabled = false;
    ctx2d.drawImage(off, x, y, res.w * size, res.h * size);
  }

  const api = { render, camera, project, styles, looks, registerStyle, registerLook, PALETTES, palette, ramp, hsl, vnoise, smin, field, prep, dist, withShadow, blit, creatureScene, eggScene, frameCamera };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureRender = api;
})(typeof window !== 'undefined' ? window : globalThis);
