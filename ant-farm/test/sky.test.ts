// The sky is a thin strip above the ground: a new farm, crumbs dropping in, a mound growing into it, and saves from the
// days of the tall sky (crumbs dropped in at row 2) loading with nothing lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, readSave, type Counts, type Sim } from '../src/sim/sim';
import { AIR, CRUMB, DIRT, SKY_MARGIN, SKY_ROWS } from '../src/sim/world';

const tokens = (n: number) => ({ v: 1 as const, source: 'test', type: 'tokens' as const, input: n, output: 0, cache_read: 0, cache_write: 0, ts: 0 });
const food = (c: Counts) => c.food + c.crumb + c.carriedFood;
const highest = (sim: Sim) => { let m = sim.H; for (let x = 0; x < sim.W; x++) m = Math.min(m, sim.surf[x]); return m; };
const reload = (sim: Sim, edit: (raw: any) => void = () => {}) => {
  const raw = JSON.parse(JSON.stringify(sim.save()));
  edit(raw);
  return createSim({ seed: sim.seed, restore: readSave(raw, sim.seed, sim.W, sim.H), now: sim.now });
};

test('a new farm keeps a few rows of sky above its highest ground', () => {
  for (const size of ['classic', 'large'] as const) {
    const sim = createSim({ seed: 4, size });
    assert.equal(sim.top, Math.max(1, highest(sim) - SKY_ROWS));
    assert.ok(sim.top > 2, size + ': the old tall sky is gone (top ' + sim.top + ')');
    const ib = sim.interestBox();
    assert.ok(ib.y >= sim.top, 'the camera is never asked to look above the cut');
  }
});

test('crumbs drop in just below the cut, and the colony box stays below it', () => {
  const sim = createSim({ seed: 6 });
  sim.feed(tokens(40_000));
  let seen = 0;
  for (let i = 0; i < 400; i++) {
    sim.step();
    for (let x = 1; x < sim.W - 1; x++) for (let y = 1; y <= sim.top; y++) if (sim.typeAt(sim.idx(x, y)) === CRUMB) seen++;
  }
  assert.ok(sim.stats.crumbsSpawned > 0, 'crumbs fell');
  assert.equal(seen, 0, 'no crumb is ever above the cut');
  assert.ok(sim.box.y0 >= sim.top, 'box top ' + sim.box.y0 + ' below the cut ' + sim.top);
});

test('a mound growing toward the cut opens the sky above it', () => {
  const sim = createSim({ seed: 7 }), x = sim.ex + 20, top0 = sim.top;
  for (let y = sim.surf[x] - 1; y >= top0 + 1; y--) sim.setCell(sim.idx(x, y), DIRT);
  assert.equal(sim.top, Math.max(1, top0 + 1 - SKY_MARGIN), 'the cut moves up to stay clear of the mound');
});

test('a save from the tall-sky days loads whole: mounds, ants and falling crumbs kept, the sky cut above them', () => {
  const sim = createSim({ seed: 8 });
  sim.feed(tokens(20_000));
  sim.run(600);
  // what the old game could leave behind: a crumb still falling near the very top, a tall mound, an ant on top of it
  const x = sim.ex + 24, peak = sim.surf[x] - 30;
  for (let y = sim.surf[x] - 1; y >= peak; y--) sim.setCell(sim.idx(x, y), DIRT);
  const fx = sim.ex - 30;
  const before = sim.count({ x0: 1, y0: 1, x1: sim.W - 2, y1: sim.H - 2 });
  const back = reload(sim, (raw) => {
    raw.box.y0 = 2; // old saves: the box reached the drop row
    const ant = raw.ants.find((a: { role: string }) => a.role === 'worker');
    ant.x = x; ant.y = peak - 1;
    raw.crumbQueue = 0;
  });
  // the falling crumb: written straight into the old sky, as the old game did
  back.setCell(back.idx(fx, 2), CRUMB);
  const raw2 = JSON.parse(JSON.stringify(back.save()));
  raw2.box.y0 = 2;
  const again = createSim({ seed: sim.seed, restore: readSave(raw2, sim.seed, sim.W, sim.H), now: sim.now });

  assert.ok(back.top <= peak - 1 - SKY_MARGIN, 'the ant on the mound is in sight (top ' + back.top + ', ant ' + (peak - 1) + ')');
  assert.ok(again.top <= peak - 1 - SKY_MARGIN);
  for (let y = peak; y < sim.surf[x]; y++) assert.equal(again.typeAt(again.idx(x, y)), DIRT, 'the mound is all there');
  assert.ok(again.ants.some((a) => a.x === x && a.y === peak - 1), 'the ant is still on its mound');
  assert.equal(again.typeAt(again.idx(fx, 2)), again.top >= 2 ? AIR : CRUMB, 'the crumb left the cut-off sky');
  const after = again.count({ x0: 1, y0: 1, x1: sim.W - 2, y1: sim.H - 2 });
  assert.equal(food(after) + Math.floor(again.crumbQueue), food(before) + 1, 'no food lost: the crumb fell in again or waits to');
  assert.equal(after.dirt + after.loose + after.rock, before.dirt + before.loose + before.rock, 'no soil lost');
  assert.ok(again.box.y0 >= again.top);
  assert.equal(again.ants.length, sim.ants.length);
  again.run(300); // and it plays on
  assert.ok(again.ants.length > 0);
});
