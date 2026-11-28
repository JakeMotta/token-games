// The game's own checks in the shell's hidden smoke test (npm run test:smoke). The shell checks the orb, its card,
// dragging it to a corner, popping out and docking, the tray and the settings file; these run while the game is popped
// out. No window is ever shown. The game is fed only the real way: k.transcript() writes a Claude Code transcript line.
// Building, upgrading and the ghost are driven with real pointer events on the canvas, the way a player's clicks arrive.
import type { GameSmoke, SmokeKit } from '@token-games/shell/main/smoke';
import { CELL, ROAD_PTS } from '../sim/map';
import { Grid } from '../sim/placement';
import type { Settings } from '../shared/settings';

type K = SmokeKit<Settings>;
const state = (k: K) => k.js('gameTest.state()');

// a pointer event on the canvas at page point (x, y)
async function ptr(k: K, type: 'pointermove' | 'pointerdown' | 'pointerup', x: number, y: number): Promise<void> {
  await k.js(`(() => { const [cx, cy] = gameTest.toScreen(${x}, ${y});
    document.getElementById('view').dispatchEvent(new PointerEvent('${type}', { clientX: cx, clientY: cy, button: 0, pointerType: 'mouse', bubbles: true })); })()`);
}
const tap = async (k: K, x: number, y: number) => { await ptr(k, 'pointerdown', x, y); await ptr(k, 'pointerup', x, y); };
const click = (k: K, sel: string) => k.js(`document.querySelector(${JSON.stringify(sel)}).click()`);

// shots of the window in the dark paper, then the light one
async function both(k: K, name: string): Promise<void> {
  await k.shot(name + '-dark');
  k.update({ theme: 'light' } as Partial<Settings>);
  await k.until(async () => !(await state(k)).dark, 3000);
  await k.shot(name + '-light');
  k.update({ theme: 'dark' } as Partial<Settings>);
  await k.until(async () => (await state(k)).dark, 3000);
}

// a free spot for a 2 × 2 tower on an empty page, near the left middle
function freeSpot(): [number, number] {
  const g = new Grid();
  for (let r = 0; r < 20; r++) for (let dx = 0; dx < 20; dx++) for (const [cx, cy] of [[8 + dx, 8 - r], [8 + dx, 8 + r]]) if (g.ok('quill', cx, cy)) return [(cx + 1) * CELL, (cy + 1) * CELL];
  return [200, 200];
}

