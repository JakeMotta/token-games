// The score of a run, game over, and the local record of runs (best, last, history).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, readSave, type Sim } from '../src/sim/sim';
import { RULES, RUNS_KEPT, compare, emptyRuns, readRuns, recordRun, score, scoreInput, type Run, type ScoreInput } from '../src/sim/score';
import { DYING_TICKS } from '../src/sim/world';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const zero: ScoreInput = { born: 0, dug: 0, deepest: 0, collected: 0, tokens: 0, oldestMs: 0, aliveMs: 0, rooms: 0, tunnels: 0 };
const tokens = (n: number, ts = 0) => ({ v: 1 as const, source: 'test', type: 'tokens' as const, input: n, output: 0, cache_read: 0, cache_write: 0, ts });

test('the formula: each part is whole units times its points, and the total is their sum', () => {
  assert.equal(score(zero).total, 0);
  const s = score({ born: 3, dug: 250, deepest: 40, collected: 17, tokens: 12_345, oldestMs: 30 * HOUR, aliveMs: 2.5 * DAY, rooms: 4, tunnels: 2 });
  const by = Object.fromEntries(s.parts.map((p) => [p.key, p]));
  assert.equal(by.born.points, 30);
  assert.equal(by.dug.points, 250);
  assert.equal(by.deepest.points, 200);
  assert.equal(by.collected.points, 34);
  assert.equal(by.tokens.count, 12); assert.equal(by.tokens.points, 12);
  assert.equal(by.oldestMs.count, 30); assert.equal(by.oldestMs.points, 600);
  assert.equal(by.aliveMs.count, 2); assert.equal(by.aliveMs.points, 200);
  assert.equal(by.rooms.points, 400);
  assert.equal(by.tunnels.points, 50);
  assert.equal(s.total, 30 + 250 + 200 + 34 + 12 + 600 + 200 + 400 + 50);
  assert.equal(s.parts.length, RULES.length, 'every rule is shown in the breakdown');
});

test('the score only grows while the colony works, and never from nothing', () => {
  const t = { now: 1_700_000_000_000 };
  const sim = createSim({ seed: 3, now: () => t.now });
  const s0 = score(scoreInput(sim)).total;
  sim.feed(tokens(40_000, t.now));
  sim.run(4000);
  const s1 = score(scoreInput(sim)).total;
  assert.ok(s1 > s0, s0 + ' → ' + s1);
  const i = scoreInput(sim);
  assert.ok(i.dug > 0 && i.deepest > 5 && i.tokens === 40_000 && i.rooms >= 1, JSON.stringify(i));
  assert.ok(i.collected > 0, 'food was gathered');
  // a farm with no colony scores nothing however long it sits there
  assert.equal(score(scoreInput(createSim({ seed: 3, colony: false }))).total, 0);
});

// every life ends within the hour (an heir to the queen too)
function endAll(sim: Sim, clock: { t: number }) {
  for (let i = 0; i < 4 && sim.ants.some((a) => a.dying === undefined); i++) {
    for (const a of sim.ants) if (a.dying === undefined) a.dies = clock.t + 60_000;
    clock.t += HOUR; sim.step();
  }
}
function deadFarm() {
  const clock = { t: 1_700_000_000_000 };
  const sim = createSim({ seed: 3, now: () => clock.t });
  sim.feed(tokens(20_000, clock.t));
  sim.run(500);
  sim.brood.length = 0;
  endAll(sim, clock);
  sim.run(DYING_TICKS + 1);
  return { sim, clock };
}

test('game over: when the last ant dies the run ends, and tokens no longer revive it', () => {
  const { sim, clock } = deadFarm();
  assert.ok(sim.over(), 'the run is over');
  assert.equal(sim.ants.length, 0);
  assert.ok(sim.events.some((e) => e.type === 'over'));
  const final = score(scoreInput(sim)).total;
  assert.ok(final > 0);
  sim.feed(tokens(500_000, clock.t));
  sim.run(400);
  assert.equal(sim.ants.length, 0, 'no new queen: the player starts a new farm');
  assert.equal(score(scoreInput(sim)).total, final, 'the final score stays put');
  clock.t += 5 * DAY; sim.step();
  assert.equal(score(scoreInput(sim)).total, final, 'and does not count days after the end');
});

