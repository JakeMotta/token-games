// The page: tabs, one running game per view, menus, the fake agent stream and the in-page checks.
// Every view runs the same rules (td.js); a view only decides where things are and how they look.
(function () {
  'use strict';
  const W = 960, HGT = 540;
  const q = new URLSearchParams(location.search);
  const SEED = +q.get('seed') || 7;
  const TEST = q.get('test') === '1';
  const VIEWS = window.VIEWS;
  const $ = (s) => document.querySelector(s);
  if (q.get('theme') === 'light') document.documentElement.dataset.theme = 'light';

  // --- Pictures (data URIs from art.js) --------------------------------------------------
  const pics = {};
  const ready = Promise.all(Object.entries(window.ART || {}).map(([k, src]) => {
    const im = new Image();
    im.src = src;
    return im.decode().then(() => { pics[k] = im; }, () => {});
  }));

  // --- One game per view ---------------------------------------------------------------
  let speed = 1, paused = false, stream = q.get('stream') !== '0';
  let active = null; // a view, or 'all'
  const states = new Map();

  function rnd(st) { st.r = (st.r * 1664525 + 1013904223) >>> 0; return st.r / 4294967296; }

  function makeState(v) {
    const g = TD.createGame({ map: v.map, seed: SEED, mode: 'endless', autoBuild: false });
    g.gold = 1e6;
    for (const [spot, type, level] of v.demo.towers) {
      const t = g.build(spot, type);
      for (let l = 1; l < level; l++) g.upgrade(t);
    }
    g.gold = 120;
    g.xp = TD.xpForLevel(2) + 4; g.level = 2; // so the odd big enemy rolls
    g.demoWave(['small', 'small', 'medium', 'small', 'small', 'small', 'big', 'small', 'medium', 'small', 'small']);
    g.step(TD.HZ * 7);
    g.feed(1700);
    g.takeEvents();

    const el = document.createElement('div');
    el.className = 'stage'; el.dataset.name = v.name; el.hidden = true;
    const lowC = document.createElement('canvas'), uiC = document.createElement('canvas');
    uiC.width = W; uiC.height = HGT;
    if (v.low) { lowC.width = v.low.w; lowC.height = v.low.h; lowC.className = 'px'; el.appendChild(lowC); }
    el.appendChild(uiC);
    $('#main').appendChild(el);

    const st = {
      v, g, el, lowC, uiC, low: v.low ? lowC.getContext('2d') : null, ui: uiC.getContext('2d'),
      t: 0, acc: 0, r: SEED * 977 + v.id.length, nextFeed: 0.6, nextAuto: 3,
      menu: q.get('menu') === 'none' ? null : { spot: v.demo.menu, at: 0 },
      hits: [], events: [], local: {}, toast: null,
    };
    st.img = (name) => pics[v.id + '/' + name] || null;
    st.hit = (x, y, w, h, act) => st.hits.push(Object.assign({ x, y, w, h }, act));
    if (st.low) st.low.imageSmoothingEnabled = false;
    el.addEventListener('pointerdown', (ev) => onPointer(st, ev));
    el.addEventListener('pointermove', (ev) => onHover(st, ev));
    if (v.init) v.init(st);
    states.set(v.id, st);
    return st;
  }
  const stateOf = (v) => states.get(v.id) || makeState(v);

  // What the open menu offers, the same in every view; each view draws it its own way.
  function menuModel(st) {
    const g = st.g;
    if (!st.menu) return null;
    const spot = st.menu.spot, tower = g.towerAt(spot);
    if (!tower) {
      return {
        spot, tower: null,
        build: TD.TOWER_TYPES.map((type) => ({ type, cost: TD.buildCost(type), afford: g.gold >= TD.buildCost(type), st: TD.towerStats(type, 1) })),
      };
    }
    const up = TD.upgradeCost(tower.type, tower.level);
    return {
      spot, tower, st: TD.towerStats(tower.type, tower.level),
      next: up == null ? null : TD.towerStats(tower.type, tower.level + 1),
      upCost: up, afford: up != null && g.gold >= up, sell: TD.sellValue(tower.type, tower.level),
    };
  }

  function act(st, a) {
    const g = st.g, spot = st.menu && st.menu.spot;
    if (a.act === 'build') { if (!g.build(spot, a.type)) toast(st, 'Not enough gold'); }
    else if (a.act === 'upgrade') { const t = g.towerAt(spot); if (t && !g.upgrade(t)) toast(st, t.level >= TD.MAX_LEVEL ? 'Already at the top level' : 'Not enough gold'); }
    else if (a.act === 'sell') { const t = g.towerAt(spot); if (t) g.sell(t); }
    else if (a.act === 'close') st.menu = null;
    else if (a.act === 'feed') { g.feed(3000); toast(st, '+3,000 tokens'); }
    else if (a.act === 'spot') st.menu = st.menu && st.menu.spot === a.spot ? null : { spot: a.spot, at: st.t };
  }
  function toast(st, text) { st.toast = { text, at: st.t }; }

  // Spots are picked the same way everywhere: the nearest spot within reach on screen.
  function pickSpot(st, x, y) {
    let best = -1, bestD = st.v.pickR || 26;
    st.g.spots.forEach((_, i) => {
      const [sx, sy] = st.v.spotXY(i);
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestD) { best = i; bestD = d; }
    });
    return best;
  }
  function toStage(st, ev) {
    const r = st.el.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width * W, (ev.clientY - r.top) / r.height * HGT];
  }
  function hitAt(st, x, y) {
    for (let i = st.hits.length - 1; i >= 0; i--) {
      const h = st.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }
  function click(st, x, y) {
    const h = hitAt(st, x, y);
    if (h) return act(st, h);
    const s = pickSpot(st, x, y);
    if (s >= 0) return act(st, { act: 'spot', spot: s });
    st.menu = null;
  }
  function onPointer(st, ev) {
    if (active === 'all') { show(st.v); return; }
    const [x, y] = toStage(st, ev);
    click(st, x, y);
    draw(st);
  }
  function onHover(st, ev) {
    if (active === 'all') return;
    const [x, y] = toStage(st, ev);
    st.el.style.cursor = hitAt(st, x, y) || pickSpot(st, x, y) >= 0 ? 'pointer' : 'default';
  }

  // --- Running -------------------------------------------------------------------------
  // A fake agent: a request every 1 to 2.4 s, mostly small, now and then a big one.
  function agent(st) {
    const r = rnd(st);
    const n = r < 0.05 ? 20000 : Math.round(Math.exp(Math.log(150) + rnd(st) * Math.log(3500 / 150)));
    st.g.feed(n);
    st.nextFeed = st.t + 1 + rnd(st) * 1.4;
  }
  // A gentle autopilot so the scene grows by itself: raise the lowest tower, or build while
  // at least two spots stay free for you.
  function autopilot(st) {
    const g = st.g;
    st.nextAuto = st.t + 6;
    const low = g.towers.filter((t) => t.level < TD.MAX_LEVEL).sort((a, b) => a.level - b.level)[0];
    if (low && g.canAfford(TD.upgradeCost(low.type, low.level))) return g.upgrade(low);
    const free = g.spots.map((_, i) => i).filter((i) => !g.towerAt(i) && !(st.menu && st.menu.spot === i));
    const type = TD.TOWER_TYPES[g.towers.length % 3];
    if (free.length > 2 && g.canAfford(TD.buildCost(type))) g.build(free[Math.floor(rnd(st) * free.length)], type);
  }

  function advance(st, secs) {
    st.acc += secs;
    while (st.acc >= TD.DT) {
      st.acc -= TD.DT;
      st.t += TD.DT;
      st.g.step(1);
      if (stream && st.t >= st.nextFeed) agent(st);
      if (st.t >= st.nextAuto) autopilot(st);
      for (const e of st.g.takeEvents()) st.events.push(Object.assign(e, { at: st.t }));
    }
    st.events = st.events.filter((e) => st.t - e.at < 4);
  }

  function draw(st) {
    st.hits = [];
    st.model = menuModel(st);
    st.v.draw(st);
  }

  let last = performance.now();
  function frame(now) {
    const secs = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!document.hidden && !paused && !TEST) {
      const list = active === 'all' ? [...states.values()] : active ? [stateOf(active)] : [];
      for (const st of list) { advance(st, secs * speed); draw(st); }
    }
    if (!TEST && q.get('pause') !== '1') requestAnimationFrame(frame);
  }

  // --- Tabs and controls ---------------------------------------------------------------
  function show(v) {
    active = v;
    const all = v === 'all';
    $('#main').classList.toggle('grid', all);
    if (all) VIEWS.forEach(stateOf);
    for (const st of states.values()) st.el.hidden = !(all || st.v === v);
    if (!all) { const st = stateOf(v); st.el.hidden = false; draw(st); }
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === (all ? 'all' : v.id))));
    $('#blurb').textContent = all ? 'All eight running at once. Tap one to open it.' : '';
    fitHead();
    if (!TEST) history.replaceState(null, '', '?' + new URLSearchParams(Object.assign(Object.fromEntries(q), { v: all ? 'all' : v.id })));
  }
  function fitHead() { document.documentElement.style.setProperty('--head', $('header').offsetHeight + 'px'); }

  function buildTabs() {
    const nav = $('#tabs');
    for (const v of VIEWS) {
      const b = document.createElement('button');
      b.className = 'tab'; b.dataset.id = v.id; b.setAttribute('role', 'tab');
      b.innerHTML = '<i></i><b></b><small></small>';
      b.querySelector('i').textContent = v.tag;
      b.querySelector('b').textContent = v.name;
      b.querySelector('small').textContent = v.blurb;
      b.onclick = () => show(v);
      nav.appendChild(b);
    }
    const all = document.createElement('button');
    all.className = 'tab all'; all.dataset.id = 'all'; all.setAttribute('role', 'tab');
    all.innerHTML = '<i>Compare</i><b>All 8</b><small>Side by side</small>';
    all.onclick = () => show('all');
    nav.appendChild(all);
  }
  const current = () => (active && active !== 'all' ? [stateOf(active)] : [...states.values()]);
  function controls() {
    $('#pause').onclick = (e) => { paused = !paused; e.target.setAttribute('aria-pressed', String(paused)); };
    document.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => {
      speed = +b.dataset.speed;
      document.querySelectorAll('[data-speed]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    }));
    $('#feed').onclick = () => current().forEach((st) => st.g.feed(5000));
    $('#burst').onclick = () => current().forEach((st) => st.g.feed(40000));
    $('#stream').setAttribute('aria-pressed', String(stream));
    $('#stream').onclick = (e) => { stream = !stream; e.target.setAttribute('aria-pressed', String(stream)); };
    $('#menu').onclick = () => current().forEach((st) => {
      const free = st.g.spots.findIndex((_, i) => !st.g.towerAt(i));
      st.menu = { spot: free >= 0 ? free : 0, at: st.t };
      draw(st);
    });
    addEventListener('resize', fitHead);
  }

  // --- In-page checks (?test=1) --------------------------------------------------------
  function composite(st) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = HGT;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    if (st.low) c.drawImage(st.lowC, 0, 0, W, HGT);
    c.drawImage(st.uiC, 0, 0);
    return c.getImageData(0, 0, W, HGT).data;
  }
  function thumb(st) {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 36;
    const c = cv.getContext('2d');
    if (st.low) c.drawImage(st.lowC, 0, 0, 64, 36);
    c.drawImage(st.uiC, 0, 0, 64, 36);
    return c.getImageData(0, 0, 64, 36).data;
  }
  function runChecks() {
    const checks = [];
    const check = (name, pass, info) => checks.push({ name, pass: !!pass, info });
    check('at least six views', VIEWS.length >= 6, VIEWS.length);
    check('every tab has a name, a tag and a one-line description', VIEWS.every((v) => v.name && v.tag && v.blurb && v.blurb.length < 140));
    const thumbs = {};
    for (const v of VIEWS) {
      const st = stateOf(v);
      show(v);
      advance(st, 2); draw(st);
      const a = composite(st);
      const colours = new Set();
      for (let i = 0; i < a.length; i += 4 * 97) colours.add(a[i] >> 3 << 10 | a[i + 1] >> 3 << 5 | a[i + 2] >> 3);
      check(v.id + ': renders a full scene', colours.size > 24, colours.size);
      advance(st, 0.6); draw(st);
      const b = composite(st);
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) diff++;
      check(v.id + ': moves between frames', diff / (a.length / 4) > 0.002, +(diff / (a.length / 4)).toFixed(4));
      check(v.id + ': enemies on the path and towers firing', st.g.enemies.length > 0 && st.g.towers.length >= 4 && st.g.towers.some((t) => t.level >= 3), { enemies: st.g.enemies.length, towers: st.g.towers.length });
      const picks = st.g.spots.map((_, i) => pickSpot(st, ...v.spotXY(i)));
      check(v.id + ': every spot can be tapped', picks.every((p, i) => p === i), picks);
      check(v.id + ': spots sit off the path', st.g.spots.every(([x, y]) => H.distToPath(v.map.path, x, y) >= 0.6),
        st.g.spots.map(([x, y]) => +H.distToPath(v.map.path, x, y).toFixed(2)));
      check(v.id + ': bucket can be tapped', st.hits.some((h) => h.act === 'feed'));
      // The menu, driven through what the view drew.
      const free = st.g.spots.findIndex((_, i) => !st.g.towerAt(i));
      st.menu = { spot: free, at: st.t }; st.g.gold = 2000; draw(st);
      const builds = st.hits.filter((h) => h.act === 'build');
      check(v.id + ': build menu offers three towers', new Set(builds.map((h) => h.type)).size === 3, builds.map((h) => h.type));
      const pickBuild = builds.find((h) => h.type === 'splash');
      if (pickBuild) click(st, pickBuild.x + pickBuild.w / 2, pickBuild.y + pickBuild.h / 2);
      draw(st);
      const tw = st.g.towerAt(free);
      const up = st.hits.find((h) => h.act === 'upgrade');
      if (up) click(st, up.x + up.w / 2, up.y + up.h / 2);
      draw(st);
      const levelled = tw && tw.level === 2;
      const sell = st.hits.find((h) => h.act === 'sell');
      if (sell) click(st, sell.x + sell.w / 2, sell.y + sell.h / 2);
      check(v.id + ': build, upgrade and sell from the menu', tw && tw.type === 'splash' && levelled && !st.g.towerAt(free), { built: !!tw, levelled, sold: !st.g.towerAt(free) });
      st.menu = { spot: v.demo.menu, at: st.t }; draw(st);
      thumbs[v.id] = thumb(st);
    }
    // Different views must look different: mean colour distance between small thumbnails.
    const ids = Object.keys(thumbs), pairs = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = thumbs[ids[i]], b = thumbs[ids[j]];
      let s = 0;
      for (let k = 0; k < a.length; k += 4) s += (Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2])) / 3;
      pairs.push({ a: ids[i], b: ids[j], d: Math.round(s / (a.length / 4)) });
    }
    pairs.sort((x, y) => x.d - y.d);
    check('no two views look alike (closest pair)', pairs[0].d >= 30, pairs.slice(0, 3));
    show(VIEWS[0]);
    const res = { pass: checks.every((c) => c.pass), seed: SEED, checks };
    $('#result').textContent = JSON.stringify(res);
  }

  // --- Start ---------------------------------------------------------------------------
  buildTabs();
  controls();
  ready.then(() => {
    const want = q.get('v');
    if (TEST) return runChecks();
    if (q.get('speed')) speed = +q.get('speed') || 1;
    const start = want === 'all' ? 'all' : VIEWS.find((v) => v.id === want) || VIEWS[0];
    show(start);
    const warm = +q.get('warm') || 0;
    if (warm) current().forEach((st) => { advance(st, warm); draw(st); });
    requestAnimationFrame((n) => { last = n; frame(n); });
  });
  window.tdViews = { states, show, menuModel, pickSpot, click };
})();
