// The automated smoke test, run inside the real app (ANT_FARM_SMOKE=<folder>) with the window never shown: it drives
// the page and the window like a player would, saves screenshots, writes result.json and quits.
// scripts/smoke.mjs starts it twice: a full run, then a 'reopen' run that checks the settings and the colony survived
// the restart.
import { app, nativeTheme, screen, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ResizeDrag } from '../shared/api';
import type { Settings } from '../shared/settings';
import { dockPoint } from './geometry';
import type { SettingsStore } from './store';

export interface SmokeContext {
  win: BrowserWindow; store: SettingsStore; outDir: string; claudeDir: string;
  update(patch: Partial<Settings>): Settings;
  resize(d: ResizeDrag): void;
  isFullscreen(): boolean;
}

interface Check { name: string; ok: boolean; detail?: string }

export async function runSmoke(c: SmokeContext): Promise<void> {
  const mode = process.env.ANT_FARM_SMOKE_MODE || 'full';
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok: !!ok, detail: detail === undefined ? undefined : JSON.stringify(detail) }); };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const js = <T = any>(code: string): Promise<T> => c.win.webContents.executeJavaScript(code);
  const state = () => js('farmTest.state()');
  const until = async (fn: () => Promise<boolean> | boolean, ms = 5000): Promise<boolean> => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await fn()) return true; await wait(100); }
    return false;
  };
  const shot = async (name: string) => {
    await wait(400);
    const img = await c.win.webContents.capturePage();
    fs.writeFileSync(path.join(c.outDir, name + '.png'), img.toPNG());
  };
  const area = () => screen.getDisplayMatching(c.win.getBounds()).workArea;
  const docked = (dock: 'tl' | 'tr' | 'bl' | 'br', w: number, h: number) => {
    const b = c.win.getBounds(), p = dockPoint(dock, area(), w, h);
    return b.width === w && b.height === h && b.x === p.x && b.y === p.y;
  };

  try {
    fs.mkdirSync(c.outDir, { recursive: true });
    nativeTheme.themeSource = 'dark';
    if (c.win.webContents.isLoading()) await new Promise<void>((r) => { c.win.webContents.once('did-finish-load', () => r()); });
    check('page loads with its test hooks', await until(() => js('!!window.farmTest')));

    const colonyFile = path.join(app.getPath('userData'), 'colony.json');
    const savedTick = (): number => { try { return JSON.parse(fs.readFileSync(colonyFile, 'utf8')).tick; } catch { return -1; } };

    if (mode === 'reopen') {
      const t0 = savedTick();
      check('the colony was saved when the app quit', t0 > 0, t0);
      check('the colony comes back where it was left', await until(async () => { const x = await state(); return x.ready && x.tick >= t0; }), { saved: t0, now: (await state()).tick });
      const s = c.store.get();
      check('settings survive a restart', s.palette === 'graphite' && s.size === 'large' && s.dock === 'tl' && s.calm === 0.4, s);
      check('the window reopens where it was left', docked('tl', 640, 360), c.win.getBounds());
      check('the page gets the saved settings', await until(async () => (await state()).palette === 'graphite'));
      return;
    }

    await wait(1500);
    let st = await state();
    const colours = await js<number>('farmTest.colours()');
    check('the farm draws', st.counts.frames > 3 && colours > 8, { frames: st.counts.frames, colours });
    check('the simulation runs', st.tick > 10, st.tick);
    check('first run: Desktop Blend, small, bottom right', c.store.get().palette === 'blend' && docked('br', 320, 180), c.win.getBounds());
    await shot('small-blend-dark');

    // the map: Ridiculous by default, and only the chunks near the colony and the screen are in memory
    check('the map is Ridiculous by default', st.mapSize === 'ridiculous' && st.W === 65536 && st.H === 16384, { size: st.mapSize, W: st.W, H: st.H });
    check('only a few chunks are loaded', st.chunks.loaded < 400, st.chunks);
    check('no cheat controls anywhere', !/\+5k|Task done|Wide room|Watch Claude Code/.test(await js<string>('farmTest.text()')) && !(await js<boolean>('!!document.getElementById("fTokens")')));
    const e0 = st.energy;

    // the real feed: a Claude Code transcript line appears; the line already there must not replay
    const file = path.join(c.claudeDir, 'demo-project', 'session-1.jsonl');
    const line = { type: 'assistant', sessionId: 'session-1', timestamp: new Date().toISOString(), isSidechain: false,
      message: { id: 'msg_smoke_2', model: 'claude-test', stop_reason: 'end_turn', content: [{ type: 'text', text: 'not read' }],
        usage: { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 4000, cache_creation_input_tokens: 300 } } };
    fs.appendFileSync(file, JSON.stringify(line) + '\n');
    const fed = await until(async () => (await state()).counts.tasks >= 1, 6000);
    st = await state();
    check('a new transcript line feeds tokens and a finished turn', fed && st.counts.tokens === 1 && st.tokens > 0, st.counts);
    check('real tokens are the only thing that raises energy', st.energy > e0, { before: e0, after: st.energy });

    // the camera: two-finger scroll pans 1:1, a pinch zooms, A follows the colony again
    const c0 = (await state()).cam;
    await js('farmTest.wheel({ deltaX: 120, deltaY: 0, deltaMode: 0 })');
    st = await state();
    check('a two-finger scroll pans 1:1 and pauses the auto camera', !st.auto && Math.abs((st.cam.x - c0.x) * st.cam.s - 120) < 1, { before: c0, after: st.cam });
    await js('farmTest.wheel({ deltaX: 0, deltaY: -40, deltaMode: 0, ctrlKey: true })');
    check('a pinch zooms in', await until(async () => (await state()).cam.s > c0.s * 1.3, 2000), (await state()).cam);
    await js('farmTest.key("a")');
    check('A gives the camera back to the colony', await until(async () => (await state()).auto));

    // far across the map: the chunks there are made on demand, then let go; memory stays bounded
    for (const [x, y] of [[40000, 9000], [60000, 15000], [8000, 12000]]) {
      await js(`farmTest.look(${x}, ${y})`);
      await until(async () => { const v = (await state()).view; return !!v && v.waiting === 0 && v.visible > 0; }, 3000);
    }
    await wait(1500);
    st = await state();
    check('far corners draw, and memory stays bounded', st.view.waiting === 0 && st.chunks.loaded < 1500 && st.heapMB < 400, { view: st.view, chunks: st.chunks, heapMB: Math.round(st.heapMB) });
    check('a frame stays cheap on the Ridiculous map', st.drawMs < 16, { drawMs: +st.drawMs.toFixed(2), tickMs: +st.tickMs.toFixed(3) });
    await shot('small-far-away');
    await js('farmTest.key("a")');
    await js('farmTest.key("i")');
    await shot('small-stats');
    await js('farmTest.key("i")');

    // settings menu
    await js('farmTest.key(",")');
    check('the settings menu opens with ,', (await state()).panelOpen);
    const grid = await js<{ n: number; w: number; text: boolean }>(
      `(() => { const p = document.getElementById('panel').getBoundingClientRect(), c = document.querySelector('.pal canvas').getBoundingClientRect();
        return { n: document.querySelectorAll('.pal').length, w: c.width / p.width, text: document.getElementById('panel').innerText.includes('Calm') }; })()`);
    check('the menu shows small palette previews and its controls', grid.n === 7 && grid.w < 0.5 && grid.text, grid);
    const text = await js<string>('farmTest.text()');
    check('the menu shows the colony and the map size', /Ants/.test(text) && /Food stored/.test(text) && /Oldest ant/.test(text) && /Ridiculous/.test(text), text.slice(0, 400));
    check('the feed status shows in the menu', /Watching \d+ Claude Code transcripts/.test(await js<string>('farmTest.feed()')), await js('farmTest.feed()'));
    await shot('small-settings');
    await js('farmTest.clickPalette("graphite")');
    check('picking Graphite applies and saves it', await until(() => c.store.get().palette === 'graphite') && (await state()).palette === 'graphite');

    // sizes
    await js('farmTest.key("2")');
    check('2 makes it large (640 × 360) in its corner', await until(() => docked('br', 640, 360)), c.win.getBounds());
    check('the page follows the window size', await until(async () => (await state()).w === 640));
    await shot('large-graphite-settings');
    await js('farmTest.key("Escape")');
    check('Esc closes the menu', !(await state()).panelOpen);
    await shot('large-graphite');

    // light mode and Desktop Blend's light variant
    c.update({ palette: 'blend' });
    nativeTheme.themeSource = 'light';
    check('Desktop Blend follows light mode', await until(async () => (await state()).chrome === '#c8c5c0'), (await state()).chrome);
    await shot('large-blend-light');
    nativeTheme.themeSource = 'dark';

    // resize from the grip: docked bottom right, the grip is top left and the bottom-right corner stays put
    const b0 = c.win.getBounds();
    c.resize({ phase: 'start', x: b0.x, y: b0.y });
    c.resize({ phase: 'move', x: b0.x - 160, y: b0.y - 90 });
    c.resize({ phase: 'end', x: b0.x - 160, y: b0.y - 90 });
    const s1 = c.store.get();
    check('the grip resizes at 16:9 and remembers the size', s1.size === 'custom' && s1.width === 800 && docked('br', 800, 450), c.win.getBounds());

    // click-through
    await js('farmTest.key("t")');
    check('T turns click-through on', await until(async () => c.store.get().clickThrough && (await state()).thru));
    await js('farmTest.key("t")');
    check('T turns it off again', await until(() => !c.store.get().clickThrough));

    // full screen
    await js('farmTest.key("f")');
    const d = screen.getDisplayMatching(c.win.getBounds()).bounds;
    check('F fills the screen', await until(() => { const b = c.win.getBounds(); return c.isFullscreen() && b.width === d.width && b.height === d.height; }), c.win.getBounds());
    await js('farmTest.key("Escape")');
    check('Esc leaves full screen', await until(() => !c.isFullscreen() && docked('br', 800, 450)), c.win.getBounds());

    // opacity, always on top, dock
    c.update({ opacity: 0.6, alwaysOnTop: false });
    check('opacity and always-on-top apply to the window', Math.abs(c.win.getOpacity() - 0.6) < 0.02 && !c.win.isAlwaysOnTop());
    c.update({ opacity: 1, alwaysOnTop: true, dock: 'tl' });
    check('docking moves it to the chosen corner', docked('tl', 800, 450) && c.win.isAlwaysOnTop(), c.win.getBounds());

    // low CPU while calm
    c.update({ fadeIdle: true });
    await wait(1500);
    const cpu0 = process.cpuUsage();
    const m0 = app.getAppMetrics().reduce((n, m) => n + m.cpu.percentCPUUsage, 0);
    await wait(3000);
    const m1 = app.getAppMetrics().reduce((n, m) => n + m.cpu.percentCPUUsage, 0);
    const main = process.cpuUsage(cpu0);
    check('CPU stays low while the farm is calm', m1 < 40, { appPercent: Math.round(m1), earlier: Math.round(m0), mainMs: Math.round((main.user + main.system) / 1000) });

    // reset keeps the farm's map
    const seed = c.store.get().seed;
    await js('farmTest.key(",")');
    await js('farmTest.click("reset")');
    check('Reset brings back the defaults but keeps the farm', await until(() => { const s = c.store.get(); return s.palette === 'blend' && s.size === 'small' && s.dock === 'br' && s.seed === seed; }));
    check('…and puts the window back', await until(() => docked('br', 320, 180)), c.win.getBounds());

    // leave settings for the reopen run
    c.update({ palette: 'graphite', size: 'large', dock: 'tl', calm: 0.4 });
    await js('farmTest.key("Escape")');
    await shot('large-graphite-calm');
    await js('farmTest.save()');
    check('the colony is saved to its file', await until(() => savedTick() > 0), savedTick());
  } catch (e) {
    check('no errors', false, String((e as Error).stack || e));
  } finally {
    c.store.flush();
    fs.writeFileSync(path.join(c.outDir, `result-${mode}.json`), JSON.stringify({ ok: checks.every((x) => x.ok), checks }, null, 2));
    app.quit();
  }
}
