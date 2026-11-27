// mountShell for a game built as a catalog bundle (docs/catalog.md, "A shell game in the catalog"). A game written for
// the shell's page (a Game, game.ts) runs unchanged inside the catalog sandbox: shell/scripts/build-web.mjs builds it
// with '@token-games/shell/page/shell-page' pointing here, so the same source makes the built-in app and the bundle.
//
// Inside the sandbox there is no tokenShell, only window.tokenGame (hosted.ts). The shell around the game (the orb, the
// card, the window and its title bar, the shell's Settings) belongs to the app that hosts it. What the game's own page
// added to those (its Settings sections and title-bar buttons) is shown here instead: a small tools corner over the
// game, and its Settings in a sheet of their own.
import type { FeedStatus } from '../api';
import type { Game, GameContext, Scale, Theme } from '../game';
import type { HostedEnv, TokenGameApi } from '../hosted';
import { ownSettings, randomSeed, toFeedStatus, toHostedStatus, toUsageEvent } from '../hosted-game';
import type { ShellState } from '../modes';
import { settingsKit, type SettingsKit, type ShellSettings } from '../settings';

declare global { interface Window { tokenGame?: TokenGameApi } }

const SLIDERS = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1 3h10M1 9h10"/><circle cx="4" cy="3" r="1.4" fill="currentColor"/><circle cx="8" cy="9" r="1.4" fill="currentColor"/></svg>';
// Keys the app's shell uses (game-preload.ts passes them on): the game leaves them alone, as it does in the app.
const SHELL_KEYS = new Set(['Escape', ',', 'o', 'h', '1', '2', 'f', 't', 'd']);

let kit: SettingsKit<any> = settingsKit<object>({ defaults: () => ({}), sanitize: () => ({}), reset: () => ({}) });

// The game's settings schema, which its main process gives the shell in the app. Call it before the game mounts.
export function configureHosted<S extends ShellSettings>(o: { settings: SettingsKit<S> }): void { kit = o.settings; }

const STATE: Record<Scale, ShellState> = { mini: 'orb', expanded: 'expanded', window: 'popped' };

// A shell game is written for the app, where its page is never hidden: the orb is a small window on screen and the
// scale says how much to draw (1–4 fps in the orb). The shell hides a catalog game's view while it rests in the orb
// or under Settings, so here the page counts as visible: the game keeps its real-time simulation and its orb count,
// and draws at its orb rate as it would in the app. The shell doesn't throttle a hidden game page (catalog-host.ts).
function alwaysVisible(): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
}

