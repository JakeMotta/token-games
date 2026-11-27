// The shell's side of a game's page: builds the island (the notch strip, the peek, the drop-down), the popped-out
// window's frame (title bar, grip, size tag) and the Settings sheet, moves the game's root between them, and handles
// the keys and settings every game shares. A game's page calls mountShell(game) once and does the rest through the
// GameContext it gets back in start().
//
// The main process decides the state (modes.ts); this page only shows it and sends intents (click, Esc, Pop out, …).
import type { FeedStatus, ModeInfo, ShellApi, ShellBoot, ShellCommand } from '../api';
import type { Game, GameContext, GameStatusLine, Theme } from '../game';
import { gripCorner } from '../geometry';
import { scaleOf, shapeOf, type Scale, type ShellEvent, type ShellState } from '../modes';
import { islandSize } from '../notch';
import { DOCKS, type ShellSettings } from '../settings';

declare global { interface Window { tokenShell: ShellApi<any>; shellTest?: Record<string, unknown>; gameTest?: Record<string, unknown> } }

const BAR = 20, BAR_FULL = 26;
const FADE_MS = 130; // the page fades out this long before the window flies (main waits a little longer)
const SHELL_KEYS = 'Esc closes · , settings · O pop out / back to the notch · H hide · popped out: 1 small · 2 large · F full screen · T click-through · D dock';

const GEAR = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="6" cy="6" r="1.8"/><path d="M6 .8v1.6M6 9.6v1.6M.8 6h1.6M9.6 6h1.6M2.3 2.3l1.1 1.1M8.6 8.6l1.1 1.1M2.3 9.7l1.1-1.1M8.6 3.4l1.1-1.1"/></svg>';
const FULL = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1 4.5V1h3.5M11 4.5V1H7.5M1 7.5V11h3.5M11 7.5V11H7.5"/></svg>';
const HIDE = '<svg viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.5"><path d="M2.5 6h7"/></svg>';

