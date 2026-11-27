// The Ant Farm's page: runs the simulation and draws it into #farm, which the shell (shell/src/page/shell-page.ts)
// moves between the notch, the peek strip, the drop-down and the popped-out window. The shell owns the title bar, the
// Display settings, the tray and the Claude Code feed; this file adds the farm, its camera and its own settings.
// The farm grows only from real Claude Code usage, which the shell forwards; there is no other way to feed it.
import type { GameContext, Scale } from '@token-games/shell/game';
import type { FeedStatus } from '@token-games/shell/api';
import type { UsageEvent } from '@token-games/shell/events';
import { mountShell } from '@token-games/shell/page/shell-page';
import { MAP_SIZE_IDS, PALETTE_IDS, type Settings } from '../shared/settings';
import { createSim, readSave, type Sim } from '../sim/sim';
import { compare, readRuns, recordRun, score, scoreInput, type Run, type Runs } from '../sim/score';
import { MAP_SIZES, TICK_HZ } from '../sim/world';
import { fit, lerp, near, clamp, type Cam } from './camera';
import { classifyWheel, wheelPixels, panBy, pinchFactor, wheelFactor, easeZoom, zoomDone, Inertia, FOLLOW_PAUSE_MS, type ZoomGoal } from './input';
import { ORDER, PALETTES, resolve } from './palettes';
import { View, minScale, type ViewStats } from './render';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const farm = $('farm'), view = $<HTMLCanvasElement>('view'), g2d = view.getContext('2d')!;

// Idle fade: after a few quiet seconds the farm sinks toward its backdrop; a token event brings it back.
const FADE = { after: 5000, depth: 0.5, down: 3500, up: 600 };
const SAVE_EVERY = 30_000; // the colony is saved this often, and whenever the window hides or closes
const ANT = '<svg viewBox="0 0 16 10" fill="currentColor"><ellipse cx="3" cy="5" rx="2.2" ry="1.9"/><ellipse cx="7.4" cy="5" rx="1.6" ry="1.4"/><ellipse cx="12" cy="5.2" rx="3" ry="2.3"/><path d="M6 6.2 4 9M7.4 6.4V9.4M8.8 6.2l2 2.8M6 3.8 4.4 1M8.8 3.8 10.6 1.2M1.6 3.6.4 1.2" stroke="currentColor" stroke-width=".9" fill="none"/></svg>';

let C: GameContext<Settings>;
let S: Settings, dark = true, smoke = false, feed: FeedStatus | null = null, scale: Scale = 'mini';
let sim: Sim = createSim({ size: 'classic', colony: false }); // replaced by the real farm once the settings arrive
let simSize = '', ready = false;
let main = new View();
let cam: Cam | null = null, auto = true, snap = true, pausedUntil = 0, zoomGoal: ZoomGoal | null = null;
let acc = 0, lastT = performance.now(), timer = 0, dim = 0, lastEvt = performance.now(), lastThumbs = 0, lastSave = 0, lastFrame = 0;
let drag: { x: number; y: number; id: number } | null = null, showStats = false;
let runs: Runs = readRuns(null), runsRead = false, points = 0, shownOver = false; // the local record of runs, this run's score, and the game over screen
const inertia = new Inertia();
const thumbs = new Map<string, { canvas: HTMLCanvasElement; view: View }>();
const counts = { events: 0, tokens: 0, tasks: 0, frames: 0 };
const perf = { tickMs: 0, drawMs: 0, view: null as ViewStats | null };

const fmt = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
const age = (ms: number): string => (ms >= 48 * 3_600_000 ? Math.round(ms / 86_400_000) + ' d' : ms >= 3_600_000 ? Math.round(ms / 3_600_000) + ' h' : Math.round(ms / 60_000) + ' min');
const opts = (palette = S.palette) => ({ palette, calm: S.calm, dark, dim, soft: !resolve(palette, dark).identity });
const vw = () => Math.max(1, farm.clientWidth), vh = () => Math.max(1, farm.clientHeight);
const mini = () => scale === 'mini';

// ---------- the camera ----------

const limits = () => ({ min: minScale(vw(), vh()), max: 24 });
const keepIn = (c: Cam): Cam => clamp(c, sim.W, sim.H, vw(), vh());

function target(w: number, h: number): Cam {
  const top = C ? C.topInset : 0;
  const t = fit(sim.interestBox(), w, h - top, { pad: mini() ? 1 : 8, min: Math.max(mini() ? 0.1 : 0.5, minScale(w, h)), max: 10 });
  return { x: t.x, y: t.y - top / t.s, s: t.s };
}

