// The settings and the settings file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPatch, defaultSettings, resetSettings, sanitize } from '../src/shared/settings';
import { SettingsStore } from '../src/main/store';
import { trayMenu } from '../src/main/tray';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ant-farm-test-'));

test('defaults: Desktop Blend, small, bottom right, on top, Claude Code feed on', () => {
  const s = defaultSettings(5);
  assert.equal(s.palette, 'blend');
  assert.equal(s.size, 'small'); assert.equal(s.width, 320);
  assert.equal(s.dock, 'br');
  assert.equal(s.alwaysOnTop, true); assert.equal(s.clickThrough, false); assert.equal(s.opacity, 1);
  assert.equal(s.claudeFeed, true); assert.equal(s.calm, 0); assert.equal(s.fadeIdle, false); assert.equal(s.reducedMotion, false);
  assert.equal(s.seed, 5);
});

test('sanitize keeps good values, replaces bad ones and drops unknown keys', () => {
  const base = defaultSettings(1);
  const s = sanitize({ palette: 'graphite', calm: 7, opacity: 0.01, dock: 'middle', size: 'custom', width: 500, hacked: true, bounds: { x: 1, y: 2, width: 3, height: 'x' } }, base);
  assert.equal(s.palette, 'graphite');
  assert.equal(s.calm, 1, 'calm clamps to 1');
  assert.equal(s.opacity, 0.25, 'opacity never below a quarter');
  assert.equal(s.dock, 'br');
  assert.equal(s.width, 500);
  assert.equal(s.bounds, null);
  assert.ok(!('hacked' in s));
  assert.deepEqual(sanitize('garbage', base), base);
});

test('a size preset sets the width; custom keeps the dragged width', () => {
  let s = defaultSettings(1);
  s = applyPatch(s, { size: 'large' });
  assert.equal(s.width, 640);
  s = applyPatch(s, { size: 'custom', width: 777 });
  assert.equal(s.width, 777);
  s = applyPatch(s, { size: 'small' });
  assert.equal(s.width, 320);
  assert.equal(sanitize({ size: 'large', width: 999 }).width, 640, 'a preset wins over a stale width');
});

test('reset brings back every default but keeps the farm', () => {
  const s = applyPatch(defaultSettings(42), { palette: 'terminal', calm: 0.7, clickThrough: true, dock: 'tl', opacity: 0.5 });
  assert.deepEqual(resetSettings(s), defaultSettings(42));
});

test('the settings file: first run writes defaults with a new seed', () => {
  const file = path.join(tmp(), 'settings.json');
  const st = new SettingsStore(file, 10, () => 1234);
  assert.equal(st.get().seed, 1234);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).palette, 'blend');
});

test('the settings file: changes are saved and read back on the next start', () => {
  const file = path.join(tmp(), 'settings.json');
  const a = new SettingsStore(file, 10, () => 9);
  a.set({ palette: 'graphite', size: 'large', dock: 'tl', calm: 0.4, reducedMotion: true });
  a.flush();
  const b = new SettingsStore(file, 10, () => 77);
  assert.equal(b.get().palette, 'graphite');
  assert.equal(b.get().width, 640);
  assert.equal(b.get().dock, 'tl');
  assert.equal(b.get().calm, 0.4);
  assert.equal(b.get().reducedMotion, true);
  assert.equal(b.get().seed, 9, 'the farm keeps its seed');
});

test('the settings file: a change is written shortly after, without a flush', async () => {
  const file = path.join(tmp(), 'settings.json');
  const a = new SettingsStore(file, 10);
  a.set({ palette: 'slate' });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).palette, 'slate');
});

test('the settings file: a broken file means defaults, not a crash', () => {
  const file = path.join(tmp(), 'settings.json');
  fs.writeFileSync(file, '{ not json');
  const st = new SettingsStore(file, 10, () => 3);
  assert.deepEqual(st.get(), defaultSettings(3));
});

test('the menu-bar menu reflects the settings', () => {
  const s = applyPatch(defaultSettings(1), { clickThrough: true, size: 'large' });
  const m = trayMenu(s, true, 'Alt+CommandOrControl+T');
  assert.equal(m[0].label, 'Hide Ant Farm');
  assert.equal(trayMenu(s, false, '')[0].label, 'Show Ant Farm');
  const click = m.find((i) => i.label === 'Click-through')!;
  assert.equal(click.checked, true);
  assert.deepEqual(click.action, { do: 'set', patch: { clickThrough: false } });
  assert.equal(m.find((i) => i.label?.startsWith('Large'))!.checked, true);
  const dock = m.find((i) => i.label === 'Dock')!;
  assert.equal(dock.submenu!.find((i) => i.checked)!.label, 'Bottom right');
});
