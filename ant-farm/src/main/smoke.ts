// The farm's own smoke checks, run by the shell's smoke test (shell/src/main/smoke.ts) while the game is popped out in
// its small window: the farm draws and lives, real Claude Code usage feeds it, the camera, the huge map, its Settings
// sections, palettes, and that the colony survives a restart. No window is ever shown.
import { app, nativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { GameSmoke, SmokeKit } from '@token-games/shell/main/smoke';
import type { Settings } from '../shared/settings';

const colonyFile = () => path.join(app.getPath('userData'), 'colony.json');
const savedTick = (): number => { try { return JSON.parse(fs.readFileSync(colonyFile(), 'utf8')).tick; } catch { return -1; } };
const state = (k: SmokeKit<Settings>) => k.js('gameTest.state()');
let seed = -1;

// A DevTools CPU profile, summed into time per function (self time, ms per frame), heaviest first.
interface CpuProfile { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] }
function topFunctions(p: CpuProfile, frames: number, n = 10): Record<string, number> {
  const name = new Map(p.nodes.map((x) => [x.id, (x.callFrame.functionName || '(anonymous)') + (x.callFrame.url ? ' ' + path.basename(x.callFrame.url) + ':' + (x.callFrame.lineNumber + 1) : '')]));
  const self = new Map<string, number>();
  for (let i = 0; i < p.samples.length; i++) { const f = name.get(p.samples[i])!; self.set(f, (self.get(f) || 0) + (p.timeDeltas[i] || 0) / 1000); }
  self.delete('(idle)');
  return Object.fromEntries([...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([f, ms]) => [f, Math.round((ms / Math.max(1, frames)) * 1000) / 1000]));
}

