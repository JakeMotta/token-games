// The ant farm simulation: the world, its physics and the colony. Deterministic per seed: the same seed, the same
// token events and the same clock always build and play the same farm. No DOM and no Electron, so it runs headless
// in the tests.
//
// The map can be enormous (MAP_SIZES), so nothing here is proportional to it. Cells live in 64 × 64 chunks made from
// the seed on demand (chunks.ts); a cell's index packs its row and column, k = y << XB | x. Path-finding runs over a
// copy of the window around the colony, falling sand only in chunks where something moved, and the collapse checks
// only where something changed. A part of the map nobody looks at and the colony never touched costs nothing.
import {
  AIR, DIRT, ROCK, LOOSE, FOOD, CRUMB, GLASS, SOLID, DIGGABLE, FALLS, CEILING, K, LAYERS, LAYER_OF_SRC, PAL, SRC,
  DIG_TICKS, DROP_TICKS, BROOD_STAGES, MAX_ENERGY, MAP_SIZES, type MapSize, mulberry32, rgb, hexRgb, scaleCol, hash01, noiseAt,
  jitterShade, COLOURS, LOOSE_COLOURS, WALL_COLOURS, type Rng, LOOSE_CRUMB_CAP, MAX_CRUMB_QUEUE, STORE_CAP,
  ANT_LIFESPAN_MS, LIFESPAN_JITTER, QUEEN_LIFESPAN_MS, ANT_MEAL_MS, STARVE_DEATH_MS, STARVE_GRACE_MS, MIN_SURVIVORS, DYING_TICKS,
} from './world';
import { CS, CM, CELLS, ChunkStore, applyDiff, type Chunk, type ChunkStats } from './chunks';
import { TokenMeter } from './tokens';
import type { FarmEvent } from '../shared/events';

export interface SimOptions {
  seed?: number; size?: MapSize; W?: number; H?: number; span?: number; rocks?: boolean; food?: boolean;
  colony?: boolean; workers?: number; energy?: number;
  now?: () => number; // the wall clock in ms (ants age by it); Date.now unless a test passes its own
  restore?: SaveData | null; // a saved farm to carry on with
  chunkCap?: number; // unchanged chunks kept in memory
}
export interface Point { x: number; y: number }
export interface Room { cx: number; cy: number; rx: number; ry: number; shape: 'dome' | 'flat' }
export type ProjectKind = 'royal' | 'brood' | 'gallery' | 'food' | 'scout' | 'clear';
export interface Project {
  id: number; kind: ProjectKind; head: number; goal: Point | null; room: Room | null; phase: 'tunnel' | 'room'; ang: number;
  cells: number[] | null; work: number; done: boolean; stuck: number; diggers: number; failed?: boolean; cands?: number[]; pocket?: number;
}
export interface Pocket { id: number; x: number; y: number; kind: 'seed' | 'fungus'; total: number; remaining: number; claimed: boolean }
export type Role = 'worker' | 'queen';
export interface Job { type: 'rest' | 'forage' | 'nurse' | 'dig'; t?: number; id?: number; pid?: number }
export interface Brood { id: number; x: number; y: number; age: number; stage: number; inRoom: boolean; nurse: number; carried: boolean }
export interface Ant {
  id: number; x: number; y: number; hx: number; hy: number; role: Role; job: Job | null; carry: 'grain' | 'food' | 'brood' | null;
  carryCol: number; busy: number; acc: number; speed: number; walk: number; stuckT: number; brood: Brood | null;
  born: number; dies: number; // wall-clock ms
  dying?: number; // ticks left of its fade-out
  dumpX?: number | null; dumpAt?: number; home?: boolean; eggT?: number;
}
export interface Strain { y: number; x0: number; x1: number; lim: number; t: number }
export type SimEvent =
  | { type: 'collapse'; tick: number; y: number; x0: number; x1: number }
  | { type: 'died'; tick: number; cause: 'age' | 'hunger'; queen: boolean }
  | { type: 'queen'; tick: number } // a worker took over from an old queen
  | { type: 'founded'; tick: number }; // a new queen arrived at an empty farm
export interface Field { dist: Int32Array; x0: number; y0: number; w: number; h: number; ver: number; at: number; sources: () => number[] }
export interface PaintOptions { kind?: Uint8Array; ants?: boolean }
export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Stats {
  dug: number; stored: number; eaten: number; laid: number; born: number; collapses: number; crumbsSpawned: number; tokens: number; tasks: number;
  died: number; starved: number;
}
export interface Counts { air: number; dirt: number; rock: number; loose: number; food: number; crumb: number; carriedGrain: number; carriedFood: number }
export interface Life { last: number; hunger: number; starve: number; starvingSince: number; lastTokens: number }
export type Mood = 'fed' | 'hungry' | 'starving' | 'empty';
export interface Health { workers: number; queen: boolean; brood: number; food: number; loose: number; oldestMs: number; queenAgeMs: number; mood: Mood; starvingMs: number }
export type Put = (x: number, y: number, c: number, kind: number, alpha: number) => void;

export interface SaveData {
  v: 1; seed: number; W: number; H: number; tick: number; energy: number; crumbQueue: number; galleryQueue: { w: number }[];
  scent: number; box: Box; nest: Point; nextId: number; rng: number; stats: Stats; life: Life; meter: [number, number][];
  ants: Partial<Ant>[]; brood: Brood[]; projects: Partial<Project>[]; royal: number; broodRoom: number;
  pockets: [number, number, number][]; chunks: [number, string][];
}

export interface Sim {
  seed: number; W: number; H: number; XB: number; R: number; // R is the row stride of a cell index
  surf: Int16Array; pockets: Map<number, Pocket>; ex: number; nest: Point; tick: number; version: number; rnd: Rng;
  ants: Ant[]; brood: Brood[]; projects: Project[]; strains: Strain[]; events: SimEvent[];
  energy: number; crumbQueue: number; galleryQueue: { w: number; x?: number; y?: number }[]; scent: number;
  royal: Project | null; broodRoom: Project | null; box: Box; view: Box | null;
  sandAwake: boolean; moves: number; falling: number; crumbsOut: number;
  stats: Stats; fields: Map<string, Field>; nextId: number; meter: TokenMeter; life: Life; chunks: ChunkStore; now: () => number;
  typeAt(k: number): number;
  colAt(k: number): number;
  setCell(k: number, t: number, c?: number): void;
  idx(x: number, y: number): number;
  walkable(k: number): boolean;
  pocketsIn(b: Box): Pocket[];
  newProject(kind: ProjectKind, startK: number, goal: Point | null, room: Room | null): Project;
  nextCells(p: Project): number[];
  addAnt(x: number, y: number, role?: Role): Ant;
  cap(): number;
  step(): void;
  run(n: number): void;
  feed(ev: FarmEvent | null | undefined): void;
  isBusy(): boolean;
  interestBox(): { x: number; y: number; w: number; h: number };
  setView(b: Box | null): void;
  maintain(): void;
  chunkStats(): ChunkStats;
  stored(): number;
  health(): Health;
  count(b?: Box): Counts;
  hash(): number;
  paintChunk(cx: number, cy: number, px: Uint32Array, kind: Uint8Array): void;
  overlay(b: Box, put: Put): void;
  paint(px: Uint32Array, o?: PaintOptions): void;
  save(): SaveData;
}

const SMALL = 4_194_304; // a map up to this many cells is counted, hashed and painted whole

