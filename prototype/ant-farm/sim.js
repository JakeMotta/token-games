/* Ant farm prototype: the world grid, its physics and the colony.
   Plain script with no dependencies. In a browser it defines window.AntSim;
   in Node it is a CommonJS module, so the tests can drive it headless. */
(function (root) {
  'use strict';

  // Cell types. Every cell is one micropixel.
  const AIR = 0, DIRT = 1, ROCK = 2, LOOSE = 3, FOOD = 4, CRUMB = 5, GLASS = 6;
  const SOLID = [false, true, true, true, true, true, true];
  const DIGGABLE = [false, true, false, true, true, true, false];
  const FALLS = [false, false, false, true, false, true, false];
  const CEILING = [false, true, false, false, true, false, false]; // fixed soil that can span a gap
  // What a painted pixel shows, for palettes (sim.paint with o.kind).
  const K = { SKY: 0, WALL: 1, SOIL: 2, GRASS: 3, LOOSE: 4, ROCK: 5, FOOD: 6, GLASS: 7, CRACK: 8, BROOD: 9, ANT: 10, QUEEN: 11, LOAD_FOOD: 12, LOAD_GRAIN: 13 };

  const TICK_HZ = 20;
  const DIG_TICKS = 4;        // time to bite one grain loose
  const DROP_TICKS = 3;
  const TOKENS_PER_ENERGY = 40; // one grain of digging per 40 tokens
  const TOKENS_PER_CRUMB = 500; // one food crumb per 500 tokens
  const BROOD_STAGES = [220, 480, 700]; // egg -> larva -> pupa -> adult (ticks)

  // Soil layers. span = widest flat ceiling (in cells) the layer holds up.
  const LAYERS = {
    topsoil: { col: '#4d3b2d', span: 10 },
    loam: { col: '#6d5240', span: 14 },
    sand: { col: '#a2875f', span: 8 },
    clay: { col: '#8a5a43', span: 20 },
    deep: { col: '#5b4536', span: 16 },
  };

  const PAL = {
    skyTop: '#232a3a', skyLow: '#3a4356', grass: '#5f6d47', rock: '#6f737b', glass: '#1a1e27',
    seed: '#d4a65e', fungus: '#9fb06c', crumb: '#ecc87e',
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  function rgb(r, g, b) { return (0xff000000 | (clamp255(b) << 16) | (clamp255(g) << 8) | clamp255(r)) >>> 0; }
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shadeHex(h, k, jitter) { const [r, g, b] = hexRgb(h); return rgb(r * k + jitter, g * k + jitter, b * k + jitter); }
  function scaleCol(c, k) { return rgb((c & 255) * k, ((c >>> 8) & 255) * k, ((c >>> 16) & 255) * k); }

  // Smooth 1D noise in [-1, 1]: random control points every `step` cells, cosine eased.
  function noise1(rnd, n, step) {
    const pts = []; for (let i = 0; i <= Math.ceil(n / step) + 1; i++) pts.push(rnd() * 2 - 1);
    const out = new Float32Array(n);
    for (let x = 0; x < n; x++) {
      const i = Math.floor(x / step), f = (x % step) / step, e = (1 - Math.cos(f * Math.PI)) / 2;
      out[x] = pts[i] * (1 - e) + pts[i + 1] * e;
    }
    return out;
  }

  function createSim(opts) {
    opts = opts || {};
    const seed = (opts.seed == null ? 1 : opts.seed) >>> 0;
    const W = opts.W || 420, H = opts.H || 260;
    const N = W * H;
    const rnd = mulberry32(seed);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

    const type = new Uint8Array(N);
    const col = new Uint32Array(N);   // a grain's colour travels with it
    const bg = new Uint32Array(N);    // back wall shown where a cell is dug out
    const span = new Uint8Array(N);   // flat-ceiling limit of the layer this cell sits in
    const pocket = new Int16Array(N).fill(-1);
    const occ = new Uint8Array(N);    // ants standing in a cell: grains rest on them instead of filling it
    const surf = new Int16Array(W);   // original ground line

    // ---------- world generation ----------
    const sn = noise1(rnd, W, 37), sn2 = noise1(rnd, W, 11);
    for (let x = 0; x < W; x++) surf[x] = Math.round(H * 0.17 + sn[x] * 4 + sn2[x] * 1.2);

    const bands = [{ name: 'topsoil', d: ri(4, 7) }];
    let depth = bands[0].d;
    const order = ['loam', 'sand', 'loam', 'clay', 'sand', 'deep', 'clay', 'loam'];
    let oi = ri(0, 3);
    while (depth < H) { const name = order[oi++ % order.length]; const d = ri(14, 38); bands.push({ name, d }); depth += d; }
    const bandAt = (d) => { let acc = 0; for (const b of bands) { acc += b.d; if (d < acc) return b.name; } return 'deep'; };
    const wob = noise1(rnd, W, 23);

    const [skr, skg, skb] = hexRgb(PAL.skyTop), [slr, slg, slb] = hexRgb(PAL.skyLow);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        if (x === 0 || x === W - 1 || y === H - 1) { type[k] = GLASS; col[k] = bg[k] = shadeHex(PAL.glass, 1, 0); continue; }
        if (y < surf[x]) {
          const f = Math.min(1, y / Math.max(1, surf[x]));
          type[k] = AIR; bg[k] = rgb(skr + (slr - skr) * f, skg + (slg - skg) * f, skb + (slb - skb) * f);
          continue;
        }
        const d = y - surf[x];
        const name = bandAt(Math.max(0, d + Math.round(wob[x] * 3)));
        const L = LAYERS[name];
        const j = (rnd() - 0.5) * 14 + ((x * 7 + y * 13) % 5 === 0 ? -6 : 0);
        type[k] = DIRT;
        col[k] = d === 0 ? shadeHex(PAL.grass, 1, j) : shadeHex(L.col, 1, j);
        bg[k] = shadeHex(L.col, 0.36, j * 0.3);
        span[k] = opts.span || L.span;
      }
    }

    const ex = Math.round(W / 2 + (rnd() - 0.5) * W * 0.3); // nest entrance column

    function blob(cx, cy, r, fn) {
      const R = Math.ceil(r + 1);
      for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
        if (x < 1 || x > W - 2 || y < 1 || y > H - 2) continue;
        const dx = x - cx, dy = y - cy, rr = r * (0.85 + 0.3 * rnd());
        if (dx * dx + dy * dy <= rr * rr) fn(y * W + x, x, y);
      }
    }

    if (opts.rocks !== false) {
      const nRocks = ri(6, 12);
      for (let i = 0; i < nRocks; i++) {
        const x = ri(10, W - 10), y = ri(surf[Math.min(W - 1, x)] + 12, H - 8);
        if (Math.abs(x - ex) < 30 && y < surf[ex] + 45) continue;
        blob(x, y, 2 + rnd() * 4, (k) => { if (type[k] === DIRT) { type[k] = ROCK; col[k] = shadeHex(PAL.rock, 0.85 + rnd() * 0.3, 0); } });
      }
    }

    const pockets = [];
    if (opts.food !== false) {
      const nFood = opts.pockets || ri(10, 16);
      for (let tries = 0; pockets.length < nFood && tries < 400; tries++) {
        const x = ri(8, W - 9), y = ri(surf[x] + 18, H - 8);
        if (Math.hypot(x - ex, y - surf[ex]) < 30) continue;
        if (pockets.some((p) => Math.hypot(p.x - x, p.y - y) < 28)) continue;
        const kind = rnd() < 0.6 ? 'seed' : 'fungus';
        const p = { id: pockets.length, x, y, kind, total: 0, remaining: 0, claimed: false };
        blob(x, y, 1.6 + rnd() * 1.8, (k) => {
          if (type[k] !== DIRT) return;
          type[k] = FOOD; pocket[k] = p.id; p.total++;
          col[k] = shadeHex(kind === 'seed' ? PAL.seed : PAL.fungus, 0.85 + rnd() * 0.3, 0);
        });
        p.remaining = p.total;
        if (p.total) pockets.push(p); // an empty pocket's id is reused by the next one
      }
    }

    // ---------- simulation state ----------
    const sim = {
      seed, W, H, type, col, bg, span, pocket, surf, pockets, ex, nest: { x: ex + 5, y: 0 },
      tick: 0, version: 0, rnd,
      ants: [], brood: [], projects: [], strains: [], events: [],
      energy: opts.energy == null ? 320 : opts.energy,
      crumbQueue: 0, galleryQueue: [], scent: 40,
      royal: null, broodRoom: null,
      box: { x0: ex - 1, y0: surf[ex] - 1, x1: ex + 1, y1: surf[ex] + 1 }, // everything the colony has touched
      sandAwake: false, lastCheckVer: -1, lastIslandVer: -1, moves: 0,
      stats: { dug: 0, stored: 0, eaten: 0, laid: 0, born: 0, collapses: 0, crumbsSpawned: 0, tokens: 0, tasks: 0 },
      fields: new Map(),
      nextId: 1,
    };

    const idx = (x, y) => y * W + x;
    const inside = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1;

    function touch(x, y) {
      const b = sim.box;
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
    }
    function setCell(k, t, c) {
      const old = type[k];
      if (old === FOOD && t !== FOOD && pocket[k] >= 0) { sim.pockets[pocket[k]].remaining--; pocket[k] = -1; }
      type[k] = t; if (c !== undefined) col[k] = c;
      sim.version++; sim.sandAwake = true;
      touch(k % W, (k / W) | 0);
    }
    function swap(a, b) {
      const t = type[a]; type[a] = type[b]; type[b] = t;
      const c = col[a]; col[a] = col[b]; col[b] = c;
    }
    sim.setCell = setCell;
    sim.idx = idx;

    function walkable(k) {
      if (type[k] !== AIR) return false;
      const x = k % W, y = (k / W) | 0;
      if (!inside(x, y)) return false;
      return SOLID[type[k - 1]] || SOLID[type[k + 1]] || SOLID[type[k - W]] || SOLID[type[k + W]] ||
        SOLID[type[k - W - 1]] || SOLID[type[k - W + 1]] || SOLID[type[k + W - 1]] || SOLID[type[k + W + 1]];
    }
    sim.walkable = walkable;
    // A diagonal step needs one of the two side cells open: no squeezing through a pinhole.
    function canStep(k, dx, dy) {
      if (dx === 0 || dy === 0) return true;
      return type[k + dx] === AIR || type[k + dy * W] === AIR;
    }
    const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

    // ---------- distance fields (BFS over walkable air) ----------
    const queue = new Int32Array(N);
    function computeField(f) {
      const dist = f.dist; dist.fill(-1);
      let qh = 0, qt = 0;
      for (const s of f.sources()) if (s >= 0 && s < N && dist[s] < 0 && walkable(s)) { dist[s] = 0; queue[qt++] = s; }
      while (qh < qt) {
        const k = queue[qh++], d = dist[k] + 1;
        for (const [dx, dy] of D8) {
          const n = k + dx + dy * W;
          if (dist[n] >= 0 || type[n] !== AIR || !canStep(k, dx, dy) || !walkable(n)) continue;
          dist[n] = d; queue[qt++] = n;
        }
      }
      f.ver = sim.version; f.at = sim.tick;
    }
    function field(key, sources) {
      let f = sim.fields.get(key);
      if (!f) { f = { dist: new Int32Array(N), ver: -1, at: -99, sources }; sim.fields.set(key, f); computeField(f); return f; }
      f.sources = sources;
      if (f.ver !== sim.version && sim.tick - f.at >= 4) computeField(f);
      return f;
    }
    function near(cx, cy, r) {
      const out = [];
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (inside(x, y)) out.push(idx(x, y));
      return out;
    }
    // Move one cell down the field. Returns 'arrived', 'moved' or 'stuck'. Never more than one cell.
    function follow(a, f) {
      const k = idx(a.x, a.y);
      let d = f.dist[k];
      if (d === 0) return 'arrived';
      if (d < 0 && sim.tick - f.at > 0) { computeField(f); d = f.dist[k]; if (d === 0) return 'arrived'; }
      if (d < 0) return 'stuck';
      let best = -1, bestD = d, ties = 0;
      for (const [dx, dy] of D8) {
        const n = k + dx + dy * W, nd = f.dist[n];
        if (nd < 0 || nd > bestD || type[n] !== AIR || !canStep(k, dx, dy) || !walkable(n)) continue;
        if (nd < bestD) { bestD = nd; best = n; ties = 1; } else if (nd === bestD && best >= 0 && nd < d) { ties++; if (rnd() < 1 / ties) best = n; }
      }
      if (best < 0 || bestD >= d) { if (sim.tick - f.at > 0) computeField(f); return 'stuck'; }
      moveTo(a, best);
      return 'moved';
    }
    function moveTo(a, k) {
      const nx = k % W, ny = (k / W) | 0;
      a.hx = Math.sign(nx - a.x); a.hy = Math.sign(ny - a.y);
      const old = idx(a.x, a.y);
      occ[old]--; occ[k]++;
      if (FALLS[type[old - W]] || FALLS[type[old - W - 1]] || FALLS[type[old - W + 1]]) sim.sandAwake = true;
      a.x = nx; a.y = ny; a.walk++; sim.moves++;
    }

    // ---------- projects: tunnels, rooms, food harvests, rubble clearing ----------
    function roomCells(room) {
      const cells = [];
      const { cx, cy, rx, ry, shape } = room;
      for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
        if (!inside(x, y) || y <= surf[x] + 1) continue;
        const nx = (x - cx) / (rx + 0.5), ny = (y - cy) / (ry + 0.5);
        if (shape === 'dome' && nx * nx + ny * ny > 1) continue;
        cells.push({ k: idx(x, y), o: nx * nx + ny * ny });
      }
      cells.sort((p, q) => p.o - q.o);
      return cells.map((c) => c.k);
    }
    function newProject(kind, startK, goal, room) {
      const p = {
        id: sim.nextId++, kind, head: startK, goal, room, phase: goal ? 'tunnel' : 'room',
        ang: Math.atan2(goal ? goal.y - ((startK / W) | 0) : 1, goal ? goal.x - startK % W : 0),
        cells: room ? roomCells(room) : null, work: -1, done: false, stuck: 0, diggers: 0,
      };
      sim.projects.push(p);
      return p;
    }
    sim.newProject = newProject;
    const hasAirNear = (k) => { for (const [dx, dy] of D8) if (walkable(k + dx + dy * W)) return true; return false; };
    function canDig(p, k) {
      const t = type[k];
      if (p.kind === 'clear') return t === LOOSE;
      return DIGGABLE[t];
    }
    // Cells this project wants dug now (all reachable from open air). Empty when it is finished or blocked.
    function nextCells(p) {
      p.cands = [];
      for (let guard = 0; guard < 6 && !p.done; guard++) {
        if (p.phase === 'tunnel') {
          const hx = p.head % W, hy = (p.head / W) | 0;
          const dx = Math.round(Math.cos(p.ang)), dy = Math.round(Math.sin(p.ang));
          const nx = hx + dx, ny = hy + dy;
          if (!inside(nx, ny) || type[idx(nx, ny)] === ROCK || type[idx(nx, ny)] === GLASS || ny < surf[nx] - 1) {
            p.stuck++; p.ang += (p.stuck % 2 ? 1 : -1) * (Math.PI / 4) * Math.ceil(p.stuck / 2);
            if (p.stuck > 10) { p.done = true; p.failed = true; }
            continue;
          }
          const face = [idx(nx, ny), idx(nx - dy, ny + dx), idx(nx + dy, ny - dx), idx(nx + dx, ny + dy)];
          let solidFace = false;
          for (const k of face) {
            const fx = k % W, fy = (k / W) | 0;
            if (!inside(fx, fy) || fy < surf[fx] || !DIGGABLE[type[k]]) continue;
            if (hasAirNear(k)) p.cands.push(k);
            solidFace = true;
          }
          if (solidFace && !p.cands.length) {
            // face not yet touching air (the tip turned a corner): open the cells around the step first
            for (const [ox, oy] of D8) { const k = idx(nx + ox, ny + oy); if (inside(nx + ox, ny + oy) && (ny + oy) >= surf[nx + ox] && DIGGABLE[type[k]] && hasAirNear(k)) p.cands.push(k); }
            if (!p.cands.length) { p.stuck++; p.ang += (p.stuck % 2 ? 1 : -1) * (Math.PI / 4); if (p.stuck > 10) { p.done = true; p.failed = true; } continue; }
          }
          if (solidFace) return p.cands; // the rest of the face opens up once the near cells are out
          // face is open: advance the tunnel tip and steer toward the goal with a little wobble
          p.head = idx(nx, ny); p.stuck = 0;
          const gx = p.goal.x - nx, gy = p.goal.y - ny;
          if (gx * gx + gy * gy <= 2) { if (p.cells) p.phase = 'room'; else { p.done = true; return p.cands; } continue; }
          let da = Math.atan2(gy, gx) - p.ang;
          while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          p.ang += da * 0.35 + (rnd() - 0.5) * 0.7;
          continue;
        }
        // room / harvest / clear: dig the earliest listed cell that touches open air
        for (const k of p.cells) if (canDig(p, k) && hasAirNear(k) && p.cands.push(k) >= 8) break;
        if (p.cands.length) return p.cands;
        if (p.kind === 'food' && sim.pockets[p.pocket].remaining > 0) {
          // pocket cells not yet exposed: tunnel on toward the rest of it
          const left = p.cells.find((k) => type[k] === FOOD);
          if (left != null) { p.phase = 'tunnel'; p.goal = { x: left % W, y: (left / W) | 0 }; continue; }
        }
        if (!p.cells.some((k) => canDig(p, k))) p.done = true;
        return p.cands;
      }
      return p.cands;
    }
    sim.nextCells = nextCells;

    function underground(k) { const x = k % W, y = (k / W) | 0; return y > surf[x]; }
    function nearestTunnel(gx, gy) {
      let best = -1, bd = Infinity;
      const b = sim.box;
      for (let y = Math.max(1, b.y0); y <= Math.min(H - 2, b.y1); y++) for (let x = Math.max(1, b.x0); x <= Math.min(W - 2, b.x1); x++) {
        const k = idx(x, y);
        if (type[k] !== AIR || y <= surf[x] + 1 || !walkable(k)) continue;
        const r = sim.royal && sim.royal.done && sim.royal.room; // keep new tunnels out of the queen's floor
        if (r && Math.abs(x - r.cx) <= r.rx + 2 && Math.abs(y - r.cy) <= r.ry + 2) continue;
        const d = (x - gx) * (x - gx) + (y - gy) * (y - gy);
        if (d < bd) { bd = d; best = k; }
      }
      return { k: best, d: Math.sqrt(bd) };
    }

    // ---------- the colony ----------
    function addAnt(x, y, role) {
      const a = { id: sim.nextId++, x, y, hx: 1, hy: 0, role: role || 'worker', job: null, carry: null, carryCol: 0, busy: 0,
        acc: rnd(), speed: role === 'queen' ? 0.25 : 0.75 + rnd() * 0.2, walk: 0, stuckT: 0, brood: null };
      sim.ants.push(a); occ[idx(x, y)]++;
      return a;
    }
    sim.addAnt = addAnt;
    const queen = () => sim.ants.find((a) => a.role === 'queen');

    if (opts.colony !== false) {
      const sy = surf[ex] - 1;
      // The queen waits beside the entrance (not over the shaft) until her chamber is dug.
      let qy = surf[sim.nest.x] - 1; while (qy < H - 2 && type[idx(sim.nest.x, qy + 1)] === AIR) qy++;
      sim.nest.y = qy;
      addAnt(sim.nest.x, qy, 'queen');
      for (let i = 0; i < (opts.workers || 6); i++) { const x = ex + ri(-6, 6); let y = sy; while (y < H - 2 && type[idx(x, y + 1)] === AIR) y++; addAnt(x, y, 'worker'); }
      for (let i = 0; i < 4; i++) { const k = idx(ex + ri(-3, 3), sy - 6 - i); if (type[k] === AIR) { setCell(k, CRUMB, shadeHex(PAL.crumb, 0.9 + rnd() * 0.2, 0)); sim.stats.crumbsSpawned++; } }
    }

    // Food is stored at a fixed place: beside the entrance, then on the royal chamber floor.
    const storeRoom = () => (sim.royal && sim.royal.done ? sim.royal.room : null);
    const storeSources = () => { const r = storeRoom(); return r ? near(r.cx, r.cy + r.ry - 1, 3) : near(sim.nest.x, sim.nest.y, 2); };
    const isStored = (x, y) => {
      const r = storeRoom();
      if (r) return Math.abs(x - r.cx) <= r.rx + 2 && Math.abs(y - r.cy) <= r.ry + 2;
      return Math.abs(x - sim.nest.x) <= 6 && Math.abs(y - sim.nest.y) <= 4;
    };

    // Surface: anywhere on the open ground away from the hole.
    function surfaceSources() {
      const out = [];
      for (let x = 2; x < W - 2; x++) {
        if (Math.abs(x - ex) < 4) continue;
        for (let y = 1; y < surf[x] + 1; y++) { const k = idx(x, y); if (type[k] !== AIR) { if (y > 1) out.push(idx(x, y - 1)); break; } }
      }
      return out;
    }
    function crumbSources() {
      const out = [];
      const b = sim.box;
      for (let y = Math.max(1, b.y0 - 2); y <= Math.min(H - 2, b.y1 + 2); y++) for (let x = 1; x < W - 1; x++) {
        const k = idx(x, y);
        if (type[k] === CRUMB && type[k + W] !== AIR && !isStored(x, y)) for (const [dx, dy] of D8) out.push(k + dx + dy * W);
      }
      return out;
    }
    function looseCrumbs() {
      let n = 0;
      const b = sim.box;
      for (let y = 1; y < H - 1; y++) for (let x = Math.max(1, b.x0 - 60); x <= Math.min(W - 2, b.x1 + 60); x++) {
        const k = idx(x, y); if (type[k] === CRUMB && type[k + W] !== AIR && !isStored(x, y)) n++;
      }
      return n;
    }

    // Put a carried grain down in an open cell next to the ant (it then falls on its own).
    function dropNear(a, t, c, preferDx) {
      const k = idx(a.x, a.y);
      const tries = [[preferDx || a.hx || 1, 0], [-(preferDx || a.hx || 1), 0], [0, -1], [preferDx || 1, -1], [-(preferDx || 1), -1]];
      for (const [dx, dy] of tries) { const n = k + dx + dy * W; if (type[n] === AIR && inside(n % W, (n / W) | 0)) { setCell(n, t, c); return true; } }
      return false;
    }

    function assign(a) {
      const workers = sim.ants.filter((b) => b.role === 'worker');
      // brood waiting by the queen gets carried down to the brood room
      if (sim.broodRoom && sim.broodRoom.done) {
        const b = sim.brood.find((e) => !e.inRoom && !e.nurse);
        if (b) { b.nurse = a.id; a.job = { type: 'nurse', id: b.id }; return; }
      }
      if (sim.crumbsOut > 0 && workers.filter((b) => b.job && b.job.type === 'forage').length < Math.min(sim.crumbsOut, Math.ceil(workers.length / 3))) {
        a.job = { type: 'forage' }; return;
      }
      if (sim.energy >= 1) {
        const open = sim.projects.filter((p) => !p.done);
        const rank = (p) => (p.kind === 'clear' ? 2 : p.kind === 'gallery' ? 1 : 0);
        open.sort((p, q) => rank(q) - rank(p) || p.diggers - q.diggers);
        const p = open.find((q) => q.diggers < (q.phase === 'tunnel' ? 3 : 5) && nextCells(q).length);
        if (p) { p.diggers++; a.job = { type: 'dig', pid: p.id }; return; }
      }
      a.job = { type: 'rest', t: 30 + Math.floor(rnd() * 60) };
    }
    function release(a) {
      if (a.job && a.job.type === 'dig') { const p = sim.projects.find((q) => q.id === a.job.pid); if (p) p.diggers--; }
      if (a.job && a.job.type === 'nurse') { const b = sim.brood.find((e) => e.id === a.job.id); if (b && b.nurse === a.id && a.carry !== 'brood') b.nurse = 0; }
      a.job = null;
    }

    function stepAnt(a) {
      const k = idx(a.x, a.y);
      // Buried (a cell was filled under it): climb to open air next to it, else pick the grain up,
      // else shove it upward.
      if (type[k] !== AIR) {
        for (const [dx, dy] of [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0]]) { const n = k + dx + dy * W; if (type[n] === AIR && inside(n % W, (n / W) | 0)) { moveTo(a, n); return; } }
        if (!a.carry && a.role !== 'queen' && DIGGABLE[type[k]]) { a.carry = type[k] === CRUMB || type[k] === FOOD ? 'food' : 'grain'; a.carryCol = col[k]; setCell(k, AIR); return; }
        for (let y = a.y - 1; y > 0; y--) { const n = idx(a.x, y); if (type[n] === AIR) { const t = type[k], c = col[k]; setCell(k, AIR); setCell(n, t, c); return; } }
        return;
      }
      // Nothing to hold on to: fall one cell.
      if (!walkable(k)) { if (type[k + W] === AIR) moveTo(a, k + W); return; }
      if (a.busy > 0) { a.busy--; return; }
      a.acc += a.speed * (sim.energy >= 1 || a.carry ? 1 : 0.5);
      if (a.acc < 1) return;
      a.acc -= 1;
      if (a.role === 'queen') return stepQueen(a);

      if (a.carry === 'grain') {
        // Out of the hole, then along the ground to a spot of its own choosing, then drop.
        if (a.dumpX == null) {
          const r = follow(a, field('surface', surfaceSources));
          if (r === 'arrived') { const spread = 12 + Math.min(90, sim.stats.dug / 25); a.dumpX = ex + (rnd() < 0.5 ? -1 : 1) * Math.round(18 + rnd() * spread); a.dumpAt = a.walk; }
          else if (r === 'stuck') blocked(a);
          return;
        }
        if (a.x === a.dumpX || (a.walk - a.dumpAt > 600 && Math.abs(a.x - ex) > 10)) {
          if (dropNear(a, LOOSE, a.carryCol, a.x < ex ? -1 : 1)) { a.carry = null; a.dumpX = null; a.busy = DROP_TICKS; }
          return;
        }
        surfaceWalk(a, Math.sign(a.dumpX - a.x));
        return;
      }
      if (a.carry === 'food') {
        const r = follow(a, field('store', storeSources));
        if (r === 'arrived') {
          // set food down only where it will stay put (not over a hole it would roll down)
          let put = false;
          for (const [dx, dy] of [[a.hx || 1, 0], [-(a.hx || 1), 0], [0, -1], [1, -1], [-1, -1]]) {
            const n = k + dx + dy * W;
            if (type[n] === AIR && type[n + W] !== AIR && !occ[n] && isStored(n % W, (n / W) | 0)) { setCell(n, CRUMB, a.carryCol); put = true; break; }
          }
          if (put) { a.carry = null; a.busy = DROP_TICKS; sim.stats.stored++; }
          else { const [dx, dy] = D8[Math.floor(rnd() * 8)]; const n = k + dx + dy * W; if (walkable(n) && canStep(k, dx, dy) && isStored(n % W, (n / W) | 0)) moveTo(a, n); }
        }
        else if (r === 'stuck') blocked(a);
        return;
      }
      if (!a.job) assign(a);
      const j = a.job;
      if (j.type === 'rest') {
        if (--j.t <= 0) { release(a); return; }
        if (rnd() < 0.15) { const [dx, dy] = D8[Math.floor(rnd() * 8)]; const n = k + dx + dy * W; if (walkable(n) && canStep(k, dx, dy) && underground(n) === underground(k)) moveTo(a, n); }
        return;
      }
      if (j.type === 'forage') {
        if (sim.crumbsOut <= 0) { release(a); return; }
        const r = follow(a, field('crumbs', crumbSources));
        if (r === 'arrived') {
          for (const [dx, dy] of D8) { const n = k + dx + dy * W; if (type[n] === CRUMB && !isStored(n % W, (n / W) | 0)) { a.carry = 'food'; a.carryCol = col[n]; setCell(n, AIR); a.busy = DIG_TICKS; sim.crumbsOut--; break; } }
          release(a);
        } else if (r === 'stuck') { release(a); blocked(a, true); }
        return;
      }
      if (j.type === 'nurse') {
        const b = sim.brood.find((e) => e.id === j.id);
        if (!b) { release(a); return; }
        if (a.carry !== 'brood') {
          const r = follow(a, field('brood:' + b.id, () => near(b.x, b.y, 1)));
          if (r === 'arrived') { a.carry = 'brood'; a.brood = b; b.carried = true; sim.fields.delete('brood:' + b.id); }
          else if (r === 'stuck') { release(a); }
          return;
        }
        const room = sim.broodRoom.room;
        const r = follow(a, field('nursery', () => near(room.cx, room.cy + room.ry - 1, 2)));
        if (r === 'arrived') { b.x = a.x; b.y = a.y; b.carried = false; b.inRoom = true; b.nurse = 0; a.carry = null; a.brood = null; a.busy = DROP_TICKS; release(a); }
        else if (r === 'stuck') blocked(a);
        return;
      }
      if (j.type === 'dig') {
        const p = sim.projects.find((q) => q.id === j.pid);
        if (!p || p.done || sim.energy < 1) { release(a); return; }
        const cands = nextCells(p);
        if (!cands.length) { release(a); return; }
        const c = cands.find((n) => Math.max(Math.abs(n % W - a.x), Math.abs(((n / W) | 0) - a.y)) <= 1);
        if (c !== undefined) {
          const cx = c % W, cy = (c / W) | 0, t = type[c];
          a.carry = t === FOOD || t === CRUMB ? 'food' : 'grain'; a.carryCol = col[c];
          a.hx = Math.sign(cx - a.x); a.hy = Math.sign(cy - a.y);
          setCell(c, AIR); sim.energy -= 1; sim.stats.dug++; a.busy = DIG_TICKS;
          release(a);
          return;
        }
        const r = follow(a, field('work:' + p.id, () => (p.cands.length ? p.cands.flatMap((n) => near(n % W, (n / W) | 0, 1)) : [p.head])));
        if (r === 'stuck') { if (++a.stuckT > 8) { a.stuckT = 0; release(a); blocked(a, true); } }
        else a.stuckT = 0;
      }
    }

    // Path blocked (rubble, a slid spoil heap): dig through loose grains next to us.
    function blocked(a, now) {
      const k = idx(a.x, a.y);
      if (!now && ++a.stuckT < 20) return;
      a.stuckT = 0;
      for (const [dx, dy] of [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1], [0, 1]]) {
        const n = k + dx + dy * W;
        if (type[n] !== LOOSE) continue;
        if (!a.carry) { a.carry = 'grain'; a.carryCol = col[n]; setCell(n, AIR); sim.stats.dug++; a.busy = DIG_TICKS; return; }
      }
      // Holding a grain and walled in underground: set it down and dig instead.
      // (Never next to the entrance: it would only roll back down the shaft.)
      if (a.carry === 'grain' && (underground(k) ? true : Math.abs(a.x - ex) > 10) && dropNear(a, LOOSE, a.carryCol)) { a.carry = null; a.dumpX = null; }
    }

    function surfaceWalk(a, s) {
      const k = idx(a.x, a.y);
      const opts2 = [[s, 1], [s, 0], [s, -1], [0, -1]];
      for (const [dx, dy] of opts2) {
        const n = k + dx + dy * W;
        if (walkable(n) && canStep(k, dx, dy) && type[n + W] !== AIR) { moveTo(a, n); return; }
      }
      for (const [dx, dy] of opts2) { const n = k + dx + dy * W; if (walkable(n) && canStep(k, dx, dy)) { moveTo(a, n); return; } }
      if (Math.abs(a.x - ex) > 10) a.dumpX = a.x; // can't go further: drop here
      else a.dumpX = ex - (a.dumpX - ex); // try the other side
    }

    function stepQueen(a) {
      const pop = sim.ants.length + sim.brood.length;
      if (sim.royal && sim.royal.done && !a.home) {
        const r = sim.royal.room;
        const res = follow(a, field('royal', () => near(r.cx, r.cy + r.ry - 1, 1)));
        if (res === 'arrived') a.home = true;
        return;
      }
      a.eggT = (a.eggT || 0) + 1;
      if (a.eggT >= 10 && pop < sim.cap()) {
        a.eggT = 0;
        const crumbs = [];
        for (let y = a.y - 4; y <= a.y + 4; y++) for (let x = a.x - 6; x <= a.x + 6; x++) if (inside(x, y) && type[idx(x, y)] === CRUMB) crumbs.push(idx(x, y));
        if (crumbs.length >= 2) {
          setCell(crumbs[0], AIR); setCell(crumbs[1], AIR); sim.stats.eaten += 2;
          sim.brood.push({ id: sim.nextId++, x: a.x, y: a.y, age: 0, stage: 0, inRoom: false, nurse: 0, carried: false });
          sim.stats.laid++;
        }
      }
    }
    sim.cap = () => Math.min(90, 10 + 8 * sim.projects.filter((p) => p.done && p.room && !p.failed).length);

    function stepBrood() {
      for (let i = sim.brood.length - 1; i >= 0; i--) {
        const b = sim.brood[i];
        if (b.carried) { const n = sim.ants.find((a) => a.brood === b); if (n) { b.x = n.x; b.y = n.y; } continue; }
        if (type[idx(b.x, b.y + 1)] === AIR) { b.y++; continue; } // settles one cell per tick
        if (type[idx(b.x, b.y)] !== AIR) { b.y--; continue; }
        b.age += b.inRoom ? 1 : 0.4;
        while (b.stage < 3 && b.age >= BROOD_STAGES[b.stage]) b.stage++;
        if (b.stage >= 3) { sim.brood.splice(i, 1); addAnt(b.x, b.y, 'worker'); sim.stats.born++; }
      }
    }

    // ---------- planner: what the colony digs next ----------
    function plan() {
      const open = sim.projects.filter((p) => !p.done);
      // Housekeeping: grains that slid or fell into a finished room get carried back out.
      if (sim.tick % 100 === 1) for (const r of sim.projects) {
        if (!r.done || r.failed || !r.room || r.kind === 'clear' || r.kind === 'food') continue;
        let n = 0; for (const k of r.cells) if (type[k] === LOOSE) n++;
        if (n >= 6 && !open.some((p) => p.kind === 'clear' && p.room.cx === r.room.cx && p.room.cy === r.room.cy)) {
          const c = newProject('clear', -1, null, r.room); c.cells.sort((a, b) => a - b); return;
        }
      }
      if (!sim.royal) {
        const gx = ex + ri(-10, 10), gy = surf[ex] + ri(24, 30);
        sim.royal = newProject('royal', idx(ex, surf[ex] - 1), { x: gx, y: gy }, { cx: gx, cy: gy, rx: 7, ry: 3, shape: 'dome' });
        return;
      }
      if (sim.royal.done && !sim.broodRoom) {
        const r = sim.royal.room, side = rnd() < 0.5 ? -1 : 1;
        const gx = Math.max(12, Math.min(W - 12, r.cx + side * ri(14, 24))), gy = Math.min(H - 10, r.cy + ri(14, 20));
        const st = nearestTunnel(gx, gy);
        sim.broodRoom = newProject('brood', st.k, { x: gx, y: gy }, { cx: gx, cy: gy, rx: 6, ry: 3, shape: 'dome' });
        return;
      }
      // A finished agent task orders a gallery: a wide, flat hall, the one room ants dig that can fail.
      if (sim.galleryQueue.length && sim.royal.done && !open.some((p) => p.kind === 'gallery')) {
        const g = sim.galleryQueue.shift();
        // beside a random stretch of existing tunnel, so the hall starts digging straight away
        const spots = [];
        const b = sim.box;
        for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) { const k = idx(x, y); if (type[k] === AIR && y > surf[x] + 8 && walkable(k)) spots.push(k); }
        if (!spots.length) { sim.galleryQueue.unshift(g); return; }
        const sp = spots[Math.floor(rnd() * spots.length)], side = rnd() < 0.5 ? -1 : 1;
        g.x = Math.max(4 + (g.w >> 1), Math.min(W - 5 - (g.w >> 1), sp % W + side * ((g.w >> 1) + 3)));
        g.y = Math.min(H - 8, ((sp / W) | 0) - 1);
        newProject('gallery', sp, { x: g.x - side * ((g.w >> 1) - 1), y: g.y + 1 }, { cx: g.x, cy: g.y, rx: g.w >> 1, ry: 2, shape: 'flat' });
        return;
      }
      const workers = sim.ants.length - 1;
      const max = Math.min(4, 1 + Math.floor(workers / 6));
      if (open.length >= max) return;
      if (!sim.royal.done) return;
      let best = null, bd = Infinity, bst = null;
      for (const p of sim.pockets) {
        if (p.claimed || p.remaining <= 0) continue;
        const st = nearestTunnel(p.x, p.y);
        if (st.k >= 0 && st.d <= sim.scent && st.d < bd) { bd = st.d; best = p; bst = st; }
      }
      if (best) {
        best.claimed = true;
        const cells = [];
        for (let k = 0; k < N; k++) if (pocket[k] === best.id) cells.push(k);
        const pr = newProject('food', bst.k, { x: best.x, y: best.y }, null);
        pr.cells = cells.sort((a, b) => Math.hypot(a % W - best.x, ((a / W) | 0) - best.y) - Math.hypot(b % W - best.x, ((b / W) | 0) - best.y));
        pr.pocket = best.id;
        return;
      }
      if (open.length === 0) {
        // nothing smelled: push a scouting tunnel out and widen the colony's sense of smell
        const b = sim.box;
        const tries = 30;
        for (let i = 0; i < tries; i++) {
          const x = ri(b.x0, b.x1), y = ri(b.y0, b.y1), k = idx(x, y);
          if (type[k] !== AIR || y <= surf[x] + 3 || !walkable(k)) continue;
          const ang = Math.PI * (0.1 + rnd() * 0.8) + (rnd() < 0.3 ? (rnd() < 0.5 ? -0.9 : 0.9) : 0), len = ri(22, 40);
          const gx = Math.max(6, Math.min(W - 7, Math.round(x + Math.cos(ang) * len))), gy = Math.max(surf[gx] + 8, Math.min(H - 6, Math.round(y + Math.sin(ang) * len)));
          newProject('scout', k, { x: gx, y: gy }, null);
          sim.scent += 10;
          return;
        }
      }
    }

    // ---------- physics ----------
    function stepSand() {
      if (!sim.sandAwake) return;
      let moved = 0;
      const flip = sim.tick & 1;
      for (let y = H - 2; y >= 1; y--) {
        for (let i = 1; i < W - 1; i++) {
          const x = flip ? W - 1 - i : i, k = y * W + x;
          if (!FALLS[type[k]]) continue;
          const b = k + W;
          if (type[b] === AIR && !occ[b]) { swap(k, b); moved++; continue; }
          const d = rnd() < 0.5 ? -1 : 1;
          if (type[k + d] === AIR && type[b + d] === AIR && !occ[b + d]) { swap(k, b + d); moved++; continue; }
          if (type[k - d] === AIR && type[b - d] === AIR && !occ[b - d]) { swap(k, b - d); moved++; }
        }
      }
      if (moved) { sim.version++; }
      sim.sandAwake = moved > 0;
      sim.falling = moved;
    }

    // A flat ceiling wider than its layer's span strains, cracks for a moment, then its middle drops.
    function checkCeilings() {
      const b = sim.box;
      for (let y = Math.max(1, b.y0 - 1); y <= Math.min(H - 3, b.y1); y++) {
        let x = 1;
        while (x < W - 1) {
          const k = y * W + x;
          if (CEILING[type[k]] && type[k + W] === AIR && y >= surf[x]) {
            const x0 = x;
            while (x < W - 1 && CEILING[type[y * W + x]] && type[y * W + x + W] === AIR) x++;
            const x1 = x - 1, L = x1 - x0 + 1, lim = span[y * W + ((x0 + x1) >> 1)] || 14;
            if (L > lim && !sim.strains.some((s) => s.y === y && s.x0 <= x1 && s.x1 >= x0)) {
              const recent = sim.events.some((e) => e.type === 'collapse' && sim.tick - e.tick < 60 && Math.abs(e.y - y) < 6);
              sim.strains.push({ y, x0, x1, lim, t: recent ? 8 : 40 });
            }
          } else x++;
        }
      }
    }
    function stepStrains() {
      for (let i = sim.strains.length - 1; i >= 0; i--) {
        const s = sim.strains[i];
        if (--s.t > 0) continue;
        sim.strains.splice(i, 1);
        const m = Math.max(1, Math.floor(s.lim / 4));
        let n = 0;
        for (let x = s.x0 + m; x <= s.x1 - m; x++) {
          const k = s.y * W + x;
          if (CEILING[type[k]] && type[k + W] === AIR) { setCell(k, type[k] === FOOD ? CRUMB : LOOSE); n++; }
        }
        if (!n) continue;
        sim.stats.collapses++;
        sim.events.push({ type: 'collapse', tick: sim.tick, y: s.y, x0: s.x0 + m, x1: s.x1 - m });
        if (sim.events.length > 50) sim.events.shift();
        const open = sim.projects.find((p) => p.kind === 'clear' && !p.done && Math.abs(p.room.cy - s.y) < 10 && Math.abs(p.room.cx - ((s.x0 + s.x1) >> 1)) < 20);
        if (!open) {
          const p = newProject('clear', -1, null, { cx: (s.x0 + s.x1) >> 1, cy: s.y + 6, rx: ((s.x1 - s.x0) >> 1) + 6, ry: 9, shape: 'flat' });
          p.cells.sort((a, b) => a - b);
        }
      }
    }
    // Soil no longer connected to the glass frame by solid cells comes loose.
    function checkIslands() {
      const seen = new Uint8Array(N);
      let qh = 0, qt = 0;
      for (let k = 0; k < N; k++) if (type[k] === GLASS) { seen[k] = 1; queue[qt++] = k; }
      while (qh < qt) {
        const k = queue[qh++];
        for (const n of [k - 1, k + 1, k - W, k + W]) {
          if (n < 0 || n >= N || seen[n] || !SOLID[type[n]] || FALLS[type[n]]) continue;
          seen[n] = 1; queue[qt++] = n;
        }
      }
      for (let k = 0; k < N; k++) {
        if (seen[k] || !SOLID[type[k]] || FALLS[type[k]]) continue;
        setCell(k, type[k] === FOOD ? CRUMB : LOOSE);
      }
    }

    // ---------- public API ----------
    sim.step = function () {
      sim.tick++;
      sim.moves = 0;
      sim.energy = Math.min(5000, sim.energy + 0.03);
      if (sim.crumbQueue >= 1 && sim.tick % 5 === 0) {
        const x = Math.max(2, Math.min(W - 3, ex + (rnd() < 0.5 ? -1 : 1) * ri(8, 50)));
        const k = idx(x, 2);
        if (type[k] === AIR) { setCell(k, CRUMB, shadeHex(PAL.crumb, 0.9 + rnd() * 0.2, 0)); sim.crumbQueue--; sim.stats.crumbsSpawned++; }
      }
      if (sim.tick % 20 === 1) { plan(); sim.crumbsOut = looseCrumbs(); }
      for (let i = 0; i < sim.ants.length; i++) stepAnt(sim.ants[i]);
      stepBrood();
      stepSand();
      if (sim.tick % 5 === 0 && sim.version !== sim.lastCheckVer) { sim.lastCheckVer = sim.version; checkCeilings(); }
      stepStrains();
      if (sim.tick % 60 === 0 && sim.version !== sim.lastIslandVer) { sim.lastIslandVer = sim.version; checkIslands(); }
      for (const [key, f] of sim.fields) if (sim.tick - f.at > 400) sim.fields.delete(key);
      if (sim.projects.length > 40) sim.projects = sim.projects.filter((p) => !p.done || p === sim.royal || p === sim.broodRoom);
    };
    sim.run = function (n) { for (let i = 0; i < n; i++) sim.step(); };

    // Agent activity in. See docs/ant-farm-design.md, "How tokens feed the farm".
    sim.feed = function (ev) {
      if (!ev) return;
      if (ev.type === 'tokens') {
        // Cache reads are cheap re-reads of context: they count a tenth.
        const t = Math.max(0, (ev.input || 0) + (ev.output || 0) + (ev.cache_write || 0) + 0.1 * (ev.cache_read || 0) + (ev.tokens || 0));
        sim.stats.tokens += t;
        sim.energy = Math.min(5000, sim.energy + t / TOKENS_PER_ENERGY);
        sim.crumbQueue += t / TOKENS_PER_CRUMB;
      } else if (ev.type === 'task_done') {
        sim.stats.tasks++;
        sim.galleryQueue.push({ w: Math.max(6, Math.min(40, ev.width || ri(10, 18))) });
      }
    };

    sim.isBusy = () => sim.moves > 2 || sim.sandAwake || sim.strains.length > 0;

    // Area worth looking at: everything touched, the ants, and the ground around the nest.
    sim.interestBox = function () {
      let { x0, y0, x1, y1 } = sim.box;
      x0 = Math.min(x0, ex - 40); x1 = Math.max(x1, ex + 40);
      y0 = Math.min(y0, surf[ex] - 14); y1 = Math.max(y1, surf[ex] + 34);
      for (const a of sim.ants) { if (a.x < x0) x0 = a.x; if (a.x > x1) x1 = a.x; if (a.y < y0) y0 = a.y; if (a.y > y1) y1 = a.y; }
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    };

    sim.count = function () {
      const c = [0, 0, 0, 0, 0, 0, 0];
      for (let k = 0; k < N; k++) c[type[k]]++;
      let grain = 0, food = 0;
      for (const a of sim.ants) { if (a.carry === 'grain') grain++; if (a.carry === 'food') food++; }
      return { air: c[AIR], dirt: c[DIRT], rock: c[ROCK], loose: c[LOOSE], food: c[FOOD], crumb: c[CRUMB], carriedGrain: grain, carriedFood: food };
    };

    sim.hash = function () {
      let h = 2166136261;
      for (let k = 0; k < N; k++) { h ^= type[k]; h = Math.imul(h, 16777619); }
      for (const a of sim.ants) { h ^= a.x * 31 + a.y; h = Math.imul(h, 16777619); }
      return h >>> 0;
    };

    // Paint the world into a W*H RGBA buffer (one pixel per cell). The ants come too unless o.ants is false
    // (the page can draw them as sprites on top instead: see render.js). With o.kind (a W*H Uint8Array) it also
    // writes what each pixel shows (K.*), so a palette can recolour soil, food and ants separately: see palettes.js.
    sim.paint = function (px, o) {
      const kind = o && o.kind;
      // loose grains (spoil, rubble) show a shade lighter than packed soil, like fresh-dug earth
      for (let k = 0; k < N; k++) { const t = type[k]; px[k] = t === AIR ? bg[k] : t === LOOSE ? scaleCol(col[k], 1.18) : col[k]; }
      if (kind) {
        for (let k = 0; k < N; k++) {
          const t = type[k], x = k % W, y = (k - x) / W;
          kind[k] = t === AIR ? (y < surf[x] ? K.SKY : K.WALL) : t === DIRT ? (y === surf[x] ? K.GRASS : K.SOIL) : t === LOOSE ? K.LOOSE
            : t === ROCK ? K.ROCK : t === FOOD || t === CRUMB ? K.FOOD : K.GLASS;
        }
      }
      for (const s of sim.strains) {
        // hairline cracks spreading through the sagging ceiling, darker as it nears failure
        const f = 1 - s.t / 40;
        for (let x = s.x0; x <= s.x1; x++) {
          const h = (x * 7 + s.y * 3) % 5;
          for (let dy = 0; dy < 3; dy++) {
            const k = (s.y - dy) * W + x;
            if (type[k] !== AIR && (h === dy || (dy === 0 && (x + (sim.tick >> 2)) % 3 === 0)) && h + dy < 2 + f * 4) { px[k] = scaleCol(col[k], 0.45); if (kind) kind[k] = K.CRACK; }
          }
        }
      }
      let kNow = K.BROOD;
      const put = (x, y, c) => { if (x > 0 && y > 0 && x < W - 1 && y < H - 1) { px[y * W + x] = c; if (kind) kind[y * W + x] = kNow; } };
      const BROOD = [rgb(238, 232, 214), rgb(226, 212, 182), rgb(201, 179, 140)];
      for (const b of sim.brood) {
        if (b.carried) continue;
        put(b.x, b.y, BROOD[Math.min(2, b.stage)]);
        if (b.stage > 0) put(b.x + (b.id & 1 ? 1 : -1), b.y, BROOD[Math.min(2, b.stage)]);
      }
      if (o && o.ants === false) return;
      const body = rgb(158, 76, 54), gaster = rgb(104, 49, 36), head = rgb(122, 58, 42), legs = rgb(70, 36, 28);
      const qBody = rgb(196, 116, 80), qGaster = rgb(140, 72, 52);
      for (const a of sim.ants) {
        const hx = a.hx || 0, hy = a.hy || 0;
        const dx = hx === 0 && hy === 0 ? 1 : hx, dy = hx === 0 && hy === 0 ? 0 : hy;
        if (a.role === 'queen') {
          kNow = K.QUEEN;
          put(a.x - 2 * dx, a.y - 2 * dy, qGaster); put(a.x - dx, a.y - dy, qGaster);
          put(a.x - dx + dy, a.y - dy - dx, qGaster);
          put(a.x, a.y, qBody); put(a.x + dx, a.y + dy, head);
          continue;
        }
        kNow = K.ANT;
        put(a.x - dx, a.y - dy, gaster); put(a.x, a.y, body); put(a.x + dx, a.y + dy, head);
        if ((a.walk >> 1) & 1) put(a.x - dy, a.y + dx, legs);
        kNow = a.carry === 'food' ? K.LOAD_FOOD : a.carry === 'grain' ? K.LOAD_GRAIN : K.BROOD;
        if (a.carry === 'grain' || a.carry === 'food') put(a.x + 2 * dx, a.y + 2 * dy, a.carryCol);
        else if (a.carry === 'brood' && a.brood) put(a.x + 2 * dx, a.y + 2 * dy, BROOD[Math.min(2, a.brood.stage)]);
      }
    };

    return sim;
  }

  const api = { createSim, K, AIR, DIRT, ROCK, LOOSE, FOOD, CRUMB, GLASS, TICK_HZ, TOKENS_PER_ENERGY, TOKENS_PER_CRUMB, LAYERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AntSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
