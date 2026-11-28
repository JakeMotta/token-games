// The automated smoke test, run inside the real app (TG_SMOKE=<folder>) with no window ever shown: it drives the
// shell like a player would (the circle and its name tag, the card, the size switch, Esc, dragging the circle to another
// corner, the window's sizes, full screen, click-through, the menu and the shortcut), hands over to the game's
// own checks, saves screenshots, writes result-<mode>.json and quits. shell/scripts/smoke.mjs starts it up to four
// times: a full run, a 'reopen' run that checks everything survived the restart, a 'catalog' run, and for a game with
// a catalog/ bundle a 'catalog-game' run (both in smoke-catalog.ts). With --perf it starts a single 'perf' run
// instead: the game measures what its frames cost (GameSmoke.perf), still hidden. With --only published it starts a
// 'published' run: the real, public catalog, fetched and installed from a clean profile (smoke-catalog.ts).
import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { GameStatus, OrbDrag, ResizeDrag } from '../api';
import { dockPoint, GAMES_WINDOW, gamesWindowBounds } from '../geometry';
import { shapeOf, type ShellEvent, type ShellState } from '../modes';
import { orbCenter, orbWindowBounds, shapeRect, shapeSize, type OrbGeo, type Shape } from '../orb';
import type { ShellSettings } from '../settings';
import type { TrayAction, TrayItem } from '../tray';
import { catalogGameSmoke, catalogSmoke, publishedSmoke, type CatalogGameChecks, type CatalogSmoke } from './smoke-catalog';
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
  tray(a: TrayAction): void; // as if that tray menu item was chosen
  hotkey(): void; // the global shortcut: show or hide
  menus(): number; // right-click menus asked for (the smoke test never shows one)
  status(): GameStatus;
  visible(): boolean;
  show(): void;
  hide(): void;
  ignoresMouse(): boolean; // clicks pass through the window
  hubWin(): BrowserWindow | null; // the Games and Settings window, while it is open
  hubTab(): 'games' | 'settings'; // the tab it shows (or showed last)
  catalog?: CatalogSmoke; // for the catalog run
}

// What the game's checks get: the same tools the shell's checks use.
export interface SmokeKit<S extends ShellSettings> extends SmokeContext<S> {
  mode: SmokeMode;
  check(name: string, ok: unknown, detail?: unknown): void;
  wait(ms: number): Promise<void>;
  until(fn: () => Promise<boolean> | boolean, ms?: number): Promise<boolean>;
  js<T = any>(code: string): Promise<T>;
  shot(name: string): Promise<void>; // the window as it is (the orb's shape alone while in the corner)
  shots(name: string): Promise<void>; // the same twice: <name>-dark and <name>-light
  gjs<T = any>(code: string): Promise<T>; // run in the Games and Settings window's page (rejects while it is closed)
  gamesReady(): Promise<boolean>; // that window is open on its Games tab and shows the games
  gamesShot(name: string): Promise<void>; // that window as it is
  sjs<T = any>(code: string): Promise<T>; // the same as gjs, for the Settings tab's helpers
  settingsReady(): Promise<boolean>; // that window is open on its Settings tab and shows the sheet
  settingsShot(name: string): Promise<void>; // that window as it is
  hubShots(name: string): Promise<void>; // that window twice: <name>-dark and <name>-light
  docked(dock: 'tl' | 'tr' | 'bl' | 'br', w: number, h: number): boolean;
  transcript(usage: Record<string, number>, id: string): void; // append a real Claude Code transcript line
  note(key: string, value: unknown): void; // a measurement for the result file (the perf run prints them)
  cpu(ms: number): Promise<CpuUse>; // the app's CPU use over the next `ms`, per kind of process, in % of one core
}

export type SmokeMode = 'full' | 'reopen' | 'catalog' | 'catalog-game' | 'published' | 'perf';
export interface CpuUse { main: number; renderer: number; gpu: number; other: number; total: number }

// A game's own checks. full() runs popped out, in the small window at the bottom right; reset() after Reset to
// defaults; leave() before the full run quits (change settings to look for after the restart, save); reopen() in the
// second run, popped out. perf() is the whole of a perf run (smoke.mjs --perf), started in the corner as the settings say.
// catalog says how to see the game playing once it is packed as a catalog game (catalog/, the catalog-game run).
export interface GameSmoke<S extends ShellSettings> {
  full?(k: SmokeKit<S>): Promise<void>;
  reset?(k: SmokeKit<S>): Promise<void>;
  leave?(k: SmokeKit<S>): Promise<void>;
  reopen?(k: SmokeKit<S>): Promise<void>;
  perf?(k: SmokeKit<S>): Promise<void>;
  catalog?: CatalogGameChecks;
}

interface Check { name: string; ok: boolean; detail?: string }

