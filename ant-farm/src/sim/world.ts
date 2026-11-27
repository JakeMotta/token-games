// The world's building blocks: cell types, what a painted pixel shows, soil layers, colours and the seeded random
// numbers everything is made from. No DOM, no Electron.

// Cell types. Every cell is one pixel.
export const AIR = 0, DIRT = 1, ROCK = 2, LOOSE = 3, FOOD = 4, CRUMB = 5, GLASS = 6;
export const SOLID = [false, true, true, true, true, true, true];
export const DIGGABLE = [false, true, false, true, true, true, false];
export const FALLS = [false, false, false, true, false, true, false];
export const CEILING = [false, true, false, false, true, false, false]; // fixed soil that can span a gap

// What a painted pixel shows, so a palette can recolour each kind separately.
export const K = { SKY: 0, WALL: 1, SOIL: 2, GRASS: 3, LOOSE: 4, ROCK: 5, FOOD: 6, GLASS: 7, CRACK: 8, BROOD: 9, ANT: 10, QUEEN: 11, LOAD_FOOD: 12, LOAD_GRAIN: 13 } as const;

export const TICK_HZ = 20;
export const DIG_TICKS = 4; // time to bite one grain loose
export const DROP_TICKS = 3;
export const BROOD_STAGES = [220, 480, 700]; // egg -> larva -> pupa -> adult (ticks)
export const MAX_ENERGY = 5000;

// Food never piles up without end: crumbs wait in the sky while this many lie uncollected, the sky holds at most
// this many, and a full store feeds the forager who brings one more.
export const LOOSE_CRUMB_CAP = 30;
export const MAX_CRUMB_QUEUE = 40;
export const STORE_CAP = 80;

// Map sizes, in cells (one cell is one pixel at zoom 1). Classic is the first prototype's farm; the app's default is
// Ridiculous. Only the chunks the colony touched are kept, so memory doesn't grow with the size: see chunks.ts.
export const MAP_SIZES = {
  classic: { W: 420, H: 260, name: 'Classic' },
  large: { W: 2048, H: 1024, name: 'Large' },
  huge: { W: 8192, H: 4096, name: 'Huge' },
  ridiculous: { W: 65536, H: 16384, name: 'Ridiculous' },
} as const;
export type MapSize = keyof typeof MAP_SIZES;

// Life, in real wall-clock time (the app's clock, not simulation ticks), so a farm left closed still ages.
const HOUR = 3_600_000;
export const ANT_LIFESPAN_MS = 48 * HOUR; // a worker lives about two days...
export const LIFESPAN_JITTER = 0.15; // ...give or take 15%, so they don't all go at once
export const QUEEN_LIFESPAN_MS = 14 * 24 * HOUR; // the queen about two weeks; then a worker takes over
export const ANT_MEAL_MS = 6 * HOUR; // each ant eats one stored crumb every 6 hours
export const STARVE_DEATH_MS = 45 * 60_000; // with the store empty, one worker dies every 45 minutes
export const STARVE_GRACE_MS = 7 * 24 * HOUR; // the last few hold out this long on a minimal reserve
export const MIN_SURVIVORS = 2; // workers (besides the queen) that starvation spares during the grace
export const DYING_TICKS = 60; // an old ant fades out over 3 seconds

export type LayerName = 'topsoil' | 'loam' | 'sand' | 'clay' | 'deep';
// span = the widest flat ceiling (in cells) the layer holds up
export const LAYERS: Record<LayerName, { col: string; span: number }> = {
  topsoil: { col: '#4d3b2d', span: 10 },
  loam: { col: '#6d5240', span: 14 },
  sand: { col: '#a2875f', span: 8 },
  clay: { col: '#8a5a43', span: 20 },
  deep: { col: '#5b4536', span: 16 },
};

export const PAL = {
  skyTop: '#232a3a', skyLow: '#3a4356', grass: '#5f6d47', rock: '#6f737b', glass: '#1a1e27',
  seed: '#d4a65e', fungus: '#9fb06c', crumb: '#ecc87e',
};

