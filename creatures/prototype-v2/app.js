/* Creature Hatchery, version 2 ("Argonaut technique"): the same page as version 1 (eggs, hatching, the temperament
   slider, levels, gene sliders, the genome, breeding, the collection, habitats, food and hunger, the three looks), but
   the body is a chain of joints that follows its head (chain.js), legs are FABRIK two-bone legs that step when their
   foot falls too far behind (motion2.js), and the shadow is cast by the body's real pieces from a sun that crosses the
   sky (light.js). Version 1's genome, body pieces, renderer and habitats are shared, unchanged, from ../prototype.
   URL: ?seed=<s> starts from that egg; &level=<1-100> &temperament=<-1..1> &hatched=1 show the creature; &pause=1 holds
   still (for screenshots); &view=inside|flat|pieces; &style=gochi|cel|pixel; &palette=gameboy|pico8|earth (pixel look);
   &shine=<0-1>; &habitat=grass|flat|meadow|cave|wildwood|studio; &debug=1 draws the walk (the chain's joints, heading
   and facing, the head, goal, floor edges, planted feet, swing targets, legs, gait); &gait=walk|hurry keeps it walking;
   &heading=<radians> which way it faces; &hunger=<0-1>; &food=berry|seed|leaf|apple|fish puts one down in front of it;
   &time=<0-1> or &sun=left|noon|right|night sets the time of day; &auto=1 lets the day run; &test=1 runs the self-checks.
   Dropping food by clicking the stage is for this prototype page only. In the game food comes from tokens of real
   Claude Code use, and levels only from real use; there are no buttons that add either. */
