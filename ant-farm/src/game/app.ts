// The page inside the farm window: runs the simulation, draws it, and holds the title bar and the settings menu.
// Talks to the main process only through window.antFarm (preload.ts). The farm grows only from real Claude Code
// usage, which the main process reads and forwards; there is no other way to feed it.
import type { FarmApi, FarmState, FeedStatus } from '../shared/api';
import type { FarmEvent } from '../shared/events';
import { DOCKS, MAP_SIZE_IDS, PALETTE_IDS, type Settings } from '../shared/settings';
import { gripCorner } from '../main/geometry';
import { createSim, readSave, type Sim } from '../sim/sim';
import { MAP_SIZES, TICK_HZ } from '../sim/world';
import { fit, lerp, near, clamp, type Cam } from './camera';
import { classifyWheel, wheelPixels, panBy, pinchFactor, wheelFactor, easeZoom, zoomDone, Inertia, FOLLOW_PAUSE_MS, type ZoomGoal } from './input';
import { ORDER, PALETTES, resolve } from './palettes';
import { View, minScale, type ViewStats } from './render';

declare global { interface Window { antFarm: FarmApi; farmTest?: Record<string, unknown> } }

const api = window.antFarm;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const farm = $('farm'), view = $<HTMLCanvasElement>('view'), ctx = view.getContext('2d')!;
const panel = $('panel');

// Idle fade: after a few quiet seconds the farm sinks toward its backdrop; a token event brings it back.
const FADE = { after: 5000, depth: 0.5, down: 3500, up: 600 };
const BAR = 20, BAR_FULL = 26;
const SAVE_EVERY = 30_000; // the colony is saved this often, and whenever the window hides or closes

let S: Settings, dark = true, full = false, smoke = false, feed: FeedStatus | null = null;
let sim: Sim = createSim({ size: 'classic', colony: false }); // replaced by the real farm once the settings arrive
let simSize = '', ready = false;
let main = new View();
let cam: Cam | null = null, auto = true, snap = true, pausedUntil = 0, zoomGoal: ZoomGoal | null = null;
let acc = 0, lastT = performance.now(), timer = 0, dim = 0, lastEvt = performance.now(), lastThumbs = 0, lastSave = 0, lastFrame = 0;
let drag: { x: number; y: number; id: number } | null = null, grab = false, showStats = false;
const inertia = new Inertia();
const thumbs = new Map<string, { canvas: HTMLCanvasElement; view: View }>();
const counts = { events: 0, tokens: 0, tasks: 0, frames: 0 };
const perf = { tickMs: 0, drawMs: 0, view: null as ViewStats | null };

const fmt = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
const age = (ms: number): string => (ms >= 48 * 3_600_000 ? Math.round(ms / 86_400_000) + ' d' : ms >= 3_600_000 ? Math.round(ms / 3_600_000) + ' h' : Math.round(ms / 60_000) + ' min');
const opts = (palette = S.palette) => ({ palette, calm: S.calm, dark, dim, soft: !resolve(palette, dark).identity });
const barH = () => (full ? BAR_FULL : BAR);

// ---------- the camera ----------

const limits = () => ({ min: minScale(window.innerWidth, window.innerHeight), max: 24 });
const keepIn = (c: Cam): Cam => clamp(c, sim.W, sim.H, window.innerWidth, window.innerHeight);

function target(vw: number, vh: number): Cam {
  const t = fit(sim.interestBox(), vw, vh - barH(), { pad: 8, min: Math.max(0.5, minScale(vw, vh)), max: 10 });
  return { x: t.x, y: t.y - barH() / t.s, s: t.s };
}

// You moved the camera: the auto camera steps back for a while (double-click or A brings it back at once).
function manual(): void {
  auto = false;
  pausedUntil = performance.now() + FOLLOW_PAUSE_MS;
  $('bFollow').hidden = false;
}
function follow(): void {
  auto = true; zoomGoal = null; inertia.reset();
  // from far away, jump back rather than slide across half the map
  if (cam) { const t = target(window.innerWidth, window.innerHeight); if (Math.abs(t.x - cam.x) * cam.s > window.innerWidth * 2 || Math.abs(t.y - cam.y) * cam.s > window.innerHeight * 2) snap = true; }
  $('bFollow').hidden = true;
  wake(true);
}

// ---------- drawing ----------

