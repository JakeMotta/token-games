// The colony's life by the wall clock, with a fake clock: old age, a new queen, food-bound breeding, slow starvation
// with a long grace, recovery when tokens flow again, game over when the last ant dies, and a farm that ages while the
// app is closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, readSave, type Counts, type Sim } from '../src/sim/sim';
import { ANT_LIFESPAN_MS, LIFESPAN_JITTER, QUEEN_LIFESPAN_MS, DYING_TICKS, MIN_SURVIVORS, STARVE_DEATH_MS, STARVE_GRACE_MS } from '../src/sim/world';

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const tokens = (n: number, ts = 0) => ({ v: 1 as const, source: 'test', type: 'tokens' as const, input: n, output: 0, cache_read: 0, cache_write: 0, ts });

// A farm on a clock the test moves. `fed` keeps food "on its way", so nobody starves (the test of old age only).
function farm(seed = 3) {
  const clock = { t: 1_700_000_000_000 };
  const sim = createSim({ seed, now: () => clock.t });
  return { sim, clock };
}
function pass(f: { sim: Sim; clock: { t: number } }, ms: number, step = 10 * MIN, fed = false) {
  for (let left = ms; left > 0; left -= step) {
    f.clock.t += Math.min(step, left);
    if (fed) f.sim.life.lastTokens = f.clock.t;
    f.sim.step();
  }
}
const alive = (sim: Sim) => sim.ants.filter((a) => !a.dying);
const workers = (sim: Sim) => alive(sim).filter((a) => a.role === 'worker');
const queenOf = (sim: Sim) => alive(sim).find((a) => a.role === 'queen');

test('ants live about 48 real hours, the queen about 14 days', () => {
  const { sim } = farm();
  for (const a of sim.ants) {
    const span = a.dies - a.born, L = a.role === 'queen' ? QUEEN_LIFESPAN_MS : ANT_LIFESPAN_MS;
    assert.ok(span >= L * (1 - LIFESPAN_JITTER) - 1 && span <= L * (1 + LIFESPAN_JITTER) + 1, a.role + ' lives ' + span / HOUR + ' h');
  }
  assert.ok(workers(sim).some((a) => a.born < sim.now() - HOUR), 'a founding colony has ants of mixed ages');
});

test('old ants die calmly of age and fade out; the queen outlives them', () => {
  const f = farm(), { sim } = f;
  const first = workers(sim).map((a) => a.id), q = queenOf(sim)!.id;
  pass(f, 60 * HOUR, 10 * MIN, true);
  assert.ok(!alive(sim).some((a) => first.includes(a.id)), 'every founding worker has died of age');
  assert.equal(sim.stats.starved, 0, 'nobody starved while fed');
  assert.ok(sim.stats.died >= first.length);
  assert.ok(sim.events.some((e) => e.type === 'died' && e.cause === 'age'), 'deaths are reported, quietly');
  assert.equal(queenOf(sim)?.id, q, 'the queen is still alive');
  // a dying ant fades over DYING_TICKS and is then gone, leaving whatever it carried in the world
  const dying = sim.ants.filter((a) => a.dying !== undefined);
  sim.run(DYING_TICKS + 1);
  for (const a of dying) assert.ok(!sim.ants.includes(a), 'faded out');
});

test('when the queen dies of age the youngest worker takes over', () => {
  const f = farm(), { sim } = f;
  const q = queenOf(sim)!, youngest = workers(sim).sort((a, b) => b.born - a.born)[0];
  q.dies = f.clock.t + MIN;
  pass(f, 10 * MIN, 10 * MIN, true);
  assert.equal(queenOf(sim)?.id, youngest.id);
  assert.ok(sim.events.some((e) => e.type === 'died' && e.queen) && sim.events.some((e) => e.type === 'queen'));
  assert.ok(youngest.dies - f.clock.t > QUEEN_LIFESPAN_MS * (1 - LIFESPAN_JITTER) - 1, 'the new queen gets a queen\'s life');
});

test('brood is laid only from stored food, and stops ageing while the colony starves', () => {
  // no tokens at all: the queen has only the founding crumbs, two per egg
  const a = createSim({ seed: 3 });
  a.run(15000);
  assert.ok(a.stats.laid * 2 <= a.stats.crumbsSpawned, JSON.stringify(a.stats));
  assert.ok(a.ants.length <= a.cap(), 'the population stays within what the rooms hold');

  const f = farm(), { sim } = f;
  sim.brood.push({ id: 999, x: sim.nest.x, y: sim.nest.y, age: 10, stage: 0, inRoom: true, nurse: 0, carried: false });
  sim.life.starvingSince = f.clock.t;
  sim.life.hunger = 3;
  sim.run(100);
  assert.equal(sim.brood.find((b) => b.id === 999)!.age, 10, 'a starving colony\'s brood waits');
});