test('game over survives a restart of the app, and an egg left to hatch keeps the run going', () => {
  const { sim } = deadFarm();
  const back = createSim({ seed: sim.seed, restore: readSave(JSON.parse(JSON.stringify(sim.save())), sim.seed, sim.W, sim.H), now: () => sim.life.over + DAY });
  assert.ok(back.over());
  assert.equal(score(scoreInput(back)).total, score(scoreInput(sim)).total);

  const clock = { t: 1_700_000_000_000 };
  const s2 = createSim({ seed: 4, now: () => clock.t });
  s2.brood.push({ id: 999, x: s2.nest.x, y: s2.nest.y, age: 0, stage: 0, inRoom: false, nurse: 0, carried: false });
  endAll(s2, clock);
  assert.equal(s2.ants.filter((a) => a.dying === undefined).length, 0);
  assert.ok(!s2.over(), 'an egg may still hatch');
});

test('an old save without a run start dates the run from its queen', () => {
  const clock = { t: 1_700_000_000_000 };
  const sim = createSim({ seed: 5, now: () => clock.t });
  const raw = JSON.parse(JSON.stringify(sim.save()));
  delete raw.life.started; delete raw.life.over;
  delete raw.stats.collected; delete raw.stats.deepest; delete raw.stats.oldestMs;
  clock.t += 10 * HOUR;
  const back = createSim({ seed: 5, restore: readSave(raw, 5, sim.W, sim.H), now: () => clock.t });
  assert.equal(back.life.started, sim.ants.find((a) => a.role === 'queen')!.born);
  assert.ok(!back.over());
  assert.ok(Number.isFinite(score(scoreInput(back)).total));
});

const run = (score: number, n: number): Run => ({ score, started: n * 1000, ended: n * 1000 + 500, seed: n });

test('runs: the best and the last are kept, each run once, newest first', () => {
  let r = emptyRuns();
  r = recordRun(r, run(300, 1));
  r = recordRun(r, run(900, 2));
  r = recordRun(r, run(500, 3));
  r = recordRun(r, run(500, 3)); // the same run again (the app reopened on its game over screen)
  assert.equal(r.list.length, 3);
  assert.deepEqual(r.list.map((x) => x.score), [500, 900, 300]);
  assert.equal(r.best!.score, 900);
  const c = compare(r, run(500, 3));
  assert.equal(c.best, 900); assert.equal(c.isBest, false);
  assert.equal(c.last!.score, 900); assert.equal(c.vsLast, -400); assert.equal(c.vsBest, -400);
  const top = compare(r, run(1200, 4));
  assert.ok(top.isBest); assert.equal(top.best, 1200); assert.equal(top.vsBest, 300); assert.equal(top.last!.score, 500);
  const first = compare(emptyRuns(), run(10, 1));
  assert.ok(first.isBest); assert.equal(first.last, null); assert.equal(first.vsLast, null);
});

test('runs: the list is capped but the best is never forgotten, and a broken file reads as empty', () => {
  let r = recordRun(emptyRuns(), run(5000, 0));
  for (let i = 1; i <= RUNS_KEPT + 5; i++) r = recordRun(r, run(i, i));
  assert.equal(r.list.length, RUNS_KEPT);
  assert.equal(r.best!.score, 5000);
  const back = readRuns(JSON.parse(JSON.stringify(r)));
  assert.deepEqual(back, r);
  assert.deepEqual(readRuns(null), emptyRuns());
  assert.deepEqual(readRuns({ list: 'nope' }), emptyRuns());
  assert.equal(readRuns({ list: [run(7, 1), { score: 'x' }] }).list.length, 1);
});
