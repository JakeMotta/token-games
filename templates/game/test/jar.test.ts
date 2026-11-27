// The game's logic, tested without Electron. (The shell's own tests run beside these with npm test.)
import test from 'node:test';
import assert from 'node:assert/strict';
import type { UsageEvent } from '@token-games/shell/events';
import { Jar, JAR_GRAINS, TOKENS_PER_GRAIN } from '../src/shared/jar';
import { kit } from '../src/shared/settings';

const tokens = (input: number, cache_read = 0): UsageEvent => ({ v: 1, source: 'claude-code', type: 'tokens', input, output: 0, cache_read, cache_write: 0, ts: 0 });

test('only real tokens add sand, and the remainder carries over', () => {
  const j = new Jar();
  assert.equal(j.feed(tokens(TOKENS_PER_GRAIN * 2.5)), 2);
  assert.equal(j.feed(tokens(TOKENS_PER_GRAIN / 2)), 1);
  assert.equal(j.feed({ v: 1, source: 'claude-code', type: 'session_start', ts: 0 }), 0);
  assert.equal(j.grains, 3);
});

test('cached input counts for a tenth', () => {
  const j = new Jar();
  j.feed(tokens(0, TOKENS_PER_GRAIN * 10));
  assert.equal(j.grains, 1);
});

test('a full jar empties and counts', () => {
  const j = new Jar();
  j.feed(tokens(TOKENS_PER_GRAIN * (JAR_GRAINS + 5)));
  assert.deepEqual([j.jars, j.grains], [1, 5]);
});

test('the save round-trips and a broken save starts empty', () => {
  const j = new Jar();
  j.feed(tokens(12_345));
  assert.deepEqual(Jar.load(j.save()).save(), j.save());
  assert.equal(Jar.load({ v: 1, grains: -4 }).grains, 0);
  assert.equal(Jar.load('nonsense').grains, 0);
});

test('settings: defaults, a bad value falls back, reset', () => {
  assert.equal(kit.defaults().sand, 'sand');
  assert.equal(kit.sanitize({ sand: 'lava' }).sand, 'sand');
  assert.equal(kit.reset(kit.applyPatch(kit.defaults(), { sand: 'sea' })).sand, 'sand');
});
