'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../sim.js');
const C = require('../camera.js');

const soil = (c) => c.dirt + c.loose + c.rock + c.carriedGrain;
const food = (c) => c.food + c.crumb + c.carriedFood;

// An empty world (no colony) with flat soil from row `top` down, for physics tests.
function lab(opts) {
  const sim = S.createSim(Object.assign({ seed: 1, W: 80, H: 60, colony: false, food: 0, rocks: 0, pockets: 0 }, opts));
  for (let y = 1; y < sim.H - 1; y++) for (let x = 1; x < sim.W - 1; x++) sim.setCell(sim.idx(x, y), y >= 20 ? S.DIRT : S.AIR);
  return sim;
}

test('same seed builds and plays the same farm; different seeds differ', () => {
  const a = S.createSim({ seed: 9 }), b = S.createSim({ seed: 9 }), c = S.createSim({ seed: 10 });
  assert.strictEqual(a.hash(), b.hash());
  assert.notStrictEqual(a.hash(), c.hash());
  a.run(800); b.run(800);
  assert.strictEqual(a.hash(), b.hash());
});

test('the map is seeded with soil layers, rock and food pockets', () => {
  const sim = S.createSim({ seed: 4 });
  const c = sim.count();
  assert.ok(c.dirt > 20000 && c.rock > 50 && c.food > 50, JSON.stringify(c));
  assert.ok(sim.pockets.length >= 4);
});

test('dug soil and food are never created or destroyed', () => {
  const sim = S.createSim({ seed: 5 });
  const c0 = sim.count();
  for (let i = 0; i < 8; i++) {
    sim.run(500);
    const c = sim.count();
    assert.strictEqual(soil(c), soil(c0), 'soil at tick ' + sim.tick);
    // food only leaves the world by being eaten, and only arrives as crumbs from tokens
    assert.strictEqual(food(c) + sim.stats.eaten, food(c0) + (sim.stats.crumbsSpawned - 4), 'food at tick ' + sim.tick);
  }
  assert.ok(sim.stats.dug > 50);
});

test('ants move at most one cell per tick and stand in open air', () => {
  const sim = S.createSim({ seed: 6 });
  let prev = new Map(sim.ants.map((a) => [a.id, [a.x, a.y]]));
  for (let t = 0; t < 2500; t++) {
    sim.step();
    for (const a of sim.ants) {
      const p = prev.get(a.id);
      if (p) assert.ok(Math.max(Math.abs(a.x - p[0]), Math.abs(a.y - p[1])) <= 1, 'ant ' + a.id + ' jumped at tick ' + sim.tick);
    }
    prev = new Map(sim.ants.map((a) => [a.id, [a.x, a.y]]));
  }
  const inSoil = sim.ants.filter((a) => sim.type[sim.idx(a.x, a.y)] !== S.AIR).length;
  assert.ok(inSoil <= 1, inSoil + ' ants inside soil');
});

test('loose grains fall and pile into a slope', () => {
  const sim = lab();
  for (let y = 5; y < 15; y++) sim.setCell(sim.idx(40, y), S.LOOSE);
  sim.run(200);
  const heights = [];
  for (let x = 34; x <= 46; x++) { let h = 0; for (let y = 19; y > 0 && sim.type[sim.idx(x, y)] === S.LOOSE; y--) h++; heights.push(h); }
  assert.strictEqual(heights.reduce((s, h) => s + h, 0), 10, 'all grains landed: ' + heights);
  assert.ok(Math.max(...heights) <= 4, 'spread out, not a column: ' + heights);
  for (let i = 1; i < heights.length; i++) assert.ok(Math.abs(heights[i] - heights[i - 1]) <= 2, 'slope: ' + heights);
});

function cavity(width, span) {
  const sim = lab({ span });
  for (let y = 30; y < 34; y++) for (let x = 20; x < 20 + width; x++) sim.setCell(sim.idx(x, y), S.AIR);
  return sim;
}

