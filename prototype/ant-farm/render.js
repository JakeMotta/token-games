// Ant farm prototype: drawing. The soil is one pixel per cell, scaled up crisp. Ants are not drawn into the soil
// grid: at one pixel per cell an ant is three dots. They are side-view sprites drawn on top in micro pixels
// (four per cell when there is room, two when the view is small), so each one keeps a head, a thorax, a petiole
// and a gaster, six walking legs, elbowed antennae and its load in its jaws.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AntRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Body shapes facing right, one character per micro pixel. The bottom row of each shape is the row above the
  // ground line; `ax` is the column over the ant's cell. g gaster, s gaster sheen, b gaster band, p petiole,
  // t thorax, n neck, h head, e eye, m mandible, w wing scar.
  const SHAPES = {
    worker: { ax: 7, legTop: 3, ground: 5, hips: [6, 7, 8], mouth: [13, 2], rows: [
      '.ggg......hh..',
      'gsggg..tt.heh.',
      'gggggptttnhhhm',
      '.ggg..........',
    ] },
    major: { ax: 7, legTop: 4, ground: 6, hips: [6, 7, 8], mouth: [14, 3], rows: [
      '..........hhh.',
      '.ggg.....hhhh.',
      'gsggg..tthhehm',
      'gggggptttnhhhmm',
      '.ggg..........',
    ] },
    queen: { ax: 10, legTop: 4, ground: 7, hips: [10, 12, 13], mouth: [18, 3], rows: [
      '..gggg.............',
      '.gsgbggb...ww...hh.',
      'gggbggbg..tttt.hheh',
      'gggbggbgptttttnhhhm',
      '.ggbggbg...........',
      '..gggg.............',
    ] },
    // two micro pixels per cell: the smallest shapes that still show three segments, a waist and antennae
    tiny: { ax: 3, ground: 2, hips: [3, 4, 4], mouth: [6, 1], tiny: true, rows: [
      '.....h.',
      'ggptthm',
    ] },
    tinyQueen: { ax: 5, ground: 3, hips: [5, 6, 6], mouth: [9, 1], tiny: true, rows: [
      '.ggg...hh.',
      'ggggptthhm',
      '.ggg......',
    ] },
  };

  // Colour sets. A and B are real-ant colourings; C is the far-out one.
  const LOOKS = {
    rust: { name: 'Rust', g: '#7a3022', s: '#e08a5c', b: '#9a4430', p: '#4a1a10', t: '#c4603a', n: '#6a2818', h: '#a8462a',
      e: '#140806', m: '#f4c08a', w: '#e9dcc4', leg: '#d27a50', far: '#5a2416', ant: '#d88a62', line: 'rgba(12,6,4,0.75)',
      queen: { g: '#6a3418', s: '#e5a45c', b: '#d08a40', t: '#d39242', h: '#9c5428', n: '#7a4020' } },
    black: { name: 'Black', g: '#2c2c33', s: '#b4bbce', b: '#3c3c45', p: '#16161a', t: '#5c5e6a', n: '#2a2a31', h: '#464652',
      e: '#0a0a0c', m: '#e0c49a', w: '#dcdde6', leg: '#8a8c9a', far: '#26262c', ant: '#9a9cab', line: 'rgba(0,0,0,0.7)',
      queen: { g: '#2c2a30', s: '#c9ccd8', b: '#5e5a66', t: '#7c6a56', h: '#4a4048', n: '#3a3238' } },
    glow: { name: 'Glow', g: '#127a78', s: '#d2fff8', b: '#1fa39d', p: '#0b4c4a', t: '#6ff0de', n: '#2fb7aa', h: '#3fd6c6',
      e: '#06201f', m: '#fff1a0', w: '#e8fffb', leg: '#38c4b6', far: '#155f5a', ant: '#8afff0', line: 'rgba(0,20,20,0.7)',
      queen: { g: '#7a5a12', s: '#fff4c2', b: '#e8b83a', t: '#ffd36a', h: '#d9a02a', n: '#a8781c' } },
  };
  const BODY = 'gsbptnhe';

  // Leg poses for the tripod gait, 4 frames. Group A (near front, far middle, near hind) swings while B stands,
  // then they trade. Each value is the foot's forward offset; `up` lifts the foot off the ground mid-swing.
  const GAIT = [
    { A: 1, B: -1 }, { A: 0, B: 0, upB: 1 }, { A: -1, B: 1 }, { A: 0, B: 0, upA: 1 },
  ];

  function line(x0, y0, x1, y1, out, c) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      out.push([x0, y0, c]);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  // Build one sprite as a list of [u, v, colourKey]: u forward from the ant's cell, v up from the ground line.
  // kind: worker | major | queen; tiny: two micro pixels per cell; frame: gait 0..3; twitch: antennae pose;
  // jaws: open mandibles (biting); load: null | 'grain' | 'food' | 'brood'.
  function sprite(kind, o) {
    o = o || {};
    const tiny = !!o.tiny;
    const S = SHAPES[tiny ? (kind === 'queen' ? 'tinyQueen' : 'tiny') : kind] || SHAPES.worker;
    const out = [], rows = S.rows;
    const at = (col, row) => [col - S.ax, S.ground - row]; // v = 0 is the row the feet stand in
    // far legs first, so the body covers their roots
    const g = GAIT[(o.frame || 0) & 3];
    const legs = (near) => {
      const keys = near ? ['A', 'B', 'A'] : ['B', 'A', 'B'];
      S.hips.forEach((hx, i) => {
        const grp = keys[i], shift = g[grp] + (near ? 0 : -1), up = g['up' + grp] || 0;
        const k = kind === 'queen' ? 2 : 1;
        const [u0, v0] = at(hx, S.legTop);
        if (tiny) { out.push([hx - S.ax + [-1, 0, 1][i] + shift, up, near ? 'leg' : 'far']); return; }
        // femur out level under the body, tibia down and out to the foot: the bent insect leg
        const knee = [u0 + [-1, 0, 1][i] * k, v0], u1 = knee[0] + [-2, -1, 2][i] + shift;
        line(u0, v0, knee[0], knee[1], out, near ? 'leg' : 'far');
        line(knee[0], knee[1], u1, up, out, near ? 'leg' : 'far');
      });
    };
    legs(false);
    rows.forEach((r, row) => {
      for (let col = 0; col < r.length; col++) {
        const ch = r[col];
        if (ch === '.') continue;
        const [u, v] = at(col, row);
        out.push([u, v, ch]);
      }
    });
    legs(true);
    // antennae: a scape up and forward from the head, an elbow, then the club reaching forward
    const headRow = rows.findIndex((r) => r.includes('h'));
    const [hu, hv] = at(rows[headRow].lastIndexOf('h'), headRow);
    if (tiny) out.push([hu + 1, hv + 1, 'ant']);
    else {
      const tw = o.twitch ? 1 : 0;
      out.push([hu, hv + 1, 'ant'], [hu + 1, hv + 2, 'ant'], [hu + 2, hv + 2 - tw, 'ant'], [hu + 3, hv + 1 - tw, 'ant']);
      if (kind === 'queen') out.push([hu + 4, hv - tw, 'ant']);
    }
    // jaws open while biting a grain loose
    const [mu, mv] = at(S.mouth[0], S.mouth[1]);
    if (o.jaws) out.push([mu + 1, mv + 1, 'm']);
    // the load rides in the jaws, held up in front of the head
    if (o.load) {
      const key = o.load === 'brood' ? 'brood' : 'load';
      const w = tiny ? 2 : o.load === 'brood' ? 4 : 3, h = tiny ? 2 : o.load === 'brood' ? 2 : 3;
      const u0 = mu + 1, v0 = mv;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push([u0 + x, v0 + y, key]);
    }
    return out;
  }

  // Micro pixels per cell and on-screen size of one micro pixel, from device pixels per cell. Below 3.5 device
  // pixels a cell the tiny shape is used; never smaller than one device pixel, so ants stay readable when the
  // farm is zoomed far out (they are then drawn larger than life).
  function lod(devPerCell) {
    if (devPerCell >= 3.5) return { tiny: false, per: 4, m: Math.max(1, Math.round(devPerCell / 4)) };
    return { tiny: true, per: 2, m: Math.max(1, Math.round(devPerCell / 2)) };
  }

  const css = (c) => 'rgb(' + (c & 255) + ',' + ((c >>> 8) & 255) + ',' + ((c >>> 16) & 255) + ')';
  const BROOD = ['#eee8d6', '#e2d4b6', '#c9b38c'];

  // Which way the ant faces and which side its feet are on, from its last step and the soil around it.
  const faces = new WeakMap();
  function pose(sim, a) {
    const W = sim.W, t = sim.type, k = a.y * W + a.x;
    const solid = (n) => t[n] !== 0;
    let hx = a.hx || 0, hy = a.hy || 0;
    const face = faces.get(a) || 1;
    if (hx === 0 && hy === 0) hx = face;
    if (hx !== 0) faces.set(a, hx);
    if (hy !== 0 && hx === 0) {
      const left = solid(k - 1), right = solid(k + 1);
      if (left || right) return { mode: 'wall', dir: hy, side: left ? -1 : 1 };
    }
    if (hy === 0 && !solid(k + W) && solid(k - W)) return { mode: 'ceiling', f: hx || face };
    return { mode: 'floor', f: hx || face, pitch: hx ? hy : 0 };
  }

  const cache = new Map();
  function cached(kind, o) {
    const key = kind + (o.tiny ? 't' : '') + (o.frame & 3) + (o.twitch ? 'w' : '') + (o.jaws ? 'j' : '') + (o.load || '');
    let s = cache.get(key);
    if (!s) { s = sprite(kind, o); cache.set(key, s); }
    return s;
  }

  // What an ant looks like this frame. Majors (every sixth ant) have the big head and jaws of the diggers.
  function look(sim, a) {
    const kind = a.role === 'queen' ? 'queen' : a.id % 6 === 0 ? 'major' : 'worker';
    const biting = !a.carry && a.busy > 0 && a.job && a.job.type === 'dig';
    return {
      kind, frame: a.walk & 3, twitch: ((sim.tick >> 3) + a.id) % 7 === 0,
      jaws: biting && (sim.tick & 2) === 0, load: a.carry === 'grain' || a.carry === 'food' ? 'load' : a.carry === 'brood' ? 'brood' : null,
      loadCol: a.carry === 'brood' ? BROOD[Math.min(2, a.brood ? a.brood.stage : 0)] : a.carry ? css(a.carryCol) : null,
    };
  }

  // Draw every ant onto ctx (identity transform, device pixels). cam is in CSS pixels; dpr scales it.
  function drawAnts(ctx, sim, cam, dpr, opts) {
    opts = opts || {};
    const P = LOOKS[opts.look] || LOOKS.rust;
    const D = cam.s * dpr, L = lod(D), m = L.m, per = L.per;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const rects = new Map();
    const push = (c, x, y) => { let r = rects.get(c); if (!r) rects.set(c, (r = [])); r.push(x, y); };
    let drawn = 0;
    for (const a of sim.ants) {
      const cx = (a.x - cam.x) * D, cy = (a.y - cam.y) * D;
      if (cx < -40 * m || cy < -40 * m || cx > W + 40 * m || cy > H + 40 * m) continue;
      const lk = look(sim, a), p = pose(sim, a);
      const px = cached(lk.kind, { tiny: L.tiny, frame: lk.frame, twitch: lk.twitch, jaws: lk.jaws, load: lk.load ? (lk.load === 'brood' ? 'brood' : 'grain') : null });
      const Q = lk.kind === 'queen' ? Object.assign({}, P, P.queen) : P;
      // the anchor: the middle of the cell's floor (or ceiling, or wall) in device pixels
      let ax, ay;
      if (p.mode === 'wall') { ax = Math.round(p.side < 0 ? cx : cx + D); ay = Math.round(cy + D / 2); }
      else { ax = Math.round(cx + D / 2); ay = Math.round(p.mode === 'ceiling' ? cy : cy + D); }
      const body = new Set();
      const place = (u, v) => {
        if (p.mode === 'wall') return [p.side < 0 ? ax + v * m : ax - (v + 1) * m, ay + (p.dir > 0 ? u : -u - 1) * m];
        const x = p.f > 0 ? ax + u * m : ax - (u + 1) * m;
        if (p.mode === 'ceiling') return [x, ay + v * m];
        const lift = -p.pitch * (u >= 2 ? 1 : u <= -4 ? -1 : 0); // nose up on a climb, down on a descent
        return [x, ay - (v + 1 + lift) * m];
      };
      for (const [u, v, key] of px) {
        const col = key === 'load' || key === 'brood' ? lk.loadCol : Q[key];
        const [x, y] = place(u, v);
        push(col, x, y);
        if (BODY.includes(key) || key === 'load' || key === 'brood') body.add(u + ',' + v);
      }
      // a dark rim around the body and the load so they read against bare soil as well as the dark back wall
      for (const s of body) {
        const [u, v] = s.split(',').map(Number);
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (body.has((u + du) + ',' + (v + dv))) continue;
          if (!opts.rim) continue;
          const [x, y] = place(u + du, v + dv);
          push(P.line, x, y);
        }
      }
      drawn++;
    }
    // rim first, then colours, so a rim pixel never covers a leg
    if (rects.has(P.line)) { ctx.fillStyle = P.line; const r = rects.get(P.line); for (let i = 0; i < r.length; i += 2) ctx.fillRect(r[i], r[i + 1], m, m); }
    for (const [c, r] of rects) {
      if (c === P.line) continue;
      ctx.fillStyle = c;
      for (let i = 0; i < r.length; i += 2) ctx.fillRect(r[i], r[i + 1], m, m);
    }
    return { drawn, m, per, tiny: L.tiny };
  }

  // The whole frame: soil scaled up crisp, then the ants. `buf` is { canvas, ctx, img, px } for the soil grid.
  function makeBuffer(sim) {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(sim.W, sim.H) : Object.assign(document.createElement('canvas'), { width: sim.W, height: sim.H });
    const c = canvas.getContext('2d'), img = c.createImageData(sim.W, sim.H);
    return { canvas, ctx: c, img, px: new Uint32Array(img.data.buffer) };
  }
  function drawFarm(ctx, sim, cam, dpr, buf, opts) {
    opts = opts || {};
    sim.paint(buf.px, { ants: !!opts.oldAnts });
    buf.ctx.putImageData(buf.img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = opts.backdrop || '#12151d';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.imageSmoothingEnabled = false;
    const s = cam.s * dpr;
    ctx.setTransform(s, 0, 0, s, Math.round(-cam.x * s), Math.round(-cam.y * s));
    ctx.drawImage(buf.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (opts.oldAnts) return { drawn: 0 };
    return drawAnts(ctx, sim, cam, dpr, { look: opts.look, rim: opts.rim !== false });
  }

  return { sprite, lod, pose, drawAnts, drawFarm, makeBuffer, LOOKS, SHAPES };
});
