// Neon Horizon: a synthwave grid in true 3D perspective. Enemies pour out of a portal on the
// horizon and run toward you; glowing wireframe pylons, lasers, a radial ring menu.
(function () {
  'use strict';
  const HOR = 120, FX = 320, FY = 2000;
  const depth = (y) => 6 + (10 - y);
  const P = (x, y, z) => { const d = depth(y); return [480 + (x - 8) * FX / d, HOR + (FY - (z || 0) * FX) / d]; };
  const path = [[8, -0.6], [8, 1.5], [2.5, 1.5], [2.5, 5], [13.5, 5], [13.5, 8.4], [6, 8.4], [6, 10.4]];
  const spots = [[5.5, 3.2], [10.5, 3.1], [0.8, 3.4], [4.5, 6.8], [8.5, 6.8], [11.5, 6.9], [14.8, 6.6], [9.5, 9.8], [4.5, 9.9]];
  const NAMES = { rapid: 'LASER', splash: 'PULSE', frost: 'CRYO' };
  const COL = { rapid: '#ff3fd2', splash: '#ffb000', frost: '#3ff8ff' };
  const EN = { small: '#7cff6b', medium: '#ffe14d', big: '#ff7a3d', boss: '#ff2e63' };
  const FONT = (n, w) => (w || 700) + ' ' + n + "px 'Orbitron', sans-serif";

  function sky(st) {
    if (st.local.bg) return st.local.bg;
    const cv = document.createElement('canvas');
    cv.width = 960; cv.height = 540;
    const c = cv.getContext('2d');
    const g1 = c.createLinearGradient(0, 0, 0, HOR);
    g1.addColorStop(0, '#07011a'); g1.addColorStop(1, '#3b0a5e');
    c.fillStyle = g1; c.fillRect(0, 0, 960, HOR);
    for (let i = 0; i < 90; i++) { c.fillStyle = 'rgba(255,255,255,' + (0.2 + H.hash(i) * 0.6).toFixed(2) + ')'; c.fillRect(H.hash(i + 3) * 960, H.hash(i + 7) * (HOR - 30), 1.5, 1.5); }
    // Striped sun sinking into the horizon.
    const sun = c.createLinearGradient(0, HOR - 90, 0, HOR);
    sun.addColorStop(0, '#ffe66d'); sun.addColorStop(1, '#ff2e97');
    c.save(); c.beginPath(); c.arc(480, HOR, 86, Math.PI, 0); c.clip();
    c.fillStyle = sun; c.fillRect(380, HOR - 90, 200, 90);
    c.fillStyle = '#3b0a5e'; for (let k = 0; k < 6; k++) c.fillRect(380, HOR - 34 + k * 6, 200, 1 + k * 0.6);
    c.restore();
    // Wireframe mountains.
    c.strokeStyle = 'rgba(255,63,210,.7)'; c.lineWidth = 1.5; c.fillStyle = '#12002a';
    const ridge = [[0, HOR], [60, HOR - 40], [130, HOR - 14], [200, HOR - 52], [290, HOR - 8], [360, HOR], [600, HOR], [680, HOR - 30], [760, HOR - 10], [830, HOR - 58], [900, HOR - 20], [960, HOR - 36], [960, HOR]];
    H.poly(c, ridge); c.fill(); c.stroke();
    c.fillStyle = '#0d0020'; c.fillRect(0, HOR, 960, 540 - HOR);
    st.local.bg = cv;
    return cv;
  }

  function glow(c, colour, blur) { c.strokeStyle = colour; c.fillStyle = colour; c.shadowColor = colour; c.shadowBlur = blur; }
  function seg(c, a, b) { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }

  function grid(c, t) {
    c.save(); c.lineWidth = 1;
    const off = (t * 0.6) % 1;
    for (let k = -30; k <= 11; k++) {
      const y = k + off;
      if (depth(y) < 5.5) continue;
      const [, sy] = P(0, y);
      c.strokeStyle = 'rgba(255,63,210,' + H.clamp(0.9 - depth(y) / 40, 0.08, 0.6).toFixed(2) + ')';
      c.beginPath(); c.moveTo(0, sy); c.lineTo(960, sy); c.stroke();
    }
    c.strokeStyle = 'rgba(255,63,210,.35)';
    for (let x = -24; x <= 40; x++) { const a = P(x, 11), b = P(x, -60); seg(c, a, b); }
    c.restore();
  }

  function road(c) {
    c.save();
    const w = 0.42;
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1], [bx, by] = path[i];
      const x0 = Math.min(ax, bx) - w, x1 = Math.max(ax, bx) + w, y0 = Math.min(ay, by) - w, y1 = Math.max(ay, by) + w;
      H.poly(c, [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]);
      c.fillStyle = 'rgba(63,248,255,.12)'; c.fill();
    }
    glow(c, '#3ff8ff', 10); c.lineWidth = 2;
    for (const sgn of [-1, 1]) {
      c.beginPath();
      path.forEach(([x, y], i) => {
        const prev = path[i - 1] || path[i], next = path[i + 1] || path[i];
        // Offset each corner along the bisector so the two edges stay parallel to the road.
        const n1 = [-(y - prev[1]), x - prev[0]], n2 = [-(next[1] - y), next[0] - x];
        const l1 = Math.hypot(...n1) || 1, l2 = Math.hypot(...n2) || 1;
        let nx = (n1[0] / l1 || n2[0] / l2) + (n2[0] / l2 || n1[0] / l1), ny = (n1[1] / l1 || n2[1] / l2) + (n2[1] / l2 || n1[1] / l1);
        const ln = Math.hypot(nx, ny) || 1; nx /= ln; ny /= ln;
        const k = ln > 1.9 ? 1 : Math.SQRT2;
        const p = P(x + nx * w * k * sgn, y + ny * w * k * sgn);
        i ? c.lineTo(...p) : c.moveTo(...p);
      });
      c.stroke();
    }
    c.restore();
  }

  // A wireframe solid: a list of [x, y, z] vertices relative to (cx, cy) and edges between them.
  function wire(c, cx, cy, verts, edges, colour, blur) {
    const pts = verts.map(([x, y, z]) => P(cx + x, cy + y, z));
    glow(c, colour, blur); c.lineWidth = 2;
    c.beginPath();
    for (const [a, b] of edges) { c.moveTo(...pts[a]); c.lineTo(...pts[b]); }
    c.stroke();
    return pts;
  }

  function pylon(c, tw, t, open) {
    const col = COL[tw.type], L = tw.level, rec = H.recoil(tw);
    const ring = (r, z) => { const pts = []; for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2; pts.push(P(tw.x + Math.cos(a) * r, tw.y + Math.sin(a) * r, z)); } c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.stroke(); };
    glow(c, col, 8); c.lineWidth = 1.5;
    ring(0.48, 0);
    let top;
    if (tw.type === 'rapid') {
      const h = 1.0 + L * 0.35, b = 0.32;
      const p = wire(c, tw.x, tw.y, [[-b, -b, 0], [b, -b, 0], [b, b, 0], [-b, b, 0], [0, 0, h + rec * 0.1]], [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]], col, 14);
      top = p[4];
    } else if (tw.type === 'splash') {
      const s = 0.3 + L * 0.04, h = 0.5 + L * 0.18 - rec * 0.12;
      const v = [[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0], [-s, -s, h], [s, -s, h], [s, s, h], [-s, s, h]];
      wire(c, tw.x, tw.y, v, [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]], col, 14);
      glow(c, col, 18); ring(s * 0.9, h + 0.15);
      top = P(tw.x, tw.y, h + 0.15);
    } else {
      const r = 0.3 + L * 0.03, z = 0.9 + L * 0.22 + Math.sin(t * 2 + tw.id) * 0.08, a = t * 1.5 + tw.id;
      const v = [0, 1, 2, 3].map((k) => [Math.cos(a + k * Math.PI / 2) * r, Math.sin(a + k * Math.PI / 2) * r, z]);
      v.push([0, 0, z + r * 1.4], [0, 0, z - r * 1.4]);
      const p = wire(c, tw.x, tw.y, v, [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4], [0, 5], [1, 5], [2, 5], [3, 5]], col, 16);
      glow(c, col, 6); c.lineWidth = 1; c.setLineDash([3, 4]); seg(c, P(tw.x, tw.y, 0), p[5]); c.setLineDash([]);
      top = p[4];
    }
    // Level rings stacked round the base.
    glow(c, '#ffffff', 10); c.lineWidth = 1.2;
    for (let l = 1; l < L; l++) ring(0.5 + l * 0.08, 0.02);
    if (open) { glow(c, '#ffffff', 20); c.lineWidth = 2; ring(0.62 + Math.sin(t * 6) * 0.04, 0); }
    return top;
  }

  function shape(c, e, x, y, s, t) {
    const n = { small: 3, medium: 4, big: 6, boss: 5 }[e.t], r = H.radius(e) * s * 1.4, spin = t * 2 + e.id;
    c.beginPath();
    const k = e.t === 'boss' ? 2 : 1;
    for (let i = 0; i <= n * k; i++) {
      const a = spin + i / (n * k) * Math.PI * 2, rr = e.t === 'boss' && i % 2 ? r * 0.5 : r;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.8;
      i ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.closePath();
  }

  function draw(st) {
    const c = st.ui, g = st.g, t = st.t;
    c.globalCompositeOperation = 'source-over'; c.shadowBlur = 0;
    c.drawImage(sky(st), 0, 0);
    grid(c, t);
    c.globalCompositeOperation = 'lighter';
    road(c);
    portal(st, c);

    // Core at the end of the road.
    const [cx, cy] = P(6, 10.4);
    glow(c, '#3ff8ff', 22); c.lineWidth = 3;
    c.beginPath(); c.ellipse(cx, cy, 46, 14, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.ellipse(cx, cy - 10 - Math.sin(t * 3) * 4, 26, 8, 0, 0, Math.PI * 2); c.stroke();

    g.spots.forEach(([x, y], i) => {
      if (g.towerAt(i)) return;
      const open = st.menu && st.menu.spot === i;
      glow(c, open ? '#ffffff' : 'rgba(255,63,210,.8)', open ? 16 : 6); c.lineWidth = open ? 2 : 1.2;
      H.poly(c, [P(x - 0.42, y - 0.42), P(x + 0.42, y - 0.42), P(x + 0.42, y + 0.42), P(x - 0.42, y + 0.42)]); c.stroke();
      const a = P(x, y); c.beginPath(); c.arc(a[0], a[1], 2, 0, Math.PI * 2); c.fill();
    });
    if (st.model && st.model.tower) {
      const tw = st.model.tower, r = st.model.st.range;
      glow(c, 'rgba(255,255,255,.6)', 6); c.lineWidth = 1; c.setLineDash([6, 6]);
      c.beginPath();
      for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2, p = P(tw.x + Math.cos(a) * r, tw.y + Math.sin(a) * r); i ? c.lineTo(...p) : c.moveTo(...p); }
      c.stroke(); c.setLineDash([]);
    }

    const tops = new Map(), items = [];
    for (const tw of g.towers) items.push({ y: tw.y, f: () => tops.set(tw, pylon(c, tw, t, st.menu && st.menu.spot === tw.spot)) });
    for (const e of g.enemies) items.push({ y: e.y, f: () => {
      const s = FX / depth(e.y), col = e.flash > 0 ? '#ffffff' : e.slow ? '#9fe8ff' : EN[e.t];
      const back = g.path.at(Math.max(0, e.d - 0.6)), [bx, by] = P(back.x, back.y, 0.35), [x, y] = P(e.x, e.y, 0.35 + Math.abs(Math.sin(t * 6 + e.id)) * 0.08);
      const tr = c.createLinearGradient(bx, by, x, y); tr.addColorStop(0, 'rgba(0,0,0,0)'); tr.addColorStop(1, col);
      c.shadowBlur = 0; c.strokeStyle = tr; c.lineWidth = H.radius(e) * s * 0.9; c.lineCap = 'round'; seg(c, [bx, by], [x, y]); c.lineCap = 'butt';
      glow(c, col, 16); c.lineWidth = 2.5; shape(c, e, x, y, s, t); c.stroke();
      c.globalAlpha = 0.25; c.fill(); c.globalAlpha = 1;
      if (e.hp < e.maxHp) { c.shadowBlur = 0; c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(x - 0.4 * s, y - H.radius(e) * s * 1.6 - 6, 0.8 * s, 3); c.fillStyle = col; c.fillRect(x - 0.4 * s, y - H.radius(e) * s * 1.6 - 6, 0.8 * s * e.hp / e.maxHp, 3); }
    } });
    items.sort((p, q) => p.y - q.y).forEach((it) => it.f());

    for (const s of g.shots) {
      const f = H.flight(s), col = COL[s.kind], from = tops.get(s.from) || P(s.sx, s.sy, 1);
      if (s.kind === 'rapid') {
        const p = P(s.x, s.y, 0.35 + (1 - f) * 0.8);
        glow(c, col, 14); c.lineWidth = 3; seg(c, [H.lerp(from[0], p[0], 0.65), H.lerp(from[1], p[1], 0.65)], p);
      } else if (s.kind === 'splash') {
        const p = P(s.x, s.y, 0.4 + (1 - f) * 0.6 + Math.sin(f * Math.PI) * 1.6);
        glow(c, col, 24); c.beginPath(); c.arc(p[0], p[1], 6, 0, Math.PI * 2); c.fill();
      } else {
        const p = P(s.x, s.y, 0.35);
        glow(c, col, 12); c.lineWidth = 1.5; c.setLineDash([4, 3]); seg(c, from, p); c.setLineDash([]);
        c.beginPath(); c.arc(p[0], p[1], 3, 0, Math.PI * 2); c.fill();
      }
    }
    for (const f of g.fx) {
      const k = f.t / f.life, col = f.kind === 'blast' ? '#ffb000' : f.kind === 'chill' ? '#3ff8ff' : '#ffffff';
      glow(c, col, 16); c.globalAlpha = 1 - k; c.lineWidth = 2;
      c.beginPath();
      const r = f.size * (0.4 + k * 1.1);
      for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2, p = P(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 0.05); i ? c.lineTo(...p) : c.moveTo(...p); }
      c.stroke(); c.globalAlpha = 1;
    }

    c.globalCompositeOperation = 'source-over'; c.shadowBlur = 0;
    hud(st, c);
    if (st.model) menu(st, c);
    if (st.toast && t - st.toast.at < 1.5) { c.font = FONT(20); c.textAlign = 'center'; glow(c, '#ff2e63', 12); c.fillText(st.toast.text.toUpperCase(), 480, 250); c.textAlign = 'left'; c.shadowBlur = 0; }
  }

  // The token meter is the portal: its ring lights up as tokens arrive, then it fires a wave.
  function portal(st, c) {
    const g = st.g, fill = g.fill(), [x, y] = P(8, -0.6), [, top] = P(8, -0.6, 2.4);
    const rx = 44, ry = (y - top) / 2, cy = y - ry;
    const fired = st.events.find((e) => e.type === 'wave' && st.t - e.at < 1);
    glow(c, 'rgba(255,63,210,.5)', 6); c.lineWidth = 6;
    c.beginPath(); c.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2); c.stroke();
    glow(c, '#3ff8ff', 18); c.lineWidth = 6;
    c.beginPath(); c.ellipse(x, cy, rx, ry, 0, Math.PI / 2, Math.PI / 2 + Math.PI * 2 * fill); c.stroke();
    const inner = c.createRadialGradient(x, cy, 2, x, cy, rx);
    inner.addColorStop(0, fired ? 'rgba(255,255,255,.9)' : 'rgba(63,248,255,' + (0.1 + fill * 0.4).toFixed(2) + ')'); inner.addColorStop(1, 'rgba(63,248,255,0)');
    c.shadowBlur = 0; c.fillStyle = inner; c.beginPath(); c.ellipse(x, cy, rx - 4, ry - 4, 0, 0, Math.PI * 2); c.fill();
    st.hit(x - rx - 10, cy - ry - 10, rx * 2 + 20, ry * 2 + 20, { act: 'feed' });
  }

  function hud(st, c) {
    const g = st.g;
    c.textBaseline = 'middle';
    c.font = FONT(13, 500); glow(c, '#ff3fd2', 8); c.fillText('WAVE', 24, 26); c.fillText('LEVEL', 120, 26);
    c.font = FONT(30, 900); glow(c, '#ffffff', 14);
    c.fillText(String(g.wave).padStart(2, '0'), 24, 56); c.fillText(String(g.level).padStart(2, '0'), 120, 56);
    c.textAlign = 'right';
    c.font = FONT(13, 500); glow(c, '#3ff8ff', 8); c.fillText('CREDITS', 936, 26); c.fillText('SHIELD', 820, 26);
    c.font = FONT(30, 900); glow(c, '#ffffff', 14); c.fillText(String(g.gold), 936, 56); c.fillText(String(g.lives), 820, 56);
    c.textAlign = 'left'; c.shadowBlur = 0;
    // Token flux bar along the bottom; tapping it feeds the portal too.
    const y = 506, w = 560, x = 200;
    c.fillStyle = 'rgba(13,0,32,.85)'; c.fillRect(0, 488, 960, 52);
    c.font = FONT(12, 500); glow(c, '#3ff8ff', 6); c.fillText('TOKEN FLUX ' + H.fmt(g.meter.tokens) + ' / ' + H.fmt(g.threshold()), 24, y + 6);
    c.textAlign = 'right'; c.fillText(g.meter.queue.length + ' IN THE PORTAL', 936, y + 6); c.textAlign = 'left';
    c.shadowBlur = 0; c.fillStyle = 'rgba(63,248,255,.15)'; c.fillRect(x + 60, y, w - 120, 12);
    glow(c, '#3ff8ff', 14); c.fillRect(x + 60, y, (w - 120) * g.fill(), 12); c.shadowBlur = 0;
    st.hit(x + 60, y - 8, w - 120, 28, { act: 'feed' });
    c.textBaseline = 'alphabetic';
  }

  // A ring split in three round the spot.
  function menu(st, c) {
    const m = st.model, [a, b0] = P(...spots[m.spot]);
    const b = H.clamp(b0, 150, 400), R = 96, r = 46;
    const opts = !m.tower
      ? m.build.map((o) => ({ label: NAMES[o.type], sub: o.cost + ' CR', col: o.afford ? COL[o.type] : '#665577', act: { act: 'build', type: o.type } }))
      : [
        { label: m.upCost == null ? 'MAX' : 'UPGRADE', sub: m.upCost == null ? 'LV 4' : m.upCost + ' CR', col: m.upCost != null && m.afford ? '#7cff6b' : '#665577', act: { act: 'upgrade' } },
        { label: 'SELL', sub: '+' + m.sell + ' CR', col: '#ff2e63', act: { act: 'sell' } },
        { label: 'CLOSE', sub: NAMES[m.tower.type] + ' ' + m.tower.level, col: '#ffffff', act: { act: 'close' } },
      ];
    const cx = H.clamp(a, R + 10, 950 - R);
    c.save();
    c.fillStyle = 'rgba(13,0,32,.72)'; c.beginPath(); c.arc(cx, b, R + 4, 0, Math.PI * 2); c.fill();
    opts.forEach((o, i) => {
      const a0 = -Math.PI / 2 + i * Math.PI * 2 / 3 + 0.06, a1 = a0 + Math.PI * 2 / 3 - 0.12, mid = (a0 + a1) / 2;
      c.beginPath(); c.arc(cx, b, R, a0, a1); c.arc(cx, b, r, a1, a0, true); c.closePath();
      c.fillStyle = 'rgba(255,255,255,.04)'; c.fill();
      glow(c, o.col, 14); c.lineWidth = 2; c.stroke();
      const lx = cx + Math.cos(mid) * (R + r) / 2, ly = b + Math.sin(mid) * (R + r) / 2;
      c.textAlign = 'center'; c.font = FONT(11, 700); c.fillText(o.label, lx, ly - 2);
      c.font = FONT(10, 500); c.shadowBlur = 0; c.fillStyle = '#ffffff'; c.fillText(o.sub, lx, ly + 13);
      st.hit(lx - 32, ly - 26, 64, 52, o.act);
    });
    c.textAlign = 'center'; c.font = FONT(10, 700); glow(c, '#ffffff', 8);
    c.fillText(m.tower ? 'TOWER' : 'BUILD', cx, b + 4);
    c.restore();
  }

  window.VIEWS.push({
    id: 'neon', name: 'Neon Horizon', tag: '3D perspective · synthwave · vector',
    blurb: 'Enemies pour from a portal on the horizon toward you across a glowing grid. Ring menu.',
    low: null,
    map: { path, spots },
    demo: { towers: [[0, 'rapid', 2], [1, 'frost', 2], [3, 'splash', 3], [4, 'rapid', 4], [6, 'splash', 1], [7, 'frost', 1]], menu: 5 },
    spotXY: (i) => P(...spots[i]),
    pickR: 40,
    draw,
  });
})();
