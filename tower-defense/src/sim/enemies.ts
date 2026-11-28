// The doodles that walk the road, and the waves they come in. Waves never end: hit points grow about 3% a wave
// (and a little linearly), so wave 100 is ~200× wave 1 and wave 1000 ~10^15×; past wave 2000 the growth turns
// logarithmic so the numbers stay finite for years of play. A boss leads every 10th wave, the Editor every 50th,
// and a new kind of doodle joins every few waves early on. Pure.
import { fin } from './num';

export const ENEMY_IDS = ['scribble', 'dash', 'blot', 'plane', 'gnat', 'ditto', 'eraser', 'boss', 'editor'] as const;
export type EnemyId = (typeof ENEMY_IDS)[number];

export interface EnemyDef {
  id: EnemyId;
  name: string;
  hp: number; // × the wave's hit points
  speed: number; // page units a second
  gold: number; // × the wave's gold
  r: number; // body radius
  from: number; // the first wave it can appear in
  weight: number; // how often it is rolled
  armor?: number; // share of damage it shrugs off (the Spyglass and the Ruler ignore it)
  flies?: boolean; // over the Thumbtack
  heals?: number; // share of max hp a second it gives to walkers near it
  splits?: number; // becomes this many scribbles when it falls
  lives: number; // lives it takes if it reaches the castle
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  scribble: { id: 'scribble', name: 'Scribble', hp: 1, speed: 38, gold: 1, r: 11, from: 1, weight: 10, lives: 1 },
  dash: { id: 'dash', name: 'Dash', hp: 0.55, speed: 70, gold: 0.8, r: 9, from: 3, weight: 6, lives: 1 },
  blot: { id: 'blot', name: 'Blot', hp: 2.2, speed: 28, gold: 1.8, r: 14, from: 6, weight: 5, armor: 0.5, lives: 2 },
  plane: { id: 'plane', name: 'Paper plane', hp: 0.8, speed: 52, gold: 1.1, r: 11, from: 9, weight: 4, flies: true, lives: 1 },
  gnat: { id: 'gnat', name: 'Gnat', hp: 0.3, speed: 58, gold: 0.35, r: 7, from: 12, weight: 4, lives: 1 },
  ditto: { id: 'ditto', name: 'Ditto', hp: 1.6, speed: 34, gold: 1.2, r: 13, from: 15, weight: 3, splits: 2, lives: 1 },
  eraser: { id: 'eraser', name: 'Eraser', hp: 1.4, speed: 32, gold: 1.5, r: 12, from: 20, weight: 2, heals: 0.03, lives: 1 },
  boss: { id: 'boss', name: 'Big Scribble', hp: 16, speed: 24, gold: 12, r: 20, from: 10, weight: 0, armor: 0.2, lives: 5 },
  editor: { id: 'editor', name: 'The Editor', hp: 70, speed: 20, gold: 50, r: 26, from: 50, weight: 0, armor: 0.35, heals: 0.01, lives: 10 },
};

const SOFT = 2000; // past this wave the growth turns logarithmic
const PER_WAVE = Math.log10(1.03);

// log10 of how much tougher wave `w` is than wave 1
export function waveLog(w: number): number {
  w = Math.max(1, w);
  const lin = Math.log10(1 + 0.1 * (w - 1));
  if (w <= SOFT) return lin + PER_WAVE * (w - 1);
  const at = PER_WAVE * (SOFT - 1);
  return lin + at + at * Math.log((w - 1) / (SOFT - 1));
}

export const BASE_HP = 18, BASE_GOLD = 3;
export const waveHp = (w: number): number => fin(BASE_HP * Math.pow(10, Math.min(299, waveLog(w))));
// gold grows a shade slower than hit points, so towers must keep levelling to keep up
export const waveGold = (w: number): number => fin(BASE_GOLD * Math.pow(10, Math.min(299, 0.97 * waveLog(w))));
// walkers get quicker, slowly, forever
export const speedMult = (w: number): number => 1 + 0.14 * Math.log(1 + Math.max(0, w - 1) / 15);

// Tokens a wave needs before it can be sent: 1,500 for wave 1, 600 more for every wave after.
export const waveCost = (w: number): number => fin(1500 + 600 * (Math.max(1, w) - 1));
// Weighted tokens: what a turn really cost. Cache reads are cheap, so they count a tenth.
export const weigh = (u: { input: number; output: number; cache_read: number; cache_write: number }): number =>
  fin((u.input || 0) + (u.output || 0) + (u.cache_write || 0) + (u.cache_read || 0) / 10);

// Gold a finished turn pays: a handful of kills' worth.
export const turnGold = (w: number): number => Math.ceil(waveGold(w) * 6);

// Seeded random numbers (mulberry32): a wave is the same every time it is rolled.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Wave { n: number; list: EnemyId[]; gap: number; boss: boolean }

// Roll wave `n`: which doodles, in what order, how far apart (seconds). The boss walks last.
export function rollWave(n: number, seed: number): Wave {
  const r = rng(seed * 7919 + n * 104729);
  const count = Math.min(34, 6 + Math.floor(n * 0.55));
  const pool = ENEMY_IDS.filter((id) => ENEMIES[id].weight > 0 && ENEMIES[id].from <= n);
  const total = pool.reduce((s, id) => s + ENEMIES[id].weight, 0);
  const list: EnemyId[] = [];
  // a newly unlocked kind shows up at once, so the player meets it
  const fresh = pool.find((id) => ENEMIES[id].from === n);
  if (fresh) list.push(fresh, fresh);
  while (list.length < count) {
    let x = r() * total, pick: EnemyId = pool[0];
    for (const id of pool) { x -= ENEMIES[id].weight; if (x < 0) { pick = id; break; } }
    if (pick === 'gnat') for (let i = 0; i < 4 && list.length < count; i++) list.push('gnat');
    else list.push(pick);
  }
  const boss = n % 10 === 0;
  if (boss) list.push(n % 50 === 0 ? 'editor' : 'boss');
  if (n % 50 === 0 && n >= 100) list.push('boss', 'boss');
  return { n, list, gap: Math.max(0.35, 1.0 - n * 0.006), boss };
}