export async function runSmoke<S extends ShellSettings>(c: SmokeContext<S>, game: GameSmoke<S> = {}): Promise<void> {
  const m = process.env.TG_SMOKE_MODE;
  const mode: SmokeMode = m === 'reopen' || m === 'catalog' || m === 'catalog-game' || m === 'published' || m === 'perf' ? m : 'full';
  const checks: Check[] = [], notes: Record<string, unknown> = {};
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
    // pointing at the circle, the whole corner window, so its name tag shows beside it
    if (sh && c.state() !== 'hover') {
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
  const note = (key: string, value: unknown) => { notes[key] = value; };
  const cpu = async (ms: number): Promise<CpuUse> => {
    app.getAppMetrics(); // Electron measures each process's CPU since the previous call
    await wait(ms);
    const u: CpuUse = { main: 0, renderer: 0, gpu: 0, other: 0, total: 0 };
    for (const p of app.getAppMetrics()) {
      const v = p.cpu.percentCPUUsage, t = p.type === 'Browser' ? 'main' : p.type === 'Tab' ? 'renderer' : p.type === 'GPU' ? 'gpu' : 'other';
      u[t] += v; u.total += v;
    }
    for (const key of Object.keys(u) as (keyof CpuUse)[]) u[key] = Math.round(u[key] * 10) / 10;
    return u;
  };
  // the Games and Settings window: one page, two tabs, each with its own helpers
  const gjs = <T = any>(code: string): Promise<T> => {
    const w = c.hubWin();
    return w ? w.webContents.executeJavaScript(code) : Promise.reject(new Error('the Games and Settings window is not open'));
  };
  const sjs = gjs;
  const shown = (tab: string) => gjs<boolean>(`!!window.hubTest && hubTest.tab() === ${JSON.stringify(tab)}`).catch(() => false);
  const gamesReady = () => until(async () => c.hubTab() === 'games' && await shown('games') && await gjs<boolean>('!!window.gamesTest && !!gamesTest.view()').catch(() => false), 8000);
  const settingsReady = () => until(async () => c.hubTab() === 'settings' && await shown('settings')
    && await gjs<boolean>('!!window.settingsTest && settingsTest.has("#tg-reducedMotion")').catch(() => false), 8000);
  const hubShot = async (name: string) => {
    await wait(300);
    const w = c.hubWin();
    if (w) fs.writeFileSync(path.join(c.outDir, name + '.png'), (await w.webContents.capturePage()).toPNG());
  };
  const hubDark = () => gjs<boolean>('hubTest.look().dark').catch(() => null);
  const hubShots = async (name: string) => {
    const was = nativeTheme.themeSource;
    nativeTheme.themeSource = 'dark';
    await until(async () => (await hubDark()) === true, 2000);
    await hubShot(name + '-dark');
    nativeTheme.themeSource = 'light';
    await until(async () => (await hubDark()) === false, 2000);
    await hubShot(name + '-light');
    nativeTheme.themeSource = was;
    await until(async () => (await hubDark()) === nativeTheme.shouldUseDarkColors, 2000);
  };
  const k: SmokeKit<S> = { ...c, mode, check, wait, until, js, shot, shots, gjs, gamesReady, gamesShot: hubShot, sjs, settingsReady, settingsShot: hubShot, hubShots, docked, transcript, note, cpu };

  // the window sits in the orb's corner and the page shows this shape at its size
  const inCorner = () => same(c.win.getBounds(), orbWindowBounds(c.geo()));
  const shows = async (sh: Shape) => {
    const s = shapeSize(sh, c.geo());
    return until(async () => { const p = await page(); return shapeOf(p.shown) === sh && p.shape.w === s.width && p.shape.h === s.height; }, 3000);
  };
  const labels = (items: TrayItem[]): string[] => items.flatMap((i) => [i.label || '', ...(i.submenu ? labels(i.submenu) : [])]);
  const lit = () => c.trayItems().filter((i) => i.type === 'radio' && i.checked && !i.submenu).map((i) => i.label || '');
  const settled = (st: ShellState) => until(() => c.state() === st, 3000);

  try {
    fs.mkdirSync(c.outDir, { recursive: true });
    nativeTheme.themeSource = 'dark';
    if (c.win.webContents.isLoading()) await new Promise<void>((r) => { c.win.webContents.once('did-finish-load', () => r()); });
    check('the page loads with its test hooks', await until(() => js('!!window.shellTest && !!window.gameTest')));

    if (mode === 'perf') {
      if (game.perf) await game.perf(k);
      else check('the game has a perf run', false);
      return;
    }

    if (mode === 'catalog' || mode === 'catalog-game' || mode === 'published') {
      if (c.catalog) await (mode === 'catalog' ? catalogSmoke(k, c.catalog) : mode === 'catalog-game' ? catalogGameSmoke(k, c.catalog, game.catalog) : publishedSmoke(k, c.catalog));
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
    check('the menu: Circle, Card and Window, Games…, Settings…, the Window and Circle corner menus, Hide and Quit', ['Circle', 'Card', 'Window', 'Games…', 'Settings…',
      'Small (320 × 180)', 'Full screen', 'Always on top', 'Click-through', 'Top left', 'Bottom right'].every((l) => items.includes(l))
      && items.some((l) => l.startsWith('Hide ')) && items.some((l) => l.startsWith('Quit ')) && !items.includes('Pop out') && !items.includes('Reset to defaults'), items);
    check('the menu lights Circle', lit().join() === 'Circle', lit());
    const bare = `(() => { const card = getComputedStyle(document.querySelector('.tg-card'));
      return { orbButtons: [...document.querySelectorAll('.tg-orb button')].filter((b) => !b.closest('.tg-root')).length, opacity: parseFloat(card.opacity), events: card.pointerEvents }; })()`;
    const hidden = async () => { const b = await js<{ orbButtons: number; opacity: number; events: string }>(bare); return b.orbButtons === 0 && b.opacity < 0.01 && b.events === 'none'; };
    check('the circle has no buttons, and the card\'s are out of sight', await until(hidden), await js(bare));

    c.dispatch('enter');
    check('pointing at the circle shows its name tag beside it, the circle keeps its size', await shows('orb') && await until(async () => (await page()).tagShown)
      && /Click to open/.test((await page()).tag) && (await page()).tag.length > 20, await page());
    const tr = await js<{ x: number; y: number; w: number; h: number; W: number; H: number; ox: number }>(`(() => { const r = document.getElementById('tg-tag').getBoundingClientRect(),
      o = document.querySelector('.tg-orb').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, W: innerWidth, H: innerHeight, ox: o.x }; })()`);
    check('…inside the window, on the screen side of the circle, never over it', tr.x >= 0 && tr.y >= 0 && tr.x + tr.w <= tr.W && tr.y + tr.h <= tr.H && tr.x + tr.w <= tr.ox, tr);
    await shots('orb-hover');
    c.dispatch('leave');
    check('moving away hides the tag', await shows('orb') && await until(async () => !(await page()).tagShown));
    let mc = c.menus();
    await js('shellTest.rightClick(".tg-orb")');
    check('a right-click on the circle opens the menu', await until(() => c.menus() === mc + 1) && c.state() === 'orb', c.menus());

    await js('shellTest.clickOrb()');
    check('a click opens the card', await shows('card') && (await page()).scale === 'expanded' && /tg-big/.test((await page()).rootIn), await page());
    check('open, the window takes the clicks', !c.ignoresMouse());
    check('the card shows the game big', (await page()).root.w > 380, (await page()).root);
    await shots('orb-expanded');
    await sizeSwitch(k, 'the card', 'card');
    check('the menu lights Card', lit().join() === 'Card', lit());
    mc = c.menus();
    await js('shellTest.rightClick(".tg-big")');
    check('a right-click on the game in the card opens the menu, the card stays open', await until(() => c.menus() === mc + 1) && c.state() === 'expanded');
    await settingsWindow(k, 'the card', 'tg-card-settings', 'settings-window');
    await gamesWindow(k, 'the card', 'tg-card-games', 'games-window');
    // Settings → Games: a line about the games, the developer switch, any request waiting, and Open Games… for the window
    await js('shellTest.click("tg-card-settings")');
    await k.settingsReady();
    const sum = await k.sjs<string>('settingsTest.text()');
    check('Settings → Games sums the games up, with the developer switch off, and offers Open Games…', /Playing/.test(sum) && /Open Games…/.test(sum) && !/Check for games/.test(sum)
      && /Show developer and unapproved games/.test(sum) && (await k.sjs('settingsTest.value("#tg-developer")')) === false, sum);
    const one = c.hubWin();
    await k.sjs(`settingsTest.click('[data-games="open"]')`);
    check('Open Games… switches the same window to its Games tab, never a second one', await k.gamesReady() && c.hubWin()?.id === one?.id && hubWindows() === 1
      && await until(async () => !(await page()).panelOpen, 3000), hubWindows());
    await k.gjs('gamesTest.key("w", true)');
    check('Cmd+W closes the Games and Settings window', await until(async () => !c.hubWin() && !(await page()).panelOpen));
    await hubTabs(k);
    await js('shellTest.click("tg-card-circle")');
    check('the switch\'s Circle folds the card back into the circle', await shows('orb') && c.ignoresMouse());

    // the keys: 2 opens the card, Esc and 1 fold it, G opens Games, H and the shortcut hide and show
    await js('shellTest.key("2")');
    check('2 opens the card', await shows('card'));
    await js('shellTest.key("Escape")');
    check('Esc in the card folds it into the circle', await shows('orb') && c.state() === 'orb');
    await js('shellTest.key("2")');
    await shows('card');
    await js('shellTest.key("1")');
    check('1 folds it too', await shows('orb'));
    await js('shellTest.key("g")');
    check('G opens the window on Games', await k.gamesReady());
    await k.gjs('gamesTest.key("w", true)');
    await until(() => !c.hubWin());
    c.dispatch('toggle');
    await shows('card');
    c.hotkey();
    check('the shortcut hides the game, folding the card', await until(() => !c.visible()) && c.state() === 'orb');
    c.hotkey();
    check('…and shows it again, in the circle', await until(() => c.visible()) && c.state() === 'orb' && await shows('orb'));
    await js('shellTest.key("h")');
    check('H hides it too', await until(() => !c.visible()));
    c.tray({ do: 'size', to: 'card' });
    check('hidden, the menu\'s Card shows it as the card', await until(() => c.visible()) && await shows('card'));
    await js('shellTest.key("Escape")');
    await shows('orb');

    // the tray's Games… and Settings… open the one window on their tab and leave the orb in its corner
    check('the tray offers Games… next to Settings…', labels(c.trayItems()).join('|').includes('Games…|Settings…'), labels(c.trayItems()));
    c.tray({ do: 'games' });
    check('the tray\'s Games… opens the window on Games, the orb stays in its corner', await k.gamesReady() && c.state() === 'orb' && inCorner() && c.visible(), c.state());
    const tw = c.hubWin();
    c.tray({ do: 'settings' });
    check('the tray\'s Settings… switches the same window to Settings', await k.settingsReady() && c.hubWin()?.id === tw?.id && hubWindows() === 1 && (await page()).panelOpen);
    c.tray({ do: 'games' });
    check('the tray\'s Games… switches it back to Games', await k.gamesReady() && c.hubWin()?.id === tw?.id && await until(async () => !(await page()).panelOpen, 3000));
    await k.gjs('document.getElementById("gw-close").click()');
    check('the window\'s Close button closes it', await until(() => !c.hubWin()));

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
    await js('shellTest.click("tg-card-window")');
    check('the switch\'s Window flies it into the floating window', await settled('popped') && docked('br', 320, 180), { state: c.state(), bounds: c.win.getBounds() });
    check('…and remembers it', c.store.get().presentation === 'floating');
    check('the page shows the window, the game under the 40 px bar', await until(async () => { const p = await page(); return p.shown === 'popped' && /tg-host/.test(p.rootIn) && p.topInset === 40; }), await page());
    check('popped out, the window takes the clicks', !c.ignoresMouse());
    check('the menu lights Window, and offers Full screen', lit().join() === 'Window' && labels(c.trayItems()).includes('Full screen'), lit());
    await sizeSwitch(k, 'the window', 'window');
    const fit = await js<{ name: string; lbl: string; right: number; W: number }>(`(() => ({ name: getComputedStyle(document.querySelector('.tg-bar .tg-name')).display,
      lbl: getComputedStyle(document.querySelector('#tg-win-games .tg-lbl')).display, right: document.getElementById('tg-win-window').getBoundingClientRect().right, W: innerWidth }))()`);
    check('the small window shows icons only, and the whole switch fits', (await page()).narrow && fit.name === 'none' && fit.lbl === 'none' && fit.right <= fit.W, fit);
    mc = c.menus();
    await js('shellTest.rightClick(".tg-host")');
    check('a right-click on the game in the window opens the menu', await until(() => c.menus() === mc + 1) && c.state() === 'popped');
    await shot('window-small');
    await gamesWindow(k, 'the window', 'tg-win-games');
    await settingsWindow(k, 'the window', 'tg-win-settings');

    await game.full?.(k);

    // the window's own controls: sizes, the grip, click-through, full screen, opacity, on top, dock
    if (c.state() !== 'popped') { c.dispatch('pop'); await settled('popped'); }
    c.tray({ do: 'set', patch: { size: 'large' } });
    check('the menu\'s Window → Large makes it large (640 × 360) in its corner', await until(() => docked(c.store.get().dock as 'br', 640, 360)), c.win.getBounds());
    check('the game follows the window size', await until(async () => (await page()).root.w === 640));
    check('large, the bar shows the labels again', await until(async () => !(await page()).narrow));
    c.update({ dock: 'br' } as Partial<S>);
    await until(() => docked('br', 640, 360));
    const b0 = c.win.getBounds();
    c.resize({ phase: 'start', x: b0.x, y: b0.y });
    c.resize({ phase: 'move', x: b0.x - 160, y: b0.y - 90 });
    c.resize({ phase: 'end', x: b0.x - 160, y: b0.y - 90 });
    const s1 = c.store.get();
    check('the grip resizes at 16:9 and remembers the size', s1.size === 'custom' && s1.width === 800 && docked('br', 800, 450), c.win.getBounds());
    c.tray({ do: 'set', patch: { clickThrough: true } });
    check('the menu\'s Click-through turns it on', await until(async () => c.store.get().clickThrough && (await page()).thru && c.ignoresMouse()));
    check('…and shows it ticked', c.trayItems().flatMap((i) => i.submenu || [i]).some((i) => i.label === 'Click-through' && i.checked));
    c.tray({ do: 'set', patch: { clickThrough: false } });
    check('…and off again', await until(() => !c.store.get().clickThrough && !c.ignoresMouse()));
    c.hotkey();
    check('popped out, the shortcut hides the window…', await until(() => !c.visible()) && c.state() === 'popped');
    c.hotkey();
    check('…and shows it again, still the window', await until(() => c.visible()) && c.state() === 'popped' && docked('br', 800, 450));
    await js('shellTest.key("f")');
    const d = screen.getDisplayMatching(c.win.getBounds()).bounds;
    check('F fills the screen', await until(() => { const b = c.win.getBounds(); return c.isFullscreen() && b.width === d.width && b.height === d.height; }), c.win.getBounds());
    check('the bar keeps its 40 px in full screen, and the menu offers Leave full screen', (await page()).topInset === 40 && labels(c.trayItems()).includes('Leave full screen'));
    await js('shellTest.key("Escape")');
    check('Esc leaves full screen, and only that', await until(() => !c.isFullscreen() && docked('br', 800, 450)) && c.state() === 'popped', c.win.getBounds());
    c.tray({ do: 'fullscreen' });
    check('the menu\'s Full screen fills it too', await until(() => c.isFullscreen()));
    c.tray({ do: 'fullscreen' });
    await until(() => !c.isFullscreen() && docked('br', 800, 450));
    c.update({ opacity: 0.6, alwaysOnTop: false } as Partial<S>);
    check('opacity and always-on-top apply to the window', Math.abs(c.win.getOpacity() - 0.6) < 0.02 && !c.win.isAlwaysOnTop());
    c.update({ opacity: 1, alwaysOnTop: true, dock: 'tl' } as Partial<S>);
    check('docking moves it to the chosen corner', docked('tl', 800, 450) && c.win.isAlwaysOnTop(), c.win.getBounds());

    // ---------- back: Esc goes one size down, the switch's Circle all the way ----------
    await shot('steps-1-window');
    await js('shellTest.key("Escape")');
    check('Esc in the window brings it back to the card in the circle\'s corner', await settled('expanded') && inCorner() && await shows('card')
      && c.store.get().presentation === 'orb', { state: c.state(), bounds: c.win.getBounds() });
    check('…the game in the card, the switch lighting Card', /tg-big/.test((await page()).rootIn) && (await page()).size.join() === 'tg-card-card,tg-win-card', await page());
    await shot('steps-2-esc-card');
    await js('shellTest.key("Escape")');
    check('Esc in the card folds it into the circle', await shows('orb') && c.state() === 'orb');
    await shot('steps-3-esc-circle');
    await js('shellTest.key("3")');
    check('3 goes straight from the circle to the window where it was', await settled('popped') && docked('tl', 800, 450), c.win.getBounds());
    c.update({ clickThrough: true } as Partial<S>);
    await js('shellTest.click("tg-win-circle")');
    check('the window\'s Circle flies it home', await settled('orb') && inCorner() && c.store.get().presentation === 'orb', { state: c.state(), bounds: c.win.getBounds() });
    check('…the page shows the orb again, the game in its eye', await shows('orb') && /tg-eye/.test((await page()).rootIn));
    check('…in the corner the window is on top and opaque, and click-through stays with the floating window', c.win.isAlwaysOnTop() && c.win.getOpacity() === 1 && c.ignoresMouse());
    await js('shellTest.clickOrb()');
    check('…and the orb still opens although the floating window was click-through', await shows('card') && !c.ignoresMouse());
    await js('shellTest.key("Escape")');
    await shows('orb');
    check('the floating window keeps its own settings', c.store.get().dock === 'tl' && c.store.get().width === 800 && c.store.get().clickThrough, c.store.get());
    c.update({ clickThrough: false } as Partial<S>);

    // the menu's sizes, and reduced motion: no flight
    c.tray({ do: 'size', to: 'window' });
    check('the menu\'s Window pops it out', await settled('popped') && c.store.get().presentation === 'floating');
    c.update({ reducedMotion: true } as Partial<S>);
    c.dispatch('dock');
    check('with reduced motion it docks at once', c.state() === 'orb');
    c.dispatch('pop');
    check('…pops out at once', c.state() === 'popped');
    c.dispatch('card');
    check('…and goes back to the card at once', c.state() === 'expanded');
    c.dispatch('pop');
    c.update({ reducedMotion: false } as Partial<S>);

    // ---------- reset ----------
    c.update({ corner: 'tl' } as Partial<S>);
    await until(async () => (await page()).shown === 'popped');
    await js('shellTest.key(",")');
    await k.settingsReady();
    await k.sjs('settingsTest.click("#tg-reset")');
    check('Reset to defaults brings the game home and the defaults back', await settled('orb') && await until(() => {
      const s = c.store.get();
      return s.presentation === 'orb' && s.corner === 'br' && s.display === null && s.size === 'small' && s.dock === 'br' && !s.reducedMotion && !s.clickThrough && s.opacity === 1;
    }) && await until(() => inCorner() && c.geo().corner === 'br'), c.store.get());
    await k.sjs('settingsTest.key("Escape")').catch(() => undefined);
    await until(() => !c.hubWin());
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
    fs.writeFileSync(path.join(c.outDir, `result-${mode}.json`), JSON.stringify({ ok: checks.every((x) => x.ok), checks, notes }, null, 2));
    app.quit();
  }
}

const same = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

// The size switch in the card or the window's bar: Circle, Card and Window, in that order at the far right, each a
// real button with a tooltip and an accessible name, the current size lit and marked aria-current.
async function sizeSwitch<S extends ShellSettings>(c: SmokeKit<S>, where: string, now: 'card' | 'window'): Promise<void> {
  const w = now === 'card' ? 'card' : 'win';
  const ids = ['circle', 'card', 'window'].map((z) => `tg-${w}-${z}`);
  const ls = await c.js<({ aria: string; title: string; current: string | null } | null)[]>(`[${ids.map((i) => `shellTest.label(${JSON.stringify(i)})`).join(',')}]`);
  c.check(`${where}: the switch has Circle, Card and Window, each with a tooltip and an accessible name`, ls.every((l) => !!l && !!l.title && !!l.aria)
    && /circle/i.test(ls[0]!.aria) && /card/i.test(ls[1]!.aria) && /window/i.test(ls[2]!.aria) && /\(1\)/.test(ls[0]!.title) && /\(3\)/.test(ls[2]!.title), ls);
  const lit = ls.map((l) => l?.current === 'true');
  c.check(`${where}: ${now === 'card' ? 'Card' : 'Window'} is lit, and only that`, lit.join() === [false, now === 'card', now === 'window'].join(), ls);
  const order = await c.js<{ x: number; right: number; W: number; games: number; sets: number }>(`(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect(), bar = document.getElementById(${JSON.stringify(ids[2])}).closest('.tg-cbar, .tg-bar').getBoundingClientRect();
    return { x: [${ids.map((i) => `r(${JSON.stringify(i)}).x`).join(',')}].every((x, n, a) => n === 0 || x > a[n - 1]) ? 1 : 0, right: bar.right - r(${JSON.stringify(ids[2])}).right, W: bar.width,
      games: r('tg-${w}-games').x, sets: r('tg-${w}-settings').x }; })()`);
  c.check(`${where}: Games and Settings, then the switch at the far right`, order.x === 1 && order.right >= 0 && order.right < 16 && order.games < order.sets, order);
}

// How many Games and Settings windows there are: never more than one.
const hubWindows = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().endsWith('/hub.html')).length;

// What the window's page is given: no Node (no require, process, module or Buffer), nothing of the preload but the bridge
// it exposes (window.tokenHub), and on it only the catalog, tab and Settings calls.
async function isolated<S extends ShellSettings>(c: SmokeKit<S>, where: string): Promise<void> {
  const env = await c.gjs<Record<string, string>>(`({ require: typeof require, process: typeof process, module: typeof module, buffer: typeof Buffer,
    ipc: typeof window.ipcRenderer, shell: typeof window.tokenShell, games: typeof window.tokenGames, settings: typeof window.tokenSettings,
    api: Object.keys(window.tokenHub).sort().join(',') })`);
  c.check(`${where}: its page is isolated and sandboxed, with only the catalog, tab and Settings calls (window.tokenHub)`, env.require === 'undefined'
    && env.process === 'undefined' && env.module === 'undefined' && env.buffer === 'undefined' && env.ipc === 'undefined' && env.shell === 'undefined'
    && env.games === 'undefined' && env.settings === 'undefined' && env.api === 'boot,close,games,gamesDo,input,onGames,onSnap,onTab,tab', env);
}

// The page's background in the shell's quiet colours, dark or light with the system like the orb.
const hubBack = (dark: boolean) => (dark ? 'rgb(23, 24, 27)' : 'rgb(243, 242, 238)');

// The Games button next to Settings (in the card, or the window's title bar) opens the Games and Settings window on its
// Games tab: a normal window of its own, centred on the game's display, isolated like the shell's page, with the catalog
// in large type. The game stays as it was. Games again brings the same window forward; Esc closes it.
async function gamesWindow<S extends ShellSettings>(c: SmokeKit<S>, where: string, button: string, shotName?: string): Promise<void> {
  const { check, until, js, gjs } = c;
  const before = { state: c.state(), visible: c.visible(), bounds: c.win.getBounds() };
  const shown = (sel: string) => js<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0; })()`);
  check(`${where}: a Games button sits next to Settings`, await shown('#' + button) && await js<boolean>(`document.getElementById(${JSON.stringify(button)}).textContent === 'Games'`));
  await js(`shellTest.click(${JSON.stringify(button)})`);
  check(`${where}: Games opens the window on its Games tab`, await c.gamesReady());
  const g = c.hubWin();
  if (!g) return;
  const area = screen.getDisplayMatching(c.win.getBounds()).workArea, want = gamesWindowBounds(area), b = g.getBounds(), min = g.getMinimumSize();
  check(`${where}: it is centred on the game's display, about 960 × 680 and inside the work area`, same(b, want), { bounds: b, want, area });
  check(`${where}: a normal window: resizable, a minimum size, a title bar named after the tab`, g.isResizable() && min[0] === Math.min(GAMES_WINDOW.minWidth, area.width)
    && min[1] === Math.min(GAMES_WINDOW.minHeight, area.height) && g.getContentBounds().height < b.height && await until(() => /^Games · /.test(g.getTitle()), 2000),
  { min, content: g.getContentBounds(), title: g.getTitle() });
  await isolated(c, where);
  const text = await gjs<string>('gamesTest.text()');
  check(`${where}: it lists the games (the built-in one playing) and Check for games`, /Playing/.test(text) && /built in/i.test(text) && /Check for games/.test(text), text.slice(0, 400));
  const look = await gjs<{ name: number; desc: number; button: number; cards: number; icons: number; back: string }>('gamesTest.look()');
  const dark = await gjs<boolean>('hubTest.look().dark');
  check(`${where}: game cards in large type on the page in the system's light or dark, with the game's icon`, look.name >= 16 && look.desc >= 14 && look.button >= 14
    && look.cards >= 1 && look.icons >= 1 && look.back === hubBack(dark), { look, dark });
  check(`${where}: the game stays as it was: same mode, same place, still shown, Settings not showing`, c.state() === before.state && c.visible() === before.visible
    && same(c.win.getBounds(), before.bounds) && !(await js<boolean>('shellTest.state().panelOpen')), { state: c.state(), before });
  if (shotName) await c.hubShots(shotName);
  await js(`shellTest.click(${JSON.stringify(button)})`);
  await c.wait(300);
  check(`${where}: Games again brings the same window forward, never a second one`, c.hubWin()?.id === g.id && hubWindows() === 1, hubWindows());
  await gjs('gamesTest.key("Escape")');
  check(`${where}: Esc closes the window, the game still there`, await until(() => !c.hubWin()) && c.state() === before.state && c.visible() === before.visible);
}

