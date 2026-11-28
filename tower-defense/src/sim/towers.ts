// The towers: what each one is for, what it costs, and how it grows. Levels never end: every level adds damage,
// reach and speed, every tenth level is a milestone (double damage and the tower's own special grows), and the
// cost climbs by 18% a level. Reach and speed grow on a log curve (they would cover the page otherwise), never capped.
// Pure: the simulation (game.ts) and the build menu read the same numbers.
import { fin, powSafe } from './num';

export const TOWER_IDS = ['quill', 'bomb', 'frost', 'ruler', 'spark', 'thorn', 'glass', 'flag', 'well', 'tack', 'candle', 'crane'] as const;
export type TowerId = (typeof TOWER_IDS)[number];

export type Aim = 'first' | 'strong' | 'near' | 'last';
export const AIMS: Aim[] = ['first', 'strong', 'near', 'last'];

export interface TowerDef {
  id: TowerId;
  name: string;
  role: string; // one line for the build menu
  flavor: string; // what its milestones add
  size: 2 | 3; // footprint in cells
  cost: number;
  unlock: number; // the wave that unlocks it
  dmg: number; // per hit (per second for thorn, per tick for candle)
  rate: number; // shots a second
  range: number; // in page units (a cell is 24)
  onRoad?: boolean; // the tack sits on the road; every other tower stays off it
}

export const TOWERS: Record<TowerId, TowerDef> = {
  quill: { id: 'quill', name: 'Quill', role: 'Fast darts at one target', flavor: '+1 dart every 10 levels', size: 2, cost: 50, unlock: 1, dmg: 6, rate: 2.6, range: 120 },
  bomb: { id: 'bomb', name: 'Ink Bomb', role: 'Lobbed blots that splash a crowd', flavor: 'A wider splash every level', size: 3, cost: 90, unlock: 1, dmg: 16, rate: 0.6, range: 130 },
  frost: { id: 'frost', name: 'Snowflake', role: 'A chill pulse that slows everyone near', flavor: 'Colder and longer every 10 levels', size: 2, cost: 70, unlock: 3, dmg: 3, rate: 0.8, range: 95 },
  ruler: { id: 'ruler', name: 'Ruler', role: 'A straight line that pierces every foe on it', flavor: 'A wider line every 10 levels', size: 2, cost: 120, unlock: 5, dmg: 20, rate: 0.55, range: 170 },
  spark: { id: 'spark', name: 'Spark Jar', role: 'Lightning that jumps between foes', flavor: '+1 jump every 5 levels', size: 2, cost: 150, unlock: 8, dmg: 12, rate: 0.9, range: 120 },
  thorn: { id: 'thorn', name: 'Thornbush', role: 'Poison that keeps hurting, and stacks', flavor: '+1 stack every 10 levels', size: 2, cost: 130, unlock: 11, dmg: 7, rate: 1.1, range: 110 },
  glass: { id: 'glass', name: 'Spyglass', role: 'A slow, huge shot across the page; armour no help', flavor: 'More critical hits every 10 levels', size: 2, cost: 220, unlock: 14, dmg: 95, rate: 0.33, range: 360 },
  flag: { id: 'flag', name: 'Banner', role: 'Cheers on towers nearby: more damage and speed', flavor: 'A bigger cheer every level', size: 2, cost: 200, unlock: 18, dmg: 0, rate: 0, range: 115 },
  well: { id: 'well', name: 'Inkwell', role: 'Gold after every wave, more for kills nearby', flavor: 'Richer every level', size: 3, cost: 250, unlock: 22, dmg: 0, rate: 0, range: 120 },
  tack: { id: 'tack', name: 'Thumbtack', role: 'A trap on the road: stabs and slows walkers', flavor: 'Stabs twice every 10 levels', size: 2, cost: 100, unlock: 26, dmg: 30, rate: 0, range: 26, onRoad: true },
  candle: { id: 'candle', name: 'Candle', role: 'A short flame cone that burns everything in it', flavor: 'A wider flame every 10 levels', size: 2, cost: 260, unlock: 30, dmg: 5, rate: 6, range: 85 },
  crane: { id: 'crane', name: 'Paper Crane', role: 'Folds cranes that fly out and peck', flavor: '+1 crane every 10 levels', size: 3, cost: 400, unlock: 35, dmg: 14, rate: 1.2, range: 150 },
};

export const unlockedAt = (wave: number): TowerId[] => TOWER_IDS.filter((id) => TOWERS[id].unlock <= wave);
// the next tower to unlock after `wave`, for the build menu's "new at wave N"
export const nextUnlock = (wave: number): TowerDef | null => TOWER_IDS.map((id) => TOWERS[id]).find((t) => t.unlock > wave) ?? null;

