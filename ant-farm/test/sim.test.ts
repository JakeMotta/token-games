// The simulation, headless: determinism, conservation, physics, collapse rules and the colony.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, type Counts, type SimOptions } from '../src/sim/sim';
import { AIR, DIRT, LOOSE } from '../src/sim/world';
import { TOKENS_PER_CRUMB, TOKENS_PER_ENERGY } from '../src/sim/tokens';

const soil = (c: Counts) => c.dirt + c.loose + c.rock + c.carriedGrain;
const food = (c: Counts) => c.food + c.crumb + c.carriedFood;
const tokens = (input: number, output: number, cache_read = 0) => ({ v: 1 as const, source: 'test', type: 'tokens' as const, input, output, cache_read, cache_write: 0, ts: 1_000_000 });

// An empty world (no colony) with flat soil from row 20 down, for physics tests.
function lab(opts: SimOptions = {}) {
  const sim = createSim({ seed: 1, W: 80, H: 60, colony: false, food: false, rocks: false, ...opts });
  for (let y = 1; y < sim.H - 1; y++) for (let x = 1; x < sim.W - 1; x++) sim.setCell(sim.idx(x, y), y >= 20 ? DIRT : AIR);
  return sim;
}

test('same seed builds and plays the same farm; different seeds differ', () => {
  const a = createSim({ seed: 9 }), b = createSim({ seed: 9 }), c = createSim({ seed: 10 });
  assert.equal(a.hash(), b.hash());
  assert.notEqual(a.hash(), c.hash());
  a.run(800); b.run(800);
  assert.equal(a.hash(), b.hash());
});

test('the same token events at the same ticks replay the same farm', () => {
  const play = () => {
    const sim = createSim({ seed: 21 });
    sim.run(300); sim.feed(tokens(3000, 2000));
    sim.run(300); sim.feed({ v: 1, source: 'test', type: 'task_done', ts: 1_000_500 });
    sim.run(600);
    return sim;
  };
  const a = play(), b = play();
  assert.equal(a.hash(), b.hash());
  assert.notEqual(a.hash(), (() => { const s = createSim({ seed: 21 }); s.run(1200); return s.hash(); })(), 'events change the farm');
});

test('the map is seeded with soil layers, rock and food pockets', () => {
  const sim = createSim({ seed: 4 });
  const c = sim.count();
  assert.ok(c.dirt > 20000 && c.rock > 50 && c.food > 50, JSON.stringify(c));
  const pockets = sim.pocketsIn({ x0: 0, y0: 0, x1: sim.W - 1, y1: sim.H - 1 });
  assert.ok(pockets.length >= 4, 'pockets: ' + pockets.length);
});

test('dug soil and food are never created or destroyed', () => {
  const sim = createSim({ seed: 5 });
  const c0 = sim.count();
  for (let i = 0; i < 8; i++) {
    sim.run(500);
    const c = sim.count();
    assert.equal(soil(c), soil(c0), 'soil at tick ' + sim.tick);
    // food only leaves the world by being eaten, and only arrives as crumbs from tokens
    assert.equal(food(c) + sim.stats.eaten, food(c0) + (sim.stats.crumbsSpawned - 4), 'food at tick ' + sim.tick);
  }
  assert.ok(sim.stats.dug > 50);
});

test('ants move at most one cell per tick and stand in open air', () => {
  const sim = createSim({ seed: 6 });
  let prev = new Map(sim.ants.map((a) => [a.id, [a.x, a.y]]));
  for (let t = 0; t < 2500; t++) {
    sim.step();
    for (const a of sim.ants) {
      const p = prev.get(a.id);
      if (p) assert.ok(Math.max(Math.abs(a.x - p[0]), Math.abs(a.y - p[1])) <= 1, 'ant ' + a.id + ' jumped at tick ' + sim.tick);
    }
    prev = new Map(sim.ants.map((a) => [a.id, [a.x, a.y]]));
  }
  const inSoil = sim.ants.filter((a) => sim.typeAt(sim.idx(a.x, a.y)) !== AIR).length;
  assert.ok(inSoil <= 1, inSoil + ' ants inside soil');
});