// Settings (the button next to Games, the gear in the window's title bar, the , key, the tray's Settings…) opens the
// same window on its Settings tab, showing the game page's Settings sheet in large type. Clicks and sliders there change
// the real settings. Settings again brings the same window forward; Esc, Cmd+W, its Close button and the sheet's own
// Close each close it. The game stays where it was.
async function settingsWindow<S extends ShellSettings>(c: SmokeKit<S>, where: string, button: string, shotName?: string): Promise<void> {
  const { check, until, js, sjs } = c;
  const before = { state: c.state(), visible: c.visible(), bounds: c.win.getBounds() };
  const open = () => js<boolean>('shellTest.state().panelOpen');
  const stays = () => c.state() === before.state && c.visible() === before.visible && same(c.win.getBounds(), before.bounds);
  const closed = () => until(async () => !c.hubWin() && !(await open()), 3000);
  check(`${where}: a Settings button sits next to Games`, await js<boolean>(`(() => { const e = document.getElementById(${JSON.stringify(button)}); return !!e && e.getClientRects().length > 0; })()`));
  await js(`shellTest.click(${JSON.stringify(button)})`);
  check(`${where}: Settings opens the window on its Settings tab`, await c.settingsReady() && await open());
  const w = c.hubWin();
  if (!w) return;
  const area = screen.getDisplayMatching(c.win.getBounds()).workArea, want = gamesWindowBounds(area), b = w.getBounds(), min = w.getMinimumSize();
  check(`${where}: it is centred on the game's display, about 960 × 680, inside the work area`, same(b, want), { bounds: b, want, area });
  check(`${where}: a normal window: resizable, a minimum size, a title bar named after the tab`, w.isResizable() && min[0] === Math.min(GAMES_WINDOW.minWidth, area.width)
    && min[1] === Math.min(GAMES_WINDOW.minHeight, area.height) && w.getContentBounds().height < b.height && await until(() => /^Settings · /.test(w.getTitle()), 2000),
  { min, title: w.getTitle() });
  await isolated(c, where);
  const text = await sjs<string>('settingsTest.text()');
  check(`${where}: it shows Display (the circle's corner, the window), Games with the developer switch, and Reset`, /Circle corner/.test(text)
    && /Window size/.test(text) && /Click-through/.test(text) && /Show developer and unapproved games/.test(text) && /Reset to defaults/.test(text), text.slice(0, 600));
  const look = await sjs<{ body: number; back: string; sections: number }>('settingsTest.look()');
  const dark = await sjs<boolean>('hubTest.look().dark');
  check(`${where}: in large type on the page in the system's light or dark`, look.body >= 15 && look.back === hubBack(dark) && look.sections >= 2, { look, dark });
  check(`${where}: the game stays as it was: same mode, same place, still shown`, stays(), { state: c.state(), before });

  // what the player does in the window happens in the game's real settings, and the window follows
  const rm = c.store.get().reducedMotion;
  await sjs('settingsTest.click("#tg-reducedMotion")');
  check(`${where}: a click on Reduced motion in the window changes the setting`, await until(async () => c.store.get().reducedMotion === !rm
    && (await sjs('settingsTest.value("#tg-reducedMotion")')) === !rm, 3000), c.store.get().reducedMotion);
  await sjs('settingsTest.click("#tg-reducedMotion")');
  await until(() => c.store.get().reducedMotion === rm, 3000);
  const op = c.store.get().opacity;
  await sjs('settingsTest.slide("#tg-opacity", 60)');
  check(`${where}: moving the Opacity slider in the window changes the setting`, await until(() => c.store.get().opacity === 0.6, 3000)
    && await until(async () => /60%/.test(await sjs<string>('settingsTest.text()')), 3000), c.store.get().opacity);
  await sjs(`settingsTest.slide("#tg-opacity", ${Math.round(op * 100)})`);
  await until(() => c.store.get().opacity === op, 3000);
  if (shotName) { await sjs('document.activeElement.blur(); scrollTo(0, 0)'); await c.hubShots(shotName); }

  await js(`shellTest.click(${JSON.stringify(button)})`);
  await c.wait(300);
  check(`${where}: Settings again brings the same window forward, never a second one`, c.hubWin()?.id === w.id && hubWindows() === 1 && await open(), hubWindows());
  await sjs('settingsTest.key("Escape")');
  check(`${where}: Esc closes the window, the game still there`, await closed() && stays());
  for (const [how, code] of [['Cmd+W', 'settingsTest.key("w", true)'], ['its Close button', 'document.getElementById("gw-close").click()'],
    ['the sheet\'s own Close', 'settingsTest.click("#tg-close")']] as const) {
    await js('shellTest.key(",")');
    await c.settingsReady();
    await sjs(code);
    check(`${where}: , opens it again and ${how} closes it`, await closed() && stays());
  }
  c.tray({ do: 'settings' });
  check(`${where}: the tray's Settings… opens it too, the game where it was`, await c.settingsReady() && stays());
  await sjs('settingsTest.key("Escape")');
  await closed();
}

