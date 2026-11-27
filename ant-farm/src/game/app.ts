// The page inside the farm window: runs the simulation, draws it, and holds the title bar and the settings menu.
// Talks to the main process only through window.antFarm (preload.ts).
import type { FarmApi, FarmState, FeedStatus } from '../shared/api';
import { fakeEvent, type FarmEvent } from '../shared/events';
import { DOCKS, PALETTE_IDS, type Settings } from '../shared/settings';
import { gripCorner } from '../main/geometry';
import { createSim } from '../sim/sim';
import { TICK_HZ } from '../sim/world';
import { fit, lerp, near, zoomAt, clamp, type Cam } from './camera';
import { ORDER, PALETTES, resolve } from './palettes';
import { drawFarm, makeBuffer, type Buffer } from './render';

declare global { interface Window { antFarm: FarmApi; farmTest?: Record<string, unknown> } }

const api = window.antFarm;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const farm = $('farm'), view = $<HTMLCanvasElement>('view'), ctx = view.getContext('2d')!;
const panel = $('panel');

// Idle fade: after a few quiet seconds the farm sinks toward its backdrop; a token event brings it back.
const FADE = { after: 5000, depth: 0.5, down: 3500, up: 600 };
const BAR = 20, BAR_FULL = 26;

let S: Settings, dark = true, full = false, smoke = false, feed: FeedStatus | null = null;
let sim = createSim({ seed: 1 });
let buf: Buffer = makeBuffer(sim);
let cam: Cam | null = null, auto = true, snap = true;
let acc = 0, lastT = performance.now(), timer = 0, dim = 0, lastEvt = performance.now(), lastThumbs = 0;
let panning: { x: number; y: number; cam: Cam } | null = null, grab = false;
const thumbs = new Map<string, { canvas: HTMLCanvasElement; buf: Buffer }>();
const counts = { events: 0, tokens: 0, tasks: 0, frames: 0 };

const fmt = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
const opts = (palette = S.palette) => ({ palette, calm: S.calm, dark, dim, soft: !resolve(palette, dark).identity });
const barH = () => (full ? BAR_FULL : BAR);

// ---------- drawing ----------

function target(vw: number, vh: number): Cam {
  const t = fit(sim.interestBox(), vw, vh - barH(), { pad: 8, min: 0.5, max: 10 });
  return { x: t.x, y: t.y - barH() / t.s, s: t.s };
}

function draw(): void {
  const dpr = window.devicePixelRatio || 1, vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.max(1, Math.round(vw * dpr)), h = Math.max(1, Math.round(vh * dpr));
  if (view.width !== w || view.height !== h) { view.width = w; view.height = h; snap = true; }
  if (auto) {
    // the auto camera re-fits at every size; a resize jumps, the farm's growth eases (or jumps, with reduced motion)
    const t = target(vw, vh);
    cam = !cam || snap || S.reducedMotion || near(cam, t) ? t : lerp(cam, t, 0.12, vw, vh);
  }
  snap = false;
  const r = drawFarm(ctx, sim, cam!, dpr, buf, opts());
  setChrome(r.mapper.palette.ui);
  counts.frames++;
  meter();
}

let chromeKey = '';
function setChrome(ui: { back: string; bar: string; ink: string; dim: string; hot: string; task: string; line: string }): void {
  const key = ui.back + ui.bar + ui.ink;
  if (key === chromeKey) return;
  chromeKey = key;
  const st = farm.style;
  st.setProperty('--f-back', ui.back); st.setProperty('--f-bar', ui.bar); st.setProperty('--f-ink', ui.ink); st.setProperty('--f-dim', ui.dim);
  st.setProperty('--f-hot', ui.hot); st.setProperty('--f-task', ui.task); st.setProperty('--f-line', ui.line);
  const n = parseInt(ui.back.slice(1), 16);
  st.setProperty('--f-panel', `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.94)`);
}

function meter(): void {
  const wide = window.innerWidth >= 420;
  $('meter').innerHTML = '<b>⚡' + Math.floor(sim.energy) + '</b> · ' + fmt(sim.stats.tokens) + ' tok' +
    (wide ? ' · ' + (sim.ants.length - 1) + ' ants · ' + sim.brood.length + ' brood' : '');
}

// Each palette's button shows the farm as it is now, in that palette.
function drawThumbs(): void {
  for (const id of ORDER) {
    const t = thumbs.get(id);
    if (!t) continue;
    const w = t.canvas.clientWidth || 80, h = Math.round((w * 9) / 16), dpr = window.devicePixelRatio || 1;
    if (t.canvas.width !== Math.round(w * dpr)) { t.canvas.width = Math.round(w * dpr); t.canvas.height = Math.round(h * dpr); }
    const c = t.canvas.getContext('2d')!;
    drawFarm(c, sim, fit(sim.interestBox(), w, h, { pad: 2, min: 0.2, max: 6 }), dpr, t.buf, { ...opts(id), dim: 0, soft: false });
  }
}