export function createSim(opts: SimOptions = {}): Sim {
  const R0 = opts.restore && opts.restore.v === 1 ? opts.restore : null;
  const seed = ((R0 ? R0.seed : opts.seed) ?? 1) >>> 0;
  const sz = opts.size ? MAP_SIZES[opts.size] : null;
  const W = R0 ? R0.W : opts.W || (sz ? sz.W : 420), H = R0 ? R0.H : opts.H || (sz ? sz.H : 260);
  let XB = 0; while ((1 << XB) < W) XB++;
  const R = 1 << XB, XM = R - 1;
  const now = opts.now || Date.now;
  const rnd = mulberry32(R0 ? R0.rng : seed);
  const ri = (a: number, b: number): number => a + Math.floor(rnd() * (b - a + 1));
  const idx = (x: number, y: number): number => (y << XB) | x;
  const inside = (x: number, y: number): boolean => x > 0 && y > 0 && x < W - 1 && y < H - 1;

  // ---------- the map, made from the seed one cell at a time ----------
  const base = Math.round(Math.min(H, 260) * 0.17);
  const surf = new Int16Array(W), wob = new Int8Array(W);
  for (let x = 0; x < W; x++) {
    surf[x] = Math.round(base + noiseAt(seed, 1, x, 37) * 4 + noiseAt(seed, 2, x, 11) * 1.2);
    wob[x] = Math.round(noiseAt(seed, 3, x, 23) * 3);
  }
  // soil layers by depth below the ground line
  const band = new Uint8Array(H + 8);
  {
    const br = mulberry32(seed ^ 0x5bd1e995), rr = (a: number, b: number) => a + Math.floor(br() * (b - a + 1));
    const order = [SRC.LOAM, SRC.SAND, SRC.LOAM, SRC.CLAY, SRC.SAND, SRC.DEEP, SRC.CLAY, SRC.LOAM];
    let d = rr(4, 7), oi = rr(0, 3);
    band.fill(SRC.TOPSOIL, 0, d);
    while (d < band.length) { const n = rr(14, 38); band.fill(order[oi++ % order.length], d, Math.min(band.length, d + n)); d += n; }
  }
  const ex = Math.max(8, Math.min(W - 9, Math.round(W / 2 + (hash01(seed, 7, 7, 7) - 0.5) * Math.min(W, 420) * 0.3))); // nest entrance column
  const spanOf = (x: number, y: number): number => opts.span || LAYERS[LAYER_OF_SRC[band[Math.max(0, Math.min(H, y - surf[x] + wob[x]))]]].span;

  // Rocks: at most one per 64-cell square, more likely deeper down. Food pockets: at most one per 96-cell square.
  // Each blob stays inside its own square, so a cell only ever asks its own square.
  interface Blob { x: number; y: number; r: number; kind: number }
  const NONE: Blob = { x: 0, y: 0, r: 0, kind: -1 };
  const rockCache = new Map<number, Blob>(), podCache = new Map<number, Blob>();
  const PR = 96, pcw = Math.ceil(W / PR);
  function rockOf(rx: number, ry: number): Blob {
    const key = ry * 65536 + rx;
    let b = rockCache.get(key);
    if (b) return b;
    b = NONE;
    if (opts.rocks !== false) {
      const depth = ry * 64 - base, chance = depth < 0 ? 0 : 0.22 + 0.25 * Math.min(1, depth / 2000);
      if (hash01(seed, rx, ry, 11) < chance) {
        const x = rx * 64 + 8 + Math.floor(hash01(seed, rx, ry, 12) * 48), y = ry * 64 + 8 + Math.floor(hash01(seed, rx, ry, 13) * 48);
        const ok = x >= 10 && x < W - 10 && y < H - 8 && y >= surf[x] + 12 && !(Math.abs(x - ex) < 30 && y < surf[ex] + 45);
        if (ok) b = { x, y, r: 2 + hash01(seed, rx, ry, 14) * 4, kind: SRC.ROCK };
      }
    }
    if (rockCache.size > 8192) rockCache.clear();
    rockCache.set(key, b);
    return b;
  }
  function podOf(id: number): Blob {
    let b = podCache.get(id);
    if (b) return b;
    b = NONE;
    if (opts.food !== false) {
      const px = id % pcw, py = (id - px) / pcw;
      if (hash01(seed, px, py, 21) < 0.8) {
        const x = px * PR + 12 + Math.floor(hash01(seed, px, py, 22) * 72), y = py * PR + 12 + Math.floor(hash01(seed, px, py, 23) * 72);
        const ok = x >= 8 && x < W - 9 && y < H - 8 && y >= surf[x] + 18 && Math.hypot(x - ex, y - surf[ex]) >= 30;
        if (ok) b = { x, y, r: 1.6 + hash01(seed, px, py, 24) * 1.8, kind: hash01(seed, px, py, 25) < 0.6 ? SRC.SEED : SRC.FUNGUS };
      }
    }
    if (podCache.size > 8192) podCache.clear();
    podCache.set(id, b);
    return b;
  }
  const podId = (x: number, y: number): number => ((y / PR) | 0) * pcw + ((x / PR) | 0);
  function inBlob(b: Blob, x: number, y: number, salt: number): boolean {
    if (b.kind < 0) return false;
    const dx = x - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
    if (d2 > (b.r * 1.15 + 0.5) * (b.r * 1.15 + 0.5)) return false;
    const rr = b.r * (0.85 + 0.3 * hash01(seed, x, y, salt));
    return d2 <= rr * rr;
  }
  // One cell as made: type | colour code << 8.
  function cellAt(x: number, y: number): number {
    if (x <= 0 || x >= W - 1 || y >= H - 1 || y < 0) return GLASS;
    const s = surf[x];
    if (y < s) return AIR;
    if (y > s && inBlob(rockOf(x >> 6, y >> 6), x, y, 15)) return ROCK | ((SRC.ROCK << 8 | Math.floor(hash01(seed, x, y, 16) * 256)) << 8);
    const pod = podOf(podId(x, y));
    if (y > s && inBlob(pod, x, y, 26)) return FOOD | ((pod.kind << 8 | Math.floor(hash01(seed, x, y, 27) * 256)) << 8);
    const j = (hash01(seed, x, y, 17) - 0.5) * 14 + ((x * 7 + y * 13) % 5 === 0 ? -6 : 0);
    const src = y === s ? SRC.GRASS : band[Math.max(0, Math.min(H, y - s + wob[x]))];
    return DIRT | ((src << 8 | jitterShade(j)) << 8);
  }
  function genChunk(cx: number, cy: number, t: Uint8Array, c: Uint16Array): void {
    const x0 = cx << CS, y0 = cy << CS;
    for (let ly = 0, i = 0; ly < 64; ly++) for (let lx = 0; lx < 64; lx++, i++) {
      const x = x0 + lx, y = y0 + ly;
      if (x >= W || y >= H) { t[i] = GLASS; c[i] = 0; continue; }
      const v = cellAt(x, y);
      t[i] = v & 255; c[i] = v >>> 8;
    }
  }
  const store = new ChunkStore(W, H, genChunk), cw = store.cw;

  // ---------- cell access ----------
  function T(k: number): number {
    if (k < 0) return GLASS;
    const x = k & XM, y = k >> XB;
    if (x >= W || y >= H) return GLASS;
    return store.get((y >> CS) * cw + (x >> CS)).type![((y & CM) << CS) | (x & CM)];
  }
  function C(k: number): number {
    const x = k & XM, y = k >> XB;
    return store.get((y >> CS) * cw + (x >> CS)).col![((y & CM) << CS) | (x & CM)];
  }
  function write(k: number, t: number, c?: number): void {
    const x = k & XM, y = k >> XB, ch = store.get((y >> CS) * cw + (x >> CS)), i = ((y & CM) << CS) | (x & CM);
    ch.type![i] = t; if (c !== undefined) ch.col![i] = c;
    ch.modified = true; ch.ver++;
    mark(x, y);
  }

  // where things changed since the last collapse checks, and which chunks have grains that may fall
  const dirty: Box = { x0: 1, y0: 1, x1: 0, y1: 0 }, idirty: Box = { x0: 1, y0: 1, x1: 0, y1: 0 };
  const awake = new Set<number>();
  function grow(b: Box, x: number, y: number) {
    if (b.x0 > b.x1) { b.x0 = b.x1 = x; b.y0 = b.y1 = y; return; }
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
  }
  function mark(x: number, y: number) {
    grow(dirty, x, y); grow(idirty, x, y);
    // this chunk, and its neighbours when the cell is on an edge (a grain above may now fall into it)
    const a = (Math.max(0, y - 1) >> CS) * cw, b = (Math.min(H - 1, y + 1) >> CS) * cw, l = Math.max(0, x - 1) >> CS, r = Math.min(W - 1, x + 1) >> CS;
    awake.add(a + l); awake.add(a + r); awake.add(b + l); awake.add(b + r);
  }

  const occ = new Map<number, number>(); // ants standing in a cell: grains rest on them instead of filling it
  const occAdd = (k: number, d: number) => { const n = (occ.get(k) || 0) + d; if (n > 0) occ.set(k, n); else occ.delete(k); };

  // ---------- simulation state ----------
  const sim = {
    seed, W, H, XB, R, surf, pockets: new Map<number, Pocket>(), ex, nest: { x: ex + 5, y: 0 },
    tick: 0, version: 0, rnd,
    ants: [], brood: [], projects: [], strains: [], events: [],
    energy: opts.energy == null ? 320 : opts.energy,
    crumbQueue: 0, galleryQueue: [], scent: 40,
    royal: null, broodRoom: null, view: null,
    box: { x0: ex - 1, y0: surf[ex] - 1, x1: ex + 1, y1: surf[ex] + 1 }, // everything the colony has touched
    sandAwake: false, moves: 0, falling: 0, crumbsOut: 0,
    stats: { dug: 0, stored: 0, eaten: 0, laid: 0, born: 0, collapses: 0, crumbsSpawned: 0, tokens: 0, tasks: 0, died: 0, starved: 0 },
    fields: new Map<string, Field>(),
    nextId: 1,
    meter: new TokenMeter(),
    life: { last: now(), hunger: 0, starve: 0, starvingSince: 0, lastTokens: 0 },
    chunks: store, now,
  } as unknown as Sim;

  function touch(x: number, y: number) {
    const b = sim.box;
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
  }
  function pocketAt(id: number): Pocket | null {
    let p = sim.pockets.get(id);
    if (p) return p;
    const b = podOf(id);
    if (b.kind < 0) return null;
    p = { id, x: b.x, y: b.y, kind: b.kind === SRC.SEED ? 'seed' : 'fungus', total: 0, remaining: 0, claimed: false };
    for (let y = b.y - 5; y <= b.y + 5; y++) for (let x = b.x - 5; x <= b.x + 5; x++) if ((cellAt(x, y) & 255) === FOOD && podId(x, y) === id) p.total++;
    if (!p.total) return null;
    p.remaining = p.total;
    sim.pockets.set(id, p);
    return p;
  }
  sim.pocketsIn = function (b: Box): Pocket[] {
    const out: Pocket[] = [];
    for (let py = Math.max(0, Math.floor(b.y0 / PR)); py <= Math.min(Math.ceil(H / PR) - 1, Math.floor(b.y1 / PR)); py++)
      for (let px = Math.max(0, Math.floor(b.x0 / PR)); px <= Math.min(pcw - 1, Math.floor(b.x1 / PR)); px++) {
        const p = pocketAt(py * pcw + px); if (p) out.push(p);
      }
    return out;
  };
  function setCell(k: number, t: number, c?: number) {
    if (T(k) === FOOD && t !== FOOD) { const x = k & XM, y = k >> XB, p = pocketAt(podId(x, y)); if (p) p.remaining--; }
    write(k, t, c);
    sim.version++;
    touch(k & XM, k >> XB);
  }
  function swap(a: number, b: number) {
    const ta = T(a), ca = C(a), tb = T(b), cb = C(b);
    write(a, tb, cb); write(b, ta, ca);
  }
  sim.typeAt = T;
  sim.colAt = C;
  sim.setCell = setCell;
  sim.idx = idx;

  function walkable(k: number): boolean {
    if (T(k) !== AIR) return false;
    if (!inside(k & XM, k >> XB)) return false;
    return SOLID[T(k - 1)] || SOLID[T(k + 1)] || SOLID[T(k - R)] || SOLID[T(k + R)] ||
      SOLID[T(k - R - 1)] || SOLID[T(k - R + 1)] || SOLID[T(k + R - 1)] || SOLID[T(k + R + 1)];
  }
  sim.walkable = walkable;
  // A diagonal step needs one of the two side cells open: no squeezing through a pinhole.
  function canStep(k: number, dx: number, dy: number): boolean {
    if (dx === 0 || dy === 0) return true;
    return T(k + dx) === AIR || T(k + dy * R) === AIR;
  }
  const D8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

  // ---------- the window: a flat copy of the cells around the colony, for path-finding ----------
  // Whole chunks around everything touched and every ant, 64 cells of margin. Copied again only when the world changed.
  interface Snap { x0: number; y0: number; w: number; h: number; t: Uint8Array; ver: number }
  let snap: Snap = { x0: 0, y0: 0, w: 0, h: 0, t: new Uint8Array(0), ver: -1 };
  function windowBox(): Box {
    let { x0, y0, x1, y1 } = sim.box;
    for (const a of sim.ants) { if (a.x < x0) x0 = a.x; if (a.x > x1) x1 = a.x; if (a.y < y0) y0 = a.y; if (a.y > y1) y1 = a.y; }
    const M = 64;
    return {
      x0: Math.max(0, (x0 - M) >> CS) << CS, y0: Math.max(0, (y0 - M) >> CS) << CS,
      x1: ((Math.min(W - 1, x1 + M) >> CS) << CS) + 63, y1: ((Math.min(H - 1, y1 + M) >> CS) << CS) + 63,
    };
  }
  function getSnap(): Snap {
    const b = windowBox(), w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    if (snap.ver === sim.version && snap.x0 === b.x0 && snap.y0 === b.y0 && snap.w === w && snap.h === h) return snap;
    const t = snap.t.length === w * h ? snap.t : new Uint8Array(w * h);
    for (let cy = b.y0 >> CS; cy <= b.y1 >> CS; cy++) for (let cx = b.x0 >> CS; cx <= b.x1 >> CS; cx++) {
      const ct = store.get(cy * cw + cx).type!, ox = (cx << CS) - b.x0, oy = (cy << CS) - b.y0;
      for (let ly = 0; ly < 64; ly++) t.set(ct.subarray(ly << CS, (ly + 1) << CS), (oy + ly) * w + ox);
    }
    snap = { x0: b.x0, y0: b.y0, w, h, t, ver: sim.version };
    return snap;
  }
  // walkable, in the window: open air inside the map, off the window's edge, touching something solid
  function walkL(s: Snap, i: number): boolean {
    const t = s.t, w = s.w;
    if (t[i] !== AIR) return false;
    const lx = i % w, ly = (i - lx) / w;
    if (lx < 1 || ly < 1 || lx >= w - 1 || ly >= s.h - 1) return false;
    const x = lx + s.x0, y = ly + s.y0;
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return false;
    return SOLID[t[i - 1]] || SOLID[t[i + 1]] || SOLID[t[i - w]] || SOLID[t[i + w]] ||
      SOLID[t[i - w - 1]] || SOLID[t[i - w + 1]] || SOLID[t[i + w - 1]] || SOLID[t[i + w + 1]];
  }

  // ---------- distance fields (BFS over walkable air in the window) ----------
  let queue = new Int32Array(0);
  function computeField(f: Field) {
    const s = getSnap(), n = s.w * s.h, w = s.w, t = s.t;
    if (f.dist.length !== n) f.dist = new Int32Array(n);
    if (queue.length < n) queue = new Int32Array(n);
    const dist = f.dist; dist.fill(-1);
    f.x0 = s.x0; f.y0 = s.y0; f.w = s.w; f.h = s.h;
    let qh = 0, qt = 0;
    for (const k of f.sources()) {
      const lx = (k & XM) - s.x0, ly = (k >> XB) - s.y0;
      if (k < 0 || lx < 0 || ly < 0 || lx >= w || ly >= s.h) continue;
      const i = ly * w + lx;
      if (dist[i] < 0 && walkL(s, i)) { dist[i] = 0; queue[qt++] = i; }
    }
    while (qh < qt) {
      const i = queue[qh++], d = dist[i] + 1;
      for (let j = 0; j < 8; j++) {
        const dx = D8[j][0], dy = D8[j][1], m = i + dx + dy * w;
        if (dist[m] >= 0 || t[m] !== AIR) continue;
        if (dx !== 0 && dy !== 0 && t[i + dx] !== AIR && t[i + dy * w] !== AIR) continue;
        if (!walkL(s, m)) continue;
        dist[m] = d; queue[qt++] = m;
      }
    }
    f.ver = sim.version; f.at = sim.tick;
  }
  function distAt(f: Field, k: number): number {
    const lx = (k & XM) - f.x0, ly = (k >> XB) - f.y0;
    return lx < 0 || ly < 0 || lx >= f.w || ly >= f.h ? -1 : f.dist[ly * f.w + lx];
  }
  function field(key: string, sources: () => number[]): Field {
    let f = sim.fields.get(key);
    if (!f) { f = { dist: new Int32Array(0), x0: 0, y0: 0, w: 0, h: 0, ver: -1, at: -99, sources }; sim.fields.set(key, f); computeField(f); return f; }
    f.sources = sources;
    if (f.ver !== sim.version && sim.tick - f.at >= 4) computeField(f);
    return f;
  }
  function near(cx: number, cy: number, r: number): number[] {
    const out: number[] = [];
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (inside(x, y)) out.push(idx(x, y));
    return out;
  }
  // Move one cell down the field. Returns 'arrived', 'moved' or 'stuck'. Never more than one cell.
  function follow(a: Ant, f: Field): 'arrived' | 'moved' | 'stuck' {
    const k = idx(a.x, a.y);
    let d = distAt(f, k);
    if (d === 0) return 'arrived';
    if (d < 0 && sim.tick - f.at > 0) { computeField(f); d = distAt(f, k); if (d === 0) return 'arrived'; }
    if (d < 0) return 'stuck';
    let best = -1, bestD = d, ties = 0;
    for (const [dx, dy] of D8) {
      const n = k + dx + dy * R, nd = distAt(f, n);
      if (nd < 0 || nd > bestD || T(n) !== AIR || !canStep(k, dx, dy) || !walkable(n)) continue;
      if (nd < bestD) { bestD = nd; best = n; ties = 1; } else if (nd === bestD && best >= 0 && nd < d) { ties++; if (rnd() < 1 / ties) best = n; }
    }
    if (best < 0 || bestD >= d) { if (sim.tick - f.at > 0) computeField(f); return 'stuck'; }
    moveTo(a, best);
    return 'moved';
  }
  function moveTo(a: Ant, k: number) {
    const nx = k & XM, ny = k >> XB;
    a.hx = Math.sign(nx - a.x); a.hy = Math.sign(ny - a.y);
    const old = idx(a.x, a.y);
    occAdd(old, -1); occAdd(k, 1);
    if (FALLS[T(old - R)] || FALLS[T(old - R - 1)] || FALLS[T(old - R + 1)]) mark(a.x, a.y - 1);
    a.x = nx; a.y = ny; a.walk++; sim.moves++;
  }

  // ---------- projects: tunnels, rooms, food harvests, rubble clearing ----------
  function roomCells(room: Room): number[] {
    const cells: { k: number; o: number }[] = [];
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
  function newProject(kind: ProjectKind, startK: number, goal: Point | null, room: Room | null): Project {
    const p: Project = {
      id: sim.nextId++, kind, head: startK, goal, room, phase: goal ? 'tunnel' : 'room',
      ang: Math.atan2(goal ? goal.y - (startK >> XB) : 1, goal ? goal.x - (startK & XM) : 0),
      cells: room ? roomCells(room) : null, work: -1, done: false, stuck: 0, diggers: 0,
    };
    sim.projects.push(p);
    return p;
  }
  sim.newProject = newProject;
  const hasAirNear = (k: number): boolean => { for (const [dx, dy] of D8) if (walkable(k + dx + dy * R)) return true; return false; };
  function canDig(p: Project, k: number): boolean {
    const t = T(k);
    if (p.kind === 'clear') return t === LOOSE;
    return DIGGABLE[t];
  }
  // Cells this project wants dug now (all reachable from open air). Empty when it is finished or blocked.
  function nextCells(p: Project): number[] {
    p.cands = [];
    for (let guard = 0; guard < 6 && !p.done; guard++) {
      if (p.phase === 'tunnel') {
        const hx = p.head & XM, hy = p.head >> XB;
        const dx = Math.round(Math.cos(p.ang)), dy = Math.round(Math.sin(p.ang));
        const nx = hx + dx, ny = hy + dy;
        if (!inside(nx, ny) || T(idx(nx, ny)) === ROCK || T(idx(nx, ny)) === GLASS || ny < surf[nx] - 1) {
          p.stuck++; p.ang += (p.stuck % 2 ? 1 : -1) * (Math.PI / 4) * Math.ceil(p.stuck / 2);
          if (p.stuck > 10) { p.done = true; p.failed = true; }
          continue;
        }
        const face = [[nx, ny], [nx - dy, ny + dx], [nx + dy, ny - dx], [nx + dx, ny + dy]];
        let solidFace = false;
        for (const [fx, fy] of face) {
          const k = idx(fx, fy);
          if (!inside(fx, fy) || fy < surf[fx] || !DIGGABLE[T(k)]) continue;
          if (hasAirNear(k)) p.cands.push(k);
          solidFace = true;
        }
        if (solidFace && !p.cands.length) {
          // face not yet touching air (the tip turned a corner): open the cells around the step first
          for (const [ox, oy] of D8) { const k = idx(nx + ox, ny + oy); if (inside(nx + ox, ny + oy) && (ny + oy) >= surf[nx + ox] && DIGGABLE[T(k)] && hasAirNear(k)) p.cands.push(k); }
          if (!p.cands.length) { p.stuck++; p.ang += (p.stuck % 2 ? 1 : -1) * (Math.PI / 4); if (p.stuck > 10) { p.done = true; p.failed = true; } continue; }
        }
        if (solidFace) return p.cands; // the rest of the face opens up once the near cells are out
        // face is open: advance the tunnel tip and steer toward the goal with a little wobble
        p.head = idx(nx, ny); p.stuck = 0;
        const gx = p.goal!.x - nx, gy = p.goal!.y - ny;
        if (gx * gx + gy * gy <= 2) { if (p.cells) p.phase = 'room'; else { p.done = true; return p.cands; } continue; }
        let da = Math.atan2(gy, gx) - p.ang;
        while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        p.ang += da * 0.35 + (rnd() - 0.5) * 0.7;
        continue;
      }
      // room / harvest / clear: dig the earliest listed cell that touches open air
      for (const k of p.cells!) if (canDig(p, k) && hasAirNear(k) && p.cands.push(k) >= 8) break;
      if (p.cands.length) return p.cands;
      if (p.kind === 'food' && (pocketAt(p.pocket!)?.remaining ?? 0) > 0) {
        // pocket cells not yet exposed: tunnel on toward the rest of it
        const left = p.cells!.find((k) => T(k) === FOOD);
        if (left != null) { p.phase = 'tunnel'; p.goal = { x: left & XM, y: left >> XB }; continue; }
      }
      if (!p.cells!.some((k) => canDig(p, k))) p.done = true;
      return p.cands;
    }
    return p.cands;
  }
  sim.nextCells = nextCells;

  function underground(k: number): boolean { return (k >> XB) > surf[k & XM]; }
  function nearestTunnel(gx: number, gy: number): { k: number; d: number } {
    let best = -1, bd = Infinity;
    const b = sim.box, s = getSnap();
    const r = sim.royal && sim.royal.done && sim.royal.room; // keep new tunnels out of the queen's floor
    for (let y = Math.max(1, b.y0); y <= Math.min(H - 2, b.y1); y++) for (let x = Math.max(1, b.x0); x <= Math.min(W - 2, b.x1); x++) {
      const i = (y - s.y0) * s.w + (x - s.x0);
      if (s.t[i] !== AIR || y <= surf[x] + 1 || !walkL(s, i)) continue;
      if (r && Math.abs(x - r.cx) <= r.rx + 2 && Math.abs(y - r.cy) <= r.ry + 2) continue;
      const d = (x - gx) * (x - gx) + (y - gy) * (y - gy);
      if (d < bd) { bd = d; best = idx(x, y); }
    }
    return { k: best, d: Math.sqrt(bd) };
  }

  // ---------- the colony ----------
  function lifespan(role: Role): number {
    return (role === 'queen' ? QUEEN_LIFESPAN_MS : ANT_LIFESPAN_MS) * (1 + (rnd() * 2 - 1) * LIFESPAN_JITTER);
  }
  function addAnt(x: number, y: number, role?: Role, born = now()): Ant {
    const r = role || 'worker';
    const a: Ant = { id: sim.nextId++, x, y, hx: 1, hy: 0, role: r, job: null, carry: null, carryCol: 0, busy: 0,
      acc: rnd(), speed: r === 'queen' ? 0.25 : 0.75 + rnd() * 0.2, walk: 0, stuckT: 0, brood: null, born, dies: born + lifespan(r) };
    sim.ants.push(a); occAdd(idx(x, y), 1);
    return a;
  }
  sim.addAnt = (x, y, role) => addAnt(x, y, role);
  const queen = () => sim.ants.find((a) => a.role === 'queen' && !a.dying);

  // A queen and a few workers at the entrance, with a little food. A founding colony's workers are of mixed ages.
  function found(workers: number) {
    const sy = surf[ex] - 1;
    // The queen waits beside the entrance (not over the shaft) until her chamber is dug.
    let qy = surf[sim.nest.x] - 1; while (qy < H - 2 && T(idx(sim.nest.x, qy + 1)) === AIR) qy++;
    sim.nest.y = qy;
    addAnt(sim.nest.x, qy, 'queen');
    const t = now();
    for (let i = 0; i < workers; i++) {
      const x = ex + ri(-6, 6); let y = sy; while (y < H - 2 && T(idx(x, y + 1)) === AIR) y++;
      addAnt(x, y, 'worker', t - rnd() * ANT_LIFESPAN_MS * 0.5);
    }
  }
  if (opts.colony !== false && !R0) {
    found(opts.workers || 6);
    const sy = surf[ex] - 1;
    for (let i = 0; i < 4; i++) { const k = idx(ex + ri(-3, 3), sy - 6 - i); if (T(k) === AIR) { setCell(k, CRUMB, SRC.CRUMB << 8 | ri(64, 192)); sim.stats.crumbsSpawned++; } }
  }

  // Food is stored at a fixed place: beside the entrance, then on the royal chamber floor.
  const storeRoom = () => (sim.royal && sim.royal.done ? sim.royal.room : null);
  const storeSources = () => { const r = storeRoom(); return r ? near(r.cx, r.cy + r.ry - 1, 3) : near(sim.nest.x, sim.nest.y, 2); };
  const storeRect = (): Box => {
    const r = storeRoom();
    return r ? { x0: r.cx - r.rx - 2, y0: r.cy - r.ry - 2, x1: r.cx + r.rx + 2, y1: r.cy + r.ry + 2 } : { x0: sim.nest.x - 6, y0: sim.nest.y - 4, x1: sim.nest.x + 6, y1: sim.nest.y + 4 };
  };
  const isStored = (x: number, y: number): boolean => { const b = storeRect(); return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; };
  function storedCells(): number[] {
    const b = storeRect(), out: number[] = [];
    for (let y = Math.max(1, b.y0); y <= Math.min(H - 2, b.y1); y++) for (let x = Math.max(1, b.x0); x <= Math.min(W - 2, b.x1); x++) if (T(idx(x, y)) === CRUMB) out.push(idx(x, y));
    return out;
  }
  sim.stored = () => storedCells().length;

  // Surface: anywhere on the open ground away from the hole, within the window.
  function surfaceSources(): number[] {
    const out: number[] = [], s = getSnap();
    for (let x = Math.max(2, s.x0 + 1); x < Math.min(W - 2, s.x0 + s.w - 1); x++) {
      if (Math.abs(x - ex) < 4) continue;
      for (let y = Math.max(1, s.y0 + 1); y < Math.min(surf[x] + 1, s.y0 + s.h); y++) {
        if (s.t[(y - s.y0) * s.w + (x - s.x0)] !== AIR) { if (y > 1) out.push(idx(x, y - 1)); break; }
      }
    }
    return out;
  }
  function crumbSources(): number[] {
    const out: number[] = [], s = getSnap(), b = sim.box;
    for (let y = Math.max(s.y0 + 1, b.y0 - 2); y <= Math.min(s.y0 + s.h - 2, b.y1 + 2); y++) for (let x = s.x0 + 1; x < s.x0 + s.w - 1; x++) {
      const i = (y - s.y0) * s.w + (x - s.x0);
      if (s.t[i] === CRUMB && s.t[i + s.w] !== AIR && !isStored(x, y)) for (const [dx, dy] of D8) out.push(idx(x + dx, y + dy));
    }
    return out;
  }
  function looseCrumbs() {
    let n = 0;
    const b = sim.box, s = getSnap();
    for (let y = Math.max(1, s.y0 + 1); y <= Math.min(b.y1 + 60, s.y0 + s.h - 2); y++) for (let x = Math.max(1, b.x0 - 60, s.x0); x <= Math.min(W - 2, b.x1 + 60, s.x0 + s.w - 1); x++) {
      const i = (y - s.y0) * s.w + (x - s.x0);
      if (s.t[i] === CRUMB && s.t[i + s.w] !== AIR && !isStored(x, y)) n++;
    }
    return n;
  }

  // Put a carried grain down in an open cell next to the ant (it then falls on its own).
  function dropNear(a: Ant, t: number, c: number, preferDx?: number): boolean {
    const k = idx(a.x, a.y);
    const tries: [number, number][] = [[preferDx || a.hx || 1, 0], [-(preferDx || a.hx || 1), 0], [0, -1], [preferDx || 1, -1], [-(preferDx || 1), -1]];
    for (const [dx, dy] of tries) { const n = k + dx + dy * R; if (T(n) === AIR && inside(n & XM, n >> XB)) { setCell(n, t, c); return true; } }
    return false;
  }

  function assign(a: Ant) {
    const workers = sim.ants.filter((b) => b.role === 'worker' && !b.dying);
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
      const rank = (p: Project) => (p.kind === 'clear' ? 2 : p.kind === 'gallery' ? 1 : 0);
      open.sort((p, q) => rank(q) - rank(p) || p.diggers - q.diggers);
      const p = open.find((q) => q.diggers < (q.phase === 'tunnel' ? 3 : 5) && nextCells(q).length);
      if (p) { p.diggers++; a.job = { type: 'dig', pid: p.id }; return; }
    }
    a.job = { type: 'rest', t: 30 + Math.floor(rnd() * 60) };
  }
  function release(a: Ant) {
    if (a.job && a.job.type === 'dig') { const p = sim.projects.find((q) => q.id === a.job!.pid); if (p) p.diggers--; }
    if (a.job && a.job.type === 'nurse') { const b = sim.brood.find((e) => e.id === a.job!.id); if (b && b.nurse === a.id && a.carry !== 'brood') b.nurse = 0; }
    a.job = null;
  }
  const inView = (a: Ant): boolean => { const v = sim.view; return !v || (a.x >= v.x0 && a.x <= v.x1 && a.y >= v.y0 && a.y <= v.y1); };

  function stepAnt(a: Ant): void {
    const k = idx(a.x, a.y);
    // Buried (a cell was filled under it): climb to open air next to it, else pick the grain up,
    // else shove it upward.
    if (T(k) !== AIR) {
      for (const [dx, dy] of [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0]] as [number, number][]) { const n = k + dx + dy * R; if (T(n) === AIR && inside(n & XM, n >> XB)) { moveTo(a, n); return; } }
      if (!a.carry && a.role !== 'queen' && DIGGABLE[T(k)]) { a.carry = T(k) === CRUMB || T(k) === FOOD ? 'food' : 'grain'; a.carryCol = C(k); setCell(k, AIR); return; }
      for (let y = a.y - 1; y > 0; y--) { const n = idx(a.x, y); if (T(n) === AIR) { const t = T(k), c = C(k); setCell(k, AIR); setCell(n, t, c); return; } }
      return;
    }
    // Nothing to hold on to: fall one cell.
    if (!walkable(k)) { if (T(k + R) === AIR) moveTo(a, k + R); return; }
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
      if (a.x === a.dumpX || (a.walk - a.dumpAt! > 600 && Math.abs(a.x - ex) > 10)) {
        if (dropNear(a, LOOSE, a.carryCol, a.x < ex ? -1 : 1)) { a.carry = null; a.dumpX = null; a.busy = DROP_TICKS; }
        return;
      }
      surfaceWalk(a, Math.sign(a.dumpX - a.x));
      return;
    }
    if (a.carry === 'food') {
      const r = follow(a, field('store', storeSources));
      if (r === 'arrived') {
        // a full store: the forager eats what it brought
        if (sim.stored() >= STORE_CAP) { a.carry = null; a.busy = DROP_TICKS; sim.stats.eaten++; sim.life.hunger = Math.max(0, sim.life.hunger - 1); return; }
        // set food down only where it will stay put (not over a hole it would roll down)
        let put = false;
        for (const [dx, dy] of <[number, number][]>[[a.hx || 1, 0], [-(a.hx || 1), 0], [0, -1], [1, -1], [-1, -1]]) {
          const n = k + dx + dy * R;
          if (T(n) === AIR && T(n + R) !== AIR && !occ.has(n) && isStored(n & XM, n >> XB)) { setCell(n, CRUMB, a.carryCol); put = true; break; }
        }
        if (put) { a.carry = null; a.busy = DROP_TICKS; sim.stats.stored++; }
        else { const [dx, dy] = D8[Math.floor(rnd() * 8)]; const n = k + dx + dy * R; if (walkable(n) && canStep(k, dx, dy) && isStored(n & XM, n >> XB)) moveTo(a, n); }
      }
      else if (r === 'stuck') blocked(a);
      return;
    }
    if (!a.job) assign(a);
    const j = a.job!;
    if (j.type === 'rest') {
      if ((j.t = j.t! - 1) <= 0) { release(a); return; }
      // a resting ant nobody can see stays put: no work for the simulation, no difference to anyone
      if (inView(a) && rnd() < 0.15) { const [dx, dy] = D8[Math.floor(rnd() * 8)]; const n = k + dx + dy * R; if (walkable(n) && canStep(k, dx, dy) && underground(n) === underground(k)) moveTo(a, n); }
      return;
    }
    if (j.type === 'forage') {
      if (sim.crumbsOut <= 0) { release(a); return; }
      const r = follow(a, field('crumbs', crumbSources));
      if (r === 'arrived') {
        for (const [dx, dy] of D8) { const n = k + dx + dy * R; if (T(n) === CRUMB && !isStored(n & XM, n >> XB)) { a.carry = 'food'; a.carryCol = C(n); setCell(n, AIR); a.busy = DIG_TICKS; sim.crumbsOut--; break; } }
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
      const room = sim.broodRoom!.room!;
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
      const c = cands.find((n) => Math.max(Math.abs((n & XM) - a.x), Math.abs((n >> XB) - a.y)) <= 1);
      if (c !== undefined) {
        const cx = c & XM, cy = c >> XB, t = T(c);
        a.carry = t === FOOD || t === CRUMB ? 'food' : 'grain'; a.carryCol = C(c);
        a.hx = Math.sign(cx - a.x); a.hy = Math.sign(cy - a.y);
        setCell(c, AIR); sim.energy -= 1; sim.stats.dug++; a.busy = DIG_TICKS;
        release(a);
        return;
      }
      const r = follow(a, field('work:' + p.id, () => (p.cands!.length ? p.cands!.flatMap((n) => near(n & XM, n >> XB, 1)) : [p.head])));
      if (r === 'stuck') { if (++a.stuckT > 8) { a.stuckT = 0; release(a); blocked(a, true); } }
      else a.stuckT = 0;
    }
  }

  // Path blocked (rubble, a slid spoil heap): dig through loose grains next to us.
  function blocked(a: Ant, now?: boolean) {
    const k = idx(a.x, a.y);
    if (!now && ++a.stuckT < 20) return;
    a.stuckT = 0;
    for (const [dx, dy] of [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1], [0, 1]] as [number, number][]) {
      const n = k + dx + dy * R;
      if (T(n) !== LOOSE) continue;
      if (!a.carry) { a.carry = 'grain'; a.carryCol = C(n); setCell(n, AIR); sim.stats.dug++; a.busy = DIG_TICKS; return; }
    }
    // Holding a grain and walled in underground: set it down and dig instead.
    // (Never next to the entrance: it would only roll back down the shaft.)
    if (a.carry === 'grain' && (underground(k) ? true : Math.abs(a.x - ex) > 10) && dropNear(a, LOOSE, a.carryCol)) { a.carry = null; a.dumpX = null; }
  }

  function surfaceWalk(a: Ant, s: number) {
    const k = idx(a.x, a.y);
    const opts2: [number, number][] = [[s, 1], [s, 0], [s, -1], [0, -1]];
    for (const [dx, dy] of opts2) {
      const n = k + dx + dy * R;
      if (walkable(n) && canStep(k, dx, dy) && T(n + R) !== AIR) { moveTo(a, n); return; }
    }
    for (const [dx, dy] of opts2) { const n = k + dx + dy * R; if (walkable(n) && canStep(k, dx, dy)) { moveTo(a, n); return; } }
    if (Math.abs(a.x - ex) > 10) a.dumpX = a.x; // can't go further: drop here
    else a.dumpX = ex - (a.dumpX! - ex); // try the other side
  }

  function stepQueen(a: Ant): void {
    const pop = sim.ants.length + sim.brood.length;
    if (sim.royal && sim.royal.done && !a.home) {
      const r = sim.royal.room!;
      const res = follow(a, field('royal', () => near(r.cx, r.cy + r.ry - 1, 1)));
      if (res === 'arrived') a.home = true;
      return;
    }
    a.eggT = (a.eggT || 0) + 1;
    if (a.eggT >= 10 && pop < sim.cap()) {
      a.eggT = 0;
      const crumbs: number[] = [];
      for (let y = a.y - 4; y <= a.y + 4; y++) for (let x = a.x - 6; x <= a.x + 6; x++) if (inside(x, y) && T(idx(x, y)) === CRUMB) crumbs.push(idx(x, y));
      if (crumbs.length >= 2) {
        setCell(crumbs[0], AIR); setCell(crumbs[1], AIR); sim.stats.eaten += 2;
        sim.brood.push({ id: sim.nextId++, x: a.x, y: a.y, age: 0, stage: 0, inRoom: false, nurse: 0, carried: false });
        sim.stats.laid++;
      }
    }
  }
  // the population the colony's rooms can hold
  sim.cap = () => Math.min(120, 10 + 8 * sim.projects.filter((p) => p.done && p.room && !p.failed).length);

  function stepBrood() {
    const hungry = sim.life.starvingSince > 0; // a starving colony's brood waits
    for (let i = sim.brood.length - 1; i >= 0; i--) {
      const b = sim.brood[i];
      if (b.carried) { const n = sim.ants.find((a) => a.brood === b); if (n) { b.x = n.x; b.y = n.y; } continue; }
      if (T(idx(b.x, b.y + 1)) === AIR) { b.y++; continue; } // settles one cell per tick
      if (T(idx(b.x, b.y)) !== AIR) { b.y--; continue; }
      if (hungry) continue;
      b.age += b.inRoom ? 1 : 0.4;
      while (b.stage < 3 && b.age >= BROOD_STAGES[b.stage]) b.stage++;
      if (b.stage >= 3) { sim.brood.splice(i, 1); addAnt(b.x, b.y, 'worker'); sim.stats.born++; }
    }
  }

  // ---------- life: age, hunger, starvation, by the wall clock ----------
  function event(e: SimEvent) { sim.events.push(e); if (sim.events.length > 50) sim.events.shift(); }
  function die(a: Ant, cause: 'age' | 'hunger', at: number) {
    release(a);
    a.dying = DYING_TICKS;
    // what it held stays in the world: soil and food are never lost
    if (a.carry === 'grain' && !dropNear(a, LOOSE, a.carryCol)) setCell(idx(a.x, a.y - 1), LOOSE, a.carryCol);
    if (a.carry === 'food' && !dropNear(a, CRUMB, a.carryCol)) setCell(idx(a.x, a.y - 1), CRUMB, a.carryCol);
    if (a.carry === 'brood' && a.brood) { a.brood.carried = false; a.brood.nurse = 0; }
    a.carry = null; a.brood = null;
    if (cause === 'age') sim.stats.died++; else sim.stats.starved++;
    event({ type: 'died', tick: sim.tick, cause, queen: a.role === 'queen' });
    if (a.role !== 'queen') return;
    // the youngest worker takes over, and heads for the royal chamber
    const heir = sim.ants.filter((b) => b.role === 'worker' && !b.dying).sort((p, q) => q.born - p.born)[0];
    if (!heir) return;
    release(heir);
    heir.role = 'queen'; heir.speed = 0.25; heir.home = false; heir.dies = at + lifespan('queen');
    event({ type: 'queen', tick: sim.tick });
  }
  function eatStored(): boolean {
    const cells = storedCells();
    if (!cells.length) return false;
    setCell(cells[0], AIR); sim.stats.eaten++;
    return true;
  }
  function liveSlice(from: number, to: number) {
    const L = sim.life, dt = to - from;
    for (const a of sim.ants) if (!a.dying && a.dies <= to) die(a, 'age', to);
    const alive = sim.ants.filter((a) => !a.dying).length;
    if (!alive) { L.hunger = 0; L.starve = 0; L.starvingSince = 0; return; }
    L.hunger += (alive * dt) / ANT_MEAL_MS;
    while (L.hunger >= 1 && eatStored()) L.hunger -= 1;
    if (L.hunger < 1) { L.starvingSince = 0; L.starve = 0; return; }
    // the store is empty: the colony starves, slowly, and not while food is on its way
    L.hunger = Math.min(L.hunger, 3);
    if (!L.starvingSince) L.starvingSince = to;
    if (to - L.lastTokens < STARVE_DEATH_MS) return;
    L.starve += dt;
    while (L.starve >= STARVE_DEATH_MS) {
      L.starve -= STARVE_DEATH_MS;
      const workers = sim.ants.filter((b) => b.role === 'worker' && !b.dying), grace = to - L.starvingSince > STARVE_GRACE_MS;
      if (workers.length > MIN_SURVIVORS || (grace && workers.length)) die(workers.sort((p, q) => p.born - q.born)[0], 'hunger', to);
      else if (grace) { const q = queen(); if (q) die(q, 'hunger', to); }
    }
  }
  // Catch up to the clock in slices of at most ten minutes, so a farm left closed for a week ages the same way.
  function live() {
    const t = now(), L = sim.life;
    if (t < L.last) { L.last = t; return; }
    if (t - L.last < 1000) return;
    for (let from = L.last; from < t;) { const to = Math.min(t, from + 600_000); liveSlice(from, to); from = to; }
    L.last = t;
  }
  function bury() {
    for (let i = sim.ants.length - 1; i >= 0; i--) {
      const a = sim.ants[i];
      if (a.dying === undefined || --a.dying > 0) continue;
      sim.ants.splice(i, 1); occAdd(idx(a.x, a.y), -1);
    }
  }

  // ---------- planner: what the colony digs next ----------
  function plan() {
    const open = sim.projects.filter((p) => !p.done);
    // Housekeeping: grains that slid or fell into a finished room get carried back out.
    if (sim.tick % 100 === 1) for (const r of sim.projects) {
      if (!r.done || r.failed || !r.room || r.kind === 'clear' || r.kind === 'food') continue;
      let n = 0; for (const k of r.cells!) if (T(k) === LOOSE) n++;
      if (n >= 6 && !open.some((p) => p.kind === 'clear' && p.room!.cx === r.room!.cx && p.room!.cy === r.room!.cy)) {
        const c = newProject('clear', -1, null, r.room); c.cells!.sort((a, b) => a - b); return;
      }
    }
    if (!sim.royal) {
      const gx = ex + ri(-10, 10), gy = surf[ex] + ri(24, 30);
      sim.royal = newProject('royal', idx(ex, surf[ex] - 1), { x: gx, y: gy }, { cx: gx, cy: gy, rx: 7, ry: 3, shape: 'dome' });
      return;
    }
    if (sim.royal.done && !sim.broodRoom) {
      const r = sim.royal.room!, side = rnd() < 0.5 ? -1 : 1;
      const gx = Math.max(12, Math.min(W - 12, r.cx + side * ri(14, 24))), gy = Math.min(H - 10, r.cy + ri(14, 20));
      const st = nearestTunnel(gx, gy);
      sim.broodRoom = newProject('brood', st.k, { x: gx, y: gy }, { cx: gx, cy: gy, rx: 6, ry: 3, shape: 'dome' });
      return;
    }
    // A finished agent task orders a gallery: a wide, flat hall, the one room ants dig that can fail.
    if (sim.galleryQueue.length && sim.royal.done && !open.some((p) => p.kind === 'gallery')) {
      const g = sim.galleryQueue.shift()!;
      // beside a random stretch of existing tunnel, so the hall starts digging straight away
      const spots: number[] = [];
      const b = sim.box, s = getSnap();
      for (let y = Math.max(1, b.y0); y <= Math.min(H - 2, b.y1); y++) for (let x = Math.max(1, b.x0); x <= Math.min(W - 2, b.x1); x++) {
        const i = (y - s.y0) * s.w + (x - s.x0);
        if (s.t[i] === AIR && y > surf[x] + 8 && walkL(s, i)) spots.push(idx(x, y));
      }
      if (!spots.length) { sim.galleryQueue.unshift(g); return; }
      const sp = spots[Math.floor(rnd() * spots.length)], side = rnd() < 0.5 ? -1 : 1;
      g.x = Math.max(4 + (g.w >> 1), Math.min(W - 5 - (g.w >> 1), (sp & XM) + side * ((g.w >> 1) + 3)));
      g.y = Math.min(H - 8, (sp >> XB) - 1);
      newProject('gallery', sp, { x: g.x - side * ((g.w >> 1) - 1), y: g.y + 1 }, { cx: g.x, cy: g.y, rx: g.w >> 1, ry: 2, shape: 'flat' });
      return;
    }
    const workers = sim.ants.length - 1;
    const max = Math.min(4, 1 + Math.floor(workers / 6));
    if (open.length >= max) return;
    if (!sim.royal.done) return;
    // only pockets the colony could smell: near what it has dug
    const b = sim.box, sc = sim.scent;
    let best: Pocket | null = null, bd = Infinity, bst: { k: number; d: number } | null = null;
    for (const p of sim.pocketsIn({ x0: b.x0 - sc, y0: b.y0 - sc, x1: b.x1 + sc, y1: b.y1 + sc })) {
      if (p.claimed || p.remaining <= 0) continue;
      const st = nearestTunnel(p.x, p.y);
      if (st.k >= 0 && st.d <= sim.scent && st.d < bd) { bd = st.d; best = p; bst = st; }
    }
    if (best) {
      best.claimed = true;
      const pr = newProject('food', bst!.k, { x: best.x, y: best.y }, null);
      pr.cells = pocketCells(best);
      pr.pocket = best.id;
      return;
    }
    if (open.length === 0) {
      // nothing smelled: push a scouting tunnel out and widen the colony's sense of smell
      for (let i = 0; i < 30; i++) {
        const x = ri(b.x0, b.x1), y = ri(b.y0, b.y1), k = idx(x, y);
        if (T(k) !== AIR || y <= surf[x] + 3 || !walkable(k)) continue;
        const ang = Math.PI * (0.1 + rnd() * 0.8) + (rnd() < 0.3 ? (rnd() < 0.5 ? -0.9 : 0.9) : 0), len = ri(22, 40);
        const gx = Math.max(6, Math.min(W - 7, Math.round(x + Math.cos(ang) * len))), gy = Math.max(surf[gx] + 8, Math.min(H - 6, Math.round(y + Math.sin(ang) * len)));
        newProject('scout', k, { x: gx, y: gy }, null);
        sim.scent += 10;
        return;
      }
    }
  }
  function pocketCells(p: Pocket): number[] {
    const cells: number[] = [];
    for (let y = p.y - 5; y <= p.y + 5; y++) for (let x = p.x - 5; x <= p.x + 5; x++) if (inside(x, y) && podId(x, y) === p.id && T(idx(x, y)) === FOOD) cells.push(idx(x, y));
    return cells.sort((a, b) => Math.hypot((a & XM) - p.x, (a >> XB) - p.y) - Math.hypot((b & XM) - p.x, (b >> XB) - p.y));
  }

  // ---------- physics ----------
  // Falling sand, only in chunks where something moved or changed. Rows bottom-up across the whole map, like one
  // scan of the full grid, but skipping every chunk that is asleep. Away from the colony and the camera, an awake
  // chunk only steps every 8th tick: grains there still settle, just more coarsely.
  function hot(cx: number, cy: number): boolean {
    const x0 = cx << CS, y0 = cy << CS, x1 = x0 + 63, y1 = y0 + 63, b = sim.box, v = sim.view, M = 64;
    if (x1 >= b.x0 - M && x0 <= b.x1 + M && y1 >= b.y0 - M && y0 <= b.y1 + M) return true;
    return !v || (x1 >= v.x0 && x0 <= v.x1 && y1 >= v.y0 && y0 <= v.y1);
  }
  function stepSand() {
    if (!awake.size) { sim.sandAwake = false; sim.falling = 0; return; }
    const list: number[] = [], later: number[] = [];
    for (const ci of awake) {
      const cx = ci % cw, cy = (ci - cx) / cw;
      if (sim.tick % 8 && !hot(cx, cy)) later.push(ci); else list.push(ci);
    }
    awake.clear();
    for (const ci of later) awake.add(ci);
    const flip = sim.tick & 1;
    // bottom row of chunks first; in each row, chunks in scan order
    list.sort((a, b) => {
      const ay = (a / cw) | 0, by = (b / cw) | 0;
      return by - ay || (flip ? b - a : a - b);
    });
    let moved = 0;
    for (let g = 0; g < list.length;) {
      const cy = (list[g] / cw) | 0;
      let e = g; while (e < list.length && ((list[e] / cw) | 0) === cy) e++;
      for (let ly = 63; ly >= 0; ly--) {
        const y = (cy << CS) + ly;
        if (y < 1 || y > H - 2) continue;
        for (let c = g; c < e; c++) {
          const cx = list[c] % cw;
          for (let i = 0; i < 64; i++) {
            const x = (cx << CS) + (flip ? 63 - i : i);
            if (x < 1 || x > W - 2) continue;
            const k = (y << XB) | x;
            if (!FALLS[T(k)]) continue;
            const b = k + R;
            if (T(b) === AIR && !occ.has(b)) { swap(k, b); moved++; continue; }
            const d = rnd() < 0.5 ? -1 : 1;
            if (T(k + d) === AIR && T(b + d) === AIR && !occ.has(b + d)) { swap(k, b + d); moved++; continue; }
            if (T(k - d) === AIR && T(b - d) === AIR && !occ.has(b - d)) { swap(k, b - d); moved++; }
          }
        }
      }
      g = e;
    }
    if (moved) sim.version++;
    sim.sandAwake = awake.size > 0;
    sim.falling = moved;
  }

  // A flat ceiling wider than its layer's span strains, cracks for a moment, then its middle drops.
  // Only rows near what changed since the last check; a run is followed to its real ends.
  function checkCeilings() {
    const d = { ...dirty };
    dirty.x0 = 1; dirty.x1 = 0;
    const ceil = (x: number, y: number) => CEILING[T(idx(x, y))] && T(idx(x, y + 1)) === AIR;
    for (let y = Math.max(1, d.y0 - 2); y <= Math.min(H - 3, d.y1 + 1); y++) {
      let x = Math.max(1, d.x0 - 2);
      while (x > 1 && ceil(x - 1, y)) x--;
      const xe = Math.min(W - 2, d.x1 + 2);
      while (x <= xe) {
        if (ceil(x, y) && y >= surf[x]) {
          const x0 = x;
          while (x < W - 1 && ceil(x, y)) x++;
          const x1 = x - 1, L = x1 - x0 + 1, lim = spanOf((x0 + x1) >> 1, y) || 14;
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
        const k = idx(x, s.y);
        if (CEILING[T(k)] && T(k + R) === AIR) { setCell(k, T(k) === FOOD ? CRUMB : LOOSE); n++; }
      }
      if (!n) continue;
      sim.stats.collapses++;
      event({ type: 'collapse', tick: sim.tick, y: s.y, x0: s.x0 + m, x1: s.x1 - m });
      const open = sim.projects.find((p) => p.kind === 'clear' && !p.done && Math.abs(p.room!.cy - s.y) < 10 && Math.abs(p.room!.cx - ((s.x0 + s.x1) >> 1)) < 20);
      if (!open) {
        const p = newProject('clear', -1, null, { cx: (s.x0 + s.x1) >> 1, cy: s.y + 6, rx: ((s.x1 - s.x0) >> 1) + 6, ry: 9, shape: 'flat' });
        p.cells!.sort((a, b) => a - b);
      }
    }
  }
  // Soil no longer held up falls (the Dwarf Fortress rule). Checked around what changed: soil connected to the glass
  // or to the edge of that region counts as held. (An island bigger than the region would wait for a later check.)
  function checkIslands() {
    const x0 = Math.max(0, idirty.x0 - 64), y0 = Math.max(0, idirty.y0 - 64), x1 = Math.min(W - 1, idirty.x1 + 64), y1 = Math.min(H - 1, idirty.y1 + 64);
    idirty.x0 = 1; idirty.x1 = 0;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, n = w * h, t = new Uint8Array(n), seen = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[y * w + x] = T(idx(x0 + x, y0 + y));
    const holds = (i: number) => SOLID[t[i]] && !FALLS[t[i]];
    if (queue.length < n) queue = new Int32Array(n);
    let qh = 0, qt = 0;
    for (let i = 0; i < n; i++) {
      const x = i % w, y = (i - x) / w;
      if (t[i] === GLASS || ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && holds(i))) { seen[i] = 1; queue[qt++] = i; }
    }
    while (qh < qt) {
      const i = queue[qh++], x = i % w;
      for (const m of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (m < 0 || m >= n || seen[m] || !holds(m)) continue;
        seen[m] = 1; queue[qt++] = m;
      }
    }
    for (let i = 0; i < n; i++) {
      if (seen[i] || !holds(i)) continue;
      const x = i % w, y = (i - x) / w;
      setCell(idx(x0 + x, y0 + y), t[i] === FOOD ? CRUMB : LOOSE);
    }
  }

  // ---------- public API ----------
  sim.step = function () {
    sim.tick++;
    store.tick = sim.tick;
    sim.moves = 0;
    live();
    if (sim.crumbQueue >= 1 && sim.tick % 5 === 0 && sim.crumbsOut < LOOSE_CRUMB_CAP) {
      const x = Math.max(2, Math.min(W - 3, ex + (rnd() < 0.5 ? -1 : 1) * ri(8, 50)));
      const k = idx(x, 2);
      if (T(k) === AIR) { setCell(k, CRUMB, SRC.CRUMB << 8 | ri(0, 255)); sim.crumbQueue--; sim.stats.crumbsSpawned++; sim.crumbsOut++; }
    }
    if (sim.tick % 20 === 1) { plan(); sim.crumbsOut = looseCrumbs(); }
    for (let i = 0; i < sim.ants.length; i++) if (sim.ants[i].dying === undefined) stepAnt(sim.ants[i]);
    bury();
    stepBrood();
    stepSand();
    if (sim.tick % 5 === 0 && dirty.x0 <= dirty.x1) checkCeilings();
    stepStrains();
    if (sim.tick % 60 === 0 && idirty.x0 <= idirty.x1) checkIslands();
    for (const [key, f] of sim.fields) if (sim.tick - f.at > 400) sim.fields.delete(key);
    if (sim.projects.length > 40) sim.projects = sim.projects.filter((p) => !p.done || p === sim.royal || p === sim.broodRoom);
    if (sim.tick % 20 === 0) sim.maintain();
  };
  sim.run = function (n: number) { for (let i = 0; i < n; i++) sim.step(); };

  // Agent activity in: the only source of energy and food. See docs/ant-farm-design.md, "How tokens feed the farm".
  sim.feed = function (ev) {
    if (!ev) return;
    if (ev.type === 'tokens') {
      // Weighted (cache reads count a tenth) and softly capped per hour of event time: see tokens.ts.
      const c = sim.meter.add(ev, ev.ts);
      sim.stats.tokens += c.weighted;
      sim.energy = Math.min(MAX_ENERGY, sim.energy + c.energy);
      sim.crumbQueue = Math.min(MAX_CRUMB_QUEUE, sim.crumbQueue + c.crumbs);
      if (c.weighted > 0) {
        sim.life.lastTokens = now(); // food is on its way: nobody starves while it comes
        if (!sim.ants.some((a) => !a.dying)) { found(2); event({ type: 'founded', tick: sim.tick }); }
      }
    } else if (ev.type === 'task_done') {
      sim.stats.tasks++;
      sim.galleryQueue.push({ w: Math.max(6, Math.min(40, ev.width || ri(10, 18))) });
    }
  };

  sim.isBusy = () => sim.moves > 2 || sim.sandAwake || sim.strains.length > 0 || sim.ants.some((a) => a.dying !== undefined);

  // Area worth looking at: everything touched, the ants, and the ground around the nest.
  sim.interestBox = function () {
    let { x0, y0, x1, y1 } = sim.box;
    x0 = Math.min(x0, ex - 40); x1 = Math.max(x1, ex + 40);
    y0 = Math.min(y0, surf[ex] - 14); y1 = Math.max(y1, surf[ex] + 34);
    for (const a of sim.ants) { if (a.x < x0) x0 = a.x; if (a.x > x1) x1 = a.x; if (a.y < y0) y0 = a.y; if (a.y > y1) y1 = a.y; }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(H - 1, y1);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  sim.setView = (b) => { sim.view = b; };
  sim.maintain = function () {
    const w = windowBox(), v = sim.view;
    const keep = (c: Chunk) => {
      const x0 = c.cx << CS, y0 = c.cy << CS, x1 = x0 + 63, y1 = y0 + 63;
      if (x1 >= w.x0 && x0 <= w.x1 && y1 >= w.y0 && y0 <= w.y1) return true;
      return !!v && x1 >= v.x0 - 64 && x0 <= v.x1 + 64 && y1 >= v.y0 - 64 && y0 <= v.y1 + 64;
    };
    store.maintain(keep, opts.chunkCap ?? 256);
  };
  sim.chunkStats = () => store.stats();

  sim.health = function (): Health {
    const t = now(), live = sim.ants.filter((a) => !a.dying), q = live.find((a) => a.role === 'queen');
    const workers = live.filter((a) => a.role === 'worker');
    const food = sim.stored(), L = sim.life;
    const mood: Mood = !live.length ? 'empty' : L.starvingSince ? 'starving' : L.hunger >= 0.5 && food < Math.max(2, live.length / 4) ? 'hungry' : 'fed';
    return {
      workers: workers.length, queen: !!q, brood: sim.brood.length, food, loose: sim.crumbsOut,
      oldestMs: workers.reduce((m, a) => Math.max(m, t - a.born), 0), queenAgeMs: q ? t - q.born : 0,
      mood, starvingMs: L.starvingSince ? t - L.starvingSince : 0,
    };
  };

  // ---------- reading the map: counts, hash, pictures ----------
  const rt = new Uint8Array(CELLS), rc = new Uint16Array(CELLS);
  function eachChunk(b: Box, fn: (cx: number, cy: number, t: Uint8Array, c: Uint16Array) => void) {
    for (let cy = Math.max(0, b.y0 >> CS); cy <= Math.min(store.ch - 1, b.y1 >> CS); cy++)
      for (let cx = Math.max(0, b.x0 >> CS); cx <= Math.min(cw - 1, b.x1 >> CS); cx++) { store.read(cy * cw + cx, rt, rc); fn(cx, cy, rt, rc); }
  }
  const whole = (): Box => ({ x0: 0, y0: 0, x1: W - 1, y1: H - 1 });
  const around = (): Box => { const b = sim.box; return { x0: b.x0 - 64, y0: b.y0 - 64, x1: b.x1 + 64, y1: b.y1 + 64 }; };

  // Cells of each type: the whole map when it's small, else the region around the colony (or the given box).
  sim.count = function (b?: Box) {
    const r = b || (W * H <= SMALL ? whole() : around());
    const c = [0, 0, 0, 0, 0, 0, 0];
    eachChunk(r, (cx, cy, t) => {
      for (let ly = 0; ly < 64; ly++) {
        const y = (cy << CS) + ly; if (y < r.y0 || y > r.y1 || y >= H) continue;
        for (let lx = 0; lx < 64; lx++) { const x = (cx << CS) + lx; if (x >= r.x0 && x <= r.x1 && x < W) c[t[(ly << CS) | lx]]++; }
      }
    });
    let grain = 0, food = 0;
    for (const a of sim.ants) { if (a.carry === 'grain') grain++; if (a.carry === 'food') food++; }
    return { air: c[AIR], dirt: c[DIRT], rock: c[ROCK], loose: c[LOOSE], food: c[FOOD], crumb: c[CRUMB], carriedGrain: grain, carriedFood: food };
  };

  sim.hash = function () {
    let h = 2166136261;
    const mix = (v: number) => { h ^= v; h = Math.imul(h, 16777619); };
    if (W * H <= SMALL) eachChunk(whole(), (_x, _y, t) => { for (let i = 0; i < CELLS; i++) mix(t[i]); });
    else {
      const cis = [...store.map.values()].filter((c) => c.modified).map((c) => c.ci).sort((a, b) => a - b);
      for (const ci of cis) { mix(ci); store.read(ci, rt, rc); for (let i = 0; i < CELLS; i++) mix(rt[i]); }
    }
    for (const a of sim.ants) mix(a.x * 31 + a.y);
    return h >>> 0;
  };

  // One chunk's terrain as colours and what each pixel shows (K.*), for a tile of the picture (game/render.ts).
  // Reads without loading: drawing a far corner of the map doesn't keep it in memory.
  const [skr, skg, skb] = hexRgb(PAL.skyTop), [slr, slg, slb] = hexRgb(PAL.skyLow);
  sim.paintChunk = function (cx, cy, px, kind) {
    store.read(cy * cw + cx, rt, rc);
    for (let ly = 0, i = 0; ly < 64; ly++) {
      const y = (cy << CS) + ly;
      for (let lx = 0; lx < 64; lx++, i++) {
        const x = (cx << CS) + lx, t = rt[i];
        if (x >= W || y >= H) { px[i] = COLOURS[0]; kind[i] = K.GLASS; continue; }
        const s = surf[x];
        if (t === AIR) {
          if (y < s) {
            const f = Math.min(1, y / Math.max(1, s));
            px[i] = rgb(skr + (slr - skr) * f, skg + (slg - skg) * f, skb + (slb - skb) * f); kind[i] = K.SKY;
          } else {
            const j = (hash01(seed, x, y, 17) - 0.5) * 14 + ((x * 7 + y * 13) % 5 === 0 ? -6 : 0);
            px[i] = WALL_COLOURS[band[Math.max(0, Math.min(H, y - s + wob[x]))] * 256 + jitterShade(j)]; kind[i] = K.WALL;
          }
        } else if (t === LOOSE) { px[i] = LOOSE_COLOURS[rc[i]]; kind[i] = K.LOOSE; }
        else {
          px[i] = COLOURS[rc[i]];
          kind[i] = t === DIRT ? (y === s ? K.GRASS : K.SOIL) : t === ROCK ? K.ROCK : t === FOOD || t === CRUMB ? K.FOOD : K.GLASS;
        }
      }
    }
  };

  // What moves on top of the terrain inside a box: cracks in a straining ceiling, brood and ants (a dying ant fading).
  const BROOD = [rgb(238, 232, 214), rgb(226, 212, 182), rgb(201, 179, 140)];
  const body = rgb(158, 76, 54), gaster = rgb(104, 49, 36), head = rgb(122, 58, 42), legs = rgb(70, 36, 28);
  const qBody = rgb(196, 116, 80), qGaster = rgb(140, 72, 52);
  sim.overlay = function (b, put) {
    const inB = (x: number, y: number) => x >= b.x0 - 3 && x <= b.x1 + 3 && y >= b.y0 - 3 && y <= b.y1 + 3;
    const p = (x: number, y: number, c: number, k: number, al: number) => { if (inside(x, y)) put(x, y, c, k, al); };
    for (const s of sim.strains) {
      if (s.x1 < b.x0 || s.x0 > b.x1 || s.y < b.y0 || s.y - 2 > b.y1) continue;
      // hairline cracks spreading through the sagging ceiling, darker as it nears failure
      const f = 1 - s.t / 40;
      for (let x = s.x0; x <= s.x1; x++) {
        const h = (x * 7 + s.y * 3) % 5;
        for (let dy = 0; dy < 3; dy++) {
          const k = idx(x, s.y - dy);
          if (T(k) !== AIR && (h === dy || (dy === 0 && (x + (sim.tick >> 2)) % 3 === 0)) && h + dy < 2 + f * 4) p(x, s.y - dy, scaleCol(COLOURS[C(k)], 0.45), K.CRACK, 1);
        }
      }
    }
    for (const e of sim.brood) {
      if (e.carried || !inB(e.x, e.y)) continue;
      p(e.x, e.y, BROOD[Math.min(2, e.stage)], K.BROOD, 1);
      if (e.stage > 0) p(e.x + (e.id & 1 ? 1 : -1), e.y, BROOD[Math.min(2, e.stage)], K.BROOD, 1);
    }
    for (const a of sim.ants) {
      if (!inB(a.x, a.y)) continue;
      const al = a.dying === undefined ? 1 : a.dying / DYING_TICKS;
      const hx = a.hx || 0, hy = a.hy || 0;
      const dx = hx === 0 && hy === 0 ? 1 : hx, dy = hx === 0 && hy === 0 ? 0 : hy;
      if (a.role === 'queen') {
        p(a.x - 2 * dx, a.y - 2 * dy, qGaster, K.QUEEN, al); p(a.x - dx, a.y - dy, qGaster, K.QUEEN, al);
        p(a.x - dx + dy, a.y - dy - dx, qGaster, K.QUEEN, al);
        p(a.x, a.y, qBody, K.QUEEN, al); p(a.x + dx, a.y + dy, head, K.QUEEN, al);
        continue;
      }
      p(a.x - dx, a.y - dy, gaster, K.ANT, al); p(a.x, a.y, body, K.ANT, al); p(a.x + dx, a.y + dy, head, K.ANT, al);
      if ((a.walk >> 1) & 1 && a.dying === undefined) p(a.x - dy, a.y + dx, legs, K.ANT, al);
      if (a.carry === 'grain' || a.carry === 'food') p(a.x + 2 * dx, a.y + 2 * dy, COLOURS[a.carryCol], a.carry === 'food' ? K.LOAD_FOOD : K.LOAD_GRAIN, al);
      else if (a.carry === 'brood' && a.brood) p(a.x + 2 * dx, a.y + 2 * dy, BROOD[Math.min(2, a.brood.stage)], K.BROOD, al);
    }
  };

  // The whole map into a W*H buffer (one pixel per cell), for small maps and tests. The ants come too unless o.ants
  // is false; with o.kind it also writes what each pixel shows, so a palette can recolour each kind.
  sim.paint = function (px: Uint32Array, o?: PaintOptions) {
    if (W * H > SMALL) throw new Error('paint() is for small maps: draw a big one chunk by chunk');
    const kind = o && o.kind, tp = new Uint32Array(CELLS), tk = new Uint8Array(CELLS);
    for (let cy = 0; cy < store.ch; cy++) for (let cx = 0; cx < cw; cx++) {
      sim.paintChunk(cx, cy, tp, tk);
      for (let ly = 0; ly < 64; ly++) {
        const y = (cy << CS) + ly; if (y >= H) break;
        const x0 = cx << CS, n = Math.min(64, W - x0);
        px.set(tp.subarray(ly << CS, (ly << CS) + n), y * W + x0);
        if (kind) kind.set(tk.subarray(ly << CS, (ly << CS) + n), y * W + x0);
      }
    }
    sim.overlay(whole(), (x, y, c, k, al) => {
      if (al < 0.5 || (o && o.ants === false && k !== K.CRACK && k !== K.BROOD)) return;
      px[y * W + x] = c; if (kind) kind[y * W + x] = k;
    });
  };

  // ---------- saving and restoring ----------
  sim.save = function (): SaveData {
    const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); };
    return {
      v: 1, seed, W, H, tick: sim.tick, energy: sim.energy, crumbQueue: sim.crumbQueue, galleryQueue: sim.galleryQueue.map((g) => ({ w: g.w })),
      scent: sim.scent, box: { ...sim.box }, nest: { ...sim.nest }, nextId: sim.nextId, rng: rnd.state(), stats: { ...sim.stats },
      life: { ...sim.life }, meter: sim.meter.save(),
      ants: sim.ants.filter((a) => a.dying === undefined).map((a) => ({
        id: a.id, x: a.x, y: a.y, hx: a.hx, hy: a.hy, role: a.role, born: a.born, dies: a.dies, speed: a.speed, home: a.home,
        carry: a.carry === 'brood' ? null : a.carry, carryCol: a.carryCol,
      })),
      brood: sim.brood.map((e) => ({ ...e, carried: false, nurse: 0 })),
      projects: sim.projects.map((p) => ({
        id: p.id, kind: p.kind, head: p.head, goal: p.goal, room: p.room, phase: p.phase, ang: p.ang, done: p.done, stuck: p.stuck,
        failed: p.failed, pocket: p.pocket, cells: p.kind === 'food' ? p.cells : null,
      })),
      royal: sim.royal ? sim.royal.id : 0, broodRoom: sim.broodRoom ? sim.broodRoom.id : 0,
      pockets: [...sim.pockets.values()].map((p) => [p.id, p.remaining, p.claimed ? 1 : 0]),
      chunks: store.saveChanged().map(([ci, d]) => [ci, b64(d)]),
    };
  };

  if (R0) {
    const u8 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
    for (const [ci, d] of R0.chunks) {
      const p = u8(d);
      store.restore(ci, p);
      const cx = ci % cw, cy = (ci - cx) / cw;
      // the restored soil might still be settling
      const t = new Uint8Array(CELLS), c = new Uint16Array(CELLS);
      genChunk(cx, cy, t, c); applyDiff(p, t, c);
      if (t.some((v) => FALLS[v])) awake.add(ci);
    }
    Object.assign(sim, {
      tick: R0.tick, energy: R0.energy, crumbQueue: R0.crumbQueue, galleryQueue: R0.galleryQueue, scent: R0.scent,
      box: R0.box, nest: R0.nest, nextId: R0.nextId, stats: { ...sim.stats, ...R0.stats }, life: { ...sim.life, ...R0.life },
    });
    store.tick = sim.tick;
    sim.meter.load(R0.meter);
    for (const [id, remaining, claimed] of R0.pockets) { const p = pocketAt(id); if (p) { p.remaining = remaining; p.claimed = !!claimed; } }
    for (const q of R0.projects) {
      const p: Project = {
        id: q.id!, kind: q.kind!, head: q.head!, goal: q.goal ?? null, room: q.room ?? null, phase: q.phase!, ang: q.ang!, done: !!q.done,
        stuck: q.stuck || 0, failed: q.failed, pocket: q.pocket, work: -1, diggers: 0,
        cells: q.cells ?? (q.room ? roomCells(q.room) : null),
      };
      if (p.kind === 'clear' && p.cells) p.cells.sort((a, b) => a - b);
      sim.projects.push(p);
      if (p.id === R0.royal) sim.royal = p;
      if (p.id === R0.broodRoom) sim.broodRoom = p;
    }
    for (const q of R0.ants) {
      const a: Ant = {
        id: q.id!, x: q.x!, y: q.y!, hx: q.hx ?? 1, hy: q.hy ?? 0, role: q.role!, job: null, carry: q.carry ?? null, carryCol: q.carryCol || 0,
        busy: 0, acc: 0, speed: q.speed!, walk: 0, stuckT: 0, brood: null, born: q.born!, dies: q.dies!, home: q.home,
      };
      sim.ants.push(a); occAdd(idx(a.x, a.y), 1);
    }
    sim.brood = R0.brood.map((e) => ({ ...e }));
    sim.version = 1;
  }

  return sim;
}

// A saved farm from disk or anywhere else: checked just enough that a broken file starts a new farm instead of crashing.
export function readSave(raw: unknown, seed: number, W: number, H: number): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as SaveData;
  if (s.v !== 1 || s.seed !== seed || s.W !== W || s.H !== H) return null;
  if (!Array.isArray(s.ants) || !Array.isArray(s.chunks) || !Array.isArray(s.projects) || !Array.isArray(s.brood) || !Array.isArray(s.pockets)) return null;
  if (!s.life || typeof s.life.last !== 'number' || !s.box || !s.nest) return null;
  return s;
}