export interface Rng { (): number; state(): number } // state() restarts the same sequence: mulberry32(rnd.state())

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const f = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  } as Rng;
  f.state = () => a;
  return f;
}

// A random number in [0, 1) that depends only on its inputs, so any cell of a huge map is made on demand.
export function hash01(seed: number, x: number, y: number, salt = 0): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(x | 0, 0xc2b2ae35) ^ Math.imul(y | 0, 0x27d4eb2f) ^ Math.imul(salt + 1, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// Smooth 1D noise in [-1, 1] at any x: hashed control points every `step` cells, cosine eased.
export function noiseAt(seed: number, salt: number, x: number, step: number): number {
  const i = Math.floor(x / step), f = (x - i * step) / step, e = (1 - Math.cos(f * Math.PI)) / 2;
  const a = hash01(seed, i, 0, salt) * 2 - 1, b = hash01(seed, i + 1, 0, salt) * 2 - 1;
  return a * (1 - e) + b * e;
}

// Colours are packed 0xAABBGGRR, the byte order of canvas ImageData on little-endian machines.
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
export const rgb = (r: number, g: number, b: number): number => (0xff000000 | (clamp255(b) << 16) | (clamp255(g) << 8) | clamp255(r)) >>> 0;
export function hexRgb(h: string): [number, number, number] { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function shadeHex(h: string, k: number, jitter: number): number { const [r, g, b] = hexRgb(h); return rgb(r * k + jitter, g * k + jitter, b * k + jitter); }
export const scaleCol = (c: number, k: number): number => rgb((c & 255) * k, ((c >>> 8) & 255) * k, ((c >>> 16) & 255) * k);

// A cell's colour is stored as a 16-bit code, source << 8 | shade, and looked up here: half the memory of a colour,
// and the same grain keeps the same code wherever it is carried.
export const SRC = { GLASS: 0, TOPSOIL: 1, LOAM: 2, SAND: 3, CLAY: 4, DEEP: 5, GRASS: 6, ROCK: 7, SEED: 8, FUNGUS: 9, CRUMB: 10 } as const;
export const LAYER_OF_SRC: LayerName[] = ['deep', 'topsoil', 'loam', 'sand', 'clay', 'deep'];
// shade byte: 128 + jitter for soil and grass, or a 0..255 brightness for rock (0.85..1.15), food (0.85..1.15) and
// crumbs (0.9..1.1)
export const jitterShade = (j: number): number => Math.max(0, Math.min(255, Math.round(j) + 128));
export const COLOURS = new Uint32Array(11 * 256); // code -> colour
export const LOOSE_COLOURS = new Uint32Array(11 * 256); // loose grains show a shade lighter, like fresh-dug earth
export const WALL_COLOURS = new Uint32Array(6 * 256); // the back wall where a layer is dug out
{
  const src = [PAL.glass, LAYERS.topsoil.col, LAYERS.loam.col, LAYERS.sand.col, LAYERS.clay.col, LAYERS.deep.col, PAL.grass, PAL.rock, PAL.seed, PAL.fungus, PAL.crumb];
  for (let s = 0; s < src.length; s++) for (let b = 0; b < 256; b++) {
    const c = s === SRC.GLASS ? shadeHex(PAL.glass, 1, 0)
      : s <= SRC.GRASS ? shadeHex(src[s], 1, b - 128)
      : s === SRC.CRUMB ? shadeHex(src[s], 0.9 + (b / 255) * 0.2, 0) : shadeHex(src[s], 0.85 + (b / 255) * 0.3, 0);
    COLOURS[s * 256 + b] = c; LOOSE_COLOURS[s * 256 + b] = scaleCol(c, 1.18);
    if (s >= 1 && s <= 5) WALL_COLOURS[s * 256 + b] = shadeHex(src[s], 0.36, (b - 128) * 0.3);
  }
}
