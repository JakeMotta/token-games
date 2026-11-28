// The game's page: the ink tower defense in #game, which the shell moves between the orb ('mini', a small circle that
// shows a close-up of the road), the open card ('expanded') and the popped-out window ('window').
// The loop follows the Ant Farm's: the simulation steps at a fixed 30 a second (times the game speed) and the picture is
// drawn between steps; every screen frame while anything moves, a few a second when calm, 1–4 in the orb, none while
// hidden or asleep. Usage is the only thing that moves the game forward: the buttons here only build, upgrade, sell,
// pause and change the speed; none of them adds tokens or gold.
import type { GameContext, Scale } from '@token-games/shell/game';
import type { UsageEvent } from '@token-games/shell/events';
import { mountShell } from '@token-games/shell/page/shell-page';
import { STEP, TDGame, type Tower } from '../sim/game';
import { waveCost } from '../sim/enemies';
import { CASTLE, CELL, COLS, H, ROWS, W } from '../sim/map';
import { fmt } from '../sim/num';
import { nearest, snap } from '../sim/placement';
import { ROMAN, TOWERS, TOWER_IDS, affordable, dps, nextUnlock, sellValue, type TowerId } from '../sim/towers';
import { THEMES, type Settings, type ThemeId } from '../shared/settings';
import { DARK, LIGHT, Pen, type Palette } from './ink';
import { Renderer, sketch, type Ghost, type View } from './render';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const root = $('game'), canvas = $<HTMLCanvasElement>('view'), c2d = canvas.getContext('2d')!;
const ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 14V6h8v8M4 6V3.5h1.6V5h1.6V3.5h1.6V5h1.6V3.5H12V6M7 14v-3h2v3"/></svg>';
const SAVE_EVERY = 20000;

let C: GameContext<Settings>, S: Settings, scale: Scale = 'mini', dark = true, smoke = false;
let g = new TDGame(1), ready = false, asleep = false;
let P: Palette = DARK;
const R = new Renderer(c2d, P);

// ---------- the view: page units (960 × 528) to css pixels ----------

let lastTop = -1;
let view: View = { s: 1, ox: 0, oy: 0, w: 1, h: 1, dpr: 1 };
const mini = () => scale === 'mini';

function fit(): void {
  const top = mini() ? 0 : C ? C.topInset : 0, w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight - top);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.style.top = top + 'px'; canvas.style.height = h + 'px';
  if (top !== lastTop) { lastTop = top; root.style.setProperty('--td-top', top + 'px'); } // the HUD sits under the title bar
  const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  if (mini()) {
    // the orb: a close-up where the walkers are (the castle when the road is empty), so it says "busy" at a glance
    let fx = 0, fy = 0, n = 0;
    for (const e of g.enemies) if (e.alive) { fx += e.x; fy += e.y; n++; }
    const [x, y] = n ? [fx / n, fy / n] : [CASTLE[0], CASTLE[1] - 30], s = w / 300;
    view = { s, ox: w / 2 - x * s, oy: h / 2 - y * s, w, h, dpr };
    return;
  }
  // the page fits whole, centred; a wider window shows more paper at the sides
  const s = Math.min(w / W, h / H);
  view = { s, ox: (w - W * s) / 2, oy: (h - H * s) / 2, w, h, dpr };
}

const toPage = (cx: number, cy: number): [number, number] => {
  const r = canvas.getBoundingClientRect();
  return [(cx - r.left - view.ox) / view.s, (cy - r.top - view.oy) / view.s];
};

// ---------- the theme ----------