// You moved the camera: the auto camera steps back for a while (double-click or A brings it back at once).
function manual(): void {
  auto = false;
  pausedUntil = performance.now() + FOLLOW_PAUSE_MS;
  followBtn.hidden = false;
}
function follow(): void {
  auto = true; zoomGoal = null; inertia.reset();
  // from far away, jump back rather than slide across half the map
  if (cam) { const t = target(vw(), vh()); if (Math.abs(t.x - cam.x) * cam.s > vw() * 2 || Math.abs(t.y - cam.y) * cam.s > vh() * 2) snap = true; }
  followBtn.hidden = true;
  wake(true);
}

// ---------- drawing ----------

function draw(dt: number): void {
  const dpr = window.devicePixelRatio || 1, w0 = vw(), h0 = vh();
  const w = Math.max(1, Math.round(w0 * dpr)), h = Math.max(1, Math.round(h0 * dpr));
  if (view.width !== w || view.height !== h) { view.width = w; view.height = h; snap = true; }
  if (!auto && !drag && !inertia.moving && !zoomGoal && performance.now() > pausedUntil) follow();
  if (cam && zoomGoal) {
    cam = keepIn(easeZoom(cam, zoomGoal, dt, { ...limits(), instant: S.reducedMotion }));
    if (zoomDone(cam, zoomGoal)) zoomGoal = null;
  }
  if (cam && !drag) { const d = inertia.step(dt); if (d) cam = keepIn(panBy(cam, d.dx, d.dy)); }
  if (auto || mini()) {
    // the auto camera re-fits at every size; a resize jumps, the farm's growth eases (or jumps, with reduced motion)
    const t = target(w0, h0);
    cam = !cam || snap || S.reducedMotion || mini() || near(cam, t) ? t : lerp(cam, t, 0.12, w0, h0);
  }
  snap = false;
  const r = main.draw(g2d, sim, cam!, dpr, { ...opts(), budgetMs: smoke ? 1000 : mini() ? 4 : 8 });
  sim.setView(r.box);
  perf.drawMs = perf.drawMs * 0.9 + r.stats.ms * 0.1; perf.view = r.stats;
  C.setTheme(r.mapper.palette.ui);
  counts.frames++;
  status();
  if (showStats) statsText();
}