// ---------- the loop: the simulation at 20 steps a second, the picture at 30, 8, 5 or 2 frames a second ----------

function running(): boolean { return smoke || !document.hidden; }

function frame(): void {
  timer = 0;
  if (!running()) return;
  const t = performance.now(), dt = Math.min(250, t - lastT);
  lastT = t;
  acc += (dt * TICK_HZ) / 1000;
  let n = 0;
  while (acc >= 1 && n < 80) { sim.step(); acc -= 1; n++; }
  if (n >= 80) acc = 0;
  const busy = sim.isBusy() || !!panning;
  farm.classList.toggle('calm', !busy);
  const want = S.fadeIdle && t - lastEvt > FADE.after && panel.hidden ? FADE.depth : 0;
  const rate = (dt / (want > dim ? FADE.down : FADE.up)) * FADE.depth;
  dim = want > dim ? Math.min(want, dim + rate) : Math.max(want, dim - rate);
  draw();
  if (!panel.hidden && t - lastThumbs > 1000) { lastThumbs = t; drawThumbs(); }
  // reduced motion: few frames, so less flicker at the edge of your eye
  const fps = S.reducedMotion ? (busy ? 5 : 2) : busy || dim !== want ? 30 : 8;
  timer = window.setTimeout(frame, 1000 / fps);
}

function wake(): void {
  if (timer || !running()) return;
  lastT = performance.now();
  timer = window.setTimeout(frame, 0);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); timer = 0; } else wake(); });

// ---------- events from the feed ----------

let evtT = 0;
function onEvent(ev: FarmEvent): void {
  sim.feed(ev);
  counts.events++;
  lastEvt = performance.now();
  let label = '', kind = 'hot';
  if (ev.type === 'tokens') {
    counts.tokens++;
    label = '+' + fmt(ev.input + ev.output + ev.cache_write + 0.1 * ev.cache_read) + ' tokens';
  } else if (ev.type === 'task_done') {
    counts.tasks++;
    label = ev.width && ev.width > 24 ? 'task done → a wide room' : 'task done → new gallery';
    kind = 'task';
  } else return;
  const p = $('pulse'), e = $('evt');
  p.classList.remove('hot', 'task'); void p.offsetWidth; p.classList.add(kind);
  e.textContent = label; e.classList.add('show');
  clearTimeout(evtT);
  evtT = window.setTimeout(() => { e.classList.remove('show'); p.classList.remove('hot', 'task'); }, 2600);
  if (!S.reducedMotion && running()) {
    const f = document.createElement('div');
    f.className = 'floater'; f.textContent = label;
    f.style.bottom = 8 + 14 * farm.querySelectorAll('.floater').length + 'px'; // stack, don't overlap
    farm.appendChild(f);
    setTimeout(() => f.remove(), 1700);
  }
  wake();
}

// ---------- settings ----------

function set(patch: Partial<Settings>): void {
  S = { ...S, ...patch }; // show it at once; the main process confirms with the saved settings
  applySettings();
  api.setSettings(patch).then((s) => { S = s; applySettings(); });
}

function applySettings(): void {
  farm.classList.toggle('thru', S.clickThrough);
  farm.classList.toggle('rm', S.reducedMotion);
  $('bThru').classList.toggle('on', S.clickThrough);
  $('bSmall').classList.toggle('on', S.size === 'small');
  $('bLarge').classList.toggle('on', S.size === 'large');
  const g = $('grip');
  g.className = 'grip ' + gripCorner(S.dock);
  if (sim.seed !== S.seed) newFarm(S.seed);
  if (!panel.hidden) renderPanel();
  wake();
}

function newFarm(seed: number): void {
  sim = createSim({ seed });
  buf = makeBuffer(sim);
  for (const t of thumbs.values()) t.buf = makeBuffer(sim);
  cam = null; auto = true;
}

