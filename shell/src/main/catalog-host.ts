// Hosts a catalog game (a "web" game, docs/catalog.md) inside the shell's window: one WebContentsView with its own
// session, sandboxed, with no Node and no Electron, a strict Content-Security-Policy and no network except the hosts
// the player approved. Its files are served from its folder under tg-game://<id>/ and nothing else is reachable.
// The only bridge is game-preload.ts (window.tokenGame): counts from the usage feed, its own save and settings, where
// it is shown, and pop out / dock.
//
// The shell's page keeps the orb, the card and the window around it and tells us where the game goes (setRect). In the
// orb the view is hidden and the orb shows the game's icon and count; in the card and the window the view sits over the
// page's placeholder.
import { ipcMain, protocol, session, WebContentsView, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { UsageEvent } from '../events';
import { checkGameData, cleanStatus, forHostedGame, GAME_CH, HIDE_WAIT_MS, MAX_SAVE_BYTES, MAX_SETTINGS_BYTES, type HostedEnv, type HostedStatus } from '../hosted';
import { allowRequest, cspFor, GAME_SCHEME } from '../catalog/permissions';
import { safeRelPath } from '../catalog/zip';

// Must run before the app is ready: tg-game:// behaves like https (its own origin, fetch works, secure context).
export function registerGameScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: GAME_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
};

export interface HostedGame { id: string; dir: string; page: string; network: string[]; saveDir: string }
export interface Rect { x: number; y: number; width: number; height: number }

export interface GameHostOptions {
  win: BrowserWindow; // the shell's window
  game: HostedGame;
  preload: string; // the built game-preload.js
  env(): HostedEnv;
  onStatus(s: HostedStatus): void;
  pop(): void;
  dock(): void;
  key(k: { key: string; meta: boolean; ctrl: boolean }): void;
}

export class GameHost {
  readonly view: WebContentsView;
  readonly blocked: string[] = []; // requests refused, newest last (the smoke test reads it)
  private rect: Rect | null = null;
  private radius = 0;
  private readonly disposers: (() => void)[] = [];
  private closed = false;