(function () {
  'use strict';
  const G = window.CreatureGenome, R = window.CreatureRender, M = window.CreatureMotion, HAB = window.CreatureHabitats;
  const C = window.CreatureChain, M2 = window.CreatureMotion2, LT = window.CreatureLight;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const TEST = params.get('test') === '1';
  const PROOF = params.get('proof');               // turn|spin|eat|habitats|sun: draw a proof sheet for tools/proof.js
  const PAUSE = params.get('pause') === '1' || TEST || !!PROOF;
  const GAIT = ['walk', 'hurry'].includes(params.get('gait')) ? params.get('gait') : null; // keep walking (or hurrying)
  const reducedMotion = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();

  const STAGE_W = 384, STAGE_H = 216;   // stage grid (logical pixels)
  const Y_FAR = 112, Y_NEAR = 204;      // rows of the floor's far and near edges
  const K_FAR = 0.72;                   // things at the far edge are drawn this much smaller
  const PITCH = 0.45;                   // camera tilt; the world camera looks across the floor (screen right is +x)
  const FIT_W = 104, FIT_H = 84;        // a grown-up fills about this box at the front of the floor
  const MIN_PX = 0.016;                 // world units per pixel, at least, so small adults stay small
  const EDGE_X = 48;                    // pixels kept clear at each side of the floor
  const PAN_MAX = 6;                    // parallax: the far layers slide up to this many pixels as it walks
  const START_HEADING = -0.8;           // facing a little towards us: the 3/4 view
  const SPRITE_FPS = 12;                // the video's creatures animate on a slow pixel-art clock
  const HATCH = { wobble: 1.2, crack: [0.5, 1.7], open: [1.7, 2.3], baby: 2.1, fade: [2.4, 3.2] };
  const DAY_SECONDS = 90;               // the auto cycle: one day and one night in this many seconds
  const GALLERY_KEY = 'creature-hatchery-v2', GALLERY_MAX = 40;
  const HABITAT_ALIAS = { night: 'cave', paper: 'flat', peach: 'studio', clear: 'studio' }; // the old ?back= names
  // Food for the prototype's drop-a-snack click: bites to finish it, how much hunger it takes away, size in pixels.
  const FOODS = {
    berry: { bites: 2, value: 0.2, size: 4 }, seed: { bites: 1, value: 0.1, size: 3 }, leaf: { bites: 3, value: 0.25, size: 6 },
    apple: { bites: 4, value: 0.4, size: 6 }, fish: { bites: 4, value: 0.45, size: 8 },
  };
  const MAX_FOOD = 6, DROP_TIME = 0.45, DROP_HEIGHT = 46, POOP_LIFE = 9, SPARKLE_LIFE = 1.3, CRUMB_LIFE = 0.5;
  const STATE_WORDS = { idle: 'idle', go: 'walking', turn: 'turning', spin: 'spinning!', eat: 'eating', hungry: 'hungry' };
  const FACES = ['neutral', 'happy', 'angry', 'sleepy', 'surprised'];
  const PALETTE_NAMES = { gameboy: 'Game Boy', pico8: 'PICO-8', earth: 'warm earth' };
  const VIEWS = [['gochi', 'Finished'], ['pieces', 'Melted pieces'], ['flat', 'One colour'], ['inside', 'Inside?']];
  // Gene sliders: [label, gene or special, kind]. Specials scale whole pieces.
  const SLIDERS = [
    ['Body size', '*body'], ['Head size', '*head'], ['Head length', 'head.length'], ['Neck', 'neck.length'], ['Tail', 'tail.length'],
    ['Leg pairs', 'legs.pairs'], ['Leg length', 'legs.length'], ['Eyes', 'eyes.size'], ['Horns', 'horns.count'], ['Horn length', 'horns.length'],
    ['Wings', 'wings.size'], ['Ears', 'ears.kind'], ['Decor', 'decor.kind'], ['Colour', 'colour.hue'], ['Saturation', 'colour.sat'],
    ['Pattern', 'pattern.kind'], ['Pattern amount', 'pattern.amount'], ['Melt (fluff)', 'fluff'], ['Gloss', 'gloss'],
  ];
  const INTEGER_GENES = new Set(['legs.pairs', 'horns.count', 'ears.kind', 'decor.kind', 'pattern.kind', 'wings.fingers']);

  const habitatParam = params.get('habitat') || params.get('back');
  const S = {
    creature: null, overrides: {}, special: { body: 1, head: 1 }, temperament: 0, level: 1, expression: 'neutral',
    repair: true, view: params.get('view') || 'gochi', walk: !PAUSE,
    habitat: HAB.keys.includes(habitatParam) ? habitatParam : HABITAT_ALIAS[habitatParam] || 'grass', hab: null,
    style: R.looks.includes(params.get('style')) ? params.get('style') : 'gochi',
    palette: R.PALETTES[params.get('palette')] ? params.get('palette') : 'own',
    shine: params.get('shine') != null ? Math.max(0, Math.min(1, Number(params.get('shine')) || 0)) : 1,
    debug: params.get('debug') === '1', food: 'berry', foods: [], poops: [], fx: [], pan: 0,
    time: LT.timeFor(params.get('sun') || params.get('time'), LT.NAMED.morning), auto: params.get('auto') === '1' && !PAUSE, sun: null, blobs: [],
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
  // ---------- the floor ----------
  // The stage shows a floor from a little above: z runs from the back (S.zFar, row Y_FAR) to the front (S.zNear, row
  // Y_NEAR), x across, and things further back are drawn smaller (k). The creature is rendered with a camera turned by
  // its heading, so turning shows it side-on, from the front, from behind and in between.
  const depthOf = (z) => (z - S.zFar) / (S.zNear - S.zFar);
  function toStage(x, z, y) {
    const t = depthOf(z), k = K_FAR + (1 - K_FAR) * t;
    return { x: STAGE_W / 2 + x * k / S.px, y: Y_FAR + (Y_NEAR - Y_FAR) * t - (y || 0) * Math.cos(PITCH) * k / S.px, k };
  }
  function fromStage(sx, sy) {
    const t = Math.max(0, Math.min(1, (sy - Y_FAR) / (Y_NEAR - Y_FAR))), k = K_FAR + (1 - K_FAR) * t;
    return { x: (sx - STAGE_W / 2) * S.px / k, z: S.zFar + t * (S.zNear - S.zFar) };
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // The sprite grid fits the grown-up from every side, with room above for hops and flying.
  function spriteBox(scene, px) {
    let half = 0, top = 0, bottom = 0;
    const pts = scene.prims.map((p) => p.bs);
    if (scene.shadow) pts.push([scene.shadow.cx, 0, 0, Math.max(scene.shadow.rx, scene.shadow.rz)]);
    for (let i = 0; i < 8; i++) {
      const c = R.camera({ w: 1, h: 1, px, yaw: i * Math.PI / 4, pitch: PITCH, center: [0, 0, 0] });
      for (const b of pts) {
        const rx = dot(b, c.r), uy = dot(b, c.u);
        half = Math.max(half, Math.abs(rx) + b[3]); top = Math.max(top, uy + b[3]); bottom = Math.max(bottom, b[3] - uy);
      }
    }
    const w = Math.ceil(2 * half * 1.06 / px) + 4, ground = Math.ceil((top * 1.06 + 0.4 * (top + bottom)) / px) + 2;
    return { w: w + (w % 2), h: ground + Math.ceil(bottom * 1.06 / px) + 3, ground };
  }
  // A sprite camera seeing the body from `yaw` (body frame) at depth scale k, with the body's origin on the sprite's
  // ground row, in the middle.
  function spriteCam(yaw, k) {
    const px = S.px / k, c = R.camera({ w: S.sw, h: S.sh, px, yaw, pitch: PITCH, center: [0, 0, 0] }), off = (S.sg - S.sh / 2) * px;
    return { w: S.sw, h: S.sh, px, yaw, pitch: PITCH, center: [c.u[0] * off, c.u[1] * off, c.u[2] * off] };
  }
  // Re-derive the body numbers, the scale and the floor. The scale is set by the adult so growing shows as getting bigger.
  function refresh() {
    S.ph = phenotypeAt(S.level);
    const adult = chainScene(phenotypeAt(G.LEVEL_MAX), {});
    S.px = Math.max(R.frameCamera(adult, FIT_W, FIT_H, { fit: true }).px, MIN_PX);
    const bx = spriteBox(adult, S.px);
    S.sw = bx.w; S.sh = bx.h; S.sg = bx.ground;
    sprite.width = S.sw; sprite.height = S.sh;
    const depth = (Y_NEAR - Y_FAR) * S.px / Math.sin(PITCH) / ((1 + K_FAR) / 2);
    S.zFar = -depth / 2; S.zNear = depth / 2;
    S.area = { minX: -(STAGE_W / 2 - EDGE_X) * S.px, maxX: (STAGE_W / 2 - EDGE_X) * S.px, minZ: S.zFar + 0.06 * depth, maxZ: S.zNear - 0.14 * depth };
    const w0 = S.walker;
    S.cam = spriteCam(-(w0 ? w0.th : START_HEADING), 1); // the still view (self-checks, the first frame)
    S.walker = M2.createWalker(S.ph, G.hashSeed(String(S.creature.seed)), {
      x: w0 ? w0.x : 0, z: w0 ? w0.z : 0, heading: w0 ? w0.th : START_HEADING, hunger: w0 ? w0.hunger : S.startHunger,
    });
    S.rig = S.walker.R; S.rigFor = S.ph;
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
    S.walker = null; S.foods = []; S.poops = []; S.fx = [];
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
  const sprite = document.createElement('canvas');
  const spctx = sprite.getContext('2d');

  function setHabitat(key) {
    S.habitat = key;
    S.hab = HAB.create(key, { W: STAGE_W, H: STAGE_H, yFar: Y_FAR, yNear: Y_NEAR });
    $('stageBox').classList.toggle('dark', S.hab.dark);
    S.dirty = true;
  }
  // Paint a render onto the stage with the body's origin standing on the floor at (x, z). Returns the sprite's corner.
  function putSprite(res, x, z, alpha) {
    const img = spctx.createImageData(res.w, res.h);
    const rows = S.reveal != null ? Math.floor(S.reveal) : res.h;
    if (rows >= res.h) img.data.set(res.rgba);
    else img.data.set(res.rgba.subarray(0, rows * res.w * 4));
    spctx.clearRect(0, 0, sprite.width, sprite.height);
    spctx.putImageData(img, 0, 0);
    if (S.reveal != null && rows < res.h) { spctx.fillStyle = '#f6d34a'; spctx.fillRect(0, rows, res.w, 1); }
    const p = toStage(x, z), sx = Math.round(p.x) - S.sw / 2, sy = Math.round(p.y) - S.sg;
    sctx.save();
    sctx.globalAlpha = alpha == null ? 1 : alpha;
    sctx.drawImage(sprite, sx, sy);
    sctx.restore();
    return { sx, sy };
  }
  // The finished view draws in the chosen look; the other views are the debug looks. The look never touches the genome.
  function lookOpts() {
    return { style: S.view === 'gochi' ? S.style : S.view, shine: S.shine, palette: S.palette === 'own' ? null : S.palette };
  }
  // The body as a chain (chain.js) in a pose from the walker; no pose is the rest pose. The renderer's own ellipse
  // shadow is off: the light layer casts the real one.
  function chainScene(ph, pose) {
    if (ph === S.ph) { if (S.rigFor !== ph) { S.rig = C.rig(ph); S.rigFor = ph; } return C.scene(ph, S.rig, pose); }
    return C.scene(ph, null, pose);
  }
  const renderOpts = () => Object.assign(lookOpts(), { shadow: false });
  function renderCreature(pose, cam) {
    const sc = chainScene(S.ph, pose);
    S.lastScene = sc;
    return R.render(sc, cam || S.cam, renderOpts());
  }
  function renderEgg(pose, cam) {
    return R.render(R.eggScene(G.eggLook(S.creature), pose), cam || S.cam, renderOpts());
  }

  // ---------- light and shadows ----------
  // Each frame: the sun or moon in the sky, then every caster's real pieces projected along the light onto the floor
  // (light.js), under everything standing on the floor. The tint goes over the whole picture at the end.
  const shadowLayer = LT.createLayer(STAGE_W, STAGE_H);
  const shadowStyle = () => (S.view === 'gochi' ? S.style : 'gochi');
  const creatureSpheres = (scene, x, z, th) => LT.placeSpheres(LT.sceneSpheres(scene), { x, z, th });
  const eggSpheres = (pose, z, fade) => (fade < 0.5 ? [] : creatureSpheres(R.eggScene(G.eggLook(S.creature), pose), 0, z, START_HEADING));
  // Food and poop as small balls: the size they are drawn at, and food falling from the sky casts from up there.
  function floorSpheres() {
    const out = [];
    for (const f of S.foods) {
      if (f.gone || f.bites <= 0) continue;
      const def = FOODS[f.kind], u = Math.min(1, f.age / DROP_TIME), up = (1 - u * u) * DROP_HEIGHT * S.px / Math.cos(PITCH);
      const r = def.size * 0.5 * S.px * (0.45 + 0.55 * f.bites / f.maxBites);
      out.push({ c: [f.x, r + up, f.z], r });
    }
    for (const p of S.poops) if (p.age < POOP_LIFE - 1) out.push({ c: [p.x, 3 * S.px, p.z], r: 3.5 * S.px });
    return out;
  }
  function setTime(t) { S.time = ((t % 1) + 1) % 1; S.sun = LT.sunAt(S.time); S.dirty = true; }
  function lightAndShadows(spheres) {
    if (!S.sun) S.sun = LT.sunAt(S.time);
    LT.drawSky(sctx, S.sun, STAGE_W, Y_FAR, { pixel: shadowStyle() === 'pixel' });
    S.blobs = LT.shadowBlobs(spheres.concat(floorSpheres()), S.sun, S.ph ? S.ph.scale : 1);
    shadowLayer.draw(sctx, S.blobs, S.sun, toStage, { style: shadowStyle(), dark: S.hab.dark });
  }
  const tint = () => LT.drawTint(sctx, S.sun, STAGE_W, STAGE_H);
  // The camera for the creature where it stands: turned by its heading (the world camera looks along -z, so the body
  // is seen from yaw = -heading) and scaled by how far back it is.
  const camAt = (x, z, heading) => spriteCam(-heading, toStage(x, z).k);

  // ---------- food, poop and sparkles (food drops are for this prototype page only) ----------
  function dropFood(x, z, kind, landed) {
    const f = FOODS[kind] || FOODS.berry;
    if (S.foods.filter((o) => !o.gone).length >= MAX_FOOD) S.foods.shift();
    const a = S.area;
    const food = { kind: FOODS[kind] ? kind : 'berry', x: Math.max(a.minX, Math.min(a.maxX, x)), z: Math.max(a.minZ, Math.min(a.maxZ, z)),
      bites: f.bites, maxBites: f.bites, value: f.value, age: landed ? DROP_TIME : 0 };
    S.foods.push(food);
    S.dirty = true;
    return food;
  }
  // The meal it is on, else the nearest food that has landed.
  function foodFor(w) {
    if (w.eat && w.eat.food && !w.eat.food.gone) return w.eat.food;
    if (w.goal && w.goal.food && !w.goal.food.gone && w.goal.food.bites > 0) return w.goal.food;
    let best = null, bd = Infinity;
    for (const f of S.foods) {
      if (f.gone || f.bites <= 0 || f.age < DROP_TIME) continue;
      const d = Math.hypot(f.x - w.x, f.z - w.z);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
  function drawFood(f) {
    const def = FOODS[f.kind], u = Math.min(1, f.age / DROP_TIME), up = (1 - u * u) * DROP_HEIGHT;
    const p = toStage(f.x, f.z), x = Math.round(p.x), y = Math.round(p.y);
    const s = def.size * p.k * (0.45 + 0.55 * f.bites / f.maxBites);
    const cy = Math.round(y - s * 0.7 - up * p.k);
    const disc = (cx, yy, r, col, ry) => { sctx.fillStyle = col; sctx.beginPath(); sctx.ellipse(Math.round(cx), Math.round(yy), Math.max(0.8, r), Math.max(0.8, ry || r), 0, 0, Math.PI * 2); sctx.fill(); };
    if (f.kind === 'berry') {
      disc(x - s * 0.35, cy, s * 0.6, '#b8284a'); disc(x + s * 0.35, cy + s * 0.1, s * 0.6, '#d23a5c'); disc(x, cy - s * 0.35, s * 0.55, '#c9304f');
      disc(x - s * 0.1, cy - s * 0.5, s * 0.18, '#ffd0dc'); disc(x + s * 0.2, cy - s * 0.95, s * 0.3, '#5aa845', s * 0.18);
    } else if (f.kind === 'seed') {
      disc(x, cy, s * 0.75, '#d9b27a', s * 0.5); disc(x - s * 0.2, cy - s * 0.15, s * 0.25, '#f2d9a8', s * 0.15);
      sctx.fillStyle = '#9a7444'; sctx.fillRect(Math.round(x - s * 0.5), Math.round(cy), Math.max(1, Math.round(s)), 1);
    } else if (f.kind === 'leaf') {
      disc(x, cy + s * 0.2, s, '#6cbf4a', s * 0.45); sctx.fillStyle = '#3f8f2c'; sctx.fillRect(Math.round(x - s * 0.9), Math.round(cy + s * 0.2), Math.max(1, Math.round(s * 1.8)), 1);
      disc(x - s * 0.3, cy, s * 0.3, '#9ad874', s * 0.12);
    } else if (f.kind === 'apple') {
      disc(x, cy, s * 0.85, '#d83b30'); disc(x - s * 0.3, cy - s * 0.3, s * 0.25, '#ff9a8a');
      sctx.fillStyle = '#5a3a20'; sctx.fillRect(Math.round(x), Math.round(cy - s * 1.15), 1, Math.max(1, Math.round(s * 0.4)));
      disc(x + s * 0.3, cy - s * 0.95, s * 0.3, '#5aa845', s * 0.15);
    } else { // fish
      disc(x - s * 0.1, cy, s * 0.8, '#8fb3c9', s * 0.38); disc(x - s * 0.1, cy + s * 0.12, s * 0.6, '#d8e6ee', s * 0.18);
      sctx.fillStyle = '#6f93aa'; sctx.beginPath(); sctx.moveTo(x + s * 0.6, cy); sctx.lineTo(x + s * 1.1, cy - s * 0.4); sctx.lineTo(x + s * 1.1, cy + s * 0.4); sctx.fill();
      sctx.fillStyle = '#1c1c24'; sctx.fillRect(Math.round(x - s * 0.6), Math.round(cy - s * 0.1), 1, 1);
    }
  }
  // A small, cute poop: a brown swirl with a shine and two dots for eyes. It fades away.
  function drawPoop(p) {
    const q = toStage(p.x, p.z), x = Math.round(q.x), y = Math.round(q.y), k = q.k * 1.2;
    sctx.save(); sctx.globalAlpha = Math.min(1, (POOP_LIFE - p.age) / 2);
    const tier = (yy, w, col) => { sctx.fillStyle = col; sctx.beginPath(); sctx.ellipse(x, Math.round(yy), Math.max(1, w), Math.max(1, w * 0.55), 0, 0, Math.PI * 2); sctx.fill(); };
    tier(y - 1.5 * k, 4 * k, '#8a5a3c'); tier(y - 4 * k, 3 * k, '#9a6848'); tier(y - 6 * k, 1.8 * k, '#a87452');
    sctx.fillStyle = '#ffffff'; sctx.fillRect(Math.round(x - 2 * k), Math.round(y - 5 * k), 1, 1);
    sctx.fillStyle = '#2a1d16'; sctx.fillRect(Math.round(x - 1.4 * k), Math.round(y - 3 * k), 1, 1); sctx.fillRect(Math.round(x + 1.2 * k), Math.round(y - 3 * k), 1, 1);
    sctx.restore();
  }
  function onEvents(st, top) {
    for (const e of st.events) {
      if (e.type === 'bite') {
        const f = S.walker.eat && S.walker.eat.food; if (!f) continue;
        const p = toStage(f.x, f.z);
        for (let i = 0; i < 5; i++) S.fx.push({ kind: 'crumb', x: p.x, y: p.y - 3, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 20, age: 0, life: CRUMB_LIFE, col: f.kind === 'leaf' ? '#6cbf4a' : f.kind === 'fish' ? '#d8e6ee' : f.kind === 'seed' ? '#d9b27a' : '#e05a6a' });
      } else if (e.type === 'happy') {
        const p = toStage(st.x, st.z);
        for (let i = 0; i < 7; i++) S.fx.push({ kind: 'spark', x: p.x + (Math.random() - 0.5) * S.sw * 0.6 * p.k, y: top + 6 + Math.random() * 18, vx: 0, vy: -10 - Math.random() * 10, age: -i * 0.08, life: SPARKLE_LIFE, col: i % 2 ? '#ffe36a' : '#ffffff' });
      } else if (e.type === 'poop') S.poops.push({ x: e.x, z: e.z, age: 0 });
    }
  }
  function drawFx(dt) {
    for (const f of S.fx) {
      f.age += dt;
      if (f.age < 0) continue;
      f.x += f.vx * dt; f.y += f.vy * dt; if (f.kind === 'crumb') f.vy += 120 * dt;
      const a = Math.max(0, 1 - f.age / f.life), x = Math.round(f.x), y = Math.round(f.y);
      sctx.globalAlpha = a; sctx.fillStyle = f.col;
      if (f.kind === 'spark') { const r = f.age < f.life * 0.5 ? 2 : 1; sctx.fillRect(x - r, y, 2 * r + 1, 1); sctx.fillRect(x, y - r, 1, 2 * r + 1); }
      else sctx.fillRect(x, y, 1, 1);
    }
    sctx.globalAlpha = 1;
    S.fx = S.fx.filter((f) => f.age < f.life);
    for (const p of S.poops) p.age += dt;
    S.poops = S.poops.filter((p) => p.age < POOP_LIFE);
    S.foods = S.foods.filter((f) => !f.gone);
    for (const f of S.foods) f.age += dt;
  }
  // The highest row the body reaches in this frame's sprite (for the thought bubble and sparkles).
  function spriteTop(res) {
    for (let y = 0; y < res.h; y++) for (let x = 0; x < res.w; x++) if (res.mask[y * res.w + x] === 1) return y;
    return S.sg;
  }
  // Hungry and nothing to eat: a thought bubble with a little berry in it.
  function drawBubble(cx, top) {
    const x = Math.round(cx + 10), y = Math.round(top - 16);
    sctx.fillStyle = 'rgba(255,255,255,0.92)';
    sctx.beginPath(); sctx.ellipse(x, y, 9, 7, 0, 0, Math.PI * 2); sctx.fill();
    sctx.fillRect(x - 7, y + 8, 2, 2); sctx.fillRect(x - 10, y + 12, 1, 1);
    sctx.fillStyle = '#c9304f'; sctx.beginPath(); sctx.arc(x - 1, y + 1, 2.5, 0, Math.PI * 2); sctx.arc(x + 2, y + 1, 2.5, 0, Math.PI * 2); sctx.fill();
    sctx.fillStyle = '#5aa845'; sctx.fillRect(x, y - 3, 3, 1);
  }

  // Walk debug. On the floor: its edges, the heading (yellow arrow), where the head faces (cyan), the turn rate (an arc),
  // the turn's pivot (cross) and the goal (circle; red for food). On the body: each leg hip-knee-foot, planted feet
  // (green), feet in swing (orange) and where they will land (cross). Text: state, heading, turn rate, hunger, gait.
  function drawDebug(res, st, at0) {
    const light = !S.hab.dark;
    const line = (a, b, colour) => { sctx.strokeStyle = colour; sctx.beginPath(); sctx.moveTo(a[0], a[1]); sctx.lineTo(b[0], b[1]); sctx.stroke(); };
    const dotAt = (p, colour, r) => { sctx.fillStyle = colour; sctx.fillRect(Math.round(p[0] - r), Math.round(p[1] - r), r * 2, r * 2); };
    const floor = (x, z) => { const p = toStage(x, z); return [p.x, p.y]; };
    sctx.save();
    sctx.lineWidth = 0.6;
    const a = S.area;
    sctx.strokeStyle = light ? 'rgba(40,80,140,0.55)' : 'rgba(120,200,255,0.6)';
    sctx.beginPath(); [[a.minX, a.minZ], [a.maxX, a.minZ], [a.maxX, a.maxZ], [a.minX, a.maxZ]].forEach((c, i) => { const p = floor(c[0], c[1]); if (i) sctx.lineTo(p[0], p[1]); else sctx.moveTo(p[0], p[1]); }); sctx.closePath(); sctx.stroke();
    if (st) {
      if (st.chain) { // the chain on the floor: links in white, joints as dots, the head in cyan
        const pts = st.chain.map((p) => floor(p[0], p[1]));
        for (let i = 1; i < pts.length; i++) line(pts[i - 1], pts[i], 'rgba(255,255,255,0.7)');
        pts.forEach((p, i) => dotAt(p, i === 0 ? '#3fd8ff' : '#ffffff', 1));
      }
      const o = floor(st.x, st.z), L = 0.9 * S.ph.scale;
      const arrow = (ang, colour) => {
        const tip = floor(st.x + Math.cos(ang) * L, st.z - Math.sin(ang) * L);
        line(o, tip, colour);
        const back = floor(st.x + Math.cos(ang) * L * 0.8, st.z - Math.sin(ang) * L * 0.8), dx = tip[0] - back[0], dy = tip[1] - back[1];
        line(tip, [back[0] - dy * 0.6, back[1] + dx * 0.6], colour); line(tip, [back[0] + dy * 0.6, back[1] - dx * 0.6], colour);
      };
      arrow(st.heading, '#ffd23a');
      arrow(st.heading + ((st.pose && st.pose.lookYaw) || 0), '#3fd8ff');
      if (Math.abs(st.yawRate) > 0.02) { // the turn rate: an arc round the body, longer for faster
        sctx.strokeStyle = '#ff7ad9'; sctx.beginPath();
        for (let i = 0; i <= 12; i++) { const ang = st.heading + Math.sign(st.yawRate) * Math.min(Math.PI, Math.abs(st.yawRate) * 0.6) * i / 12, p = floor(st.x + Math.cos(ang) * L * 0.55, st.z - Math.sin(ang) * L * 0.55); if (i) sctx.lineTo(p[0], p[1]); else sctx.moveTo(p[0], p[1]); }
        sctx.stroke();
      }
      if (st.pivot) { const p = floor(st.pivot[0], st.pivot[1]); line([p[0] - 3, p[1] - 3], [p[0] + 3, p[1] + 3], '#ff7ad9'); line([p[0] - 3, p[1] + 3], [p[0] + 3, p[1] - 3], '#ff7ad9'); }
      if (st.goal) { const p = floor(st.goal.x, st.goal.z); sctx.strokeStyle = st.goal.food ? '#ff4a4a' : '#5fe08a'; sctx.beginPath(); sctx.ellipse(p[0], p[1], 5, 2.5, 0, 0, Math.PI * 2); sctx.stroke(); }
      if (res && at0) {
        const cam = R.camera(res.cam);
        const at = (p, onGround) => { const q = R.project(cam, [p[0], onGround ? 0 : p[1] + (st.lift || 0), p[2]]); return [at0.sx + q.x, at0.sy + q.y]; };
        const legs = (S.lastScene && S.lastScene.legs) || [];
        legs.forEach((lg, k) => {
          const c = 'rgba(255,255,255,0.85)';
          line(at(lg.hip), at(lg.knee), c); line(at(lg.knee), at(lg.foot), c);
          dotAt(at(lg.foot), st.feetState[k] ? '#5fe08a' : '#ffa53a', 1.5);
          const t = st.targets && st.targets[k];
          if (t) { const p = at(t); line([p[0] - 2, p[1] - 2], [p[0] + 2, p[1] + 2], '#ffa53a'); line([p[0] - 2, p[1] + 2], [p[0] + 2, p[1] - 2], '#ffa53a'); }
        });
      }
      if (!PROOF) { // proof sheets crop the stage and label each frame themselves
        sctx.fillStyle = light ? 'rgba(30,24,40,0.85)' : 'rgba(255,255,255,0.85)'; sctx.font = '7px monospace';
        const deg = Math.round(((st.heading * 180 / Math.PI) % 360 + 540) % 360 - 180);
        sctx.fillText(st.state + ' · heading ' + deg + '° · turn ' + st.yawRate.toFixed(2) + ' rad/s · hunger ' + st.hunger.toFixed(2), 3, STAGE_H - 12);
        sctx.fillText(st.gait.name + ' ' + st.gait.phase.toFixed(2) + ' duty ' + st.gait.duty.toFixed(2) + ' v ' + (st.gait.speed / S.ph.scale).toFixed(2), 3, STAGE_H - 4);
      }
    }
    sctx.restore();
  }

  // Draw everything on the floor back to front: food, poop and the creature (or its egg).
  function drawFloor(things) {
    things.concat(S.foods.filter((f) => f.bites > 0).map((f) => ({ z: f.z, draw: () => drawFood(f) })))
      .concat(S.poops.map((p) => ({ z: p.z, draw: () => drawPoop(p) })))
      .sort((a, b) => a.z - b.z).forEach((t) => t.draw());
  }
  function showMood(st) {
    if (!st) { $('mood').textContent = S.phase === 'egg' ? 'egg' : 'hatching'; $('hungerBar').style.width = '0%'; return; }
    $('hungerBar').style.width = Math.round(st.hunger * 100) + '%';
    $('hungerBar').classList.toggle('low', st.hungry);
    $('mood').textContent = st.state === 'go' && st.goal && st.goal.food ? 'going to food' : STATE_WORDS[st.state] || st.state;
  }

  // The creature on its floor for one step result: habitat, food, poop, the creature, crumbs and sparkles, the hungry
  // bubble, the debug overlay and the hunger meter.
  function paint(st, pose, dt, t) {
    S.hab.draw(sctx, t, S.pan);
    const sc = chainScene(S.ph, pose);
    S.lastScene = sc;
    lightAndShadows(creatureSpheres(sc, st.x, st.z, st.heading));
    let res, at0;
    drawFloor([{ z: st.z, draw: () => { res = R.render(sc, camAt(st.x, st.z, st.heading), renderOpts()); at0 = putSprite(res, st.x, st.z); } }]);
    const top = at0.sy + spriteTop(res);
    onEvents(st, top);
    drawFx(dt);
    tint();
    if (st.hungry && st.state !== 'eat' && !foodFor(S.walker)) drawBubble(at0.sx + S.sw / 2, top);
    if (S.debug) drawDebug(res, st, at0);
    showMood(st);
  }

  function frame(dt) {
    const t = reducedMotion || PAUSE ? 0 : performance.now() / 1000;
    if (S.phase !== 'creature') S.hab.draw(sctx, t, S.pan);
    if (S.phase === 'egg') {
      const wob = PAUSE ? 0 : Math.sin(t * 2.2) * 0.05 * (Math.sin(t * 0.7) > 0.6 ? 1 : 0.25);
      lightAndShadows(eggSpheres({ wobble: wob }, 0, 1));
      drawFloor([{ z: 0, draw: () => putSprite(renderEgg({ wobble: wob }, camAt(0, 0, START_HEADING)), 0, 0) }]);
      tint();
      if (S.debug) drawDebug(null, null);
      showMood(null);
      return;
    }
    if (S.phase === 'hatching') {
      S.hatchT += dt;
      const T = S.hatchT, ramp = (a, b) => Math.max(0, Math.min(1, (T - a) / (b - a)));
      const wob = Math.sin(T * 18) * 0.12 * Math.min(1, T / HATCH.wobble) * (1 - ramp(HATCH.open[0], HATCH.open[1]));
      const eggPose = { wobble: wob, crack: ramp(HATCH.crack[0], HATCH.crack[1]), open: ramp(HATCH.open[0], HATCH.open[1]) };
      const fade = 1 - ramp(HATCH.fade[0], HATCH.fade[1]);
      const egg = () => putSprite(renderEgg(eggPose, camAt(0, 0, START_HEADING)), 0, -0.12 * S.ph.scale, T < HATCH.baby ? 1 : fade);
      const eggZ = T < HATCH.baby ? 0 : -0.12 * S.ph.scale;
      if (T < HATCH.baby) {
        lightAndShadows(eggSpheres(eggPose, eggZ, 1));
        drawFloor([{ z: 0, draw: egg }]);
        tint();
      } else {
        const st = M2.step(S.walker, dt, S.area, null, { walk: false, hop: T - dt < HATCH.baby });
        const sc = chainScene(S.ph, st.pose);
        S.lastScene = sc;
        lightAndShadows(eggSpheres(eggPose, eggZ, fade).concat(creatureSpheres(sc, st.x, st.z, st.heading)));
        let res, at0;
        drawFloor([{ z: eggZ, draw: egg }, { z: st.z, draw: () => { res = R.render(sc, camAt(st.x, st.z, st.heading), renderOpts()); at0 = putSprite(res, st.x, st.z); } }]);
        tint();
        if (S.debug) drawDebug(res, st, at0);
      }
      showMood(null);
      if (T >= HATCH.fade[1]) finishHatch();
      return;
    }
    const w = S.walker, moving = S.walk && !PAUSE;
    const st = M2.step(w, PAUSE ? 0 : dt, S.area, null, { walk: moving, reduced: reducedMotion || PAUSE, force: moving ? GAIT : null, food: foodFor(w) });
    const pose = PAUSE ? Object.assign({}, st.pose, { breathe: 0, blink: 0, tailSway: 0, lookYaw: 0, wingFlap: 0 }) : st.pose;
    if (!reducedMotion && !PAUSE) { // parallax: the far layers slide a little against where it walks
      const want = -(toStage(st.x, st.z).x - STAGE_W / 2) / (STAGE_W / 2) * PAN_MAX;
      S.pan += (want - S.pan) * Math.min(1, dt * 2);
    }
    paint(st, pose, PAUSE ? 0 : dt, t);
  }

  let last = 0, acc = 0;
  function loop(now) {
    const dt = last ? (now - last) / 1000 : 0;
    last = now; acc += dt;
    if (S.auto && !PAUSE && dt > 0) { // the day runs on; the next sprite frame picks it up
      S.time = (S.time + Math.min(0.25, dt) / DAY_SECONDS) % 1; S.sun = LT.sunAt(S.time);
      if (acc >= 1 / SPRITE_FPS) syncTime();
    }
    if (S.reveal != null) { S.reveal += dt * S.sh / 1.6; if (S.reveal >= S.sh) S.reveal = null; }
    const animating = !PAUSE || S.reveal != null;
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
    for (const b of $('looks').children) b.classList.toggle('on', b.dataset.v === S.style);
    for (const b of $('palettes').children) b.classList.toggle('on', b.dataset.v === S.palette);
    $('paletteRow').style.display = R.styles[S.style].pixel ? '' : 'none';
    $('shineVal').textContent = S.shine.toFixed(2);
    $('debug').classList.toggle('on', S.debug);
    for (const b of $('habitats').children) b.classList.toggle('on', b.dataset.v === S.habitat);
    for (const b of $('foods').children) b.classList.toggle('on', b.dataset.v === S.food);
    $('walk').classList.toggle('on', S.walk); $('repair').classList.toggle('on', S.repair);
    const rg = S.rig || C.rig(S.ph);
    $('chainInfo').textContent = 'Chain: ' + rg.joints.length + ' joints, ' + rg.hips.length + ' legs (two bones each, FABRIK), links ' +
      (rg.links[1] / S.ph.scale).toFixed(2) + ' of its size, bends up to ' + Math.round(C.MAX_BEND.torso * 180 / Math.PI) + '° a link in the body and ' +
      Math.round(C.MAX_BEND.tail * 180 / Math.PI) + '° in the tail.';
    syncTime();
  }
  // The time-of-day slider, its words and the auto button follow S.time.
  function syncTime() {
    if (!S.sun) S.sun = LT.sunAt(S.time);
    $('time').value = S.time.toFixed(3);
    $('timeVal').textContent = S.sun.label + (S.sun.body === 'moon' ? ' (moon)' : '');
    $('autoSun').classList.toggle('on', S.auto);
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
    const key = JSON.stringify([entry.creature.seed, entry.creature.parents, entry.overrides, entry.special, entry.temperament, entry.level, S.style, S.shine, S.palette]);
    if (thumbCache.has(key)) return thumbCache.get(key);
    const saved = { creature: S.creature, overrides: S.overrides, special: S.special, temperament: S.temperament };
    Object.assign(S, { creature: entry.creature, overrides: entry.overrides || {}, special: entry.special || { body: 1, head: 1 }, temperament: entry.temperament });
    const ph = phenotypeAt(entry.level || 1);
    Object.assign(S, saved);
    const sc = chainScene(ph, {});
    const res = R.render(sc, R.frameCamera(sc, 44, 44, { fit: true }), Object.assign(lookOpts(), { style: S.style }));
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
  // A new look redraws the stage and the collection; the genome stays as it is.
  const relook = () => { S.dirty = true; updatePanels(); renderGallery(); };
  chips('looks', R.looks.map((k) => [k, R.styles[k].label || k]), (v) => { S.style = v; S.view = 'gochi'; relook(); });
  chips('palettes', [['own', 'own colours']].concat(Object.keys(R.PALETTES).map((k) => [k, PALETTE_NAMES[k] || k])), (v) => { S.palette = v; relook(); });
  $('shine').value = S.shine;
  $('shine').addEventListener('input', () => { S.shine = Number($('shine').value); relook(); });
  $('debug').addEventListener('click', () => { S.debug = !S.debug; S.dirty = true; updatePanels(); });
  $('time').addEventListener('input', () => { S.auto = false; setTime(Number($('time').value)); syncTime(); });
  $('autoSun').addEventListener('click', () => { S.auto = !S.auto; syncTime(); });
  chips('habitats', HAB.LIST.map((h) => [h[0], h[1]]), (v) => { setHabitat(v); updatePanels(); });
  for (const b of $('habitats').children) b.title = HAB.LIST.find((h) => h[0] === b.dataset.v)[2];
  // Prototype only: pick a food, then click the floor to drop it there. The game has no such button.
  chips('foods', Object.keys(FOODS).map((k) => [k, k]), (v) => { S.food = v; updatePanels(); });
  stage.addEventListener('click', (e) => {
    if (S.phase !== 'creature') return;
    const r = stage.getBoundingClientRect(), p = fromStage((e.clientX - r.left) / r.width * STAGE_W, (e.clientY - r.top) / r.height * STAGE_H);
    dropFood(p.x, p.z, S.food);
  });
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
  if (params.get('hunger') != null) S.startHunger = Math.max(0, Math.min(1, Number(params.get('hunger')) || 0));
  setHabitat(S.habitat);
  newEgg(params.get('seed') || undefined);
  if (params.get('temperament') != null) { S.temperament = Number(params.get('temperament')); $('temper').value = S.temperament; }
  if (params.get('level') || params.get('hatched') === '1') {
    S.phase = 'creature'; S.level = Math.max(1, Math.min(100, Number(params.get('level')) || 1)); $('level').value = S.level;
  }
  if (params.get('face')) S.expression = params.get('face');
  if (params.get('heading') != null && S.walker) M2.place(S.walker, S.walker.x, S.walker.z, Number(params.get('heading')) || 0);
  refresh();
  if (FOODS[params.get('food')] && S.phase === 'creature') { // one snack in front of its head, already landed
    const w = S.walker, h = w.chain.joints[0], th = w.chain.angles[0], d = 0.7 * S.ph.scale;
    dropFood(h[0] + Math.cos(th) * d, h[1] - Math.sin(th) * d, params.get('food'), true);
  }
  renderGallery();
  requestAnimationFrame(loop);

  // ---------- self-checks (?test=1), read by test/e2e.js ----------
  const api = { S, newEgg, hatch, finishHatch, breedPicks, refresh, renderCreature, frame, dropFood, setHabitat, toStage, fromStage };
  window.CreatureHatchery = api;
  if (TEST) setTimeout(runChecks, 50);
  if (PROOF) setTimeout(() => { try { runProof(PROOF); } catch (e) { $('result').textContent = 'error ' + (e && e.stack || e); } }, 50);

  // ---------- proof sheets (?proof=...), read by tools/proof.js ----------
  // turn: a 180° turn from walking side-on; spin: a 360° spin; eat: walk to a dropped snack, bite, swallow, be happy;
  // habitats: the creature standing in every habitat. Frames are the real stage, stepped at the sprite clock, with the
  // seconds and state under each. The sheet goes into #result as a PNG data URL.
  function runProof(kind) {
    const DT = 1 / SPRITE_FPS, shots = [];
    const label = (st, time) => time.toFixed(2) + 's ' + st.state + ' ' + Math.round(((st.heading * 180 / Math.PI) % 360 + 540) % 360 - 180) + '°';
    if (kind === 'habitats') {
      for (const [key, name] of HAB.LIST) {
        setHabitat(key);
        const st = M2.step(S.walker, 0, S.area, null, { walk: false });
        paint(st, st.pose, 0, 2.6);
        shots.push({ img: sctx.getImageData(0, 0, STAGE_W, STAGE_H), text: name });
      }
      return sheet(shots, 3, STAGE_W, STAGE_H, 2);
    }
    if (kind === 'sun') { // rows: the three looks; columns: sun left, noon, sun right, night. Mid-stride, so legs show.
      const w = S.walker = M2.createWalker(S.ph, G.hashSeed(String(S.creature.seed)), { x: 0, z: (S.area.minZ + S.area.maxZ) / 2, heading: -0.35, hunger: 0.2 });
      for (let i = 0; i < 14; i++) M2.step(w, 1 / 30, S.area, null, { walk: true, force: 'walk' });
      w.pause = 99;
      const st = M2.step(w, 0, S.area, null, { walk: false });
      const p0 = toStage(st.x, st.z), cw = Math.min(STAGE_W, Math.round(S.sw * 2.6)), ch = Math.min(STAGE_H, S.sh + 24);
      const cx = Math.max(0, Math.min(STAGE_W - cw, Math.round(p0.x - cw / 2))), cy = Math.max(0, Math.min(STAGE_H - ch, Math.round(p0.y - S.sg - 4)));
      for (const look of R.looks) {
        S.style = look; S.view = 'gochi';
        for (const name of ['left', 'noon', 'right', 'night']) {
          setTime(LT.NAMED[name]);
          paint(st, st.pose, 0, 2.6);
          shots.push({ img: sctx.getImageData(cx, cy, cw, ch), text: (R.styles[look].label || look) + ' · ' + name, blobs: LT.extent(S.blobs) });
        }
      }
      return sheet(shots, 4, cw, ch, 2);
    }
    const seed = G.hashSeed(String(S.creature.seed));
    const start = kind === 'eat' ? fromStage(STAGE_W * 0.36, Y_FAR + (Y_NEAR - Y_FAR) * 0.45) : { x: 0, z: (S.area.minZ + S.area.maxZ) / 2 };
    const w = S.walker = M2.createWalker(S.ph, seed, { x: start.x, z: start.z, heading: 0, hunger: kind === 'eat' ? 0.85 : 0.2 });
    S.foods = []; S.poops = []; S.fx = [];
    if (kind === 'eat') { const f = fromStage(STAGE_W * 0.66, Y_FAR + (Y_NEAR - Y_FAR) * 0.62); dropFood(f.x, f.z, params.get('food') || 'apple', true); }
    if (kind === 'turn') M2.turn(w, Math.PI);
    if (kind === 'spin') M2.spin(w, 1);
    const p0 = toStage(start.x, start.z);
    const cw = kind === 'eat' ? STAGE_W : Math.min(STAGE_W, Math.round(S.sw * 1.3)), ch = kind === 'eat' ? STAGE_H : Math.min(STAGE_H, S.sh + 6);
    const cx = Math.max(0, Math.min(STAGE_W - cw, Math.round(p0.x - cw / 2))), cy = kind === 'eat' ? 0 : Math.max(0, Math.min(STAGE_H - ch, Math.round(p0.y - S.sg - 3)));
    let time = 0, end = null;
    for (let i = 0; i < SPRITE_FPS * 40 && (end == null || time < end); i++) {
      const st = M2.step(w, i ? DT : 0, S.area, null, { walk: true, food: foodFor(w) });
      if (kind !== 'eat' && i > 0 && w.mode !== 'turn') w.pause = 1; // hold still once the turn is done
      paint(st, st.pose, DT, time);
      shots.push({ img: sctx.getImageData(cx, cy, cw, ch), text: label(st, time), st });
      if (end == null && (kind === 'eat' ? st.events.some((e) => e.type === 'happy') : i > 0 && w.mode !== 'turn')) end = time + (kind === 'eat' ? 1 : 0.4);
      time += DT;
    }
    const n = kind === 'eat' ? 16 : 18, pick = [];
    for (let i = 0; i < n; i++) pick.push(shots[Math.round(i * (shots.length - 1) / (n - 1))]);
    return sheet(pick, kind === 'eat' ? 4 : 6, cw, ch, kind === 'eat' ? 1 : 2);
  }
  function sheet(shots, cols, cw, ch, scale) {
    const LABEL = 12, rows = Math.ceil(shots.length / cols);
    const out = document.createElement('canvas'); out.width = cols * cw * scale; out.height = rows * (ch * scale + LABEL);
    const o = out.getContext('2d'); o.imageSmoothingEnabled = false;
    o.fillStyle = '#1a1826'; o.fillRect(0, 0, out.width, out.height);
    const tmp = document.createElement('canvas'); tmp.width = cw; tmp.height = ch;
    shots.forEach((s, i) => {
      const x = (i % cols) * cw * scale, y = Math.floor(i / cols) * (ch * scale + LABEL);
      tmp.getContext('2d').putImageData(s.img, 0, 0);
      o.drawImage(tmp, x, y, cw * scale, ch * scale);
      o.fillStyle = '#ece6f2'; o.font = '10px monospace'; o.fillText(s.text, x + 3, y + ch * scale + 9);
    });
    $('result').textContent = out.toDataURL('image/png');
  }

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
      // (grown up: the bred child is random and a tiny baby can fall under the pixel counts below)
      S.phase = 'creature'; S.level = 100; refresh();
      const h0 = hash(renderCreature({}).rgba);
      const inp = $('genes').querySelector('input[data-gene="colour.hue"]');
      inp.value = (Number(inp.value) + 120) % 360; inp.dispatchEvent(new Event('input'));
      check('colour slider recolours', hash(renderCreature({}).rgba) !== h0);
      // Every look draws the creature and its egg, each differently, and switching looks leaves the genome alone.
      const fpBefore = G.fingerprint(S.creature), seen = new Set(), blank = [];
      for (const b of $('looks').children) {
        b.click();
        const cr = renderCreature({}), eg = renderEgg({});
        const crN = cr.mask.filter((m) => m === 1).length, egN = eg.mask.filter((m) => m === 1).length;
        if (crN < 200 || egN < 100) blank.push(S.style + ' creature ' + crN + ' egg ' + egN);
        seen.add(hash(cr.rgba));
      }
      check('every look draws creature and egg', blank.length === 0 && seen.size === R.looks.length, { blank, looks: R.looks.length, distinct: seen.size });
      check('looks leave the genome alone', G.fingerprint(S.creature) === fpBefore);
      $('looks').children[0].click();
      check('three looks: Original, Cel, Pixel', R.looks.join() === 'gochi,cel,pixel', R.looks);
      // The habitat is the bigger floor, and every habitat draws something different.
      check('stage is 384 x 216', stage.width === STAGE_W && stage.height === STAGE_H && STAGE_W === 384 && STAGE_H === 216);
      // The checks read pixels often: copy into a canvas made for frequent reads so Chrome keeps the stage on the GPU.
      const probe = Object.assign(document.createElement('canvas'), { width: STAGE_W, height: STAGE_H }), pctx = probe.getContext('2d', { willReadFrequently: true });
      const pixels = (cv) => { pctx.clearRect(0, 0, STAGE_W, STAGE_H); pctx.drawImage(cv, 0, 0); return pctx.getImageData(0, 0, STAGE_W, STAGE_H).data; };
      const stageHash = () => hash(pixels(stage));
      const habs = new Set();
      for (const b of $('habitats').children) { b.click(); frame(0.1); habs.add(stageHash()); }
      check('every habitat draws differently', habs.size === HAB.LIST.length && HAB.LIST.length >= 4, { habitats: HAB.LIST.length, distinct: habs.size });
      $('habitats').children[0].click();
      // Turning shows other sides: the creature seen from its heading looks different side-on and from the front.
      const side = hash(renderCreature({}, spriteCam(0, 1)).rgba), front = hash(renderCreature({}, spriteCam(Math.PI / 2, 1)).rgba);
      check('heading turns the view', side !== front);
      // The floor maps both ways, and the back of the floor draws smaller.
      const back = fromStage(STAGE_W / 2 + 40, Y_FAR + 5), q = toStage(back.x, back.z);
      check('floor maps both ways', Math.abs(q.x - STAGE_W / 2 - 40) < 0.01 && Math.abs(q.y - Y_FAR - 5) < 0.01 && q.k < toStage(0, S.zNear).k);
      // Food (prototype only): dropped by a click, eaten in bites, then it is gone and the creature is happy.
      check('food drop is labelled prototype only', /prototype only/i.test($('foodRow').textContent));
      const w = S.walker;
      w.hunger = 0.9;
      const r = stage.getBoundingClientRect();
      const spot = toStage(w.x + 1.2 * S.ph.scale, w.z);
      stage.dispatchEvent(new MouseEvent('click', { clientX: r.left + spot.x / STAGE_W * r.width, clientY: r.top + spot.y / STAGE_H * r.height, bubbles: true }));
      const meal = S.foods[S.foods.length - 1];
      check('a click drops food on the floor', !!meal && meal.bites > 0, meal && { x: meal.x, z: meal.z });
      let ate = false, bites = 0, hungerBefore = w.hunger;
      for (let i = 0; i < 60 * 40 && !ate; i++) {
        meal.age = DROP_TIME;
        const st = M2.step(w, 1 / 60, S.area, null, { walk: true, food: foodFor(w) });
        for (const e of st.events) { if (e.type === 'bite') bites++; if (e.type === 'happy') ate = true; }
      }
      check('it walks over, bites, swallows and is happy', ate && meal.gone && bites === FOODS[meal.kind].bites && w.hunger < hungerBefore, { ate, bites, gone: meal.gone });
      // Version 2's chain: after all that walking every link is still its own length and no joint bends past its limit.
      const J = w.chain.joints;
      let linkErr = 0, bendOver = 0;
      for (let i = 1; i < J.length; i++) {
        linkErr = Math.max(linkErr, Math.abs(Math.hypot(J[i][0] - J[i - 1][0], J[i][1] - J[i - 1][1]) - w.chain.links[i]));
        bendOver = Math.max(bendOver, Math.abs(C.wrap(w.chain.angles[i] - w.chain.angles[i - 1])) - w.R.bend[i]);
      }
      check('the chain keeps its link lengths and bend limits', linkErr < 1e-6 && bendOver < 1e-6, { linkErr, bendOver });
      // The light: the shadow comes from the body's pieces, points away from the sun, is long at a low sun and short at
      // noon, moves with the legs, and is gone (or faint) at night.
      M2.place(w, 0, (S.area.minZ + S.area.maxZ) / 2, 0);
      const still = M2.step(w, 0, S.area, null, { walk: false });
      const shadowAt = (name, st) => { setTime(LT.NAMED[name]); paint(st || still, (st || still).pose, 0, 0); return { e: LT.extent(S.blobs), n: S.blobs.length }; };
      const sl = shadowAt('left'), sn = shadowAt('noon'), sr = shadowAt('right'), sk = shadowAt('night');
      check('shadow is cast by every piece', sn.n >= S.lastScene.prims.length, { blobs: sn.n, prims: S.lastScene.prims.length });
      check('shadow points away from the sun', sl.e.cx > sn.e.cx && sr.e.cx < sn.e.cx && sl.e.hx > 0 && sr.e.hx < 0, { left: sl.e.cx, noon: sn.e.cx, right: sr.e.cx });
      check('low sun: long shadow; noon: short', sl.e.reach > 2 * sn.e.reach && sr.e.reach > 2 * sn.e.reach, { left: sl.e.reach, noon: sn.e.reach, right: sr.e.reach });
      check('night: only a faint moon shadow', LT.sunAt(LT.NAMED.night).strength < 0.5 * LT.sunAt(LT.NAMED.noon).strength && sk.n > 0);
      const stageDark = () => { const d = pixels(stage); let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s; };
      setTime(LT.NAMED.noon); paint(still, still.pose, 0, 0); const noonLight = stageDark();
      setTime(LT.NAMED.night); paint(still, still.pose, 0, 0);
      check('night tints the scene darker', stageDark() < noonLight * 0.85);
      setTime(LT.NAMED.left);
      for (let i = 0; i < 12; i++) M2.step(w, 1 / 30, S.area, null, { walk: true, force: 'walk' });
      const stA = M2.step(w, 1 / 30, S.area, null, { walk: true, force: 'walk' });
      const footBlobs = () => LT.shadowBlobs(creatureSpheres(chainScene(S.ph, stA.pose), stA.x, stA.z, stA.heading), S.sun, S.ph.scale);
      const b1 = footBlobs();
      stA.pose.legs = stA.pose.legs.map((l) => ({ hip: l.hip, foot: [l.foot[0] + 0.15 * S.ph.scale, l.foot[1] + 0.05 * S.ph.scale, l.foot[2]] }));
      const b2 = footBlobs();
      // Moving a leg can also change how many spheres sample it, so compare the shadow's centre, not blob by blob.
      const mid = (bs) => bs.reduce((m, q) => [m[0] + q.x / bs.length, m[1] + q.z / bs.length], [0, 0]), m1 = mid(b1), m2 = mid(b2);
      const moved = Math.hypot(m1[0] - m2[0], m1[1] - m2[1]) / S.ph.scale;
      check('shadow follows the legs', moved > 0.005, { moved });
      // Pixel look: a hard-edged shadow, one tone; the Original keeps a soft edge.
      const alphas = (look) => { S.style = look; paint(still, still.pose, 0, 0); const d = pixels(shadowLayer.layer), set = new Set(); for (let i = 3; i < d.length; i += 4) set.add(d[i]); return set.size; };
      const softTones = alphas('gochi'), pixelTones = alphas('pixel');
      check('pixel look casts a hard pixel shadow', pixelTones === 2 && softTones > 6, { pixelTones, softTones });
      S.style = 'gochi';
      // The page says which version it is and links to the other and to the side-by-side.
      check('version label and links', /Version 2/.test(document.body.textContent) && !!document.querySelector('a[href^="../prototype/"]') && !!document.querySelector('a[href*="compare.html"]'));
      // The walk debug overlay draws over the stage without errors.
      S.debug = true; frame(0.1); S.debug = false;
      check('walk debug draws', true);
      frame(0.1);
    } catch (e) { check('no errors', false, String(e && e.stack || e)); }
    const pass = checks.every((c) => c.pass);
    $('result').textContent = JSON.stringify({ checks, pass, seed });
  }
})();