function draw(dt: number): void {
  const dpr = window.devicePixelRatio || 1, vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.max(1, Math.round(vw * dpr)), h = Math.max(1, Math.round(vh * dpr));
  if (view.width !== w || view.height !== h) { view.width = w; view.height = h; snap = true; }
  if (!auto && !drag && !inertia.moving && !zoomGoal && performance.now() > pausedUntil) follow();
  if (cam && zoomGoal) {
    cam = keepIn(easeZoom(cam, zoomGoal, dt, { ...limits(), instant: S.reducedMotion }));
    if (zoomDone(cam, zoomGoal)) zoomGoal = null;
  }
  if (cam && !drag) { const d = inertia.step(dt); if (d) cam = keepIn(panBy(cam, d.dx, d.dy)); }
  if (auto) {
    // the auto camera re-fits at every size; a resize jumps, the farm's growth eases (or jumps, with reduced motion)
    const t = target(vw, vh);
    cam = !cam || snap || S.reducedMotion || near(cam, t) ? t : lerp(cam, t, 0.12, vw, vh);
  }
  snap = false;
  const r = main.draw(ctx, sim, cam!, dpr, { ...opts(), budgetMs: smoke ? 1000 : 8 });
  sim.setView(r.box);
  perf.drawMs = perf.drawMs * 0.9 + r.stats.ms * 0.1; perf.view = r.stats;
  setChrome(r.mapper.palette.ui);
  counts.frames++;
  meter();
  if (showStats) statsText();
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

const MOOD = { fed: '', hungry: ' · hungry', starving: ' · starving', empty: ' · empty' } as const;
function meter(): void {
  const wide = window.innerWidth >= 420, h = sim.health();
  $('meter').innerHTML = '<b>⚡' + Math.floor(sim.energy) + '</b> · ' + fmt(sim.stats.tokens) + ' tok' +
    (wide ? ' · ' + h.workers + ' ants · ' + h.food + ' food' : '') + MOOD[h.mood] +
    (feed && (feed.error || !feed.files) && wide ? ' · waiting for Claude Code' : '');
}

// The stats overlay (I): what a frame costs and how much of the map is in memory.
function statsText(): void {
  const v = perf.view, c = sim.chunkStats(), m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  $('stats').textContent = [
    `map ${sim.W} × ${sim.H} (${MAP_SIZES[S.mapSize].name})`,
    `frame ${perf.drawMs.toFixed(1)} ms draw · ${perf.tickMs.toFixed(2)} ms/tick`,
    v ? `chunks on screen ${v.visible} · painted ${v.painted} · waiting ${v.waiting}` : '',
    v ? `tiles ${v.tiles} (${v.tileMB.toFixed(1)} MB)` : '',
    `chunks loaded ${c.loaded} · changed ${c.modified} · packed ${c.packed} (${(c.bytes / 1048576).toFixed(1)} MB)`,
    m ? `heap ${(m.usedJSHeapSize / 1048576).toFixed(0)} MB` : '',
    cam ? `camera ${Math.round(cam.x)}, ${Math.round(cam.y)} × ${cam.s.toFixed(2)}${auto ? ' (following)' : ''}` : '',
  ].filter(Boolean).join('\n');
}

// Each palette's button shows the farm as it is now, in that palette.
function drawThumbs(): void {
  for (const id of ORDER) {
    const t = thumbs.get(id);
    if (!t) continue;
    const w = t.canvas.clientWidth || 80, h = Math.round((w * 9) / 16), dpr = window.devicePixelRatio || 1;
    if (t.canvas.width !== Math.round(w * dpr)) { t.canvas.width = Math.round(w * dpr); t.canvas.height = Math.round(h * dpr); }
    const c = t.canvas.getContext('2d')!;
    t.view.draw(c, sim, fit(sim.interestBox(), w, h, { pad: 2, min: 0.2, max: 6 }), dpr, { ...opts(id), dim: 0, soft: false, budgetMs: 4 });
  }
}

// ---------- the loop: the simulation at 20 steps a second, the picture at 60, 30, 8, 5 or 2 frames a second ----------

function running(): boolean { return ready && (smoke || !document.hidden); }

function frame(): void {
  timer = 0;
  if (!running()) return;
  const t = performance.now(), dt = Math.min(250, t - lastT);
  lastT = t; lastFrame = t;
  acc += (dt * TICK_HZ) / 1000;
  let n = 0;
  const t0 = performance.now();
  while (acc >= 1 && n < 80) { sim.step(); acc -= 1; n++; }
  if (n) perf.tickMs = perf.tickMs * 0.8 + ((performance.now() - t0) / n) * 0.2;
  if (n >= 80) acc = 0;
  lifeNews();
  const moving = !!drag || inertia.moving || !!zoomGoal;
  const busy = sim.isBusy() || moving;
  farm.classList.toggle('calm', !busy);
  const want = S.fadeIdle && t - lastEvt > FADE.after && panel.hidden ? FADE.depth : 0;
  const rate = (dt / (want > dim ? FADE.down : FADE.up)) * FADE.depth;
  dim = want > dim ? Math.min(want, dim + rate) : Math.max(want, dim - rate);
  draw(dt);
  if (!panel.hidden && t - lastThumbs > 1000) { lastThumbs = t; drawThumbs(); renderHealth(); }
  if (t - lastSave > SAVE_EVERY) save();
  // reduced motion: few frames, so less flicker at the edge of your eye; moving the camera gets every frame
  const fps = moving && !S.reducedMotion ? 60 : S.reducedMotion ? (moving ? 15 : busy ? 5 : 2) : busy || dim !== want ? 30 : 8;
  timer = window.setTimeout(frame, 1000 / fps);
}

// Draw soon: `now` for input, which shouldn't wait for an idle frame (but never faster than the screen).
function wake(now = false): void {
  if (!running()) return;
  if (timer && !now) return;
  clearTimeout(timer);
  if (!timer) lastT = performance.now();
  timer = window.setTimeout(frame, Math.max(0, 8 - (performance.now() - lastFrame)));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); timer = 0; save(); } else wake(); });
