// The shell's main process, shared by every game: one frameless, transparent window that holds the game in the
// notch (or a pill in the middle of the menu bar) and becomes the floating overlay window when it pops out; the
// menu-bar icon; the global shortcut; the settings and save files; and the Claude Code feed.
//
// There is only ever one window running the game, so one game instance: the strip in the notch, the drop-down and
// the popped-out window are the same page moving its game between places. While the game is popped out, a tiny
// second window with no game in it (marker.html) keeps the island in the notch and brings the game back when clicked.
//
// Environment (for the automated smoke test): TG_SMOKE=<folder> runs the smoke test and quits without ever showing a
// window; TG_SMOKE_MODE picks the run; TG_USER_DATA moves the settings and save files; TG_CLAUDE_DIR points the feed
// somewhere else.
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, Tray, type MenuItemConstructorOptions } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { CH, type FeedStatus, type GameStatus, type ModeInfo, type ResizeDrag, type ShellBoot, type ShellCommand } from '../api';
import { normalizeEvent, type UsageEvent } from '../events';
import { watchClaudeCode, type Feed } from '../feed/claude-code';
import { boundsFor, clampToArea, gripCorner, nearestDock, resizeFromGrip, type Area, type Corner } from '../geometry';
import { initialState, next, PAGE_EVENTS, presentationOf, shapeOf, type ShellEvent, type ShellState } from '../modes';
import { contains, islandRect, notchGeo, notchWindowBounds, pickDisplay, type NotchGeo } from '../notch';
import { settingsKit, type Bounds, type GameSettingsSchema, type ShellSettings } from '../settings';
import { trayMenu, type TrayAction, type TrayItem } from '../tray';
import { runSmoke, type GameSmoke } from './smoke';
import { SaveFile, SettingsStore } from './store';

export interface ShellConfig<G extends object> {
  name: string; // shown in the menu, the tray and the island's tooltips
  dir: string; // the built game: index.html, preload.js, marker.html (usually __dirname)
  settings: GameSettingsSchema<G>; // the game's own settings, stored beside the shell's
  icon(scale: 1 | 2): Buffer; // the menu-bar icon: 16 × 16 (× scale) BGRA pixels, black on clear (a template image)
  saveFile?: string; // the game's save file in the app's data folder (default save.json)
  smoke?: GameSmoke<ShellSettings & G>; // the game's own checks for the smoke test
}

export const SHORTCUT = 'Alt+CommandOrControl+T';
const IS_MAC = process.platform === 'darwin';
const POLL_MS = 100; // how often the pointer is checked against the island while it rests in the notch
const FLY = { fade: 140, settle: 420 }; // popping out and docking: the page fades, then the window flies

