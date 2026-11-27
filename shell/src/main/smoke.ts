// The automated smoke test, run inside the real app (TG_SMOKE=<folder>) with no window ever shown: it drives the
// shell like a player would (the orb, its hover pill, the open card, dragging it to another corner, popping out and
// docking back, the window's sizes, full screen, click-through, the tray and the shortcut), hands over to the game's
// own checks, saves screenshots, writes result-<mode>.json and quits. shell/scripts/smoke.mjs starts it three times: a
// full run, a 'reopen' run that checks everything survived the restart, and a 'catalog' run (smoke-catalog.ts).
import { app, nativeTheme, screen, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { GameStatus, OrbDrag, ResizeDrag } from '../api';
import { dockPoint } from '../geometry';
import { shapeOf, type ShellEvent, type ShellState } from '../modes';
import { orbCenter, orbWindowBounds, shapeRect, shapeSize, type OrbGeo, type Shape } from '../orb';
import type { ShellSettings } from '../settings';
import type { TrayItem } from '../tray';
import { catalogSmoke, type CatalogSmoke } from './smoke-catalog';
import type { SettingsStore } from './store';

export interface SmokeContext<S extends ShellSettings> {
  win: BrowserWindow; store: SettingsStore<S>; outDir: string; claudeDir: string;
  update(patch: Partial<S>): S;
  resize(d: ResizeDrag): void;
  orbDrag(d: OrbDrag): void;
  isFullscreen(): boolean;
  dispatch(ev: ShellEvent): void;
  displays(): void; // as if the displays changed
  state(): ShellState;
  geo(): OrbGeo;
  trayItems(): TrayItem[];
  hotkey(): void;
  status(): GameStatus;
  visible(): boolean;
  show(): void;
  hide(): void;
  ignoresMouse(): boolean; // clicks pass through the window
  catalog?: CatalogSmoke; // for the catalog run
}

// What the game's checks get: the same tools the shell's checks use.
export interface SmokeKit<S extends ShellSettings> extends SmokeContext<S> {
  mode: 'full' | 'reopen' | 'catalog';
  check(name: string, ok: unknown, detail?: unknown): void;
  wait(ms: number): Promise<void>;
  until(fn: () => Promise<boolean> | boolean, ms?: number): Promise<boolean>;
  js<T = any>(code: string): Promise<T>;
  shot(name: string): Promise<void>; // the window as it is (the orb's shape alone while in the corner)
  shots(name: string): Promise<void>; // the same twice: <name>-dark and <name>-light
  docked(dock: 'tl' | 'tr' | 'bl' | 'br', w: number, h: number): boolean;
  transcript(usage: Record<string, number>, id: string): void; // append a real Claude Code transcript line
}

// A game's own checks. full() runs popped out, in the small window at the bottom right; reset() after Reset to
// defaults; leave() before the full run quits (change settings to look for after the restart, save); reopen() in the
// second run, popped out.
export interface GameSmoke<S extends ShellSettings> {
  full?(k: SmokeKit<S>): Promise<void>;
  reset?(k: SmokeKit<S>): Promise<void>;
  leave?(k: SmokeKit<S>): Promise<void>;
  reopen?(k: SmokeKit<S>): Promise<void>;
}

interface Check { name: string; ok: boolean; detail?: string }

export async function runSmoke<S extends ShellSettings>(c: SmokeContext<S>, game: GameSmoke<S> = {}): Promise<void> {
  const m = process.env.TG_SMOKE_MODE, mode = m === 'reopen' || m === 'catalog' ? m : 'full';
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
    await wait(700); // the shape's grow and fade
    const sh = shapeOf(c.state()), b = c.win.getBounds();
    let rect: Electron.Rectangle | undefined;
    if (sh) {
      const r = shapeRect(sh, c.geo());
      rect = { x: r.x - b.x, y: r.y - b.y, width: r.width, height: r.height };
    }
    const img = await c.win.webContents.capturePage(rect);
    fs.writeFileSync(path.join(c.outDir, name + '.png'), img.toPNG());
  };
  const dark = () => js<boolean>('document.body.classList.contains("tg-dark")');
  const shots = async (name: string) => {
    const was = nativeTheme.themeSource;
    nativeTheme.themeSource = 'dark';
    await until(dark, 2000);
    await shot(name + '-dark');
    nativeTheme.themeSource = 'light';
    await until(async () => !(await dark()), 2000);
    await shot(name + '-light');
    nativeTheme.themeSource = was;
    await until(async () => (await dark()) === nativeTheme.shouldUseDarkColors, 2000);
  };
  const transcript = (usage: Record<string, number>, id: string) => {
    const file = path.join(c.claudeDir, 'demo-project', 'session-1.jsonl');
    const line = { type: 'assistant', sessionId: 'session-1', timestamp: new Date().toISOString(), isSidechain: false,
      message: { id, model: 'claude-test', stop_reason: 'end_turn', content: [{ type: 'text', text: 'not read' }], usage } };
    fs.appendFileSync(file, JSON.stringify(line) + '\n');
  };
  const k: SmokeKit<S> = { ...c, mode, check, wait, until, js, shot, shots, docked, transcript };

  // the window sits in the orb's corner and the page shows this shape at its size
  const inCorner = () => same(c.win.getBounds(), orbWindowBounds(c.geo()));
  const shows = async (sh: Shape) => {
    const s = shapeSize(sh, c.geo());
    return until(async () => { const p = await page(); return shapeOf(p.shown) === sh && p.shape.w === s.width && p.shape.h === s.height; }, 3000);
  };
  const labels = (items: TrayItem[]): string[] => items.flatMap((i) => [i.label || '', ...(i.submenu ? labels(i.submenu) : [])]);
  const settled = (st: ShellState) => until(() => c.state() === st, 3000);

  try {
    fs.mkdirSync(c.outDir, { recursive: true });
    nativeTheme.themeSource = 'dark';
    if (c.win.webContents.isLoading()) await new Promise<void>((r) => { c.win.webContents.once('did-finish-load', () => r()); });
    check('the page loads with its test hooks', await until(() => js('!!window.shellTest && !!window.gameTest')));

    if (mode === 'catalog') {
      if (c.catalog) await catalogSmoke(k, c.catalog);
      else check('the shell passes the catalog to the smoke test', false);
      return;
    }

    if (mode === 'reopen') {
      const s = c.store.get();
      check('settings survive a restart: popped out, large, top left, the orb\'s corner', s.presentation === 'floating' && s.size === 'large' && s.dock === 'tl' && s.corner === 'tr', s);
      check('the game reopens popped out where it was left', c.state() === 'popped' && docked('tl', 640, 360), { state: c.state(), bounds: c.win.getBounds() });
      check('the page shows the window', await until(async () => { const p = await page(); return p.shown === 'popped' && p.scale === 'window'; }));
      await game.reopen?.(k);
      if (c.state() !== 'popped') { c.dispatch('pop'); await settled('popped'); }
      c.dispatch('dock');
      check('docking goes back to the remembered corner', await settled('orb') && inCorner() && c.geo().corner === 'tr' && await shows('orb'), c.win.getBounds());
      return;
    }

    // ---------- in the corner ----------
    const g = c.geo();
    check('first run: an orb in the bottom right corner of the work area', c.store.get().presentation === 'orb' && c.state() === 'orb' && g.corner === 'br' && inCorner(), { geo: g, bounds: c.win.getBounds() });
    const wb = c.win.getBounds(), wa = screen.getDisplayMatching(wb).workArea;
    check('…inside the work area, clear of the menu bar and the Dock', wb.x >= wa.x && wb.y >= wa.y && wb.x + wb.width <= wa.x + wa.width && wb.y + wb.height <= wa.y + wa.height, { wb, wa });
    check('the orb rests at its size, the game in its round eye', await shows('orb') && /tg-eye/.test((await page()).rootIn), await page());
    check('resting, clicks pass through everything but the orb', c.ignoresMouse());
    await wait(1200);
    check('the game draws in the orb', (await page()).root.w > 40, (await page()).root);
    check('the orb shows the game\'s count', await until(async () => (await page()).count !== '' && (await page()).count === c.status().count), { page: (await page()).count, status: c.status() });
    await shots('orb');
    let items = labels(c.trayItems());
    check('the tray offers the card and Pop out', items.some((l) => l.startsWith('Open ')) && items.includes('Pop out') && items.includes('Reset to defaults'), items);

    c.dispatch('enter');
    check('pointing at the orb grows the pill with the name and the status', await shows('pill') && /tg-eye/.test((await page()).rootIn) && (await page()).pill.length > 3, await page());
    await shots('orb-hover');
    c.dispatch('leave');
    check('moving away shrinks it back', await shows('orb'));

    await js('shellTest.clickOrb()');
    check('a click opens the card', await shows('card') && (await page()).scale === 'expanded' && /tg-big/.test((await page()).rootIn), await page());
    check('open, the window takes the clicks', !c.ignoresMouse());
    check('the card shows the game big', (await page()).root.w > 380, (await page()).root);
    await shots('orb-expanded');
    await js('shellTest.click("tg-set")');
    check('Settings opens inside the card', await until(async () => (await page()).panelOpen));
    const text = await js<string>('shellTest.text()');
    check('Settings has the Display section with the corner', /In the corner/.test(text) && /Floating window/.test(text) && /Corner/.test(text), text.slice(0, 400));
    await shot('orb-expanded-settings');
    await js('shellTest.key("Escape")');
    check('Esc closes Settings first', await until(async () => !(await page()).panelOpen) && c.state() === 'expanded');
    await js('shellTest.click("tg-shrink")');
    check('– folds the card back into the orb', await shows('orb') && c.ignoresMouse());

    c.hotkey();
    check('the shortcut opens the card…', await shows('card'));
    c.hotkey();
    check('…and closes it', await shows('orb'));
    c.dispatch('toggle');
    await shows('card');
    await js('shellTest.key("Escape")');
    check('Esc folds the card', await shows('orb'));

    // never stuck without a way back: hidden, the shortcut and the tray bring it back
    c.hide();
    check('hidden, nothing is left on screen and the tray offers Show', !c.visible() && labels(c.trayItems()).some((l) => l.startsWith('Show ')), labels(c.trayItems()));
    c.hotkey();
    check('the shortcut brings the hidden orb back', await until(() => c.visible()) && c.state() === 'orb' && inCorner());

    // dragging it to another corner
    const o = orbCenter(c.geo()), a0 = c.geo().area;
    await js(`shellTest.dragOrb(${o.x}, ${o.y}, ${a0.x + 40 - o.x}, ${a0.y + 40 - o.y})`);
    check('dragged to the top left, it settles in that corner and remembers it', await until(() => c.store.get().corner === 'tl' && c.geo().corner === 'tl' && inCorner()) && c.state() === 'orb',
      { corner: c.store.get().corner, bounds: c.win.getBounds(), want: orbWindowBounds(c.geo()) });
    check('…and the page anchors the orb there', await until(async () => (await page()).corner === 'tl') && await shows('orb'));
    check('the saved display is the one it was dropped on', c.store.get().display === c.geo().displayId, c.store.get().display);
    await shots('orb-top-left');
    const o2 = orbCenter(c.geo());
    await js(`shellTest.dragOrb(${o2.x}, ${o2.y}, 30, 20)`);
    check('a short drag that stays in its quarter goes back to the same corner', await until(() => inCorner()) && c.store.get().corner === 'tl', c.win.getBounds());
    await js('shellTest.clickOrb()');
    check('in the top left the card opens downwards from the orb', await shows('card') && inCorner());
    await shot('orb-top-left-expanded');
    c.displays();
    check('a display change folds it and puts it back in its corner', await shows('orb') && inCorner(), c.win.getBounds());
    c.update({ corner: 'br' } as Partial<S>);
    check('choosing a corner in Settings moves it there', await until(() => c.geo().corner === 'br' && inCorner()));

    // resting in the corner must cost next to nothing
    await wait(1500);
    const m0 = Date.now();
    const cpu0 = app.getAppMetrics().reduce((n, m) => n + m.cpu.percentCPUUsage, 0);
    await wait(3000);
    const cpu = app.getAppMetrics().reduce((n, m) => n + m.cpu.percentCPUUsage, 0);
    check('resting in the corner costs little CPU', cpu < 25, { appPercent: Math.round(cpu), earlier: Math.round(cpu0), ms: Date.now() - m0 });

    // ---------- pop out ----------
    c.dispatch('toggle');
    await shows('card');
    await js('shellTest.click("tg-pop")');
    check('Pop out flies it into the floating window', await settled('popped') && docked('br', 320, 180), { state: c.state(), bounds: c.win.getBounds() });
    check('…and remembers it', c.store.get().presentation === 'floating');
    check('the page shows the window, the game under the title bar', await until(async () => { const p = await page(); return p.shown === 'popped' && /tg-host/.test(p.rootIn) && p.topInset === 20; }), await page());
    check('popped out, the window takes the clicks', !c.ignoresMouse());
    items = labels(c.trayItems());
    check('the tray offers the way back', items.includes('Back to the corner') && !items.includes('Pop out'), items);
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
    check('T turns click-through on', await until(async () => c.store.get().clickThrough && (await page()).thru && c.ignoresMouse()));
    c.hotkey();
    check('popped out, the shortcut turns it off again', await until(() => !c.store.get().clickThrough && !c.ignoresMouse()));
    await js('shellTest.key("f")');
    const d = screen.getDisplayMatching(c.win.getBounds()).bounds;
    check('F fills the screen', await until(() => { const b = c.win.getBounds(); return c.isFullscreen() && b.width === d.width && b.height === d.height; }), c.win.getBounds());
    check('the title bar grows in full screen', await until(async () => (await page()).topInset === 26));
    await js('shellTest.key("Escape")');
    check('Esc leaves full screen', await until(() => !c.isFullscreen() && docked('br', 800, 450)), c.win.getBounds());
    c.update({ opacity: 0.6, alwaysOnTop: false } as Partial<S>);
    check('opacity and always-on-top apply to the window', Math.abs(c.win.getOpacity() - 0.6) < 0.02 && !c.win.isAlwaysOnTop());
    c.update({ opacity: 1, alwaysOnTop: true, dock: 'tl', clickThrough: true } as Partial<S>);
    check('docking moves it to the chosen corner', docked('tl', 800, 450) && c.win.isAlwaysOnTop(), c.win.getBounds());

    // ---------- back to the corner ----------
    await js('shellTest.click("tg-dock")');
    check('↩ Corner flies it home', await settled('orb') && inCorner() && c.store.get().presentation === 'orb', { state: c.state(), bounds: c.win.getBounds() });
    check('…the page shows the orb again, the game in its eye', await shows('orb') && /tg-eye/.test((await page()).rootIn));
    check('…in the corner the window is on top and opaque, and click-through stays with the floating window', c.win.isAlwaysOnTop() && c.win.getOpacity() === 1 && c.ignoresMouse());
    await js('shellTest.clickOrb()');
    check('…and the orb still opens although the floating window was click-through', await shows('card') && !c.ignoresMouse());
    await js('shellTest.key("Escape")');
    await shows('orb');
    check('the floating window keeps its own settings', c.store.get().dock === 'tl' && c.store.get().width === 800 && c.store.get().clickThrough, c.store.get());
    c.update({ clickThrough: false } as Partial<S>);

    // Settings' presentation switch, and reduced motion: no flight
    c.dispatch('toggle');
    await shows('card');
    await js('shellTest.key(",")');
    await until(async () => (await page()).panelOpen);
    await js('document.querySelector(\'[data-pres="floating"]\').click()');
    check('Settings → Floating window pops it out', await settled('popped') && c.store.get().presentation === 'floating');
    c.update({ reducedMotion: true } as Partial<S>);
    c.dispatch('dock');
    check('with reduced motion it docks at once', c.state() === 'orb');
    c.dispatch('pop');
    check('…and pops out at once', c.state() === 'popped');
    c.update({ reducedMotion: false } as Partial<S>);

    // ---------- reset ----------
    c.update({ corner: 'tl' } as Partial<S>);
    await until(async () => (await page()).shown === 'popped');
    await js('shellTest.key(",")');
    await until(async () => (await page()).panelOpen);
    await js('shellTest.click("tg-reset")');
    check('Reset to defaults brings the game home and the defaults back', await settled('orb') && await until(() => {
      const s = c.store.get();
      return s.presentation === 'orb' && s.corner === 'br' && s.display === null && s.size === 'small' && s.dock === 'br' && !s.reducedMotion && !s.clickThrough && s.opacity === 1;
    }) && await until(() => inCorner() && c.geo().corner === 'br'), c.store.get());
    await game.reset?.(k);

    // ---------- leave it popped out, large, top left (the orb's corner top right) for the reopen run ----------
    if (c.state() !== 'popped') { c.dispatch('pop'); await settled('popped'); }
    c.update({ size: 'large', dock: 'tl', corner: 'tr' } as Partial<S>);
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