function isDark(): boolean { return S.theme === 'dark' || (S.theme === 'system' && dark); }
function applyTheme(): void {
  const d = isDark();
  P = d ? DARK : LIGHT; R.palette = P;
  const t = d
    ? { back: '#1c1b21', bar: '#232228', ink: '#ebe3d1', dim: '#9c9584', hot: '#e0604a', task: '#7fa8d8', line: '#3a3840', panel: '#27262d' }
    : { back: '#f6efdf', bar: '#efe6d2', ink: '#1d1c22', dim: '#77705f', hot: '#d23a2a', task: '#3a6ea5', line: '#d8ccb2', panel: '#fffdf6' };
  C.setTheme(t);
  // shell.css gives body.tg its own --g-* defaults, which win over the ones setTheme puts on <html>; set them on the
  // body too so the light paper reaches the cards, the buttons and the title bar
  for (const [k, v] of Object.entries(t)) document.body.style.setProperty('--g-' + k, v);
  root.classList.toggle('light', !d);
  drawIcons();
  wake(true);
}

// ---------- the loop ----------

let raf = 0, timer = 0, lastT = 0, lastFrame = 0, lastDraw = 0, lastSave = 0, acc = 0, frames = 0;
const meter = { since: 0, frames: 0, draw: 0, step: 0, steps: 0, max: 0 };

function running(): boolean { return ready && !asleep && (smoke || !document.hidden); }

function frame(): void {
  timer = 0; raf = 0;
  if (!running()) return;
  const t = performance.now(), dt = Math.min(1100, t - lastT);
  lastT = t; lastFrame = t;
  if (!g.paused) acc += (dt / 1000 / STEP) * g.speed;
  let n = 0;
  const t0 = performance.now();
  while (acc >= 1 && n < 240) { g.step(); acc -= 1; n++; }
  if (n >= 240) acc = 0; // far behind (a stalled page): drop the rest rather than freeze catching up
  meter.step += performance.now() - t0; meter.steps += n;
  if (n) news();
  const busy = g.busy() && !g.paused, reduced = S.reducedMotion;
  C.setCalm(!busy);
  const handling = !!ghost || pointerDown;
  const live = !mini() && !reduced && (busy || handling || fxLive());
  const fps = mini() ? (reduced ? 1 : busy ? 4 : 2) : live ? Infinity : reduced ? (busy || handling ? 10 : 2) : 8;
  if (live || t - lastDraw >= 1000 / fps - 5) {
    lastDraw = t;
    const t2 = performance.now();
    draw(t / 1000);
    const ms = performance.now() - t2;
    meter.draw += ms; meter.frames++; meter.max = Math.max(meter.max, ms);
    if (!mini() && t - lastHud > 200) { lastHud = t; hud(); }
  }
  if (t - lastSave > SAVE_EVERY) save();
  if (live) { raf = requestAnimationFrame(frame); return; }
  timer = window.setTimeout(frame, Math.max(4, 1000 / fps - (performance.now() - t)));
}

function stop(): void { clearTimeout(timer); timer = 0; cancelAnimationFrame(raf); raf = 0; }

// Draw soon: `now` for input, which shouldn't wait for an idle frame.
function wake(now = false): void {
  if (!running()) return;
  if (raf || (timer && !now)) return;
  if (!timer) lastT = performance.now();
  clearTimeout(timer);
  lastDraw = 0;
  timer = window.setTimeout(frame, Math.max(0, 8 - (performance.now() - lastFrame)));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); save(); } else wake(); });

const fxLive = (): boolean => { for (const f of g.fx) if (f.t < f.life) return true; return false; };

function draw(t: number): void {
  frames++;
  fit();
  R.draw(g, view, { alpha: Math.min(1, acc), t, reduced: S.reducedMotion, mini: mini(), sel: mini() ? null : sel, ghost: mini() ? null : ghost, toast });
}

function save(): void {
  if (!ready) return;
  lastSave = performance.now();
  void C.save(g.save());
}

// ---------- what happened: the orb's badge, pulses, the tip ----------

let toast: { text: string; at: number } | null = null, lastHud = 0;
const say = (text: string) => { toast = { text, at: performance.now() / 1000 }; wake(true); };