const DISPLAY_HTML = `
<h4>Display</h4>
<div class="tg-row">Lives <span class="tg-chips" id="tg-pres"><button data-pres="notch">In the notch</button><button data-pres="floating">Floating window</button></span></div>
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

export function mountShell<S extends ShellSettings>(game: Game<S>): void {
  const api = window.tokenShell as ShellApi<S>;
  const el = <T extends HTMLElement = HTMLElement>(tag: string, cls = '', html = ''): T => {
    const e = document.createElement(tag) as T;
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  };
  const body = document.body;

  // ---------- the DOM ----------

  const island = el('div', 'tg-island');
  island.id = 'tg-island';
  const handle = el('div', 'tg-handle');
  handle.title = 'Close (Esc)';
  const ear = el('div', 'tg-ear l');
  const earR = el('div', 'tg-ear r');
  const count = el('span', 'tg-count'), dot = el('span', 'tg-dot');
  earR.append(count, el('span', 'tg-icon', game.icon || ''), dot);
  const peek = el('div', 'tg-peek'), strip = el('div', 'tg-strip'), peekStat = el('div', 'tg-stat');
  peek.append(strip, peekStat);
  const drop = el('div', 'tg-drop'), big = el('div', 'tg-big'), dropBar = el('div', 'tg-stat tg-dbar');
  const popBtn = el<HTMLButtonElement>('button', 'tg-pill', 'Pop out ↗'), setBtn = el<HTMLButtonElement>('button', 'tg-pill', 'Settings');
  popBtn.id = 'tg-pop'; popBtn.title = 'Pop out into a floating window (O)';
  setBtn.id = 'tg-set'; setBtn.title = 'Settings (,)';
  const dropLine = el('span', 'tg-line');
  dropBar.append(dropLine, el('span', 'tg-sp'), popBtn, setBtn);
  drop.append(big, dropBar);
  const peekLine = el('span', 'tg-line');
  peekStat.append(peekLine);
  island.append(handle, ear, earR, peek, drop);

  const win = el('div', 'tg-win');
  win.id = 'tg-win';
  const bar = el('div', 'tg-bar'), pulseDot = el('span', 'tg-pulse'), name = el('span', 'tg-name'), meter = el('span', 'tg-meter'), evt = el('span', 'tg-evt');
  bar.id = 'tg-bar';
  name.textContent = game.name;
  const wbtns = el('span', 'tg-wbtns');
  const wbtn = (id: string, title: string, html: string) => { const b = el<HTMLButtonElement>('button', 'tg-wbtn', html); b.id = id; b.title = title; return b; };
  const dockBtn = wbtn('tg-dock', 'Back to the notch (O)', '↩ Notch');
  dockBtn.classList.add('tg-text');
  const fullBtn = wbtn('tg-full', 'Full screen (F; Esc leaves)', FULL), gearBtn = wbtn('tg-gear', 'Settings (,)', GEAR), hideBtn = wbtn('tg-hide', 'Hide to the menu bar (H)', HIDE);
  wbtns.append(...(game.barButtons || []), dockBtn, fullBtn, gearBtn, hideBtn);
  bar.append(pulseDot, name, meter, evt, wbtns);
  const host = el('div', 'tg-host'), grip = el('div', 'tg-grip br'), sizetag = el('div', 'tg-sizetag');
  grip.title = 'Drag to resize (keeps 16:9)';
  win.append(host, bar, grip, sizetag);

  const panel = el('div', 'tg-panel');
  panel.id = 'tg-panel';
  panel.hidden = true;
  if (game.settingsPanel) { game.settingsPanel.hidden = false; panel.append(...Array.from(game.settingsPanel.children)); }
  const display = el('section', 'tg-display', DISPLAY_HTML);
  const foot = el('section', '', '<div class="tg-chips"><button id="tg-reset">Reset to defaults</button><button id="tg-close">Close</button></div><p class="tg-note tg-keys" id="tg-keys"></p>');
  panel.append(display, foot);
  body.append(island, win);
  body.classList.add('tg');
  game.root.classList.add('tg-root');

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => panel.querySelector('#' + id) as T;
  $('tg-keys').textContent = (game.keysHelp ? game.keysHelp + ' · ' : '') + 'Keys: ' + SHELL_KEYS;

  // ---------- state ----------

  let S: S, dark = true, smoke = false, feed: FeedStatus | null = null, full = false;
  let mode: ModeInfo = { state: 'collapsed', geo: { notch: false, top: 24, band: 25, notchWidth: 0, screen: { x: 0, y: 0, width: 1440, height: 900 } }, visible: true };
  let shown: ShellState = 'collapsed'; // the layout on screen (lags the state by the fade while flying)
  let scale: Scale = 'mini', flyT = 0, evtT = 0, sizeT = 0, grab = false, started = false;
  const status = { count: '', title: '', lead: '', line: '' };

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
    get panelOpen() { return !panel.hidden; },
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
    body.dataset.notch = mode.geo.notch ? '1' : '0';
    body.style.setProperty('--tg-band', mode.geo.band + 'px');
    body.classList.toggle('tg-flying', st === 'popping' || st === 'docking');
    clearTimeout(flyT);
    // flying: fade out, then swap the layout while the window moves (with reduced motion there is no flight)
    if ((st === 'popping' || st === 'docking') && !S?.reducedMotion) flyT = window.setTimeout(() => layout(st), FADE_MS);
    else layout(st);
  }

  function layout(st: ShellState): void {
    shown = st;
    body.dataset.state = st;
    const shape = shapeOf(st);
    if (shape) {
      const s = islandSize(shape, mode.geo);
      island.style.width = s.width + 'px';
      island.style.height = s.height + 'px';
    }
    const sc = scaleOf(st === 'docking' ? 'collapsed' : st);
    const where = sc === 'window' ? host : sc === 'expanded' ? big : st === 'peek' ? strip : ear;
    if (game.root.parentElement !== where) where.appendChild(game.root);
    // the Settings sheet lives in the window, or in the drop-down
    if (sc === 'mini' && !panel.hidden) togglePanel(false);
    const sheetHost = sc === 'window' ? win : big;
    if (panel.parentElement !== sheetHost) sheetHost.appendChild(panel);
    if (sc !== 'window' && full) setFull(false);
    if (sc !== scale) { scale = sc; game.onScale?.(sc); }
    renderPanel();
  }

  // ---------- status, pulse, theme ----------

  function setStatus(s: GameStatusLine): void {
    const lead = s.lead || '', line = s.line || '';
    if (s.count !== status.count || s.title !== status.title) {
      status.count = s.count; status.title = s.title;
      count.textContent = s.count;
      earR.title = s.count + ' ' + s.title;
      api.status({ count: s.count, title: s.title });
    }
    if (lead === status.lead && line === status.line) return;
    status.lead = lead; status.line = line;
    for (const host of [meter, peekLine, dropLine]) {
      host.textContent = '';
      if (lead) { const b = document.createElement('b'); b.textContent = lead; host.append(b, line ? ' · ' : ''); }
      host.append(line);
    }
  }

  function pulse(text: string, kind: 'hot' | 'task' = 'hot'): void {
    for (const p of [pulseDot, dot]) { p.classList.remove('hot', 'task'); void p.offsetWidth; p.classList.add(kind); }
    evt.textContent = text;
    evt.classList.add('show');
    body.classList.add('tg-news');
    peekLine.dataset.news = dropLine.dataset.news = text;
    clearTimeout(evtT);
    evtT = window.setTimeout(() => {
      evt.classList.remove('show');
      body.classList.remove('tg-news');
      for (const p of [pulseDot, dot]) p.classList.remove('hot', 'task');
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
    if (started) game.onSettings?.(S);
  }

  function buildPanel(): void {
    for (const b of $('tg-pres').querySelectorAll<HTMLButtonElement>('[data-pres]')) b.onclick = () => set({ presentation: b.dataset.pres } as Partial<S>);
    for (const b of $('tg-sizes').querySelectorAll<HTMLButtonElement>('[data-size]')) b.onclick = () => set({ size: b.dataset.size } as Partial<S>);
    for (const b of $('tg-docks').querySelectorAll<HTMLButtonElement>('[data-dock]')) b.onclick = () => set({ dock: b.dataset.dock } as Partial<S>);
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
    if (!S || panel.hidden) return;
    const floating = scale === 'window';
    for (const b of $('tg-pres').querySelectorAll<HTMLButtonElement>('[data-pres]')) b.classList.toggle('on', b.dataset.pres === S.presentation);
    $('tg-presNote').textContent = S.presentation === 'notch'
      ? (mode.geo.notch ? 'Rests in the notch: hover to peek, click to open.' : 'Rests in the middle of the menu bar: hover to peek, click to open.') + ' Pop out for a window you can move and resize.'
      : 'A floating window. ↩ Notch puts it back.';
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

  function togglePanel(open = panel.hidden): void {
    if (open && scale === 'mini') { intent('toggle'); open = true; } // open the drop-down first
    panel.hidden = !open;
    body.classList.toggle('tg-open', open);
    renderPanel();
    game.onPanel?.(open);
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
    game.onFullscreen?.(on);
  }

  // ---------- input ----------

  island.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (shown === 'collapsed' || shown === 'peek') intent('click');
    else if (shown === 'expanded' && t === handle) intent('escape');
  });
  popBtn.onclick = (e) => { e.stopPropagation(); intent('pop'); };
  setBtn.onclick = (e) => { e.stopPropagation(); togglePanel(); };
  dockBtn.onclick = () => intent('dock');
  fullBtn.onclick = () => toggleFull();
  gearBtn.onclick = () => togglePanel();
  hideBtn.onclick = () => hideWindow();

  const cycle = <T,>(list: readonly T[], cur: T): T => list[(list.indexOf(cur) + 1) % list.length];

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'q') { api.quit(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { togglePanel(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || !S) return;
    const tgt = e.target as HTMLInputElement;
    if (tgt.tagName === 'INPUT' && tgt.type === 'range' && e.key.startsWith('Arrow')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, inWin = scale === 'window';
    if (k === 'Escape') {
      if (!panel.hidden) togglePanel(false);
      else if (full) toggleFull(false);
      else if (shown === 'expanded' || shown === 'peek') intent('escape');
    } else if (k === ',') togglePanel();
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
    body.classList.toggle('tg-dark', dark);
    applySettings();
    showMode();
    full = false;
    setFull(st.fullscreen);
    api.onSettings((s) => { S = s; applySettings(); });
    api.onDark((d) => { dark = d; body.classList.toggle('tg-dark', d); game.onDark?.(d); });
    api.onEvent((ev) => game.onEvent(ev));
    api.onFeed((f) => { feed = f; game.onFeed?.(f); });
    api.onCommand((c: ShellCommand) => {
      if (c === 'settings') togglePanel(true);
      else setFull(c === 'fullscreen-on');
    });
    api.onMode((m) => { mode = m; showMode(); });
    await game.start(ctx);
    started = true;
    if (smoke) exposeTest();
  });

  // For the automated smoke test only: views of the shell's page, and a way to press keys and click like a player.
  function exposeTest(): void {
    window.shellTest = {
      state: () => ({
        state: mode.state, shown, scale, notch: mode.geo.notch, panelOpen: !panel.hidden, full, thru: body.classList.contains('tg-thru'),
        island: { w: island.offsetWidth, h: island.offsetHeight }, root: { w: game.root.clientWidth, h: game.root.clientHeight },
        rootIn: game.root.parentElement?.className || '', count: count.textContent, line: dropLine.textContent, topInset: topInset(),
        presentation: S.presentation, back: getComputedStyle(document.documentElement).getPropertyValue('--g-back').trim(),
      }),
      key: (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key })),
      click: (id: string) => (document.getElementById(id) as HTMLElement).click(),
      clickIsland: () => island.click(),
      clickHandle: () => handle.click(),
      text: () => panel.innerText + '\n' + bar.innerText,
    };
    if (game.testHooks) window.gameTest = game.testHooks();
  }
}