export const COST_GROWTH = 1.18;

// What levelling from `level` to `level + 1` costs: 18% more each level, never capped.
export function upgradeCost(id: TowerId, level: number): number {
  return Math.ceil(fin(TOWERS[id].cost * 0.8 * powSafe(COST_GROWTH, level - 1)));
}

// Gold put into a tower so far (build plus every upgrade): the sum of a geometric series, so it stays O(1).
export function spent(id: TowerId, level: number): number {
  const base = TOWERS[id].cost * 0.8;
  return fin(TOWERS[id].cost + base * (powSafe(COST_GROWTH, level - 1) - 1) / (COST_GROWTH - 1));
}

export const SELL_BACK = 0.7;
export const sellValue = (id: TowerId, level: number): number => Math.floor(spent(id, level) * SELL_BACK);

// How many levels `gold` buys from `level` (up to `most`), and what they cost: for the "×10" and "max" buttons.
export function affordable(id: TowerId, level: number, gold: number, most = Infinity): { levels: number; cost: number } {
  let n = 0, cost = 0;
  while (n < most && n < 100000) {
    const c = upgradeCost(id, level + n);
    if (cost + c > gold) break;
    cost += c; n++;
  }
  return { levels: n, cost };
}

export interface TowerStats {
  dmg: number; rate: number; range: number;
  multi: number; // darts per volley, chain jumps, cranes, poison stacks, tack stabs
  area: number; // splash radius, line width, flame half-angle (radians), slow strength (0..1)
  time: number; // slow, poison or burn seconds
  crit: number; // the Spyglass's critical chance (0..1)
  aura: number; // the Banner's cheer (0.2 = +20%), the Inkwell's gold multiplier
}

const log1 = (x: number) => Math.log(1 + x);

// A tower's numbers at `level`, before a Banner's cheer. Each milestone (every 10 levels) doubles damage.
export function stats(id: TowerId, level: number): TowerStats {
  const d = TOWERS[id], L = Math.max(1, level), m = Math.floor(L / 10);
  const dmg = fin(d.dmg * powSafe(1.12, L - 1) * powSafe(2, m));
  const rate = d.rate * (1 + 0.22 * log1((L - 1) / 3));
  const range = d.range * (1 + 0.13 * log1((L - 1) / 4));
  const s: TowerStats = { dmg, rate, range, multi: 1, area: 0, time: 0, crit: 0, aura: 0 };
  switch (id) {
    case 'quill': s.multi = 1 + m; break;
    case 'bomb': s.area = 42 * (1 + 0.25 * log1((L - 1) / 2)); break;
    // slowing approaches 75% and never reaches it: a frozen walker would stall a wave forever
    case 'frost': s.area = 0.75 - 0.45 * Math.pow(0.85, m + (L - 1) / 10); s.time = 1.4 + 0.4 * log1(L - 1) + 0.25 * m; break;
    case 'ruler': s.area = 12 * (1 + 0.3 * m / (1 + m * 0.05)); break;
    case 'spark': s.multi = 3 + Math.floor(L / 5); break;
    case 'thorn': s.multi = 3 + m; s.time = 4 + 0.5 * log1(L - 1); break;
    case 'glass': s.crit = 1 - 1 / (1 + 0.08 * m + 0.004 * (L - 1)); break;
    case 'flag': s.aura = 0.18 + 0.12 * log1(L - 1) + 0.1 * m; break;
    case 'well': s.aura = fin(powSafe(1.1, L - 1) * powSafe(1.5, m)); break;
    case 'tack': s.multi = 1 + m; s.area = 0.3; s.time = 0.6; break;
    case 'candle': s.area = 0.45 * (1 + 0.15 * log1(m)); s.time = 1.5 + 0.2 * m; break;
    case 'crane': s.multi = 2 + m; break;
  }
  return s;
}

// Damage a second against one target, for the tower panel. Rough on purpose: it ignores splash and chains.
export function dps(id: TowerId, s: TowerStats): number {
  switch (id) {
    case 'thorn': return fin(s.dmg * s.multi);
    case 'flag': case 'well': return 0;
    case 'glass': return fin(s.dmg * s.rate * (1 + 2 * s.crit));
    case 'quill': case 'crane': return fin(s.dmg * s.rate * s.multi);
    case 'tack': return fin(s.dmg * s.multi);
    default: return fin(s.dmg * s.rate);
  }
}

export const ROMAN = (n: number): string => {
  if (n >= 40) return String(n);
  const r: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, t] of r) while (n >= v) { s += t; n -= v; }
  return s;
};