function news(): void {
  if (!g.events.length) return;
  for (const e of g.events) {
    if (e.kind === 'wave') C.pulse(`wave ${fmt(e.value)}`);
    if (e.kind === 'unlock') { const n = TOWER_IDS.filter((id) => TOWERS[id].unlock === e.value).map((id) => TOWERS[id].name); if (n.length) { C.pulse(`new: ${n.join(', ')}`, 'task'); say(`new tower: ${n.join(', ')}`); } drawIcons(); }
    if (e.kind === 'tear') { C.pulse('the page tore', 'hot'); }
    if (e.kind === 'turn') C.pulse(`turn done · +${fmt(e.value)} gold`, 'task');
    if (e.kind === 'clear') save();
  }
  g.events.length = 0;
  status();
}

function status(): void {
  C.setStatus({ count: fmt(g.wave), title: 'wave', lead: `♥ ${g.lives}`, line: `${fmt(g.gold)} gold · ${g.towers.length} towers · ${g.queued()} waiting`, warm: g.busy() });
}

const TIPS = [
  'Tap empty paper to build a tower (or press B)',
  'Waves come from your Claude Code tokens: they fill the ink bucket',
  'Tap a tower to upgrade it: levels never end',
];
function tip(): void {
  const el = $('tip'), text = TIPS[g.tips];
  el.hidden = mini() || !text || !!sel || !!buildAt || !!ghost;
  if (text) $('tipText').textContent = text;
}

// ---------- the HUD ----------

function hud(): void {
  $('hLives').textContent = String(g.lives);
  $('hGold').textContent = fmt(g.gold);
  $('hWave').textContent = fmt(g.wave);
  $<HTMLButtonElement>('bPause').classList.toggle('on', g.paused);
  $<HTMLButtonElement>('bPause').textContent = g.paused ? '▶' : 'Ⅱ';
  $<HTMLButtonElement>('bSpeed').textContent = `${g.speed}×`;
  $<HTMLButtonElement>('bAuto').classList.toggle('on', g.auto);
  const send = $<HTMLButtonElement>('bSend');
  send.disabled = !g.ready();
  send.title = g.ready() ? 'Send the next wave now' : `The bucket needs ${fmt(g.nextCost() - g.ink)} more tokens`;
  if (!$('buildCard').hidden) buildTiles();
  if (sel && !$('towerCard').hidden) towerCard();
  tip();
}

$('bPause').onclick = () => { g.paused = !g.paused; hud(); wake(true); };
$('bSpeed').onclick = () => { g.speed = g.speed === 1 ? 2 : g.speed === 2 ? 4 : 1; hud(); save(); };
$('bAuto').onclick = () => { g.auto = !g.auto; hud(); save(); };
$('bSend').onclick = () => { if (g.send()) { news(); hud(); wake(true); } };
$('bBuild').onclick = () => { if ($('buildCard').hidden) openBuild(null); else closeAll(); };

// ---------- the build card ----------

let buildAt: [number, number] | null = null; // the page point the card was opened for ("build here?")

function drawIcons(): void {
  for (const cv of $('buildTiles').querySelectorAll<HTMLCanvasElement>('canvas')) {
    const id = cv.dataset.t as TowerId, ctx = cv.getContext('2d')!, d = Math.min(2, window.devicePixelRatio || 1);
    cv.width = 44 * d; cv.height = 44 * d;
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, 44, 44); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const pen = new Pen(ctx, P), k = TOWERS[id].size === 3 ? 0.55 : 0.62;
    sketch(pen, id, 1, 22, id === 'tack' ? 30 : 40, k, 3, -0.6, 0, false, 0);
  }
}

function buildTiles(): void {
  const best = Math.max(1, g.stats.best);
  for (const b of $('buildTiles').querySelectorAll<HTMLButtonElement>('button')) {
    const d = TOWERS[b.dataset.t as TowerId], locked = d.unlock > best;
    b.classList.toggle('locked', locked); b.classList.toggle('poor', !locked && g.gold < d.cost);
    b.disabled = locked;
    b.querySelector('.cost')!.textContent = locked ? `wave ${d.unlock}` : `${fmt(d.cost)}g`;
  }
  const nx = nextUnlock(best);
  $('buildNote').textContent = nx ? `next: ${nx.name} at wave ${nx.unlock}` : 'every tower is yours';
}

