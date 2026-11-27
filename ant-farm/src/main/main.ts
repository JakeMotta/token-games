// The Electron main process: one frameless, transparent, always-on-top 16:9 window, the menu-bar icon, the settings
// file and the Claude Code feed.
//
// Environment (for the automated smoke test): ANT_FARM_SMOKE=<folder> runs the smoke test and quits without ever
// showing the window; ANT_FARM_USER_DATA moves the settings file; ANT_FARM_CLAUDE_DIR points the feed somewhere else.
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, Tray, type MenuItemConstructorOptions } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { CH, type FarmCommand, type FarmState, type FeedStatus, type ResizeDrag } from '../shared/api';
import { normalizeEvent, type FarmEvent } from '../shared/events';
import type { Bounds, Settings } from '../shared/settings';
import { watchClaudeCode, type Feed } from '../feed/claude-code';
import { boundsFor, clampToArea, gripCorner, nearestDock, resizeFromGrip, type Area, type Corner } from './geometry';
import { antBitmap } from './icon';
import { runSmoke } from './smoke';
import { ColonyFile, SettingsStore } from './store';
import { trayMenu, type TrayAction, type TrayItem } from './tray';

const SMOKE = process.env.ANT_FARM_SMOKE || '';
const CLAUDE_DIR = process.env.ANT_FARM_CLAUDE_DIR || path.join(os.homedir(), '.claude', 'projects');
const CLICK_SHORTCUT = 'Alt+CommandOrControl+T';
const IS_MAC = process.platform === 'darwin';

if (process.env.ANT_FARM_USER_DATA) app.setPath('userData', process.env.ANT_FARM_USER_DATA);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: SettingsStore;
let colony: ColonyFile;
let feed: Feed | null = null;
let feedStatus: FeedStatus = { watching: false, files: 0, root: CLAUDE_DIR };
let lastPlaced: Bounds | null = null; // the bounds we set last, so our own moves aren't taken for the player's
let fullPrev: Bounds | null = null; // the window before full screen
let moveTimer: NodeJS.Timeout | null = null;
let drag: { start: Bounds; x: number; y: number; grip: Corner; area: Area; last: Bounds } | null = null;

const same = (a: Bounds | null, b: Bounds): boolean => !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const send = (ch: string, v: unknown): void => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); };

// The work area (screen minus menu bar and dock or taskbar) of the display the window is on.
function areaFor(b?: Bounds | null): Area {
  const at = b || (win ? win.getBounds() : store.get().bounds);
  return (at ? screen.getDisplayMatching(at) : screen.getPrimaryDisplay()).workArea;
}

function place(b: Bounds): void {
  if (!win) return;
  lastPlaced = b;
  win.setBounds(b);
}

