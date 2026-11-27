/* Creature Hatchery: the page. Eggs, hatching, the temperament slider, a level preview, gene sliders, the genome as a
   list of numbers, breeding, and a collection. Rendering and motion live in render.js and motion.js.
   URL: ?seed=<s> starts from that egg; &level=<1-100> &temperament=<-1..1> &hatched=1 show the creature; &pause=1 holds
   still (for screenshots); &view=inside|flat|pieces; &back=night|paper|peach|clear; &test=1 runs the self-checks. */
(function () {
  'use strict';
  const G = window.CreatureGenome, R = window.CreatureRender, M = window.CreatureMotion;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const TEST = params.get('test') === '1';
  const PAUSE = params.get('pause') === '1' || TEST;
  const reducedMotion = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();

  const STAGE_W = 240, STAGE_H = 140, GROUND = 118;      // stage grid (logical pixels) and the ground row
  const SPRITE_W = 150, SPRITE_H = 120, SPRITE_GROUND = 100;
  const SPRITE_FPS = 12;                                   // the video's creatures animate on a slow pixel-art clock
  const HATCH = { wobble: 1.2, crack: [0.5, 1.7], open: [1.7, 2.3], baby: 2.1, fade: [2.4, 3.2] };
  const GALLERY_KEY = 'creature-hatchery-v1', GALLERY_MAX = 40;
  const BACKS = { night: [42, 38, 56], paper: [240, 232, 216], peach: [251, 214, 190], clear: null };
  const FACES = ['neutral', 'happy', 'angry', 'sleepy', 'surprised'];
  const VIEWS = [['gochi', 'Finished'], ['pieces', 'Melted pieces'], ['flat', 'One colour'], ['inside', 'Inside?']];
  // Gene sliders: [label, gene or special, kind]. Specials scale whole pieces.
  const SLIDERS = [
    ['Body size', '*body'], ['Head size', '*head'], ['Head length', 'head.length'], ['Neck', 'neck.length'], ['Tail', 'tail.length'],
    ['Leg pairs', 'legs.pairs'], ['Leg length', 'legs.length'], ['Eyes', 'eyes.size'], ['Horns', 'horns.count'], ['Horn length', 'horns.length'],
    ['Wings', 'wings.size'], ['Ears', 'ears.kind'], ['Decor', 'decor.kind'], ['Colour', 'colour.hue'], ['Saturation', 'colour.sat'],
    ['Pattern', 'pattern.kind'], ['Pattern amount', 'pattern.amount'], ['Melt (fluff)', 'fluff'], ['Gloss', 'gloss'],
  ];
  const INTEGER_GENES = new Set(['legs.pairs', 'horns.count', 'ears.kind', 'decor.kind', 'pattern.kind', 'wings.fingers']);

  const S = {
    creature: null, overrides: {}, special: { body: 1, head: 1 }, temperament: 0, level: 1, expression: 'neutral',
    repair: true, view: params.get('view') || 'gochi', walk: !PAUSE, back: params.get('back') || 'night',
    phase: 'egg', hatchT: 0, gallery: [], picks: [], current: -1, reveal: null, cam: null, ph: null, walker: null,
  };

  // ---------- storage (per-viewer convenience only; the page works without it) ----------
  function loadGallery() {
    if (TEST) return [];
    try { const v = JSON.parse(localStorage.getItem(GALLERY_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function saveGallery() {
    if (TEST) return;
    try { localStorage.setItem(GALLERY_KEY, JSON.stringify(S.gallery.slice(-GALLERY_MAX))); } catch (e) { /* storage off */ }
  }

  // ---------- the creature as shown ----------
  function overridesFor(c) {
    const g = G.genotype(c), o = Object.assign({}, S.overrides);
    for (const [piece, f] of [['torso', S.special.body], ['head', S.special.head]]) {
      if (f === 1) continue;
      for (let i = 0; i < G.RINGS[piece]; i++) for (const k of ['width', 'height']) {
        const n = piece + '.rings[' + i + '].' + k;
        o[n] = (o[n] != null ? o[n] : g[n]) * f;
      }
    }
    return o;
  }
  function phenotypeAt(level) {
    return G.express(S.creature, { overrides: overridesFor(S.creature), temperament: S.temperament, level, repair: S.repair, expression: S.expression });
  }
  // Re-derive the body numbers and the camera. The camera is framed on the adult so growing shows as getting bigger.
  function refresh() {
    S.ph = phenotypeAt(S.level);
    const adult = R.creatureScene(phenotypeAt(G.LEVEL_MAX), {});
    const fit = R.frameCamera(adult, SPRITE_W, SPRITE_H, { fit: true });
    const egg = R.eggScene(G.eggLook(S.creature), {});
    const px = Math.max(fit.px, 0.0125);
    S.cam = R.frameCamera(adult, SPRITE_W, SPRITE_H, { px, groundRow: SPRITE_GROUND });
    // Keep the camera's horizontal centre on the body origin so walking doesn't jitter.
    S.eggCam = R.frameCamera(egg, SPRITE_W, SPRITE_H, { px, groundRow: SPRITE_GROUND });
    const x0 = S.walker ? S.walker.x : 0, dir = S.walker ? S.walker.dir : 1;
    S.walker = M.createWalker(S.ph, G.hashSeed(String(S.creature.seed)), { x: x0 });
    S.walker.dir = dir;
    S.lastFrame = 0;
    S.dirty = true;
    updatePanels();
  }

  function setCreature(c, opts) {
    opts = opts || {};
    S.creature = c;
    S.overrides = opts.overrides || {};
    S.special = Object.assign({ body: 1, head: 1 }, opts.special || {});
    S.temperament = opts.temperament != null ? opts.temperament : G.genotype(c).temperament;
    S.level = opts.level || 1;
    S.phase = opts.phase || 'egg';
    S.hatchT = 0;
    S.walker = null;
    $('seed').value = c.parents ? '' : String(c.seed);
    $('temper').value = S.temperament;
    $('level').value = S.level;
    buildGeneSliders();
    refresh();
  }

  // ---------- eggs, hatching, collection ----------
  function newEgg(seed) {
    if (seed == null || seed === '') seed = Math.floor(Math.random() * 1e9).toString(36);
    S.current = -1;
    setCreature(G.randomCreature(seed), { phase: 'egg' });
  }
  function hatch() {
    if (S.phase !== 'egg') return;
    S.phase = 'hatching'; S.hatchT = 0;
    if (PAUSE || reducedMotion) finishHatch();
  }
  function finishHatch() {
    S.phase = 'creature'; S.level = 1; $('level').value = 1;
    S.gallery.push(entryOf());
    S.current = S.gallery.length - 1;
    saveGallery();
    refresh(); renderGallery();
    if (S.walker) S.walker.hopV = 0.8 * S.ph.scale;
  }
  function entryOf() {
    return { creature: S.creature, overrides: S.overrides, special: S.special, temperament: S.temperament, level: S.level };
  }
  function syncEntry() {
    if (S.current < 0 || !S.gallery[S.current]) return;
    S.gallery[S.current] = entryOf();
    saveGallery();
    renderGallery();
  }
  function breedPicks() {
    if (S.picks.length !== 2) return;
    const [a, b] = S.picks.map((i) => S.gallery[i].creature);
    const child = G.breed(a, b, Math.floor(Math.random() * 1e9).toString(36));
    S.picks = []; S.current = -1;
    setCreature(child, { phase: 'egg' });
    renderGallery();
  }

  // ---------- drawing ----------
  const stage = $('stage'), sctx = stage.getContext('2d');
  sctx.imageSmoothingEnabled = false;
  const sprite = document.createElement('canvas'); sprite.width = SPRITE_W; sprite.height = SPRITE_H;
  const spctx = sprite.getContext('2d');

  function drawBackdrop() {
    const b = BACKS[S.back];
    if (!b) { // a checkerboard shows the sprite really is see-through
      for (let y = 0; y < STAGE_H; y += 8) for (let x = 0; x < STAGE_W; x += 8) {
        sctx.fillStyle = ((x + y) / 8) % 2 ? '#d9d4de' : '#f2eef5'; sctx.fillRect(x, y, 8, 8);
      }
      return;
    }
    sctx.fillStyle = 'rgb(' + b.join(',') + ')'; sctx.fillRect(0, 0, STAGE_W, STAGE_H);
    // A faint floor band, like the video's flat colour cards
    sctx.fillStyle = 'rgba(0,0,0,0.06)'; sctx.fillRect(0, GROUND - 4, STAGE_W, STAGE_H - GROUND + 4);
  }
  function putSprite(res, worldX, dir, alpha) {
    const img = spctx.createImageData(res.w, res.h);
    const rows = S.reveal != null ? Math.floor(S.reveal) : res.h;
    if (rows >= res.h) img.data.set(res.rgba);
    else img.data.set(res.rgba.subarray(0, rows * res.w * 4));
    spctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
    spctx.putImageData(img, 0, 0);
    if (S.reveal != null && rows < res.h) { spctx.fillStyle = '#f6d34a'; spctx.fillRect(0, rows, res.w, 1); }
    const cam = R.camera(res.cam), o = R.project(cam, [0, 0, 0]);
    const sx = Math.round(STAGE_W / 2 + worldX / res.cam.px), sy = GROUND - Math.round(o.y);
    sctx.save();
    sctx.globalAlpha = alpha == null ? 1 : alpha;
    if (dir < 0) { sctx.translate(sx + Math.round(o.x), sy); sctx.scale(-1, 1); sctx.drawImage(sprite, 0, 0); }
    else sctx.drawImage(sprite, sx - Math.round(o.x), sy);
    sctx.restore();
  }
  function renderCreature(pose) {
    const sc = R.creatureScene(S.ph, pose);
    return R.render(sc, S.cam, { style: S.view });
  }
  function renderEgg(pose) {
    return R.render(R.eggScene(G.eggLook(S.creature), pose), S.eggCam, { style: S.view === 'gochi' ? 'gochi' : S.view });
  }

  function frame(dt) {
    drawBackdrop();
    const half = (STAGE_W / 2 - 34) * S.cam.px;
    if (S.phase === 'egg') {
      const t = performance.now() / 1000;
      const wob = PAUSE ? 0 : Math.sin(t * 2.2) * 0.05 * (Math.sin(t * 0.7) > 0.6 ? 1 : 0.25);
      putSprite(renderEgg({ wobble: wob }), 0, 1);
      return;
    }
    if (S.phase === 'hatching') {
      S.hatchT += dt;
      const T = S.hatchT, ramp = (a, b) => Math.max(0, Math.min(1, (T - a) / (b - a)));
      const wob = Math.sin(T * 18) * 0.12 * Math.min(1, T / HATCH.wobble) * (1 - ramp(HATCH.open[0], HATCH.open[1]));
      const eggPose = { wobble: wob, crack: ramp(HATCH.crack[0], HATCH.crack[1]), open: ramp(HATCH.open[0], HATCH.open[1]) };
      const fade = 1 - ramp(HATCH.fade[0], HATCH.fade[1]);
      if (T < HATCH.baby) putSprite(renderEgg(eggPose), 0, 1);
      else {
        putSprite(renderEgg(eggPose), -0.12, 1, fade);
        const st = M.step(S.walker, dt, -half, half, { walk: false, hop: T - dt < HATCH.baby });
        putSprite(renderCreature(st.pose), st.x, st.dir);
      }
      if (T >= HATCH.fade[1]) finishHatch();
      return;
    }
    const st = M.step(S.walker, PAUSE ? 0 : dt, -half, half, { walk: S.walk && !PAUSE, reduced: reducedMotion || PAUSE });
    const pose = PAUSE ? Object.assign({}, st.pose, { breathe: 0, blink: 0, tailSway: 0, lookYaw: 0, wingFlap: 0 }) : st.pose;
    putSprite(renderCreature(pose), st.x, st.dir);
  }

  let last = 0, acc = 0;
  function loop(now) {
    const dt = last ? (now - last) / 1000 : 0;
    last = now; acc += dt;
    if (S.reveal != null) { S.reveal += dt * SPRITE_H / 1.6; if (S.reveal >= SPRITE_H) S.reveal = null; }
    const animating = !PAUSE && (S.phase !== 'creature' || S.walk || reducedMotion === false) || S.reveal != null;
    if ((animating && acc >= 1 / SPRITE_FPS) || S.dirty) {
      frame(Math.min(0.25, acc));
      acc = 0; S.dirty = false;
    }
    requestAnimationFrame(loop);
  }

  // ---------- panels ----------
  function updatePanels() {
    const c = S.creature, tr = G.traits(c);
    const stg = G.stageOf(S.level);
    $('name').textContent = S.phase === 'egg' ? 'Egg' : c.name;
    $('stageName').textContent = S.phase === 'egg' ? (c.parents ? 'from ' + c.parents.join(' × ') : 'seed ' + c.seed) : 'Lv ' + S.level + ' · ' + stg;
    $('rarity').textContent = S.phase === 'egg' ? '?' : tr.rarity;
    $('tval').textContent = (S.temperament >= 0 ? '+' : '') + S.temperament.toFixed(2);
    $('lval').textContent = S.level + ' · ' + stg;
    const next = S.level < G.LEVEL_MAX ? G.tokensForLevelUp(S.level) : 0;
    $('tokens').textContent = 'Hatching takes ' + fmt(G.HATCH_TOKENS) + ' tokens of Claude use. ' + (next
      ? 'Level ' + S.level + '→' + (S.level + 1) + ' needs ' + fmt(next) + '; level ' + S.level + ' is ' + fmt(G.tokensToReach(S.level)) + ' in, level 100 is ' + fmt(G.tokensToReach(G.LEVEL_MAX)) + '.'
      : 'Fully grown after ' + fmt(G.tokensToReach(G.LEVEL_MAX)) + ' tokens.');
    $('hatch').disabled = S.phase !== 'egg';
    // About tab
    $('aboutName').textContent = c.name + (S.phase === 'egg' ? ' (still an egg)' : '');
    $('traits').innerHTML = '';
    const tags = [tr.rarity].concat(tr.traits);
    tags.forEach((t, i) => { const s = document.createElement('span'); s.textContent = t; if (i === 0 && t !== 'common') s.className = 'rare'; $('traits').appendChild(s); });
    const lift = M.wingLift(S.ph);
    $('flight').textContent = S.ph.wings.size <= 0 ? 'No wings.' : M.canFly(S.ph) ? 'Wings big enough to fly (lift ' + lift.toFixed(2) + ').' :
      'Wings too small to lift this body (lift ' + lift.toFixed(2) + ' of ' + M.FLY_RATIO + '). It tries anyway.';
    $('repairs').textContent = S.ph.repairs.length ? 'Repair pass: ' + S.ph.repairs.join('; ') : S.repair ? 'Repair pass: nothing to fix.' : 'Repair pass is off.';
    $('lineage').textContent = c.parents ? 'Generation ' + c.generation + ', parents ' + c.parents.join(' and ') + '.' : 'Wild egg, seed "' + c.seed + '". Same seed, same creature.';
    $('edited').textContent = Object.keys(S.overrides).length || S.special.body !== 1 || S.special.head !== 1 ? 'Edited: no longer the plain seed.' : '';
    renderNumbers();
    for (const b of $('faces').children) b.classList.toggle('on', b.dataset.v === S.expression);
    for (const b of $('views').children) b.classList.toggle('on', b.dataset.v === S.view);
    for (const b of $('backs').children) b.classList.toggle('on', b.dataset.v === S.back);
    $('walk').classList.toggle('on', S.walk); $('repair').classList.toggle('on', S.repair);
  }
  function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n); }

  // The video's step 1: a creature is a list of numbers, alphabetical.
  function renderNumbers() {
    const c = S.creature, g = Object.assign(G.genotype(c), overridesFor(c));
    const lines = ['<span class="a">generation = ' + c.generation + '</span>'];
    const names = G.GENE_NAMES.filter((n) => !n.endsWith('.dom')).concat(['temperament']).filter((n, i, a) => a.indexOf(n) === i).sort();
    for (const n of names) {
      const val = n === 'temperament' ? S.temperament : g[n];
      const edited = n === 'temperament' ? Math.abs(S.temperament - G.genotype(c).temperament) > 1e-9 : n in overridesFor(c);
      const cls = edited ? 'e' : G.expressedCopyIndex(c, G.PIECE[n]) ? 'b' : 'a';
      lines.push('<span class="' + cls + '">' + n + ' = ' + (Math.round(val * 100) / 100) + '</span>');
    }
    $('numbers').innerHTML = lines.join('\n');
  }

  function buildGeneSliders() {
    const box = $('genes'); box.innerHTML = '';
    const g = G.genotype(S.creature);
    for (const [label, gene] of SLIDERS) {
      const special = gene[0] === '*';
      const [min, max] = special ? [0.6, 1.6] : G.GENES[gene];
      const int = INTEGER_GENES.has(gene);
      const val = special ? S.special[gene.slice(1)] : (S.overrides[gene] != null ? S.overrides[gene] : g[gene]);
      const lab = document.createElement('label'); lab.textContent = label;
      const inp = document.createElement('input');
      Object.assign(inp, { type: 'range', min: int ? 0 : min, max: int ? Math.floor(max) : max, step: int ? 1 : (max - min) / 200, value: int ? Math.round(val) : val });
      inp.setAttribute('aria-label', label);
      inp.dataset.gene = gene;
      const out = document.createElement('output'); out.textContent = show(gene, val);
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        if (special) S.special[gene.slice(1)] = v; else S.overrides[gene] = v;
        out.textContent = show(gene, v);
        refresh(); syncEntry();
      });
      box.append(lab, inp, out);
    }
  }
  function show(gene, v) {
    if (gene === 'ears.kind') return G.EAR_KINDS[Math.round(v)];
    if (gene === 'decor.kind') return G.DECOR_KINDS[Math.round(v)];
    if (gene === 'pattern.kind') return G.PATTERN_KINDS[Math.round(v)];
    if (gene === 'colour.hue') return Math.round(v) + '°';
    if (INTEGER_GENES.has(gene)) return String(Math.round(v));
    return (+v).toFixed(2);
  }

  const thumbCache = new Map();
  function thumb(entry) {
    const key = JSON.stringify([entry.creature.seed, entry.creature.parents, entry.overrides, entry.special, entry.temperament, entry.level]);
    if (thumbCache.has(key)) return thumbCache.get(key);
    const saved = { creature: S.creature, overrides: S.overrides, special: S.special, temperament: S.temperament };
    Object.assign(S, { creature: entry.creature, overrides: entry.overrides || {}, special: entry.special || { body: 1, head: 1 }, temperament: entry.temperament });
    const ph = phenotypeAt(entry.level || 1);
    Object.assign(S, saved);
    const sc = R.creatureScene(ph, {});
    const res = R.render(sc, R.frameCamera(sc, 44, 44, { fit: true }), {});
    thumbCache.set(key, res);
    return res;
  }
  function renderGallery() {
    const box = $('gallery'); box.innerHTML = '';
    if (!S.gallery.length) { box.innerHTML = '<div class="empty">Nothing hatched yet. Make an egg and hatch it.</div>'; }
    S.gallery.forEach((e, i) => {
      const card = document.createElement('div'); card.className = 'cardc' + (i === S.current ? ' cur' : '');
      const cv = document.createElement('canvas'); cv.width = 44; cv.height = 44;
      const res = thumb(e);
      const img = cv.getContext('2d').createImageData(44, 44); img.data.set(res.rgba); cv.getContext('2d').putImageData(img, 0, 0);
      const n = document.createElement('div'); n.className = 'n'; n.textContent = e.creature.name;
      const l = document.createElement('div'); l.className = 'l'; l.textContent = 'Lv ' + e.level + ' · ' + G.traits(e.creature).rarity;
      const pick = document.createElement('button'); pick.textContent = S.picks.includes(i) ? 'parent ✓' : 'pick';
      pick.classList.toggle('on', S.picks.includes(i));
      pick.addEventListener('click', (ev) => {
        ev.stopPropagation();
        S.picks = S.picks.includes(i) ? S.picks.filter((j) => j !== i) : S.picks.concat(i).slice(-2);
        renderGallery();
      });
      card.addEventListener('click', () => {
        S.current = i;
        setCreature(e.creature, { overrides: e.overrides, special: e.special, temperament: e.temperament, level: e.level, phase: 'creature' });
        renderGallery();
      });
      card.append(cv, n, l, pick);
      box.appendChild(card);
    });
    $('breed').disabled = S.picks.length !== 2;
    $('pickNote').textContent = S.picks.length === 2 ? S.picks.map((i) => S.gallery[i].creature.name).join(' + ') + ' = ' + G.breedName(S.gallery[S.picks[0]].creature.name, S.gallery[S.picks[1]].creature.name, G.makeRng('name')) + '?' : 'Pick two to breed.';
  }

  // ---------- wiring ----------
  function chips(boxId, items, onPick) {
    const box = $(boxId);
    for (const [v, label] of items) {
      const b = document.createElement('button'); b.textContent = label; b.dataset.v = v;
      b.addEventListener('click', () => onPick(v));
      box.appendChild(b);
    }
  }
  chips('faces', FACES.map((f) => [f, f]), (v) => { S.expression = v; refresh(); });
  chips('views', VIEWS, (v) => { S.view = v; S.dirty = true; updatePanels(); });
  chips('backs', Object.keys(BACKS).map((k) => [k, k]), (v) => { S.back = v; S.dirty = true; updatePanels(); });
  chips('tabs', [['genes', 'Genes'], ['numbers', 'Numbers'], ['about', 'About']], (v) => {
    for (const t of ['genes', 'numbers', 'about']) $('tab-' + t).hidden = t !== v;
    for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.v === v);
  });
  $('tabs').children[0].classList.add('on');
  $('temper').addEventListener('input', () => { S.temperament = Number($('temper').value); refresh(); syncEntry(); });
  $('level').addEventListener('input', () => { S.level = Number($('level').value); if (S.phase === 'egg') S.phase = 'creature'; refresh(); syncEntry(); });
  $('newEgg').addEventListener('click', () => newEgg());
  $('hatch').addEventListener('click', hatch);
  $('loadSeed').addEventListener('click', () => newEgg($('seed').value.trim()));
  $('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') newEgg($('seed').value.trim()); });
  $('walk').addEventListener('click', () => { S.walk = !S.walk; updatePanels(); });
  $('repair').addEventListener('click', () => { S.repair = !S.repair; refresh(); });
  $('askPixels').addEventListener('click', () => { S.reveal = 0; });
  $('resetGenes').addEventListener('click', () => { S.overrides = {}; S.special = { body: 1, head: 1 }; buildGeneSliders(); refresh(); syncEntry(); });
  $('breed').addEventListener('click', breedPicks);
  $('clearGallery').addEventListener('click', () => { S.gallery = []; S.picks = []; S.current = -1; saveGallery(); renderGallery(); });

  // ---------- start ----------
  S.gallery = loadGallery().filter((e) => e && e.creature && e.creature.copies);
  newEgg(params.get('seed') || undefined);
  if (params.get('temperament') != null) { S.temperament = Number(params.get('temperament')); $('temper').value = S.temperament; }
  if (params.get('level') || params.get('hatched') === '1') {
    S.phase = 'creature'; S.level = Math.max(1, Math.min(100, Number(params.get('level')) || 1)); $('level').value = S.level;
  }
  if (params.get('face')) S.expression = params.get('face');
  refresh();
  renderGallery();
  requestAnimationFrame(loop);

  // ---------- self-checks (?test=1), read by test/e2e.js ----------
  const api = { S, newEgg, hatch, finishHatch, breedPicks, refresh, renderCreature, frame };
  window.CreatureHatchery = api;
  if (TEST) setTimeout(runChecks, 50);

  function runChecks() {
    const checks = [];
    const check = (name, pass, info) => checks.push({ name, pass: !!pass, info: info === undefined ? null : info });
    const hash = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
    const seed = params.get('seed') || 'test';
    try {
      // Same seed, same creature: twice from scratch.
      newEgg(seed);
      const fp1 = G.fingerprint(S.creature);
      S.phase = 'creature'; S.level = 100; refresh();
      const h1 = hash(renderCreature({}).rgba);
      newEgg(seed); S.phase = 'creature'; S.level = 100; refresh();
      check('seed recreates the creature', fp1 === G.fingerprint(S.creature) && h1 === hash(renderCreature({}).rgba));
      // The seed field loads the same creature.
      $('seed').value = seed; $('loadSeed').click();
      check('seed field loads that egg', S.phase === 'egg' && G.fingerprint(S.creature) === fp1);
      // Egg shows something, then hatches into a baby that joins the collection.
      const eggPixels = renderEgg({}).mask.reduce((n, m) => n + (m === 1), 0);
      check('egg is drawn', eggPixels > 200, eggPixels);
      const before = S.gallery.length;
      hatch();
      check('hatch makes a level 1 baby in the collection', S.phase === 'creature' && S.level === 1 && S.gallery.length === before + 1, { phase: S.phase, n: S.gallery.length });
      // Every level shows a different picture.
      let prev = null, same = [];
      for (let l = 1; l <= 100; l++) { S.level = l; S.ph = phenotypeAt(l); const h = hash(renderCreature({}).rgba); if (h === prev) same.push(l); prev = h; }
      check('every level changes the picture', same.length === 0, same);
      // The one slider: cute is paler and has bigger eyes than scary.
      const lum = (res) => { let s = 0, n = 0; for (let i = 0; i < res.mask.length; i++) if (res.mask[i] === 1) { s += res.rgba[i * 4] + res.rgba[i * 4 + 1] + res.rgba[i * 4 + 2]; n++; } return s / Math.max(1, n); };
      S.level = 100; S.temperament = -1; refresh(); const scary = renderCreature({}); const scaryPh = S.ph;
      S.temperament = 1; refresh(); const cute = renderCreature({}); const cutePh = S.ph;
      check('cute is lighter than scary', lum(cute) > lum(scary), [lum(scary), lum(cute)]);
      check('cute has bigger eyes, scary has fangs', cutePh.eyes.size > scaryPh.eyes.size && scaryPh.fangs > cutePh.fangs);
      // A different seed is a different creature.
      newEgg(seed + '-other'); check('different seed, different creature', G.fingerprint(S.creature) !== fp1);
      hatch();
      // Breeding two from the collection lays an egg whose parents are those two.
      S.picks = [S.gallery.length - 2, S.gallery.length - 1];
      const names = S.picks.map((i) => S.gallery[i].creature.name);
      breedPicks();
      check('breeding lays an egg from the two picks', S.phase === 'egg' && S.creature.parents && S.creature.parents.join() === names.join(), S.creature.parents);
      // The controls exist.
      check('controls exist', ['temper', 'level', 'newEgg', 'hatch', 'seed', 'genes', 'gallery'].every((id) => $(id)) && $('genes').querySelectorAll('input').length === SLIDERS.length);
      // A gene slider changes the creature.
      S.phase = 'creature'; refresh();
      const h0 = hash(renderCreature({}).rgba);
      const inp = $('genes').querySelector('input[data-gene="colour.hue"]');
      inp.value = (Number(inp.value) + 120) % 360; inp.dispatchEvent(new Event('input'));
      check('colour slider recolours', hash(renderCreature({}).rgba) !== h0);
      frame(0.1);
    } catch (e) { check('no errors', false, String(e && e.stack || e)); }
    const pass = checks.every((c) => c.pass);
    $('result').textContent = JSON.stringify({ checks, pass, seed });
  }
})();
