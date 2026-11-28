// The simulation: usage is the only thing that moves it, waves form from tokens, towers aim the way they're told,
// saves round-trip, and hours of play stay finite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TDGame, STEP, START_LIVES, type Enemy } from '../src/sim/game';
import { COLS, ROWS } from '../src/sim/map';
import { waveCost } from '../src/sim/enemies';
import type { TowerId } from '../src/sim/towers';

const tokens = (n: number) => ({ type: 'tokens', input: n, output: 0, cache_read: 0, cache_write: 0 });
const run = (g: TDGame, seconds: number) => { for (let i = 0; i < seconds / STEP; i++) g.step(); };
function spot(g: TDGame, type: TowerId, near?: [number, number]): [number, number] {
  let best: [number, number] | null = null, bd = Infinity;
  for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) if (g.grid.ok(type, cx, cy)) {
    const d = near ? (cx - near[0]) ** 2 + (cy - near[1]) ** 2 : 0;
    if (d < bd) { bd = d; best = [cx, cy]; if (!near) return best; }
  }
  if (!best) throw new Error('no room');
  return best;
}

test('nothing happens without usage: no tokens, no waves', () => {
  const g = new TDGame(1);
  run(g, 120);
  assert.equal(g.wave, 0);
  assert.equal(g.alive(), 0);
  assert.equal(g.gold, 160);
});

test('tokens fill the bucket and a full bucket sends a wave (auto)', () => {
  const g = new TDGame(1);
  g.feed(tokens(waveCost(1) - 1));
  run(g, 2);
  assert.equal(g.wave, 0, 'not quite enough');
  g.feed(tokens(1));
  assert.ok(g.ready());
  run(g, 2);
  assert.equal(g.wave, 1);
  assert.ok(g.alive() > 0, 'walkers come on');
  assert.equal(g.ink, 0);
});

test('with auto off the wave waits for Send', () => {
  const g = new TDGame(1);
  g.auto = false;
  g.feed(tokens(waveCost(1) * 3));
  run(g, 5);
  assert.equal(g.wave, 0);
  assert.equal(g.queued(), 2, 'the bucket holds two waves (the second costs more)');
  assert.ok(g.send());
  assert.equal(g.wave, 1);
});

test('a finished turn pays gold', () => {
  const g = new TDGame(1);
  const r = g.feed({ type: 'task_done' });
  assert.ok(r.gold > 0 && g.gold === 160 + r.gold);
  assert.equal(g.stats.turns, 1);
});

test('a quill by the road kills the first wave; unguarded walkers cost lives', () => {
  const g = new TDGame(1);
  const at = spot(g, 'quill', [6, 3]);
  assert.ok(g.build('quill', at[0], at[1]));
  assert.ok(g.build('bomb', ...spot(g, 'bomb', [10, 9])));
  g.feed(tokens(waveCost(1)));
  run(g, 60);
  assert.equal(g.lives, START_LIVES, 'nobody got through');
  assert.ok(g.stats.kills >= 6);
  assert.ok(g.gold > 160 - 50 - 90, 'kills paid');

  const bare = new TDGame(1);
  bare.feed(tokens(waveCost(1)));
  run(bare, 60);
  assert.ok(bare.lives < START_LIVES);
});

test('aim: first, last, strongest, nearest', () => {
  const g = new TDGame(1);
  g.stats.best = 99;
  g.gold = 1e6;
  const t = g.build('glass', ...spot(g, 'glass', [20, 10]))!;
  g.feed(tokens(waveCost(1)));
  g.auto = false; g.send();
  run(g, 12); // let a few walk in
  const live = () => g.enemies.filter((e) => e.alive);
  const pickWith = (aim: 'first' | 'last' | 'strong' | 'near'): Enemy => {
    g.setAim(t, aim);
    // the tower's choice, read through a shot: the glass hits at once
    const before = live().map((e) => e.hp);
    t.cd = 0; t.st = { ...t.st, dmg: 1e-9 }; // a feather: marks without killing
    g.step();
    const hit = live().find((e, i) => e.hp < before[i]);
    assert.ok(hit, aim);
    return hit!;
  };
  for (const e of live()) e.hp = e.max = 100 + e.uid; // give them distinct strengths
  const inRange = () => live().filter((e) => Math.hypot(e.x - t.x, e.y - t.y) <= t.st.range + 11);
  assert.ok(inRange().length >= 2, 'several walkers in reach');
  assert.equal(pickWith('first').uid, inRange().sort((a, b) => b.d - a.d)[0].uid);
  assert.equal(pickWith('last').uid, inRange().sort((a, b) => a.d - b.d)[0].uid);
  assert.equal(pickWith('strong').uid, inRange().sort((a, b) => b.hp - a.hp)[0].uid);
  assert.equal(pickWith('near').uid, inRange().sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0].uid);
});