function openBuild(at: [number, number] | null): void {
  closeAll();
  buildAt = at;
  $('buildTitle').textContent = at ? 'build here?' : 'build';
  $('buildCard').hidden = false;
  buildTiles(); tip(); wake(true);
}

$('buildTiles').innerHTML = TOWER_IDS.map((id) => {
  const d = TOWERS[id];
  return `<button class="tile" data-t="${id}" title="${d.name}: ${d.role}"><canvas data-t="${id}"></canvas><span class="nm">${d.name}</span><span class="cost"></span></button>`;
}).join('');
$('buildTiles').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b || b.disabled) return;
  const id = b.dataset.t as TowerId;
  if (g.gold < TOWERS[id].cost) { say(`${TOWERS[id].name} costs ${fmt(TOWERS[id].cost)} gold`); return; }
  const at = buildAt;
  closeAll();
  if (at) {
    // straight onto the spot the card was opened for, when it fits there (or a cell or two off)
    const [cx, cy] = snap(id, at[0], at[1]), spot = nearest(g.grid, id, cx, cy, 2);
    if (spot && g.build(id, spot[0], spot[1])) { built(); return; }
  }
  startPlacing(id, at);
});
$('buildClose').onclick = () => closeAll();

// ---------- placing and moving: the ghost ----------

let ghost: Ghost | null = null, pointerDown = false, lastPtr: [number, number] | null = null;

function startPlacing(type: TowerId, at: [number, number] | null, moving: Tower | null = null): void {
  ghost = { type, cx: 0, cy: 0, why: '', moving };
  aimGhost(at ?? [W / 2, H / 2]);
  $('placing').hidden = false;
  $('placingText').textContent = moving ? `move the ${TOWERS[type].name}: tap a free spot` : `place the ${TOWERS[type].name}: tap a free spot`;
  tip(); wake(true);
}

// The ghost under page point p: snapped to the soft grid, nudged a cell when that makes it fit.
function aimGhost(p: [number, number]): void {
  if (!ghost) return;
  const [cx, cy] = snap(ghost.type, p[0], p[1]), ign = ghost.moving?.id ?? 0;
  const spot = nearest(g.grid, ghost.type, cx, cy, 1, ign) ?? [Math.max(-1, Math.min(COLS, cx)), Math.max(-1, Math.min(ROWS, cy))];
  ghost.cx = spot[0]; ghost.cy = spot[1];
  ghost.why = g.grid.why(ghost.type, ghost.cx, ghost.cy, ign) || (!ghost.moving && g.gold < TOWERS[ghost.type].cost ? 'not enough gold' : '');
}

function placeGhost(): boolean {
  if (!ghost || ghost.why) { if (ghost) say(ghost.why); return false; }
  if (ghost.moving) {
    const t = ghost.moving;
    if (!g.move(t, ghost.cx, ghost.cy)) return false;
    closeAll(); select(t); save();
    return true;
  }
  if (!g.build(ghost.type, ghost.cx, ghost.cy)) return false;
  closeAll(); built();
  return true;
}

function built(): void { hud(); status(); save(); wake(true); }

$('placingCancel').onclick = () => closeAll();

// ---------- the tower card ----------

let sel: Tower | null = null;

function select(t: Tower | null): void {
  closeAll();
  sel = t;
  if (t) { $('towerCard').hidden = false; towerCard(); }
  tip(); wake(true);
}