window.addEventListener('beforeunload', () => { if (ready) api.saveColonyNow(sim.save()); });

// ---------- the colony, kept across restarts ----------

function save(): void {
  if (!ready) return;
  lastSave = performance.now();
  api.saveColony(sim.save());
}

async function newFarm(): Promise<void> {
  ready = false;
  const size = S.mapSize, { W, H } = MAP_SIZES[size];
  const restore = readSave(await api.loadColony(), S.seed, W, H);
  sim = createSim({ seed: S.seed, size, restore });
  simSize = size;
  main = new View();
  for (const t of thumbs.values()) t.view = new View();
  cam = null; auto = true; zoomGoal = null; inertia.reset();
  $('bFollow').hidden = true;
  ready = true;
  if (!restore) save(); // a new farm replaces the old save straight away
  wake();
}

// Quiet news from the colony's life: an old ant passing, a new queen.
let seenEvents = 0;
function lifeNews(): void {
  const evs = sim.events;
  for (const e of evs) {
    if (e.tick <= seenEvents) continue;
    if (e.type === 'died') label(e.queen ? 'the old queen died' : e.cause === 'age' ? 'an old ant died' : 'an ant starved', 'task');
    else if (e.type === 'queen') label('a new queen took over', 'task');
    else if (e.type === 'founded') label('a new queen founded the farm', 'task');
  }
  if (evs.length) seenEvents = Math.max(seenEvents, evs[evs.length - 1].tick);
}

// ---------- events from the feed ----------

let evtT = 0;
function label(text: string, kind: 'hot' | 'task'): void {
  const p = $('pulse'), e = $('evt');
  p.classList.remove('hot', 'task'); void p.offsetWidth; p.classList.add(kind);
  e.textContent = text; e.classList.add('show');
  clearTimeout(evtT);
  evtT = window.setTimeout(() => { e.classList.remove('show'); p.classList.remove('hot', 'task'); }, 2600);
}