test('without tokens the colony starves slowly, keeps its last few for the grace period, then empties', () => {
  const f = farm(), { sim } = f;
  for (const a of sim.ants) a.dies = Infinity; // starvation only
  const n0 = workers(sim).length;
  pass(f, HOUR);
  assert.equal(sim.stats.starved, 0, 'nobody dies within the first hour');
  pass(f, 24 * HOUR);
  const h = sim.health();
  assert.equal(h.mood, 'starving');
  assert.equal(h.food, 0, 'the store is used up');
  assert.equal(workers(sim).length, MIN_SURVIVORS, 'the last few hold out');
  assert.ok(queenOf(sim), 'and the queen');
  assert.ok(sim.stats.starved === n0 - MIN_SURVIVORS);
  // the deaths are spread out: at most one every STARVE_DEATH_MS
  assert.ok((n0 - MIN_SURVIVORS) * STARVE_DEATH_MS <= 25 * HOUR);
  pass(f, STARVE_GRACE_MS - 2 * DAY, HOUR);
  assert.equal(workers(sim).length, MIN_SURVIVORS, 'a weekend off does not wipe the farm');
  pass(f, 3 * DAY, HOUR);
  assert.equal(sim.health().mood, 'empty', 'after the grace, the farm empties');
});

test('tokens bring a starving colony back; an empty farm is game over', () => {
  const f = farm(), { sim } = f;
  for (const a of sim.ants) a.dies = Infinity;
  pass(f, 24 * HOUR);
  const starved = sim.stats.starved;
  assert.equal(sim.health().mood, 'starving');
  // tokens: food is on its way, so nobody else starves while the ants fetch it
  sim.feed(tokens(60_000, f.clock.t));
  pass(f, 30 * MIN, MIN);
  assert.equal(sim.stats.starved, starved, 'no deaths while food comes');
  for (let i = 0; i < 40 && sim.life.starvingSince; i++) { f.clock.t += 5 * MIN; sim.life.lastTokens = f.clock.t; sim.run(200); }
  assert.equal(sim.life.starvingSince, 0, 'stored food ends the starving');
  assert.notEqual(sim.health().mood, 'starving');

  // an empty farm: the run is over, and tokens no longer bring a new queen (the player starts a new farm)
  const g = farm(), s2 = g.sim;
  for (const a of workers(s2)) a.dies = g.clock.t + MIN;
  pass(g, 10 * MIN, 10 * MIN, true);
  queenOf(s2)!.dies = g.clock.t + MIN; // with no worker left to take over
  pass(g, 10 * MIN, 10 * MIN, true);
  s2.run(DYING_TICKS + 1);
  assert.equal(s2.health().mood, 'empty');
  assert.ok(s2.over(), 'game over');
  s2.feed(tokens(5000, g.clock.t));
  assert.ok(!queenOf(s2) && workers(s2).length === 0, 'no new queen');
});

test('there is no idle regen: without tokens, energy and food never grow', () => {
  const f = farm(), { sim } = f;
  const crumbs = sim.stats.crumbsSpawned;
  let e = sim.energy;
  for (let i = 0; i < 40; i++) { pass(f, 5 * MIN, MIN); assert.ok(sim.energy <= e, 'energy only falls'); e = sim.energy; }
  assert.equal(sim.stats.crumbsSpawned, crumbs, 'no crumbs without tokens');
});

test('the saved colony comes back the same, and ages by the time the app was closed', () => {
  const f = farm(5), { sim } = f;
  sim.feed(tokens(30_000, f.clock.t));
  sim.run(1500);
  const raw = JSON.parse(JSON.stringify(sim.save()));
  const data = readSave(raw, sim.seed, sim.W, sim.H)!;
  assert.ok(data, 'the save reads back');
  assert.equal(readSave(raw, sim.seed + 1, sim.W, sim.H), null, 'another farm\'s save is refused');
  assert.equal(readSave({ v: 9 }, sim.seed, sim.W, sim.H), null);
  assert.ok(JSON.stringify(raw).length < 200_000, 'the save is compact: ' + JSON.stringify(raw).length + ' bytes');

  const back = createSim({ seed: sim.seed, restore: data, now: () => f.clock.t });
  assert.equal(back.hash(), sim.hash(), 'same map, ants and brood');
  assert.equal(back.tick, sim.tick);
  assert.equal(back.energy, sim.energy);
  // ants pick their jobs afresh after a restart; the farm plays on, losing no soil
  const soil = (c: Counts) => c.dirt + c.loose + c.rock + c.carriedGrain, s0 = soil(back.count());
  back.run(800);
  assert.equal(soil(back.count()), s0);
  assert.ok(alive(back).length >= alive(sim).length, 'nobody lost in the restart');

  // closed for three days: the clock jumps, and the ants that would have died by then have
  const later = { t: f.clock.t + 3 * DAY };
  const old = alive(sim).filter((a) => a.role === 'worker' && a.dies < later.t).map((a) => a.id);
  const reopened = createSim({ seed: sim.seed, restore: readSave(JSON.parse(JSON.stringify(sim.save())), sim.seed, sim.W, sim.H), now: () => later.t });
  reopened.step();
  assert.ok(old.length > 0);
  assert.ok(!alive(reopened).some((a) => old.includes(a.id)), 'those ants died while the app was closed');
});