function towerCard(): void {
  const t = sel;
  if (!t || !g.towers.includes(t)) { select(null); return; }
  const d = TOWERS[t.type], s = t.st, up = g.upgradeCost(t);
  $('tName').textContent = d.name;
  $('tLevel').textContent = `level ${t.level < 40 ? ROMAN(t.level) : fmt(t.level)}`;
  $('tRole').textContent = d.role;
  const cheer = t.cheer ? ` · cheered +${Math.round(t.cheer * 100)}%` : '';
  const lines: string[] = [];
  if (t.type === 'flag') lines.push(`cheer +${Math.round(s.aura * 100)}% · reach ${Math.round(s.range / CELL)}`);
  else if (t.type === 'well') lines.push(`gold ×${fmt(s.aura)} · reach ${Math.round(s.range / CELL)}`);
  else lines.push(`${fmt(s.dmg)} dmg · ${s.rate ? s.rate.toFixed(1) + '/s · ' : ''}reach ${Math.round(s.range / CELL)}`, `≈ ${fmt(dps(t.type, s) * (1 + t.cheer))} a second${cheer}`);
  lines.push(`${fmt(t.kills)} beaten`);
  $('tStats').textContent = lines.join('\n');
  const next = (Math.floor(t.level / 10) + 1) * 10;
  $('tFlavor').textContent = `${d.flavor} · next milestone: level ${fmt(next)}`;
  const ten = affordable(t.type, t.level, Infinity, 10), most = affordable(t.type, t.level, g.gold);
  setBtn('tUp1', `+1 · ${fmt(up)}g`, g.gold >= up);
  setBtn('tUp10', `+10 · ${fmt(ten.cost)}g`, g.gold >= ten.cost);
  setBtn('tUpMax', most.levels ? `+${fmt(most.levels)} · ${fmt(most.cost)}g` : 'max', most.levels > 0);
  $('tAim').textContent = `aim: ${t.aim}`;
  $('tAim').hidden = t.type === 'flag' || t.type === 'well' || t.type === 'tack';
  $('tSell').textContent = `sell +${fmt(sellValue(t.type, t.level))}g`;
}

function setBtn(id: string, text: string, on: boolean): void { const b = $<HTMLButtonElement>(id); b.textContent = text; b.disabled = !on; }

function upgrade(n: number): void {
  if (!sel) return;
  const got = g.upgrade(sel, n);
  if (!got) { say('not enough gold'); return; }
  if (g.tips === 2) g.tips = 3;
  towerCard(); hud(); status(); save(); wake(true);
}
$('tUp1').onclick = () => upgrade(1);
$('tUp10').onclick = () => upgrade(10);
$('tUpMax').onclick = () => upgrade(Infinity);
$('tAim').onclick = () => { if (sel) { g.setAim(sel); towerCard(); save(); } };
$('tMove').onclick = () => { const t = sel; if (t) { closeAll(); startPlacing(t.type, [t.x, t.y], t); } };
$('tSell').onclick = () => { const t = sel; if (t) { const got = g.sell(t); select(null); say(`sold for ${fmt(got)} gold`); built(); } };
$('tClose').onclick = () => select(null);

function closeAll(): void {
  sel = null; ghost = null; buildAt = null;
  $('buildCard').hidden = true; $('towerCard').hidden = true; $('placing').hidden = true;
  tip(); wake(true);
}

// ---------- pointer: hover moves the ghost, a tap places, selects or opens the build card ----------

canvas.addEventListener('pointermove', (e) => {
  if (mini()) return;
  lastPtr = toPage(e.clientX, e.clientY);
  if (ghost && e.pointerType === 'mouse') { aimGhost(lastPtr); wake(true); }
});
canvas.addEventListener('pointerdown', (e) => {
  if (mini() || e.button !== 0) return;
  pointerDown = true;
});
canvas.addEventListener('pointerup', (e) => {
  if (!pointerDown || mini()) return;
  pointerDown = false;
  const p = toPage(e.clientX, e.clientY);
  if (ghost) {
    // touch has no hover: the first tap shows where it would go, a second tap on the same spot places it
    const before = [ghost.cx, ghost.cy];
    aimGhost(p);
    if (e.pointerType !== 'mouse' && (before[0] !== ghost.cx || before[1] !== ghost.cy)) { wake(true); return; }
    placeGhost();
    return;
  }
  const t = g.towerAt(p[0], p[1]) ?? tackAt(p);
  if (t) { select(t === sel ? null : t); return; }
  if (sel || !$('buildCard').hidden) { closeAll(); return; }
  if (p[0] >= 0 && p[1] >= 0 && p[0] <= W && p[1] <= H) openBuild(p);
});
canvas.addEventListener('pointercancel', () => { pointerDown = false; });
canvas.addEventListener('pointerleave', () => { pointerDown = false; });
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); closeAll(); });

