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
    check('the island counts the ants', await until(async () => (await k.js('shellTest.state()')).count === String(st.health.workers)), await k.js('shellTest.state()'));

    // the camera: two-finger scroll pans 1:1, a pinch zooms, A follows the colony again
    const c0 = (await state(k)).cam;
    await js('gameTest.wheel({ deltaX: 120, deltaY: 0, deltaMode: 0 })');
    st = await state(k);
    check('a two-finger scroll pans 1:1 and pauses the auto camera', !st.auto && Math.abs((st.cam.x - c0.x) * st.cam.s - 120) < 1, { before: c0, after: st.cam });
    await js('gameTest.wheel({ deltaX: 0, deltaY: -40, deltaMode: 0, ctrlKey: true })');
    check('a pinch zooms in', await until(async () => (await state(k)).cam.s > c0.s * 1.3, 2000), (await state(k)).cam);
    await js('shellTest.key("a")');
    check('A gives the camera back to the colony', await until(async () => (await state(k)).auto));

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

    // the farm's Settings sections, above the shell's Display section
    await js('shellTest.key(",")');
    check('Settings opens with ,', await until(async () => (await k.js('shellTest.state()')).panelOpen));
    const grid = await js<{ n: number; w: number }>(
      `(() => { const p = document.getElementById('tg-panel').getBoundingClientRect(), c = document.querySelector('.pal canvas').getBoundingClientRect();
        return { n: document.querySelectorAll('.pal').length, w: c.width / p.width }; })()`);
    check('Settings shows small palette previews', grid.n === 7 && grid.w < 0.5, grid);
    const text = (await js<string>('shellTest.text()')).toLowerCase(); // section titles are drawn in capitals
    check('Settings shows the colony, the map size, calm and the display', ['ants', 'food stored', 'oldest ant', 'ridiculous', 'calm', 'display', 'reset to defaults'].every((w) => text.includes(w)), text.slice(-500));
    check('the feed status shows in Settings', /Watching \d+ Claude Code transcripts/.test(await js<string>('gameTest.feed()')), await js('gameTest.feed()'));
    await shot('window-settings');
    await js('gameTest.clickPalette("graphite")');
    check('picking Graphite applies and saves it', await until(async () => k.store.get().palette === 'graphite' && (await state(k)).palette === 'graphite'));
    await js('shellTest.key("Escape")');

    // light mode and Desktop Blend's light variant
    k.update({ palette: 'blend' } as Partial<Settings>);
    nativeTheme.themeSource = 'light';
    check('Desktop Blend follows light mode', await until(async () => (await k.js('shellTest.state()')).back === '#c8c5c0'), (await k.js('shellTest.state()')).back);
    await shot('window-blend-light');
    nativeTheme.themeSource = 'dark';
    k.update({ calm: 0.3, fadeIdle: true } as Partial<Settings>); // for Reset to put back
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
};
