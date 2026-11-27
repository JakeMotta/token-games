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
export const IDLE_REGEN = 0.03; // energy a tick with no tokens: a slow pulse, never fake progress

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

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Colours are packed 0xAABBGGRR, the byte order of canvas ImageData on little-endian machines.
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
export const rgb = (r: number, g: number, b: number): number => (0xff000000 | (clamp255(b) << 16) | (clamp255(g) << 8) | clamp255(r)) >>> 0;
export function hexRgb(h: string): [number, number, number] { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function shadeHex(h: string, k: number, jitter: number): number { const [r, g, b] = hexRgb(h); return rgb(r * k + jitter, g * k + jitter, b * k + jitter); }
export const scaleCol = (c: number, k: number): number => rgb((c & 255) * k, ((c >>> 8) & 255) * k, ((c >>> 16) & 255) * k);

// Smooth 1D noise in [-1, 1]: random control points every `step` cells, cosine eased.
export function noise1(rnd: Rng, n: number, step: number): Float32Array {
  const pts: number[] = [];
  for (let i = 0; i <= Math.ceil(n / step) + 1; i++) pts.push(rnd() * 2 - 1);
  const out = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const i = Math.floor(x / step), f = (x % step) / step, e = (1 - Math.cos(f * Math.PI)) / 2;
    out[x] = pts[i] * (1 - e) + pts[i + 1] * e;
  }
  return out;
}