// the Thumbtack is small and round on the road: a tap near it counts
function tackAt(p: [number, number]): Tower | null {
  for (const t of g.towers) if (t.type === 'tack' && Math.hypot(t.x - p[0], t.y - p[1]) < 18) return t;
  return null;
}

// ---------- settings ----------

function renderPanel(): void {
  for (const b of $('themes').querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.theme === S.theme);
  $<HTMLInputElement>('numbers').checked = S.numbers;
  const st = g.stats;
  $('statsNote').textContent = `best wave ${fmt(st.best)} · ${fmt(st.kills)} beaten · ${fmt(st.tokens)} tokens of ink · ${fmt(st.turns)} turns · ${fmt(st.tears)} torn pages`;
}
$('themes').innerHTML = THEMES.map((id) => `<button data-theme="${id}">${id === 'dark' ? 'Ink on dark' : id === 'light' ? 'Ink on paper' : 'Follow the system'}</button>`).join('');
$('themes').addEventListener('click', (e) => { const id = (e.target as HTMLElement).dataset.theme as ThemeId | undefined; if (id) C.set({ theme: id } as Partial<Settings>); });
$<HTMLInputElement>('numbers').addEventListener('change', (e) => C.set({ numbers: (e.target as HTMLInputElement).checked } as Partial<Settings>));
$('tipClose').onclick = () => { g.tips = 9; tip(); save(); };

function onKey(key: string): boolean {
  if (mini()) return false;
  if (key === 'b') { if ($('buildCard').hidden) openBuild(null); else closeAll(); return true; }
  if (key === 'p' || key === ' ') { $('bPause').click(); return true; }
  return false;
}
// Esc stays the shell's key (it closes Settings and the card); while placing or reading a tower card it also puts the
// card away, which the shell has no use for in the window
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mini() && (ghost || sel || !$('buildCard').hidden)) closeAll(); });

new ResizeObserver(() => wake(true)).observe(root);

// ---------- start ----------

mountShell<Settings>({
  name: 'Ink Tower Defense',
  root,
  icon: ICON,
  settingsPanel: $('gamePanel'),
  keysHelp: 'B builds · P or Space pauses · Esc cancels · right-click cancels placing',
  async start(ctx) {
    C = ctx; S = ctx.settings; scale = ctx.scale; dark = ctx.dark; smoke = ctx.smoke;
    root.classList.toggle('mini', scale === 'mini');
    g = TDGame.load(await ctx.load(), (Date.now() & 0xffff) + 1);
    g.numbers = S.numbers;
    applyTheme();
    ready = true; lastSave = performance.now();
    status(); hud(); renderPanel();
    if (document.fonts) void document.fonts.load('700 20px Caveat').then(() => { drawIcons(); wake(true); });
    wake(true);
  },
  onEvent(ev: UsageEvent) {
    if (!ready) return;
    const before = g.queued();
    const got = g.feed(ev);
    if (got.tokens && g.queued() > before && !g.auto) C.pulse('a wave is ready to send');
    news(); status(); wake();
  },
  onSettings(s) {
    const theme = s.theme !== S?.theme;
    S = s; g.numbers = s.numbers;
    if (C) { if (theme) applyTheme(); renderPanel(); wake(true); }
  },
  onScale(s) { scale = s; root.classList.toggle('mini', s === 'mini'); if (s === 'mini') closeAll(); tip(); if (C) wake(true); },
  onDark(d) { dark = d; if (C && S.theme === 'system') applyTheme(); },
  onPanel(open) { if (open) renderPanel(); },
  onFullscreen() { wake(true); },
  onKey,
  onHide() { if (ready) { lastSave = performance.now(); C.saveNow(g.save()); } },
  onSleep(a) { asleep = a; if (a) { stop(); save(); } else wake(true); },
  testHooks,
});

