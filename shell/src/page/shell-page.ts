// The shell's side of a game's page: builds the corner orb (its round live view, the hover pill, the open card), the
// popped-out window's frame (title bar, grip, size tag) and the Settings sheet, moves the game's root between them,
// and handles the keys and settings every game shares. The Settings sheet stays hidden in this page: the Settings
// window, centred on the screen like the Games window, shows a copy of it and sends the player's input back (mirror.ts). A game's page calls mountShell(game) once and does the rest through the
// GameContext it gets back in start().
//
// The main process decides the state (modes.ts); this page only shows it and sends intents (click, Esc, Pop out, …)
// and, while the orb is dragged, the pointer in screen coordinates.
//
// When the player chose a catalog game (docs/catalog.md), the page hosts it instead of its own game: the built-in game
// never starts (its save stays as it is), the orb shows the catalog game's icon and count, and in the card and the
// window the main process lays the game's sandboxed view over a placeholder here (hostedRect).
import type { FeedStatus, HostedBoot, ModeInfo, ShellApi, ShellBoot, ShellCommand } from '../api';
import type { Game, GameContext, GameStatusLine, Theme } from '../game';
import { gripCorner } from '../geometry';
import { gamesPanel } from './games-panel';
import { replay, snapshot } from './mirror';
import { scaleOf, shapeOf, type Scale, type ShellEvent, type ShellState } from '../modes';
import { CARD, shapeSize } from '../orb';
import { DOCKS, type ShellSettings } from '../settings';

declare global { interface Window { tokenShell: ShellApi<any>; shellTest?: Record<string, unknown>; gameTest?: Record<string, unknown> } }

const BAR = 20, BAR_FULL = 26, GRIP = 14;
const FADE_MS = 130; // the page fades out this long before the window flies (main waits a little longer)
const DRAG_PX = 4; // the orb follows the pointer only once it has moved this far, so a click stays a click
const MIRROR_MS = 80, THUMBS_MS = 1000; // the Settings window's copy follows changes this soon; canvases once a second
const SHELL_KEYS = 'Esc closes · , settings · O pop out / back to the corner · H hide · popped out: 1 small · 2 large · F full screen · T click-through · D dock';

const GEAR = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="6" cy="6" r="1.8"/><path d="M6 .8v1.6M6 9.6v1.6M.8 6h1.6M9.6 6h1.6M2.3 2.3l1.1 1.1M8.6 8.6l1.1 1.1M2.3 9.7l1.1-1.1M8.6 3.4l1.1-1.1"/></svg>';
const FULL = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1 4.5V1h3.5M11 4.5V1H7.5M1 7.5V11h3.5M11 7.5V11H7.5"/></svg>';
const HIDE = '<svg viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.5"><path d="M2.5 6h7"/></svg>';

const DISPLAY_HTML = `
<h4>Display</h4>
<div class="tg-row">Lives <span class="tg-chips" id="tg-pres"><button data-pres="orb">In the corner</button><button data-pres="floating">Floating window</button></span></div>
<div class="tg-row">Corner <span class="tg-docks" id="tg-corners">
  <button data-corner="tl" title="Top left">◰</button><button data-corner="tr" title="Top right">◳</button>
  <button data-corner="bl" title="Bottom left">◱</button><button data-corner="br" title="Bottom right">◲</button></span></div>
<p class="tg-note" id="tg-presNote"></p>
<div class="tg-floatset">
  <div class="tg-chips" id="tg-sizes"><button data-size="small">Small</button><button data-size="large">Large</button><button id="tg-pFull">Full screen</button></div>
  <p class="tg-note" id="tg-sizeNote"></p>
  <div class="tg-row">Dock <span class="tg-docks" id="tg-docks">
    <button data-dock="tl" title="Top left">◰</button><button data-dock="tr" title="Top right">◳</button>
    <button data-dock="bl" title="Bottom left">◱</button><button data-dock="br" title="Bottom right">◲</button>
    <button data-dock="free" title="Where I drop it">free</button></span></div>
  <label class="tg-row">Opacity <input type="range" id="tg-opacity" min="25" max="100" step="5"><output id="tg-opacityV"></output></label>
  <label class="tg-row"><input type="checkbox" id="tg-alwaysOnTop"> Always on top</label>
  <label class="tg-row"><input type="checkbox" id="tg-clickThrough"> Click-through (hold Alt to grab it)</label>
</div>
<label class="tg-row"><input type="checkbox" id="tg-reducedMotion"> Reduced motion</label>`;

