// Ink & Paper: a doodle in a sketchbook. A free-hand curving road, lines that boil like hand-drawn
// animation, black ink with one red accent, and a menu on a taped paper card.
(function () {
  'use strict';
  const U = 54, OX = 24, OY = 26;
  const scr = (x, y) => [OX + x * U, OY + y * U];
  const ctrl = [[-0.5, 2], [3, 1.5], [5.5, 3.5], [4, 6.5], [7, 8.5], [10, 6.5], [9.5, 3], [12.5, 1.8], [15, 4], [13.8, 7.5], [16.5, 8.6]];
  const path = H.spline(ctrl, 0.25);
  const spots = [[1.3, 3.5], [3.2, 4.2], [6.5, 1.5], [7.4, 6.6], [2.4, 6.4], [11.5, 4.5], [12, 8.2], [14.5, 1.2], [16, 6]];
  const NAMES = { rapid: 'pea shooter', splash: 'ink bomb', frost: 'snowflake' };
  const C = { paper: '#f6efdf', rule: 'rgba(80,120,170,.18)', ink: '#1d1c22', soft: 'rgba(29,28,34,.45)', red: '#d23a2a', tape: 'rgba(240,220,120,.55)' };
  const HAND = (n) => '700 ' + n + "px 'Caveat', cursive";

  let boil = 0; // changes four times a second so every line redraws a little differently
  const j = (i, amp) => (H.hash(i * 12.9898 + boil * 78.233) - 0.5) * 2 * amp;

  function line(c, x1, y1, x2, y2, seed, w) {
    c.lineWidth = w || 2.2;
    c.beginPath();
    c.moveTo(x1 + j(seed, 1), y1 + j(seed + 1, 1));
    c.quadraticCurveTo((x1 + x2) / 2 + j(seed + 2, 2), (y1 + y2) / 2 + j(seed + 3, 2), x2 + j(seed + 4, 1), y2 + j(seed + 5, 1));
    c.stroke();
  }
  function circle(c, x, y, r, seed, fill) {
    c.beginPath();
    for (let k = 0; k <= 14; k++) {
      const a = k / 14 * Math.PI * 2 + 0.3, rr = r + j(seed + k, Math.max(0.8, r * 0.06));
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      k ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    if (fill) { c.fillStyle = fill; c.fill(); }
    c.stroke();
  }

  function paper(st) {
    if (st.local.bg) return st.local.bg;
    const cv = document.createElement('canvas');
    cv.width = 960; cv.height = 540;
    const c = cv.getContext('2d');
    c.fillStyle = C.paper; c.fillRect(0, 0, 960, 540);
    for (let i = 0; i < 1600; i++) { c.fillStyle = 'rgba(120,100,60,' + (H.hash(i * 3) * 0.08).toFixed(3) + ')'; c.fillRect(H.hash(i) * 960, H.hash(i + 9) * 540, 1 + H.hash(i * 7) * 2, 1); }
    c.strokeStyle = C.rule; c.lineWidth = 1;
    for (let y = 38; y < 540; y += 30) { c.beginPath(); c.moveTo(0, y); c.lineTo(960, y); c.stroke(); }
    c.strokeStyle = 'rgba(210,58,42,.35)'; c.beginPath(); c.moveTo(70, 0); c.lineTo(70, 540); c.stroke();
    st.local.bg = cv;
    return cv;
  }

  // The road: two wobbly edges plus a few hatch strokes, offset from the centre line.
  function road(c) {
    const pts = path.map(([x, y]) => scr(x, y));
    const side = (sgn) => pts.map(([x, y], i) => {
      const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
      const l = Math.hypot(bx - ax, by - ay) || 1, w = 0.42 * U;
      return [x - (by - ay) / l * w * sgn, y + (bx - ax) / l * w * sgn];
    });
    c.strokeStyle = C.ink;
    for (const sgn of [1, -1]) {
      const s = side(sgn);
      c.lineWidth = 2.4; c.beginPath();
      s.forEach(([x, y], i) => (i ? c.lineTo(x + j(i * sgn, 1.2), y + j(i * sgn + 50, 1.2)) : c.moveTo(x, y)));
      c.stroke();
    }
    const a = side(1), b = side(-1);
    c.strokeStyle = C.soft; c.lineWidth = 1.2;
    for (let i = 2; i < pts.length - 1; i += 3) line(c, a[i][0], a[i][1], H.lerp(b[i][0], a[i][0], 0.55) - 6, H.lerp(b[i][1], a[i][1], 0.55) + 6, i * 7, 1.2);
  }

  // A tower sketch with its feet at (x, y). k scales it (menu icons use a smaller k).
  function tower(c, type, level, x, y, k, seed, aim, rec) {
    c.save(); c.translate(x, y); c.scale(k, k);
    c.strokeStyle = C.ink; c.fillStyle = C.paper;
    const s = seed * 31;
    if (type === 'rapid') {
      const h = 34 + level * 7;
      c.beginPath(); c.rect(-12, -h, 24, h); c.fill();
      line(c, -12, 0, -12, -h, s); line(c, 12, 0, 12, -h, s + 6); line(c, -12, 0, 12, 0, s + 12);
      for (let i = 0; i < 3; i++) line(c, -12 + i * 9, -h, -12 + i * 9 + 6, -h, s + 18 + i, 2);
      line(c, -12, -h, -12, -h - 6, s + 30); line(c, -3, -h, -3, -h - 6, s + 31); line(c, 6, -h, 6, -h - 6, s + 32); line(c, 12, -h, 12, -h - 6, s + 33);
      for (let i = 1; i < level; i++) line(c, -8, -i * 10, 8, -i * 10 - 2, s + 40 + i, 1.2);
      const ax = Math.cos(aim) * 18, ay = Math.sin(aim) * 18;
      c.lineWidth = 3; line(c, 0, -h + 10, ax * (1 - rec * 0.3), -h + 10 + ay * (1 - rec * 0.3), s + 50, 3);
      if (level >= 3) { line(c, 0, -h - 6, 0, -h - 22, s + 60); c.fillStyle = C.red; c.beginPath(); c.moveTo(0, -h - 22); c.lineTo(14, -h - 18); c.lineTo(0, -h - 14); c.fill(); }
    } else if (type === 'splash') {
      const w = 22 + level * 3;
      c.beginPath(); c.rect(-w, -16, w * 2, 12); c.fill();
      line(c, -w, -16, w, -16, s); line(c, -w, -4, w, -4, s + 3); line(c, -w, -16, -w, -4, s + 5); line(c, w, -16, w, -4, s + 7);
      circle(c, -w + 7, -3, 6, s + 9, C.paper); circle(c, w - 7, -3, 6, s + 11, C.paper);
      const arm = -0.9 + rec * 0.8;
      const ex = Math.cos(Math.PI + arm) * (28 + level * 4), ey = Math.sin(Math.PI + arm) * (28 + level * 4);
      c.lineWidth = 3; line(c, 0, -16, -ex, -16 + ey, s + 13, 3);
      circle(c, -ex, -16 + ey - 4, 6, s + 15, level >= 3 ? C.red : C.ink);
      for (let i = 1; i < level; i++) line(c, -w + 4 + i * 8, -14, -w + 8 + i * 8, -6, s + 20 + i, 1.2);
    } else {
      const n = 1 + level;
      for (let i = 0; i < n; i++) {
        const ox = (i - (n - 1) / 2) * 9, h = 22 + (i % 2 ? 8 : 16) + level * 2;
        c.beginPath(); c.moveTo(ox, 0); c.lineTo(ox - 6, -h * 0.6); c.lineTo(ox, -h); c.lineTo(ox + 6, -h * 0.6); c.closePath();
        c.fillStyle = level >= 4 && i === Math.floor(n / 2) ? 'rgba(210,58,42,.25)' : C.paper; c.fill();
        line(c, ox, 0, ox - 6, -h * 0.6, s + i * 5); line(c, ox - 6, -h * 0.6, ox, -h, s + i * 5 + 1);
        line(c, ox, -h, ox + 6, -h * 0.6, s + i * 5 + 2); line(c, ox + 6, -h * 0.6, ox, 0, s + i * 5 + 3);
      }
      const t2 = 1 - rec;
      c.lineWidth = 1.4; for (let a = 0; a < 3; a++) line(c, -8 * t2 + 0, -50 - level * 2, 8 * t2, -50 - level * 2, s + 80 + a, 1.4);
    }
    c.restore();
  }

  function enemy(c, e, x, y, t, flip) {
    const r = H.radius(e) * U, step = Math.sin(t * 12 + e.id) > 0;
    c.save(); c.translate(x, y - r); if (flip) c.scale(-1, 1);
    c.strokeStyle = C.ink;
    line(c, -r * 0.4, r * 0.7, -r * 0.5 + (step ? 4 : -2), r + 4, e.id * 3, 1.8);
    line(c, r * 0.4, r * 0.7, r * 0.5 + (step ? -2 : 4), r + 4, e.id * 3 + 1, 1.8);
    const fill = e.flash > 0 ? C.red : e.slow ? '#dbe9f6' : C.paper;
    if (e.t === 'medium') { c.beginPath(); c.rect(-r, -r, r * 2, r * 2); c.fillStyle = fill; c.fill(); line(c, -r, -r, r, -r, e.id); line(c, r, -r, r, r, e.id + 1); line(c, r, r, -r, r, e.id + 2); line(c, -r, r, -r, -r, e.id + 3); line(c, -r * 0.6, -r, -r * 0.9, -r * 1.5, e.id + 4); line(c, r * 0.6, -r, r * 0.9, -r * 1.5, e.id + 5); }
    else circle(c, 0, 0, r, e.id * 5, fill);
    c.fillStyle = C.ink;
    c.beginPath(); c.arc(r * 0.3, -r * 0.2, Math.max(1.6, r * 0.12), 0, Math.PI * 2); c.arc(r * 0.62, -r * 0.2, Math.max(1.6, r * 0.12), 0, Math.PI * 2); c.fill();
    if (e.t === 'big' || e.t === 'boss') for (let i = 0; i < 4; i++) line(c, r * 0.05 + i * r * 0.18, r * 0.35, r * 0.12 + i * r * 0.18, r * 0.5, e.id * 9 + i, 1.4);
    if (e.t === 'boss') { c.fillStyle = C.red; c.beginPath(); c.moveTo(-r * 0.5, -r * 0.85); c.lineTo(-r * 0.3, -r * 1.35); c.lineTo(0, -r * 0.95); c.lineTo(r * 0.3, -r * 1.35); c.lineTo(r * 0.5, -r * 0.85); c.closePath(); c.fill(); c.stroke(); }
    if (e.slow) { c.strokeStyle = '#3a6ea5'; for (let i = 0; i < 3; i++) line(c, -r - 6, -r * 0.5 + i * r * 0.5, -r - 14, -r * 0.5 + i * r * 0.5, e.id + i, 1); }
    c.restore();
    if (e.hp < e.maxHp) {
      c.strokeStyle = C.ink; c.lineWidth = 1; c.strokeRect(x - 14, y - r * 2 - 12, 28, 5);
      c.fillStyle = C.red; c.fillRect(x - 13, y - r * 2 - 11, 26 * e.hp / e.maxHp, 3);
    }
  }

  function draw(st) {
    const c = st.ui, g = st.g, t = st.t;
    boil = Math.floor(t * 4);
    c.drawImage(paper(st), 0, 0);
    road(c);

    g.spots.forEach(([x, y], i) => {
      if (g.towerAt(i)) return;
      const [a, b] = scr(x, y), open = st.menu && st.menu.spot === i;
      c.strokeStyle = open ? C.red : C.soft; c.setLineDash([5, 5]);
      circle(c, a, b, 20, i * 17); c.setLineDash([]);
      c.fillStyle = open ? C.red : C.soft; c.font = HAND(22); c.textAlign = 'center'; c.fillText('x', a, b + 7); c.textAlign = 'left';
    });
    if (st.model && st.model.tower) {
      const tw = st.model.tower, [a, b] = scr(tw.x, tw.y);
      c.strokeStyle = C.red; c.setLineDash([2, 7]); circle(c, a, b, st.model.st.range * U, tw.id * 3); c.setLineDash([]);
    }
    // Castle doodle at the end.
    const [ca, cb] = scr(15.9, 8.9);
    c.strokeStyle = C.ink;
    c.fillStyle = C.paper; c.fillRect(ca - 30, cb - 50, 60, 50);
    line(c, ca - 30, cb, ca - 30, cb - 50, 901); line(c, ca + 30, cb, ca + 30, cb - 50, 902); line(c, ca - 30, cb - 50, ca + 30, cb - 50, 903);
    for (let i = 0; i < 4; i++) line(c, ca - 30 + i * 18, cb - 50, ca - 30 + i * 18, cb - 60, 910 + i);
    c.beginPath(); c.arc(ca, cb, 11, Math.PI, 0); c.stroke();
    c.fillStyle = C.red; c.beginPath(); c.moveTo(ca, cb - 60); c.lineTo(ca + 16, cb - 66); c.lineTo(ca, cb - 72); c.fill();
    line(c, ca, cb - 50, ca, cb - 74, 920);

    const items = [];
    for (const tw of g.towers) items.push({ y: tw.y, f: () => {
      const [a, b] = scr(tw.x, tw.y), shot = g.shots.find((s) => s.from === tw);
      const aim = shot ? Math.atan2(shot.ty - tw.y, shot.tx - tw.x) : -0.6;
      c.strokeStyle = C.soft; c.lineWidth = 1; line(c, a - 24, b + 2, a + 24, b + 2, tw.id * 7, 1);
      tower(c, tw.type, tw.level, a, b + 4, 1, tw.id, aim, H.recoil(tw));
      c.font = HAND(24); c.fillStyle = tw.level >= 4 ? C.red : C.ink;
      c.fillText(['I', 'II', 'III', 'IV'][tw.level - 1], a + 22, b - 2);
    } });
    for (const e of g.enemies) items.push({ y: e.y, f: () => {
      const [a, b] = scr(e.x, e.y), h = H.heading(g, e);
      enemy(c, e, a, b + 6, t, h.dx < 0);
    } });
    items.sort((p, q) => p.y - q.y).forEach((it) => it.f());

    for (const s of g.shots) {
      const [a, b] = scr(s.x, s.y), f = H.flight(s);
      c.strokeStyle = C.ink; c.fillStyle = C.ink;
      if (s.kind === 'rapid') {
        const ang = Math.atan2(s.ty - s.sy, s.tx - s.sx);
        line(c, a - Math.cos(ang) * 14, b - Math.sin(ang) * 14, a, b, s.t * 100 | 0, 2.4);
        line(c, a - Math.cos(ang) * 26, b - Math.sin(ang) * 26 + 3, a - Math.cos(ang) * 18, b - Math.sin(ang) * 18 + 3, 7, 1);
      } else if (s.kind === 'splash') {
        const lift = Math.sin(f * Math.PI) * 50;
        c.setLineDash([2, 6]); c.lineWidth = 1; c.beginPath(); c.moveTo(...scr(s.sx, s.sy)); c.quadraticCurveTo(a, b - lift * 1.4, a, b - lift); c.stroke(); c.setLineDash([]);
        circle(c, a, b - lift, 6, 3, C.ink);
      } else {
        c.lineWidth = 2; for (let i = 0; i < 3; i++) { const an = i * Math.PI / 3 + t * 3; line(c, a - Math.cos(an) * 7, b - Math.sin(an) * 7, a + Math.cos(an) * 7, b + Math.sin(an) * 7, i, 2); }
      }
    }
    for (const f of g.fx) {
      const k = f.t / f.life, [a, b] = scr(f.x, f.y);
      c.save(); c.globalAlpha = 1 - k * 0.7;
      if (f.kind === 'blast') {
        c.strokeStyle = C.red;
        for (let i = 0; i < 10; i++) { const an = i / 10 * Math.PI * 2, r1 = f.size * U * (0.3 + k * 0.4), r2 = f.size * U * (0.6 + k * 0.6); line(c, a + Math.cos(an) * r1, b + Math.sin(an) * r1, a + Math.cos(an) * r2, b + Math.sin(an) * r2, i + 300, 2.4); }
        c.font = HAND(34); c.fillStyle = C.red; c.textAlign = 'center'; c.fillText(['BOOM', 'POW', 'KA-BLAM'][Math.floor(f.x * 7) % 3], a, b - 30 - k * 14); c.textAlign = 'left';
      } else if (f.kind === 'chill') {
        c.strokeStyle = '#3a6ea5'; circle(c, a, b, 8 + k * 16, 5);
      } else {
        c.strokeStyle = C.ink; for (let i = 0; i < 6; i++) { const an = i / 6 * Math.PI * 2 + 0.4, r = 8 + k * 18; line(c, a + Math.cos(an) * r * 0.5, b + Math.sin(an) * r * 0.5, a + Math.cos(an) * r, b + Math.sin(an) * r, i + 500, 1.6); }
      }
      c.restore();
    }

    bucket(st, c);
    hud(st, c);
    if (st.model) menu(st, c);
    if (st.toast && t - st.toast.at < 1.5) { c.font = HAND(34); c.fillStyle = C.red; c.textAlign = 'center'; c.fillText(st.toast.text + '!', 480, 40); c.textAlign = 'left'; }
  }

  // A sketched bucket with hatching for the water level and tally marks for queued enemies.
  function bucket(st, c) {
    const g = st.g, fill = g.fill(), x = 96, y = 520, w = 92, h = 92;
    const tip = st.events.find((e) => e.type === 'wave' && st.t - e.at < 1);
    c.save(); c.translate(x, y); if (tip) c.rotate(-0.25 * Math.sin((st.t - tip.at) * Math.PI));
    c.strokeStyle = C.ink;
    c.save(); c.beginPath(); c.moveTo(-w / 2, -h); c.lineTo(w / 2, -h); c.lineTo(w / 2 - 12, 0); c.lineTo(-w / 2 + 12, 0); c.closePath(); c.fillStyle = C.paper; c.fill(); c.clip();
    c.strokeStyle = '#3a6ea5'; c.lineWidth = 1.5;
    const top = -h * fill;
    for (let k = -w; k < w; k += 7) line(c, k, 0, k + 26, top, k + 700, 1.4);
    line(c, -w / 2, top, w / 2, top, 760, 2);
    c.restore();
    c.strokeStyle = C.ink;
    line(c, -w / 2, -h, -w / 2 + 12, 0, 771); line(c, w / 2, -h, w / 2 - 12, 0, 772); line(c, -w / 2 + 12, 0, w / 2 - 12, 0, 773);
    c.beginPath(); c.ellipse(0, -h, w / 2, 8, 0, 0, Math.PI * 2); c.lineWidth = 2.2; c.stroke();
    c.beginPath(); c.arc(0, -h, w / 2 + 2, Math.PI * 1.08, Math.PI * 1.92); c.stroke();
    c.restore();
    c.font = HAND(24); c.fillStyle = C.ink;
    c.fillText(H.fmt(g.meter.tokens) + ' / ' + H.fmt(g.threshold()) + ' tokens', x + 56, y - 60);
    const n = g.meter.queue.length;
    c.strokeStyle = C.ink;
    for (let i = 0; i < n; i++) {
      const grp = Math.floor(i / 5), k = i % 5, bx = x + 58 + grp * 34;
      if (k < 4) line(c, bx + k * 6, y - 44, bx + k * 6 + 1, y - 22, i + 800, 1.8);
      else line(c, bx - 3, y - 28, bx + 22, y - 40, i + 800, 1.8);
    }
    c.font = HAND(20); c.fillStyle = C.soft; c.fillText(n ? 'waiting in the bucket' : 'bucket is filling…', x + 56, y - 4);
    st.hit(x - w / 2 - 10, y - h - 30, w + 20, h + 34, { act: 'feed' });
  }

  function hud(st, c) {
    const g = st.g;
    c.font = HAND(32); c.fillStyle = C.ink;
    const text = 'wave ' + g.wave + '   lvl ' + g.level + '   ♥ ' + g.lives + '   gold ' + g.gold;
    c.fillText(text, 88, 46);
    c.strokeStyle = C.red; line(c, 88, 56, 88 + c.measureText(text).width, 54, 990, 2);
  }

  function menu(st, c) {
    const m = st.model, [a, b] = scr(...spots[m.spot]);
    const w = 250, h = m.tower ? 190 : 214;
    let x = a + 40, y = b - h / 2;
    if (x + w > 950) x = a - 40 - w;
    y = H.clamp(y, 70, 530 - h);
    c.save();
    c.translate(x + w / 2, y + h / 2); c.rotate(-0.02); c.translate(-x - w / 2, -y - h / 2);
    c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(x + 5, y + 7, w, h);
    c.fillStyle = '#fffdf6'; c.fillRect(x, y, w, h);
    c.strokeStyle = C.ink; c.lineWidth = 1.2; c.strokeRect(x, y, w, h);
    c.fillStyle = C.tape; c.fillRect(x - 14, y - 8, 56, 20); c.fillRect(x + w - 42, y - 8, 56, 20);
    c.textBaseline = 'middle';
    if (!m.tower) {
      c.font = HAND(28); c.fillStyle = C.red; c.fillText('build here?', x + 18, y + 26);
      m.build.forEach((o, i) => {
        const ry = y + 52 + i * 52;
        tower(c, o.type, 1, x + 34, ry + 44, 0.62, 40 + i, -0.6, 0);
        c.font = HAND(26); c.fillStyle = o.afford ? C.ink : C.soft; c.fillText(NAMES[o.type], x + 66, ry + 24);
        c.strokeStyle = o.afford ? C.red : C.soft; circle(c, x + w - 38, ry + 24, 20, i * 9);
        c.font = HAND(22); c.fillStyle = o.afford ? C.red : C.soft; c.textAlign = 'center'; c.fillText(o.cost + 'g', x + w - 38, ry + 25); c.textAlign = 'left';
        if (i) { c.strokeStyle = C.soft; line(c, x + 14, ry, x + w - 14, ry, i * 3 + 200, 1); }
        st.hit(x, ry, w, 52, { act: 'build', type: o.type });
      });
    } else {
      const tw = m.tower;
      c.font = HAND(30); c.fillStyle = C.ink; c.fillText(NAMES[tw.type] + ' ' + ['I', 'II', 'III', 'IV'][tw.level - 1], x + 18, y + 28);
      c.font = HAND(22); c.fillStyle = C.soft; c.fillText(m.st.dps + ' dmg a sec · reach ' + m.st.range, x + 18, y + 58);
      c.strokeStyle = C.ink; c.font = HAND(28);
      c.fillStyle = m.upCost == null || !m.afford ? C.soft : C.ink;
      line(c, x + 18, y + 84, x + w - 18, y + 84, 401); line(c, x + 18, y + 124, x + w - 18, y + 124, 402); line(c, x + 18, y + 84, x + 18, y + 124, 403); line(c, x + w - 18, y + 84, x + w - 18, y + 124, 404);
      c.fillText(m.upCost == null ? 'all done!' : 'make it bigger · ' + m.upCost + 'g', x + 30, y + 105);
      st.hit(x + 18, y + 84, w - 36, 40, { act: 'upgrade' });
      c.fillStyle = C.red; c.fillText('rub it out · +' + m.sell + 'g', x + 30, y + 156);
      line(c, x + 26, y + 170, x + 190, y + 168, 405, 1.4);
      st.hit(x + 18, y + 136, w - 36, 40, { act: 'sell' });
    }
    c.restore();
    c.textBaseline = 'alphabetic';
  }

  window.VIEWS.push({
    id: 'ink', name: 'Ink & Paper', tag: 'Line art · free-form path · vector',
    blurb: 'A living sketchbook doodle: wobbly hand-drawn lines, a curvy road, a taped paper menu.',
    low: null,
    map: { path, spots },
    demo: { towers: [[0, 'rapid', 2], [3, 'splash', 3], [5, 'frost', 2], [6, 'rapid', 4], [2, 'splash', 1], [7, 'frost', 1]], menu: 1 },
    spotXY: (i) => scr(...spots[i]),
    pickR: 40,
    draw,
  });
})();
