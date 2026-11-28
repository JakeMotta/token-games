// Dev only, never part of the game: plays the real simulation fast with a made-up token feed and a simple greedy
// player, for balance checks and for screenshots of a late game.
//   npm run autoplay -- <folder> [--waves 300]     writes <folder>/settings.json and save.json (for npm run perf -- --profile)
//   npm run autoplay -- --balance                  prints how far three kinds of player get
import fs from 'node:fs';
import path from 'node:path';
import { TDGame, STEP } from '../src/sim/game';
import { waveCost } from '../src/sim/enemies';
import { COLS, ROWS } from '../src/sim/map';
import { fmt } from '../src/sim/num';
import { TOWERS, type TowerId } from '../src/sim/towers';
import { kit } from '../src/shared/settings';

const ORDER: TowerId[] = ['quill', 'bomb', 'quill', 'frost', 'ruler', 'quill', 'spark', 'bomb', 'thorn', 'glass', 'flag', 'well', 'tack', 'candle', 'crane', 'quill', 'bomb', 'spark', 'glass', 'flag', 'thorn', 'crane', 'frost', 'ruler'];
const NEAR: [number, number][] = [[6, 4], [10, 9], [14, 12], [20, 8], [24, 5], [28, 9], [17, 3], [8, 14], [30, 4], [22, 14], [18, 9], [12, 3], [9, 6], [26, 12], [32, 8], [4, 10], [16, 15], [34, 4], [21, 2], [24, 11], [13, 6], [29, 15], [19, 12], [36, 11]];

function spot(g: TDGame, type: TowerId, near: [number, number]): [number, number] | null {
  let best: [number, number] | null = null, bd = Infinity;
  for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) if (g.grid.ok(type, cx, cy)) {
    const d = (cx - near[0]) ** 2 + (cy - near[1]) ** 2;
    if (d < bd) { bd = d; best = [cx, cy]; }
  }
  return best;
}

// Play until `waves` (or the clock runs out); `upgrades` false never levels a tower.
export function play(waves: number, upgrades = true, seed = 2, maxHours = 40): TDGame {
  const g = new TDGame(seed);
  g.tips = 9;
  let k = 0;
  while (g.wave < waves && g.time < maxHours * 3600 && g.stats.tears < 3) {
    if (!g.busy()) g.feed({ type: 'tokens', input: waveCost(g.wave + 1), output: 0, cache_read: 0, cache_write: 0 });
    if (g.time % 600 < 1) g.feed({ type: 'task_done' });
    const want = k < ORDER.length ? ORDER[k] : null;
    if (want && TOWERS[want].unlock <= Math.max(1, g.stats.best)) {
      if (g.gold >= TOWERS[want].cost) { const s = spot(g, want, NEAR[k]); if (s) g.build(want, s[0], s[1]); k++; }
    } else if (upgrades && g.towers.length) {
      const w = g.towers.reduce((a, b) => (g.upgradeCost(b) < g.upgradeCost(a) ? b : a));
      g.upgrade(w, 1);
    }
    for (let i = 0; i < 1 / STEP; i++) g.step();
  }
  return g;
}

const args = process.argv.slice(2);
if (args.includes('--balance')) {
  for (const [name, up] of [['never upgrades', false], ['upgrades', true]] as const) {
    const g = play(300, up);
    console.log(`${name}: wave ${g.wave}, tears ${g.stats.tears}, ${Math.round(g.time / 60)} min of play, gold ${fmt(g.gold)}, levels ${g.towers.map((t) => t.level).join('/')}`);
  }
} else if (args[0]) {
  const waves = Number(args[args.indexOf('--waves') + 1]) || 300;
  const g = play(waves, true, 2, 400);
  // a busy page for the screenshots: the wave in progress stays out of the save, so queue a few in the bucket
  g.ink += waveCost(g.wave + 1) * 3;
  fs.mkdirSync(args[0], { recursive: true });
  fs.writeFileSync(path.join(args[0], 'save.json'), JSON.stringify(g.save()));
  fs.writeFileSync(path.join(args[0], 'settings.json'), JSON.stringify({ ...kit.defaults(), size: 'large', width: 640, presentation: 'floating' }));
  console.log(`wave ${g.wave}, ${g.towers.length} towers, gold ${fmt(g.gold)}, written to ${args[0]}`);
} else console.log('usage: npm run autoplay -- <folder> [--waves N] | --balance');