function buildPanel(): void {
  const host = $('pals');
  for (const id of ORDER) {
    const b = document.createElement('button');
    b.className = 'pal'; b.dataset.pal = id; b.title = PALETTES[id].note;
    const c = document.createElement('canvas'), s = document.createElement('span');
    s.textContent = PALETTES[id].name;
    b.append(c, s);
    b.onclick = () => set({ palette: id });
    host.appendChild(b);
    thumbs.set(id, { canvas: c, buf: makeBuffer(sim) });
  }
  const range = (id: 'calm' | 'opacity') => {
    const el = $<HTMLInputElement>(id);
    el.oninput = () => set({ [id]: +el.value / 100 } as Partial<Settings>);
  };
  range('calm'); range('opacity');
  for (const id of ['fadeIdle', 'reducedMotion', 'alwaysOnTop', 'clickThrough', 'claudeFeed'] as const) {
    const el = $<HTMLInputElement>(id);
    el.onchange = () => set({ [id]: el.checked } as Partial<Settings>);
  }
  for (const b of $('sizes').querySelectorAll<HTMLButtonElement>('[data-size]')) b.onclick = () => set({ size: b.dataset.size as Settings['size'] });
  for (const b of $('docks').querySelectorAll<HTMLButtonElement>('[data-dock]')) b.onclick = () => set({ dock: b.dataset.dock as Settings['dock'] });
  $('pFull').onclick = () => toggleFull();
  $('fTokens').onclick = () => onEvent(fakeEvent('tokens'));
  $('fTask').onclick = () => onEvent(fakeEvent('task_done'));
  $('fWide').onclick = () => onEvent(fakeEvent('wide_room'));
  $('reset').onclick = () => api.resetSettings().then((s) => { S = s; applySettings(); });
  $('pClose').onclick = () => togglePanel(false);
}

function renderPanel(): void {
  for (const b of $('pals').querySelectorAll<HTMLButtonElement>('.pal')) b.classList.toggle('on', b.dataset.pal === S.palette);
  $('palNote').textContent = PALETTES[S.palette].name + ': ' + PALETTES[S.palette].note;
  const range = (id: 'calm' | 'opacity', v: number) => {
    const el = $<HTMLInputElement>(id);
    if (document.activeElement !== el) el.value = String(Math.round(v * 100));
    $(id + 'V').textContent = Math.round(v * 100) + '%';
  };
  range('calm', S.calm); range('opacity', S.opacity);
  for (const id of ['fadeIdle', 'reducedMotion', 'alwaysOnTop', 'clickThrough', 'claudeFeed'] as const) $<HTMLInputElement>(id).checked = S[id];
  for (const b of $('sizes').querySelectorAll<HTMLButtonElement>('[data-size]')) b.classList.toggle('on', !full && b.dataset.size === S.size);
  $('pFull').classList.toggle('on', full);
  $('sizeNote').textContent = full ? 'Full screen: Esc or F to leave.' : S.size === 'custom' ? `Your size: ${S.width} × ${Math.round((S.width * 9) / 16)} (drag the corner grip)` : 'Drag the corner grip for any size in between.';
  for (const b of $('docks').querySelectorAll<HTMLButtonElement>('[data-dock]')) b.classList.toggle('on', b.dataset.dock === S.dock);
  $('feedNote').textContent = !S.claudeFeed ? 'Off: only the test buttons feed the farm.'
    : feed && feed.files > 0 ? `Watching ${feed.files} Claude Code transcripts on this computer. Only token counts and times are read; nothing leaves it.`
    : 'Waiting for Claude Code transcripts (~/.claude/projects). Nothing leaves this computer.';
}

function togglePanel(open = panel.hidden): void {
  panel.hidden = !open;
  farm.classList.toggle('open', open);
  if (open) { renderPanel(); lastThumbs = 0; }
  wake();
}

function toggleFull(on = !full): void { api.setFullscreen(on).then(setFull); }
function setFull(on: boolean): void {
  full = on;
  farm.classList.toggle('full', on);
  snap = true;
  if (!panel.hidden) renderPanel();
  wake();
}

// ---------- input ----------

function cycle<T>(list: readonly T[], cur: T): T { return list[(list.indexOf(cur) + 1) % list.length]; }

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'q') { api.quit(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { togglePanel(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'range' && e.key.startsWith('Arrow')) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'Escape') { if (!panel.hidden) togglePanel(false); else if (full) toggleFull(false); }
  else if (k === '1') set({ size: 'small' });
  else if (k === '2') set({ size: 'large' });
  else if (k === 'f') toggleFull();
  else if (k === 't') set({ clickThrough: !S.clickThrough });
  else if (k === 'h') api.hide();
  else if (k === ',') togglePanel();
  else if (k === 'p') set({ palette: cycle(PALETTE_IDS, S.palette) });
  else if (k === 'd') set({ dock: cycle(DOCKS, S.dock) });
  else if (k === 'a') { auto = true; snap = true; wake(); }
  else if (k === 'k') onEvent(fakeEvent('tokens'));
  else if (k === 'n') onEvent(fakeEvent('task_done'));
  else return;
  e.preventDefault();
});