// The two tabs: real buttons in a tablist, one selected at a time, each showing its own panel. Every way in opens the
// one window on its tab and, while it is open, switches the same window to that tab; Cmd+1 and Cmd+2, the arrow keys
// on a tab and Cmd+, switch from the keyboard. The game's page hears Settings show only while that tab shows. Nothing
// is remembered between opens beyond the tab asked for. Starts and ends with the window closed, in the card.
async function hubTabs<S extends ShellSettings>(c: SmokeKit<S>): Promise<void> {
  const { check, until, js, gjs } = c;
  type Tab = { tab: string; tag: string; role: string; name: string; selected: string; controls: string; tabIndex: number; shown: boolean };
  const tabs = () => gjs<Tab[]>('hubTest.tabs()');
  const panel = () => js<boolean>('shellTest.state().panelOpen');
  // the window shows this tab and only this one, and the main process and the game's page agree
  const on = (t: 'games' | 'settings') => until(async () => {
    const ts = await tabs().catch(() => null);
    return !!ts && c.hubTab() === t && ts.every((x) => (x.tab === t) === (x.selected === 'true') && (x.tab === t) === x.shown && (x.tab === t) === (x.tabIndex === 0))
      && (await panel()) === (t === 'settings');
  }, 3000);
  await js('shellTest.click("tg-card-settings")');
  check('tabs: Settings opens the window on its Settings tab', await c.settingsReady() && await on('settings'));
  const w = c.hubWin();
  if (!w) return;
  const ts = await tabs();
  check('tabs: two real buttons, Games then Settings, with the tab role and the panel each controls', ts.length === 2 && ts.every((t) => t.tag === 'BUTTON' && t.role === 'tab')
    && ts[0].name === 'Games' && ts[1].name === 'Settings' && ts[0].controls === 'hw-games' && ts[1].controls === 'hw-settings', ts);
  check('tabs: in a tablist with an accessible name, each panel labelled by its tab', await gjs<boolean>(`(() => { const l = document.querySelector('[role=tablist]');
    return !!l && l.getAttribute('aria-label') === 'Games and Settings' && [...document.querySelectorAll('[role=tabpanel]')].every((p) => document.getElementById(p.getAttribute('aria-labelledby')).getAttribute('aria-controls') === p.id); })()`));
  const look = await gjs<{ on: string; off: string; line: string }>('hubTest.look()');
  check('tabs: the active tab stands out: brighter ink and a line under it', look.on !== look.off && look.line !== 'rgba(0, 0, 0, 0)', look);
  const one = () => c.hubWin()?.id === w.id && hubWindows() === 1;

  // every way in, while it is open, switches the same window
  await js('shellTest.click("tg-card-games")');
  check('tabs: the Games button switches the open window to Games, the same window', await c.gamesReady() && await on('games') && one(), hubWindows());
  check('tabs: the title follows the tab', await until(() => /^Games · /.test(w.getTitle()), 2000), w.getTitle());
  await js('shellTest.click("tg-card-settings")');
  check('tabs: the Settings button switches it back to Settings, the same window', await c.settingsReady() && await on('settings') && one());
  check('tabs: …and the title follows', await until(() => /^Settings · /.test(w.getTitle()), 2000), w.getTitle());
  await js('shellTest.click("tg-card-games")');
  await on('games');
  await js('shellTest.key(",")');
  check('tabs: , switches the open window to Settings', await on('settings') && one());

  // the tabs themselves, by mouse and by keyboard
  await gjs('hubTest.click("games")');
  check('tabs: a click on Games shows the Games tab and the game\'s page stops mirroring Settings', await on('games') && one());
  await gjs('hubTest.click("settings")');
  check('tabs: a click on Settings shows the sheet again', await on('settings') && await c.settingsReady());
  await gjs('hubTest.key("1", true)');
  check('tabs: Cmd+1 picks Games', await on('games'));
  await gjs('hubTest.key("2", true)');
  check('tabs: Cmd+2 picks Settings', await on('settings'));
  await gjs('hubTest.key("1", true)');
  await on('games');
  await gjs('hubTest.key(",", true)');
  check('tabs: Cmd+, in the window picks Settings', await on('settings'));
  await gjs('hubTest.focus("settings")');
  await gjs('hubTest.key("ArrowLeft")');
  check('tabs: ← on a focused tab picks the one before, and the focus moves with it', await on('games') && (await gjs('hubTest.focused()')) === 'games');
  await gjs('hubTest.key("ArrowRight")');
  check('tabs: → picks the next one', await on('settings') && (await gjs('hubTest.focused()')) === 'settings');
  await gjs('hubTest.key("ArrowRight")');
  check('tabs: → on the last wraps to the first', await on('games') && (await gjs('hubTest.focused()')) === 'games');
  await gjs('hubTest.key("End")');
  check('tabs: End picks the last tab', await on('settings'));
  await gjs('hubTest.key("Home")');
  check('tabs: Home picks the first tab', await on('games'));
  await gjs('hubTest.click("settings")');
  await on('settings');
  await c.settingsReady();
  await gjs('document.querySelector("#tg-opacity").focus()');
  await gjs('hubTest.key("ArrowLeft")');
  await c.wait(200);
  check('tabs: arrows on a slider move the slider, not the tabs', c.hubTab() === 'settings' && (await gjs('hubTest.tab()')) === 'settings');
  await gjs('document.activeElement.blur()');

  // closed on Settings, the next Games opens on Games: nothing is remembered beyond the tab asked for
  await gjs('hubTest.key("Escape")');
  check('tabs: Esc closes the window from either tab', await until(async () => !c.hubWin() && !(await panel()), 3000));
  await js('shellTest.click("tg-card-games")');
  check('tabs: closed on Settings, Games opens it on Games', await c.gamesReady() && await on('games'));
  await gjs('hubTest.key("w", true)');
  await until(() => !c.hubWin());
  await js('shellTest.click("tg-card-settings")');
  check('tabs: closed on Games, Settings opens it on Settings', await c.settingsReady() && await on('settings'));
  await gjs('hubTest.click("games")');
  await on('games');
  await gjs('document.getElementById("gw-close").click()');
  check('tabs: Close closes it from the Games tab and Settings stays shut in the game\'s page', await until(async () => !c.hubWin() && !(await panel()), 3000));
}
