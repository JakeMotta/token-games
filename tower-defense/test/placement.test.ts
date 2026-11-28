// Free placement on a soft grid: towers never overlap each other, the road (except the tack), the kept spots or the
// edge, whatever sequence of builds, moves and sales happens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELL, CELLS, COLS, ROAD, ROWS, distToRoad } from '../src/sim/map';
import { Grid, nearest, snap } from '../src/sim/placement';
import { TOWERS, TOWER_IDS, type TowerId } from '../src/sim/towers';
import { TDGame } from '../src/sim/game';
import { rng } from '../src/sim/enemies';

test('the road is blocked, open paper is not', () => {
  const road = [...CELLS].filter((c) => c === 1).length, free = [...CELLS].filter((c) => c === 0).length;
  assert.ok(road > 80 && road < 450, `road cells ${road}`);
  assert.ok(free > 350, `free cells ${free}`);
  // every free cell's square really is clear of the road's edge
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (CELLS[r * COLS + c] === 0) {
    for (const [fx, fy] of [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]]) {
      assert.ok(distToRoad((c + fx) * CELL, (r + fy) * CELL) >= ROAD - 0.01, `cell ${c},${r}`);
    }
  }
});

test('why a spot is refused', () => {
  const g = new Grid();
  assert.equal(g.why('quill', -1, 3), 'off the page');
  assert.equal(g.why('quill', COLS - 1, 3), 'off the page');
  assert.equal(g.why('quill', 0, ROWS - 2), 'keep this spot clear');
  const roadCell = [...CELLS].indexOf(1);
  assert.equal(g.why('quill', roadCell % COLS, Math.floor(roadCell / COLS)), 'that is the road');
  const [cx, cy] = firstFree(g, 'quill');
  assert.equal(g.why('quill', cx, cy), '');
  g.fill(cx, cy, 2, 7);
  assert.equal(g.why('quill', cx + 1, cy + 1), 'something is there');
  assert.equal(g.why('quill', cx, cy, 7), '', 'a moving tower ignores its own cells');
  assert.equal(g.why('tack', cx, cy, 7), 'tacks go on the road');
});

test('snap centres a tower under the pointer; nearest finds a free spot close by', () => {
  assert.deepEqual(snap('quill', 5 * CELL, 5 * CELL), [4, 4]);
  assert.deepEqual(snap('bomb', 5.5 * CELL, 5.5 * CELL), [4, 4]);
  const g = new Grid(), [cx, cy] = firstFree(g, 'quill');
  g.fill(cx, cy, 2, 1);
  const n = nearest(g, 'quill', cx, cy, 3);
  assert.ok(n && g.ok('quill', n[0], n[1]));
});

test('fuzz: thousands of random builds, moves and sales never overlap anything', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const r = rng(seed), game = new TDGame(seed);
    game.stats.best = 99; // every tower unlocked
    for (let i = 0; i < 1500; i++) {
      game.gold = 1e9;
      const type = TOWER_IDS[Math.floor(r() * TOWER_IDS.length)] as TowerId;
      const cx = Math.floor(r() * (COLS + 4)) - 2, cy = Math.floor(r() * (ROWS + 4)) - 2;
      const op = r();
      if (op < 0.75) game.build(type, cx, cy);
      else if (op < 0.93 && game.towers.length) game.move(game.towers[Math.floor(r() * game.towers.length)], cx, cy);
      else if (game.towers.length) game.sell(game.towers[Math.floor(r() * game.towers.length)]);
      if (i % 50 === 0) check(game);
    }
    check(game);
    assert.ok(game.towers.length > 20, `seed ${seed}: the page filled up (${game.towers.length})`);
  }
});

function check(game: TDGame): void {
  const seen = new Int32Array(COLS * ROWS);
  for (const t of game.towers) {
    const s = TOWERS[t.type].size;
    assert.ok(t.cx >= 0 && t.cy >= 0 && t.cx + s <= COLS && t.cy + s <= ROWS, 'inside the page');
    for (let r = t.cy; r < t.cy + s; r++) for (let c = t.cx; c < t.cx + s; c++) {
      const i = r * COLS + c;
      assert.equal(seen[i], 0, `two towers on cell ${c},${r}`);
      seen[i] = t.id;
      assert.notEqual(CELLS[i], 2, 'kept spots stay clear');
      if (!TOWERS[t.type].onRoad) assert.equal(CELLS[i], 0, `${t.type} off the road`);
    }
    if (TOWERS[t.type].onRoad) assert.ok(distToRoad(t.x, t.y) <= ROAD * 0.55, 'a tack sits on the road');
  }
  // the occupancy grid agrees with the towers
  for (let i = 0; i < seen.length; i++) assert.equal(game.grid.occ[i], seen[i]);
}

function firstFree(g: Grid, type: TowerId): [number, number] {
  for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) if (g.ok(type, cx, cy)) return [cx, cy];
  throw new Error('no room');
}
