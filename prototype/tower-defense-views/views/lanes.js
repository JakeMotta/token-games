// Deep Mine: a side-on cross-section of a mine. Enemies ride down the shaft and walk three
// tunnels in turn; towers sit in alcoves between them. Lantern light, a seed-card tray on top.
(function () {
  'use strict';
  const S = 2, UX = 32, UY = 27, OX = 8, OY = 36;
  const scr = (x, y) => [OX + x * UX, OY + y * UY];
  const path = [[14, 0.6], [14, 3.2], [1.5, 3.2], [1.5, 5.6], [13.5, 5.6], [13.5, 8.0], [1.8, 8.0]];
  const spots = [[3.5, 4.4], [6.5, 4.4], [9.5, 4.4], [12, 4.4], [3.5, 6.8], [6.5, 6.8], [9.5, 6.8], [11.8, 6.8], [8, 1.9]];
  const SURF = scr(0, 0.6)[1], TUN = 30; // ground line; tunnel height in low pixels
  const tunnels = [[1.5, 14, 3.2], [1.5, 13.5, 5.6], [1.8, 13.5, 8.0]];
  const shafts = [[14, 0.6, 3.2], [1.5, 3.2, 5.6], [13.5, 5.6, 8.0]];
  const lanterns = [[4.8, 3.2], [10.6, 3.2], [8, 5.6], [3, 8], [10.5, 8]];
  const NAMES = { rapid: 'Pick gun', splash: 'Dynamite', frost: 'Ice drill' };
  const C = { sky1: '#141a3a', sky2: '#3b3f74', grass: '#4f7a3a', rock1: '#4a3427', rock2: '#3d2a20', rock3: '#5a4030', tunnel: '#22160f', beam: '#7a5232', rail: '#8f8f9a', paper: '#f1e1bf', ink: '#2a1a10', lamp: '#ffcf6e', red: '#c23b22' };
  const FONT = (n) => n + "px 'Rye', serif";

  function scenery(st) {
    if (st.local.bg) return st.local.bg;
    const cv = document.createElement('canvas');
    cv.width = 480; cv.height = 270;
    const c = cv.getContext('2d');
    const sky = c.createLinearGradient(0, 0, 0, SURF);
    sky.addColorStop(0, C.sky1); sky.addColorStop(1, C.sky2);
    c.fillStyle = sky; c.fillRect(0, 0, 480, SURF);
    for (let i = 0; i < 26; i++) { c.fillStyle = i % 3 ? '#9aa0d8' : '#fff'; c.fillRect(Math.floor(H.hash(i) * 480), Math.floor(H.hash(i + 50) * (SURF - 12)), 1, 1); }
    // Strata, darker the deeper.
    const bands = [C.rock3, C.rock1, '#43302a', C.rock2, '#33231c'];
    bands.forEach((col, i) => { c.fillStyle = col; c.fillRect(0, SURF + i * 46, 480, 47); });
    for (let i = 0; i < 260; i++) {
      const x = Math.floor(H.hash(i * 3.1) * 480), y = SURF + 4 + Math.floor(H.hash(i * 7.7) * (270 - SURF));
      c.fillStyle = H.hash(i * 1.3) > 0.85 ? '#d9b44a' : H.hash(i * 2.1) > 0.5 ? '#6a5040' : '#2e2018';
      c.fillRect(x, y, H.hash(i) > 0.7 ? 2 : 1, 1);
    }
    c.fillStyle = C.grass; c.fillRect(0, SURF - 3, 480, 5);
    c.fillStyle = '#6fa04c'; for (let x = 0; x < 480; x += 3) c.fillRect(x, SURF - 4 - (x * 7 % 3), 1, 2);
    // Tunnels with props and rails.
    for (const [a, b, y] of tunnels) {
      const [x0, fy] = scr(a, y), [x1] = scr(b, y);
      c.fillStyle = C.tunnel; c.fillRect(x0 - 12, fy - TUN, x1 - x0 + 24, TUN);
      c.fillStyle = '#2d1f16'; c.fillRect(x0 - 12, fy - TUN, x1 - x0 + 24, 3);
      c.fillStyle = C.beam; c.fillRect(x0 - 12, fy, x1 - x0 + 24, 3);
      c.fillStyle = C.rail; c.fillRect(x0 - 12, fy - 2, x1 - x0 + 24, 1);
      for (let x = x0; x <= x1; x += 48) {
        c.fillStyle = C.beam; c.fillRect(x, fy - TUN, 3, TUN); c.fillRect(x - 6, fy - TUN, 15, 3);
        c.fillStyle = '#5a3a22'; c.fillRect(x + 2, fy - TUN, 1, TUN);
      }
    }
    // Shafts with ladders.
    for (const [x, a, b] of shafts) {
      const [sx, y0] = scr(x, a), [, y1] = scr(x, b);
      c.fillStyle = C.tunnel; c.fillRect(sx - 12, y0 - (a < 1 ? 6 : TUN), 24, y1 - y0 + (a < 1 ? 6 : TUN));
      c.fillStyle = C.beam; c.fillRect(sx - 8, y0 - TUN + 4, 2, y1 - y0 + TUN - 4); c.fillRect(sx + 6, y0 - TUN + 4, 2, y1 - y0 + TUN - 4);
      for (let y = y0 - TUN + 8; y < y1; y += 6) c.fillRect(sx - 8, y, 16, 1);
    }
    // Headframe over the shaft.
    const [hx] = scr(14, 0);
    c.fillStyle = '#5a3a22';
    c.fillRect(hx - 16, SURF - 34, 3, 34); c.fillRect(hx + 13, SURF - 34, 3, 34); c.fillRect(hx - 18, SURF - 36, 36, 4);
    for (let k = 0; k < 4; k++) { c.fillRect(hx - 15 + k * 3, SURF - 30 + k * 8, 28 - k * 6, 1); }
    c.fillStyle = '#9a9aa8'; c.beginPath(); c.arc(hx, SURF - 40, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = C.sky2; c.beginPath(); c.arc(hx, SURF - 40, 3, 0, Math.PI * 2); c.fill();
    // Alcoves for every spot: a carved niche with a plank floor.
    for (const [x, y] of spots) {
      const [sx, sy] = scr(x, y);
      c.fillStyle = '#1b120c';
      c.beginPath(); c.moveTo(sx - 17, sy); c.lineTo(sx - 17, sy - 20); c.quadraticCurveTo(sx, sy - 36, sx + 17, sy - 20); c.lineTo(sx + 17, sy); c.closePath(); c.fill();
      c.fillStyle = C.beam; c.fillRect(sx - 19, sy, 38, 3);
      c.fillStyle = '#a57a4a'; c.fillRect(sx - 19, sy, 38, 1);
    }
    st.local.bg = cv;
    return cv;
  }

  // Darkness over the rock with pools of warm light.
  function lighting(st, c) {
    const L = st.local.dark || (st.local.dark = document.createElement('canvas'));
    L.width = 480; L.height = 270;
    const d = L.getContext('2d');
    d.fillStyle = 'rgba(6, 3, 12, 0.5)'; d.fillRect(0, SURF, 480, 270 - SURF);
    d.globalCompositeOperation = 'destination-out';
    const pool = (x, y, r, a) => {
      const g2 = d.createRadialGradient(x, y, 0, x, y, r);
      g2.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g2.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = g2; d.fillRect(x - r, y - r, r * 2, r * 2);
    };
    lanterns.forEach(([x, y], i) => { const [a, b] = scr(x, y); pool(a, b - TUN + 8, 52 + Math.sin(st.t * 9 + i * 2) * 3, 0.95); });
    for (const tw of st.g.towers) { const [a, b] = scr(tw.x, tw.y); pool(a, b - 14, 30 + tw.level * 4, 0.8); }
    for (const s of st.g.shots) { const [a, b] = scr(s.x, s.y); pool(a, b, 14, 0.7); }
    // Every intruder carries a head lamp, so they show up in the dark.
    for (const e of st.g.enemies) { const [a, b] = scr(e.x, e.y); pool(a, b - 8, 18 + H.radius(e) * 20, 0.85); }
    for (const f of st.g.fx) if (f.kind === 'blast') { const [a, b] = scr(f.x, f.y); pool(a, b, 60 * (1 - f.t / f.life), 1); }
    pool(...scr(14, 0.6), 40, 0.9);
    c.drawImage(L, 0, 0);
    lanterns.forEach(([x, y], i) => {
      const [a, b] = scr(x, y);
      if (!H.sprite(c, st.img('prop-lantern'), a, b - TUN + 18)) { c.fillStyle = C.lamp; c.fillRect(a - 2, b - TUN + 6, 4, 5); }
      c.fillStyle = 'rgba(255, 207, 110,' + (0.5 + 0.2 * Math.sin(st.t * 11 + i)).toFixed(2) + ')'; c.fillRect(a - 1, b - TUN + 9, 2, 2);
    });
  }

  function draw(st) {
    const c = st.low, u = st.ui, g = st.g, t = st.t;
    u.clearRect(0, 0, 960, 540);
    c.drawImage(scenery(st), 0, 0);

    const [cx0, cy0] = scr(6, 8);
    H.sprite(c, st.img('prop-cart'), cx0 + 40, cy0 - 1);
    const [bx, by] = scr(1.0, 8);
    H.sprite(c, st.img('base'), bx, by + 1, { flip: true });

    g.spots.forEach(([x, y], i) => {
      if (g.towerAt(i)) return;
      const [a, b] = scr(x, y), open = st.menu && st.menu.spot === i;
      c.fillStyle = open ? C.lamp : '#7a5a3a';
      c.fillRect(a - 6, b - 2, 12, 2);
      c.fillStyle = open ? C.lamp : 'rgba(241,225,191,.5)'; c.font = '10px monospace'; c.fillText('+', a - 3, b - 10);
    });
    for (const tw of g.towers) {
      const [a, b] = scr(tw.x, tw.y), rec = H.recoil(tw);
      // Face the nearest tunnel's enemies: flip toward the target of the last shot.
      const shot = g.shots.find((s) => s.from === tw), flip = shot ? shot.tx < tw.x : tw.x > 8;
      H.sprite(c, st.img('tower-' + tw.type + '-' + tw.level), a - (flip ? -rec * 2 : rec * 2), b, { flip });
      for (let l = 0; l < tw.level; l++) { c.fillStyle = '#ffd86b'; c.fillRect(a - 8 + l * 5, b + 1, 3, 2); }
    }
    for (const e of g.enemies) {
      const [a, b] = scr(e.x, e.y), h = H.heading(g, e);
      const climbing = Math.abs(h.dy) > 0.5, step = Math.floor(t * 8 + e.id) % 2;
      const flip = climbing ? e.id % 2 === 0 : h.dx < 0;
      H.sprite(c, st.img('enemy-' + e.t), a, b - (climbing ? 0 : step), { flip, flash: e.flash > 0, sx: climbing ? 0.9 : 1 });
      if (e.slow) { c.fillStyle = '#bfefff'; c.fillRect(a - 5, b - 1, 10, 1); }
      if (e.hp < e.maxHp) {
        const im = st.img('enemy-' + e.t), top = b - (im ? im.height : 12) - 4;
        c.fillStyle = '#111'; c.fillRect(a - 7, top, 14, 3);
        c.fillStyle = C.red; c.fillRect(a - 6, top + 1, Math.round(12 * e.hp / e.maxHp), 1);
      }
    }
    for (const s of g.shots) {
      const [a, b] = scr(s.x, s.y), f = H.flight(s);
      const lift = s.kind === 'splash' ? Math.sin(f * Math.PI) * 18 : 0;
      if (s.kind === 'splash') { c.fillStyle = '#ffdd55'; c.fillRect(a + 2 - (t * 40 % 2), b - lift - 5, 1, 1); }
      if (!H.sprite(c, st.img('shot-' + s.kind), a, b - lift, { center: true })) { c.fillStyle = '#fff'; c.fillRect(a - 1, b - lift - 1, 3, 3); }
    }
    for (const f of g.fx) {
      const k = f.t / f.life, [a, b] = scr(f.x, f.y);
      if (f.kind === 'blast') {
        for (let i = 0; i < 10; i++) {
          const an = H.hash(i + f.x * 9) * Math.PI * 2, r = k * f.size * 34;
          c.fillStyle = i % 2 ? '#ffb347' : '#ffe08a';
          c.fillRect(Math.round(a + Math.cos(an) * r), Math.round(b + Math.sin(an) * r * 0.6), 2, 2);
        }
        c.fillStyle = 'rgba(120,100,90,' + (0.5 * (1 - k)).toFixed(2) + ')'; c.beginPath(); c.arc(a, b - 6 - k * 10, 6 + k * 8, 0, Math.PI * 2); c.fill();
      } else {
        c.fillStyle = f.kind === 'chill' ? '#bfefff' : '#d9b44a';
        for (let i = 0; i < 5; i++) c.fillRect(Math.round(a - 6 + i * 3), Math.round(b - 4 - k * 8 + (i % 2) * 3), 1, 1);
      }
    }
    lighting(st, c);
    hopper(st, c, u);
    hud(st, u);
    tray(st, u);
    if (st.toast && t - st.toast.at < 1.5) {
      u.font = FONT(24); u.textAlign = 'center'; u.fillStyle = C.lamp;
      u.fillText(st.toast.text, 480, 300); u.textAlign = 'left';
    }
  }

  // The ore hopper on the surface: ore piles up with tokens, the gate drops it down the shaft.
  function hopper(st, c, u) {
    const g = st.g, fill = g.fill(), [x] = scr(1.3, 0);
    const im = st.img('bucket');
    const pile = Math.round(fill * 22);
    c.fillStyle = '#c99a3a';
    for (let i = 0; i < pile; i++) c.fillRect(x - 12 + (i * 7 % 24), SURF - 26 - Math.floor(i / 4) * 2 + ((i * 3) % 3), 3, 2);
    if (!H.sprite(c, im, x, SURF + 2)) { c.fillStyle = C.beam; c.fillRect(x - 18, SURF - 40, 36, 40); }
    const drop = st.events.find((e) => e.type === 'wave' && st.t - e.at < 1);
    if (drop) { c.fillStyle = '#d9b44a'; for (let i = 0; i < 6; i++) c.fillRect(x - 6 + i * 2, SURF + ((st.t - drop.at) * 60 + i * 5) % 30, 2, 2); }
    st.hit((x - 24) * S, 0, 48 * S, (SURF + 4) * S, { act: 'feed' });
    // A painted sign hammered in beside it.
    u.save();
    u.fillStyle = C.paper; u.strokeStyle = C.ink; u.lineWidth = 3;
    u.beginPath(); u.rect((x + 26) * S, 10, 168, 72); u.fill(); u.stroke();
    u.fillStyle = C.ink; u.font = FONT(15); u.fillText('ORE HOPPER', (x + 26) * S + 12, 32);
    u.font = FONT(13); u.fillText(H.fmt(g.meter.tokens) + ' of ' + H.fmt(g.threshold()) + ' tokens', (x + 26) * S + 12, 52);
    u.fillText(g.meter.queue.length + ' diggers queued', (x + 26) * S + 12, 70);
    u.restore();
  }

  function hud(st, u) {
    const g = st.g, x = 720;
    u.save();
    u.fillStyle = 'rgba(20,12,8,.82)'; u.strokeStyle = '#a57a4a'; u.lineWidth = 3;
    H.rrect(u, x, 10, 226, 72, 6); u.fill(); u.stroke();
    u.font = FONT(17); u.fillStyle = C.lamp;
    u.fillText('Shift ' + g.wave + ' · Lv ' + g.level, x + 14, 36);
    u.fillStyle = C.paper; u.fillText('♥ ' + g.lives + '    $ ' + g.gold, x + 14, 66);
    u.restore();
  }

  // Seed-card tray across the top: build cards for an empty alcove, or the tower's own cards.
  function tray(st, u) {
    const m = st.model, x0 = 330, y0 = 4, cw = 80, ch = 84;
    const cards = !m ? TD.TOWER_TYPES.map((type) => ({ type, cost: TD.buildCost(type), afford: false, idle: true }))
      : !m.tower ? m.build : null;
    u.save();
    u.fillStyle = '#5a3a22'; u.strokeStyle = '#2a1a10'; u.lineWidth = 4;
    H.rrect(u, x0 - 10, y0, 3 * (cw + 8) + 128, ch + 12, 8); u.fill(); u.stroke();
    u.fillStyle = '#3e2716'; u.fillRect(x0 - 4, y0 + 6, 3 * (cw + 8) + 116, ch);
    const card = (i, fill, draw, act) => {
      const x = x0 + i * (cw + 8), y = y0 + 6;
      u.fillStyle = fill; u.strokeStyle = C.ink; u.lineWidth = 2;
      H.rrect(u, x, y, cw, ch, 6); u.fill(); u.stroke();
      draw(x, y);
      if (act) st.hit(x, y, cw, ch, act);
    };
    if (cards) {
      cards.forEach((o, i) => card(i, o.idle ? '#a89474' : o.afford ? C.paper : '#c9b89a', (x, y) => {
        const im = st.img('tower-' + o.type + '-1');
        if (im) { u.imageSmoothingEnabled = false; u.drawImage(im, x + cw / 2 - im.width * 0.8, y + 6, im.width * 1.6, im.height * 1.6); }
        u.fillStyle = '#2a1a10'; u.fillRect(x + 4, y + ch - 22, cw - 8, 18);
        u.font = FONT(13); u.textAlign = 'center'; u.fillStyle = o.idle ? '#a89474' : o.afford ? C.lamp : '#8a7a60';
        u.fillText('$' + o.cost, x + cw / 2, y + ch - 8); u.textAlign = 'left';
      }, o.idle ? null : { act: 'build', type: o.type }));
      u.font = FONT(13); u.fillStyle = C.paper;
      u.fillText(m ? 'Pick a tool' : 'Tap an alcove', x0 + 3 * (cw + 8), y0 + 50);
      if (m) { u.fillText('✕ close', x0 + 3 * (cw + 8), y0 + 78); st.hit(x0 + 3 * (cw + 8), y0 + 60, 100, 30, { act: 'close' }); }
    } else {
      const tw = m.tower;
      card(0, C.paper, (x, y) => {
        const im = st.img('tower-' + tw.type + '-' + tw.level);
        if (im) { u.imageSmoothingEnabled = false; u.drawImage(im, x + cw / 2 - im.width * 0.8, y + 4, im.width * 1.6, im.height * 1.6); }
        u.font = FONT(12); u.textAlign = 'center'; u.fillStyle = C.ink; u.fillText('Lv ' + tw.level, x + cw / 2, y + ch - 10); u.textAlign = 'left';
      }, { act: 'close' });
      card(1, m.upCost == null ? '#c9b89a' : m.afford ? '#ffe7a3' : '#d8c8a0', (x, y) => {
        u.font = FONT(30); u.textAlign = 'center'; u.fillStyle = C.ink; u.fillText('▲', x + cw / 2, y + 40);
        u.font = FONT(13); u.fillText(m.upCost == null ? 'Top' : '$' + m.upCost, x + cw / 2, y + 70); u.textAlign = 'left';
      }, { act: 'upgrade' });
      card(2, '#e8b4a0', (x, y) => {
        u.font = FONT(26); u.textAlign = 'center'; u.fillStyle = C.ink; u.fillText('⛏', x + cw / 2, y + 40);
        u.font = FONT(13); u.fillText('Sell +' + m.sell, x + cw / 2, y + 70); u.textAlign = 'left';
      }, { act: 'sell' });
      u.font = FONT(14); u.fillStyle = C.lamp; u.fillText(NAMES[tw.type], x0 + 3 * (cw + 8), y0 + 44);
      u.font = FONT(12); u.fillStyle = C.paper; u.fillText(m.st.dps + ' dmg/s', x0 + 3 * (cw + 8), y0 + 66);
      u.fillText('range ' + m.st.range, x0 + 3 * (cw + 8), y0 + 86);
    }
    u.restore();
    // Frame the chosen alcove.
    if (m) {
      const [a, b] = scr(...spots[m.spot]);
      u.strokeStyle = C.lamp; u.lineWidth = 3; u.setLineDash([8, 5]);
      u.strokeRect((a - 20) * S, (b - 36) * S, 40 * S, 38 * S); u.setLineDash([]);
    }
  }

  window.VIEWS.push({
    id: 'lanes', name: 'Deep Mine', tag: 'Side view · cross-section · PixelLab',
    blurb: 'A mine cut open from the side: three tunnels, towers in alcoves, a seed-card tray on top.',
    low: { w: 480, h: 270 },
    map: { path, spots },
    demo: { towers: [[0, 'rapid', 2], [1, 'splash', 3], [2, 'frost', 1], [4, 'rapid', 4], [5, 'frost', 2], [6, 'splash', 1]], menu: 3 },
    spotXY: (i) => { const [a, b] = scr(...spots[i]); return [a * S, (b - 14) * S]; },
    pickR: 34,
    draw,
  });
})();
