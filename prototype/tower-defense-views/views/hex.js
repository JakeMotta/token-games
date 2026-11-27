// Honey Hive: a pointy-top hex grid seen from above. The road zigzags along hex directions,
// the menu opens as hex petals round the cell, and the meter is a column of honey cells.
(function () {
  'use strict';
  const S = 2, U = 27, OX = 14, OY = 22, R3 = Math.sqrt(3) / 2;
  const toXY = ([q, r]) => [+(q + r / 2).toFixed(3), +(r * R3).toFixed(3)];
  const scr = (x, y) => [OX + x * U, OY + y * U];
  const DIRS = { E: [1, 0], W: [-1, 0], NE: [1, -1], NW: [0, -1], SE: [0, 1], SW: [-1, 1] };
  const moves = [['E', 4], ['SE', 3], ['E', 3], ['NE', 3], ['E', 2], ['SE', 4], ['SW', 3], ['E', 3]];
  const cells = [[-1, 1]], corners = [[-1, 1]];
  for (const [d, n] of moves) {
    for (let k = 0; k < n; k++) { const [q, r] = cells[cells.length - 1]; cells.push([q + DIRS[d][0], r + DIRS[d][1]]); }
    corners.push(cells[cells.length - 1]);
  }
  const path = corners.map(toXY);
  const spotCells = [[2, 2], [4, 3], [5, 5], [7, 2], [10, 0], [12, 3], [9, 6], [12, 7], [7, 5]];
  const spots = spotCells.map(toXY);
  const ROAD = new Set(cells.map(([q, r]) => q + ',' + r));
  const RAD = U / Math.sqrt(3); // hex corner radius in low pixels
  const NAMES = { rapid: 'Stinger', splash: 'Honey pot', frost: 'Frost bloom' };
  const C = { wax: '#f3d27a', wax2: '#eac262', gap: '#b8862e', honey: '#f29e1f', honeyHi: '#ffc857', dark: '#4a2c0a', cream: '#fff7e0', petal: '#fffbe9', mint: '#7fd1a8', berry: '#d9486f' };
  const FONT = (n) => "700 " + n + "px 'Baloo 2', sans-serif";

  function hexPath(c, x, y, r) { H.poly(c, H.hexPts(x, y, r, Math.PI / 6)); }

  function comb(st) {
    if (st.local.bg) return st.local.bg;
    const cv = document.createElement('canvas');
    cv.width = 480; cv.height = 270;
    const c = cv.getContext('2d');
    c.fillStyle = C.gap; c.fillRect(0, 0, 480, 270);
    for (let r = -1; r < 11; r++) for (let q = -7; q < 18; q++) {
      const [x, y] = scr(...toXY([q, r]));
      if (x < -20 || x > 500 || y < -20 || y > 290) continue;
      const road = ROAD.has(q + ',' + r);
      hexPath(c, x, y, RAD - 1.5);
      if (road) {
        const grd = c.createRadialGradient(x - 3, y - 4, 1, x, y, RAD);
        grd.addColorStop(0, C.honeyHi); grd.addColorStop(1, C.honey);
        c.fillStyle = grd; c.fill();
        c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(Math.round(x - 5), Math.round(y - 6), 3, 2);
      } else {
        c.fillStyle = H.hash(q * 17 + r * 5) > 0.5 ? C.wax : C.wax2; c.fill();
        c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1;
        c.beginPath(); const p = H.hexPts(x, y, RAD - 3, Math.PI / 6); c.moveTo(...p[3]); c.lineTo(...p[4]); c.lineTo(...p[5]); c.stroke();
        if (H.hash(q * 3 + r * 29) > 0.9) { c.fillStyle = '#dca94a'; hexPath(c, x, y, RAD * 0.45); c.fill(); }
      }
    }
    st.local.bg = cv;
    return cv;
  }

  function draw(st) {
    const c = st.low, u = st.ui, g = st.g, t = st.t;
    u.clearRect(0, 0, 960, 540);
    c.drawImage(comb(st), 0, 0);

    g.spots.forEach(([x, y], i) => {
      if (g.towerAt(i)) return;
      const [a, b] = scr(x, y), open = st.menu && st.menu.spot === i;
      hexPath(c, a, b, RAD - 3); c.fillStyle = open ? C.cream : '#c99a40'; c.fill();
      c.setLineDash([2, 2]); c.strokeStyle = C.dark; c.stroke(); c.setLineDash([]);
      c.fillStyle = C.dark; c.fillRect(a - 2, b - 0.5, 5, 1); c.fillRect(a, b - 2.5, 1, 5);
    });
    if (st.model && st.model.tower) {
      const tw = st.model.tower, [a, b] = scr(tw.x, tw.y);
      c.save(); c.globalAlpha = 0.18; c.fillStyle = C.mint;
      // The cells in range light up, so range reads in hexes.
      for (let r = -1; r < 11; r++) for (let q = -7; q < 18; q++) {
        const [x, y] = toXY([q, r]);
        if (Math.hypot(x - tw.x, y - tw.y) <= st.model.st.range) { const [p, s] = scr(x, y); hexPath(c, p, s, RAD - 1.5); c.fill(); }
      }
      c.restore();
    }

    const [ex, ey] = scr(...path[path.length - 1]);
    H.sprite(c, st.img('base'), ex + 6, ey + 12);
    const props = st.local.props || (st.local.props = [[3, 6, 'prop-clover'], [8, 3, 'prop-puddle'], [1, 6, 'prop-puddle'], [13, 1, 'prop-clover'], [5, 7, 'prop-clover']]);
    for (const [q, r, n] of props) { const [a, b] = scr(...toXY([q, r])); H.sprite(c, st.img(n), a, b, { center: true }); }

    const items = [];
    for (const tw of g.towers) items.push({ y: tw.y, f: () => {
      const [a, b] = scr(tw.x, tw.y), rec = H.recoil(tw), open = st.menu && st.menu.spot === tw.spot;
      hexPath(c, a, b, RAD - 2); c.fillStyle = open ? C.cream : '#a8742a'; c.fill();
      H.sprite(c, st.img('tower-' + tw.type + '-' + tw.level), a, b + 8, { sx: 1 + rec * 0.08, sy: 1 - rec * 0.08 });
      // Level as small honey drops round the cell.
      for (let l = 0; l < tw.level; l++) {
        const ang = Math.PI * (0.7 + l * 0.2), dx = Math.cos(ang) * (RAD - 1), dy = Math.sin(ang) * (RAD - 1);
        c.fillStyle = C.dark; c.fillRect(Math.round(a + dx) - 2, Math.round(b - dy) - 2, 4, 4);
        c.fillStyle = C.honeyHi; c.fillRect(Math.round(a + dx) - 1, Math.round(b - dy) - 1, 2, 2);
      }
    } });
    for (const e of g.enemies) items.push({ y: e.y, f: () => {
      const [a, b] = scr(e.x, e.y), h = H.heading(g, e);
      const hover = Math.sin(t * 14 + e.id) * 1.5;
      c.fillStyle = 'rgba(74,44,10,.3)'; c.fillRect(Math.round(a - 4), Math.round(b + 3), 8, 2);
      H.sprite(c, st.img('enemy-' + e.t), a, b + 4 + hover, { flip: h.dx < 0, flash: e.flash > 0, flashColour: '#fff' });
      if (e.slow) { c.fillStyle = '#c5f2ff'; c.fillRect(a - 4, b + 6, 8, 1); }
      if (e.hp < e.maxHp) {
        const w = e.t === 'boss' ? 18 : 10, top = b - (e.t === 'boss' ? 26 : e.t === 'big' ? 20 : 14);
        c.fillStyle = C.dark; c.fillRect(a - w / 2 - 1, top, w + 2, 3);
        c.fillStyle = C.berry; c.fillRect(a - w / 2, top + 1, Math.round(w * e.hp / e.maxHp), 1);
      }
    } });
    items.sort((p, q) => p.y - q.y).forEach((it) => it.f());

    for (const s of g.shots) {
      const [a, b] = scr(s.x, s.y), f = H.flight(s);
      const lift = s.kind === 'splash' ? Math.sin(f * Math.PI) * 14 : 0;
      if (s.kind === 'rapid') { const [p, q] = scr(s.sx, s.sy); c.strokeStyle = 'rgba(74,44,10,.35)'; c.beginPath(); c.moveTo(H.lerp(p, a, 0.7), H.lerp(q, b, 0.7)); c.lineTo(a, b); c.stroke(); }
      if (!H.sprite(c, st.img('shot-' + s.kind), a, b - lift, { center: true })) { c.fillStyle = C.dark; c.fillRect(a - 1, b - 1 - lift, 3, 3); }
    }
    for (const f of g.fx) {
      const k = f.t / f.life, [a, b] = scr(f.x, f.y);
      c.save(); c.globalAlpha = 1 - k;
      if (f.kind === 'blast') { c.fillStyle = C.honey; for (let i = 0; i < 6; i++) { const an = i / 6 * Math.PI * 2 + 0.5; hexPath(c, a + Math.cos(an) * f.size * U * k, b + Math.sin(an) * f.size * U * k, 3); c.fill(); } }
      else { c.strokeStyle = f.kind === 'chill' ? '#c5f2ff' : C.cream; hexPath(c, a, b, 3 + k * 8); c.stroke(); }
      c.restore();
    }

    meter(st, c, u);
    hud(st, u);
    if (st.model) menu(st, u);
    if (st.toast && t - st.toast.at < 1.5) {
      u.font = FONT(26); u.textAlign = 'center'; u.fillStyle = C.dark;
      u.fillText(st.toast.text, 480, 500); u.textAlign = 'left';
    }
  }

  // A column of honey cells down the right edge; each fills in turn as tokens come in.
  function meter(st, c, u) {
    const g = st.g, fill = g.fill(), n = 7, x = 461;
    c.fillStyle = 'rgba(74,44,10,.55)'; c.fillRect(444, 0, 36, 270);
    for (let i = 0; i < n; i++) {
      const y = 254 - i * 31, f = H.clamp(fill * n - i, 0, 1);
      hexPath(c, x, y, 15); c.fillStyle = '#5a3a12'; c.fill();
      c.save(); hexPath(c, x, y, 13); c.clip();
      c.fillStyle = '#3a2408'; c.fillRect(x - 15, y - 15, 30, 30);
      c.fillStyle = f >= 1 ? C.honeyHi : C.honey; c.fillRect(x - 15, y + 13 - 26 * f, 30, 26 * f + 2);
      c.restore();
    }
    const tip = st.events.find((e) => e.type === 'wave' && st.t - e.at < 1);
    if (tip) { c.fillStyle = C.honeyHi; for (let i = 0; i < 5; i++) c.fillRect(448 + i * 7, 20 + ((st.t - tip.at) * 220 + i * 37) % 240, 2, 5); }
    st.hit(444 * S, 0, 36 * S, 270 * S, { act: 'feed' });
    u.save(); u.translate(904, 270); u.rotate(-Math.PI / 2);
    u.font = FONT(18); u.textAlign = 'center'; u.fillStyle = C.cream;
    u.fillText('TOKENS ' + H.fmt(g.meter.tokens) + ' / ' + H.fmt(g.threshold()) + '   ·   ' + g.meter.queue.length + ' bees waiting', 0, 6);
    u.restore();
  }

  function chip(u, x, y, label, value, fill) {
    const p = H.hexPts(x, y, 30, Math.PI / 6);
    H.poly(u, p); u.fillStyle = fill; u.fill(); u.lineWidth = 3; u.strokeStyle = C.dark; u.stroke();
    u.textAlign = 'center'; u.fillStyle = C.dark;
    u.font = FONT(20); u.fillText(value, x, y + 6);
    u.font = FONT(12); u.fillText(label, x, y - 12);
    u.textAlign = 'left';
  }
  function hud(st, u) {
    const g = st.g;
    chip(u, 40, 500, 'LIVES', String(g.lives), C.petal);
    chip(u, 94, 470, 'GOLD', String(g.gold), C.honeyHi);
    chip(u, 148, 500, 'WAVE', String(g.wave), C.petal);
    chip(u, 202, 470, 'LEVEL', String(g.level), C.mint);
  }

  // Petals: big hexes packed round the chosen cell like a flower.
  function menu(st, u) {
    const m = st.model, [a, b] = scr(...spots[m.spot]).map((v) => v * S);
    const pr = 46, d = pr * 2 * R3;
    // Up-left, up-right and the side with more room; downwards near the top edge.
    const side = a > 760 ? Math.PI : 0, up = b < 150 ? 1 : -1;
    const angles = [up * 2 * Math.PI / 3, up * Math.PI / 3, side];
    const at = (k) => [a + Math.cos(angles[k]) * d, b + Math.sin(angles[k]) * d];
    const petal = (k, fill, draw, act) => {
      const [x, y] = at(k);
      H.poly(u, H.hexPts(x, y, pr, Math.PI / 6));
      u.fillStyle = 'rgba(74,44,10,.35)'; u.save(); u.translate(0, 5); u.fill(); u.restore();
      u.fillStyle = fill; u.fill(); u.lineWidth = 3; u.strokeStyle = C.dark; u.stroke();
      draw(x, y);
      if (act) st.hit(x - pr * 0.85, y - pr * 0.85, pr * 1.7, pr * 1.7, act);
    };
    H.poly(u, H.hexPts(a, b, RAD * S, Math.PI / 6)); u.lineWidth = 4; u.strokeStyle = C.cream; u.stroke();
    u.textAlign = 'center';
    if (!m.tower) {
      m.build.forEach((o, i) => petal(i, o.afford ? C.petal : '#e0d2b0', (x, y) => {
        const im = st.img('tower-' + o.type + '-1');
        if (im) { u.imageSmoothingEnabled = false; u.drawImage(im, x - im.width * 0.6, y - 40, im.width * 1.2, im.height * 1.2); }
        u.font = FONT(14); u.fillStyle = C.dark; u.fillText(NAMES[o.type], x, y + 14);
        u.font = FONT(12); u.fillStyle = o.afford ? '#a5620f' : '#8a7a60'; u.fillText(o.cost + 'g', x, y + 30);
      }, { act: 'build', type: o.type }));
    } else {
      const tw = m.tower;
      petal(0, C.petal, (x, y) => {
        u.font = FONT(14); u.fillStyle = C.dark; u.fillText(NAMES[tw.type], x, y - 4);
        u.font = FONT(12); u.fillText('lv ' + tw.level + ' · ' + m.st.dps + ' dps', x, y + 14);
      }, { act: 'close' });
      petal(1, m.upCost == null ? '#e0d2b0' : m.afford ? C.mint : '#bfd9c8', (x, y) => {
        u.font = FONT(16); u.fillStyle = C.dark; u.fillText(m.upCost == null ? 'Top' : 'Upgrade', x, y - 2);
        if (m.upCost != null) { u.font = FONT(13); u.fillText(m.upCost + 'g', x, y + 16); }
      }, { act: 'upgrade' });
      petal(2, '#f7b2c4', (x, y) => {
        u.font = FONT(16); u.fillStyle = C.dark; u.fillText('Sell', x, y - 2);
        u.font = FONT(13); u.fillText('+' + m.sell + 'g', x, y + 16);
      }, { act: 'sell' });
    }
    u.textAlign = 'left';
  }

  window.VIEWS.push({
    id: 'hex', name: 'Honey Hive', tag: 'Hex grid · top-down · PixelLab',
    blurb: 'A honeycomb board: the road zigzags along hex lines, menus bloom as hex petals.',
    low: { w: 480, h: 270 },
    map: { path, spots },
    demo: { towers: [[0, 'rapid', 2], [1, 'frost', 2], [3, 'splash', 3], [5, 'rapid', 4], [6, 'splash', 1], [8, 'rapid', 1]], menu: 2 },
    spotXY: (i) => scr(...spots[i]).map((v) => v * S),
    pickR: 26,
    draw,
  });
})();