$('bSmall').onclick = () => set({ size: 'small' });
$('bLarge').onclick = () => set({ size: 'large' });
$('bFull').onclick = () => toggleFull();
$('bThru').onclick = () => set({ clickThrough: !S.clickThrough });
$('bGear').onclick = () => togglePanel();
$('bHide').onclick = () => api.hide();

// The camera: wheel to zoom, drag to look around, double-click (or A) to let it follow the colony again.
view.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!cam) return;
  auto = false;
  cam = clamp(zoomAt(cam, e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)), sim.W, sim.H, window.innerWidth, window.innerHeight);
  wake();
}, { passive: false });
view.addEventListener('pointerdown', (e) => { if (cam && e.button === 0) { panning = { x: e.clientX, y: e.clientY, cam }; view.setPointerCapture(e.pointerId); } });
view.addEventListener('pointermove', (e) => {
  if (!panning) return;
  auto = false;
  const c = panning.cam;
  cam = clamp({ x: c.x - (e.clientX - panning.x) / c.s, y: c.y - (e.clientY - panning.y) / c.s, s: c.s }, sim.W, sim.H, window.innerWidth, window.innerHeight);
  wake();
});
view.addEventListener('pointerup', () => { panning = null; });
view.addEventListener('dblclick', () => { auto = true; snap = true; wake(); });

// Resizing from the grip: the main process does the 16:9 maths in screen coordinates.
const grip = $('grip');
let resizing = false, sizeT = 0;
grip.addEventListener('pointerdown', (e) => {
  resizing = true; grip.setPointerCapture(e.pointerId);
  api.resizeDrag({ phase: 'start', x: e.screenX, y: e.screenY });
});
grip.addEventListener('pointermove', (e) => { if (resizing) api.resizeDrag({ phase: 'move', x: e.screenX, y: e.screenY }); });
const endResize = (e: PointerEvent) => { if (!resizing) return; resizing = false; api.resizeDrag({ phase: 'end', x: e.screenX, y: e.screenY }); };
grip.addEventListener('pointerup', endResize);
grip.addEventListener('pointercancel', endResize);
window.addEventListener('resize', () => {
  const t = $('sizetag');
  t.textContent = window.innerWidth + ' × ' + window.innerHeight;
  t.classList.add('show');
  clearTimeout(sizeT);
  sizeT = window.setTimeout(() => t.classList.remove('show'), 1200);
  snap = true;
  wake();
});

// Click-through: the window lets clicks pass, but still sees the pointer move; hold Alt over it to take it back.
document.addEventListener('mousemove', (e) => {
  if (S && S.fadeIdle && dim > 0) { lastEvt = performance.now(); wake(); } // a faded farm comes back when pointed at
  if (!S || !S.clickThrough) return;
  if (e.altKey !== grab) { grab = e.altKey; farm.classList.toggle('grab', grab); api.setGrab(grab); }
});
document.addEventListener('mouseleave', () => { if (grab) { grab = false; farm.classList.remove('grab'); api.setGrab(false); } });

// ---------- start ----------

api.getState().then((st: FarmState) => {
  S = st.settings; dark = st.dark; feed = st.feed; smoke = st.smoke; full = st.fullscreen;
  newFarm(S.seed);
  buildPanel();
  setFull(full);
  applySettings();
  api.onSettings((s) => { S = s; applySettings(); });
  api.onDark((d) => { dark = d; wake(); });
  api.onEvent(onEvent);
  api.onFeed((f) => { feed = f; if (!panel.hidden) renderPanel(); });
  api.onCommand((c) => {
    if (c === 'settings') togglePanel(true);
    else setFull(c === 'fullscreen-on');
  });
  if (smoke) exposeTest();
  wake();
});

// For the automated smoke test only: read-only views of the farm and a way to press keys.
function exposeTest(): void {
  window.farmTest = {
    state: () => ({
      energy: sim.energy, tokens: sim.stats.tokens, tick: sim.tick, ants: sim.ants.length, galleries: sim.galleryQueue.length,
      panelOpen: !panel.hidden, full, palette: S.palette, counts: { ...counts }, w: window.innerWidth, h: window.innerHeight,
      thru: farm.classList.contains('thru'), chrome: getComputedStyle(farm).getPropertyValue('--f-back').trim(),
    }),
    colours: () => {
      const d = ctx.getImageData(0, 0, view.width, view.height).data, seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4 * 7) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return seen.size;
    },
    key: (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key })),
    click: (id: string) => $(id).click(),
    clickPalette: (id: string) => $('pals').querySelector<HTMLButtonElement>(`[data-pal="${id}"]`)!.click(),
    feed: feedNote,
  };
}
function feedNote(): string { return $('feedNote').textContent || ''; }
