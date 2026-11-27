// Genome: same seed same creature, every seed its own creature, a valid body at every level, breeding and repair
// rules from the video, and the token curve. Run: node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../genome.js');

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
function walk(o, fn, path = '') {
  if (Array.isArray(o)) o.forEach((x, i) => walk(x, fn, path + '[' + i + ']'));
  else if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], fn, path ? path + '.' + k : k);
  else fn(o, path);
}

test('the same seed makes the same creature', () => {
  for (const seed of ['moss', 'a', 42, 'egg-7']) {
    const a = G.randomCreature(seed), b = G.randomCreature(seed);
    assert.deepEqual(a, b);
    assert.deepEqual(G.express(a, { level: 37, temperament: 0.3 }), G.express(b, { level: 37, temperament: 0.3 }));
  }
});

test('different seeds make different creatures (1000 seeds, no repeats)', () => {
  const seen = new Set(), names = new Set();
  for (let i = 0; i < 1000; i++) {
    const c = G.randomCreature('u' + i);
    seen.add(G.fingerprint(c)); names.add(c.name);
  }
  assert.equal(seen.size, 1000);
  assert.ok(names.size > 300, 'names vary: ' + names.size);
});

test('creatures vary in what you can see, not only in numbers', () => {
  const kinds = { legs: new Set(), wings: 0, horns: new Set(), ears: new Set(), pattern: new Set(), decor: new Set() };
  for (let i = 0; i < 300; i++) {
    const ph = G.express(G.randomCreature('v' + i), { level: 100, repair: false });
    kinds.legs.add(ph.legs.pairs); kinds.horns.add(ph.horns.count); kinds.ears.add(ph.ears.kind);
    kinds.pattern.add(ph.pattern.kind); kinds.decor.add(ph.decor.kind); if (ph.wings.size > 0) kinds.wings++;
  }
  assert.equal(kinds.legs.size, 4);
  assert.equal(kinds.horns.size, 3);
  assert.equal(kinds.ears.size, G.EAR_KINDS.length);
  assert.equal(kinds.pattern.size, G.PATTERN_KINDS.length);
  assert.equal(kinds.decor.size, G.DECOR_KINDS.length);
  assert.ok(kinds.wings > 30 && kinds.wings < 270, 'some have wings, some not: ' + kinds.wings);
});

test('every level 1..100 gives a valid body, and every level changes it', () => {
  for (const seed of ['moss', 'b', 'c', 'd', 'e']) {
    const c = G.randomCreature(seed);
    let prev = null;
    for (let level = 1; level <= G.LEVEL_MAX; level++) {
      const ph = G.express(c, { level });
      walk(ph, (v, p) => { if (typeof v === 'number') assert.ok(finite(v), seed + ' L' + level + ' ' + p + '=' + v); });
      assert.ok(ph.scale > 0 && ph.torso.length > 0 && ph.head.rings.every((r) => r.w > 0 && r.h > 0));
      assert.ok(ph.legs.pairs >= 1, 'repair keeps legs');
      const key = JSON.stringify(ph);
      assert.notEqual(key, prev, seed + ' level ' + level + ' looks like level ' + (level - 1));
      prev = key;
    }
  }
});

test('growth: babies are small with big heads and eyes; adults are full size', () => {
  const c = G.randomCreature('grow');
  const baby = G.express(c, { level: 1 }), adult = G.express(c, { level: 100 });
  const headToBody = (ph) => Math.max(...ph.head.rings.map((r) => r.w)) / Math.max(...ph.torso.rings.map((r) => r.w));
  assert.ok(baby.scale < adult.scale * 0.6);
  assert.ok(headToBody(baby) > headToBody(adult));
  assert.ok(baby.eyes.size > adult.eyes.size);
});

test('stages: 1-25 baby, 26-55 child, 56-99 teen, 100 adult', () => {
  assert.equal(G.stageOf(1), 'baby'); assert.equal(G.stageOf(25), 'baby');
  assert.equal(G.stageOf(26), 'child'); assert.equal(G.stageOf(55), 'child');
  assert.equal(G.stageOf(56), 'teen'); assert.equal(G.stageOf(99), 'teen');
  assert.equal(G.stageOf(100), 'adult');
});