test('a ceiling wider than the soil can span cracks and falls in', () => {
  const sim = cavity(24, 12);
  sim.run(120);
  assert.ok(sim.stats.collapses >= 1, 'collapsed');
  let loose = 0; for (let x = 20; x < 44; x++) if (sim.type[sim.idx(x, 33)] === S.LOOSE) loose++;
  assert.ok(loose > 0, 'rubble on the floor');
  assert.strictEqual(soil(sim.count()), soil(cavity(24, 12).count()), 'collapse conserves soil');
});

test('a ceiling within its span holds', () => {
  const sim = cavity(8, 12);
  sim.run(300);
  assert.strictEqual(sim.stats.collapses, 0);
});

test('soil cut off from the frame falls as loose grains', () => {
  const sim = lab();
  for (let y = 20; y < 59; y++) for (let x = 1; x < 79; x++) sim.setCell(sim.idx(x, y), S.AIR);
  for (let y = 10; y < 13; y++) for (let x = 30; x < 33; x++) sim.setCell(sim.idx(x, y), S.DIRT);
  sim.run(200);
  let floating = 0; for (let y = 10; y < 13; y++) for (let x = 30; x < 33; x++) if (sim.type[sim.idx(x, y)] !== S.AIR) floating++;
  assert.strictEqual(floating, 0);
});

test('tokens become digging energy and food crumbs; cache reads count a tenth', () => {
  const sim = S.createSim({ seed: 2 });
  const e0 = sim.energy, c0 = sim.stats.crumbsSpawned;
  sim.feed({ v: 1, type: 'tokens', input: 3000, output: 2000 });
  assert.ok(Math.abs(sim.energy - e0 - 5000 / S.TOKENS_PER_ENERGY) < 1e-6);
  sim.run(400);
  assert.ok(sim.stats.crumbsSpawned - c0 >= Math.floor(5000 / S.TOKENS_PER_CRUMB) - 1);
  const s2 = S.createSim({ seed: 2 });
  s2.feed({ type: 'tokens', cache_read: 10000 });
  assert.strictEqual(s2.stats.tokens, 1000);
  s2.feed({ type: 'task_done' });
  assert.strictEqual(s2.galleryQueue.length, 1);
});

test('the colony digs a royal chamber, lays eggs and raises workers', () => {
  const sim = S.createSim({ seed: 3 });
  const n0 = sim.ants.length;
  sim.run(15000);
  assert.ok(sim.royal && sim.royal.done, 'royal chamber dug');
  assert.ok(sim.stats.laid > 0 && sim.stats.born > 0, JSON.stringify(sim.stats));
  assert.ok(sim.ants.length > n0);
});

test('camera fit centres the box and snaps big scales to whole numbers', () => {
  const cam = C.fit({ x: 10, y: 20, w: 100, h: 50 }, 640, 400, { pad: 0 });
  assert.strictEqual(cam.s, 6);
  assert.ok(Math.abs(cam.x + 640 / cam.s / 2 - 60) < 1e-9 && Math.abs(cam.y + 400 / cam.s / 2 - 45) < 1e-9);
  assert.ok(C.fit({ x: 0, y: 0, w: 400, h: 260 }, 300, 200, { pad: 0 }).s < 1);
});

test('camera zoom keeps the point under the cursor', () => {
  const cam = { x: 5, y: 7, s: 2 };
  const z = C.zoomAt(cam, 100, 60, 1.5);
  assert.ok(Math.abs(cam.x + 100 / cam.s - (z.x + 100 / z.s)) < 1e-9);
  assert.ok(Math.abs(cam.y + 60 / cam.s - (z.y + 60 / z.s)) < 1e-9);
  assert.strictEqual(C.zoomAt(cam, 0, 0, 1000, { max: 24 }).s, 24);
});

test('camera clamp and ease', () => {
  const c = C.clamp({ x: -1000, y: 5000, s: 2 }, 400, 260, 600, 400, 40);
  assert.ok(c.x + 600 / 2 >= 20 && c.y <= 260 - 20);
  const a = { x: 0, y: 0, s: 1 }, b = { x: 100, y: 50, s: 4 };
  let m = a; for (let i = 0; i < 200; i++) m = C.lerp(m, b, 0.1, 400, 300);
  assert.ok(C.near(m, b));
  assert.ok(Math.abs(C.lerp(a, b, 0.5, 400, 300).s - 2) < 1e-9, 'scale eases in log space');
});
