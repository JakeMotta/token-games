// The shell's main process, shared by every game: one frameless, transparent window that holds the game in an orb
// in a corner of the screen and becomes the floating overlay window when it pops out; the menu-bar icon; the global
// shortcut; the settings and save files; and the Claude Code feed.
//
// There is only ever one window running the game, so one game instance: the orb, its hover pill, the open card and
// the popped-out window are the same page moving its game between places. In the corner the window is as big as the
// open card and lets every click through except over the orb (or the pill, or the open card).
//
// It also hosts the game catalog (docs/catalog.md): the shell's own game is the built-in one, and a catalog game the
// player installed and chose runs in its place, sandboxed (catalog-host.ts). The control socket lets the tokengames
// CLI and agents list games and ask for installs, which only the player can approve, in Settings → Games.
//
// Environment (for the automated smoke test): TG_SMOKE=<folder> runs the smoke test and quits without ever showing a
// window; TG_SMOKE_MODE picks the run; TG_USER_DATA moves the settings and save files; TG_CLAUDE_DIR points the feed
// somewhere else. For the catalog: TG_CATALOG_DIR moves the catalog folder; TG_REGISTRY_URL and TG_REGISTRY_KEY point
// it at a developer's own signed registry.
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, powerMonitor, screen, Tray, type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CH, type FeedStatus, type GameRect, type GamesOp, type GamesResult, type GamesView, type GameStatus, type HostedBoot, type ModeInfo, type OrbDrag, type ResizeDrag, type ShellBoot, type ShellCommand } from '../api';
import { Catalog, type BuiltIn } from '../catalog/catalog';
import { catalogCommands } from '../catalog/commands';
import { defaultCatalogDir, serveControl, type ControlServer } from '../catalog/control';
import { DEFAULT_REGISTRY, REGISTRY_KEYS } from '../catalog/keys';
import type { HostedEnv } from '../hosted';
import { isGameId } from '../manifest';
import { GameHost, iconDataUrl, registerGameScheme } from './catalog-host';
import { smokeRegistry } from './smoke-registry';
import { normalizeEvent, type UsageEvent } from '../events';
import { watchClaudeCode, type Feed } from '../feed/claude-code';
import { boundsFor, clampToArea, gripCorner, nearestDock, resizeFromGrip, type Area } from '../geometry';
import { initialState, next, PAGE_EVENTS, presentationOf, type Scale, type ShellEvent, type ShellState } from '../modes';
import { contains, nearestCorner, onOrb, orbCenter, orbGeo, orbWindowBounds, pickDisplay, shapeRect, type Corner, type OrbGeo } from '../orb';
import { settingsKit, type Bounds, type GameSettingsSchema, type ShellSettings } from '../settings';
import { trayMenu, type TrayAction, type TrayItem } from '../tray';
import { runSmoke, type GameSmoke } from './smoke';
import { SaveFile, SettingsStore } from './store';

export interface ShellConfig<G extends object> {
  name: string; // shown in the menu, the tray and the orb's pill
  dir: string; // the built game: index.html, preload.js, shell.css (usually __dirname)
  settings: GameSettingsSchema<G>; // the game's own settings, stored beside the shell's
  icon(scale: 1 | 2): Buffer; // the menu-bar icon: 16 × 16 (× scale) BGRA pixels, black on clear (a template image)
  saveFile?: string; // the game's save file in the app's data folder (default save.json)
  smoke?: GameSmoke<ShellSettings & G>; // the game's own checks for the smoke test
}

export const SHORTCUT = 'Alt+CommandOrControl+T';
const IS_MAC = process.platform === 'darwin';
const POLL_MS = 100; // how often the pointer is checked against the orb while it rests in its corner
const FLY = { fade: 140, settle: 420 }; // popping out and docking: the page fades, then the window flies