const MOOD = { fed: '', hungry: ' · hungry', starving: ' · starving', empty: ' · empty' } as const;
const num = (n: number): string => Math.round(n).toLocaleString('en-US');
function status(): void {
  const h = sim.health();
  points = score(scoreInput(sim)).total;
  if (sim.over()) {
    C.setStatus({ count: '0', title: 'ants', lead: '★ ' + num(points), line: 'game over · ★ ' + num(points) + (runs.best ? ' · best ' + num(Math.max(points, runs.best.score)) : '') });
    return;
  }
  C.setStatus({
    count: String(h.workers), title: h.workers === 1 ? 'ant' : 'ants', lead: '⚡' + Math.floor(sim.energy),
    line: h.workers + ' ants · ' + h.food + ' food' + MOOD[h.mood] + ' · ★ ' + num(points) +
      (feed && (feed.error || !feed.files) ? ' · waiting for Claude Code' : ''),
  });
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

// ---------- the loop: the simulation at 20 steps a second; the picture at 60, 30 or 8 frames a second in the window
// and the drop-down, 4 or 2 in the notch, fewer with reduced motion ----------

function running(): boolean { return ready && (smoke || !document.hidden); }

function frame(): void {
  timer = 0;
  if (!running()) return;
  const t = performance.now(), dt = Math.min(1100, t - lastT); // the slowest frame is a second apart: the farm keeps time
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
  C.setCalm(!busy);
  const want = S.fadeIdle && t - lastEvt > FADE.after && !C.panelOpen ? FADE.depth : 0;
  const rate = (dt / (want > dim ? FADE.down : FADE.up)) * FADE.depth;
  dim = want > dim ? Math.min(want, dim + rate) : Math.max(want, dim - rate);
  draw(dt);
  if (C.panelOpen && t - lastThumbs > 1000) { lastThumbs = t; drawThumbs(); renderHealth(); }
  if (t - lastSave > SAVE_EVERY) save();
  // reduced motion: few frames, so less flicker at the edge of your eye; moving the camera gets every frame.
  // Resting in the notch the farm is a few pixels tall: a handful of frames is plenty and costs next to nothing.
  const fps = mini() ? (S.reducedMotion ? 1 : busy ? 4 : 2)
    : moving && !S.reducedMotion ? 60 : S.reducedMotion ? (moving ? 15 : busy ? 5 : 2) : busy || dim !== want ? 30 : 8;
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

// ---------- the colony, kept across restarts ----------

function save(): void {
  if (!ready) return;
  lastSave = performance.now();
  void C.save(saveData());
}
// The colony and, beside it, the record of past runs: both stay on this computer.
const saveData = () => ({ ...sim.save(), runs });

async function newFarm(): Promise<void> {
  ready = false;
  const size = S.mapSize, { W, H } = MAP_SIZES[size];
  const raw = await C.load();
  if (!runsRead) { runs = readRuns(raw && (raw as { runs?: unknown }).runs); runsRead = true; } // later, memory is newest
  const restore = readSave(raw, S.seed, W, H);
  sim = createSim({ seed: S.seed, size, restore });
  simSize = size;
  main = new View();
  for (const t of thumbs.values()) t.view = new View();
  cam = null; auto = true; zoomGoal = null; inertia.reset();
  followBtn.hidden = true;
  shownOver = false; overEl.hidden = true;
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
    if (e.type === 'died') C.pulse(e.queen ? 'the old queen died' : e.cause === 'age' ? 'an old ant died' : 'an ant starved', 'task');
    else if (e.type === 'queen') C.pulse('a new queen took over', 'task');
  }
  if (evs.length) seenEvents = Math.max(seenEvents, evs[evs.length - 1].tick);
  if (sim.over() && !shownOver) gameOver();
}

// ---------- game over: the run's score, the best, the last few runs, and a new farm ----------

const overEl = $('over');
const thisRun = (): Run => {
  const s = score(scoreInput(sim));
  return { score: s.total, started: sim.life.started, ended: sim.life.over, seed: sim.seed, parts: s.parts.filter((p) => p.count > 0) };
};
const when = (ms: number): string => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const signed = (n: number): string => (n > 0 ? '+' : n < 0 ? '−' : '±') + num(Math.abs(n));
const esc = (t: string): string => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function gameOver(): void {
  shownOver = true;
  const run = thisRun(), cmp = compare(runs, run), s = score(scoreInput(sim));
  runs = recordRun(runs, run);
  save();
  $('overScore').textContent = num(run.score);
  $('overNote').textContent = cmp.isBest ? (cmp.last ? 'A new best on this computer.' : 'Your first run: the best so far.')
    : 'Best ' + num(cmp.best) + ' · ' + signed(cmp.vsBest) + ' from the best';
  $('overParts').innerHTML = s.parts.map((p) => `<div class="hrow"><span>${p.count.toLocaleString('en-US')} ${esc(p.label)}</span><span>${num(p.points)}</span></div>`).join('');
  $('overCompare').innerHTML = [
    ['This run', num(run.score) + ' · ' + age(run.ended - run.started)],
    ['Last run', cmp.last ? num(cmp.last.score) + ' (' + signed(cmp.vsLast!) + ')' : '–'],
    ['Best', num(cmp.best) + (cmp.isBest ? ' ★' : '')],
  ].map(([k, v]) => `<div class="hrow"><span>${k}</span><span>${v}</span></div>`).join('');
  $('overRuns').innerHTML = runs.list.slice(0, 5).map((r) =>
    `<div class="hrow${r === run || (r.started === run.started && r.seed === run.seed) ? ' now' : ''}"><span>${when(r.ended)} · ${age(r.ended - r.started)}</span><span>${num(r.score)}</span></div>`).join('');
  overEl.hidden = mini();
  wake(true);
}

$('overRestart').onclick = restart;

// A fresh farm: a new map and a new colony, at once, without restarting the app. The run just ended stays in the record.
function restart(): void {
  if (!sim.over()) return;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  overEl.hidden = true;
  C.set({ seed });
}

// ---------- events from the feed ----------

function onEvent(ev: UsageEvent): void {
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
  C.pulse(text, kind);
  if (!S.reducedMotion && !mini() && running()) {
    const f = document.createElement('div');
    f.className = 'floater'; f.textContent = text;
    f.style.bottom = 8 + 14 * farm.querySelectorAll('.floater').length + 'px'; // stack, don't overlap
    farm.appendChild(f);
    setTimeout(() => f.remove(), 1700);
  }
  wake();
}

// ---------- settings: the farm's own sections of the Settings sheet ----------

function applySettings(): void {
  if (ready && (sim.seed !== S.seed || simSize !== S.mapSize)) { save(); void newFarm(); }
  if (C.panelOpen) renderPanel();
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
    b.onclick = () => C.set({ palette: id });
    host.appendChild(b);
    thumbs.set(id, { canvas: c, view: new View() });
  }
  const calm = $<HTMLInputElement>('calm');
  calm.oninput = () => C.set({ calm: +calm.value / 100 });
  const fade = $<HTMLInputElement>('fadeIdle');
  fade.onchange = () => C.set({ fadeIdle: fade.checked });
  for (const b of $('maps').querySelectorAll<HTMLButtonElement>('[data-map]')) b.onclick = () => C.set({ mapSize: b.dataset.map as Settings['mapSize'] });
}

