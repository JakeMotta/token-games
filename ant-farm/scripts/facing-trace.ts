// Headless proof of how ants move and face on screen (game/motion.ts), before and after, at a 120 Hz display:
//   npm run facing-trace -- <folder> [--save <colony.json>]   (a saved farm is read only, never written)
// 1. A scripted walk: along flat ground, over a one-cell bump, a turn-around, then up a shaft and off it. Every frame's
//    drawn position and facing, the old way (the simulation's last step, drawn on its cell) and the new way.
// 2. A real busy colony for a minute of simulated time: how often an ant looks up or down without moving up or down,
//    how often its head jumps across its body in one frame, and how many frames show a walking ant in a new place.
// Writes trace.json and frames.html (the scripted walk as a strip of frames, old above new).
import fs from 'node:fs';
import path from 'node:path';
import { createSim, readSave, type Ant, type Sim } from '../src/sim/sim';
import { Motion, STEP_MS, narrowAt, type Mover } from '../src/game/motion';

const out = process.argv[2];
if (!out) { console.error('usage: facing-trace <folder>'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const FRAME = 1000 / 120, PER = Math.round(STEP_MS / FRAME);
const r2 = (v: number) => Math.round(v * 100) / 100;
// the old drawing: the head on the simulation's last single step, (1, 0) when it has none
const oldFace = (hx: number, hy: number) => (hx === 0 && hy === 0 ? [1, 0] : [hx, hy]);

// 1. the scripted walk
const cells: [number, number, string][] = [];
const go = (x: number, y: number, what: string) => cells.push([x, y, what]);
for (let x = 4; x <= 9; x++) go(x, 20, 'flat');
go(10, 19, 'bump'); go(11, 19, 'bump'); go(12, 20, 'bump');
for (let x = 13; x <= 15; x++) go(x, 20, 'flat');
for (let x = 14; x >= 11; x--) go(x, 20, 'turn-around');
for (let x = 10; x >= 9; x--) go(x, 20, 'flat');
for (let y = 19; y >= 15; y--) go(9, y, 'shaft');
for (let x = 10; x <= 12; x++) go(x, 15, 'off the shaft');
for (let i = 0; i < 3; i++) go(12, 15, 'standing');

interface Row { t: number; what: string; x: number; y: number; oldFx: number; oldFy: number; drawX: number; drawY: number; fx: number; fy: number }
const rows: Row[] = [];
{
  const m = new Motion(), p = { x: 0, y: 0, fx: 0, fy: 0 };
  let px = cells[0][0], py = cells[0][1], t = 0;
  for (const [x, y, what] of cells) {
    const hx = Math.sign(x - px), hy = Math.sign(y - py);
    const [ox, oy] = x === px && y === py && rows.length ? [rows[rows.length - 1].oldFx, rows[rows.length - 1].oldFy] : oldFace(hx, hy);
    px = x; py = y;
    for (let f = 0; f < PER; f++, t += FRAME) {
      m.update([{ id: 1, x, y, hx, speed: 1 }], t, true);
      m.pose(1, p);
      rows.push({ t: Math.round(t), what, x, y, oldFx: ox, oldFy: oy, drawX: r2(p.x), drawY: r2(p.y), fx: r2(p.fx), fy: r2(p.fy) });
    }
  }
}

// 2. a real busy colony
const saveAt = process.argv.includes('--save') ? process.argv[process.argv.indexOf('--save') + 1] : '';
const busy = () => {
  let sim: Sim;
  if (saveAt) {
    const raw = JSON.parse(fs.readFileSync(saveAt, 'utf8'));
    sim = createSim({ restore: readSave(raw, raw.seed, raw.W, raw.H)! });
  } else {
    sim = createSim({ seed: 7, size: 'large' });
    sim.run(2000);
  }
  sim.feed({ v: 1, source: 'trace', type: 'tokens', input: 400_000, output: 200_000, cache_read: 0, cache_write: 0, ts: 0 });
  const m = new Motion(), p = { x: 0, y: 0, fx: 0, fy: 0 }, narrow = (x: number, y: number) => narrowAt(sim, x, y);
  interface Seen { x: number; y: number; vert: number; oldFx: number; oldFy: number; fx: number; fy: number; dx: number; dy: number; moved: number; before: number }
  const seen = new Map<number, Seen>();
  const n = { antFrames: 0, oldVertWalkingLevel: 0, newVertWalkingLevel: 0, oldVertStanding: 0, newVertStanding: 0, newVertStandingInShaft: 0, oldVertStrolling: 0, newVertStrolling: 0, oldHeadJumps: 0, newHeadJumps: 0, walkFrames: 0, oldNewPlace: 0, newNewPlace: 0, maxNewStep: 0 };
  const vertical = (fx: number, fy: number) => Math.abs(fy) > 0.5 && Math.abs(fx) < 0.5;
  let t = 0;
  for (let tick = 0; tick < 1200; tick++) { // a minute
    sim.step();
    for (let f = 0; f < PER; f++, t += FRAME) {
      m.update(sim.ants as readonly Mover[], t, true, narrow);
      for (const a of sim.ants as Ant[]) {
        if (a.dying !== undefined || !m.pose(a.id, p)) continue;
        let s = seen.get(a.id);
        const [ox, oy] = oldFace(a.hx || 0, a.hy || 0);
        if (!s) { s = { x: a.x, y: a.y, vert: -1e9, oldFx: ox, oldFy: oy, fx: p.fx, fy: p.fy, dx: p.x, dy: p.y, moved: -1e9, before: -1e9 }; seen.set(a.id, s); }
        if (f === 0 && a.y !== s.y) s.vert = tick;
        if (f === 0 && (a.x !== s.x || a.y !== s.y)) { s.before = s.moved; s.moved = tick; }
        n.antFrames++;
        // looking straight up or down while walking on the level (no step up or down in the last three steps' time),
        // and while standing still (digging, or resting in a shaft)
        const level = tick - s.vert > 3, walking = tick - s.moved <= 1, strolling = walking && s.moved - s.before <= 2;
        if (level && walking && vertical(ox, oy)) n.oldVertWalkingLevel++;
        if (level && walking && vertical(p.fx, p.fy)) n.newVertWalkingLevel++;
        // the same once it has taken two level steps (not the eased first moments of walking off from a rest in a shaft)
        if (level && strolling && vertical(ox, oy)) n.oldVertStrolling++;
        if (level && strolling && vertical(p.fx, p.fy)) n.newVertStrolling++;
        if (!walking && vertical(ox, oy)) n.oldVertStanding++;
        if (!walking && vertical(p.fx, p.fy)) {
          n.newVertStanding++;
          // in a shaft (no room to its left or right), where clinging upright is the only way it fits
          if (narrow(a.x, a.y)) n.newVertStandingInShaft++;
        }
        // the head crossing to the other side of the body within one frame
        if (Math.hypot(ox - s.oldFx, oy - s.oldFy) >= 1.5) n.oldHeadJumps++;
        if (Math.hypot(p.fx - s.fx, p.fy - s.fy) >= 1.5) n.newHeadJumps++;
        // a walking ant: does this frame show it somewhere new?
        if (tick - s.moved <= 1 && Math.abs(a.x - s.x) + Math.abs(a.y - s.y) <= 1) {
          n.walkFrames++;
          if (f === 0 && (a.x !== s.x || a.y !== s.y)) n.oldNewPlace++;
          const step = Math.hypot(p.x - s.dx, p.y - s.dy);
          if (step > 0.001) n.newNewPlace++;
          if (step <= 2) n.maxNewStep = Math.max(n.maxNewStep, step);
        }
        s.x = a.x; s.y = a.y; s.oldFx = ox; s.oldFy = oy; s.fx = p.fx; s.fy = p.fy; s.dx = p.x; s.dy = p.y;
      }
    }
  }
  return { ants: sim.ants.length, ...n, maxNewStep: r2(n.maxNewStep) };
};
const colony = busy();

// the turn-around in the scripted walk: how long from facing right to facing left, and whether it ever looked up or down
const turnRows = rows.filter((r) => r.what === 'turn-around');
const t0 = turnRows[0].t, firstLeft = turnRows.find((r) => r.fx <= -0.9);
const summary = {
  display: '120 Hz', framesPerStep: PER,
  turnAround: {
    old: { framesToTurn: 1, everVertical: turnRows.some((r) => r.oldFy !== 0) },
    new: { msTo90Percent: firstLeft ? firstLeft.t - t0 : null, everVertical: turnRows.some((r) => r.fy !== 0), fxOverTime: turnRows.slice(0, 24).map((r) => r.fx) },
  },
  bump: { oldVerticalFrames: rows.filter((r) => r.what === 'bump' && r.oldFy !== 0).length, newTiltedFrames: rows.filter((r) => r.what === 'bump' && r.fy !== 0).length },
  shaft: { newPointsUp: rows.filter((r) => r.what === 'shaft').some((r) => r.fy <= -0.9 && Math.abs(r.fx) < 0.1) },
  colony,
};
fs.writeFileSync(path.join(out, 'trace.json'), JSON.stringify({ summary, frames: rows }, null, 1) + '\n');

// the strip: every other frame from the bump to the shaft, old above new, three cells an ant, 10 px a cell
const C = 10, pick = rows.filter((r, i) => i % 2 === 0 && r.what !== 'flat' && r.what !== 'standing').slice(0, 72);
const ant = (x: number, y: number, fx: number, fy: number, ox: number, oy: number) =>
  [[-1, '#683124'], [0, '#9e4c36'], [1, '#7a3a2a']].map(([k, c]) =>
    `<rect x="${(x + (k as number) * fx - ox) * C}" y="${(y + (k as number) * fy - oy) * C}" width="${C}" height="${C}" fill="${c}"/>`).join('');
const cell = (r: Row, old: boolean) => {
  const ox = r.x - 3, oy = r.y - 3;
  const body = old ? ant(r.x, r.y, r.oldFx, r.oldFy, ox, oy) : ant(r.drawX, r.drawY, r.fx, r.fy, ox, oy);
  return `<svg width="${7 * C}" height="${7 * C}" viewBox="0 0 ${7 * C} ${7 * C}"><rect width="100%" height="100%" fill="#1d1a17"/>${body}</svg>`;
};
const strip = (title: string, old: boolean) => `<h2>${title}</h2><div class="row">${pick.map((r) => `<figure>${cell(r, old)}<figcaption>${r.t} ms<br>${r.what}</figcaption></figure>`).join('')}</div>`;
fs.writeFileSync(path.join(out, 'frames.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Ant facing</title>
<style>body{background:#f4f1ea;color:#2a2622;font:13px system-ui;margin:16px}h1{font-size:18px}h2{font-size:14px;margin:12px 0 4px}
.row{display:flex;flex-wrap:wrap;gap:4px}figure{margin:0;text-align:center}figcaption{font-size:9px;color:#6b645c}</style></head><body>
<h1>One ant, every other frame at 120 Hz: over a bump, turning around, up a shaft (camera follows the ant's cell)</h1>
${strip('Before: drawn on its cell, facing its last single step', true)}
${strip('After: gliding between cells, facing eased from its movement', false)}
</body></html>
`);
console.log(JSON.stringify(summary, (k, v) => (k === 'fxOverTime' ? v.join(' ') : v), 1));
