// How ants are drawn between steps (game/motion.ts): they glide between cells on every frame, and they face the way
// they really walk: a turn-around on flat ground is an eased flip that never points up or down, one bump in the floor
// doesn't tilt them, and only a real climb or drop in a shaft points them straight up or down. Drawing only: the
// simulation runs the same with or without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Motion, STEP_MS, type Mover, type Pose } from '../src/game/motion';
import { createSim } from '../src/sim/sim';

const FRAME = 1000 / 120; // a 120 Hz screen
const ant = (x: number, y: number, hx = 1): Mover => ({ id: 1, x, y, hx, speed: 1 });

// Walk an ant through `cells` (one a step), drawing 6 frames a step at 120 Hz, then `rest` steps standing still; the
// pose at every frame.
function walk(cells: [number, number][], smooth = true, rest = 0): Pose[] {
  const last = cells[cells.length - 1];
  cells = [...cells, ...Array.from({ length: rest }, () => last)];
  const m = new Motion(), out: Pose[] = [];
  let t = 1000, prev = cells[0];
  for (const c of cells) {
    const hx = Math.sign(c[0] - prev[0]);
    prev = c;
    for (let f = 0; f < STEP_MS / FRAME; f++) {
      m.update([ant(c[0], c[1], hx)], t, smooth);
      const p = { x: 0, y: 0, fx: 0, fy: 0 };
      assert.ok(m.pose(1, p));
      out.push(p);
      t += FRAME;
    }
  }
  return out;
}

test('a walking ant glides: a new position on every frame, never a whole-cell hop', () => {
  const cells: [number, number][] = Array.from({ length: 10 }, (_, i) => [10 + i, 20]);
  const xs = walk(cells).map((p) => p.x);
  for (let i = 7; i < xs.length; i++) {
    assert.ok(xs[i] >= xs[i - 1], 'never goes back');
    assert.ok(xs[i] - xs[i - 1] < 0.5, `frame ${i} moves ${xs[i] - xs[i - 1]} cells`);
  }
  assert.ok(new Set(xs.slice(6)).size > xs.length * 0.7, 'most frames show a new position');
});

test('turning around on flat ground is an eased flip that never points up or down', () => {
  const there: [number, number][] = Array.from({ length: 6 }, (_, i) => [10 + i, 20]);
  const back: [number, number][] = Array.from({ length: 6 }, (_, i) => [14 - i, 20]);
  const poses = walk([...there, ...back], true, 4);
  assert.ok(poses.every((p) => p.fy === 0), 'level the whole way');
  const turn = poses.slice(36).map((p) => p.fx);
  assert.equal(poses[35].fx, 1, 'faces right before the turn');
  assert.ok(turn.some((f) => f > -0.9 && f < 0.9), 'passes through the middle: not a one-frame 180° snap');
  for (let i = 1; i < turn.length; i++) assert.ok(turn[i] <= turn[i - 1] + 1e-9, 'turns one way only');
  assert.equal(turn[turn.length - 1], -1, 'ends facing left');
  const most = turn.findIndex((f) => f <= -0.9), done = turn.findIndex((f) => f === -1);
  assert.ok(most >= 6 && most * FRAME <= 150, `mostly turned in ${Math.round(most * FRAME)} ms`);
  assert.ok(done * FRAME <= 300, `settled in ${Math.round(done * FRAME)} ms`);
});

test('one bump in the floor does not tilt the ant; a slope does', () => {
  const bump = walk([[10, 20], [11, 20], [12, 19], [13, 19], [14, 19], [15, 20], [16, 20]]);
  assert.ok(bump.every((p) => p.fy === 0), 'level over a one-cell bump');
  const slope = walk([[10, 20], [11, 19], [12, 18], [13, 17], [14, 16]], true, 4);
  assert.equal(slope[slope.length - 1].fy, -1, 'tilts up after two steps up');
  assert.equal(slope[slope.length - 1].fx, 1, '…still facing the way it walks');
});

test('straight up or down only while climbing or dropping in a shaft', () => {
  const climb = walk([[10, 30], [10, 29], [10, 28], [10, 27], [10, 26]], true, 4);
  const last = climb[climb.length - 1];
  assert.ok(Math.abs(last.fx) < 0.02 && last.fy === -1, 'points up in a shaft');
  const out = walk([[10, 30], [10, 29], [10, 28], [10, 27], [11, 27], [12, 27], [13, 27]], true, 4);
  const end = out[out.length - 1];
  assert.ok(end.fx === 1 && end.fy === 0, 'levels out once it walks off');
});

test('after a climb an ant levels out once it stops, unless it rests in a shaft too narrow to turn in', () => {
  const rest = (narrow: boolean) => {
    const m = new Motion(), p = { x: 0, y: 0, fx: 0, fy: 0 };
    let t = 0;
    for (const y of [30, 29, 28, 27, 27, 27, 27, 27, 27, 27, 27]) { m.update([ant(10, y, 0)], t, true, () => narrow); t += STEP_MS; }
    m.pose(1, p);
    return p;
  };
  assert.deepEqual([rest(false).fx, rest(false).fy], [1, 0]);
  assert.deepEqual([rest(true).fx, rest(true).fy], [0, -1]);
});

test('digging above or below does not make an ant look up or down; digging beside it turns it', () => {
  const m = new Motion(), p = { x: 0, y: 0, fx: 0, fy: 0 };
  m.update([{ id: 1, x: 5, y: 5, hx: 1, speed: 1 }], 0, false);
  m.update([{ id: 1, x: 5, y: 5, hx: 0, speed: 1 }], 50, false); // the simulation heads it at the cell above
  m.pose(1, p);
  assert.deepEqual([p.fx, p.fy], [1, 0]);
  m.update([{ id: 1, x: 5, y: 5, hx: -1, speed: 1 }], 100, false); // and now at a cell to its left
  m.pose(1, p);
  assert.deepEqual([p.fx, p.fy], [-1, 0]);
});

test('reduced motion and the orb: drawn in its cell, facing its final way at once', () => {
  const poses = walk([[10, 20], [11, 20], [12, 20], [11, 20]], false);
  assert.ok(poses.every((p) => Number.isInteger(p.x) && p.fy === 0));
  assert.equal(poses[poses.length - 1].fx, -1);
});

test('a carried or far jump is not glided across, and gone ants are forgotten', () => {
  const m = new Motion(), p = { x: 0, y: 0, fx: 0, fy: 0 };
  m.update([ant(10, 10)], 0, true);
  m.update([ant(40, 10)], 50, true);
  m.pose(1, p);
  assert.equal(p.x, 40);
  m.update([], 100, true);
  assert.equal(m.pose(1, p), false);
});

test('drawing with poses leaves the simulation exactly as it was', () => {
  const a = createSim({ seed: 31 }), b = createSim({ seed: 31 }), m = new Motion();
  const box = { x0: 0, y0: 0, x1: a.W, y1: a.H };
  for (let i = 0; i < 600; i++) {
    a.step(); b.step();
    m.update(a.ants, i * STEP_MS, true);
    a.overlay(box, () => {}, (ant, o) => m.pose(ant.id, o));
  }
  assert.equal(a.hash(), b.hash());
  let cells = 0;
  a.overlay(box, (x, y) => { cells++; assert.ok(Number.isFinite(x) && Number.isFinite(y)); }, (ant, o) => m.pose(ant.id, o));
  assert.ok(cells >= a.ants.length * 3, 'every ant still drawn');
});
