// Unit tests for the ant sprites and the frame drawing (render.js). Run: node --test prototype/ant-farm/test/render.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const AntSim = require('../sim.js');
const R = require('../render.js');

const keys = (sp, ks) => sp.filter((p) => ks.includes(p[2]));
const box = (sp) => {
  const us = sp.map((p) => p[0]), vs = sp.map((p) => p[1]);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs), w: Math.max(...us) - Math.min(...us) + 1, h: Math.max(...vs) - Math.min(...vs) + 1 };
};
const mid = (sp) => { const b = box(sp); return (b.u0 + b.u1) / 2; };

test('a worker has a gaster, a waist, a thorax and a head, in that order from tail to front', () => {
  const sp = R.sprite('worker', {});
  const g = keys(sp, ['g', 's']), p = keys(sp, ['p']), t = keys(sp, ['t']), h = keys(sp, ['h', 'e']);
  assert.ok(g.length >= 12 && t.length >= 4 && h.length >= 6 && p.length >= 1);
  assert.ok(mid(g) < mid(p) && mid(p) < mid(t) && mid(t) < mid(h));
  // the waist is a pinch: at most one pixel tall
  assert.strictEqual(box(p).h, 1);
  assert.ok(keys(sp, ['e']).length === 1, 'one eye');
  assert.ok(keys(sp, ['m']).length >= 1, 'jaws at the front');
  assert.ok(box(keys(sp, ['m'])).u0 > box(h).u0, 'jaws are in front of the head');
});

test('six legs stand on the ground, three near and three far, and they move between steps', () => {
  const sp = R.sprite('worker', { frame: 0 });
  const feet = (s, k) => new Set(s.filter((p) => p[2] === k && p[1] === 0).map((p) => p[0]));
  assert.strictEqual(feet(sp, 'leg').size, 3);
  assert.strictEqual(feet(sp, 'far').size, 3);
  const all = new Set([...feet(sp, 'leg'), ...feet(sp, 'far')]);
  assert.strictEqual(all.size, 6, 'six separate feet');
  const legsAt = (f) => JSON.stringify(keys(R.sprite('worker', { frame: f }), ['leg', 'far']).sort());
  assert.notStrictEqual(legsAt(0), legsAt(2));
  assert.notStrictEqual(legsAt(1), legsAt(3));
  // mid-swing, one tripod is lifted off the ground
  const lifted = R.sprite('worker', { frame: 1 }).filter((p) => (p[2] === 'leg' || p[2] === 'far') && p[1] === 0);
  assert.ok(lifted.length < 6);
});

test('antennae rise from the head and reach forward', () => {
  const sp = R.sprite('worker', {}), a = keys(sp, ['ant']), h = keys(sp, ['h']);
  assert.ok(a.length >= 4);
  assert.ok(box(a).v1 > box(h).v1, 'above the head');
  assert.ok(box(a).u1 > box(h).u1, 'ahead of the head');
  assert.notStrictEqual(JSON.stringify(a), JSON.stringify(keys(R.sprite('worker', { twitch: true }), ['ant'])), 'they twitch');
});

test('a load is held in the jaws, in front of and above them', () => {
  const sp = R.sprite('worker', { load: 'grain' }), m = box(keys(sp, ['m'])), l = box(keys(sp, ['load']));
  assert.strictEqual(keys(sp, ['load']).length, 9);
  assert.ok(l.u0 > m.u1 - 1 && l.v1 > m.v1);
  assert.ok(keys(R.sprite('worker', { load: 'brood' }), ['brood']).length > 0);
});

test('the queen is larger than a worker and a major has the bigger head', () => {
  const w = box(R.sprite('worker', {})), q = box(R.sprite('queen', {}));
  assert.ok(q.w > w.w && q.h > w.h);
  assert.ok(keys(R.sprite('queen', {}), ['b']).length > 4, 'banded gaster');
  assert.ok(keys(R.sprite('major', {}), ['h', 'e']).length > keys(R.sprite('worker', {}), ['h', 'e']).length);
  assert.ok(R.sprite('major', { jaws: true }).length > R.sprite('major', {}).length, 'jaws open when biting');
});

test('the tiny shape keeps the three segments and a load', () => {
  const sp = R.sprite('worker', { tiny: true });
  for (const k of ['g', 't', 'h']) assert.ok(keys(sp, [k]).length > 0, k);
  assert.ok(box(sp).w < box(R.sprite('worker', {})).w);
  assert.ok(keys(R.sprite('worker', { tiny: true, load: 'grain' }), ['load']).length === 4);
});

test('level of detail: four micro pixels a cell when there is room, never under one device pixel', () => {
  assert.deepStrictEqual(R.lod(4), { tiny: false, per: 4, m: 1 });
  assert.deepStrictEqual(R.lod(8), { tiny: false, per: 4, m: 2 });
  assert.strictEqual(R.lod(2).tiny, true);
  assert.strictEqual(R.lod(0.6).m, 1);
});

function fakeCtx(w, h) {
  const rects = [];
  return { rects, canvas: { width: w, height: h }, fillStyle: '', fillRect(x, y, rw, rh) { rects.push([x, y, rw, rh, this.fillStyle]); } };
}

test('every ant in view is drawn, facing the way it last stepped', () => {
  const sim = AntSim.createSim({ seed: 3 });
  sim.run(1500);
  const cam = { x: 0, y: 0, s: 2 }, ctx = fakeCtx(sim.W * 4, sim.H * 4);
  const r = R.drawAnts(ctx, sim, cam, 2, { rim: true });
  assert.strictEqual(r.drawn, sim.ants.length);
  assert.strictEqual(r.m, 1);
  assert.ok(ctx.rects.length > sim.ants.length * 30);
  // one ant alone: mirror it and its pixels flip around its cell
  const a = sim.ants.find((x) => x.role !== 'queen');
  const one = { W: sim.W, H: sim.H, type: sim.type, tick: 0, ants: [Object.assign({}, a, { hx: 1, hy: 0 })] };
  const c1 = fakeCtx(sim.W * 4, sim.H * 4); R.drawAnts(c1, one, cam, 2, {});
  one.ants[0] = Object.assign({}, a, { hx: -1, hy: 0 });
  const c2 = fakeCtx(sim.W * 4, sim.H * 4); R.drawAnts(c2, one, cam, 2, {});
  const cx = (a.x + 0.5) * 4, avg = (c) => c.rects.reduce((s, q) => s + q[0], 0) / c.rects.length;
  assert.ok(avg(c1) > cx - 1 && avg(c2) < cx + 1, 'the head side swaps');
});

test('the soil painter leaves the ants out when the page draws sprites', () => {
  const sim = AntSim.createSim({ seed: 3 });
  sim.run(600);
  const a = new Uint32Array(sim.W * sim.H), b = new Uint32Array(sim.W * sim.H);
  sim.paint(a); sim.paint(b, { ants: false });
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  assert.ok(diff >= sim.ants.length * 3 - 10, 'old ants painted ' + diff);
  // and nothing else changes
  const k = sim.ants[0].y * sim.W + sim.ants[0].x;
  assert.notStrictEqual(a[k], b[k]);
});