function placeForSettings(): void {
  if (!win || fullPrev) return;
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

// Every settings change goes through here: save, apply to the window, tell the page and the menu.
function update(patch: Partial<Settings>, opts: { place?: boolean } = {}): Settings {
  const prev = store.get(), next = store.set(patch);
  if (opts.place !== false && (prev.width !== next.width || prev.dock !== next.dock || prev.size !== next.size)) placeForSettings();
  if (prev.clickThrough !== next.clickThrough) applyClickThrough(next.clickThrough);
  if (prev.opacity !== next.opacity) win?.setOpacity(next.opacity);
  if (prev.alwaysOnTop !== next.alwaysOnTop) applyOnTop(next.alwaysOnTop);
  send(CH.settings, next);
  refreshTray();
  return next;
}

function applyAll(s: Settings): void {
  placeForSettings();
  applyClickThrough(s.clickThrough);
  win?.setOpacity(s.opacity);
  applyOnTop(s.alwaysOnTop);
  startFeed();
  send(CH.settings, s);
  refreshTray();
}

function resetAll(): Settings {
  setFullscreen(false);
  const s = store.reset();
  applyAll(s);
  return s;
}

// ---------- the Claude Code feed ----------

// Always on: the farm's only source of energy and food. If it can't start, the page says so quietly.
function startFeed(): void {
  let error: string | undefined;
  if (!feed) {
    try { feed = watchClaudeCode({ root: CLAUDE_DIR, onEvent: forward }); } catch (e) { error = 'The Claude Code feed could not start: ' + (e as Error).message; }
  }
  feedStatus = { watching: !!feed && feed.watching(), files: feed ? feed.files() : 0, root: CLAUDE_DIR, error };
  send(CH.feed, feedStatus);
}

function forward(raw: FarmEvent): void {
  const ev = normalizeEvent(raw);
  if (ev) send(CH.event, ev);
}

// ---------- full screen (the display's whole area, not the Mac's full-screen Space) ----------

function setFullscreen(on: boolean): boolean {
  if (!win) return false;
  if (on && !fullPrev) {
    fullPrev = win.getBounds();
    const d = screen.getDisplayMatching(fullPrev).bounds;
    win.setAlwaysOnTop(true, 'screen-saver');
    place({ x: d.x, y: d.y, width: d.width, height: d.height });
    send(CH.command, 'fullscreen-on' satisfies FarmCommand);
  } else if (!on && fullPrev) {
    const back = fullPrev;
    fullPrev = null;
    applyOnTop(store.get().alwaysOnTop);
    place(back);
    placeForSettings();
    send(CH.command, 'fullscreen-off' satisfies FarmCommand);
  }
  return !!fullPrev;
}

// ---------- dragging the window and resizing it ----------

// The window was dragged by its title bar: once it settles, dock it to a nearby corner or leave it where it is.
function onMoved(): void {
  if (!win || fullPrev || drag) return;
  const b = win.getBounds();
  if (same(lastPlaced, b)) return;
  const area = areaFor(b), dock = nearestDock(b, area);
  if (dock === 'free') {
    const c = clampToArea(b, area);
    update({ dock, bounds: c }, { place: false });
    if (same(c, b)) lastPlaced = b; else place(c);
  } else {
    update({ dock, bounds: b }, { place: false });
    placeForSettings(); // snap into the corner
  }
}

// Native edge resizing (where the platform allows it on a frameless window): keep 16:9 and remember the width.
function onResized(): void {
  if (!win || fullPrev || drag) return;
  const b = win.getBounds();
  if (same(lastPlaced, b)) return;
  lastPlaced = b;
  update({ size: 'custom', width: b.width, bounds: b }, { place: false });
  placeForSettings();
}

function onResizeDrag(d: ResizeDrag): void {
  if (!win || fullPrev) return;
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
    update({ size: 'custom', width: last.width, bounds: last }, { place: false });
  }
}

// ---------- the menu-bar icon ----------

function trayImage(): Electron.NativeImage {
  const img = nativeImage.createFromBitmap(antBitmap(1), { width: 16, height: 16, scaleFactor: 1 });
  img.addRepresentation({ buffer: antBitmap(2), width: 32, height: 32, scaleFactor: 2 });
  if (IS_MAC) img.setTemplateImage(true);
  return img;
}

function toElectron(items: TrayItem[]): MenuItemConstructorOptions[] {
  return items.map((it) => {
    const o: MenuItemConstructorOptions = { label: it.label, type: it.type, checked: it.checked, accelerator: it.accelerator, registerAccelerator: false };
    if (it.submenu) o.submenu = toElectron(it.submenu);
    if (it.action) { const a = it.action; o.click = () => runAction(a); }
    return o;
  });
}

function runAction(a: TrayAction): void {
  if (a.do === 'toggle-window') toggleWindow();
  else if (a.do === 'settings') { showWindow(true); send(CH.command, 'settings' satisfies FarmCommand); }
  else if (a.do === 'fullscreen') { showWindow(true); setFullscreen(!fullPrev); }
  else if (a.do === 'quit') app.quit();
  else if (a.do === 'set') { if (a.patch.dock || a.patch.size) setFullscreen(false); update(a.patch); }
}

