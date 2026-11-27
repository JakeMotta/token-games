// The automated smoke test, run inside the real app (TG_SMOKE=<folder>) with no window ever shown: it drives the
// shell like a player would (the notch, the peek, the drop-down, popping out and docking back, the window's sizes,
// full screen, click-through, the tray and the shortcut), hands over to the game's own checks, saves screenshots,
// writes result-<mode>.json and quits. shell/scripts/smoke.mjs starts it twice: a full run, then a 'reopen' run that
// checks everything survived the restart.
import { app, nativeTheme, screen, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { GameStatus, ResizeDrag } from '../api';
import { dockPoint } from '../geometry';
import type { ShellEvent, ShellState } from '../modes';
import { islandRect, islandSize, notchWindowBounds, type NotchGeo, type Shape } from '../notch';
import type { ShellSettings } from '../settings';
import type { TrayItem } from '../tray';
import type { SettingsStore } from './store';

export interface SmokeContext<S extends ShellSettings> {
  win: BrowserWindow; marker(): BrowserWindow | null; store: SettingsStore<S>; outDir: string; claudeDir: string;
  update(patch: Partial<S>): S;
  resize(d: ResizeDrag): void;
  isFullscreen(): boolean;
  dispatch(ev: ShellEvent): void;
  displays(): void; // as if the displays changed
  state(): ShellState;
  geo(): NotchGeo;
  trayItems(): TrayItem[];
  hotkey(): void;
  status(): GameStatus;
}

// What the game's checks get: the same tools the shell's checks use.
export interface SmokeKit<S extends ShellSettings> extends SmokeContext<S> {
  mode: 'full' | 'reopen';
  check(name: string, ok: unknown, detail?: unknown): void;
  wait(ms: number): Promise<void>;
  until(fn: () => Promise<boolean> | boolean, ms?: number): Promise<boolean>;
  js<T = any>(code: string): Promise<T>;
  shot(name: string): Promise<void>; // the window as it is (the island alone while in the notch)
  docked(dock: 'tl' | 'tr' | 'bl' | 'br', w: number, h: number): boolean;
  transcript(usage: Record<string, number>, id: string): void; // append a real Claude Code transcript line
}

// A game's own checks. full() runs popped out, in the small window at the bottom right; reset() after Reset to
// defaults; leave() before the full run quits (change settings to look for after the restart, save); reopen() in the
// second run.
export interface GameSmoke<S extends ShellSettings> {
  full?(k: SmokeKit<S>): Promise<void>;
  reset?(k: SmokeKit<S>): Promise<void>;
  leave?(k: SmokeKit<S>): Promise<void>;
  reopen?(k: SmokeKit<S>): Promise<void>;
}

interface Check { name: string; ok: boolean; detail?: string }

export async function runSmoke<S extends ShellSettings>(c: SmokeContext<S>, game: GameSmoke<S> = {}): Promise<void> {
  const mode = process.env.TG_SMOKE_MODE === 'reopen' ? 'reopen' : 'full';
  const checks: Check[] = [];
  const check = (name: string, ok: unknown, detail?: unknown) => { checks.push({ name, ok: !!ok, detail: detail === undefined ? undefined : JSON.stringify(detail) }); };
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const js = <T = any>(code: string): Promise<T> => c.win.webContents.executeJavaScript(code);
  const page = () => js('shellTest.state()');
  const until = async (fn: () => Promise<boolean> | boolean, ms = 5000): Promise<boolean> => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await fn()) return true; await wait(100); }
    return false;
  };
  const area = () => screen.getDisplayMatching(c.win.getBounds()).workArea;
  const docked = (dock: 'tl' | 'tr' | 'bl' | 'br', w: number, h: number) => {
    const b = c.win.getBounds(), p = dockPoint(dock, area(), w, h);
    return b.width === w && b.height === h && b.x === p.x && b.y === p.y;
  };
  const shot = async (name: string) => {
    await wait(700); // the island's grow and fade
    const st = c.state(), b = c.win.getBounds();
    let rect: Electron.Rectangle | undefined;
    if (st === 'collapsed' || st === 'peek' || st === 'expanded') {
      const r = islandRect(st, c.geo());
      rect = { x: r.x - b.x, y: r.y - b.y, width: r.width, height: r.height };
    }
    const img = await c.win.webContents.capturePage(rect);
    fs.writeFileSync(path.join(c.outDir, name + '.png'), img.toPNG());
  };
  const transcript = (usage: Record<string, number>, id: string) => {
    const file = path.join(c.claudeDir, 'demo-project', 'session-1.jsonl');
    const line = { type: 'assistant', sessionId: 'session-1', timestamp: new Date().toISOString(), isSidechain: false,
      message: { id, model: 'claude-test', stop_reason: 'end_turn', content: [{ type: 'text', text: 'not read' }], usage } };
    fs.appendFileSync(file, JSON.stringify(line) + '\n');
  };
  const k: SmokeKit<S> = { ...c, mode, check, wait, until, js, shot, docked, transcript };

  const inNotch = (shape: Shape) => same(c.win.getBounds(), notchWindowBounds(c.geo())) && c.state() === shape;
  const shows = async (shape: Shape) => {
    const s = islandSize(shape, c.geo());
    return until(async () => { const p = await page(); return p.shown === shape && p.island.w === s.width && p.island.h === s.height; }, 3000);
  };
  const labels = (items: TrayItem[]): string[] => items.flatMap((i) => [i.label || '', ...(i.submenu ? labels(i.submenu) : [])]);
  const settled = (st: ShellState) => until(() => c.state() === st, 3000);

  try {
    fs.mkdirSync(c.outDir, { recursive: true });
    nativeTheme.themeSource = 'dark';
    if (c.win.webContents.isLoading()) await new Promise<void>((r) => { c.win.webContents.once('did-finish-load', () => r()); });
    check('the page loads with its test hooks', await until(() => js('!!window.shellTest && !!window.gameTest')));

    if (mode === 'reopen') {
      const s = c.store.get();
      check('settings survive a restart: popped out, large, top left', s.presentation === 'floating' && s.size === 'large' && s.dock === 'tl', s);
      check('the game reopens popped out where it was left', c.state() === 'popped' && docked('tl', 640, 360), { state: c.state(), bounds: c.win.getBounds() });
      check('the page shows the window', await until(async () => { const p = await page(); return p.shown === 'popped' && p.scale === 'window'; }));
      check('the island stays in the notch while the game is out', !!c.marker(), c.marker()?.getBounds());
      await game.reopen?.(k);
      return;
    }

    // ---------- in the notch ----------
    const g = c.geo();
    check('first run: in the notch (or the menu-bar pill), resting', c.store.get().presentation === 'notch' && inNotch('collapsed'), { geo: g, bounds: c.win.getBounds() });
    check('the island rests at its size, the game in its left ear', await shows('collapsed') && /tg-ear/.test((await page()).rootIn), await page());
    await wait(1200);
    check('the game draws in the notch', (await page()).root.w > 10, (await page()).root);
    await shot('notch-collapsed');
    let items = labels(c.trayItems());
    check('the tray offers the drop-down and Pop out', items.includes('Open the drop-down') && items.includes('Pop out') && items.includes('Reset to defaults'), items);

    c.dispatch('enter');
    check('pointing at the island peeks', await shows('peek') && /tg-strip/.test((await page()).rootIn), await page());
    await shot('notch-peek');
    c.dispatch('leave');
    check('moving away folds it back', await shows('collapsed'));

    await js('shellTest.clickIsland()');
    check('a click drops it down', await shows('expanded') && (await page()).scale === 'expanded' && /tg-big/.test((await page()).rootIn), await page());
    check('the drop-down shows the game big', (await page()).root.w > 500, (await page()).root);
    await shot('notch-expanded');
    await js('shellTest.click("tg-set")');
    check('Settings opens inside the drop-down', await until(async () => (await page()).panelOpen));
    check('Settings has the Display section', /In the notch/.test(await js<string>('shellTest.text()')) && /Floating window/.test(await js<string>('shellTest.text()')));
    await shot('notch-expanded-settings');
    await js('shellTest.key("Escape")');
    check('Esc closes Settings first', await until(async () => !(await page()).panelOpen) && c.state() === 'expanded');
    await js('shellTest.clickHandle()');
    check('a click on the top row folds it up', await shows('collapsed'));

    c.hotkey();
    check('the shortcut opens the drop-down…', await shows('expanded'));
    c.hotkey();
    check('…and closes it', await shows('collapsed'));
    c.dispatch('toggle');
    await shows('expanded');
    await js('shellTest.key("Escape")');
    check('Esc folds the drop-down', await shows('collapsed'));
    c.dispatch('toggle');
    await shows('expanded');
    c.displays();
    check('a display change folds it and puts it back in place', await shows('collapsed') && inNotch('collapsed'), c.win.getBounds());

    // resting in the notch must cost next to nothing
    await wait(1500);
    const m0 = Date.now();
    const cpu0 = app.getAppMetrics().reduce((n, m) => n + m.cpu.percentCPUUsage, 0);
    await wait(3000);
    const cpu = app.getAppMetrics().reduce((n, m) => n + m.cpu.percentCPUUsage, 0);
    check('resting in the notch costs little CPU', cpu < 25, { appPercent: Math.round(cpu), earlier: Math.round(cpu0), ms: Date.now() - m0 });

    // ---------- pop out ----------
    c.dispatch('toggle');
    await shows('expanded');
    await js('shellTest.click("tg-pop")');
    check('Pop out flies it into the floating window', await settled('popped') && docked('br', 320, 180), { state: c.state(), bounds: c.win.getBounds() });
    check('…and remembers it', c.store.get().presentation === 'floating');
    check('the page shows the window, the game under the title bar', await until(async () => { const p = await page(); return p.shown === 'popped' && /tg-host/.test(p.rootIn) && p.topInset === 20; }), await page());
    check('the island stays in the notch while the game is out', !!c.marker() && same(c.marker()!.getBounds(), islandRect('collapsed', c.geo())), c.marker()?.getBounds());
    check('the marker shows the game\'s count', await until(() => c.status().count !== ''), c.status());
    items = labels(c.trayItems());
    check('the tray offers the way back', items.includes('Back to the notch') && !items.includes('Pop out'), items);
    await shot('window-small');

    await game.full?.(k);

    // the window's own controls: sizes, the grip, click-through, full screen, opacity, on top, dock
    if (c.state() !== 'popped') { c.dispatch('pop'); await settled('popped'); }
    await js('shellTest.key("2")');
    check('2 makes it large (640 × 360) in its corner', await until(() => docked(c.store.get().dock as 'br', 640, 360)), c.win.getBounds());
    check('the game follows the window size', await until(async () => (await page()).root.w === 640));
    c.update({ dock: 'br' } as Partial<S>);
    await until(() => docked('br', 640, 360));
    const b0 = c.win.getBounds();
    c.resize({ phase: 'start', x: b0.x, y: b0.y });
    c.resize({ phase: 'move', x: b0.x - 160, y: b0.y - 90 });
    c.resize({ phase: 'end', x: b0.x - 160, y: b0.y - 90 });
    const s1 = c.store.get();
    check('the grip resizes at 16:9 and remembers the size', s1.size === 'custom' && s1.width === 800 && docked('br', 800, 450), c.win.getBounds());
    await js('shellTest.key("t")');
    check('T turns click-through on', await until(async () => c.store.get().clickThrough && (await page()).thru));
    c.hotkey();
    check('popped out, the shortcut turns it off again', await until(() => !c.store.get().clickThrough));
    await js('shellTest.key("f")');
    const d = screen.getDisplayMatching(c.win.getBounds()).bounds;
    check('F fills the screen', await until(() => { const b = c.win.getBounds(); return c.isFullscreen() && b.width === d.width && b.height === d.height; }), c.win.getBounds());
    check('the title bar grows in full screen', await until(async () => (await page()).topInset === 26));
    await js('shellTest.key("Escape")');
    check('Esc leaves full screen', await until(() => !c.isFullscreen() && docked('br', 800, 450)), c.win.getBounds());
    c.update({ opacity: 0.6, alwaysOnTop: false } as Partial<S>);
    check('opacity and always-on-top apply to the window', Math.abs(c.win.getOpacity() - 0.6) < 0.02 && !c.win.isAlwaysOnTop());
    c.update({ opacity: 1, alwaysOnTop: true, dock: 'tl' } as Partial<S>);
    check('docking moves it to the chosen corner', docked('tl', 800, 450) && c.win.isAlwaysOnTop(), c.win.getBounds());

    // ---------- back to the notch ----------
    await js('shellTest.click("tg-dock")');
    check('↩ Notch flies it home', await settled('collapsed') && inNotch('collapsed') && c.store.get().presentation === 'notch', { state: c.state(), bounds: c.win.getBounds() });
    check('…the page shows the island again, the game in its ear', await shows('collapsed') && /tg-ear/.test((await page()).rootIn));
    check('…in the notch the window is always on top and opaque', c.win.isAlwaysOnTop() && c.win.getOpacity() === 1);
    check('…and the marker is gone', !c.marker());
    check('the floating window keeps its own settings', c.store.get().dock === 'tl' && c.store.get().width === 800, c.store.get());

    // Settings' presentation switch, and reduced motion: no flight
    c.dispatch('toggle');
    await shows('expanded');
    await js('shellTest.key(",")');
    await until(async () => (await page()).panelOpen);
    await js('document.querySelector(\'[data-pres="floating"]\').click()');
    check('Settings → Floating window pops it out', await settled('popped') && c.store.get().presentation === 'floating');
    c.update({ reducedMotion: true } as Partial<S>);
    c.dispatch('dock');
    check('with reduced motion it docks at once', c.state() === 'collapsed');
    c.dispatch('pop');
    check('…and pops out at once', c.state() === 'popped');
    c.update({ reducedMotion: false } as Partial<S>);

    // ---------- reset ----------
    await until(async () => (await page()).shown === 'popped');
    await js('shellTest.key(",")');
    await until(async () => (await page()).panelOpen);
    await js('shellTest.click("tg-reset")');
    check('Reset to defaults brings the game home and the defaults back', await settled('collapsed') && await until(() => {
      const s = c.store.get();
      return s.presentation === 'notch' && s.size === 'small' && s.dock === 'br' && !s.reducedMotion && !s.clickThrough && s.opacity === 1;
    }) && inNotch('collapsed'), c.store.get());
    await game.reset?.(k);

    // ---------- leave it popped out, large, top left for the reopen run ----------
    c.dispatch('pop');
    await settled('popped');
    c.update({ size: 'large', dock: 'tl' } as Partial<S>);
    await game.leave?.(k);
    await shot('window-large');
  } catch (e) {
    check('no errors', false, String((e as Error).stack || e));
  } finally {
    c.store.flush();
    fs.writeFileSync(path.join(c.outDir, `result-${mode}.json`), JSON.stringify({ ok: checks.every((x) => x.ok), checks }, null, 2));
    app.quit();
  }
}

const same = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
