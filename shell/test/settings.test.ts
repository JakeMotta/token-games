// The shared settings, how a game adds its own, the settings file and the tray menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { num, oneOf, settingsKit, shellDefaults, type GameSettingsSchema } from '../src/settings';
import { SaveFile, SettingsStore } from '../src/main/store';
import { trayMenu, type TrayItem } from '../src/tray';

// a game with a colour and a seed it keeps on reset
interface G { colour: 'red' | 'blue'; speed: number; seed: number }
const game: GameSettingsSchema<G> = {
  defaults: (seed) => ({ colour: 'red', speed: 1, seed }),
  sanitize: (r, b) => ({ colour: oneOf(['red', 'blue'] as const, r.colour, b.colour), speed: num(r.speed, 0, 5, b.speed), seed: typeof r.seed === 'number' ? r.seed : b.seed }),
  reset: (cur) => game.defaults(cur.seed),
};
const kit = settingsKit(game);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tg-shell-test-'));

test('defaults: in the notch; popped out it is small, bottom right, on top and opaque', () => {
  const s = kit.defaults(7);
  assert.equal(s.presentation, 'notch');
  assert.equal(s.size, 'small'); assert.equal(s.width, 320); assert.equal(s.dock, 'br');
  assert.equal(s.alwaysOnTop, true); assert.equal(s.clickThrough, false); assert.equal(s.opacity, 1); assert.equal(s.reducedMotion, false);
  assert.deepEqual([s.colour, s.speed, s.seed], ['red', 1, 7], 'and the game\'s own');
});

test('sanitize checks the shell\'s and the game\'s values, and drops unknown keys', () => {
  const base = kit.defaults(1);
  const s = kit.sanitize({ presentation: 'sideways', opacity: 0.01, dock: 'middle', size: 'custom', width: 500, colour: 'green', speed: 9, hacked: 1, bounds: { x: 1, y: 2, width: 3, height: 'x' } }, base);
  assert.equal(s.presentation, 'notch');
  assert.equal(s.opacity, 0.25, 'opacity never below a quarter');
  assert.equal(s.dock, 'br'); assert.equal(s.width, 500); assert.equal(s.bounds, null);
  assert.equal(s.colour, 'red'); assert.equal(s.speed, 5);
  assert.ok(!('hacked' in s));
  assert.deepEqual(kit.sanitize('garbage', base), base);
  assert.equal(kit.sanitize({ presentation: 'floating' }, base).presentation, 'floating');
});

test('a size preset sets the width; custom keeps the dragged width', () => {
  let s = kit.defaults(1);
  s = kit.applyPatch(s, { size: 'large' });
  assert.equal(s.width, 640);
  s = kit.applyPatch(s, { size: 'custom', width: 777 });
  assert.equal(s.width, 777);
  s = kit.applyPatch(s, { size: 'small' });
  assert.equal(s.width, 320);
  assert.equal(kit.sanitize({ size: 'large', width: 999 }).width, 640, 'a preset wins over a stale width');
});

test('reset: every default back, in the notch, except what the game keeps', () => {
  const s = kit.applyPatch(kit.defaults(42), { presentation: 'floating', clickThrough: true, dock: 'tl', opacity: 0.5, colour: 'blue', speed: 3 });
  assert.deepEqual(kit.reset(s), { ...shellDefaults(), colour: 'red', speed: 1, seed: 42 });
});

test('the settings file: first run writes the defaults with a new seed', () => {
  const file = path.join(tmp(), 'settings.json');
  const st = new SettingsStore(file, kit, 10, () => 1234);
  assert.equal(st.get().seed, 1234);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).presentation, 'notch');
});

test('the settings file: changes come back on the next start', () => {
  const file = path.join(tmp(), 'settings.json');
  const a = new SettingsStore(file, kit, 10, () => 9);
  a.set({ presentation: 'floating', size: 'large', dock: 'tl', reducedMotion: true, colour: 'blue' });
  a.flush();
  const b = new SettingsStore(file, kit, 10, () => 77).get();
  assert.deepEqual([b.presentation, b.width, b.dock, b.reducedMotion, b.colour, b.seed], ['floating', 640, 'tl', true, 'blue', 9]);
});

test('the settings file: written shortly after a change; a broken file means defaults', async () => {
  const file = path.join(tmp(), 'settings.json');
  new SettingsStore(file, kit, 10).set({ colour: 'blue' });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).colour, 'blue');
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(new SettingsStore(file, kit, 10, () => 3).get(), kit.defaults(3));
});

test('the save file: round trip, nothing or broken means a new game', () => {
  const f = new SaveFile(path.join(tmp(), 'a', 'save.json'));
  assert.equal(f.load(), null);
  assert.equal(f.save({ n: 1 }), true);
  assert.deepEqual(f.load(), { n: 1 });
  assert.equal(f.save(null), false);
  fs.writeFileSync(f.file, 'x');
  assert.equal(f.load(), null);
});

const flat = (items: TrayItem[]): TrayItem[] => items.flatMap((i) => [i, ...(i.submenu ? flat(i.submenu) : [])]);
const find = (items: TrayItem[], label: string) => flat(items).find((i) => i.label === label);

test('the tray in the notch: open the drop-down, pop out, settings, reset, quit', () => {
  const m = trayMenu(kit.defaults(1), { name: 'Demo', visible: true, state: 'collapsed', shortcut: 'Alt+CommandOrControl+T' });
  assert.equal(m[0].label, 'Hide Demo');
  assert.deepEqual(find(m, 'Open the drop-down')!.action, { do: 'open' });
  assert.equal(find(m, 'Open the drop-down')!.accelerator, 'Alt+CommandOrControl+T');
  assert.deepEqual(find(m, 'Pop out')!.action, { do: 'pop' });
  assert.ok(!find(m, 'Back to the notch'));
  assert.equal(find(m, 'In the notch')!.checked, true);
  assert.equal(find(m, 'Full screen')!.enabled, false, 'full screen only popped out');
  assert.equal(find(m, 'Click-through')!.accelerator, undefined, 'in the notch the shortcut opens the drop-down');
  assert.deepEqual(find(m, 'Reset to defaults')!.action, { do: 'reset' });
  assert.equal(find(trayMenu(kit.defaults(1), { name: 'Demo', visible: true, state: 'expanded', shortcut: '' }), 'Close the drop-down')!.action!.do, 'open');
  assert.equal(trayMenu(kit.defaults(1), { name: 'Demo', visible: false, state: 'collapsed', shortcut: '' })[0].label, 'Show Demo');
});

test('the tray popped out: back to the notch, the window\'s settings, the shortcut on click-through', () => {
  const s = kit.applyPatch(kit.defaults(1), { presentation: 'floating', clickThrough: true, size: 'large' });
  const m = trayMenu(s, { name: 'Demo', visible: true, state: 'popped', shortcut: 'X' });
  assert.deepEqual(find(m, 'Back to the notch')!.action, { do: 'dock' });
  assert.ok(!find(m, 'Pop out'));
  assert.equal(find(m, 'Floating window')!.type, 'radio');
  assert.equal(find(m, 'Large (640 × 360)')!.checked, true);
  assert.deepEqual(find(m, 'Click-through')!.action, { do: 'set', patch: { clickThrough: false } });
  assert.equal(find(m, 'Click-through')!.accelerator, 'X');
  assert.equal(find(m, 'Bottom right')!.checked, true);
  assert.ok(!flat(m).some((i) => /Claude Code|feed/i.test(i.label || '')), 'no switch to stop watching Claude Code, no feed buttons');
});