export const farmSmoke: GameSmoke<Settings> = {
  async full(k) {
    const { check, js, until, wait, shot } = k;
    await wait(1000);
    let st = await state(k);
    const colours = await js<number>('gameTest.colours()');
    check('the farm draws in the window', st.scale === 'window' && st.counts.frames > 3 && colours > 8, { frames: st.counts.frames, colours, scale: st.scale });
    check('the simulation runs', st.tick > 10, st.tick);
    check('first run: Desktop Blend', k.store.get().palette === 'blend');
    seed = k.store.get().seed;
    check('the map is Ridiculous by default', st.mapSize === 'ridiculous' && st.W === 65536 && st.H === 16384, { size: st.mapSize, W: st.W, H: st.H });
    check('only a few chunks are loaded', st.chunks.loaded < 400, st.chunks);
    check('no cheat controls anywhere', !/\+5k|Task done|Wide room|Watch Claude Code|Feed|Add tokens/i.test(await js<string>('shellTest.text()')));

    // the real feed: a Claude Code transcript line appears; the line already there must not replay
    const e0 = st.energy;
    k.transcript({ input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 4000, cache_creation_input_tokens: 300 }, 'msg_smoke_2');
    const fed = await until(async () => (await state(k)).counts.tasks >= 1, 6000);
    st = await state(k);
    check('a new transcript line feeds tokens and a finished turn', fed && st.counts.tokens === 1 && st.tokens > 0, st.counts);
    check('real tokens are the only thing that raises energy', st.energy > e0, { before: e0, after: st.energy });
    check('the orb counts the ants', await until(async () => (await k.js('shellTest.state()')).count === String(st.health.workers)), await k.js('shellTest.state()'));

    // the camera: two-finger scroll pans 1:1, a pinch zooms, A follows the colony again
    const c0 = (await state(k)).cam;
    await js('gameTest.wheel({ deltaX: 120, deltaY: 0, deltaMode: 0 })');
    st = await state(k);
    check('a two-finger scroll pans 1:1 and pauses the auto camera', !st.auto && Math.abs((st.cam.x - c0.x) * st.cam.s - 120) < 1, { before: c0, after: st.cam });
    await js('gameTest.wheel({ deltaX: 0, deltaY: -40, deltaMode: 0, ctrlKey: true })');
    check('a pinch zooms in', await until(async () => (await state(k)).cam.s > c0.s * 1.3, 2000), (await state(k)).cam);
    await js('shellTest.key("a")');
    check('A gives the camera back to the colony', await until(async () => (await state(k)).auto));

    // the zoom range: out only as far as a fixed largest view, in to a sensible closest, and always inside the world
    type Bounds = { min: number; max: number; world: { x0: number; y0: number; x1: number; y1: number }; topInset: number };
    const inside = (cam: { x: number; y: number; s: number }, b: Bounds, w: number, h: number) =>
      cam.x >= b.world.x0 - 0.5 && cam.x + w / cam.s <= b.world.x1 + 0.5 && cam.y >= b.world.y0 - b.topInset / cam.s - 0.5 && cam.y + h / cam.s <= b.world.y1 + 0.5;
    for (const dir of ['zoomOut', 'zoomIn'] as const) {
      await js(`gameTest.${dir}()`);
      const b = await js<Bounds>('gameTest.bounds()');
      await until(async () => Math.abs((await state(k)).cam.s / (dir === 'zoomOut' ? b.min : b.max) - 1) < 0.005, 4000); // the zoom eases in
      st = await state(k);
      const s = st.cam.s, w = st.w / s, h = st.h / s;
      check(dir === 'zoomOut' ? 'zooming out stops at the largest view (a bounded number of chunks)' : 'zooming in stops at a sensible closest view',
        dir === 'zoomOut' ? Math.abs(s / b.min - 1) < 0.005 && w <= 768 + 1 && h <= 432 + 1 : Math.abs(s / b.max - 1) < 0.005 && Math.min(w, h) >= 11.9, { cam: st.cam, view: [w, h], b });
      check(`${dir === 'zoomOut' ? 'zoomed out' : 'zoomed in'}, the view stays inside the world and below the strip of sky`, inside(st.cam, b, st.w, st.h), { cam: st.cam, b });
    }
    await js('gameTest.look(1e9, -1e9)');
    st = await state(k);
    const b0 = await js<Bounds>('gameTest.bounds()');
    check('panning past the edge stops at the edge of the world', inside(st.cam, b0, st.w, st.h), { cam: st.cam, b: b0 });
    await js('shellTest.key("a")');

    // far across the map: the chunks there are made on demand, then let go; memory stays bounded
    for (const [x, y] of [[40000, 9000], [60000, 15000], [8000, 12000]]) {
      await js(`gameTest.look(${x}, ${y})`);
      await until(async () => { const v = (await state(k)).view; return !!v && v.waiting === 0 && v.visible > 0; }, 3000);
    }
    await wait(1500);
    st = await state(k);
    check('far corners draw, and memory stays bounded', st.view.waiting === 0 && st.chunks.loaded < 1500 && st.heapMB < 400, { view: st.view, chunks: st.chunks, heapMB: Math.round(st.heapMB) });
    check('a frame stays cheap on the Ridiculous map', st.drawMs < 16, { drawMs: +st.drawMs.toFixed(2), tickMs: +st.tickMs.toFixed(3) });
    await js('shellTest.key("a")');

    // the farm's Settings sections, above the shell's Display section, in the centred Settings window
    await js('shellTest.key(",")');
    check('Settings opens with , in its own window', await k.settingsReady() && (await k.js('shellTest.state()')).panelOpen);
    check('the palette previews reach the window', await until(async () => (await k.sjs<{ images: number }>('settingsTest.look()')).images >= 7, 4000));
    const grid = await k.sjs<{ n: number; w: number }>(
      `(() => { const p = document.getElementById('sw-sheet').getBoundingClientRect(), c = document.querySelector('.pal img').getBoundingClientRect();
        return { n: document.querySelectorAll('.pal').length, w: c.width / p.width }; })()`);
    check('Settings shows small palette previews', grid.n === 7 && grid.w < 0.5, grid);
    const text = (await k.sjs<string>('settingsTest.text()')).toLowerCase(); // section titles are drawn in capitals
    check('Settings shows the colony, the map size, calm and the display', ['ants', 'food stored', 'oldest ant', 'ridiculous', 'calm', 'display', 'reset to defaults'].every((w) => text.includes(w)), text.slice(-500));
    check('the feed status shows in Settings', /watching \d+ claude code transcripts/.test(text) && /Watching \d+ Claude Code transcripts/.test(await js<string>('gameTest.feed()')), await js('gameTest.feed()'));
    await k.settingsShot('window-settings');
    await k.sjs(`settingsTest.click('[data-pal="graphite"]')`);
    check('picking Graphite in the window applies and saves it', await until(async () => k.store.get().palette === 'graphite' && (await state(k)).palette === 'graphite'));
    await k.sjs('settingsTest.key("Escape")');
    await until(() => !k.settingsWin());

    // the performance readout: off by default, a switch in Settings shows frames a second and ms in a corner of the farm
    check('the performance readout is off by default', !(await js<{ perf: string | false }>('gameTest.bounds()')).perf);
    await js('shellTest.key(",")');
    await k.settingsReady();
    await k.sjs('settingsTest.click("#perfReadout")');
    await k.sjs('settingsTest.key("Escape")');
    await until(() => !k.settingsWin());
    check('Show performance puts frames a second and ms on the farm', k.store.get().perfReadout && await until(async () => /\d+ fps · [\d.]+ ms/.test(String((await js<{ perf: string | false }>('gameTest.bounds()')).perf)), 3000),
      await js('gameTest.bounds()'));
    await shot('window-perf-readout');
    k.update({ perfReadout: false } as Partial<Settings>);

    // smooth: walking ants glide on every display frame, not only on a simulation step (20 a second); Reduced motion
    // keeps the few frames it promises
    const rate = async () => { await js('gameTest.perfReset()'); await wait(1500); return (await js<{ fps: number }>('gameTest.perf()')).fps; };
    const smoothFps = await rate();
    check('in the window the farm draws on every display frame while ants walk', smoothFps >= 45, smoothFps);
    k.update({ reducedMotion: true } as Partial<Settings>);
    await wait(200);
    const calmFps = await rate();
    check('Reduced motion keeps it to a few frames a second', calmFps > 0 && calmFps <= 12, calmFps);
    k.update({ reducedMotion: false } as Partial<Settings>);

    // light mode and Desktop Blend's light variant
    k.update({ palette: 'blend' } as Partial<Settings>);
    nativeTheme.themeSource = 'light';
    check('Desktop Blend follows light mode', await until(async () => (await k.js('shellTest.state()')).back === '#c8c5c0'), (await k.js('shellTest.state()')).back);
    await shot('window-blend-light');
    nativeTheme.themeSource = 'dark';

    // game over: the last ant dies (a test hook ages them all; nothing a player can reach), the score stays, the orb
    // turns warm, and a fresh farm starts from the Game Over screen
    const seed0 = (await state(k)).seed;
    k.update({ size: 'large' } as Partial<Settings>);
    const over = await until(async () => { await js('gameTest.endColony()'); return (await js('gameTest.score()')).shown; }, 20000);
    const sc = await js('gameTest.score()');
    check('when the last ant dies the Game Over screen shows the score and the breakdown', over && sc.over && sc.points > 0 && /game over/i.test(sc.text) && /best/i.test(sc.text), sc);
    check('the run is kept in the local record', sc.runs.list.length >= 1 && sc.runs.best.score >= sc.points, sc.runs);
    check('the orb turns warm and counts no ants', await until(async () => { const p = await k.js('shellTest.state()'); return p.warm && p.count === '0'; }), await k.js('shellTest.state()'));
    await k.shots('game-over-window');
    k.dispatch('dock');
    await until(() => k.state() === 'orb', 3000);
    await k.shots('game-over-orb');
    k.dispatch('toggle');
    check('the open card shows Game Over too', await until(async () => k.state() === 'expanded' && (await js('gameTest.score()')).shown), await js('gameTest.score()'));
    await k.shots('game-over-card');
    await js('gameTest.restart()');
    check('Restart starts a fresh farm with a living colony', await until(async () => {
      const x = await state(k), s2 = await js('gameTest.score()');
      return !s2.over && !s2.shown && x.seed !== seed0 && x.health.workers > 0;
    }), { state: (await state(k)).seed, score: await js('gameTest.score()') });
    check('…and the record keeps the run that ended', (await js('gameTest.score()')).runs.list.length >= 1);
    seed = k.store.get().seed; // the fresh farm's map, which Reset must keep
    k.dispatch('escape');
    k.dispatch('pop');
    await until(() => k.state() === 'popped', 3000);
    k.update({ size: 'small', calm: 0.3, fadeIdle: true } as Partial<Settings>); // calm and fade for Reset to put back
  },

  async reset(k) {
    const s = k.store.get();
    k.check('Reset brings back the farm\'s defaults but keeps its map', s.palette === 'blend' && s.calm === 0 && !s.fadeIdle && s.mapSize === 'ridiculous' && s.seed === seed, { s, seed });
  },

  async leave(k) {
    k.update({ palette: 'graphite', calm: 0.4 } as Partial<Settings>);
    await k.js('gameTest.save()');
    k.check('the colony is saved to its file', await k.until(() => savedTick() > 0), savedTick());
  },

  async reopen(k) {
    const t0 = savedTick();
    k.check('the colony was saved when the app quit', t0 > 0, t0);
    k.check('the colony comes back where it was left', await k.until(async () => { const x = await state(k); return x.ready && x.tick >= t0; }), { saved: t0, now: (await state(k)).tick });
    const s = k.store.get();
    k.check('the farm\'s settings survive a restart', s.palette === 'graphite' && s.calm === 0.4, s);
    k.check('the page gets the saved settings', await k.until(async () => (await state(k)).palette === 'graphite'));
    await k.shot('window-reopened');
  },

  // npm run perf: what a frame costs, in each place the farm lives, with the save it was started with (a copy of a real
  // farm with --profile). Numbers only; the checks just make sure each part was measured.
  async perf(k) {
    const { check, js, until, wait, note, cpu } = k;
    check('the farm is ready', await until(async () => (await state(k)).ready, 15000));
    const st = await state(k);
    note('farm', { W: st.W, H: st.H, ants: st.ants, tick: st.tick, chunks: st.chunks.loaded, settings: (({ presentation, reducedMotion, size, palette, mapSize }) => ({ presentation, reducedMotion, size, palette, mapSize }))(k.store.get()) });
    // DevTools on the hidden page: a sampling CPU profile (time by function, garbage collection) and the page's own
    // counters (layout, style, script) for each part, so the top costs are measured, not guessed
    const dbg = k.win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Performance.enable');
    await dbg.sendCommand('Profiler.enable');
    await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 250 });
    const counters = async () => Object.fromEntries(((await dbg.sendCommand('Performance.getMetrics')) as { metrics: { name: string; value: number }[] }).metrics.map((m) => [m.name, m.value]));
    note('rafPerSecond', await js('new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); setTimeout(() => r(n), 1500); })'));
    const measure = async (name: string, ms: number) => {
      await wait(800);
      await js('gameTest.perfReset()');
      const c0 = await counters();
      await dbg.sendCommand('Profiler.start');
      const use = await cpu(ms);
      const { profile } = (await dbg.sendCommand('Profiler.stop')) as { profile: CpuProfile };
      const c1 = await counters();
      const p = await js('gameTest.perf()');
      const per = (v: number) => Math.round((p.frames ? v / p.frames : 0) * 100) / 100;
      const d = (key: string) => per((c1[key] - c0[key]) * 1000);
      note(name, { ...p, cpu: use, page: { taskMs: d('TaskDuration'), scriptMs: d('ScriptDuration'), layoutMs: d('LayoutDuration'), styleMs: d('RecalcStyleDuration'), layouts: per(c1.LayoutCount - c0.LayoutCount) }, top: topFunctions(profile, p.frames) });
      check(`measured: ${name}`, p.frames > 0, p);
    };
    const go = async (st2: string, ev: 'toggle' | 'pop' | 'dock' | 'escape') => { if (k.state() !== st2) { k.dispatch(ev); await until(() => k.state() === st2, 3000); } };
    await go('orb', 'dock');
    await measure('orb', 8000);
    await go('expanded', 'toggle');
    await measure('card', 8000);
    k.dispatch('escape');
    await go('popped', 'pop');
    await measure('window (settings as saved)', 8000);
    k.update({ reducedMotion: false, size: 'large' } as Partial<Settings>);
    await measure('window, large, full motion', 8000);
    await js('gameTest.zoomIn()');
    await measure('window, large, zoomed in', 6000);
    await js('gameTest.zoomOut()');
    await measure('window, large, zoomed out', 6000);
    await js('shellTest.key("a")');
    await js('window.__pan = setInterval(() => gameTest.pan(3, 1), 16)');
    await measure('window, large, camera moving', 6000);
    await js('gameTest.zoomOut()');
    await wait(1500);
    await measure('window, large, zoomed out, camera moving', 6000);
    await js('clearInterval(window.__pan); shellTest.key("a")');
    await js('shellTest.key(",")');
    await k.settingsReady();
    await measure('window, large, Settings open', 6000);
    await k.sjs('settingsTest.key("Escape")').catch(() => undefined);
  },
};