test('upgrade, sell and move', () => {
  const g = new TDGame(1);
  g.gold = 10_000;
  const t = g.build('quill', ...spot(g, 'quill'))!;
  const n = g.upgrade(t, 10);
  assert.equal(n, 10);
  assert.equal(t.level, 11);
  const max = g.upgrade(t, Infinity);
  assert.ok(max > 0 && g.gold < g.upgradeCost(t));
  const [mx, my] = spot(g, 'quill', [30, 3]);
  assert.ok(g.move(t, mx, my));
  assert.equal(g.towerAt(t.x, t.y), t);
  const before = g.gold, back = g.sell(t);
  assert.ok(back > 0 && g.gold === before + back);
  assert.equal(g.towers.length, 0);
});

test('a Banner cheers towers in its reach', () => {
  const g = new TDGame(1);
  g.stats.best = 99; g.gold = 1e6;
  const q = g.build('quill', ...spot(g, 'quill', [10, 3]))!;
  assert.equal(q.cheer, 0);
  const f = g.build('flag', ...spot(g, 'flag', [q.cx + 2, q.cy]))!;
  assert.ok(q.cheer > 0.1);
  g.upgrade(f, 20);
  assert.ok(q.cheer > 0.3);
  g.sell(f);
  assert.equal(q.cheer, 0);
});

test('save and load round-trip; a wave still walking goes back in the bucket', () => {
  const g = new TDGame(9);
  g.gold = 5000;
  const t = g.build('quill', ...spot(g, 'quill'))!;
  g.upgrade(t, 3);
  g.feed(tokens(waveCost(1) + 100));
  run(g, 1);
  assert.equal(g.wave, 1);
  const s = JSON.parse(JSON.stringify(g.save()));
  assert.equal(s.wave, 0, 'the open wave is handed back');
  assert.equal(s.ink, waveCost(1) + 100);
  const h = TDGame.load(s);
  assert.equal(h.towers.length, 1);
  assert.equal(h.towers[0].level, 4);
  assert.equal(h.gold, g.gold);
  assert.equal(h.seed, 9);
  assert.equal(TDGame.load(null).gold, 160);
  assert.equal(TDGame.load({ v: 1, gold: NaN, towers: [{ type: 'nope' }, { type: 'quill', level: 2, cx: -5, cy: 0 }] }).gold, 160 + Math.floor((50 + 40) * 0.7), 'a tower that no longer fits is sold back');
});

test('out of lives: the page tears and you go back a few waves, towers kept', () => {
  const g = new TDGame(1);
  g.auto = false;
  g.stats.best = 12; g.wave = 11;
  g.feed(tokens(waveCost(12)));
  g.send();
  g.lives = 1;
  run(g, 120);
  assert.equal(g.stats.tears, 1);
  assert.equal(g.lives, START_LIVES);
  assert.equal(g.wave, 6, 'wave 12 failed: the next is wave 7');
  assert.equal(g.alive(), 0);
});

test('hours of heavy play stay finite, and pooling keeps the walker list small', () => {
  const g = new TDGame(3);
  g.stats.best = 99; g.gold = 1e7;
  (['quill', 'bomb', 'frost', 'ruler', 'spark', 'thorn', 'glass', 'flag', 'well', 'candle', 'crane'] as TowerId[]).forEach((type, i) => {
    g.build(type, ...spot(g, type, [5 + i * 3, 4 + (i % 3) * 5]));
  });
  for (const t of g.towers) g.upgrade(t, 400);
  g.speed = 4;
  for (let i = 0; i < 400; i++) { g.feed(tokens(waveCost(g.wave + 1))); run(g, 6); g.feed({ type: 'task_done' }); }
  assert.ok(g.wave > 100, `waves ${g.wave}`);
  for (const v of [g.gold, g.ink, g.lives, ...g.enemies.map((e) => e.hp), ...g.towers.map((t) => t.st.dmg)]) assert.ok(Number.isFinite(v));
  assert.ok(g.enemies.length < 400, `pool ${g.enemies.length}`);
  assert.ok(JSON.stringify(g.save()).length < 20000);
});

// A greedy player: builds the cheapest useful tower near the road, else upgrades the weakest. Reaching wave 40 with
// few or no tears shows the curve is playable; this is a balance guard, not a strategy.
test('balance: a simple greedy player keeps up through wave 40', () => {
  const g = new TDGame(2);
  const order: TowerId[] = ['quill', 'bomb', 'quill', 'frost', 'ruler', 'quill', 'spark', 'bomb', 'thorn', 'glass'];
  const targets: [number, number][] = [[6, 4], [10, 9], [14, 12], [20, 8], [24, 5], [28, 9], [17, 3], [8, 14], [30, 4], [22, 14]];
  let k = 0;
  while (g.wave < 40 && g.time < 3 * 3600) {
    if (!g.busy()) g.feed(tokens(waveCost(g.wave + 1)));
    if (k < order.length && g.canBuild(order[k])) { if (g.build(order[k], ...spot(g, order[k], targets[k]))) k++; }
    else if (g.towers.length) { const w = g.towers.reduce((a, b) => (b.level < a.level ? b : a)); g.upgrade(w, 1); }
    run(g, 1);
  }
  assert.ok(g.wave >= 40, `reached wave ${g.wave}`);
  assert.ok(g.stats.tears <= 1, `tears ${g.stats.tears}`);
});
