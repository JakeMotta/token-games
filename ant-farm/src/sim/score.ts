// The score of one run (one colony, from its founding queen to its last ant), and the local record of past runs.
// Pure: no DOM, no files. The formula is in docs/ant-farm-design.md ("Score") and the README; keep them in step.
import type { Sim } from './sim';

const HOUR = 3_600_000, DAY = 24 * HOUR;

export interface ScoreInput {
  born: number; // ants raised from eggs
  dug: number; // blocks dug
  deepest: number; // rows below the surface of the deepest block dug
  collected: number; // crumbs of food gathered
  tokens: number; // weighted tokens fed (cache reads count a tenth)
  oldestMs: number; // the longest life of any ant this run, dead or alive
  aliveMs: number; // how long the colony has lived
  rooms: number; // chambers finished: the queen's, the nursery, galleries
  tunnels: number; // tunnels finished on their own: to food, and scouting
}

// Each part: points for every `per` of the input. Whole units only, so the score never jitters.
export const RULES = [
  { key: 'born', label: 'ants born', points: 10, per: 1 },
  { key: 'dug', label: 'blocks dug', points: 1, per: 1 },
  { key: 'deepest', label: 'rows deep', points: 5, per: 1 },
  { key: 'collected', label: 'food collected', points: 2, per: 1 },
  { key: 'tokens', label: 'thousand tokens fed', points: 1, per: 1000 },
  { key: 'oldestMs', label: 'hours, the oldest ant', points: 20, per: HOUR },
  { key: 'aliveMs', label: 'days survived', points: 100, per: DAY },
  { key: 'rooms', label: 'rooms', points: 100, per: 1 },
  { key: 'tunnels', label: 'tunnels', points: 25, per: 1 },
] as const satisfies readonly { key: keyof ScoreInput; label: string; points: number; per: number }[];

export interface ScorePart { key: keyof ScoreInput; label: string; count: number; points: number }
export interface Score { total: number; parts: ScorePart[] }

export function score(i: ScoreInput): Score {
  const parts = RULES.map((r) => {
    const count = Math.max(0, Math.floor((i[r.key] || 0) / r.per));
    return { key: r.key, label: r.label, count, points: count * r.points };
  });
  return { total: parts.reduce((s, p) => s + p.points, 0), parts };
}

export function scoreInput(sim: Sim): ScoreInput {
  const t = sim.life.over || sim.now(), done = sim.projects.filter((p) => p.done && !p.failed);
  const alive = sim.ants.filter((a) => a.dying === undefined);
  return {
    born: sim.stats.born, dug: sim.stats.dug, deepest: sim.stats.deepest, collected: sim.stats.collected, tokens: sim.stats.tokens,
    oldestMs: alive.reduce((m, a) => Math.max(m, t - a.born), sim.stats.oldestMs || 0),
    aliveMs: sim.life.started ? Math.max(0, t - sim.life.started) : 0,
    rooms: done.filter((p) => p.kind === 'royal' || p.kind === 'brood' || p.kind === 'gallery').length,
    tunnels: done.filter((p) => p.kind === 'food' || p.kind === 'scout').length,
  };
}

// ---------- the record of runs, kept on this computer only ----------

export interface Run { score: number; started: number; ended: number; seed: number; parts?: ScorePart[] }
export interface Runs { best: Run | null; list: Run[] } // list: newest first; the best is kept even once it leaves the list
export const RUNS_KEPT = 20;

export const emptyRuns = (): Runs => ({ best: null, list: [] });
const isRun = (x: unknown): x is Run => !!x && typeof (x as Run).score === 'number' && typeof (x as Run).ended === 'number';
const same = (a: Run, b: Run) => a.started === b.started && a.seed === b.seed;

// Anything read from disk: checked, so a broken file means an empty record rather than a crash.
export function readRuns(raw: unknown): Runs {
  const r = raw as Partial<Runs> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.list)) return emptyRuns();
  const list = r.list.filter(isRun).slice(0, RUNS_KEPT);
  const best = [isRun(r.best) ? r.best : null, ...list].reduce<Run | null>((b, x) => (x && (!b || x.score > b.score) ? x : b), null);
  return { best, list };
}

// A run ended: add it (once: the same run is never recorded twice) and keep the best.
export function recordRun(runs: Runs, run: Run): Runs {
  if (runs.list.some((x) => same(x, run))) return runs;
  return { best: !runs.best || run.score > runs.best.score ? run : runs.best, list: [run, ...runs.list].slice(0, RUNS_KEPT) };
}

// How a finished run compares with the runs before it, for the game over screen (whether or not it is recorded yet).
export interface Compare { best: number; isBest: boolean; last: Run | null; vsLast: number | null; vsBest: number }
export function compare(runs: Runs, run: Run): Compare {
  const others = runs.list.filter((x) => !same(x, run) && x.ended <= run.ended);
  const prevBest = Math.max(runs.best && !same(runs.best, run) ? runs.best.score : 0, ...others.map((x) => x.score));
  const last = others[0] ?? null;
  return {
    best: Math.max(prevBest, run.score), isBest: run.score > prevBest, last,
    vsLast: last ? run.score - last.score : null, vsBest: run.score - prevBest,
  };
}
