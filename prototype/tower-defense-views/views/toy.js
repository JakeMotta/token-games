// Toy Island: a round floating island seen at a tilt, a road spiralling in to the castle in the
// middle, bouncy squash-and-stretch toys, pastel colours and a speech-bubble menu.
(function () {
  'use strict';
  const S = 2, U = 25, SQ = 0.55, CX = 9, CY = 9, MX = 240, MY = 128;
  const scr = (x, y) => [MX + (x - CX) * U, MY + (y - CY) * U * SQ];
  const T0 = Math.PI * 0.8, TURNS = 1.35, RIM = 8.3;
  const at = (s) => { const th = T0 + s * TURNS * 2 * Math.PI, r = 7.3 - 5.3 * s; return [CX + Math.cos(th) * r, CY + Math.sin(th) * r]; };
  const path = [[+(CX + Math.cos(T0) * 9.6).toFixed(3), +(CY + Math.sin(T0) * 9.6).toFixed(3)]];
  for (let i = 0; i <= 90; i++) path.push(at(i / 90).map((v) => +v.toFixed(3)));
  // Between the spiral's arms, or just outside the outer arm.
  const spots = [[4.43, 11.64], [6.17, 5.63], [11.44, 6.1], [11.53, 10.46], [10.94, 14.34], [7.21, 13.93], [12.55, 2.85], [14.85, 11.13], [4.24, 8.16]];
  const NAMES = { rapid: 'Popper', splash: 'Splasher', frost: 'Snowcone' };
  const C = { sky1: '#bfe3ff', sky2: '#ffd6e8', grass: '#a6e3a1', grass2: '#8fd48a', side1: '#f7c59f', side2: '#f4a7b9', road: '#fff0c2', edge: '#f2c46d', ink: '#5a4a78', pink: '#ff8fb1', yellow: '#ffd93d', blue: '#7cc6ff' };
  const FONT = (n) => '600 ' + n + "px 'Fredoka', sans-serif";

  function scenery(st) {
    if (st.local.bg) return st.local.bg;
    const cv = document.createElement('canvas');
    cv.width = 480; cv.height = 270;
    const c = cv.getContext('2d');
    const sky = c.createLinearGradient(0, 0, 0, 270);
    sky.addColorStop(0, C.sky1); sky.addColorStop(1, C.sky2);
    c.fillStyle = sky; c.fillRect(0, 0, 480, 270);
    const cloud = (x, y, k, a) => { c.fillStyle = 'rgba(255,255,255,' + a + ')'; [[0, 0, 14], [14, -6, 12], [28, 0, 13], [12, 5, 12]].forEach(([dx, dy, r]) => { c.beginPath(); c.arc(x + dx * k, y + dy * k, r * k, 0, Math.PI * 2); c.fill(); }); };
    cloud(400, 40, 1, 0.9); cloud(20, 120, 0.8, 0.7); cloud(430, 210, 1.2, 0.8); cloud(120, 250, 1.4, 0.85);
    // The island: a squat cylinder with layered sides and drips, grass on top.
    const rx = RIM * U, ry = RIM * U * SQ, th = 26;
    c.fillStyle = C.side2; c.beginPath(); c.ellipse(MX, MY + th, rx, ry, 0, 0, Math.PI); c.fill();
    c.fillRect(MX - rx, MY, rx * 2, th);
    c.fillStyle = C.side1; c.beginPath(); c.ellipse(MX, MY + th * 0.5, rx, ry, 0, 0, Math.PI); c.fill();
    c.fillRect(MX - rx, MY, rx * 2, th * 0.5);
    for (let i = 0; i < 9; i++) { const a = 0.25 + i * 0.32, x = MX + Math.cos(a) * rx, y = MY + th + Math.sin(a) * ry; c.fillStyle = C.side2; c.beginPath(); c.ellipse(x, y + 6, 5, 9, 0, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = C.grass2; c.beginPath(); c.ellipse(MX, MY + 3, rx, ry, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = C.grass; c.beginPath(); c.ellipse(MX, MY, rx, ry, 0, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 70; i++) {
      const a = H.hash(i) * Math.PI * 2, r = Math.sqrt(H.hash(i + 30)) * (RIM - 0.4);
      const [x, y] = scr(CX + Math.cos(a) * r, CY + Math.sin(a) * r);
      c.fillStyle = i % 5 === 0 ? '#ffffff' : i % 7 === 0 ? C.pink : '#c4f0bf';
      c.fillRect(Math.round(x), Math.round(y), 2, 1);
    }
    // The spiral road: soft edge, cream top, little dashes down the middle.
    const pts = path.map(([x, y]) => scr(x, y));
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = C.edge; c.lineWidth = 17; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1] + 1.5) : c.moveTo(p[0], p[1] + 1.5))); c.stroke();
    c.strokeStyle = C.road; c.lineWidth = 14; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.stroke();
    c.strokeStyle = '#ffffff'; c.lineWidth = 1.5; c.setLineDash([3, 6]); c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.stroke(); c.setLineDash([]);
    st.local.bg = cv;
    return cv;
  }

  function hop(id, t) {
    const p = (t * 2.6 + id * 0.37) % 1;
    const lift = 4 * p * (1 - p) * 8, land = p < 0.1 || p > 0.92;
    return { lift, sx: land ? 1.22 : 0.92, sy: land ? 0.78 : 1.08 };
  }

  function draw(st) {
    const c = st.low, u = st.ui, g = st.g, t = st.t;
    u.clearRect(0, 0, 960, 540);
    c.drawImage(scenery(st), 0, 0);

    g.spots.forEach(([x, y], i) => {
      if (g.towerAt(i)) return;
      const [a, b] = scr(x, y), open = st.menu && st.menu.spot === i, k = open ? 1 + Math.sin(t * 8) * 0.12 : 1;
      c.fillStyle = 'rgba(90,74,120,.18)'; c.beginPath(); c.ellipse(a, b + 2, 13 * k, 7 * k, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = open ? '#ffffff' : '#fff6d8'; c.beginPath(); c.ellipse(a, b, 12 * k, 6.5 * k, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = open ? C.pink : '#f2c46d'; c.fillRect(a - 4, b - 1, 8, 2); c.fillRect(a - 1, b - 4, 2, 8);
    });
    if (st.model && st.model.tower) {
      const tw = st.model.tower, [a, b] = scr(tw.x, tw.y), r = st.model.st.range * U;
      c.fillStyle = 'rgba(255,143,177,.18)'; c.beginPath(); c.ellipse(a, b, r, r * SQ, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = C.pink; c.lineWidth = 1; c.beginPath(); c.ellipse(a, b, r, r * SQ, 0, 0, Math.PI * 2); c.stroke();
    }

    const items = [];
    items.push({ y: CY + 0.1, f: () => { const [a, b] = scr(CX, CY); const k = 1 + Math.sin(t * 2) * 0.03; H.sprite(c, st.img('base'), a, b + 12, { scale: 1.5, sx: k, sy: 2 - k }); } });
    const props = st.local.props || (st.local.props = [[3.2, 4.6, 'prop-tree'], [14.6, 6.2, 'prop-tree'], [8.8, 15.6, 'prop-mushroom'], [2.4, 10.2, 'prop-mushroom'], [15.6, 8.6, 'prop-mushroom'], [9.4, 1.9, 'prop-tree']]);
    for (const [x, y, n] of props) items.push({ y, f: () => { const [a, b] = scr(x, y); H.sprite(c, st.img(n), a, b + 2, { sy: 1 + Math.sin(t * 3 + x) * 0.04 }); } });
    for (const tw of g.towers) items.push({ y: tw.y, f: () => {
      const [a, b] = scr(tw.x, tw.y), rec = H.recoil(tw), open = st.menu && st.menu.spot === tw.spot;
      c.fillStyle = 'rgba(90,74,120,.22)'; c.beginPath(); c.ellipse(a, b + 1, 14, 6, 0, 0, Math.PI * 2); c.fill();
      H.sprite(c, st.img('tower-' + tw.type + '-' + tw.level), a, b + 4, { sx: 1 + rec * 0.18, sy: 1 - rec * 0.16, flash: open && Math.floor(t * 4) % 2 === 0, flashColour: '#ffffff' });
      for (let l = 0; l < tw.level; l++) { const x = a - (tw.level - 1) * 4 + l * 8, y = b + 8; c.fillStyle = '#b8860b'; c.fillRect(x - 3, y - 2, 6, 5); c.fillStyle = C.yellow; c.fillRect(x - 2, y - 1, 4, 3); }
    } });
    for (const e of g.enemies) items.push({ y: e.y, f: () => {
      const [a, b] = scr(e.x, e.y), h = H.heading(g, e), hp = hop(e.id, t * (1 - e.slow * 0.6));
      const r = H.radius(e) * U;
      c.fillStyle = 'rgba(90,74,120,' + (0.3 - hp.lift * 0.015).toFixed(2) + ')'; c.beginPath(); c.ellipse(a, b + 2, r * (1 - hp.lift * 0.03), r * 0.45, 0, 0, Math.PI * 2); c.fill();
      H.sprite(c, st.img('enemy-' + e.t), a, b + 3 - hp.lift, { sx: hp.sx, sy: hp.sy, flip: h.dx < 0, flash: e.flash > 0 });
      if (e.slow) { c.fillStyle = '#ffffff'; c.fillRect(a - 3, b - 4 - hp.lift - r * 2, 2, 2); c.fillRect(a + 2, b - 6 - hp.lift - r * 2, 2, 2); }
      if (e.hp < e.maxHp) {
        const im = st.img('enemy-' + e.t), top = b - (im ? im.height : 14) - hp.lift - 3;
        c.fillStyle = '#ffffff'; H.rrect(c, a - 8, top, 16, 4, 2); c.fill();
        c.fillStyle = C.pink; H.rrect(c, a - 7, top + 1, Math.max(1, 14 * e.hp / e.maxHp), 2, 1); c.fill();
      }
    } });
    items.sort((p, q) => p.y - q.y).forEach((it) => it.f());

    for (const s of g.shots) {
      const [a, b] = scr(s.x, s.y), f = H.flight(s);
      const lift = 12 * (1 - f) + (s.kind === 'splash' ? Math.sin(f * Math.PI) * 26 : Math.sin(f * Math.PI) * 4);
      const k = 1 + Math.sin(t * 20) * 0.15;
      if (!H.sprite(c, st.img('shot-' + s.kind), a, b - lift, { center: true, sx: k, sy: 2 - k })) { c.fillStyle = C.pink; c.beginPath(); c.arc(a, b - lift, 3, 0, Math.PI * 2); c.fill(); }
    }
    for (const f of g.fx) {
      const k = f.t / f.life, [a, b] = scr(f.x, f.y), cols = f.kind === 'chill' ? ['#ffffff', C.blue] : f.kind === 'blast' ? [C.pink, C.yellow, C.blue, '#b98cff'] : [C.yellow, '#ffffff'];
      for (let i = 0; i < 10; i++) {
        const an = i / 10 * Math.PI * 2 + f.x, r = (f.size * U + 4) * k;
        c.fillStyle = cols[i % cols.length];
        c.beginPath(); c.arc(a + Math.cos(an) * r, b + Math.sin(an) * r * SQ - 10 * Math.sin(k * Math.PI), 2.4 * (1 - k) + 0.6, 0, Math.PI * 2); c.fill();
      }
    }

    pail(st, c, u);
    hud(st, u);
    if (st.model) menu(st, u);
    if (st.toast && t - st.toast.at < 1.5) bubble(u, 330, 470, 300, 50, null, () => { u.font = FONT(22); u.fillStyle = C.ink; u.textAlign = 'center'; u.fillText(st.toast.text, 480, 502); u.textAlign = 'left'; });
  }

  // The toy pail on its own cloud in the top corner: a sand heap rises out of it as tokens
  // come in, and it tips over when a wave goes out.
  function pail(st, c, u) {
    const g = st.g, fill = g.fill(), x = 34, y = 50;
    c.fillStyle = '#ffffff';
    [[-22, 2, 11], [-8, -2, 13], [8, 0, 12], [22, 4, 10], [0, 6, 13]].forEach(([dx, dy, r]) => { c.beginPath(); c.arc(x + dx, y + dy, r, 0, Math.PI * 2); c.fill(); });
    const tip = st.events.find((e) => e.type === 'wave' && st.t - e.at < 1);
    c.save(); c.translate(x, y); if (tip) c.rotate(0.5 * Math.sin((st.t - tip.at) * Math.PI));
    const im = st.img('bucket');
    if (!H.sprite(c, im, 0, 4)) { c.fillStyle = C.pink; c.fillRect(-14, -30, 28, 30); }
    const rim = im ? 4 - im.height + 12 : -26;
    c.fillStyle = '#ffd98a'; c.beginPath(); c.ellipse(0, rim, 15, 2 + fill * 9, 0, Math.PI, 0); c.fill();
    c.fillStyle = '#ffe9b8'; c.fillRect(-4, rim - 2 - fill * 6, 3, 2);
    c.restore();
    st.hit(0, 0, 66 * S, 62 * S, { act: 'feed' });
    const tx = 66 * S;
    u.font = FONT(17); u.fillStyle = C.ink;
    u.fillText(H.fmt(g.meter.tokens) + ' / ' + H.fmt(g.threshold()), tx, 32);
    u.font = FONT(13); u.fillText(g.meter.queue.length + ' toys in the pail', tx, 52);
    for (let i = 0; i < 8; i++) { u.fillStyle = i < Math.round(fill * 8) ? C.pink : 'rgba(90,74,120,.2)'; u.beginPath(); u.arc(tx + 5 + i * 12, 68, 4.5, 0, Math.PI * 2); u.fill(); }
    u.textAlign = 'left';
  }

  function pill(u, x, y, w, fill, icon, text) {
    u.fillStyle = 'rgba(90,74,120,.18)'; H.rrect(u, x, y + 4, w, 40, 20); u.fill();
    u.fillStyle = '#ffffff'; H.rrect(u, x, y, w, 40, 20); u.fill();
    u.fillStyle = fill; u.beginPath(); u.arc(x + 20, y + 20, 14, 0, Math.PI * 2); u.fill();
    u.font = FONT(15); u.fillStyle = '#ffffff'; u.textAlign = 'center'; u.fillText(icon, x + 20, y + 25);
    u.font = FONT(20); u.fillStyle = C.ink; u.textAlign = 'left'; u.fillText(text, x + 42, y + 27);
  }
  function hud(st, u) {
    const g = st.g;
    pill(u, 772, 12, 84, C.pink, '♥', String(g.lives));
    pill(u, 862, 12, 88, C.yellow, '$', String(g.gold));
    pill(u, 772, 60, 178, C.blue, 'W', 'wave ' + g.wave + ' · lv ' + g.level);
  }

  function bubble(u, x, y, w, h, tail, inner) {
    u.save();
    u.fillStyle = 'rgba(90,74,120,.2)'; H.rrect(u, x, y + 6, w, h, 22); u.fill();
    u.fillStyle = '#ffffff'; H.rrect(u, x, y, w, h, 22); u.fill();
    if (tail) { u.beginPath(); u.moveTo(tail[0], tail[1]); u.lineTo(tail[2], tail[3]); u.lineTo(tail[4], tail[5]); u.closePath(); u.fill(); }
    u.lineWidth = 3; u.strokeStyle = '#e9def7'; H.rrect(u, x, y, w, h, 22); u.stroke();
    inner();
    u.restore();
  }

  // A speech bubble above the spot with round buttons in it.
  function menu(st, u) {
    const m = st.model, [a0, b0] = scr(...spots[m.spot]), a = a0 * S, b = b0 * S;
    const w = 330, h = 128;
    const x = H.clamp(a - w / 2, 10, 950 - w);
    const above = b - 60 - h > 10, y = above ? b - 60 - h : b + 40;
    const tail = above ? [a - 16, y + h - 2, a + 16, y + h - 2, a, b - 30] : [a - 16, y + 2, a + 16, y + 2, a, b + 10];
    bubble(u, x, y, w, h, tail, () => {
      const btn = (i, fill, draw, act) => {
        const cx = x + 60 + i * 105, cy = y + 56;
        u.fillStyle = 'rgba(90,74,120,.15)'; u.beginPath(); u.arc(cx, cy + 4, 40, 0, Math.PI * 2); u.fill();
        u.fillStyle = fill; u.beginPath(); u.arc(cx, cy, 40, 0, Math.PI * 2); u.fill();
        draw(cx, cy);
        st.hit(cx - 44, cy - 44, 88, 104, act);
      };
      u.textAlign = 'center';
      if (!m.tower) {
        m.build.forEach((o, i) => btn(i, o.afford ? ['#ffe1ec', '#fff3c4', '#dff1ff'][i] : '#eee8f2', (cx, cy) => {
          const im = st.img('tower-' + o.type + '-1');
          if (im) { u.imageSmoothingEnabled = false; u.drawImage(im, cx - im.width * 0.7, cy - im.height * 0.7 - 6, im.width * 1.4, im.height * 1.4); }
          u.font = FONT(15); u.fillStyle = C.ink; u.fillText(NAMES[o.type], cx, cy + 58);
          u.font = FONT(14); u.fillStyle = o.afford ? '#d0457a' : '#a99bb8'; u.fillText('$' + o.cost, cx, cy + 36);
        }, { act: 'build', type: o.type }));
      } else {
        const tw = m.tower;
        btn(0, '#f3eefa', (cx, cy) => {
          u.font = FONT(15); u.fillStyle = C.ink; u.fillText(NAMES[tw.type], cx, cy - 4);
          u.font = FONT(13); u.fillText('lv ' + tw.level + ' · ' + m.st.dps + '/s', cx, cy + 16);
        }, { act: 'close' });
        btn(1, m.upCost == null ? '#eee8f2' : m.afford ? '#c9f2c5' : '#e4efe2', (cx, cy) => {
          u.font = FONT(26); u.fillStyle = C.ink; u.fillText('⬆', cx, cy + 2);
          u.font = FONT(14); u.fillText(m.upCost == null ? 'max!' : '$' + m.upCost, cx, cy + 24);
        }, { act: 'upgrade' });
        btn(2, '#ffd6e2', (cx, cy) => {
          u.font = FONT(18); u.fillStyle = C.ink; u.fillText('sell', cx, cy);
          u.font = FONT(14); u.fillText('+$' + m.sell, cx, cy + 20);
        }, { act: 'sell' });
      }
      u.textAlign = 'left';
    });
  }

  window.VIEWS.push({
    id: 'toy', name: 'Toy Island', tag: 'Tilted 3D-ish · spiral road · PixelLab',
    blurb: 'A floating toy island: the road spirals in to a castle, toys hop and squash, bubble menu.',
    low: { w: 480, h: 270 },
    map: { path, spots },
    demo: { towers: [[0, 'rapid', 2], [2, 'splash', 3], [3, 'frost', 2], [4, 'rapid', 4], [6, 'splash', 1], [8, 'frost', 1]], menu: 1 },
    spotXY: (i) => scr(...spots[i]).map((v) => v * S),
    pickR: 30,
    draw,
  });
})();
