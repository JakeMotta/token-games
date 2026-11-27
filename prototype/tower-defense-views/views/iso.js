// Mesa Outpost: an isometric desert island at dusk. 32 x 16 diamonds at 480 x 270, mesa blocks
// with height, shots that arc through the air with shadows, slanted banners and stacked cards.
(function () {
  'use strict';
  const S = 2, CX = 240, CY = 40, HW = 16, HH = 8;
  const NX = 13, NY = 12; // tiles 0..12 by 0..11
  const path = [[-1, 2], [3, 2], [3, 8], [7, 8], [7, 4], [10, 4], [10, 10], [10, 11]];
  const spots = [[1, 4], [5, 5], [5, 10], [5, 2], [8, 6], [8, 10], [11, 7], [9, 2], [1, 0]];
  const P = (x, y) => [CX + (x - y) * HW, CY + (x + y) * HH];
  const NAMES = { rapid: 'Bolt', splash: 'Kiln', frost: 'Chill' };
  const C = { sky1: '#2b1846', sky2: '#c4515a', sky3: '#f4a259', top1: '#e0a46a', top2: '#d6995f', road: '#6a3a22', roadHi: '#94603d', left: '#a3542f', right: '#74361f', ink: '#2a1020', cream: '#fff1d6', teal: '#2f9c95', gold: '#ffd166' };
  const BANNER = "18px 'Bungee', sans-serif";

  const ROAD = new Set();
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let k = 0; k <= n; k++) ROAD.add(Math.round(ax + (bx - ax) * k / n) + ',' + Math.round(ay + (by - ay) * k / n));
  }
  const near = (x, y, list, d) => list.some(([a, b]) => Math.abs(a - x) <= d && Math.abs(b - y) <= d);
  // Mesa blocks and props on tiles well away from the road and the spots.
  const MESAS = [], PROPS = [];
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    if (H.distToPath(path, x, y) < 1.4 || near(x, y, spots, 1)) continue;
    const h = H.hash(x * 13 + y * 7);
    if (h > 0.62) MESAS.push({ x, y, h: h > 0.86 ? 3 : h > 0.74 ? 2 : 1 });
    else if (h < 0.22) PROPS.push({ x, y, name: h < 0.1 ? 'prop-cactus' : 'prop-rocks' });
  }

  function diamond(c, x, y, fill) {
    H.poly(c, [P(x - 0.5, y - 0.5), P(x + 0.5, y - 0.5), P(x + 0.5, y + 0.5), P(x - 0.5, y + 0.5)].map(([a, b]) => [a, b]));
    c.fillStyle = fill; c.fill();
  }

  function scenery(st) {
    if (st.local.bg) return st.local.bg;
    const cv = document.createElement('canvas');
    cv.width = 480; cv.height = 270;
    const c = cv.getContext('2d');
    const sky = c.createLinearGradient(0, 0, 0, 270);
    sky.addColorStop(0, C.sky1); sky.addColorStop(0.55, C.sky2); sky.addColorStop(1, C.sky3);
    c.fillStyle = sky; c.fillRect(0, 0, 480, 270);
    c.fillStyle = '#ffd98a'; c.beginPath(); c.arc(400, 236, 26, 0, Math.PI * 2); c.fill();
    // Far mesas on the horizon.
    c.fillStyle = '#6a2c4a';
    [[0, 200, 60, 30], [40, 214, 90, 18], [360, 206, 70, 26], [420, 196, 60, 40]].forEach(([x, y, w, h]) => {
      c.fillRect(x, y, w, h); c.fillRect(x + 6, y - 6, w - 14, 6);
    });
    // The island: top tiles, then the two front cliff faces with strata.
    const depth = 26;
    const W0 = P(-0.5, NY - 0.5), S0 = P(NX - 0.5, NY - 0.5), E0 = P(NX - 0.5, -0.5);
    H.poly(c, [W0, S0, [S0[0], S0[1] + depth], [W0[0], W0[1] + depth]]); c.fillStyle = C.left; c.fill();
    H.poly(c, [S0, E0, [E0[0], E0[1] + depth], [S0[0], S0[1] + depth]]); c.fillStyle = C.right; c.fill();
    c.globalAlpha = 0.25; c.fillStyle = '#ffd0a0';
    for (let k = 1; k < 4; k++) {
      const o = k * depth / 4;
      H.poly(c, [[W0[0], W0[1] + o], [S0[0], S0[1] + o], [S0[0], S0[1] + o + 1], [W0[0], W0[1] + o + 1]]); c.fill();
      H.poly(c, [[S0[0], S0[1] + o], [E0[0], E0[1] + o], [E0[0], E0[1] + o + 1], [S0[0], S0[1] + o + 1]]); c.fill();
    }
    c.globalAlpha = 1;
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
      const road = ROAD.has(x + ',' + y);
      diamond(c, x, y, road ? ((x + y) % 2 ? C.road : '#78442a') : (x + y) % 2 ? C.top1 : C.top2);
      if (!road && H.hash(x * 3 + y * 11) > 0.7) { const [a, b] = P(x, y); c.fillStyle = '#c4834c'; c.fillRect(a - 3 + (x % 3) * 2, b - 1, 2, 1); }
      if (road) { const [a, b] = P(x, y); c.fillStyle = C.roadHi; c.fillRect(a - 5, b, 2, 1); c.fillRect(a + 4, b - 1, 2, 1); }
    }
    // A plank bridge where the road comes in over the edge.
    diamond(c, -1, 2, '#6b4429');
    // Faint diamond grid lines so the iso cells read.
    c.strokeStyle = 'rgba(80, 30, 10, 0.18)'; c.lineWidth = 1;
    for (let k = 0; k <= NX; k++) { const a = P(k - 0.5, -0.5), b = P(k - 0.5, NY - 0.5); c.beginPath(); c.moveTo(a[0] + 0.5, a[1] + 0.5); c.lineTo(b[0] + 0.5, b[1] + 0.5); c.stroke(); }
    for (let k = 0; k <= NY; k++) { const a = P(-0.5, k - 0.5), b = P(NX - 0.5, k - 0.5); c.beginPath(); c.moveTo(a[0] + 0.5, a[1] + 0.5); c.lineTo(b[0] + 0.5, b[1] + 0.5); c.stroke(); }
    st.local.bg = cv;
    return cv;
  }

  function mesa(c, m) {
    const z = m.h * 9;
    const n = P(m.x - 0.5, m.y - 0.5), e = P(m.x + 0.5, m.y - 0.5), s = P(m.x + 0.5, m.y + 0.5), w = P(m.x - 0.5, m.y + 0.5);
    H.poly(c, [w, s, [s[0], s[1] - z], [w[0], w[1] - z]]); c.fillStyle = C.left; c.fill();
    H.poly(c, [s, e, [e[0], e[1] - z], [s[0], s[1] - z]]); c.fillStyle = C.right; c.fill();
    H.poly(c, [[n[0], n[1] - z], [e[0], e[1] - z], [s[0], s[1] - z], [w[0], w[1] - z]]); c.fillStyle = '#eab27a'; c.fill();
    c.fillStyle = 'rgba(255,220,170,.35)'; c.fillRect(w[0], w[1] - z, s[0] - w[0], 1);
  }

  function banner(u, x, y, w, h, fill, text, colour) {
    u.save();
    u.beginPath(); u.moveTo(x + 12, y); u.lineTo(x + w, y); u.lineTo(x + w - 12, y + h); u.lineTo(x, y + h); u.closePath();
    u.fillStyle = 'rgba(42,16,32,.55)'; u.save(); u.translate(4, 4); u.fill(); u.restore();
    u.fillStyle = fill; u.fill();
    u.font = BANNER; u.fillStyle = colour || C.cream; u.textBaseline = 'middle';
    u.fillText(text, x + 20, y + h / 2 + 1);
    u.restore();
  }

  function draw(st) {
    const c = st.low, u = st.ui, g = st.g, t = st.t;
    u.clearRect(0, 0, 960, 540);
    c.drawImage(scenery(st), 0, 0);

    // Open pads.
    g.spots.forEach(([x, y], i) => {
      if (g.towerAt(i)) return;
      const open = st.menu && st.menu.spot === i;
      const n = P(x - 0.38, y - 0.38), e = P(x + 0.38, y - 0.38), s = P(x + 0.38, y + 0.38), w = P(x - 0.38, y + 0.38);
      H.poly(c, [n, e, s, w]); c.fillStyle = open ? '#fff1d6' : '#b9774a'; c.fill();
      c.strokeStyle = open ? C.teal : '#7c4426'; c.stroke();
      if (open) { const [a, b] = P(x, y); c.fillStyle = C.teal; c.fillRect(a - 1, b - 12 - Math.round(Math.sin(t * 6) * 2), 3, 6); }
    });

    // Range ring of the open tower, flattened onto the ground.
    if (st.model && st.model.tower) {
      const tw = st.model.tower, [a, b] = P(tw.x, tw.y), r = st.model.st.range * HW * Math.SQRT2;
      c.save(); c.strokeStyle = 'rgba(47,156,149,.9)'; c.setLineDash([3, 2]);
      c.beginPath(); c.ellipse(a, b, r, r / 2, 0, 0, Math.PI * 2); c.stroke(); c.restore();
    }

    // Shadows of shots in the air go under everything standing.
    for (const s of g.shots) { const [a, b] = P(s.x, s.y + 0.3); c.fillStyle = 'rgba(60,20,10,.35)'; c.fillRect(a - 2, b - 1, 4, 2); }

    // Everything with height, back to front.
    const items = [];
    for (const m of MESAS) items.push({ k: m.x + m.y, f: () => mesa(c, m) });
    for (const p of PROPS) items.push({ k: p.x + p.y, f: () => { const [a, b] = P(p.x, p.y); H.sprite(c, st.img(p.name), a, b + 3); } });
    const [tx0, ty0] = P(0, 6);
    items.push({ k: 6, f: () => tank(st, c, tx0, ty0) });
    const [bx0, by0] = P(10, 10.7);
    items.push({ k: 20.7, f: () => H.sprite(c, st.img('base'), bx0, by0 + 6) });
    for (const tw of g.towers) items.push({ k: tw.x + tw.y + 0.1, f: () => {
      const [a, b] = P(tw.x, tw.y), rec = H.recoil(tw), open = st.menu && st.menu.spot === tw.spot;
      c.fillStyle = 'rgba(60,20,10,.3)'; c.beginPath(); c.ellipse(a, b + 1, 12, 5, 0, 0, Math.PI * 2); c.fill();
      H.sprite(c, st.img('tower-' + tw.type + '-' + tw.level), a, b + 4, { sy: 1 - rec * 0.06, flash: open && Math.floor(t * 3) % 2 === 0, flashColour: '#bff7f0' });
      // Level flags on a pole.
      for (let l = 0; l < tw.level; l++) { c.fillStyle = l < 2 ? C.teal : C.gold; c.fillRect(a + 11, b - 6 - l * 4, 4, 3); }
      c.fillStyle = '#4a2a18'; c.fillRect(a + 10, b - 6 - tw.level * 4, 1, tw.level * 4 + 6);
    } });
    for (const e of g.enemies) items.push({ k: e.x + e.y + 0.05, f: () => {
      const [a, b] = P(e.x, e.y), h = H.heading(g, e), bob = Math.abs(Math.sin(t * 9 + e.id)) * 2;
      const r = H.radius(e) * 20;
      c.fillStyle = 'rgba(60,20,10,.35)'; c.beginPath(); c.ellipse(a, b, r, r / 2, 0, 0, Math.PI * 2); c.fill();
      H.sprite(c, st.img('enemy-' + e.t), a, b - bob, { flip: h.dx - h.dy < 0, flash: e.flash > 0 });
      if (e.slow) { c.fillStyle = 'rgba(160,230,255,.6)'; c.fillRect(a - r, b - 1, r * 2, 2); }
      if (e.hp < e.maxHp) {
        const im = st.img('enemy-' + e.t), top = b - (im ? im.height : 14) - 4;
        c.fillStyle = C.ink; c.fillRect(a - 7, top, 14, 3);
        c.fillStyle = '#ff6b5b'; c.fillRect(a - 6, top + 1, Math.round(12 * e.hp / e.maxHp), 1);
      }
    } });
    items.sort((p, q) => p.k - q.k).forEach((it) => it.f());

    // Shots arc through the air: lift falls as they near the target, kiln shells lob high.
    for (const s of g.shots) {
      const f = H.flight(s), [a, b] = P(s.x, s.y + 0.3);
      const lift = (1 - f) * 16 + (s.kind === 'splash' ? Math.sin(f * Math.PI) * 34 : Math.sin(f * Math.PI) * 6);
      if (!H.sprite(c, st.img('shot-' + s.kind), a, b - lift, { center: true })) { c.fillStyle = '#fff'; c.fillRect(a - 1, b - lift - 1, 3, 3); }
    }
    for (const f of g.fx) {
      const k = f.t / f.life, [a, b] = P(f.x, f.y), r = f.size * HW * 1.4 * (0.3 + k);
      c.save(); c.globalAlpha = 1 - k;
      c.strokeStyle = f.kind === 'chill' ? '#bff7ff' : f.kind === 'blast' ? '#ffb24a' : '#fff1d6';
      c.lineWidth = f.kind === 'blast' ? 2 : 1;
      c.beginPath(); c.ellipse(a, b, r, r / 2, 0, 0, Math.PI * 2); c.stroke();
      if (f.kind === 'blast') { c.fillStyle = '#ffdd88'; c.beginPath(); c.ellipse(a, b - 6 * (1 - k), r * 0.5, r * 0.35, 0, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }

    hud(st, u);
    if (st.model) menu(st, u);
    if (st.toast && t - st.toast.at < 1.5) banner(u, 360, 480, 300, 40, C.ink, st.toast.text.toUpperCase());
  }

  // The token meter: a water tower whose tank fills; it spills when a wave leaves.
  function tank(st, c, x, y) {
    const g = st.g, fill = g.fill();
    const spill = st.events.find((e) => e.type === 'wave' && st.t - e.at < 1.2);
    const im = st.img('bucket');
    if (!H.sprite(c, im, x, y + 4)) { c.fillStyle = '#7c4a2a'; c.fillRect(x - 14, y - 44, 28, 24); }
    // Gauge on the tank: a glass strip with water in it.
    const gx = x + 20, gy = y - 46, gh = 30;
    c.fillStyle = C.ink; c.fillRect(gx - 1, gy - 1, 6, gh + 2);
    c.fillStyle = '#3a2030'; c.fillRect(gx, gy, 4, gh);
    c.fillStyle = '#5ec8e6'; c.fillRect(gx, gy + gh - Math.round(gh * fill), 4, Math.round(gh * fill));
    if (spill) {
      const k = (st.t - spill.at) / 1.2;
      c.fillStyle = 'rgba(94,200,230,' + (1 - k).toFixed(2) + ')';
      for (let i = 0; i < 6; i++) c.fillRect(x - 10 + i * 4, y - 20 + k * 22 + (i % 2) * 3, 2, 4);
    }
    st.hit((x - 22) * S, (y - 56) * S, 50 * S, 62 * S, { act: 'feed' });
  }

  function hud(st, u) {
    const g = st.g;
    banner(u, 16, 16, 250, 40, '#2a1020', 'WAVE ' + g.wave + '  ·  LV ' + g.level, C.gold);
    banner(u, 24, 62, 210, 34, C.teal, '♥ ' + g.lives + '   ◆ ' + g.gold);
    // Tokens and what is queued, on a banner that leans the other way.
    const q = g.meter.queue.length, w = 300, x = 960 - w - 16;
    u.save();
    u.beginPath(); u.moveTo(x, 16); u.lineTo(x + w - 12, 16); u.lineTo(x + w, 56); u.lineTo(x + 12, 56); u.closePath();
    u.fillStyle = '#2a1020'; u.fill();
    u.font = BANNER; u.fillStyle = C.cream; u.textBaseline = 'middle';
    u.fillText('TANK ' + H.fmt(g.meter.tokens) + ' / ' + H.fmt(g.threshold()), x + 24, 37);
    u.fillStyle = '#3a2030'; u.fillRect(x + 24, 62, w - 48, 10);
    u.fillStyle = '#5ec8e6'; u.fillRect(x + 24, 62, (w - 48) * g.fill(), 10);
    u.font = "13px 'Bungee', sans-serif"; u.fillStyle = C.cream;
    u.fillText(q + ' IN THE TANK' + (g.forming ? ' · ' + g.forming.toUpperCase() + ' ' + Math.round(g.formingProgress() * 100) + '%' : ''), x + 24, 88);
    u.restore();
  }

  // Stacked iso cards beside the pad: each card a slanted slab, one tower per card.
  function menu(st, u) {
    const m = st.model, [sx, sy] = P(...spots[m.spot]);
    const cw = 230, ch = 56, gap = 8;
    const rows = m.tower ? 3 : 3;
    let x = sx * S + 40, y = sy * S - 80;
    if (x + cw > 950) x = sx * S - 40 - cw;
    y = H.clamp(y, 100, 530 - rows * (ch + gap));
    const card = (i, fill, draw, act) => {
      const cy = y + i * (ch + gap), off = i * 10;
      u.save();
      u.beginPath(); u.moveTo(x + off + 16, cy); u.lineTo(x + off + cw, cy); u.lineTo(x + off + cw - 16, cy + ch); u.lineTo(x + off, cy + ch); u.closePath();
      u.fillStyle = 'rgba(42,16,32,.5)'; u.save(); u.translate(0, 6); u.fill(); u.restore();
      u.fillStyle = fill; u.fill(); u.strokeStyle = C.ink; u.lineWidth = 3; u.stroke();
      draw(x + off, cy);
      u.restore();
      if (act) st.hit(x + off, cy, cw, ch, act);
    };
    u.textBaseline = 'middle';
    if (!m.tower) {
      m.build.forEach((o, i) => card(i, o.afford ? C.cream : '#d9c4b0', (cx, cy) => {
        const im = st.img('tower-' + o.type + '-1');
        if (im) { u.imageSmoothingEnabled = false; u.drawImage(im, cx + 18, cy + 4, im.width * 1.4, im.height * 1.4); }
        u.font = BANNER; u.fillStyle = C.ink; u.fillText(NAMES[o.type].toUpperCase(), cx + 70, cy + 22);
        u.font = "13px 'Bungee', sans-serif"; u.fillStyle = o.afford ? '#a3542f' : '#8a7a70';
        u.fillText(o.cost + ' GOLD · ' + o.type, cx + 70, cy + 42);
      }, { act: 'build', type: o.type }));
    } else {
      const tw = m.tower;
      card(0, C.ink, (cx, cy) => {
        u.font = BANNER; u.fillStyle = C.gold; u.fillText(NAMES[tw.type].toUpperCase() + ' · LV ' + tw.level, cx + 24, cy + 20);
        u.font = "13px 'Bungee', sans-serif"; u.fillStyle = C.cream; u.fillText('DMG ' + m.st.dps + ' / S   RANGE ' + m.st.range, cx + 24, cy + 40);
      }, { act: 'close' });
      card(1, m.upCost == null ? '#d9c4b0' : m.afford ? C.teal : '#8fb8b4', (cx, cy) => {
        u.font = BANNER; u.fillStyle = C.cream;
        u.fillText(m.upCost == null ? 'TOP LEVEL' : 'UPGRADE ' + m.upCost, cx + 24, cy + 29);
      }, { act: 'upgrade' });
      card(2, '#c4515a', (cx, cy) => { u.font = BANNER; u.fillStyle = C.cream; u.fillText('SELL +' + m.sell, cx + 24, cy + 29); }, { act: 'sell' });
    }
  }

  window.VIEWS.push({
    id: 'iso', name: 'Mesa Outpost', tag: 'Isometric · diamond tiles · PixelLab',
    blurb: 'A desert island at dusk seen at an angle: mesas with height, lobbed shells, stacked cards.',
    low: { w: 480, h: 270 },
    map: { path, spots },
    demo: { towers: [[0, 'rapid', 3], [1, 'splash', 2], [4, 'frost', 2], [3, 'rapid', 1], [6, 'splash', 4], [5, 'frost', 1]], menu: 7 },
    spotXY: (i) => P(...spots[i]).map((v) => v * S),
    pickR: 30,
    draw,
  });
})();
