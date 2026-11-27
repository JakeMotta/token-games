// Blueprint: the defence as an engineering drawing. Plan view with dimension lines and
// technical symbols, a parts list that is the build menu, and a title block for the HUD.
(function () {
  'use strict';
  const U = 48, OX = 30, OY = 22;
  const scr = (x, y) => [OX + x * U, OY + y * U];
  const path = [[-0.5, 1.5], [3, 1.5], [4, 2.5], [4, 7], [5, 8], [8, 8], [9, 7], [9, 3], [10, 2], [12.5, 2], [13.2, 2.7], [13.2, 8.6]];
  const spots = [[1.5, 3], [2.5, 5.5], [5.4, 3.5], [7.6, 5.2], [6.5, 9.3], [11, 3.6], [11.6, 6], [11.2, 0.6], [2.6, 8.2]];
  const CODE = { rapid: 'RT', splash: 'MX', frost: 'CF' };
  const NAMES = { rapid: 'Rotary turret', splash: 'Mortar, 120 mm', frost: 'Cryo fogger' };
  const C = { bg: '#14467e', bg2: '#103b6b', line: '#e8f1ff', faint: 'rgba(232,241,255,.14)', mid: 'rgba(232,241,255,.5)', hi: '#ffd84a', red: '#ff7a6b' };
  const MONO = (n, w) => (w || 400) + ' ' + n + "px 'IBM Plex Mono', monospace";
  const PX = 706; // the right-hand panel starts here

  function sheet(st) {
    if (st.local.bg) return st.local.bg;
    const cv = document.createElement('canvas');
    cv.width = 960; cv.height = 540;
    const c = cv.getContext('2d');
    c.fillStyle = C.bg; c.fillRect(0, 0, 960, 540);
    c.strokeStyle = C.faint; c.lineWidth = 1;
    for (let x = OX % 12; x < PX; x += 12) { c.globalAlpha = (x - OX) % U === 0 ? 2.2 : 1; c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, 540); c.stroke(); }
    for (let y = OY % 12; y < 540; y += 12) { c.globalAlpha = (y - OY) % U === 0 ? 2.2 : 1; c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(PX, y + 0.5); c.stroke(); }
    c.globalAlpha = 1;
    c.strokeStyle = C.line; c.lineWidth = 2; c.strokeRect(8, 8, 944, 524);
    c.lineWidth = 1; c.strokeRect(12, 12, 936, 516);
    c.fillStyle = C.bg2; c.fillRect(PX, 12, 948 - PX, 516);
    c.beginPath(); c.moveTo(PX + 0.5, 12); c.lineTo(PX + 0.5, 528); c.stroke();
    // Grid references along the frame.
    c.font = MONO(10); c.fillStyle = C.mid; c.textAlign = 'center';
    for (let i = 0; i < 14; i++) c.fillText(String.fromCharCode(65 + i), OX + i * U + U / 2, 20);
    for (let i = 0; i < 10; i++) c.fillText(String(i + 1), 18, OY + i * U + U / 2 + 4);
    c.textAlign = 'left';
    // The road as a centre line with two outline edges, and dimension lines on each straight.
    const pts = path.map(([x, y]) => scr(x, y));
    c.setLineDash([14, 4, 3, 4]); c.strokeStyle = C.mid; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.stroke(); c.setLineDash([]);
    c.strokeStyle = C.line; c.lineWidth = 1.6; c.lineJoin = 'miter';
    for (const sgn of [-1, 1]) {
      c.beginPath();
      path.forEach(([x, y], i) => {
        const prev = path[i - 1] || [x - (path[1][0] - x), y - (path[1][1] - y)], next = path[i + 1] || [2 * x - prev[0], 2 * y - prev[1]];
        const d1 = [x - prev[0], y - prev[1]], d2 = [next[0] - x, next[1] - y];
        const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
        const n1 = [-d1[1] / l1, d1[0] / l1], n2 = [-d2[1] / l2, d2[0] / l2];
        let nx = n1[0] + n2[0], ny = n1[1] + n2[1]; const ln = Math.hypot(nx, ny); nx /= ln; ny /= ln;
        const k = 0.36 / (nx * n1[0] + ny * n1[1]);
        const p = scr(x + nx * k * sgn, y + ny * k * sgn);
        i ? c.lineTo(...p) : c.moveTo(...p);
      });
      c.stroke();
    }
    c.lineWidth = 1; c.font = MONO(10); c.fillStyle = C.line;
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1], [bx, by] = path[i], len = Math.hypot(bx - ax, by - ay);
      if (len < 2.5 || (ax !== bx && ay !== by)) continue;
      const horiz = ay === by, off = horiz ? (ay < 4 ? -0.75 : 0.75) : (ax < 6 ? -0.75 : 0.75);
      const a = scr(ax + (horiz ? 0 : off), ay + (horiz ? off : 0)), b = scr(bx + (horiz ? 0 : off), by + (horiz ? off : 0));
      c.strokeStyle = C.mid; c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke();
      const tick = (p) => { c.beginPath(); c.moveTo(p[0] - 4, p[1] + 4); c.lineTo(p[0] + 4, p[1] - 4); c.stroke(); };
      tick(a); tick(b);
      c.save(); c.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); if (!horiz) c.rotate(-Math.PI / 2);
      c.fillStyle = C.bg; c.fillRect(-22, -7, 44, 13); c.fillStyle = C.line; c.textAlign = 'center'; c.fillText((len * 4).toFixed(1) + ' m', 0, 4);
      c.restore();
    }
    // North arrow and scale bar.
    c.strokeStyle = C.line; c.fillStyle = C.line;
    c.beginPath(); c.moveTo(490, 470); c.lineTo(482, 500); c.lineTo(490, 492); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(490, 470); c.lineTo(498, 500); c.lineTo(490, 492); c.closePath(); c.stroke();
    c.font = MONO(12, 600); c.fillText('N', 486, 464);
    for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? C.bg : C.line; c.fillRect(520 + i * 24, 506, 24, 5); }
    c.strokeRect(520, 506, 96, 5); c.fillStyle = C.line; c.font = MONO(9); c.fillText('0', 517, 522); c.fillText('16 m', 604, 522);
    st.local.bg = cv;
    return cv;
  }

  // Technical symbols. Rotary turret: circle, crosshair and a barrel that tracks.
  function symbol(c, type, level, x, y, aim, rec, s) {
    c.save(); c.translate(x, y); c.scale(s || 1, s || 1);
    c.strokeStyle = C.line; c.lineWidth = 1.6; c.fillStyle = C.bg;
    if (type === 'rapid') {
      c.beginPath(); c.arc(0, 0, 13, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-17, 0); c.lineTo(17, 0); c.moveTo(0, -17); c.lineTo(0, 17); c.lineWidth = 0.8; c.stroke(); c.lineWidth = 1.6;
      c.rotate(aim); c.strokeRect(4 - rec * 3, -2.5, 16, 5);
      if (level >= 3) c.strokeRect(4 - rec * 3, -7, 14, 3);
    } else if (type === 'splash') {
      c.fillRect(-14, -14, 28, 28); c.strokeRect(-14, -14, 28, 28);
      c.beginPath(); c.arc(0, 0, 8 - rec * 2, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(-14, -14); c.lineTo(14, 14); c.moveTo(14, -14); c.lineTo(-14, 14); c.lineWidth = 0.6; c.stroke();
    } else {
      H.poly(c, H.hexPts(0, 0, 15, 0)); c.fill(); c.stroke();
      c.lineWidth = 1; for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3 + aim * 0.2; c.beginPath(); c.moveTo(Math.cos(a) * -9, Math.sin(a) * -9); c.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); c.stroke(); }
    }
    c.restore();
    // Upgrades: one more concentric ring per level.
    c.strokeStyle = C.mid; c.lineWidth = 0.8;
    for (let l = 1; l < level; l++) { c.beginPath(); c.arc(x, y, (19 + l * 4) * (s || 1), 0, Math.PI * 2); c.stroke(); }
  }

  function draw(st) {
    const c = st.ui, g = st.g, t = st.t;
    c.drawImage(sheet(st), 0, 0);
    c.textBaseline = 'middle';

    // Faint range circles for every tower, a solid one for the selected tower.
    for (const tw of g.towers) {
      const [a, b] = scr(tw.x, tw.y), sel = st.menu && st.menu.spot === tw.spot;
      c.strokeStyle = sel ? C.hi : 'rgba(232,241,255,.22)'; c.lineWidth = sel ? 1.4 : 1; c.setLineDash(sel ? [8, 4] : [3, 5]);
      c.beginPath(); c.arc(a, b, TD.towerStats(tw.type, tw.level).range * U, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      if (sel) { c.font = MONO(10); c.fillStyle = C.hi; c.fillText('R ' + (TD.towerStats(tw.type, tw.level).range * 4).toFixed(1) + ' m', a + TD.towerStats(tw.type, tw.level).range * U * 0.72 + 4, b - TD.towerStats(tw.type, tw.level).range * U * 0.72); }
    }
    g.spots.forEach(([x, y], i) => {
      const [a, b] = scr(x, y), open = st.menu && st.menu.spot === i;
      if (!g.towerAt(i)) {
        c.strokeStyle = open ? C.hi : C.mid; c.lineWidth = 1; c.setLineDash([4, 3]); c.strokeRect(a - 16, b - 16, 32, 32); c.setLineDash([]);
        c.beginPath(); c.moveTo(a - 5, b); c.lineTo(a + 5, b); c.moveTo(a, b - 5); c.lineTo(a, b + 5); c.stroke();
      }
      // Reference bubble on a leader line.
      c.strokeStyle = open ? C.hi : C.mid; c.beginPath(); c.moveTo(a + 16, b - 16); c.lineTo(a + 28, b - 28); c.stroke();
      c.beginPath(); c.arc(a + 36, b - 34, 9, 0, Math.PI * 2); c.fillStyle = open ? C.hi : C.bg; c.fill(); c.stroke();
      c.font = MONO(10, 600); c.fillStyle = open ? C.bg : C.line; c.textAlign = 'center'; c.fillText('S' + (i + 1), a + 36, b - 33); c.textAlign = 'left';
    });

    // Base: a hatched square at the end of the road.
    const [ea, eb] = scr(13.2, 9.05);
    c.strokeStyle = C.line; c.lineWidth = 1.6; c.strokeRect(ea - 26, eb - 14, 52, 28);
    c.save(); c.beginPath(); c.rect(ea - 26, eb - 14, 52, 28); c.clip(); c.lineWidth = 0.8;
    for (let k = -60; k < 60; k += 6) { c.beginPath(); c.moveTo(ea + k, eb - 14); c.lineTo(ea + k + 28, eb + 14); c.stroke(); }
    c.restore();
    c.font = MONO(9); c.fillStyle = C.line; c.fillText('KEEP', ea - 64, eb + 2);

    for (const tw of g.towers) {
      const [a, b] = scr(tw.x, tw.y), shot = g.shots.find((s) => s.from === tw);
      const aim = shot ? Math.atan2(shot.ty - tw.y, shot.tx - tw.x) : tw.aim || -0.5;
      symbol(c, tw.type, tw.level, a, b, aim, H.recoil(tw));
      c.font = MONO(10, 600); c.fillStyle = C.line; c.fillText(CODE[tw.type] + '-' + tw.level, a - 15, b + 26);
    }
    for (const e of g.enemies) {
      const [a, b] = scr(e.x, e.y), r = H.radius(e) * U, h = H.heading(g, e), ang = Math.atan2(h.dy, h.dx);
      c.save(); c.translate(a, b); c.rotate(ang);
      c.fillStyle = e.flash > 0 ? C.hi : e.slow ? '#9fd8ff' : C.bg; c.strokeStyle = e.flash > 0 ? C.hi : C.red; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(r, 0); c.lineTo(-r * 0.8, -r * 0.75); c.lineTo(-r * 0.4, 0); c.lineTo(-r * 0.8, r * 0.75); c.closePath(); c.fill(); c.stroke();
      if (e.t === 'big' || e.t === 'boss') { c.beginPath(); c.arc(0, 0, r * 1.2, 0, Math.PI * 2); c.stroke(); }
      c.restore();
      if (e.t !== 'small') { c.font = MONO(9); c.fillStyle = C.red; c.fillText(e.t.toUpperCase(), a + r + 4, b - r - 2); }
      if (e.hp < e.maxHp) { c.strokeStyle = C.red; c.lineWidth = 2; c.beginPath(); c.arc(a, b, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * e.hp / e.maxHp); c.stroke(); }
    }
    for (const s of g.shots) {
      const [a, b] = scr(s.x, s.y), [sa, sb] = scr(s.sx, s.sy);
      c.strokeStyle = s.kind === 'frost' ? '#9fd8ff' : s.kind === 'splash' ? C.hi : C.line; c.lineWidth = 1;
      c.setLineDash([2, 3]); c.beginPath(); c.moveTo(sa, sb); c.lineTo(a, b); c.stroke(); c.setLineDash([]);
      c.fillStyle = c.strokeStyle;
      if (s.kind === 'splash') { c.beginPath(); c.arc(a, b, 4, 0, Math.PI * 2); c.fill(); }
      else c.fillRect(a - 2, b - 2, 4, 4);
    }
    for (const f of g.fx) {
      const k = f.t / f.life, [a, b] = scr(f.x, f.y);
      c.globalAlpha = 1 - k; c.strokeStyle = f.kind === 'blast' ? C.hi : f.kind === 'chill' ? '#9fd8ff' : C.line; c.lineWidth = 1;
      c.setLineDash([3, 3]); c.beginPath(); c.arc(a, b, f.size * U * (0.3 + k), 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      if (f.kind === 'blast') { c.beginPath(); c.moveTo(a - 8, b); c.lineTo(a + 8, b); c.moveTo(a, b - 8); c.lineTo(a, b + 8); c.stroke(); }
      c.globalAlpha = 1;
    }

    parts(st, c);
    tank(st, c);
    titleBlock(st, c);
    if (st.toast && t - st.toast.at < 1.5) {
      c.fillStyle = C.hi; c.fillRect(260, 24, 300, 26); c.fillStyle = C.bg; c.font = MONO(12, 600); c.textAlign = 'center';
      c.fillText('NOTE: ' + st.toast.text.toUpperCase(), 410, 37); c.textAlign = 'left';
    }
    c.textBaseline = 'alphabetic';
  }

  // The parts list: the build menu when a spot is chosen, a spec sheet for a tower.
  function parts(st, c) {
    const m = st.model, x = PX + 12, w = 948 - PX - 24;
    c.font = MONO(11, 600); c.fillStyle = C.line; c.fillText(m && m.tower ? 'SPEC SHEET · S' + (m.spot + 1) : m ? 'PARTS LIST · S' + (m.spot + 1) : 'PARTS LIST', x, 30);
    c.strokeStyle = C.line; c.lineWidth = 1;
    const row = (y, cells, hl, act) => {
      if (hl) { c.fillStyle = 'rgba(255,216,74,.14)'; c.fillRect(x, y, w, 26); }
      c.strokeRect(x + 0.5, y + 0.5, w, 26);
      let cx = x;
      cells.forEach(([text, cw, col]) => { c.fillStyle = col || C.line; c.fillText(text, cx + 6, y + 14); cx += cw; if (cx < x + w) { c.beginPath(); c.moveTo(cx + 0.5, y); c.lineTo(cx + 0.5, y + 26); c.stroke(); } });
      if (act) st.hit(x, y, w, 26, act);
    };
    c.font = MONO(10);
    if (!m || !m.tower) {
      row(42, [['ITEM', 30, C.mid], ['DESCRIPTION', 134, C.mid], ['COST', 60, C.mid]]);
      TD.TOWER_TYPES.forEach((type, i) => {
        const cost = TD.buildCost(type), ok = m && st.g.gold >= cost;
        const y = 68 + i * 54;
        row(y, [[CODE[type], 30, C.hi], [NAMES[type], 134], [cost + ' g', 60, ok ? C.hi : C.mid]], m && ok, null);
        const sts = TD.towerStats(type, 1);
        c.fillStyle = C.mid; c.fillText('dmg ' + sts.dps + '/s · r ' + (sts.range * 4).toFixed(1) + ' m', x + 36, y + 38);
        symbol(c, type, 1, x + w - 18, y + 40, -0.5, 0, 0.55);
        if (m) st.hit(x, y, w, 52, { act: 'build', type });
      });
      c.fillStyle = C.mid; c.fillText(m ? 'SELECT A ROW TO BUILD' : 'SELECT A SPOT  S1–S9', x, 240);
    } else {
      const tw = m.tower;
      row(42, [[CODE[tw.type] + '-' + tw.level, 64, C.hi], [NAMES[tw.type], 160]]);
      const lines = [['DAMAGE / S', m.st.dps, m.next && m.next.dps], ['RANGE, m', (m.st.range * 4).toFixed(1), m.next && (m.next.range * 4).toFixed(1)], ['LEVEL', tw.level, m.next && tw.level + 1]];
      lines.forEach(([k, v, n], i) => row(68 + i * 26, [[k, 110, C.mid], [String(v), 56], [n != null ? '→ ' + n : '—', 60, C.hi]]));
      row(160, [[m.upCost == null ? 'REV. FINAL — NO FURTHER UPGRADES' : 'ISSUE REV. ' + (tw.level + 1) + '  ·  ' + m.upCost + ' g', w, m.afford ? C.hi : C.mid]], m.afford, { act: 'upgrade' });
      row(192, [['DEMOLISH  ·  REFUND ' + m.sell + ' g', w, C.red]], false, { act: 'sell' });
      row(224, [['CLOSE SHEET', w, C.mid]], false, { act: 'close' });
    }
  }

  // Token meter as a section through a tank, with a dimensioned water level.
  function tank(st, c) {
    const g = st.g, fill = g.fill(), x = PX + 30, y = 268, w = 120, h = 120;
    c.font = MONO(11, 600); c.fillStyle = C.line; c.fillText('SECTION A–A · TOKEN TANK', PX + 12, y - 10);
    c.strokeStyle = C.line; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + h); c.lineTo(x + w, y + h); c.lineTo(x + w, y); c.stroke();
    c.save(); c.beginPath(); c.rect(x - 6, y, 6, h); c.rect(x + w, y, 6, h); c.rect(x - 6, y + h, w + 12, 6); c.clip(); c.lineWidth = 0.8;
    for (let k = -20; k < w + 160; k += 5) { c.beginPath(); c.moveTo(x - 6 + k, y + h + 6); c.lineTo(x - 6 + k - 130, y - 4); c.stroke(); }
    c.restore();
    const lv = y + h - h * fill;
    c.fillStyle = 'rgba(159,216,255,.25)'; c.fillRect(x, lv, w, y + h - lv);
    c.strokeStyle = '#9fd8ff'; c.setLineDash([6, 3]); c.beginPath(); c.moveTo(x, lv); c.lineTo(x + w, lv); c.stroke(); c.setLineDash([]);
    c.beginPath(); c.moveTo(x + w / 2 - 6, lv - 8); c.lineTo(x + w / 2 + 6, lv - 8); c.lineTo(x + w / 2, lv); c.closePath(); c.stroke();
    // Dimension from the floor to the water line.
    c.strokeStyle = C.line; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x + w + 22, y + h); c.lineTo(x + w + 22, lv); c.stroke();
    c.beginPath(); c.moveTo(x + w + 18, y + h); c.lineTo(x + w + 26, y + h); c.moveTo(x + w + 18, lv); c.lineTo(x + w + 26, lv); c.stroke();
    c.font = MONO(10); c.fillStyle = C.line;
    c.fillText(H.fmt(g.meter.tokens), x + w + 30, (y + h + lv) / 2);
    c.fillStyle = C.mid; c.fillText('FULL ' + H.fmt(g.threshold()), x + w + 30, y + 4);
    // What is queued: one tick per enemy waiting.
    g.meter.queue.slice(0, 12).forEach((t, i) => { c.fillStyle = C.red; c.fillRect(x + 6 + i * 9, y + h - 10 - (t === 'big' || t === 'boss' ? 6 : 0), 5, t === 'big' || t === 'boss' ? 14 : 8); });
    st.hit(x - 8, y - 4, w + 80, h + 14, { act: 'feed' });
  }

  function titleBlock(st, c) {
    const g = st.g, x = PX, y = 418, w = 948 - PX;
    c.strokeStyle = C.line; c.lineWidth = 1.4; c.strokeRect(x + 0.5, y + 0.5, w - 0.5, 110);
    c.beginPath(); c.moveTo(x, y + 36); c.lineTo(x + w, y + 36); c.moveTo(x, y + 73); c.lineTo(x + w, y + 73); c.moveTo(x + w / 2, y + 36); c.lineTo(x + w / 2, y + 110); c.stroke();
    c.font = MONO(14, 600); c.fillStyle = C.line; c.fillText('TOKEN DEFENCE · DWG 07', x + 10, y + 19);
    const cell = (cx, cy, k, v) => { c.font = MONO(9); c.fillStyle = C.mid; c.fillText(k, cx + 8, cy + 11); c.font = MONO(14, 600); c.fillStyle = C.line; c.fillText(v, cx + 8, cy + 26); };
    cell(x, y + 36, 'WAVE', String(g.wave)); cell(x + w / 2, y + 36, 'LEVEL', String(g.level));
    cell(x, y + 73, 'LIVES', String(g.lives)); cell(x + w / 2, y + 73, 'GOLD', g.gold + ' g');
  }

  window.VIEWS.push({
    id: 'blueprint', name: 'Blueprint', tag: 'Plan view · engineering drawing · vector',
    blurb: 'The defence as a technical drawing: dimension lines, symbols, a parts list for a menu.',
    low: null,
    map: { path, spots },
    demo: { towers: [[0, 'rapid', 2], [2, 'splash', 3], [3, 'frost', 2], [5, 'rapid', 4], [6, 'splash', 1], [8, 'frost', 1]], menu: 1 },
    spotXY: (i) => scr(...spots[i]),
    pickR: 30,
    draw,
  });
})();