// For the automated smoke test only: read-only views of the game, where things are on screen (so the test can click
// like a player), and a benchmark on a throwaway game. Nothing here feeds the game: the test writes a transcript line.
function testHooks(): Record<string, unknown> {
  return {
    state: () => ({
      ready, scale, frames, wave: g.wave, ink: g.ink, gold: g.gold, lives: g.lives, towers: g.towers.length, alive: g.alive(), queued: g.queued(),
      levels: g.towers.map((t) => t.level), tips: g.tips, theme: S.theme, dark: isDark(), numbers: g.numbers, paused: g.paused, speed: g.speed,
      sel: sel?.id ?? 0, ghost: ghost && { type: ghost.type, cx: ghost.cx, cy: ghost.cy, why: ghost.why }, build: !$('buildCard').hidden, view: { ...view },
      stats: { ...g.stats },
    }),
    save: () => { save(); return g.wave; },
    // a page point → where it is on screen, for dispatching real pointer events
    toScreen: (x: number, y: number) => { const r = canvas.getBoundingClientRect(); return [r.left + view.ox + x * view.s, r.top + view.oy + y * view.s]; },
    towerXY: (i: number) => [g.towers[i].x, g.towers[i].y],
    perfReset: () => Object.assign(meter, { since: performance.now(), frames: 0, draw: 0, step: 0, steps: 0, max: 0 }),
    perf: () => {
      const secs = (performance.now() - meter.since) / 1000, r = (v: number) => Math.round(v * 100) / 100;
      return { fps: r(meter.frames / secs), frames: meter.frames, drawMs: r(meter.frames ? meter.draw / meter.frames : 0), maxDrawMs: r(meter.max), stepMs: r(meter.steps ? meter.step / meter.steps : 0), stepsPerFrame: r(meter.frames ? meter.steps / meter.frames : 0), canvas: [canvas.width, canvas.height], alive: g.alive(), towers: g.towers.length };
    },
    bench: (frames = 240) => bench(frames),
  };
}

// The benchmark: a throwaway game (the player's game is never touched) with 50 towers and about 100 walkers on the
// road, at the current view size. Reports the simulation's cost per step and the drawing's cost per frame.
function bench(n: number): Record<string, number> {
  const b = new TDGame(7);
  b.gold = 1e15; b.stats.best = 99; b.lives = 1e9; b.auto = false; b.numbers = true;
  // 50 towers, every kind in turn, packed onto free paper
  let k = 0;
  for (let cy = 0; cy < ROWS && b.towers.length < 50; cy++) for (let cx = 0; cx < COLS && b.towers.length < 50; cx++) {
    const id = TOWER_IDS[k % TOWER_IDS.length];
    if (b.grid.ok(id, cx, cy) && b.build(id, cx, cy)) k++;
  }
  b.wave = 120; // tough walkers, so the field stays full while measuring
  const fill = () => { while (b.alive() < 100) { b.ink = waveCost(b.wave + 1); if (!b.send()) break; for (let i = 0; i < 90; i++) b.step(); } };
  fill();
  const cv = document.createElement('canvas'); cv.width = canvas.width; cv.height = canvas.height;
  const r = new Renderer(cv.getContext('2d')!, P);
  let step = 0, drawMs = 0, alive = 0;
  for (let i = 0; i < n; i++) {
    if (i % 30 === 0) fill();
    const t0 = performance.now();
    b.step(); b.step();
    const t1 = performance.now();
    r.draw(b, { ...view, s: Math.min(view.w / W, view.h / H) }, { alpha: 0.5, t: i / 60, reduced: false, mini: false, sel: b.towers[0], ghost: null, toast: null });
    drawMs += performance.now() - t1; step += (t1 - t0) / 2; alive += b.alive();
  }
  const r2 = (v: number) => Math.round(v * 1000) / 1000;
  return { towers: b.towers.length, enemies: Math.round(alive / n), stepMs: r2(step / n), drawMs: r2(drawMs / n), frameMs: r2(drawMs / n + step / n * 2), canvasW: cv.width, canvasH: cv.height };
}