export function startShell<G extends object>(cfg: ShellConfig<G>): void {
  type S = ShellSettings & G;
  const env = process.env;
  const SMOKE = env.TG_SMOKE || '';
  const CLAUDE_DIR = env.TG_CLAUDE_DIR || path.join(os.homedir(), '.claude', 'projects');
  if (env.TG_USER_DATA) app.setPath('userData', env.TG_USER_DATA);
  const kit = settingsKit(cfg.settings);

  let win: BrowserWindow | null = null;
  let marker: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let store: SettingsStore<S>;
  let save: SaveFile;
  let feed: Feed | null = null;
  let feedStatus: FeedStatus = { watching: false, files: 0, root: CLAUDE_DIR };
  let state: ShellState = 'collapsed';
  let geo: NotchGeo;
  let status: GameStatus = { count: '', title: '' };
  let lastPlaced: Bounds | null = null; // the bounds we set last, so our own moves aren't taken for the player's
  let fullPrev: Bounds | null = null; // the window before full screen
  let moveTimer: NodeJS.Timeout | null = null, flyTimer: NodeJS.Timeout | null = null, poll: NodeJS.Timeout | null = null;
  let inside = false; // the pointer is over the island
  let drag: { start: Bounds; x: number; y: number; grip: Corner; area: Area; last: Bounds } | null = null;

  const same = (a: Bounds | null, b: Bounds): boolean => !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  const send = (ch: string, v: unknown): void => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); };
  const floating = (): boolean => presentationOf(state) === 'floating';
  // The smoke test never puts a window on screen: there, showing and hiding only flip this flag.
  let smokeShown = true;
  const visible = (): boolean => !!win && (SMOKE ? smokeShown : win.isVisible());
  const modeInfo = (): ModeInfo => ({ state, geo, visible: visible() });

  // The display the island lives on: the built-in one if there is one (only it can have a notch), else the main one.
  function home(): NotchGeo {
    return notchGeo(pickDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay())!);
  }

  // The work area of the display the floating window is on, or will go to.
  function areaFor(b?: Bounds | null): Area {
    const at = b || (win && state === 'popped' ? win.getBounds() : store.get().dock === 'free' ? store.get().bounds : null) || geo.screen;
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
    win?.setIgnoreMouseEvents(on, on ? { forward: true } : undefined);
  }

  function applyOnTop(on: boolean): void {
    if (!win) return;
    win.setAlwaysOnTop(on, 'floating');
    if (IS_MAC) win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on });
  }

  // ---------- the two presentations ----------

  // In the notch: above the menu bar, on every desktop but hidden in full-screen apps, see-through and click-through
  // except where the island is (the pointer poll switches that).
  function setupNotch(animate = false): void {
    if (!win) return;
    win.setResizable(false);
    win.setAspectRatio(0);
    win.setAlwaysOnTop(true, 'status');
    if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    win.setOpacity(1);
    inside = false;
    win.setIgnoreMouseEvents(true, { forward: true });
    place(notchWindowBounds(geo), animate);
  }

  // Popped out: the floating window, with its size, corner, opacity, always-on-top and click-through settings.
  function setupFloating(animate = false): void {
    if (!win) return;
    const s = store.get();
    win.setResizable(true);
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
    else if (now === 'docking') { setFullscreen(false); fly(setupNotch); }
    else if (now === 'collapsed' && prev === 'popped') { setFullscreen(false); setupNotch(); }
    if (now === 'expanded' && !SMOKE) win?.focus();
    syncMarker();
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
    send(CH.settings, nextS);
    refreshTray();
    if (presentation && presentation !== presentationOf(state)) dispatch(presentation === 'floating' ? 'pop' : 'dock');
    return store.get();
  }

  function resetAll(): S {
    setFullscreen(false);
    const s = store.reset();
    send(CH.settings, s);
    if (floating()) dispatch('dock');
    else { state = 'collapsed'; setupNotch(); syncPoll(); send(CH.mode, modeInfo()); }
    refreshTray();
    return store.get();
  }

  // ---------- the pointer over the island ----------

  // Electron can't tell when the pointer is over a see-through, click-through window, so while the island rests in
  // the notch the pointer is checked ten times a second (only then: never while popped out or hidden).
  function syncPoll(): void {
    const want = !SMOKE && visible() && !floating();
    if (want && !poll) poll = setInterval(pointer, POLL_MS);
    else if (!want && poll) { clearInterval(poll); poll = null; inside = false; }
  }

  function pointer(): void {
    const shape = shapeOf(state);
    if (!win || !shape) return;
    const over = contains(islandRect(shape, geo), screen.getCursorScreenPoint(), inside ? 4 : 0);
    if (over === inside) return;
    inside = over;
    win.setIgnoreMouseEvents(!over, { forward: true });
    dispatch(over ? 'enter' : 'leave');
  }

  // A display came, went or changed (resolution, the menu bar, the lid): put the island back in its place.
  function onDisplays(): void {
    if (!win) return;
    geo = home();
    if (floating()) placeForSettings();
    else if (!flyTimer) { setupNotch(); dispatch('display'); }
    if (marker) marker.setBounds(islandRect('collapsed', geo));
    send(CH.mode, modeInfo());
  }

  // ---------- the marker: the island stays in the notch while the game is popped out ----------

  function syncMarker(): void {
    const want = state === 'popped';
    if (!want) { if (marker && !marker.isDestroyed()) marker.destroy(); marker = null; return; }
    if (!marker || marker.isDestroyed()) {
      marker = new BrowserWindow({
        ...islandRect('collapsed', geo), show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
        resizable: false, movable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, focusable: false,
        enableLargerThanScreen: true, acceptFirstMouse: true, alwaysOnTop: true, title: cfg.name,
        webPreferences: { preload: path.join(cfg.dir, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      marker.setAlwaysOnTop(true, 'status');
      if (IS_MAC) marker.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
      marker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      marker.webContents.on('will-navigate', (e) => e.preventDefault());
      marker.webContents.once('did-finish-load', () => sendMarker());
      const icon = nativeImage.createFromBitmap(cfg.icon(2), { width: 32, height: 32, scaleFactor: 1 }).toDataURL();
      marker.loadFile(path.join(cfg.dir, 'marker.html'), { query: { name: cfg.name, icon, notch: geo.notch ? '1' : '0' } });
    }
    if (!SMOKE && visible()) marker.showInactive(); else marker.hide();
  }

  function sendMarker(): void {
    if (marker && !marker.isDestroyed()) marker.webContents.send(CH.status, status);
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
    if (ev) send(CH.event, ev);
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

  // The shortcut: shows a hidden game; in the notch it opens and closes the drop-down; popped out it switches
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
    syncPoll(); syncMarker(); refreshTray();
  }

  function hideWindow(): void {
    if (!win) return;
    if (state === 'peek' || state === 'expanded') dispatch('escape');
    if (SMOKE) smokeShown = false; else win.hide();
    syncPoll(); syncMarker(); refreshTray();
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
      ...notchWindowBounds(geo),
      show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
      enableLargerThanScreen: true, // may sit over the menu bar, by the notch
      acceptFirstMouse: true, // the first click on the island counts
      alwaysOnTop: true, title: cfg.name,
      webPreferences: {
        preload: path.join(cfg.dir, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
        backgroundThrottling: !SMOKE, // the smoke test draws in a window that is never shown
      },
    });
    win.setMinimumSize(256, 144);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('move', () => { if (moveTimer) clearTimeout(moveTimer); moveTimer = setTimeout(onMoved, 350); });
    win.on('resized', onResized);
    win.on('blur', () => { if (state === 'expanded') dispatch('blur'); });
    win.on('show', () => { syncPoll(); refreshTray(); });
    win.on('hide', () => { syncPoll(); refreshTray(); });
    win.on('closed', () => { win = null; marker?.destroy(); });
    if (!SMOKE) win.once('ready-to-show', () => { win?.showInactive(); syncMarker(); });
    win.loadFile(path.join(cfg.dir, 'index.html'));
    if (floating()) setupFloating(); else setupNotch();
    syncMarker();
    startFeed();
  }

  function wireIpc(): void {
    ipcMain.handle(CH.state, (): ShellBoot<S> => ({
      name: cfg.name, settings: store.get(), dark: nativeTheme.shouldUseDarkColors, platform: process.platform, fullscreen: !!fullPrev,
      feed: { ...feedStatus, watching: !!feed && feed.watching(), files: feed ? feed.files() : 0 }, smoke: !!SMOKE, mode: modeInfo(), shortcut: SHORTCUT,
    }));
    ipcMain.handle(CH.set, (_e, patch: Partial<S>) => {
      if (patch && (patch.size || patch.dock)) setFullscreen(false);
      return update(patch || {});
    });
    ipcMain.handle(CH.reset, resetAll);
    ipcMain.handle(CH.fullscreen, (_e, on: boolean) => setFullscreen(!!on));
    ipcMain.on(CH.resize, (_e, d: ResizeDrag) => onResizeDrag(d));
    ipcMain.on(CH.grab, (_e, on: boolean) => { if (state === 'popped' && store.get().clickThrough) win?.setIgnoreMouseEvents(!on, { forward: true }); });
    ipcMain.on(CH.intent, (_e, ev: ShellEvent) => { if (PAGE_EVENTS.includes(ev)) dispatch(ev); });
    ipcMain.on(CH.status, (_e, st: GameStatus) => {
      const clean = { count: String(st?.count ?? '').slice(0, 12), title: String(st?.title ?? '').slice(0, 24) };
      if (clean.count === status.count && clean.title === status.title) return;
      status = clean;
      sendMarker();
      tray?.setToolTip(cfg.name + (status.count ? ` · ${status.count} ${status.title}` : ''));
    });
    ipcMain.on(CH.hide, hideWindow);
    ipcMain.on(CH.quit, () => app.quit());
    ipcMain.handle(CH.save, (_e, data: unknown) => save.save(data));
    ipcMain.on(CH.saveNow, (e, data: unknown) => { e.returnValue = save.save(data); });
    ipcMain.handle(CH.load, () => save.load());
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
    wireIpc();
    createWindow();
    nativeTheme.on('updated', () => send(CH.dark, nativeTheme.shouldUseDarkColors));
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed'] as const) screen.on(ev as 'display-added', onDisplays);
    if (SMOKE) {
      runSmoke<S>({
        win: win!, marker: () => marker, store, outDir: SMOKE, claudeDir: CLAUDE_DIR, update: (p) => update(p), resize: onResizeDrag,
        isFullscreen: () => !!fullPrev, dispatch, displays: onDisplays, state: () => state, geo: () => geo, trayItems, hotkey, status: () => status,
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
  app.on('before-quit', () => { store?.flush(); feed?.stop(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
