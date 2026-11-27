// The compare lab: the scenarios steer every version the same way on one deterministic clock, the measures say what
// they claim, and the "what is different" panel always has something to say.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../prototype/genome.js');
const M1 = require('../../prototype/motion.js');
const M2 = require('../motion2.js');
const Lab = require('../lab.js');

const BIG = { minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6 };
const runFor = (scenario, seconds, seed) => {
  const run = Lab.createRun({ scenario, seed: seed || 'moss', level: 100, kinds: ['v1', 'v2'] });
  const n = Math.round((seconds == null ? run.scn.seconds : seconds) / Lab.DT);
  for (let i = 0; i < n; i++) Lab.step(run);
  return run;
};
const actor = (run, k) => run.actors.find((a) => a.kind === k);

test('the drive hook steers both walkers forward and round without their own wandering', () => {
  const ph = G.express(G.randomCreature('moss'), { level: 100, overrides: { 'wings.size': 0 } });
  const w1 = M1.createWalker(ph, 7, { heading: 0 }), w2 = M2.createWalker(ph, 7, { heading: 0 });
  for (const [M, w] of [[M1, w1], [M2, w2]]) {
    const x0 = w.x, z0 = w.z;
    for (let i = 0; i < 120; i++) M.step(w, 1 / 60, BIG, { drive: { v: 1, om: 0 } });
    assert.ok(w.x - x0 > 0.05, 'moved along +x (heading 0)');
    assert.ok(Math.abs(w.z - z0) < 0.25 * (w.x - x0), 'kept roughly straight');
    const th0 = w.th;
    for (let i = 0; i < 120; i++) M.step(w, 1 / 60, BIG, { drive: { v: 1, om: 0.8 } });
    // a chain's anchor lags its head, so it has turned less by now than version 1's whole body
    assert.ok(C_wrap(w.th - th0) > 0.1, 'turned left when asked');
  }
});
const C_wrap = (x) => x - 2 * Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI));

test('a run is deterministic: the same seed and scenario land on the same frame', () => {
  const a = runFor('figure-eight', 3), b = runFor('figure-eight', 3);
  for (const k of ['v1', 'v2']) {
    assert.equal(actor(a, k).w.x, actor(b, k).w.x);
    assert.equal(actor(a, k).w.z, actor(b, k).w.z);
    assert.equal(actor(a, k).w.th, actor(b, k).w.th);
  }
});

test('scenario creatures: 2, 4, 6 and 8 legs, a long body longer than a short one, no wings', () => {
  for (const [id, legs] of [['legs-2', 2], ['legs-4', 4], ['legs-6', 6], ['legs-8', 8]]) {
    const run = Lab.createRun({ scenario: id, seed: 'moss', kinds: ['v1', 'v2'] });
    for (const a of run.actors) assert.equal(a.w.feet.length, legs, id + ' ' + a.kind);
    assert.equal(run.ph.wings.size || 0, 0);
  }
  const long = Lab.createRun({ scenario: 'long', seed: 'moss' }), short = Lab.createRun({ scenario: 'short', seed: 'moss' });
  assert.ok(Lab.bodyLength(long.ph) > 1.4 * Lab.bodyLength(short.ph));
});

test('paths: sampled once, arc length grows, a loop wraps', () => {
  const scn = Lab.byId('figure-eight'), path = Lab.samplePath(scn, 1);
  assert.ok(path.loop && path.total > 5);
  const a = Lab.pathAt(path, 0.5), b = Lab.pathAt(path, 0.5 + path.total);
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6);
  assert.equal(Lab.samplePath(Lab.byId('follow'), 1), null);
});

test('leg crossing geometry', () => {
  const leg = (hip, knee, end) => ({ hip, knee, end });
  assert.equal(Lab.legsCross(leg([0, 0], [1, 0], [2, 0]), leg([0, 1], [1, 1], [2, 1])), false);
  assert.equal(Lab.legsCross(leg([0, 0], [1, 1], [2, 2]), leg([0, 2], [1, 1.5], [2, 0])), true);
});