test('loose grains fall and pile into a slope', () => {
  const sim = lab();
  for (let y = 5; y < 15; y++) sim.setCell(sim.idx(40, y), LOOSE);
  sim.run(200);
  const heights: number[] = [];
  for (let x = 34; x <= 46; x++) { let h = 0; for (let y = 19; y > 0 && sim.typeAt(sim.idx(x, y)) === LOOSE; y--) h++; heights.push(h); }
  assert.equal(heights.reduce((s, h) => s + h, 0), 10, 'all grains landed: ' + heights);
  assert.ok(Math.max(...heights) <= 4, 'spread out, not a column: ' + heights);
  for (let i = 1; i < heights.length; i++) assert.ok(Math.abs(heights[i] - heights[i - 1]) <= 2, 'slope: ' + heights);
});

function cavity(width: number, span: number) {
  const sim = lab({ span });
  for (let y = 30; y < 34; y++) for (let x = 20; x < 20 + width; x++) sim.setCell(sim.idx(x, y), AIR);
  return sim;
}

test('collapse: a ceiling wider than the soil can span cracks and falls in', () => {
  const sim = cavity(24, 12);
  sim.run(120);
  assert.ok(sim.stats.collapses >= 1, 'collapsed');
  assert.ok(sim.events.some((e) => e.type === 'collapse'), 'reported as an event');
  let loose = 0; for (let x = 20; x < 44; x++) if (sim.typeAt(sim.idx(x, 33)) === LOOSE) loose++;
  assert.ok(loose > 0, 'rubble on the floor');
  assert.equal(soil(sim.count()), soil(cavity(24, 12).count()), 'collapse conserves soil');
});

test('collapse: a ceiling within its span holds', () => {
  const sim = cavity(8, 12);
  sim.run(300);
  assert.equal(sim.stats.collapses, 0);
});

test('collapse: soil cut off from the frame falls as loose grains', () => {
  const sim = lab();
  for (let y = 20; y < 59; y++) for (let x = 1; x < 79; x++) sim.setCell(sim.idx(x, y), AIR);
  for (let y = 10; y < 13; y++) for (let x = 30; x < 33; x++) sim.setCell(sim.idx(x, y), DIRT);
  sim.run(200);
  let floating = 0; for (let y = 10; y < 13; y++) for (let x = 30; x < 33; x++) if (sim.typeAt(sim.idx(x, y)) !== AIR) floating++;
  assert.equal(floating, 0);
});

test('tokens become digging energy and food crumbs; cache reads count a tenth', () => {
  const sim = createSim({ seed: 2 });
  const e0 = sim.energy, c0 = sim.stats.crumbsSpawned;
  sim.feed(tokens(3000, 2000));
  assert.ok(Math.abs(sim.energy - e0 - 5000 / TOKENS_PER_ENERGY) < 1e-6);
  sim.run(400);
  assert.ok(sim.stats.crumbsSpawned - c0 >= Math.floor(5000 / TOKENS_PER_CRUMB) - 1);
  const s2 = createSim({ seed: 2 });
  s2.feed(tokens(0, 0, 10000));
  assert.equal(s2.stats.tokens, 1000);
  s2.feed({ v: 1, source: 'test', type: 'task_done', ts: 0 });
  assert.equal(s2.galleryQueue.length, 1);
});

test('a finished task makes the colony start digging a gallery', () => {
  const sim = createSim({ seed: 11 });
  sim.run(4000);
  assert.ok(sim.royal && sim.royal.done, 'galleries wait for the royal chamber');
  sim.feed({ v: 1, source: 'test', type: 'task_done', ts: 0, width: 30 });
  assert.equal(sim.galleryQueue.at(-1)!.w, 30, 'a wide room asks for a 30-cell gallery');
  sim.feed({ v: 1, source: 'test', type: 'task_done', ts: 0 });
  assert.equal(sim.galleryQueue.length, 2);
  sim.run(200);
  assert.equal(sim.galleryQueue.length, 1, 'one gallery at a time is being dug');
});

test('the colony digs a royal chamber, lays eggs and raises workers', () => {
  const sim = createSim({ seed: 3 });
  const n0 = sim.ants.length;
  sim.run(15000);
  assert.ok(sim.royal && sim.royal.done, 'royal chamber dug');
  assert.ok(sim.stats.laid > 0 && sim.stats.born > 0, JSON.stringify(sim.stats));
  assert.ok(sim.ants.length > n0);
});