function onEvent(ev: FarmEvent): void {
  sim.feed(ev);
  counts.events++;
  lastEvt = performance.now();
  let text = '', kind: 'hot' | 'task' = 'hot';
  if (ev.type === 'tokens') {
    counts.tokens++;
    text = '+' + fmt(ev.input + ev.output + ev.cache_write + 0.1 * ev.cache_read) + ' tokens';
  } else if (ev.type === 'task_done') {
    counts.tasks++;
    text = ev.width && ev.width > 24 ? 'task done → a wide room' : 'task done → new gallery';
    kind = 'task';
  } else return;
  label(text, kind);
  if (!S.reducedMotion && running()) {
    const f = document.createElement('div');
    f.className = 'floater'; f.textContent = text;
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
  const g = $('grip');
  g.className = 'grip ' + gripCorner(S.dock);
  if (ready && (sim.seed !== S.seed || simSize !== S.mapSize)) { save(); void newFarm(); }
  if (!panel.hidden) renderPanel();
  wake();
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
    thumbs.set(id, { canvas: c, view: new View() });
  }
  const range = (id: 'calm' | 'opacity') => {
    const el = $<HTMLInputElement>(id);
    el.oninput = () => set({ [id]: +el.value / 100 } as Partial<Settings>);
  };
  range('calm'); range('opacity');
  for (const id of ['fadeIdle', 'reducedMotion', 'alwaysOnTop', 'clickThrough'] as const) {
    const el = $<HTMLInputElement>(id);
    el.onchange = () => set({ [id]: el.checked } as Partial<Settings>);
  }
  for (const b of $('sizes').querySelectorAll<HTMLButtonElement>('[data-size]')) b.onclick = () => set({ size: b.dataset.size as Settings['size'] });
  for (const b of $('docks').querySelectorAll<HTMLButtonElement>('[data-dock]')) b.onclick = () => set({ dock: b.dataset.dock as Settings['dock'] });
  for (const b of $('maps').querySelectorAll<HTMLButtonElement>('[data-map]')) b.onclick = () => set({ mapSize: b.dataset.map as Settings['mapSize'] });
  $('pFull').onclick = () => toggleFull();
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
  for (const id of ['fadeIdle', 'reducedMotion', 'alwaysOnTop', 'clickThrough'] as const) $<HTMLInputElement>(id).checked = S[id];
  for (const b of $('sizes').querySelectorAll<HTMLButtonElement>('[data-size]')) b.classList.toggle('on', !full && b.dataset.size === S.size);
  $('pFull').classList.toggle('on', full);
  $('sizeNote').textContent = full ? 'Full screen: Esc or F to leave.' : S.size === 'custom' ? `Your size: ${S.width} × ${Math.round((S.width * 9) / 16)} (drag the corner grip)` : 'Drag the corner grip for any size in between.';
  for (const b of $('docks').querySelectorAll<HTMLButtonElement>('[data-dock]')) b.classList.toggle('on', b.dataset.dock === S.dock);
  for (const b of $('maps').querySelectorAll<HTMLButtonElement>('[data-map]')) b.classList.toggle('on', b.dataset.map === S.mapSize);
  const m = MAP_SIZES[S.mapSize];
  $('mapNote').textContent = `${m.W.toLocaleString()} × ${m.H.toLocaleString()} cells. Only what's on screen is drawn. Another size starts a new farm.`;
  $('feedNote').textContent = feed && feed.error ? feed.error
    : feed && feed.files > 0 ? `Watching ${feed.files} Claude Code transcripts on this computer. Only token counts and times are read; nothing leaves it.`
    : 'Waiting for Claude Code transcripts (~/.claude/projects). The farm grows only from your Claude Code use. Nothing leaves this computer.';
  renderHealth();
}

