// The hosted adapter's pure parts: a shell game run as a catalog game gets the same events it gets in the app, its
// status reaches the orb with its lead, it saves only its own settings, and the feed reads as waiting on a version 1
// bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownSettings, randomSeed, toFeedStatus, toHostedStatus, toUsageEvent } from '../src/hosted-game';
import { forHostedGame } from '../src/hosted';
import { shellDefaults } from '../src/settings';
import type { UsageEvent } from '../src/events';

test('a usage event survives the trip through the bridge unchanged', () => {
  const evs: UsageEvent[] = [
    { v: 1, source: 'claude-code', type: 'tokens', input: 1500, output: 700, cache_read: 20, cache_write: 3, ts: 1_700_000_000_000 },
    { v: 1, source: 'claude-code', type: 'task_done', ts: 1_700_000_000_500 },
  ];
  for (const ev of evs) assert.deepEqual(toUsageEvent(forHostedGame(ev)), ev);
  assert.equal(toUsageEvent({ type: 'nonsense' } as never), null, 'anything else is dropped');
  const neg = toUsageEvent({ type: 'tokens', input: -5, output: Number.NaN, cache_read: 0, cache_write: 0, ts: 1 } as never);
  assert.deepEqual(neg && neg.type === 'tokens' && [neg.input, neg.output], [0, 0], 'counts are checked like any event from outside');
});

test('the status keeps its lead in front of the line', () => {
  assert.deepEqual(toHostedStatus({ count: '6', title: 'ants', lead: '⚡314', line: '6 ants · 3 food', warm: false }),
    { count: '6', title: 'ants', line: '⚡314 · 6 ants · 3 food' });
  assert.deepEqual(toHostedStatus({ count: '0', title: 'ants', lead: '★ 12', warm: true }), { count: '0', title: 'ants', line: '★ 12', warm: true });
  assert.deepEqual(toHostedStatus({ count: '1', title: 'ant', line: 'fed' }), { count: '1', title: 'ant', line: 'fed' });
});

test('a hosted game saves only its own settings, never the shell\'s', () => {
  const own = { palette: 'graphite', calm: 40, seed: 7 };
  assert.deepEqual(ownSettings({ ...shellDefaults(), ...own }), own);
  assert.deepEqual(ownSettings(shellDefaults()), {});
});

test('the feed: watching and file counts from bridge version 2, waiting on version 1', () => {
  assert.deepEqual(toFeedStatus({ watching: true, files: 12 }), { watching: true, files: 12, root: '' });
  assert.deepEqual(toFeedStatus(undefined), { watching: false, files: 0, root: '' });
  assert.deepEqual(toFeedStatus({ watching: true, files: -3.5 }), { watching: true, files: 0, root: '' });
  assert.deepEqual(toFeedStatus({ watching: false, files: Number.NaN }), { watching: false, files: 0, root: '' });
});

test('a first seed is a 32-bit number, and not the same each time', () => {
  const seeds = new Set(Array.from({ length: 8 }, randomSeed));
  for (const s of seeds) assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 32);
  assert.ok(seeds.size > 1);
});
