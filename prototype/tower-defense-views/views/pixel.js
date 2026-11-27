// Pixel Meadow: classic top-down pixel art on a visible square grid, 24 px tiles at 480 x 270,
// shown at 2x. Right-angle switchback road, a bottom HUD bar, an RPG-style window for the menu.
(function () {
  'use strict';
  const T = 24, S = 2; // tile size in low pixels; low to screen scale
  const COLS = 20, ROWS = 10;
  const path = [[-1, 2], [4, 2], [4, 7], [9, 7], [9, 2], [14, 2], [14, 7], [18, 7]];
  const spots = [[2, 4], [6, 4], [7, 9], [11, 4], [12, 0], [16, 5], [16, 9], [2, 0], [8, 1]];
  const px = (x) => x * T + T / 2;
  const NAMES = { rapid: 'Archer', splash: 'Catapult', frost: 'Frost' };
  const C = { ink: '#1a1410', hud: '#4a3423', hudHi: '#7a5634', hudLo: '#2a1c12', text: '#f4ead0', dim: '#c9b48a', gold: '#f2c94c', red: '#e0524a', win: '#1f2f6b', winHi: '#3a56b0' };
  const PIX = "16px 'Press Start 2P', monospace";

  function pathTiles() {
    const set = new Set();
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1], [bx, by] = path[i];
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      for (let k = 0; k <= n; k++) set.add(Math.round(ax + (bx - ax) * k / n) + ',' + Math.round(ay + (by - ay) * k / n));
    }
    return set;
  }
  const ROAD = pathTiles();

  function ground(st) {
    // Painted once: tiles, the grid and a few flowers.
    if (st.local.ground) return st.local.ground;
    const cv = document.createElement('canvas');
    cv.width = 480; cv.height = 270;
    const c = cv.getContext('2d');
    const g1 = st.img('tile-grass'), p1 = st.img('tile-dirt');
    const road = (x, y) => ROAD.has(x + ',' + y);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const r = road(x, y), im = r ? p1 : g1, h = H.hash(x * 13 + y * 101);
      if (im) {
        // One quarter of the texture, picked and flipped at random so the repeat doesn't read.
        const q = Math.floor(h * 4), fx = h * 8 % 1 > 0.5, fy = h * 16 % 1 > 0.5;
        c.save(); c.translate(x * T + (fx ? T : 0), y * T + (fy ? T : 0)); c.scale(fx ? -1 : 1, fy ? -1 : 1);
        c.drawImage(im, (q % 2) * T, (q >> 1) * T, T, T, 0, 0, T, T); c.restore();
        // PixelLab gives the grain; the colour is set here (its flat textures come back sandy).
        c.globalCompositeOperation = 'color'; c.fillStyle = r ? '#8a5a32' : '#4e8a3a'; c.fillRect(x * T, y * T, T, T);
        c.globalCompositeOperation = 'multiply'; c.fillStyle = r ? '#e8d2b0' : '#b8cfa0'; c.fillRect(x * T, y * T, T, T);
        c.globalCompositeOperation = 'source-over';
      } else { c.fillStyle = r ? '#a8916a' : (x + y) % 2 ? '#3d5a39' : '#44633f'; c.fillRect(x * T, y * T, T, T); }
      if (r) {
        // A dark lip where the road meets grass.
        c.fillStyle = 'rgba(40, 30, 18, 0.45)';
        if (!road(x, y - 1)) c.fillRect(x * T, y * T, T, 2);
        if (!road(x, y + 1)) c.fillRect(x * T, y * T + T - 2, T, 2);
        if (!road(x - 1, y)) c.fillRect(x * T, y * T, 2, T);
        if (!road(x + 1, y)) c.fillRect(x * T + T - 2, y * T, 2, T);
      } else if (H.hash(x * 31 + y) > 0.86) {
        c.fillStyle = H.hash(x + y * 7) > 0.5 ? '#f4e27a' : '#e88aa8';
        c.fillRect(x * T + 6 + ((x * 7) % 11), y * T + 5 + ((y * 5) % 12), 2, 2);
      }
    }
    // The square grid, drawn on purpose so the cells read.
    c.fillStyle = 'rgba(10, 20, 8, 0.18)';
    for (let x = 1; x < COLS; x++) c.fillRect(x * T, 0, 1, ROWS * T);
    for (let y = 1; y < ROWS; y++) c.fillRect(0, y * T, COLS * T, 1);
    st.local.ground = cv;
    return cv;
  }

  function bar(c, x, y, w, h, f, col) {
    c.fillStyle = C.ink; c.fillRect(x - 1, y - 1, w + 2, h + 2);
    c.fillStyle = '#3a2a20'; c.fillRect(x, y, w, h);
    c.fillStyle = col; c.fillRect(x, y, Math.round(w * H.clamp(f, 0, 1)), h);
  }

  // A blue RPG window with a two-pixel border, in low pixels.
  function win(c, x, y, w, h) {
    c.fillStyle = C.ink; c.fillRect(x - 1, y - 1, w + 2, h + 2);
    c.fillStyle = '#e8e8f0'; c.fillRect(x, y, w, h);
    c.fillStyle = C.winHi; c.fillRect(x + 2, y + 2, w - 4, h - 4);
    const grd = c.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, C.winHi); grd.addColorStop(1, C.win);
    c.fillStyle = grd; c.fillRect(x + 2, y + 2, w - 4, h - 4);
  }

  function draw(st) {
    const c = st.low, u = st.ui, g = st.g, t = st.t;
    u.clearRect(0, 0, 960, 540);
    c.drawImage(ground(st), 0, 0);

    // Build spots: the glade's stone pad, blinking when it is the open one.
    g.spots.forEach(([x, y], i) => {
      if (g.towerAt(i)) return;
      const open = st.menu && st.menu.spot === i;
      if (!H.sprite(c, st.img('spot'), px(x), px(y), { center: true })) { c.fillStyle = '#5d5038'; c.fillRect(x * T + 4, y * T + 4, 16, 16); }
      if (open && Math.floor(t * 4) % 2 === 0) { c.strokeStyle = '#fff'; c.strokeRect(x * T + 1.5, y * T + 1.5, T - 3, T - 3); }
    });

    // The bucket by the gate: water rises with tokens, tips when a wave goes.
    const fill = g.fill(), tip = st.events.some((e) => e.type === 'wave' && t - e.at < 0.8);
    const bx = 0, by = 0;
    if (!H.sprite(c, st.img('bucket'), bx + 15, by + 30, { sx: tip ? 1.1 : 1, sy: tip ? 0.9 : 1 })) {
      c.fillStyle = '#7d5a3a'; c.fillRect(bx + 2, by + 4, 26, 24);
    }
    bar(c, bx + 1, by + 33, 28, 3, fill, '#7fc6e6');
    st.hit(bx * S, by * S, 32 * S, 40 * S, { act: 'feed' });

    // Base at the end of the road.
    const [ex, ey] = path[path.length - 1];
    H.sprite(c, st.img('base'), px(ex) + 4, px(ey) + 12);

    // Everything standing, back to front by y.
    const items = [];
    for (const tw of g.towers) items.push({ y: tw.y + 0.3, f: () => {
      const rec = H.recoil(tw), open = st.menu && st.menu.spot === tw.spot;
      H.sprite(c, st.img('tower-' + tw.type + '-' + tw.level), px(tw.x), px(tw.y) + 10, { sy: 1 - rec * 0.08, flash: open && Math.floor(t * 4) % 2 === 0, flashColour: '#fff8c0' });
      for (let l = 0; l < tw.level; l++) { c.fillStyle = C.ink; c.fillRect(px(tw.x) - 9 + l * 5, px(tw.y) + 10, 4, 4); c.fillStyle = C.gold; c.fillRect(px(tw.x) - 8 + l * 5, px(tw.y) + 11, 2, 2); }
    } });
    for (const e of g.enemies) items.push({ y: e.y, f: () => {
      const h = H.heading(g, e), bob = Math.floor((t * 6 + e.id) % 2);
      const ex2 = px(e.x), ey2 = px(e.y) + 6 - bob;
      c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(ex2 - 5, px(e.y) + 5, 10, 2);
      H.sprite(c, st.img('enemy-' + e.t), ex2, ey2, { flip: h.dx < 0, flash: e.flash > 0 });
      if (e.slow) { c.fillStyle = '#9fe3ff'; c.fillRect(ex2 - 1, ey2 - 22 + (bob ? 1 : 0), 2, 2); }
      if (e.hp < e.maxHp) bar(c, ex2 - 6, ey2 - (e.t === 'boss' ? 44 : e.t === 'big' ? 32 : 22), 12, 1, e.hp / e.maxHp, C.red);
    } });
    items.sort((a, b) => a.y - b.y).forEach((it) => it.f());

    for (const s of g.shots) {
      const lift = s.kind === 'splash' ? Math.sin(H.flight(s) * Math.PI) * 18 : 0;
      if (!H.sprite(c, st.img('shot-' + s.kind), px(s.x), px(s.y) - lift, { center: true })) { c.fillStyle = '#fff'; c.fillRect(px(s.x) - 1, px(s.y) - 1 - lift, 3, 3); }
    }
    for (const f of g.fx) {
      const k = f.t / f.life, r = Math.round((f.size * T) * (0.4 + k));
      c.fillStyle = f.kind === 'chill' ? '#bfefff' : f.kind === 'blast' ? '#ffb347' : '#ffffff';
      for (let a = 0; a < 8; a++) {
        const ang = a / 8 * Math.PI * 2;
        c.fillRect(Math.round(px(f.x) + Math.cos(ang) * r) - 1, Math.round(px(f.y) + Math.sin(ang) * r) - 1, 2, 2);
      }
    }

    // HUD bar along the bottom.
    const hy = 240;
    c.fillStyle = C.hudLo; c.fillRect(0, hy, 480, 30);
    c.fillStyle = C.hud; c.fillRect(0, hy + 2, 480, 26);
    c.fillStyle = C.hudHi; c.fillRect(0, hy + 2, 480, 2);
    const icon = (name, x) => H.sprite(c, st.img('icon-' + name), x, hy + 21);
    icon('lives', 14); icon('gold', 84); icon('wave', 164); icon('level', 244); icon('tokens', 330);
    u.font = PIX; u.textBaseline = 'middle'; u.fillStyle = C.text;
    const ty = (hy + 15) * S;
    u.fillText(String(g.lives), 24 * S, ty);
    u.fillStyle = C.gold; u.fillText(String(g.gold), 94 * S, ty);
    u.fillStyle = C.text; u.fillText('W' + g.wave, 174 * S, ty);
    u.fillText('L' + g.level, 254 * S, ty);
    bar(c, 340, hy + 11, 130, 8, fill, '#7fc6e6');
    u.font = "12px 'Press Start 2P', monospace"; u.fillStyle = C.ink;
    u.fillText(H.fmt(g.meter.tokens) + '/' + H.fmt(g.threshold()), 346 * S, ty + 1);

    if (st.model) menu(st, c, u);
    if (st.toast && t - st.toast.at < 1.5) {
      win(c, 170, 4, 140, 18);
      u.font = "12px 'Press Start 2P', monospace"; u.fillStyle = C.text; u.textAlign = 'center';
      u.fillText(st.toast.text, 240 * S, 13 * S); u.textAlign = 'left';
    }
  }

  function menu(st, c, u) {
    const m = st.model, [sx, sy] = spots[m.spot];
    const w = 132, h = m.tower ? 70 : 74;
    let x = px(sx) + 16, y = px(sy) - 10;
    if (x + w > 476) x = px(sx) - 16 - w;
    y = H.clamp(y, 4, 236 - h);
    win(c, x, y, w, h);
    u.font = "12px 'Press Start 2P', monospace"; u.textBaseline = 'middle';
    const cur = Math.floor(st.t * 2) % 2;
    if (!m.tower) {
      u.fillStyle = C.dim; u.fillText('BUILD', (x + 7) * S, (y + 9) * S);
      m.build.forEach((o, i) => {
        const ry = y + 18 + i * 18;
        H.sprite(c, st.img('tower-' + o.type + '-1'), x + 20, ry + 16, { scale: 0.55 });
        u.fillStyle = o.afford ? C.text : '#8d93b8';
        u.fillText(NAMES[o.type], (x + 32) * S, (ry + 8) * S);
        u.fillStyle = o.afford ? C.gold : '#8d93b8'; u.fillText(o.cost + 'G', (x + 100) * S, (ry + 8) * S);
        st.hit(x * S, ry * S, w * S, 18 * S, { act: 'build', type: o.type });
      });
      if (cur) { c.fillStyle = '#fff'; c.fillRect(x + 3, y + 25, 3, 3); }
    } else {
      const tw = m.tower;
      u.fillStyle = C.text; u.fillText(NAMES[tw.type] + ' L' + tw.level, (x + 7) * S, (y + 9) * S);
      u.fillStyle = C.dim; u.fillText('DPS ' + m.st.dps + (m.next ? '>' + m.next.dps : ''), (x + 7) * S, (y + 22) * S);
      u.fillStyle = m.upCost == null ? '#8d93b8' : m.afford ? C.text : '#8d93b8';
      u.fillText(m.upCost == null ? 'MAX LEVEL' : 'UPGRADE ' + m.upCost + 'G', (x + 12) * S, (y + 38) * S);
      st.hit(x * S, (y + 30) * S, w * S, 16 * S, { act: 'upgrade' });
      u.fillStyle = C.text; u.fillText('SELL +' + m.sell + 'G', (x + 12) * S, (y + 55) * S);
      st.hit(x * S, (y + 47) * S, w * S, 16 * S, { act: 'sell' });
      if (cur) { c.fillStyle = '#fff'; c.fillRect(x + 4, y + 37, 3, 3); }
    }
  }

  window.VIEWS.push({
    id: 'pixel', name: 'Pixel Meadow', tag: 'Top-down · square grid · PixelLab',
    blurb: 'Classic 16-bit look: square tiles you can see, a switchback road, RPG menu window.',
    low: { w: 480, h: 270 },
    map: { path, spots },
    demo: { towers: [[0, 'rapid', 2], [1, 'splash', 3], [3, 'rapid', 4], [4, 'frost', 2], [5, 'splash', 1], [2, 'frost', 1]], menu: 8 },
    spotXY: (i) => [px(spots[i][0]) * S, px(spots[i][1]) * S],
    pickR: 24,
    draw,
  });
})();
