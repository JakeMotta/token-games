// Map checks for every view: same rules engine, sane paths, every build spot reaches the road.
// Run: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const TD = require(path.join(root, 'td.js'));
const order = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/views\/\w+\.js/g);
const ctx = { window: { VIEWS: [] }, Math, JSON };
ctx.window.window = ctx.window;
vm.createContext(ctx);
for (const f of order) vm.runInContext('window = this.window; H = window.H;' + fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const views = ctx.window.VIEWS;
const H = ctx.window.H;

test('eight views load with unique ids', () => {
  assert.strictEqual(views.length, 8);
  assert.strictEqual(new Set(views.map((v) => v.id)).size, 8);
  for (const v of views) for (const k of ['name', 'tag', 'blurb']) assert.ok(v[k], v.id + ' has ' + k);
});

for (const v of views) {
  test(v.id + ': map is playable', () => {
    const { path: p, spots } = v.map;
    assert.ok(p.length >= 2 && spots.length >= 8, 'path and spots');
    spots.forEach((s, i) => {
      const d = H.distToPath(p, s[0], s[1]);
      assert.ok(d >= 0.6, `spot ${i} sits on the road (${d.toFixed(2)})`);
      // A level-1 frost tower (the shortest range) must still reach the road.
      assert.ok(d <= TD.towerStats('frost', 1).range, `spot ${i} out of reach (${d.toFixed(2)})`);
    });
    const used = v.demo.towers.map((t) => t[0]);
    assert.strictEqual(new Set(used).size, used.length, 'demo towers share a spot');
    for (const [s, type, lv] of v.demo.towers) {
      assert.ok(s < spots.length && TD.TOWER_TYPES.includes(type) && lv >= 1 && lv <= 4);
    }
    assert.ok(v.demo.towers.some((t) => t[2] >= 3), 'one tower shows a late upgrade');
    assert.ok(v.demo.menu < spots.length);
  });

  test(v.id + ': same rules run to waves and kills', () => {
    const g = TD.createGame({ map: v.map, seed: 7, mode: 'endless' });
    for (let i = 0; i < TD.HZ * 120; i++) {
      if (i % 40 === 0) g.feed({ tokens: 2000 });
      g.step();
    }
    assert.ok(g.stats.waves >= 3, 'waves come in');
    assert.ok(g.stats.killed > 10, 'towers kill on this map');
    assert.ok(g.towers.length >= 3, 'auto build finds spots');
  });
}