export function startShell<G extends object>(cfg: ShellConfig<G>): void {
  type S = ShellSettings & G;
  const env = process.env;
  registerGameScheme(); // before the app is ready
  const SMOKE = env.TG_SMOKE || '';
  const CLAUDE_DIR = env.TG_CLAUDE_DIR || path.join(os.homedir(), '.claude', 'projects');
  if (env.TG_USER_DATA) app.setPath('userData', env.TG_USER_DATA);
  const kit = settingsKit(cfg.settings);

  let win: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let store: SettingsStore<S>;
  let save: SaveFile;
  let feed: Feed | null = null;
  let feedStatus: FeedStatus = { watching: false, files: 0, root: CLAUDE_DIR };
  let state: ShellState = 'orb';
  let geo: OrbGeo;
  let status: GameStatus = { count: '', title: '' };
  let lastPlaced: Bounds | null = null; // the bounds we set last, so our own moves aren't taken for the player's
  let fullPrev: Bounds | null = null; // the window before full screen
  let moveTimer: NodeJS.Timeout | null = null, flyTimer: NodeJS.Timeout | null = null, poll: NodeJS.Timeout | null = null;
  let inside = false; // the pointer is over the orb (or the pill)
  let drag: { start: Bounds; x: number; y: number; grip: Corner; area: Area; last: Bounds } | null = null;
  let orbDrag: { start: Bounds; x: number; y: number } | null = null;
  let ignoring = false; // clicks pass through the window
  let catalog: Catalog;
  let builtIn: BuiltIn;
  let control: ControlServer | null = null;
  let activeId = ''; // the game the page runs: the built-in one, or a catalog game hosted in its place
  let hosted: HostedBoot | null = null;
  let host: GameHost | null = null;
  let hostedScale: Scale = 'mini';

  function ignore(on: boolean): void {
    ignoring = on;
    win?.setIgnoreMouseEvents(on, on ? { forward: true } : undefined);
  }

  const same = (a: Bounds | null, b: Bounds): boolean => !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  const send = (ch: string, v: unknown): void => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); };
  const floating = (): boolean => presentationOf(state) === 'floating';
  // The smoke test never puts a window on screen: there, showing and hiding only flip this flag.
  let smokeShown = true;
  const visible = (): boolean => !!win && (SMOKE ? smokeShown : win.isVisible());
  const modeInfo = (): ModeInfo => ({ state, geo, visible: visible() });

  // The orb's display (the one it was last dropped on, while it is plugged in; else the main one) and its corner.
  function home(): OrbGeo {
    const s = store.get();
    return orbGeo(pickDisplay(screen.getAllDisplays(), s.display, screen.getPrimaryDisplay())!, s.corner);
  }

  // The work area of the display the floating window is on, or will go to.
  function areaFor(b?: Bounds | null): Area {
    const at = b || (win && state === 'popped' ? win.getBounds() : store.get().dock === 'free' ? store.get().bounds : null) || geo.area;
    return screen.getDisplayMatching(at).workArea;
  }

  function place(b: Bounds, animate = false): void {
    if (!win) return;
    lastPlaced = b;
    win.setBounds(b, animate && IS_MAC);
  }

  function placeForSettings(): void {
    if (!win || fullPrev || state !== 'popped') return;
    place(boundsFor(store.get(), areaFor()));
  }

  function applyClickThrough(on: boolean): void {
    ignore(on);
  }

  function applyOnTop(on: boolean): void {
    if (!win) return;
    win.setAlwaysOnTop(on, 'floating');
    if (IS_MAC) win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on });
  }

  // ---------- the two presentations ----------

  // In the corner: above other windows, on every desktop but not over full-screen apps, see-through and click-through
  // except over the orb (the pointer poll switches that) or the open card.
  function setupOrb(animate = false): void {
    if (!win) return;
    win.setResizable(false);
    win.setAspectRatio(0);
    win.setMinimumSize(0, 0);
    win.setAlwaysOnTop(true, 'floating');
    if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    win.setOpacity(1);
    inside = false;
    applyMouse();
    place(orbWindowBounds(geo), animate);
  }

  // Which clicks the window takes: popped out, all of them unless click-through is on; in the corner, the open card's,
  // or the orb's while the pointer is over it; none while it flies.
  function applyMouse(): void {
    if (!win) return;
    const take = state === 'popped' ? !store.get().clickThrough : state === 'expanded' || !!orbDrag || ((state === 'orb' || state === 'hover') && inside);
    ignore(!take);
  }

  // Popped out: the floating window, with its size, corner, opacity, always-on-top and click-through settings.
  function setupFloating(animate = false): void {
    if (!win) return;
    const s = store.get();
    win.setResizable(true);
    win.setMinimumSize(256, 144);
    win.setAspectRatio(16 / 9);
    applyOnTop(s.alwaysOnTop);
    win.setOpacity(s.opacity);
    applyClickThrough(s.clickThrough);
    place(boundsFor(s, areaFor()), animate);
  }

  function dispatch(ev: ShellEvent): void {
    const prev = state, now = next(prev, ev, { reducedMotion: store.get().reducedMotion });
    if (now === prev) return;
    state = now;
    if (presentationOf(prev) !== presentationOf(now)) {
      store.set({ presentation: presentationOf(now) } as Partial<S>);
      send(CH.settings, store.get());
    }
    if (flyTimer) { clearTimeout(flyTimer); flyTimer = null; }
    const fly = (setup: (animate: boolean) => void) => {
      flyTimer = setTimeout(() => { setup(true); flyTimer = setTimeout(() => { flyTimer = null; dispatch('settled'); }, FLY.settle); }, FLY.fade);
    };
    if (now === 'popping') fly(setupFloating);
    else if (now === 'popped' && prev !== 'popping') setupFloating(); // reduced motion: no flight
    else if (now === 'docking') { setFullscreen(false); fly(setupOrb); }
    else if (now === 'orb' && prev === 'popped') { setFullscreen(false); setupOrb(); }
    if (now === 'orb' && prev !== 'hover') inside = false; // the pointer is looked at afresh
    if (now !== 'popping' && now !== 'popped') applyMouse();
    if (now === 'expanded' && !SMOKE) win?.focus();
    syncPoll();
    send(CH.mode, modeInfo());
    refreshTray();
  }

  // Every settings change goes through here: save, apply to the window, tell the page and the menu.
  function update(patch: Partial<S>, opts: { place?: boolean } = {}): S {
    const { presentation, ...rest } = patch as Partial<S> & { presentation?: S['presentation'] };
    const prev = store.get(), nextS = store.set(rest as Partial<S>);
    if (floating()) {
      if (opts.place !== false && (prev.width !== nextS.width || prev.dock !== nextS.dock || prev.size !== nextS.size)) placeForSettings();
      if (prev.clickThrough !== nextS.clickThrough) applyClickThrough(nextS.clickThrough);
      if (prev.opacity !== nextS.opacity) win?.setOpacity(nextS.opacity);
      if (prev.alwaysOnTop !== nextS.alwaysOnTop && !fullPrev) applyOnTop(nextS.alwaysOnTop);
    }
    if (prev.reducedMotion !== nextS.reducedMotion) host?.envChanged();
    if (prev.corner !== nextS.corner || prev.display !== nextS.display) {
      geo = home();
      if (!floating() && !flyTimer) { if (state !== 'orb') dispatch('drag'); place(orbWindowBounds(geo), true); }
      send(CH.mode, modeInfo());
    }
    send(CH.settings, nextS);
    refreshTray();
    if (presentation && presentation !== presentationOf(state)) dispatch(presentation === 'floating' ? 'pop' : 'dock');
    return store.get();
  }

  function resetAll(): S {
    setFullscreen(false);
    const s = store.reset();
    geo = home();
    send(CH.settings, s);
    if (floating()) dispatch('dock');
    else { state = 'orb'; setupOrb(); syncPoll(); send(CH.mode, modeInfo()); }
    refreshTray();
    return store.get();
  }

  // ---------- the pointer over the orb ----------

  // Electron can't tell when the pointer is over a see-through, click-through window, so while the orb rests in its
  // corner the pointer is checked ten times a second (only then: never with the card open, popped out or hidden).
  function syncPoll(): void {
    const want = !SMOKE && visible() && (state === 'orb' || state === 'hover') && !orbDrag;
    if (want && !poll) poll = setInterval(pointer, POLL_MS);
    else if (!want && poll) { clearInterval(poll); poll = null; }
  }

  function pointer(): void {
    if (!win) return;
    const p = screen.getCursorScreenPoint();
    const over = state === 'hover' ? contains(shapeRect('pill', geo), p, 4) : onOrb(geo, p);
    if (over === inside) return;
    inside = over;
    applyMouse();
    dispatch(over ? 'enter' : 'leave');
  }

  // A display came, went or changed (resolution, the Dock, the lid): put the orb back in its corner, on the main
  // display if its own one is gone.
  function onDisplays(): void {
    if (!win) return;
    geo = home();
    if (floating()) placeForSettings();
    else if (!flyTimer) { setupOrb(); dispatch('display'); }
    send(CH.mode, modeInfo());
  }

  // ---------- dragging the orb to another corner ----------

  // The page sends the pointer in screen coordinates once it has moved a few pixels; the window follows it, and when
  // let go the orb settles in the corner of the quarter of the display it was dropped in.
  function onOrbDrag(d: OrbDrag): void {
    if (!win || floating() || flyTimer) return;
    if (d.phase === 'start') {
      dispatch('drag');
      orbDrag = { start: win.getBounds(), x: d.x, y: d.y };
      applyMouse(); syncPoll();
      return;
    }
    if (!orbDrag) return;
    const b = { ...orbDrag.start, x: orbDrag.start.x + Math.round(d.x - orbDrag.x), y: orbDrag.start.y + Math.round(d.y - orbDrag.y) };
    if (d.phase === 'move') { place(b); return; }
    orbDrag = null;
    const from = orbWindowBounds(geo), c = orbCenter(geo);
    const at = { x: c.x - from.x + b.x, y: c.y - from.y + b.y };
    const d0 = screen.getDisplayNearestPoint(at);
    const corner = nearestCorner(at, d0.workArea);
    inside = false;
    if (corner === store.get().corner && d0.id === geo.displayId) place(orbWindowBounds(geo), true); // back where it was
    else update({ corner, display: d0.id } as Partial<S>);
    applyMouse(); syncPoll();
  }

  // ---------- the Claude Code feed ----------

  // Always on: the games' only source of progress. If it can't start, the page says so quietly.
  function startFeed(): void {
    let error: string | undefined;
    if (!feed) {
      try { feed = watchClaudeCode({ root: CLAUDE_DIR, onEvent: forward }); } catch (e) { error = 'The Claude Code feed could not start: ' + (e as Error).message; }
    }
    feedStatus = { watching: !!feed && feed.watching(), files: feed ? feed.files() : 0, root: CLAUDE_DIR, error };
    send(CH.feed, feedStatus);
  }

  function forward(raw: UsageEvent): void {
    const ev = normalizeEvent(raw);
    if (!ev) return;
    send(CH.event, ev);
    host?.usage(ev); // a hosted game gets the counts only (hosted.ts)
  }

  // ---------- the catalog: other games, installed by the player ----------

  // The built-in game, from the game.json beside the app.
  function readBuiltIn(): BuiltIn {
    let m: Record<string, unknown> = {};
    try { m = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'game.json'), 'utf8')); } catch { /* a packaged app may not ship it */ }
    const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d);
    return { id: isGameId(m.id) ? m.id : app.getName(), name: str(m.name, cfg.name), description: str(m.description, ''), version: str(m.version, app.getVersion()) };
  }

  function setupCatalog(): void {
    builtIn = readBuiltIn();
    const dir = env.TG_CATALOG_DIR ? path.resolve(env.TG_CATALOG_DIR) : SMOKE ? path.join(app.getPath('userData'), 'catalog') : defaultCatalogDir();
    let keys = [...REGISTRY_KEYS], url = env.TG_REGISTRY_URL || DEFAULT_REGISTRY;
    if (env.TG_REGISTRY_KEY) keys.push(env.TG_REGISTRY_KEY); // a developer's own registry, signed with their own key
    if (SMOKE && env.TG_SMOKE_MODE === 'catalog') {
      // the smoke test's registry: the repo's sample game, signed with a key made for this run and never saved
      const reg = smokeRegistry(path.join(SMOKE, 'registry'), path.join(app.getAppPath(), '..', 'samples'));
      keys = [reg.publicKey]; url = reg.url;
    }
    catalog = new Catalog({ dir, hostApp: builtIn.id, builtIn, trustedKeys: keys, registryUrl: url });
    activeId = catalog.active();
    hosted = hostedBoot();
    catalog.onChange(() => {
      send(CH.gamesChanged, gamesView());
      if (catalog.active() !== activeId) switchGame();
    });
    serveControl(dir, catalogCommands(catalog)).then((c) => { control = c; }, (e) => console.warn('Token Games: the control socket could not start:', (e as Error).message));
  }

  function hostedBoot(): HostedBoot | null {
    if (activeId === builtIn.id) return null;
    const dir = catalog.gameDir(activeId), m = catalog.manifestOf(activeId), row = catalog.list().find((r) => r.id === activeId);
    if (!dir || !m || !row) return null;
    return { id: m.id, name: m.name, version: m.version, tier: row.tier, icon: iconDataUrl(dir, m.icon) };
  }

  const hostedEnv = (): HostedEnv => ({ scale: hostedScale, dark: nativeTheme.shouldUseDarkColors, reducedMotion: store.get().reducedMotion });

  function openHost(): void {
    if (!win || !hosted || host) return;
    const dir = catalog.gameDir(hosted.id), m = catalog.manifestOf(hosted.id);
    if (!dir || !m) return;
    host = new GameHost({
      win, preload: path.join(cfg.dir, 'game-preload.js'), smoke: !!SMOKE, env: hostedEnv,
      game: { id: hosted.id, dir, page: m.entry.page, network: catalog.approvedHosts(hosted.id), saveDir: catalog.saveDir(hosted.id) },
      onStatus: (st) => send(CH.hostedStatus, st),
      pop: () => { if (!floating()) dispatch('pop'); },
      dock: () => { if (floating()) dispatch('dock'); },
      key: (k) => send(CH.hostedKey, k),
    });
  }

  // Another game was chosen (here, or by the CLI): the page starts again around it. The built-in game saves as it goes.
  function switchGame(): void {
    activeId = catalog.active();
    host?.close();
    host = null;
    hostedScale = 'mini';
    hosted = hostedBoot();
    status = { count: '', title: '' };
    refreshTray();
    win?.webContents.reload();
  }

  function gamesView(): GamesView {
    const st = catalog.status();
    return {
      rows: st.games, pending: st.pending, allowCommunity: st.allowCommunity, canAddLocal: !SMOKE,
      catalog: { fetchedAt: st.catalog.fetchedAt, games: st.catalog.games, error: st.catalog.error, signed: st.catalog.signed },
    };
  }

  // What Settings → Games asks for. Approving happens only here: the player clicked it in the app.
  async function gamesDo(op: GamesOp): Promise<GamesResult> {
    try {
      if (op?.op === 'refresh') {
        const r = await catalog.refresh();
        if (!r.ok) return { ok: false, error: r.error, view: gamesView() };
      } else if (op?.op === 'request' && ['install', 'update', 'remove'].includes(op.action) && typeof op.id === 'string') await catalog.request(op.action, op.id, 'player');
      else if (op?.op === 'add-local') {
        if (SMOKE || !win) throw new Error('no folder picker here');
        const r = await dialog.showOpenDialog(win, { title: 'Add a game folder', buttonLabel: 'Add', properties: ['openDirectory'] });
        if (!r.canceled && r.filePaths[0]) await catalog.request('add-local', r.filePaths[0], 'player');
      } else if (op?.op === 'approve' && typeof op.requestId === 'string') catalog.approve(op.requestId);
      else if (op?.op === 'deny' && typeof op.requestId === 'string') catalog.deny(op.requestId);
      else if (op?.op === 'use' && typeof op.id === 'string') catalog.setActive(op.id);
      else if (op?.op === 'community') catalog.setAllowCommunity(op.on === true);
      else throw new Error('unknown games request');
      return { ok: true, view: gamesView() };
    } catch (e) {
      return { ok: false, error: (e as Error).message, view: gamesView() };
    }
  }

  // ---------- full screen (the display's whole area, not the Mac's full-screen Space), popped out only ----------

  function setFullscreen(on: boolean): boolean {
    if (!win) return false;
    if (on && !fullPrev && state === 'popped') {
      fullPrev = win.getBounds();
      const d = screen.getDisplayMatching(fullPrev).bounds;
      win.setAlwaysOnTop(true, 'screen-saver');
      place({ x: d.x, y: d.y, width: d.width, height: d.height });
      send(CH.command, 'fullscreen-on' satisfies ShellCommand);
    } else if (!on && fullPrev) {
      const back = fullPrev;
      fullPrev = null;
      applyOnTop(store.get().alwaysOnTop);
      place(back);
      placeForSettings();
      send(CH.command, 'fullscreen-off' satisfies ShellCommand);
    }
    return !!fullPrev;
  }

  // ---------- dragging the floating window and resizing it ----------

  // The window was dragged by its title bar: once it settles, dock it to a nearby corner or leave it where it is.
  function onMoved(): void {
    if (!win || fullPrev || drag || state !== 'popped') return;
    const b = win.getBounds();
    if (same(lastPlaced, b)) return;
    const area = areaFor(b), dock = nearestDock(b, area);
    if (dock === 'free') {
      const c = clampToArea(b, area);
      update({ dock, bounds: c } as Partial<S>, { place: false });
      if (same(c, b)) lastPlaced = b; else place(c);
    } else {
      update({ dock, bounds: b } as Partial<S>, { place: false });
      placeForSettings(); // snap into the corner
    }
  }

  // Native edge resizing (where the platform allows it on a frameless window): keep 16:9 and remember the width.
  function onResized(): void {
    if (!win || fullPrev || drag || state !== 'popped') return;
    const b = win.getBounds();
    if (same(lastPlaced, b)) return;
    lastPlaced = b;
    update({ size: 'custom', width: b.width, bounds: b } as Partial<S>, { place: false });
    placeForSettings();
  }

  function onResizeDrag(d: ResizeDrag): void {
    if (!win || fullPrev || state !== 'popped') return;
    if (d.phase === 'start') {
      const start = win.getBounds();
      drag = { start, x: d.x, y: d.y, grip: gripCorner(store.get().dock), area: areaFor(start), last: start };
      return;
    }
    if (!drag) return;
    const b = resizeFromGrip(drag.start, drag.grip, d.x - drag.x, d.y - drag.y, drag.area);
    if (!same(drag.last, b)) { drag.last = b; place(b); }
    if (d.phase === 'end') {
      const last = drag.last;
      drag = null;
      update({ size: 'custom', width: last.width, bounds: last } as Partial<S>, { place: false });
    }
  }

  // ---------- the menu-bar icon and the shortcut: the game can always be found again ----------

  function trayImage(): Electron.NativeImage {
    const img = nativeImage.createFromBitmap(cfg.icon(1), { width: 16, height: 16, scaleFactor: 1 });
    img.addRepresentation({ buffer: cfg.icon(2), width: 32, height: 32, scaleFactor: 2 });
    if (IS_MAC) img.setTemplateImage(true);
    return img;
  }

  function toElectron(items: TrayItem[]): MenuItemConstructorOptions[] {
    return items.map((it) => {
      const o: MenuItemConstructorOptions = { label: it.label, type: it.type, checked: it.checked, enabled: it.enabled, accelerator: it.accelerator, registerAccelerator: false };
      if (it.submenu) o.submenu = toElectron(it.submenu);
      if (it.action) { const a = it.action; o.click = () => runAction(a); }
      return o;
    });
  }

  const trayItems = (): TrayItem[] => trayMenu(store.get(), { name: cfg.name, visible: visible(), state, shortcut: SHORTCUT });

  function runAction(a: TrayAction): void {
    if (a.do === 'toggle-window') toggleWindow();
    else if (a.do === 'open') { showWindow(); dispatch('toggle'); }
    else if (a.do === 'pop') { showWindow(); dispatch('pop'); }
    else if (a.do === 'dock') { showWindow(); dispatch('dock'); }
    else if (a.do === 'settings') {
      showWindow(true);
      if (!floating() && state !== 'expanded') dispatch('toggle');
      send(CH.command, 'settings' satisfies ShellCommand);
    } else if (a.do === 'fullscreen') { if (state === 'popped') { showWindow(true); setFullscreen(!fullPrev); } }
    else if (a.do === 'reset') resetAll();
    else if (a.do === 'quit') app.quit();
    else if (a.do === 'set') { if (a.patch.dock || a.patch.size) setFullscreen(false); update(a.patch as Partial<S>); }
  }

  // The shortcut: shows a hidden game; in the corner it opens and closes the card; popped out it switches
  // click-through (the way back when the window lets every click pass).
  function hotkey(): void {
    if (!visible()) showWindow(floating());
    else if (floating()) update({ clickThrough: !store.get().clickThrough } as Partial<S>);
    else dispatch('toggle');
  }

  function refreshTray(): void {
    if (!tray) return;
    tray.setContextMenu(Menu.buildFromTemplate(toElectron(trayItems())));
    tray.setToolTip(cfg.name + (status.count ? ` · ${status.count} ${status.title}` : ''));
  }

  function showWindow(focus = false): void {
    if (!win) return;
    if (SMOKE) smokeShown = true;
    else if (focus && floating()) win.show(); else win.showInactive();
    syncPoll(); refreshTray();
  }

  function hideWindow(): void {
    if (!win) return;
    if (state === 'hover') dispatch('leave');
    if (state === 'expanded') dispatch('escape');
    if (SMOKE) smokeShown = false; else win.hide();
    syncPoll(); refreshTray();
  }

  function toggleWindow(): void {
    if (visible()) hideWindow(); else showWindow(true);
  }

  // ---------- start ----------

  function createWindow(): void {
    const s = store.get();
    geo = home();
    state = initialState(s.presentation);
    win = new BrowserWindow({
      ...orbWindowBounds(geo),
      show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
      acceptFirstMouse: true, // the first click on the orb counts
      alwaysOnTop: true, title: cfg.name,
      webPreferences: {
        preload: path.join(cfg.dir, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
        backgroundThrottling: !SMOKE, // the smoke test draws in a window that is never shown
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('move', () => { if (moveTimer) clearTimeout(moveTimer); moveTimer = setTimeout(onMoved, 350); });
    win.on('resized', onResized);
    win.on('blur', () => { if (state === 'expanded') dispatch('blur'); });
    win.on('show', () => { syncPoll(); refreshTray(); });
    win.on('hide', () => { syncPoll(); refreshTray(); });
    win.on('closed', () => { win = null; });
    if (!SMOKE) win.once('ready-to-show', () => { win?.showInactive(); syncPoll(); });
    win.loadFile(path.join(cfg.dir, 'index.html'));
    if (floating()) setupFloating(); else setupOrb();
    startFeed();
  }

  function wireIpc(): void {
    // Only the shell's own page may use these: never a hosted game's view (it has its own, smaller bridge).
    const fromPage = (e: IpcMainEvent | IpcMainInvokeEvent) => !!win && e.sender === win.webContents;
    const handle = (ch: string, fn: (...a: any[]) => unknown) => ipcMain.handle(ch, (e, ...a) => (fromPage(e) ? fn(...a) : null));
    const on = (ch: string, fn: (...a: any[]) => void) => ipcMain.on(ch, (e, ...a) => { if (fromPage(e)) fn(...a); });
    handle(CH.state, (): ShellBoot<S> => ({
      name: cfg.name, settings: store.get(), dark: nativeTheme.shouldUseDarkColors, platform: process.platform, fullscreen: !!fullPrev,
      feed: { ...feedStatus, watching: !!feed && feed.watching(), files: feed ? feed.files() : 0 }, smoke: !!SMOKE, mode: modeInfo(), shortcut: SHORTCUT,
      hosted,
    }));
    handle(CH.set, (patch: Partial<S>) => {
      if (patch && (patch.size || patch.dock)) setFullscreen(false);
      return update(patch || {});
    });
    handle(CH.reset, resetAll);
    handle(CH.fullscreen, (on: boolean) => setFullscreen(!!on));
    on(CH.resize, (d: ResizeDrag) => onResizeDrag(d));
    on(CH.grab, (on: boolean) => { if (state === 'popped' && store.get().clickThrough) ignore(!on); });
    on(CH.orbDrag, (d: OrbDrag) => { if (d && Number.isFinite(d.x) && Number.isFinite(d.y)) onOrbDrag(d); });
    on(CH.intent, (ev: ShellEvent) => { if (PAGE_EVENTS.includes(ev)) dispatch(ev); });
    on(CH.status, (st: GameStatus) => {
      const clean = { count: String(st?.count ?? '').slice(0, 12), title: String(st?.title ?? '').slice(0, 24) };
      if (clean.count === status.count && clean.title === status.title) return;
      status = clean;
      tray?.setToolTip(cfg.name + (status.count ? ` · ${status.count} ${status.title}` : ''));
    });
    on(CH.hide, hideWindow);
    on(CH.quit, () => app.quit());
    // The built-in game's save: untouched while a catalog game is hosted in its place.
    handle(CH.save, (data: unknown) => !hosted && save.save(data));
    ipcMain.on(CH.saveNow, (e, data: unknown) => { e.returnValue = fromPage(e) && !hosted && save.save(data); });
    handle(CH.load, () => (hosted ? null : save.load()));
    handle(CH.games, gamesView);
    handle(CH.gamesDo, (op: GamesOp) => gamesDo(op));
    on(CH.hostedRect, (r: GameRect | null, sc: Scale) => {
      if (!hosted) return;
      openHost();
      if ((sc === 'mini' || sc === 'expanded' || sc === 'window') && sc !== hostedScale) { hostedScale = sc; host?.envChanged(); }
      host?.setRect(r && typeof r === 'object' ? r : null);
    });
  }

  if (!SMOKE && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => showWindow(true));
  app.whenReady().then(() => {
    if (IS_MAC) app.dock?.hide(); // a menu-bar app: no Dock icon
    Menu.setApplicationMenu(null);
    store = new SettingsStore<S>(path.join(app.getPath('userData'), 'settings.json'), kit);
    save = new SaveFile(path.join(app.getPath('userData'), cfg.saveFile || 'save.json'));
    setupCatalog();
    wireIpc();
    createWindow();
    nativeTheme.on('updated', () => { send(CH.dark, nativeTheme.shouldUseDarkColors); host?.envChanged(); });
    // nobody can see the game while the screen is locked or the computer sleeps: let it stop drawing
    for (const [ev, asleep] of [['lock-screen', true], ['suspend', true], ['unlock-screen', false], ['resume', false]] as const) powerMonitor.on(ev as 'suspend', () => send(CH.sleep, asleep));
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed'] as const) screen.on(ev as 'display-added', onDisplays);
    if (SMOKE) {
      runSmoke<S>({
        win: win!, store, outDir: SMOKE, claudeDir: CLAUDE_DIR, update: (p) => update(p), resize: onResizeDrag, orbDrag: onOrbDrag,
        isFullscreen: () => !!fullPrev, dispatch, displays: onDisplays, state: () => state, geo: () => geo, trayItems, hotkey, status: () => status,
        visible, show: () => showWindow(), hide: hideWindow, ignoresMouse: () => ignoring,
        catalog: { catalog: () => catalog, host: () => host, socket: () => control?.socket || '', builtIn: () => builtIn, saveFile: () => save.file },
      }, cfg.smoke);
      return;
    }
    tray = new Tray(trayImage());
    tray.setToolTip(cfg.name);
    if (!IS_MAC) tray.on('click', toggleWindow);
    refreshTray();
    globalShortcut.register(SHORTCUT, hotkey);
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { store?.flush(); feed?.stop(); void control?.close(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