test('every version follows the S-curve closely and the chain bends far more than the ring body', () => {
  const run = runFor('s-curve');
  const s1 = Lab.summary(actor(run, 'v1').meter), s2 = Lab.summary(actor(run, 'v2').meter);
  assert.ok(s1.pathError < 0.25 && s2.pathError < 0.25, JSON.stringify([s1.pathError, s2.pathError]));
  assert.ok(s2.bendMax > 2 * s1.bendMax, JSON.stringify([s1.bendMax, s2.bendMax]));
  assert.ok(s1.footSlide >= 0 && s2.footSlide >= 0 && s1.footSlide < 10 && s2.footSlide < 10);
});

test('a spin: version 1 turns tighter than a chain can', () => {
  const run = runFor('spin');
  const s1 = Lab.summary(actor(run, 'v1').meter), s2 = Lab.summary(actor(run, 'v2').meter);
  assert.ok(s1.tightestTurn != null && s2.tightestTurn != null);
  assert.ok(s1.tightestTurn < s2.tightestTurn, JSON.stringify([s1.tightestTurn, s2.tightestTurn]));
});

test('sudden stops: everyone comes to rest during a stop', () => {
  const scn = Lab.byId('stops'), run = Lab.createRun({ scenario: 'stops', seed: 'moss', kinds: ['v1', 'v2'] });
  const stopEnd = scn.stops.go + scn.stops.stop - 0.05; // late in the first stop
  while (run.t < stopEnd) Lab.step(run);
  for (const a of run.actors) assert.ok(a.w.v < 0.05 * a.BL, a.kind + ' v=' + a.w.v);
});

test('follow: the target jumps on a seeded schedule and a click takes over', () => {
  const run = Lab.createRun({ scenario: 'follow', seed: 'moss' });
  const t0 = Lab.targetAt(run, 0), t1 = Lab.targetAt(run, 4);
  assert.ok(t0 && t1 && (t0.x !== t1.x || t0.z !== t1.z));
  const cx = -2 * run.u, cz = -1.5 * run.u;
  run.clicks.push({ at: 4.5, x: cx, z: cz });
  assert.deepEqual([Lab.targetAt(run, 5).x, Lab.targetAt(run, 5).z], [cx, cz]);
  while (run.t < 4.5) Lab.step(run);
  const before = run.actors.map((a) => { const p = Lab.steerPoint(a); return Math.hypot(p.x - cx, p.z - cz); });
  while (run.t < 8) Lab.step(run);
  run.actors.forEach((a, i) => {
    const p = Lab.steerPoint(a);
    assert.ok(Math.hypot(p.x - cx, p.z - cz) < before[i] - 0.3 * run.u, a.kind + ' heads for the click');
  });
});

test('the stride-behind rings: a planted foot never stays far past its circle', () => {
  const run = Lab.createRun({ scenario: 'legs-4', seed: 'moss', kinds: ['v2'] });
  let worst = 0;
  for (let i = 0; i < 6 / Lab.DT; i++) {
    Lab.step(run);
    for (const r of Lab.stepRings(run.actors[0])) if (r.planted) worst = Math.max(worst, r.behind);
  }
  assert.ok(worst > 0.3, 'feet do fall behind');
  assert.ok(worst < 2.2, 'and step before they trail far: ' + worst);
});

test('the what-is-different panel: 4 to 6 lines and a two-part verdict for every scenario', () => {
  for (const s of Lab.SCENARIOS) {
    const run = runFor(s.id, 3);
    const d = Lab.differences(run);
    assert.ok(d.lines.length >= 4 && d.lines.length <= 6, s.id + ' ' + d.lines.length);
    assert.match(d.verdict, /^By eye: .+ By the numbers: /);
    assert.ok(['v1', 'v2', 'draw'].includes(d.eye), s.id);
  }
});
