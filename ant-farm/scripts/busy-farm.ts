// A busy farm to measure, headless: hours of steady Claude Code use played through the real simulation (a clock that
// moves 50 ms a tick, so ants are born, age and dig as they would), written as a profile folder for the perf run.
//   npm run busy-farm -- <folder> [--hours 3] [--size ridiculous]
//   npm run perf -- --profile <folder>
// The folder gets settings.json (popped out, large, full motion) and colony.json. It never touches a real profile.
import fs from 'node:fs';
import path from 'node:path';
import { createSim } from '../src/sim/sim';
import { TICK_HZ, type MapSize } from '../src/sim/world';

const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const dir = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : '';
if (!dir) { console.error('usage: busy-farm <folder> [--hours 3] [--size ridiculous]'); process.exit(1); }
const hours = Number(arg('--hours', '3')), size = arg('--size', 'ridiculous') as MapSize, seed = 4242;

const ticks = Math.round(hours * 3600 * TICK_HZ), dt = 1000 / TICK_HZ;
let clock = Date.now() - ticks * dt;
const sim = createSim({ seed, size, now: () => clock });
const ev = (type: 'tokens' | 'task_done') => ({ v: 1 as const, source: 'claude-code', type, input: 30_000, output: 8_000, cache_read: 200_000, cache_write: 4_000, ts: clock } as never);
for (let i = 0; i < ticks; i++) {
  if (i % (TICK_HZ * 20) === 0) sim.feed(ev('tokens')); // a reply every 20 s
  if (i % (TICK_HZ * 240) === 0) sim.feed(ev('task_done')); // a finished turn every 4 minutes
  sim.step(); clock += dt;
}
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'colony.json'), JSON.stringify(sim.save()));
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ presentation: 'floating', reducedMotion: false, size: 'large', palette: 'terminal', calm: 0.25, fadeIdle: true, mapSize: size, seed }));
const h = sim.health(), c = sim.chunkStats();
console.log(JSON.stringify({ dir, hours, size, ants: sim.ants.length, workers: h.workers, brood: h.brood, food: h.food, dug: sim.stats.dug, chunksChanged: c.modified, over: sim.over() }));