export const gameSmoke: GameSmoke<Settings> = {
  // its catalog bundle (catalog/, tower-defense-web), seen from inside the sandbox: the status line, the ink-colour
  // chips of its settings, and a wave walking in once a fed transcript line has paid the ink for it
  catalog: { line: /gold · \d+ towers/, settings: '!!document.getElementById("themes").children.length', fed: 'Number(document.getElementById("hWave").textContent) > 0' },
  async full(k) {
    const { check, until, js } = k;
    check('the game is ready', await until(async () => (await state(k)).ready, 10000));
    let st = await state(k);
    check('the game draws in the window', st.scale === 'window' && st.frames > 0, st);
    check('no cheat controls anywhere', !/add tokens|free gold|cheat|skip wave/i.test(await js<string>('shellTest.text() + document.getElementById("game").innerText')));
    check('a new game starts on wave 0 with no towers', st.wave === 0 && st.towers === 0 && st.gold > 0, st);
    check('the first tip shows', await js('!document.getElementById("tip").hidden'));

    // build: the Build button opens the card, a tile starts the ghost
    await click(k, '#bBuild');
    check('the build card opens', (await state(k)).build);
    check('locked towers say when they come', await js('document.querySelector(\'#buildTiles [data-t="crane"]\').disabled && /wave 35/.test(document.querySelector(\'#buildTiles [data-t="crane"]\').innerText)'));
    await click(k, '#buildTiles [data-t="quill"]');
    st = await state(k);
    check('a tile starts placing', !!st.ghost && st.ghost.type === 'quill' && !st.build, st);

    // the ghost over the road: red, with its reason; a click there builds nothing
    const [rx, ry] = ROAD_PTS[Math.floor(ROAD_PTS.length * 0.35)];
    await ptr(k, 'pointermove', rx, ry);
    st = await state(k);
    check('the ghost over the road says no', !!st.ghost?.why, st.ghost);
    await k.shot('ghost-invalid');
    await tap(k, rx, ry);
    check('no tower on the road', (await state(k)).towers === 0);

    // over free paper: clear; a click builds it and costs gold
    const [fx, fy] = freeSpot(), gold0 = st.gold;
    await ptr(k, 'pointermove', fx, fy);
    st = await state(k);
    check('the ghost on free paper is clear', st.ghost && st.ghost.why === '', st.ghost);
    await k.shot('ghost-valid');
    await tap(k, fx, fy);
    st = await state(k);
    check('a click builds the tower', st.towers === 1 && st.gold < gold0 && !st.ghost, st);

    // a second tower on top of the first: refused
    await click(k, '#bBuild'); await click(k, '#buildTiles [data-t="quill"]');
    await ptr(k, 'pointermove', fx, fy);
    st = await state(k);
    check('the ghost never sits on another tower', st.ghost && (st.ghost.why !== '' || Math.abs(st.ghost.cx * CELL + CELL - fx) >= 2 * CELL || Math.abs(st.ghost.cy * CELL + CELL - fy) >= 2 * CELL), st.ghost);
    await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    check('Esc puts the ghost away', !(await state(k)).ghost);
    // a right-click puts the ghost away too, and only with nothing open is it the shell's menu
    await click(k, '#bBuild'); await click(k, '#buildTiles [data-t="quill"]');
    let mc = k.menus();
    await js('shellTest.rightClick("#view")');
    check('a right-click puts the ghost away, without the menu', !(await state(k)).ghost && k.menus() === mc, { menus: k.menus() - mc });
    mc = k.menus();
    await js('shellTest.rightClick("#view")');
    check('with nothing open, a right-click on the paper opens the menu', await until(() => k.menus() === mc + 1, 2000), { menus: k.menus() - mc });

    // usage: tokens fill the bucket and send wave 1; the finished turn pays gold
    k.transcript({ input_tokens: 1000, output_tokens: 600, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 'msg_td_smoke_1');
    check('a real transcript line sends a wave', await until(async () => (st = await state(k)).wave >= 1, 8000), st);
    check('a finished turn pays gold', st.stats.turns >= 1, st.stats);
    check('the orb counts the wave', await until(async () => (await js('shellTest.state()')).count === '1'), await js('shellTest.state()'));
    check('walkers come down the road', await until(async () => (await state(k)).alive > 0, 6000));
    await k.shot('window-small-wave');

    // the tower card: select, upgrade
    await tap(k, fx, fy);
    st = await state(k);
    check('a click on a tower opens its card', st.sel > 0 && await js('!document.getElementById("towerCard").hidden'), st);
    const lv = st.levels[0];
    await click(k, '#tUp1');
    check('upgrade +1 levels the tower (when the gold is there)', (await state(k)).levels[0] === lv + 1 || await js('document.getElementById("tUp1").disabled'), await state(k));
    await k.shot('tower-card');
    await click(k, '#tClose');

    // settings
    k.update({ numbers: false } as Partial<Settings>);
    check('a setting reaches the page', await until(async () => (await state(k)).numbers === false));
    k.update({ numbers: true } as Partial<Settings>);
    k.update({ size: 'large' } as Partial<Settings>);
    await until(async () => (await state(k)).view.w > 500, 3000);
    await both(k, 'window-large');
    k.update({ size: 'small' } as Partial<Settings>);
  },
  async reset(k) {
    const s = k.store.get();
    k.check('Reset brings back the game\'s defaults', s.theme === 'dark' && s.numbers === true, s);
  },
  async leave(k) {
    await k.js('gameTest.save()');
  },
  async reopen(k) {
    k.check('the towers come back after a restart', await k.until(async () => (await state(k)).towers >= 1, 8000), await state(k));
    k.check('the wave comes back after a restart', (await state(k)).wave >= 0, await state(k));
  },

  // smoke.mjs --perf [--profile <folder>]: the benchmark (50 towers, ~100 walkers), the real frame cost in every mode,
  // and screenshots of whatever game the profile holds (npm run autoplay makes a late one)
  async perf(k) {
    const { check, until, js, wait, note, cpu } = k;
    check('the game is ready', await until(async () => (await state(k)).ready, 15000));
    const go = async (to: string, ev: 'toggle' | 'pop' | 'dock' | 'escape') => { if (k.state() !== to) { k.dispatch(ev); await until(() => k.state() === to, 3000); } };
    const measure = async (name: string, ms: number) => {
      await wait(800);
      await js('gameTest.perfReset()');
      const use = await cpu(ms);
      const p = await js('gameTest.perf()');
      note(name, { ...p, cpu: use });
      check(`measured: ${name}`, p.frames > 0, p);
    };
    note('game', await state(k));
    await go('orb', 'dock');
    await measure('orb', 6000);
    await k.shot('orb');
    await go('expanded', 'toggle');
    await measure('card', 6000);
    await k.shot('card');
    k.dispatch('escape');
    await go('popped', 'pop');
    k.update({ size: 'large' } as Partial<Settings>);
    await until(async () => (await state(k)).view.w > 500, 3000);
    await measure('window, large', 8000);
    k.update({ reducedMotion: true } as Partial<Settings>);
    await measure('window, large, reduced motion', 6000);
    k.update({ reducedMotion: false } as Partial<Settings>);
    const b = await js('gameTest.bench(240)');
    note('bench: 50 towers, ~100 walkers', b);
    check('the benchmark ran with 50 towers and about 100 walkers', b.towers === 50 && b.enemies >= 80, b);
    await both(k, 'late-window-large');
    // the highest tower's card, and the build card
    const best = await js('(() => { const s = gameTest.state(); return s.levels.indexOf(Math.max(...s.levels)); })()');
    if (best >= 0) {
      const [x, y] = await js(`gameTest.towerXY(${best})`);
      await tap(k, x, y);
      check('the late tower card opens', (await state(k)).sel > 0);
      await k.shot('late-tower-card');
      await click(k, '#tClose');
    }
    await js('document.getElementById("bBuild").click()');
    await k.shot('late-build-card');
    await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
    k.update({ size: 'small' } as Partial<Settings>);
    await until(async () => (await state(k)).view.w < 400, 3000);
    await both(k, 'late-window-small');
  },
};
