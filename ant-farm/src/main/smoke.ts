// The automated smoke test, run inside the real app (ANT_FARM_SMOKE=<folder>) with the window never shown: it drives
// the page and the window like a player would, saves screenshots, writes result.json and quits.
// scripts/smoke.mjs starts it twice: a full run, then a 'reopen' run that checks the settings survived the restart.
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

    if (mode === 'reopen') {
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

    // the test buttons feed the farm
    const e0 = st.energy;
    await js('farmTest.click("fTokens")');
    st = await state();
    check('+5k tokens raises energy', st.energy > e0 && st.tokens > 0, { before: e0, after: st.energy });
    await js('farmTest.click("fTask")');
    check('task done queues a gallery', (await state()).counts.tasks === 1);

    // the real feed: a Claude Code transcript line appears; the line already there must not replay
    const file = path.join(c.claudeDir, 'demo-project', 'session-1.jsonl');
    const line = { type: 'assistant', sessionId: 'session-1', timestamp: new Date().toISOString(), isSidechain: false,
      message: { id: 'msg_smoke_2', model: 'claude-test', stop_reason: 'end_turn', content: [{ type: 'text', text: 'not read' }],
        usage: { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 4000, cache_creation_input_tokens: 300 } } };
    fs.appendFileSync(file, JSON.stringify(line) + '\n');
    const fed = await until(async () => (await state()).counts.tasks >= 2, 6000);
    st = await state();
    check('a new transcript line feeds tokens and a finished turn', fed && st.counts.tokens === 2, st.counts);

    // settings menu
    await js('farmTest.key(",")');
    check('the settings menu opens with ,', (await state()).panelOpen);
    const grid = await js<{ n: number; w: number; text: boolean }>(
      `(() => { const p = document.getElementById('panel').getBoundingClientRect(), c = document.querySelector('.pal canvas').getBoundingClientRect();
        return { n: document.querySelectorAll('.pal').length, w: c.width / p.width, text: document.getElementById('panel').innerText.includes('Calm') }; })()`);
    check('the menu shows small palette previews and its controls', grid.n === 7 && grid.w < 0.5 && grid.text, grid);
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
  } catch (e) {
    check('no errors', false, String((e as Error).stack || e));
  } finally {
    c.store.flush();
    fs.writeFileSync(path.join(c.outDir, `result-${mode}.json`), JSON.stringify({ ok: checks.every((x) => x.ok), checks }, null, 2));
    app.quit();
  }
}
