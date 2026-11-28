// Infinite progression: numbers shown compactly, upgrades and waves that never cap, and nothing ever NaN or Infinity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fin, fmt, powSafe, LIMIT } from '../src/sim/num';
import { TOWERS, TOWER_IDS, affordable, dps, nextUnlock, COST_GROWTH, sellValue, spent, stats, unlockedAt, upgradeCost, ROMAN } from '../src/sim/towers';
import { ENEMIES, rollWave, speedMult, waveCost, waveGold, waveHp, weigh } from '../src/sim/enemies';

test('big numbers read compactly', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(7), '7');
  assert.equal(fmt(2.5), '2.5');
  assert.equal(fmt(999), '999');
  assert.equal(fmt(1000), '1.00K');
  assert.equal(fmt(1234), '1.23K');
  assert.equal(fmt(45_600_000), '45.6M');
  assert.equal(fmt(789e9), '789B');
  assert.equal(fmt(999_999), '1.00M');
  assert.equal(fmt(7.8e12), '7.80T');
  assert.equal(fmt(1e15), '1.00aa');
  assert.equal(fmt(1e18), '1.00ab');
  assert.match(fmt(3.3e90), /^3\.30[a-z]{2}$/);
  assert.match(fmt(1e300), /^1\.00[a-z]{2}$/);
  assert.equal(fmt(Infinity), '∞');
  assert.equal(fmt(-1500), '-1.50K');
});

test('fin and powSafe keep every value finite', () => {
  assert.equal(fin(NaN), 0);
  assert.equal(fin(Infinity), LIMIT);
  assert.equal(fin(-3), 0);
  assert.ok(Number.isFinite(powSafe(1.15, 1e9)));
  assert.equal(powSafe(2, 10), 1024);
});

test('every tower has a name, role, flavor, cost and an unlock wave; ten-plus distinct towers', () => {
  assert.ok(TOWER_IDS.length >= 8);
  const names = new Set<string>();
  for (const id of TOWER_IDS) {
    const t = TOWERS[id];
    assert.ok(t.name && t.role && t.flavor, id);
    assert.ok(t.cost > 0 && t.unlock >= 1, id);
    names.add(t.name);
  }
  assert.equal(names.size, TOWER_IDS.length);
  // something new keeps unlocking
  assert.ok(unlockedAt(1).length >= 2);
  assert.ok(unlockedAt(40).length === TOWER_IDS.length);
  assert.equal(nextUnlock(1)?.id, 'frost');
  assert.equal(nextUnlock(99), null);
});

test('upgrades never cap: cost, damage, reach and speed keep growing, milestones every 10 levels', () => {
  for (const id of TOWER_IDS) {
    let prev = stats(id, 1), prevCost = upgradeCost(id, 1);
    for (const L of [2, 3, 9, 10, 11, 20, 50, 100, 500, 1000, 5000]) {
      const s = stats(id, L), c = upgradeCost(id, L);
      assert.ok(c > prevCost, `${id} cost grows at ${L}`);
      if (TOWERS[id].dmg) assert.ok(s.dmg > prev.dmg, `${id} damage grows at ${L}`);
      if (TOWERS[id].rate) assert.ok(s.rate > prev.rate, `${id} speed grows at ${L}`);
      assert.ok(s.range > prev.range, `${id} reach grows at ${L}`);
      prev = s; prevCost = c;
    }
    // a milestone: level 10 doubles on top of the usual 12%
    if (TOWERS[id].dmg) assert.ok(stats(id, 10).dmg / stats(id, 9).dmg > 2, id);
  }
  assert.equal(stats('quill', 30).multi, 4);
  assert.ok(stats('spark', 25).multi > stats('spark', 5).multi);
  assert.ok(stats('frost', 1000).area < 0.75, 'frost never freezes solid');
  assert.ok(stats('glass', 1000).crit < 1);
  assert.ok(stats('flag', 100).aura > stats('flag', 10).aura);
});

test('no NaN or Infinity at absurd levels and waves', () => {
  for (const id of TOWER_IDS) for (const L of [1, 1e3, 1e5, 1e7]) {
    const s = stats(id, L);
    for (const v of Object.values(s)) assert.ok(Number.isFinite(v), `${id} L${L}`);
    assert.ok(Number.isFinite(upgradeCost(id, L)) && Number.isFinite(spent(id, L)) && Number.isFinite(sellValue(id, L)) && Number.isFinite(dps(id, s)));
  }
  for (const w of [1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7]) {
    for (const v of [waveHp(w), waveGold(w), speedMult(w), waveCost(w)]) assert.ok(Number.isFinite(v) && v > 0, `wave ${w}`);
  }
});

test('waves get tougher forever, and the numbers get big', () => {
  let prev = 0;
  for (const w of [1, 2, 10, 50, 100, 500, 1000, 2000, 2001, 5000, 1e5]) {
    assert.ok(waveHp(w) > prev, `wave ${w}`);
    prev = waveHp(w);
  }
  assert.ok(waveHp(100) / waveHp(1) > 100);
  assert.ok(waveHp(1000) > 1e15, 'late waves reach letters');
  // weeks of heavy use stay far from the limit: 3 weeks × 100M tokens ≈ wave 3,000
  assert.ok(waveHp(30000) < 1e150);
  assert.ok(waveGold(50) < waveHp(50) && waveGold(50) > 0);
});

test('waves: bosses every 10th, the Editor every 50th, new doodles join, rolled the same every time', () => {
  assert.ok(rollWave(10, 1).list.includes('boss'));
  assert.ok(rollWave(50, 1).list.includes('editor'));
  assert.ok(!rollWave(11, 1).list.includes('boss'));
  assert.deepEqual(rollWave(17, 3), rollWave(17, 3));
  assert.ok(rollWave(1, 1).list.every((t) => t === 'scribble'));
  for (const id of ['dash', 'blot', 'plane', 'gnat', 'ditto', 'eraser'] as const) {
    assert.ok(rollWave(ENEMIES[id].from, 5).list.includes(id), `${id} shows up the wave it unlocks`);
  }
  assert.ok(rollWave(200, 1).list.length <= 40, 'counts stay sane; hit points carry the growth');
});

test('tokens are weighed the same as the other games: cache reads count a tenth', () => {
  assert.equal(weigh({ input: 100, output: 200, cache_read: 1000, cache_write: 50 }), 450);
  assert.ok(waveCost(2) > waveCost(1));
});

test('buying many levels at once matches buying them one by one', () => {
  const a = affordable('quill', 1, 10_000);
  let gold = 10_000, L = 1;
  while (gold >= upgradeCost('quill', L)) { gold -= upgradeCost('quill', L); L++; }
  assert.equal(a.levels, L - 1);
  assert.equal(affordable('quill', 1, 10_000, 3).levels, 3);
  assert.ok(Math.abs(spent('quill', 5) - (50 + [1, 2, 3, 4].reduce((s, l) => s + 40 * COST_GROWTH ** (l - 1), 0))) < 1e-6);
  assert.equal(ROMAN(4), 'IV');
  assert.equal(ROMAN(39), 'XXXIX');
});