// The colony's health, quietly: how many, how fed, how old.
function renderHealth(): void {
  const h = sim.health();
  const mood = h.mood === 'fed' ? 'Fed' : h.mood === 'hungry' ? 'Hungry: the store is low' : h.mood === 'starving' ? `Starving for ${age(h.starvingMs)}: tokens bring food` : 'Empty: the next tokens bring a new queen';
  $('health').innerHTML = [
    ['Ants', h.workers + (h.queen ? ' + queen' : '') + (h.brood ? ` · ${h.brood} brood` : '')],
    ['Food stored', h.food + (h.loose ? ` · ${h.loose} still outside` : '')],
    ['Oldest ant', h.workers ? age(h.oldestMs) : '–'],
    ['Queen', h.queen ? age(h.queenAgeMs) + ' old' : '–'],
    ['State', mood],
  ].map(([k, v]) => `<div class="hrow"><span>${k}</span><span>${v}</span></div>`).join('');
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

function zoomBy(f: number, sx = window.innerWidth / 2, sy = window.innerHeight / 2): void {
  if (!cam) return;
  manual();
  const l = limits(), s = Math.max(l.min, Math.min(l.max, (zoomGoal ? zoomGoal.s : cam.s) * f));
  zoomGoal = { s, sx, sy };
  wake(true);
}
function panScreen(dx: number, dy: number): void {
  if (!cam) return;
  manual();
  cam = keepIn(panBy(cam, dx, dy));
  wake(true);
}

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'q') { api.quit(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { togglePanel(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'range' && e.key.startsWith('Arrow')) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, step = Math.min(window.innerWidth, window.innerHeight) * 0.2;
  if (k === 'Escape') { if (!panel.hidden) togglePanel(false); else if (full) toggleFull(false); }
  else if (k === '1') set({ size: 'small' });
  else if (k === '2') set({ size: 'large' });
  else if (k === 'f') toggleFull();
  else if (k === 't') set({ clickThrough: !S.clickThrough });
  else if (k === 'h') { save(); api.hide(); }
  else if (k === ',') togglePanel();
  else if (k === 'p') set({ palette: cycle(PALETTE_IDS, S.palette) });
  else if (k === 'd') set({ dock: cycle(DOCKS, S.dock) });
  else if (k === 'm') set({ mapSize: cycle(MAP_SIZE_IDS, S.mapSize) });
  else if (k === 'a') follow();
  else if (k === 'i') { showStats = !showStats; $('stats').hidden = !showStats; wake(true); }
  else if (k === 'ArrowLeft') panScreen(-step, 0);
  else if (k === 'ArrowRight') panScreen(step, 0);
  else if (k === 'ArrowUp') panScreen(0, -step);
  else if (k === 'ArrowDown') panScreen(0, step);
  else if (k === '+' || k === '=') zoomBy(1.25);
  else if (k === '-' || k === '_') zoomBy(1 / 1.25);
  else return;
  e.preventDefault();
});

$('bFollow').onclick = () => follow();
$('bFull').onclick = () => toggleFull();
$('bGear').onclick = () => togglePanel();
$('bHide').onclick = () => { save(); api.hide(); };

// The camera. Two fingers on a trackpad pan, 1:1 and at once; a pinch zooms around the pointer; a mouse wheel zooms;
// dragging pans and glides on when let go. Double-click (or A) lets the camera follow the colony again.
view.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!cam) return;
  const w = { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, wheelDeltaY: (e as unknown as { wheelDeltaY?: number }).wheelDeltaY };
  const kind = classifyWheel(w), d = wheelPixels(w, window.innerHeight);
  inertia.reset();
  if (kind === 'pan') panScreen(d.dx, d.dy);
  else zoomBy(kind === 'pinch' ? pinchFactor(d.dy) : wheelFactor(d.dy), e.offsetX, e.offsetY);
}, { passive: false });
// Safari-style gesture events, where they exist (a pinch on a trackpad)
let gesture = 1;
view.addEventListener('gesturestart', (e) => { e.preventDefault(); gesture = 1; });
view.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  const g = e as unknown as { scale: number; clientX: number; clientY: number };
  zoomBy(g.scale / gesture, g.clientX, g.clientY); gesture = g.scale;
});
view.addEventListener('pointerdown', (e) => {
  if (!cam || e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  inertia.reset();
  view.setPointerCapture(e.pointerId);
});
view.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = drag.x - e.clientX, dy = drag.y - e.clientY;
  drag.x = e.clientX; drag.y = e.clientY;
  if (!dx && !dy) return;
  inertia.track(dx, dy, e.timeStamp);
  panScreen(dx, dy);
});
const endDrag = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null;
  if (!S.reducedMotion && inertia.release(e.timeStamp)) wake(true); else inertia.reset();
};
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);
view.addEventListener('dblclick', () => follow());

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

api.getState().then(async (st: FarmState) => {
  S = st.settings; dark = st.dark; feed = st.feed; smoke = st.smoke; full = st.fullscreen;
  buildPanel();
  await newFarm();
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

// For the automated smoke test only: read-only views of the farm, and a way to press keys and move the camera like a
// player. There is no way here to feed the farm: the smoke test writes a real transcript line for that.
function exposeTest(): void {
  window.farmTest = {
    state: () => ({
      ready, energy: sim.energy, tokens: sim.stats.tokens, tick: sim.tick, ants: sim.ants.length, galleries: sim.galleryQueue.length,
      panelOpen: !panel.hidden, full, palette: S.palette, mapSize: S.mapSize, W: sim.W, H: sim.H, counts: { ...counts },
      w: window.innerWidth, h: window.innerHeight, auto, cam: cam && { ...cam },
      thru: farm.classList.contains('thru'), chrome: getComputedStyle(farm).getPropertyValue('--f-back').trim(),
      view: perf.view, drawMs: perf.drawMs, tickMs: perf.tickMs, chunks: sim.chunkStats(), health: sim.health(),
      heapMB: ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize || 0) / 1048576,
      ages: sim.ants.map((a) => a.born),
    }),
    colours: () => {
      const d = ctx.getImageData(0, 0, view.width, view.height).data, seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4 * 7) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return seen.size;
    },
    key: (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key })),
    click: (id: string) => $(id).click(),
    clickPalette: (id: string) => $('pals').querySelector<HTMLButtonElement>(`[data-pal="${id}"]`)!.click(),
    wheel: (o: WheelEventInit) => view.dispatchEvent(new WheelEvent('wheel', { cancelable: true, clientX: 100, clientY: 80, ...o })),
    look: (x: number, y: number) => { manual(); cam = keepIn({ x, y, s: cam ? cam.s : 1 }); wake(true); }, // jump the camera far away
    save: () => { save(); return sim.tick; },
    feed: () => $('feedNote').textContent || '',
    text: () => panel.innerText + '\n' + $('bar').innerText,
  };
}