  constructor(private readonly o: GameHostOptions) {
    const { id, network } = o.game;
    const ses = session.fromPartition(`persist:tg-game-${id}`);
    const csp = cspFor(id, network);
    const root = fs.realpathSync(o.game.dir);
    if (ses.protocol.isProtocolHandled(GAME_SCHEME)) ses.protocol.unhandle(GAME_SCHEME); // an update may change its hosts
    ses.protocol.handle(GAME_SCHEME, (req) => serve(req.url, id, root, csp));
    ses.webRequest.onBeforeRequest((d, cb) => {
      const v = allowRequest(d.url, network, id);
      if (!v.allow) { this.blocked.push(d.url.slice(0, 200)); if (this.blocked.length > 50) this.blocked.shift(); }
      cb({ cancel: !v.allow });
    });
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false)); // no camera, microphone, notifications, location, …
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.on('will-download', (e) => e.preventDefault());

    this.view = new WebContentsView({
      webPreferences: {
        partition: `persist:tg-game-${id}`, preload: o.preload, sandbox: true, contextIsolation: true, nodeIntegration: false,
        nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
        devTools: false, spellcheck: false, navigateOnDragDrop: false, safeDialogs: true,
        // the game keeps real time while its view is hidden in the orb; it draws little there (env.scale 'mini')
        backgroundThrottling: false,
      },
    });
    const wc = this.view.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    const home = `${GAME_SCHEME}://${id}/`;
    wc.on('will-navigate', (e, url) => { if (!url.startsWith(home)) e.preventDefault(); });
    wc.on('will-redirect', (e, url) => { if (!url.startsWith(home)) e.preventDefault(); });
    wc.on('will-attach-webview', (e) => e.preventDefault());
    this.view.setBackgroundColor('#00000000');
    this.view.setVisible(false);
    o.win.contentView.addChildView(this.view);
    this.wireIpc();
    void wc.loadURL(home + o.game.page.split('/').map(encodeURIComponent).join('/'));
  }

  // Where the page wants the game, in the window's coordinates; null hides it (the orb, Settings open, flying).
  setRect(r: (Rect & { radius?: number }) | null): void {
    const ok = r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 8 && r.height >= 8;
    this.rect = ok ? { x: Math.round(r!.x), y: Math.round(r!.y), width: Math.round(r!.width), height: Math.round(r!.height) } : null;
    if (this.rect) {
      this.view.setBounds(this.rect);
      const rad = Number.isFinite(r!.radius) ? Math.max(0, Math.min(32, Math.round(r!.radius!))) : 0;
      if (rad !== this.radius) { this.radius = rad; this.view.setBorderRadius(rad); } // the card's rounded corners
    }
    this.view.setVisible(!!this.rect);
  }

  shown(): Rect | null { return this.rect; }

  usage(ev: UsageEvent): void { this.send(GAME_CH.usage, forHostedGame(ev)); }
  envChanged(): void { this.send(GAME_CH.envChanged, this.o.env()); }

  // Close it once it has saved: the game's onHide handlers run and answer, or HIDE_WAIT_MS passes (a game that never
  // answers, or one written for bridge version 1, is closed all the same).
  async closeAfterSave(): Promise<void> {
    const wc = this.view.webContents;
    if (!wc.isDestroyed() && !wc.isLoading()) {
      await new Promise<void>((done) => {
        const t = setTimeout(finish, HIDE_WAIT_MS);
        const l = (e: IpcMainEvent) => { if (e.sender === wc) finish(); };
        function finish(): void { clearTimeout(t); ipcMain.off(GAME_CH.hidden, l); done(); }
        ipcMain.on(GAME_CH.hidden, l);
        wc.send(GAME_CH.hide);
      });
    }
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const d of this.disposers.splice(0)) d();
    try { this.o.win.contentView.removeChildView(this.view); } catch { /* the window is gone */ }
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }

  private send(ch: string, v: unknown): void {
    const wc = this.view.webContents;
    if (!wc.isDestroyed() && !wc.isLoading()) wc.send(ch, v);
  }

  // Every call is checked: it must come from this game's view, and what it sends is size-limited plain JSON.
  private wireIpc(): void {
    const mine = (e: IpcMainEvent | IpcMainInvokeEvent) => e.sender === this.view.webContents;
    const file = (name: string) => path.join(this.o.game.saveDir, name);
    const handle = (ch: string, fn: (...a: unknown[]) => unknown) => {
      ipcMain.handle(ch, (e, ...a) => (mine(e) ? fn(...a) : null));
      this.disposers.push(() => ipcMain.removeHandler(ch));
    };
    const on = (ch: string, fn: (...a: unknown[]) => void) => {
      const l = (e: IpcMainEvent, ...a: unknown[]) => { if (mine(e)) fn(...a); };
      ipcMain.on(ch, l);
      this.disposers.push(() => ipcMain.off(ch, l));
    };
    handle(GAME_CH.env, () => this.o.env());
    handle(GAME_CH.load, () => readJson(file('save.json')));
    handle(GAME_CH.save, (d) => writeJson(file('save.json'), checkGameData(d, MAX_SAVE_BYTES)));
    handle(GAME_CH.getSettings, () => readJson(file('settings.json')) || {});
    handle(GAME_CH.setSettings, (d) => writeJson(file('settings.json'), checkGameData(d, MAX_SETTINGS_BYTES)));
    // At most ten updates a second reach the orb, so a game can't flood it; the latest one always arrives.
    let last = 0, latest: HostedStatus | null = null, timer: NodeJS.Timeout | null = null;
    const flush = () => { timer = null; last = Date.now(); if (latest) this.o.onStatus(latest); latest = null; };
    this.disposers.push(() => { if (timer) clearTimeout(timer); });
    on(GAME_CH.status, (s) => {
      const c = cleanStatus(s);
      if (!c) return;
      latest = c;
      if (!timer) timer = setTimeout(flush, Math.max(0, 100 - (Date.now() - last)));
    });
    on(GAME_CH.pop, () => this.o.pop());
    on(GAME_CH.dock, () => this.o.dock());
    on(GAME_CH.key, (k) => {
      const v = k as { key?: unknown; meta?: unknown; ctrl?: unknown };
      if (typeof v?.key === 'string' && v.key.length <= 16) this.o.key({ key: v.key, meta: v.meta === true, ctrl: v.ctrl === true });
    });
  }
}

// One file from the game's folder: a safe relative path that stays inside it after links are resolved.
async function serve(url: string, id: string, root: string, csp: string): Promise<Response> {
  const no = (status: number) => new Response(null, { status, headers: { 'content-security-policy': csp } });
  let u: URL;
  try { u = new URL(url); } catch { return no(400); }
  if (u.protocol !== GAME_SCHEME + ':' || u.hostname !== id) return no(404);
  let rel: string | null;
  try { rel = safeRelPath(decodeURIComponent(u.pathname).replace(/^\//, '')); } catch { return no(400); }
  if (!rel) return no(404);
  const file = path.join(root, rel);
  let real: string;
  try { real = fs.realpathSync(file); } catch { return no(404); }
  if (!real.startsWith(root + path.sep)) return no(404);
  try {
    const st = fs.statSync(real);
    if (!st.isFile()) return no(404);
    const data = fs.readFileSync(real);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'content-type': TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream', 'content-security-policy': csp,
        'x-content-type-options': 'nosniff', 'cross-origin-opener-policy': 'same-origin', 'cache-control': 'no-cache',
      },
    });
  } catch { return no(404); }
}

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file: string, text: string | null): boolean {
  if (text === null) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', text);
    fs.renameSync(file + '.tmp', file);
    return true;
  } catch { return false; }
}

// The game's icon as a data URL for the orb (the shell's page can't reach tg-game://). SVG in an <img> runs no script.
export function iconDataUrl(dir: string, icon: string | undefined): string {
  const rel = icon && safeRelPath(icon);
  if (!rel) return '';
  const type = TYPES[path.extname(rel).toLowerCase()];
  if (!type || !/^image\//.test(type)) return '';
  try {
    const root = fs.realpathSync(dir), real = fs.realpathSync(path.join(root, rel));
    if (!real.startsWith(root + path.sep) || fs.statSync(real).size > 64 * 1024) return '';
    return `data:${type};base64,${fs.readFileSync(real).toString('base64')}`;
  } catch { return ''; }
}
