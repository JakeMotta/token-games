// The farm's own settings, on top of the shell's (shell/test/settings.test.ts tests those and the settings file).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shellDefaults } from '@token-games/shell/settings';
import { SettingsStore } from '@token-games/shell/main/store';
import { applyPatch, defaultSettings, kit, resetSettings, sanitize } from '../src/shared/settings';

test('defaults: in the corner orb, Desktop Blend, the Ridiculous map', () => {
  const s = defaultSettings(5);
  assert.equal(s.presentation, 'orb');
  assert.equal(s.palette, 'blend');
  assert.equal(s.mapSize, 'ridiculous'); assert.equal(s.calm, 0); assert.equal(s.fadeIdle, false); assert.equal(s.reducedMotion, false);
  assert.equal(s.seed, 5);
  assert.equal(s.size, 'small'); assert.equal(s.dock, 'br'); assert.equal(s.alwaysOnTop, true);
});

test('sanitize keeps good farm values and replaces bad ones', () => {
  const base = defaultSettings(1);
  const s = sanitize({ palette: 'graphite', calm: 7, mapSize: 'infinite', seed: 'x' }, base);
  assert.equal(s.palette, 'graphite');
  assert.equal(s.calm, 1, 'calm clamps to 1');
  assert.equal(s.mapSize, 'ridiculous', 'an unknown map size falls back to Ridiculous');
  assert.equal(s.seed, 1);
  assert.equal(sanitize({ mapSize: 'huge' }, base).mapSize, 'huge');
  assert.equal(sanitize({ palette: 'neon' }, base).palette, 'blend');
  assert.ok(!('claudeFeed' in sanitize({ claudeFeed: false }, base)), 'the feed is not a setting: it always watches');
});

test('reset brings back every default, the corner orb included, but keeps the farm', () => {
  const s = applyPatch(defaultSettings(42), { palette: 'terminal', calm: 0.7, fadeIdle: true, mapSize: 'huge', clickThrough: true, presentation: 'floating' });
  assert.deepEqual(resetSettings(s), defaultSettings(42));
  assert.equal(resetSettings(s).presentation, shellDefaults().presentation);
});

test('the settings file keeps the farm\'s seed and settings', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ant-farm-test-')), 'settings.json');
  const a = new SettingsStore(file, kit, 10, () => 9);
  a.set({ palette: 'graphite', calm: 0.4, mapSize: 'large' });
  a.flush();
  const b = new SettingsStore(file, kit, 10, () => 77).get();
  assert.deepEqual([b.palette, b.calm, b.mapSize, b.seed], ['graphite', 0.4, 'large', 9]);
});