function renderPanel(): void {
  for (const b of $('pals').querySelectorAll<HTMLButtonElement>('.pal')) b.classList.toggle('on', b.dataset.pal === S.palette);
  $('palNote').textContent = PALETTES[S.palette].name + ': ' + PALETTES[S.palette].note;
  const calm = $<HTMLInputElement>('calm');
  if (document.activeElement !== calm) calm.value = String(Math.round(S.calm * 100));
  $('calmV').textContent = Math.round(S.calm * 100) + '%';
  $<HTMLInputElement>('fadeIdle').checked = S.fadeIdle;
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
  const mood = sim.over() ? 'Game over: start a new farm' : h.mood === 'fed' ? 'Fed' : h.mood === 'hungry' ? 'Hungry: the store is low' : h.mood === 'starving' ? `Starving for ${age(h.starvingMs)}: tokens bring food` : 'Empty';
  $('health').innerHTML = [
    ['Ants', h.workers + (h.queen ? ' + queen' : '') + (h.brood ? ` · ${h.brood} brood` : '')],
    ['Food stored', h.food + (h.loose ? ` · ${h.loose} still outside` : '')],
    ['Oldest ant', h.workers ? age(h.oldestMs) : '–'],
    ['Queen', h.queen ? age(h.queenAgeMs) + ' old' : '–'],
    ['State', mood],
    ['Score', num(points) + (runs.best ? ` · best ${num(Math.max(points, runs.best.score))}` : '')],
  ].map(([k, v]) => `<div class="hrow"><span>${k}</span><span>${v}</span></div>`).join('');
}

// ---------- input: the camera ----------

function cycle<T>(list: readonly T[], cur: T): T { return list[(list.indexOf(cur) + 1) % list.length]; }

function zoomBy(f: number, sx = vw() / 2, sy = vh() / 2): void {
  if (!cam || mini()) return;
  manual();
  const l = limits(), s = Math.max(l.min, Math.min(l.max, (zoomGoal ? zoomGoal.s : cam.s) * f));
  zoomGoal = { s, sx, sy };
  wake(true);
}
function panScreen(dx: number, dy: number): void {
  if (!cam || mini()) return;
  manual();
  cam = keepIn(panBy(cam, dx, dy));
  wake(true);
}

// The keys the shell leaves to the game (it keeps Esc , O H, and 1 2 F T D in the window).
function onKey(k: string): boolean {
  const step = Math.min(vw(), vh()) * 0.2;
  if (k === 'p') C.set({ palette: cycle(PALETTE_IDS, S.palette) });
  else if (k === 'm') C.set({ mapSize: cycle(MAP_SIZE_IDS, S.mapSize) });
  else if (k === 'a') follow();
  else if (k === 'i') { showStats = !showStats; $('stats').hidden = !showStats; wake(true); }
  else if (k === 'ArrowLeft') panScreen(-step, 0);
  else if (k === 'ArrowRight') panScreen(step, 0);
  else if (k === 'ArrowUp') panScreen(0, -step);
  else if (k === 'ArrowDown') panScreen(0, step);
  else if (k === '+' || k === '=') zoomBy(1.25);
  else if (k === '-' || k === '_') zoomBy(1 / 1.25);
  else return false;
  return true;
}

const followBtn = document.createElement('button');
followBtn.className = 'tg-wbtn'; followBtn.id = 'bFollow'; followBtn.hidden = true;
followBtn.title = 'Follow the colony again (A, or double-click)';
followBtn.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="6" cy="6" r="3.2"/><circle cx="6" cy="6" r=".9" fill="currentColor"/><path d="M6 .8v1.8M6 9.4v1.8M.8 6h1.8M9.4 6h1.8"/></svg>';
followBtn.onclick = () => follow();