export function mountShell<S extends ShellSettings>(game: Game<S>): void {
  const api = window.tokenGame;
  const body = document.body;
  body.classList.add('tg', 'tgh');
  game.root.classList.add('tgh-root'); // the whole view is the game's
  if (!api) { body.append(Object.assign(document.createElement('p'), { className: 'tgh-alone', textContent: `${game.name} runs inside Token Games.` })); return; }
  alwaysVisible();

  const el = <T extends HTMLElement = HTMLElement>(tag: string, cls = '', html = ''): T => {
    const e = document.createElement(tag) as T;
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  };

  // ---------- the DOM: a tools corner, the game's Settings sheet, a line for news ----------

  const tools = el('div', 'tgh-tools');
  const gear = el<HTMLButtonElement>('button', 'tg-wbtn tgh-gear', SLIDERS);
  gear.id = 'tgh-gear'; gear.title = `${game.name} settings`;
  tools.append(...(game.barButtons || []), gear);
  const panel = el('div', 'tg-panel tgh-panel');
  panel.id = 'tgh-panel';
  panel.hidden = true;
  if (game.settingsPanel) { game.settingsPanel.hidden = false; panel.append(...Array.from(game.settingsPanel.children)); }
  const foot = el('section', '', '<div class="tg-chips"><button id="tgh-reset">Reset to defaults</button><button id="tgh-close">Close</button></div>');
  if (game.keysHelp) foot.append(el('p', 'tg-note tg-keys', ''));
  const keysNote = foot.querySelector('.tg-keys');
  if (keysNote) keysNote.textContent = game.keysHelp!;
  panel.append(foot);
  const news = el('div', 'tgh-news');
  body.append(tools, panel, news);

  // ---------- state ----------

  let S: S;
  let env: HostedEnv = { scale: 'mini', dark: false, reducedMotion: false, feed: { watching: false, files: 0 } };
  let feed: FeedStatus = toFeedStatus(undefined);
  let started = false, statusKey = '', themeKey = '', newsT = 0;
  let lastSave: Promise<unknown> = Promise.resolve();

  const persist = () => { void api.setSettings(ownSettings(S)); };
  const withEnv = (s: S): S => ({ ...s, reducedMotion: env.reducedMotion });
  const showScale = () => { body.dataset.scale = env.scale; tools.hidden = env.scale === 'mini'; };

  function applySettings(): void {
    body.classList.toggle('tg-rm', S.reducedMotion);
    if (started) game.onSettings?.(S);
  }

  function set(patch: Partial<S>): void {
    S = withEnv(kit.applyPatch(S, patch) as S);
    persist();
    applySettings();
  }

  function togglePanel(open = panel.hidden): void {
    if (open === !panel.hidden) return;
    panel.hidden = !open;
    gear.classList.toggle('on', open);
    game.onPanel?.(open);
  }

  function pulse(text: string, kind: 'hot' | 'task' = 'hot'): void {
    news.textContent = text;
    news.className = 'tgh-news show ' + kind;
    clearTimeout(newsT);
    newsT = window.setTimeout(() => { news.className = 'tgh-news'; }, 2600);
  }

  function setTheme(t: Theme): void {
    const key = t.back + t.bar + t.ink + t.hot;
    if (key === themeKey) return;
    themeKey = key;
    const st = document.documentElement.style;
    st.setProperty('--g-back', t.back); st.setProperty('--g-bar', t.bar); st.setProperty('--g-ink', t.ink); st.setProperty('--g-dim', t.dim);
    st.setProperty('--g-hot', t.hot); st.setProperty('--g-task', t.task || t.hot); st.setProperty('--g-line', t.line);
    let panelBg = t.panel;
    if (!panelBg && /^#[0-9a-f]{6}$/i.test(t.back)) {
      const n = parseInt(t.back.slice(1), 16);
      panelBg = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.94)`;
    }
    if (panelBg) st.setProperty('--g-panel', panelBg);
    st.background = t.back;
  }

  const ctx: GameContext<S> = {
    get settings() { return S; },
    get scale() { return env.scale; },
    get state() { return STATE[env.scale]; },
    topInset: 0, // the app's title bar sits above the game's view, never over it
    get dark() { return env.dark; },
    smoke: false, // a catalog game is never told it is being tested
    get feed() { return feed; },
    get panelOpen() { return !panel.hidden; },
    fullscreen: false, // the app's window is full screen or not; the game's view only grows with it
    set,
    reset: async () => { S = withEnv(kit.reset(S) as S); persist(); applySettings(); return S; },
    setStatus: (s) => {
      const st = toHostedStatus(s), key = JSON.stringify(st);
      if (key !== statusKey) { statusKey = key; api.setStatus(st); }
    },
    pulse,
    setTheme,
    setCalm: (c) => { if (body.classList.contains('tg-calm') !== c) body.classList.toggle('tg-calm', c); },
    openPanel: (open) => togglePanel(open),
    save: (d) => api.save(d),
    // The bridge only saves asynchronously; onHide below waits for this save before the shell closes the game.
    saveNow: (d) => { lastSave = api.save(d).catch(() => undefined); return true; },
    load: () => api.load(),
    hide: () => api.dock(), // the app hides itself; the nearest a game can ask for is the corner
    quit: () => { /* only the player quits the app */ },
  };

  gear.onclick = () => togglePanel();
  foot.querySelector<HTMLButtonElement>('#tgh-close')!.onclick = () => togglePanel(false);
  foot.querySelector<HTMLButtonElement>('#tgh-reset')!.onclick = () => { void ctx.reset(); };

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !started) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape' && !panel.hidden) { togglePanel(false); return; }
    if (SHELL_KEYS.has(k)) return;
    const tgt = e.target as HTMLInputElement;
    if (tgt.tagName === 'INPUT' && tgt.type === 'range' && k.startsWith('Arrow')) return;
    if (game.onKey && game.onKey(k, e)) e.preventDefault();
  });

  // ---------- start ----------

  void (async () => {
    env = await api.env();
    feed = toFeedStatus(env.feed);
    const raw = await api.getSettings();
    S = withEnv(kit.sanitize(raw, kit.defaults(randomSeed())) as S);
    if (!raw || !Object.keys(raw).length) persist(); // a first run keeps its seed, and so its map
    body.classList.toggle('tg-dark', env.dark);
    body.classList.toggle('tg-rm', S.reducedMotion);
    showScale();
    api.onUsage((h) => { const ev = toUsageEvent(h); if (ev && started) game.onEvent(ev); });
    api.onEnv((next) => {
      const prev = env;
      env = next;
      if (next.scale !== prev.scale) { showScale(); if (next.scale === 'mini') togglePanel(false); game.onScale?.(next.scale); }
      if (next.dark !== prev.dark) { body.classList.toggle('tg-dark', next.dark); game.onDark?.(next.dark); }
      if (next.reducedMotion !== S.reducedMotion) { S = withEnv(S); applySettings(); }
      const f = toFeedStatus(next.feed);
      if (f.watching !== feed.watching || f.files !== feed.files) { feed = f; game.onFeed?.(f); }
    });
    if (typeof api.onHide === 'function') api.onHide(async () => { game.onHide?.(); await lastSave; }); // bridge version 2
    window.addEventListener('pagehide', () => game.onHide?.());
    await game.start(ctx);
    started = true;
    game.onScale?.(env.scale);
  })();
}