test('the one bar: cute is rounder, paler, bigger-eyed; scary has fangs and slanted eyes', () => {
  for (const seed of ['t1', 't2', 't3']) {
    const c = G.randomCreature(seed);
    const cute = G.express(c, { level: 100, temperament: 1 }), scary = G.express(c, { level: 100, temperament: -1 });
    assert.ok(cute.eyes.size > scary.eyes.size);
    assert.ok(cute.colour.light > scary.colour.light);
    assert.ok(scary.fangs > cute.fangs);
    assert.ok(scary.eyes.slant > cute.eyes.slant);
  }
});

test('breeding: whole pieces come from a parent, numbers get a nudge, about 6% get a surprise', () => {
  const a = G.randomCreature('mum'), b = G.randomCreature('dad');
  let surprises = 0;
  for (let i = 0; i < 400; i++) {
    const kid = G.breed(a, b, 'k' + i);
    assert.equal(kid.generation, 1);
    assert.deepEqual(kid.parents, [a.name, b.name]);
    if (kid.surprise) { surprises++; continue; }
    // Copy 2 comes from dad: each piece's numbers sit near one of dad's two copies of that piece.
    for (const piece of ['head', 'torso', 'tail']) {
      const names = G.GENE_NAMES.filter((n) => G.PIECE[n] === piece);
      const dist = (copy) => Math.max(...names.map((n) => Math.abs(kid.copies[1][n] - copy[n]) / (G.GENES[n][1] - G.GENES[n][0])));
      assert.ok(Math.min(dist(b.copies[0]), dist(b.copies[1])) < 0.15, piece + ' came whole from one copy');
    }
  }
  assert.ok(surprises >= 10 && surprises <= 45, 'surprises ' + surprises);
  assert.deepEqual(G.breed(a, b, 'same'), G.breed(a, b, 'same'));
});

test('repair: heads at most 1.6x the body, legs come back', () => {
  const c = G.randomCreature('rep');
  const g = Object.assign(G.genotype(c), { 'legs.pairs': 0 });
  for (let i = 0; i < 5; i++) { g['head.rings[' + i + '].width'] = G.GENES['head.rings[' + i + '].width'][1]; g['torso.rings[' + i + '].width'] = G.GENES['torso.rings[' + i + '].width'][0]; }
  const raw = G.phenotype(g, { level: 100, repair: false }), fixed = G.phenotype(g, { level: 100 });
  assert.equal(raw.legs.pairs, 0);
  assert.ok(fixed.legs.pairs > 0);
  const ratio = (ph) => Math.max(...ph.head.rings.map((r) => r.w), ...ph.head.rings.map((r) => r.h)) /
    Math.max(...ph.torso.rings.map((r) => r.w), ...ph.torso.rings.map((r) => r.h));
  assert.ok(ratio(fixed) <= G.HEAD_MAX_RATIO + 1e-9);
  assert.ok(fixed.repairs.length >= 1);
});

test('eggs differ by genome and are valid', () => {
  const looks = new Set();
  for (let i = 0; i < 50; i++) {
    const look = G.eggLook(G.randomCreature('egg' + i));
    walk(look, (v, p) => { if (typeof v === 'number') assert.ok(finite(v), p); });
    looks.add(JSON.stringify(look));
  }
  assert.equal(looks.size, 50);
});

test('token curve: levels only from tokens, about 27.5M weighted tokens to adult', () => {
  assert.equal(G.levelFromTokens(0).level, 1);
  assert.equal(G.levelFromTokens(G.tokensForLevelUp(1)).level, 2);
  assert.equal(G.levelFromTokens(G.tokensToReach(50)).level, 50);
  assert.equal(G.levelFromTokens(1e12).level, 100);
  assert.ok(Math.abs(G.tokensToReach(100) - 27.5e6) < 0.5e6);
  for (let l = 2; l < 100; l++) assert.ok(G.tokensForLevelUp(l) > G.tokensForLevelUp(l - 1));
});