// Two fingers on a trackpad pan, 1:1 and at once; a pinch zooms around the pointer; a mouse wheel zooms; dragging pans
// and glides on when let go. Double-click (or A) lets the camera follow the colony again. In the notch the farm is
// only a picture: a click there opens the drop-down.
view.addEventListener('wheel', (e) => {
  if (mini()) return;
  e.preventDefault();
  if (!cam) return;
  const w = { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, wheelDeltaY: (e as unknown as { wheelDeltaY?: number }).wheelDeltaY };
  const kind = classifyWheel(w), d = wheelPixels(w, vh());
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
  if (!cam || e.button !== 0 || mini()) return;
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
view.addEventListener('dblclick', () => { if (!mini()) follow(); });
new ResizeObserver(() => { snap = true; wake(); }).observe(farm);
document.addEventListener('mousemove', () => { if (S && S.fadeIdle && dim > 0) { lastEvt = performance.now(); wake(); } }); // a faded farm comes back when pointed at

// ---------- start ----------

mountShell<Settings>({
  name: 'Ant Farm',
  root: farm,
  icon: ANT,
  settingsPanel: $('afPanel'),
  barButtons: [followBtn],
  keysHelp: 'Two fingers pan · pinch or wheel zooms · drag pans · double-click follows the colony · arrows pan · + − zoom · A follow · P palette · M map size · I stats',
  async start(ctx) {
    C = ctx; S = ctx.settings; dark = ctx.dark; feed = ctx.feed; smoke = ctx.smoke; scale = ctx.scale;
    buildPanel();
    await newFarm();
  },
  onEvent,
  onSettings(s) { S = s; if (C) applySettings(); },
  onScale(s) { scale = s; farm.classList.toggle('mini', s === 'mini'); if (shownOver) overEl.hidden = s === 'mini'; snap = true; if (C) wake(true); },
  onDark(d) { dark = d; wake(); },
  onFeed(f) { feed = f; if (C.panelOpen) renderPanel(); },
  onPanel(open) { if (open) { renderPanel(); lastThumbs = 0; } wake(); },
  onFullscreen() { snap = true; wake(); },
  onKey,
  onHide() { if (ready) { lastSave = performance.now(); C.saveNow(saveData()); } },
  testHooks,
});

// For the automated smoke test only: read-only views of the farm, and a way to move the camera like a player. There is
// no way here to feed the farm: the smoke test writes a real transcript line for that.
function testHooks(): Record<string, unknown> {
  return {
    state: () => ({
      ready, energy: sim.energy, tokens: sim.stats.tokens, tick: sim.tick, ants: sim.ants.length, galleries: sim.galleryQueue.length,
      palette: S.palette, mapSize: S.mapSize, W: sim.W, H: sim.H, counts: { ...counts }, scale,
      w: vw(), h: vh(), auto, cam: cam && { ...cam },
      view: perf.view, drawMs: perf.drawMs, tickMs: perf.tickMs, chunks: sim.chunkStats(), health: sim.health(),
      heapMB: ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize || 0) / 1048576,
      ages: sim.ants.map((a) => a.born), seed: sim.seed,
    }),
    colours: () => {
      const d = g2d.getImageData(0, 0, view.width, view.height).data, seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4 * 7) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return seen.size;
    },
    clickPalette: (id: string) => $('pals').querySelector<HTMLButtonElement>(`[data-pal="${id}"]`)!.click(),
    wheel: (o: WheelEventInit) => view.dispatchEvent(new WheelEvent('wheel', { cancelable: true, clientX: 100, clientY: 80, ...o })),
    look: (x: number, y: number) => { manual(); cam = keepIn({ x, y, s: cam ? cam.s : 1 }); wake(true); }, // jump the camera far away
    save: () => { save(); return sim.tick; },
    feed: () => $('feedNote').textContent || '',
    score: () => ({ points, over: sim.over(), shown: shownOver && !overEl.hidden, runs, text: overEl.innerText }),
    // The smoke test's way to the game over screen without waiting two days: every ant's life ends now. It exists only
    // in the hidden smoke run (the shell sets window.gameTest there and nowhere else) and takes nothing from the feed.
    endColony: () => { for (const a of sim.ants) a.dies = sim.now() - 1; sim.brood.length = 0; sim.life.last = Math.min(sim.life.last, sim.now() - 1000); wake(true); },
    restart: () => $('overRestart').click(),
  };
}