export function mountShell<S extends ShellSettings>(builtIn: Game<S>): void {
  const api = window.tokenShell as ShellApi<S>;
  let game = builtIn; // or a stand-in for a hosted catalog game (hostIn)
  const el = <T extends HTMLElement = HTMLElement>(tag: string, cls = '', html = ''): T => {
    const e = document.createElement(tag) as T;
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  };
  const body = document.body;

  // ---------- the DOM ----------

  // In the corner: one shape that is the orb at rest, the pill on hover and the card when open, always hugging the
  // corner of the screen, so each grows out of the orb.
  const shape = el('div', 'tg-shape');
  shape.id = 'tg-shape';
  const orb = el('div', 'tg-orb'), eye = el('div', 'tg-eye'), badge = el('span', 'tg-badge');
  orb.append(eye, badge);
  const pill = el('div', 'tg-pillc'), pillName = el('div', 'tg-pname'), pillLine = el('div', 'tg-line');
  const pillTitle = el('b'), pillCount = el('span', 'tg-pcount');
  pillTitle.textContent = game.name;
  pillName.append(el('span', 'tg-icon', game.icon || ''), pillTitle, pillCount);
  pill.append(pillName, pillLine);
  const card = el('div', 'tg-card'), big = el('div', 'tg-big'), cardBar = el('div', 'tg-cbar');
  const popBtn = el<HTMLButtonElement>('button', 'tg-pill', 'Pop out ↗'), setBtn = el<HTMLButtonElement>('button', 'tg-pill', 'Settings');
  const gamesBtn = el<HTMLButtonElement>('button', 'tg-pill tg-gamesbtn', 'Games');
  const shrinkBtn = el<HTMLButtonElement>('button', 'tg-pill tg-shrink', '–');
  popBtn.id = 'tg-pop'; popBtn.title = 'Pop out into a floating window (O)';
  setBtn.id = 'tg-set'; setBtn.title = 'Settings (,)';
  gamesBtn.id = 'tg-gamesbtn'; gamesBtn.title = 'Games: switch, install and update games';
  shrinkBtn.id = 'tg-shrink'; shrinkBtn.title = 'Back to the orb (Esc)';
  const cardLine = el('span', 'tg-line');
  cardBar.append(cardLine, el('span', 'tg-sp'), popBtn, gamesBtn, setBtn, shrinkBtn);
  card.append(big, cardBar);
  shape.append(card, pill, orb);

  const win = el('div', 'tg-win');
  win.id = 'tg-win';
  const bar = el('div', 'tg-bar'), pulseDot = el('span', 'tg-pulse'), name = el('span', 'tg-name'), meter = el('span', 'tg-meter'), evt = el('span', 'tg-evt');
  bar.id = 'tg-bar';
  name.textContent = game.name;
  const wbtns = el('span', 'tg-wbtns');
  const wbtn = (id: string, title: string, html: string) => { const b = el<HTMLButtonElement>('button', 'tg-wbtn', html); b.id = id; b.title = title; return b; };
  const dockBtn = wbtn('tg-dock', 'Back to the corner (O)', '↩ Corner');
  dockBtn.classList.add('tg-text');
  const fullBtn = wbtn('tg-full', 'Full screen (F; Esc leaves)', FULL), gearBtn = wbtn('tg-gear', 'Settings (,)', GEAR), hideBtn = wbtn('tg-hide', 'Hide to the menu bar (H)', HIDE);
  const gamesWBtn = wbtn('tg-gamesw', 'Games: switch, install and update games', 'Games');
  gamesWBtn.classList.add('tg-text', 'tg-gamesbtn');
  wbtns.append(...(game.barButtons || []), dockBtn, fullBtn, gamesWBtn, gearBtn, hideBtn);
  bar.append(pulseDot, name, meter, evt, wbtns);
  const host = el('div', 'tg-host'), grip = el('div', 'tg-grip br'), sizetag = el('div', 'tg-sizetag');
  grip.title = 'Drag to resize (keeps 16:9)';
  win.append(host, bar, grip, sizetag);

  const panel = el('div', 'tg-panel');
  panel.id = 'tg-panel';
  panel.hidden = true;
  const ownSettings = game.settingsPanel ? Array.from(game.settingsPanel.children) : [];
  if (game.settingsPanel) { game.settingsPanel.hidden = false; panel.append(...ownSettings); }
  const games = gamesPanel(api, {
    layout: 'summary', onUpdates: showUpdates, openWindow: () => api.openGames(),
    onAgentRequest: (r) => pulse(`${r.action === 'remove' ? 'Remove' : 'Install'} ${r.name}? An agent asked: see Games`, 'task'),
  });
  const display = el('section', 'tg-display', DISPLAY_HTML);
  const foot = el('section', 'tg-foot', '<div class="tg-chips"><button id="tg-reset">Reset to defaults</button><button id="tg-close">Close</button></div><p class="tg-note tg-keys" id="tg-keys"></p>');
  panel.append(games.el, display, foot);
  body.append(shape, win, panel);
  body.classList.add('tg');
  game.root.classList.add('tg-root');

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => panel.querySelector('#' + id) as T;
  $('tg-keys').textContent = (game.keysHelp ? game.keysHelp + ' · ' : '') + 'Keys: ' + SHELL_KEYS;

  // ---------- state ----------

  let S: S, dark = true, smoke = false, feed: FeedStatus | null = null, full = false;
  let mode: ModeInfo = { state: 'orb', geo: { corner: 'br', area: { x: 0, y: 0, width: 1440, height: 900 }, card: { ...CARD } }, visible: true };
  let shown: ShellState = 'orb'; // the layout on screen (lags the state by the fade while flying)
  let scale: Scale = 'mini', flyT = 0, evtT = 0, sizeT = 0, grab = false, started = false;
  let hosted: HostedBoot | null = null, placeRaf = 0, settingsOpen = false;
  const status = { count: '', title: '', lead: '', line: '', warm: false };

  const topInset = (): number => (scale === 'window' ? (full ? BAR_FULL : BAR) : 0);
  const intent = (ev: ShellEvent) => api.intent(ev);

  const ctx: GameContext<S> = {
    get settings() { return S; },
    get scale() { return scale; },
    get state() { return mode.state; },
    get topInset() { return topInset(); },
    get dark() { return dark; },
    get smoke() { return smoke; },
    get feed() { return feed; },
    get panelOpen() { return settingsOpen; },
    get fullscreen() { return full; },
    set,
    reset: () => api.resetSettings().then((s) => { S = s; applySettings(); return s; }),
    setStatus,
    pulse,
    setTheme,
    setCalm: (c: boolean) => { if (body.classList.contains('tg-calm') !== c) body.classList.toggle('tg-calm', c); },
    openPanel: (open?: boolean) => togglePanel(open),
    save: (d) => api.saveGame(d),
    saveNow: (d) => api.saveGameNow(d),
    load: () => api.loadGame(),
    hide: hideWindow,
    quit: () => api.quit(),
  };

  function set(patch: Partial<S>): void {
    S = { ...S, ...patch }; // show it at once; the main process confirms with the saved settings
    applySettings();
    api.setSettings(patch).then((s) => { S = s; applySettings(); });
  }

  function hideWindow(): void {
    game.onHide?.();
    api.hide();
  }

  // ---------- the layout for each state ----------

  function showMode(): void {
    const st = mode.state;
    body.dataset.corner = mode.geo.corner;
    body.classList.toggle('tg-flying', st === 'popping' || st === 'docking');
    clearTimeout(flyT);
    placeHosted();
    // flying: fade out, then swap the layout while the window moves (with reduced motion there is no flight)
    if ((st === 'popping' || st === 'docking') && !S?.reducedMotion) flyT = window.setTimeout(() => layout(st), FADE_MS);
    else layout(st);
  }

  function layout(st: ShellState): void {
    shown = st;
    body.dataset.state = st;
    const sh = shapeOf(st);
    if (sh) {
      const s = shapeSize(sh, mode.geo);
      shape.style.width = s.width + 'px';
      shape.style.height = s.height + 'px';
    }
    const sc = scaleOf(st === 'docking' ? 'orb' : st);
    const where = sc === 'window' ? host : sc === 'expanded' ? big : eye;
    if (game.root.parentElement !== where) where.appendChild(game.root);
    if (sc !== 'window' && full) setFull(false);
    if (sc !== scale) { scale = sc; game.onScale?.(sc); }
    renderPanel();
    placeHosted();
  }

  // ---------- a hosted catalog game ----------

  // The built-in game steps aside: it never starts, so it never loads or saves. A placeholder takes its place in the
  // orb (with the game's icon), the card and the window, and the sandboxed view is laid over it by the main process.
  function hostIn(h: HostedBoot): void {
    hosted = h;
    builtIn.root.remove();
    for (const n of ownSettings) n.remove();
    for (const b of builtIn.barButtons || []) b.remove();
    pillTitle.textContent = name.textContent = h.name;
    (pillName.querySelector('.tg-icon') as HTMLElement).textContent = '';
    $('tg-keys').textContent = 'Keys: ' + SHELL_KEYS;
    const root = el('div', 'tg-hosted');
    if (h.icon) { const img = el<HTMLImageElement>('img', 'tg-hicon'); img.src = h.icon; img.alt = ''; root.append(img); }
    game = { name: h.name, root, start: () => {}, onEvent: () => {} };
    root.classList.add('tg-root');
    body.classList.add('tg-hosting');
    new ResizeObserver(placeHosted).observe(root);
    api.onHostedStatus((s) => setStatus({ count: s.count, title: s.title, line: s.line, warm: s.warm }));
    // a shell key pressed while the game had focus (Esc, Settings, Pop out, …)
    api.onHostedKey((k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k.key, metaKey: k.meta, ctrlKey: k.ctrl })));
  }

  // Where the hosted view goes: over the placeholder in the card or the window, below the title bar and clear of the
  // resize grip. Hidden in the orb, while Settings is open (it would cover the sheet) and while the window flies.
  function placeHosted(): void {
    if (!hosted || placeRaf) return;
    placeRaf = requestAnimationFrame(() => {
      placeRaf = 0;
      if (scale === 'mini' || body.classList.contains('tg-flying') || !S) { api.hostedRect(null, scale); return; }
      const r = game.root.getBoundingClientRect();
      let y = r.top, height = r.height, radius = 17;
      if (scale === 'window') {
        const top = topInset(), gripAtBottom = gripCorner(S.dock).startsWith('b');
        y += top; height -= top;
        if (!full) { height -= GRIP; if (!gripAtBottom) y += GRIP; }
        radius = full || gripAtBottom ? 0 : 10;
      }
      api.hostedRect({ x: r.left, y, width: r.width, height, radius }, scale);
    });
  }

  // ---------- status, pulse, theme ----------

  function setStatus(s: GameStatusLine): void {
    const lead = s.lead || '', line = s.line || '', warm = !!s.warm;
    if (warm !== status.warm) { status.warm = warm; orb.classList.toggle('warm', warm); }
    if (s.count !== status.count || s.title !== status.title) {
      status.count = s.count; status.title = s.title;
      badge.textContent = s.count;
      pillCount.textContent = s.count ? s.count + ' ' + s.title : '';
      orb.title = game.name + (s.count ? ': ' + s.count + ' ' + s.title : '');
      api.status({ count: s.count, title: s.title });
    }
    if (lead === status.lead && line === status.line) return;
    status.lead = lead; status.line = line;
    for (const host of [meter, pillLine, cardLine]) {
      host.textContent = '';
      if (lead) { const b = document.createElement('b'); b.textContent = lead; host.append(b, line ? ' · ' : ''); }
      host.append(line);
    }
  }

  function pulse(text: string, kind: 'hot' | 'task' = 'hot'): void {
    for (const p of [pulseDot, orb]) { p.classList.remove('hot', 'task'); void p.offsetWidth; p.classList.add(kind); }
    evt.textContent = text;
    evt.classList.add('show');
    body.classList.add('tg-news');
    pillLine.dataset.news = cardLine.dataset.news = text;
    clearTimeout(evtT);
    evtT = window.setTimeout(() => {
      evt.classList.remove('show');
      body.classList.remove('tg-news');
      for (const p of [pulseDot, orb]) p.classList.remove('hot', 'task');
    }, 2600);
  }

  let themeKey = '';
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
  }

  // ---------- settings ----------

  function applySettings(): void {
    body.classList.toggle('tg-thru', S.clickThrough);
    body.classList.toggle('tg-rm', S.reducedMotion);
    grip.className = 'tg-grip ' + gripCorner(S.dock);
    renderPanel();
    placeHosted();
    if (started) game.onSettings?.(S);
  }

  function buildPanel(): void {
    for (const b of $('tg-pres').querySelectorAll<HTMLButtonElement>('[data-pres]')) b.onclick = () => set({ presentation: b.dataset.pres } as Partial<S>);
    for (const b of $('tg-sizes').querySelectorAll<HTMLButtonElement>('[data-size]')) b.onclick = () => set({ size: b.dataset.size } as Partial<S>);
    for (const b of $('tg-docks').querySelectorAll<HTMLButtonElement>('[data-dock]')) b.onclick = () => set({ dock: b.dataset.dock } as Partial<S>);
    for (const b of $('tg-corners').querySelectorAll<HTMLButtonElement>('[data-corner]')) b.onclick = () => set({ corner: b.dataset.corner } as Partial<S>);
    const op = $<HTMLInputElement>('tg-opacity');
    op.oninput = () => set({ opacity: +op.value / 100 } as Partial<S>);
    for (const id of ['alwaysOnTop', 'clickThrough', 'reducedMotion'] as const) {
      const c = $<HTMLInputElement>('tg-' + id);
      c.onchange = () => set({ [id]: c.checked } as Partial<S>);
    }
    $('tg-pFull').onclick = () => toggleFull();
    $('tg-reset').onclick = () => { void ctx.reset(); };
    $('tg-close').onclick = () => togglePanel(false);
  }

  function renderPanel(): void {
    if (!S || !settingsOpen) return;
    const floating = scale === 'window';
    for (const b of $('tg-pres').querySelectorAll<HTMLButtonElement>('[data-pres]')) b.classList.toggle('on', b.dataset.pres === S.presentation);
    for (const b of $('tg-corners').querySelectorAll<HTMLButtonElement>('[data-corner]')) b.classList.toggle('on', b.dataset.corner === S.corner);
    $('tg-presNote').textContent = S.presentation === 'orb'
      ? 'An orb in a corner of the screen: hover for the status, click to open, drag it to another corner. Pop out for a window you can move and resize.'
      : 'A floating window. ↩ Corner puts it back in its corner.';
    for (const b of $('tg-sizes').querySelectorAll<HTMLButtonElement>('[data-size]')) b.classList.toggle('on', !full && b.dataset.size === S.size);
    $('tg-pFull').classList.toggle('on', full);
    ($('tg-pFull') as HTMLButtonElement).disabled = !floating;
    $('tg-sizeNote').textContent = full ? 'Full screen: Esc or F to leave.'
      : S.size === 'custom' ? `Your size: ${S.width} × ${Math.round((S.width * 9) / 16)} (drag the corner grip)` : 'Drag the corner grip for any size in between.';
    for (const b of $('tg-docks').querySelectorAll<HTMLButtonElement>('[data-dock]')) b.classList.toggle('on', b.dataset.dock === S.dock);
    const op = $<HTMLInputElement>('tg-opacity');
    if (document.activeElement !== op) op.value = String(Math.round(S.opacity * 100));
    $('tg-opacityV').textContent = Math.round(S.opacity * 100) + '%';
    for (const id of ['alwaysOnTop', 'clickThrough', 'reducedMotion'] as const) $<HTMLInputElement>('tg-' + id).checked = S[id];
  }

  // Settings opens in its own window, or brings the open one to the front; the main process says when it opened or closed.
  function togglePanel(open = !settingsOpen): void {
    api.openSettings(open);
  }

  function settingsWindow(open: boolean): void {
    if (open === settingsOpen) return;
    settingsOpen = open;
    renderPanel();
    if (open) games.refresh();
    mirror(open);
    game.onPanel?.(open);
  }

  // While the Settings window is open it gets the sheet after every change, and once a second for the game's canvases
  // (palette thumbnails and the like, drawn without changing the DOM). Only what changed is sent.
  const watch = new MutationObserver(() => sendSheet());
  let mirrorT = 0, thumbsT = 0, lastSheet = '';
  function mirror(on: boolean): void {
    watch.disconnect(); clearInterval(thumbsT); clearTimeout(mirrorT); mirrorT = 0; lastSheet = '';
    if (!on) return;
    watch.observe(panel, { subtree: true, childList: true, attributes: true, characterData: true });
    thumbsT = window.setInterval(sendSheet, THUMBS_MS);
    sendSheet();
  }
  function sendSheet(): void {
    if (mirrorT || !settingsOpen) return;
    mirrorT = window.setTimeout(() => {
      mirrorT = 0;
      const html = snapshot(panel);
      if (html === lastSheet) return;
      lastSheet = html;
      const css = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'), (l) => l.getAttribute('href') || '')
        .filter((h) => /^[\w.-]+\.css$/.test(h) && h !== 'shell.css');
      api.settingsSnap({ html, css });
    }, MIRROR_MS);
  }

  // An installed game has a newer version in the catalog: a dot on the Games buttons.
  function showUpdates(n: number): void {
    body.classList.toggle('tg-update', n > 0);
    const t = n ? `Games: ${n === 1 ? 'an update is' : n + ' updates are'} available` : 'Games: switch, install and update games';
    gamesBtn.title = gamesWBtn.title = t;
  }

  function toggleFull(on = !full): void {
    if (scale !== 'window') return;
    api.setFullscreen(on).then(setFull);
  }
  function setFull(on: boolean): void {
    if (on === full) return;
    full = on;
    body.classList.toggle('tg-full', on);
    renderPanel();
    placeHosted();
    game.onFullscreen?.(on);
  }

  // ---------- input ----------

  // The orb and the pill: a click opens the card; a drag (past DRAG_PX) carries the orb to another corner, the main
  // process moving the window under the pointer and settling it in the nearest corner on release.
  let press: { id: number; x: number; y: number; dragging: boolean } | null = null;
  shape.addEventListener('pointerdown', (e) => {
    if ((shown !== 'orb' && shown !== 'hover') || e.button !== 0) return;
    press = { id: e.pointerId, x: e.screenX, y: e.screenY, dragging: false };
    try { shape.setPointerCapture(e.pointerId); } catch { /* the smoke test's pointer is not a real one */ }
  });
  shape.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.dragging) {
      if (Math.hypot(e.screenX - press.x, e.screenY - press.y) < DRAG_PX) return;
      press.dragging = true;
      body.classList.add('tg-dragging');
      api.orbDrag({ phase: 'start', x: press.x, y: press.y });
    }
    api.orbDrag({ phase: 'move', x: e.screenX, y: e.screenY });
  });
  const release = (e: PointerEvent, cancel: boolean) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    if (p.dragging) { body.classList.remove('tg-dragging'); api.orbDrag({ phase: 'end', x: e.screenX, y: e.screenY }); }
    else if (!cancel) intent('click');
  };
  shape.addEventListener('pointerup', (e) => release(e, false));
  shape.addEventListener('pointercancel', (e) => release(e, true));
  shrinkBtn.onclick = (e) => { e.stopPropagation(); intent('escape'); };
  popBtn.onclick = (e) => { e.stopPropagation(); intent('pop'); };
  // The Games buttons open the Games window (or bring it to the front); the card and the game stay as they are.
  setBtn.onclick = (e) => { e.stopPropagation(); togglePanel(true); };
  gamesBtn.onclick = (e) => { e.stopPropagation(); api.openGames(); };
  dockBtn.onclick = () => intent('dock');
  fullBtn.onclick = () => toggleFull();
  gearBtn.onclick = () => togglePanel(true);
  gamesWBtn.onclick = () => api.openGames();
  hideBtn.onclick = () => hideWindow();

  const cycle = <T,>(list: readonly T[], cur: T): T => list[(list.indexOf(cur) + 1) % list.length];

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'q') { api.quit(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { togglePanel(true); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || !S) return;
    const tgt = e.target as HTMLInputElement;
    if (tgt.tagName === 'INPUT' && tgt.type === 'range' && e.key.startsWith('Arrow')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, inWin = scale === 'window';
    if (k === 'Escape') {
      if (full) toggleFull(false);
      else if (shown === 'expanded' || shown === 'hover') intent('escape');
    } else if (k === ',') togglePanel(true);
    else if (k === 'o') intent(inWin ? 'dock' : 'pop');
    else if (k === 'h') hideWindow();
    else if (inWin && k === '1') set({ size: 'small' } as Partial<S>);
    else if (inWin && k === '2') set({ size: 'large' } as Partial<S>);
    else if (inWin && k === 'f') toggleFull();
    else if (inWin && k === 't') set({ clickThrough: !S.clickThrough } as Partial<S>);
    else if (inWin && k === 'd') set({ dock: cycle(DOCKS, S.dock) } as Partial<S>);
    else if (!(game.onKey && game.onKey(k, e))) return;
    e.preventDefault();
  });

  // Resizing from the grip: the main process does the 16:9 maths in screen coordinates.
  let resizing = false;
  grip.addEventListener('pointerdown', (e) => { resizing = true; grip.setPointerCapture(e.pointerId); api.resizeDrag({ phase: 'start', x: e.screenX, y: e.screenY }); });
  grip.addEventListener('pointermove', (e) => { if (resizing) api.resizeDrag({ phase: 'move', x: e.screenX, y: e.screenY }); });
  const endResize = (e: PointerEvent) => { if (!resizing) return; resizing = false; api.resizeDrag({ phase: 'end', x: e.screenX, y: e.screenY }); };
  grip.addEventListener('pointerup', endResize);
  grip.addEventListener('pointercancel', endResize);
  window.addEventListener('resize', () => {
    placeHosted();
    if (scale !== 'window') return;
    sizetag.textContent = window.innerWidth + ' × ' + window.innerHeight;
    sizetag.classList.add('show');
    clearTimeout(sizeT);
    sizeT = window.setTimeout(() => sizetag.classList.remove('show'), 1200);
  });

  // Click-through: the window lets clicks pass but still sees the pointer; hold Alt over it to take it back.
  document.addEventListener('mousemove', (e) => {
    if (!S || !S.clickThrough || scale !== 'window') return;
    if (e.altKey !== grab) { grab = e.altKey; body.classList.toggle('tg-grab', grab); api.setGrab(grab); }
  });
  document.addEventListener('mouseleave', () => { if (grab) { grab = false; body.classList.remove('tg-grab'); api.setGrab(false); } });
  window.addEventListener('beforeunload', () => game.onHide?.());

  // ---------- start ----------

  buildPanel();
  api.getState().then(async (st: ShellBoot<S>) => {
    S = st.settings; dark = st.dark; feed = st.feed; smoke = st.smoke; mode = st.mode;
    if (st.hosted) hostIn(st.hosted);
    body.classList.toggle('tg-dark', dark);
    applySettings();
    showMode();
    full = false;
    setFull(st.fullscreen);
    api.onSettings((s) => { S = s; applySettings(); });
    api.onDark((d) => { dark = d; body.classList.toggle('tg-dark', d); game.onDark?.(d); });
    api.onSleep((a) => game.onSleep?.(a));
    api.onEvent((ev) => game.onEvent(ev));
    api.onFeed((f) => { feed = f; game.onFeed?.(f); });
    api.onCommand((c: ShellCommand) => setFull(c === 'fullscreen-on'));
    api.onSettingsWindow(settingsWindow);
    api.onSettingsInput((i) => { if (settingsOpen) replay(panel, i); });
    api.onMode((m) => { mode = m; showMode(); });
    await game.start(ctx);
    started = true;
    if (st.settingsOpen) settingsWindow(true);
    if (smoke) exposeTest();
  });

  // For the automated smoke test only: views of the shell's page, and a way to press keys and click like a player.
  function exposeTest(): void {
    const ptr = (type: string, x: number, y: number) =>
      shape.dispatchEvent(new PointerEvent(type, { pointerId: 7, button: 0, screenX: x, screenY: y, bubbles: true }));
    window.shellTest = {
      state: () => ({
        state: mode.state, shown, scale, corner: body.dataset.corner, panelOpen: settingsOpen, update: body.classList.contains('tg-update'), full, thru: body.classList.contains('tg-thru'),
        shape: { w: shape.offsetWidth, h: shape.offsetHeight }, root: { w: game.root.clientWidth, h: game.root.clientHeight },
        rootIn: game.root.parentElement?.className || '', count: badge.textContent, line: cardLine.textContent, topInset: topInset(),
        warm: orb.classList.contains('warm'), pill: pill.innerText,
        presentation: S.presentation, back: getComputedStyle(document.documentElement).getPropertyValue('--g-back').trim(),
      }),
      key: (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key })),
      click: (id: string) => (document.getElementById(id) as HTMLElement).click(),
      // a press and release on the orb without moving: a click
      clickOrb: () => { ptr('pointerdown', 100, 100); ptr('pointerup', 100, 100); },
      // a press on the orb at (x, y) on screen, moved in steps by (dx, dy), then released: a drag
      dragOrb: (x: number, y: number, dx: number, dy: number) => {
        ptr('pointerdown', x, y);
        for (let i = 1; i <= 4; i++) ptr('pointermove', x + (dx * i) / 4, y + (dy * i) / 4);
        ptr('pointerup', x + dx, y + dy);
      },
      text: () => panel.innerText + '\n' + bar.innerText,
      // where an element is in the window (CSS pixels), for real mouse input from the main process
      rect: (sel: string) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; },
      // Settings → Games: what it shows, and its buttons by their data-games name ("refresh", "approve:<request>", …)
      games: () => ({ view: games.view(), text: games.el.innerText, hosted: hosted?.id || null, icon: !!game.root.querySelector('.tg-hicon') }),
      gamesClick: (name: string) => {
        const b = games.el.querySelector<HTMLButtonElement>(`[data-games="${CSS.escape(name)}"]`);
        if (!b || b.disabled) return false;
        b.click();
        return true;
      },
    };
    if (game.testHooks) window.gameTest = game.testHooks();
  }
}