function refreshTray(): void {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(toElectron(trayMenu(store.get(), !!win && win.isVisible(), CLICK_SHORTCUT))));
}

function showWindow(focus = false): void {
  if (!win) return;
  if (focus) win.show(); else win.showInactive();
  refreshTray();
}

function toggleWindow(): void {
  if (!win) return;
  if (win.isVisible()) win.hide(); else showWindow(true);
  refreshTray();
}

// ---------- start ----------

function createWindow(): void {
  const s = store.get();
  const b = boundsFor(s, areaFor(s.bounds));
  lastPlaced = b;
  win = new BrowserWindow({
    ...b,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: true, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
    alwaysOnTop: s.alwaysOnTop, title: 'Ant Farm',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      // the smoke test draws in a window that is never shown
      backgroundThrottling: !SMOKE,
    },
  });
  win.setAspectRatio(16 / 9);
  win.setMinimumSize(256, 144);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('move', () => { if (moveTimer) clearTimeout(moveTimer); moveTimer = setTimeout(onMoved, 350); });
  win.on('resized', onResized);
  win.on('show', refreshTray);
  win.on('hide', refreshTray);
  if (!SMOKE) win.once('ready-to-show', () => win?.showInactive());
  win.loadFile(path.join(__dirname, 'index.html'));
  applyAll(s);
}

function wireIpc(): void {
  ipcMain.handle(CH.state, (): FarmState => ({
    settings: store.get(), dark: nativeTheme.shouldUseDarkColors, platform: process.platform, fullscreen: !!fullPrev,
    feed: { ...feedStatus, watching: !!feed && feed.watching(), files: feed ? feed.files() : 0 }, smoke: !!SMOKE,
  }));
  ipcMain.handle(CH.set, (_e, patch: Partial<Settings>) => {
    if (patch && (patch.size || patch.dock)) setFullscreen(false);
    return update(patch || {});
  });
  ipcMain.handle(CH.reset, resetAll);
  ipcMain.handle(CH.fullscreen, (_e, on: boolean) => setFullscreen(!!on));
  ipcMain.on(CH.resize, (_e, d: ResizeDrag) => onResizeDrag(d));
  ipcMain.on(CH.grab, (_e, on: boolean) => { if (store.get().clickThrough) win?.setIgnoreMouseEvents(!on, { forward: true }); });
  ipcMain.on(CH.hide, () => { win?.hide(); });
  ipcMain.on(CH.quit, () => app.quit());
  ipcMain.handle(CH.save, (_e, data: unknown) => colony.save(data));
  ipcMain.on(CH.saveNow, (e, data: unknown) => { e.returnValue = colony.save(data); });
  ipcMain.handle(CH.load, () => colony.load());
}

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow(true));
  app.whenReady().then(() => {
    if (IS_MAC) app.dock?.hide(); // a menu-bar app: no Dock icon
    Menu.setApplicationMenu(null);
    store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
    colony = new ColonyFile(path.join(app.getPath('userData'), 'colony.json'));
    wireIpc();
    createWindow();
    nativeTheme.on('updated', () => send(CH.dark, nativeTheme.shouldUseDarkColors));
    screen.on('display-metrics-changed', placeForSettings);
    screen.on('display-removed', placeForSettings);
    if (SMOKE) {
      runSmoke({ win: win!, store, outDir: SMOKE, claudeDir: CLAUDE_DIR, update: (p) => update(p), resize: onResizeDrag, isFullscreen: () => !!fullPrev });
      return;
    }
    tray = new Tray(trayImage());
    tray.setToolTip('Ant Farm');
    if (!IS_MAC) tray.on('click', toggleWindow);
    refreshTray();
    globalShortcut.register(CLICK_SHORTCUT, () => update({ clickThrough: !store.get().clickThrough }));
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { store?.flush(); feed?.stop(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
