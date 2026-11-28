// The catalog's smoke run (TG_SMOKE_MODE=catalog), inside the real app with no window shown: open the Games window,
// fetch the signed test registry built from samples/, ask for an install over the control socket like an agent would,
// approve it in the Games window, update it, switch to the game and prove it runs sandboxed (no Node, no file or
// network access, only window.tokenGame), that it gets the usage feed and its own save, that the built-in game's save
// is left alone, and that removing it (approved in Settings → Games) brings the built-in game back. The test registry
// is signed with a throwaway key, so its games stay hidden (and an agent cannot ask for them) until the developer
// switch in Settings → Games is on. Screenshots of the Games window: the catalog not fetched yet, only approved games,
// with the developer switch on, the permission sheet, an update available.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Catalog, BuiltIn } from '../catalog/catalog';
import { callControl } from '../catalog/control';
import { DEFAULT_REGISTRY } from '../catalog/keys';
import type { ShellSettings } from '../settings';
import type { GameHost } from './catalog-host';
import type { SmokeKit } from './smoke';

export interface CatalogSmoke {
  catalog(): Catalog;
  host(): GameHost | null;
  socket(): string;
  builtIn(): BuiltIn;
  saveFile(): string; // the built-in game's save
  bundleDir(): string; // the app's own catalog bundle (catalog/, built by build-web.mjs), for the catalog-game run
  publish(version: string): void; // list the game in the run's test registry again at a newer version
}

// How to see a shell game playing once it is packed as a catalog game (GameSmoke.catalog). Each runs in the game's
// own sandboxed view; the shell knows nothing about any one game.
export interface CatalogGameChecks {
  line: RegExp; // the status line it sends the orb and the card once it draws
  settings: string; // JS: true once its own Settings section (the gear) has drawn
  fed: string; // JS: true once the tokens of a fed transcript line show
}

const GAME = 'token-garden';
const API_KEYS = ['dock', 'env', 'getSettings', 'load', 'onEnv', 'onHide', 'onUsage', 'popOut', 'save', 'setSettings', 'setStatus', 'version'];

export async function catalogSmoke<S extends ShellSettings>(k: SmokeKit<S>, c: CatalogSmoke): Promise<void> {
  const { check, until, wait } = k;
  const sj = <T = any>(code: string): Promise<T | null> => k.js<T>(code).catch(() => null); // the page may be reloading
  const card = () => sj<{ view: any; text: string; hosted: string | null; icon: boolean }>('shellTest.games()'); // Settings → Games, in the card
  const { games, click, openGames } = gamesWindow(k);
  const page = () => sj<any>('shellTest.state()');
  const settled = (st: string) => until(() => k.state() === st, 3000);
  const inGame = <T = any>(code: string): Promise<T> => c.host()!.view.webContents.executeJavaScript(code);
  const row = async (id: string) => ((await games())?.view?.rows || []).find((r: any) => r.id === id);
  const gameDir = path.join(c.catalog().gamesDir, GAME);

  check('catalog: the built-in game is active and nothing else is listed before a fetch', c.catalog().active() === c.builtIn().id
    && await until(async () => JSON.stringify(((await card())?.view?.rows || []).map((r: any) => r.id)) === JSON.stringify([c.builtIn().id])), (await card())?.view);

  // popped out, the title bar's Games button opens the Games window; the game stays in its window
  k.update({ size: 'large', dock: 'br', corner: 'br' } as Partial<S>);
  if (k.state() !== 'popped') { k.dispatch('pop'); await settled('popped'); }
  check('catalog: the title bar\'s Games opens the Games window', await openGames());
  check('catalog: before a fetch it shows the built-in game and Check for games', /Check for games/.test((await games())?.text || '') && /only fetched when you ask/.test((await games())?.text || ''));
  await k.gamesShot('games-window-empty');

  await click('refresh');
  check('catalog: "Check for games" fetches the signed test index and hides its games: only the built-in game is listed', await until(async () => {
    const v = (await games())?.view;
    return !!v?.catalog.signed && v.hiddenCount > 0 && JSON.stringify(v.rows.map((r: any) => r.id)) === JSON.stringify([c.builtIn().id]) && !v.developer;
  }), (await games())?.view);
  check('catalog: the Games window offers no local folder and no test games while the switch is off, and says how many it hides', !/Add local folder/.test((await games())?.text || '')
    && !/Token Garden/.test((await games())?.text || '') && /1 not approved, hidden/.test((await games())?.text || ''), (await games())?.text);
  await k.gamesShot('games-approved');
  check('catalog: the control socket is up', await until(() => !!c.socket()), c.socket());
  const refused = await callControl(c.socket(), 'install', { id: GAME }).then(() => '', (e: Error) => e.message);
  check('catalog: an agent cannot ask for an unapproved game while the switch is off', /not an approved game/.test(refused) && /Show developer and unapproved games/.test(refused), refused);

  await developerSwitch(k, c, 'catalog', true);
  check('catalog: with the switch on the test catalog\'s game is listed, marked not approved', await until(async () => {
    const v = (await games())?.view;
    return !!v?.developer && !!v.rows.find((r: any) => r.id === GAME && !r.installed && r.unapproved);
  }) && /Not approved/.test((await games())?.text || '') && /Showing developer and unapproved games/.test((await games())?.text || ''), (await games())?.view?.rows);
  await k.gamesShot('games-developer');

  // an agent asks over the control socket; it can only ask
  const asked = (await callControl(c.socket(), 'install', { id: GAME })) as { requested: { from: string; requestId: string } };
  check('catalog: an agent\'s install is only a request', asked.requested.from === 'agent' && !fs.existsSync(gameDir), asked);
  check('catalog: the request appears in the Games window as a permission sheet marked "Requested by an agent"', await until(async () => /Requested by an agent/.test((await games())?.text || '')), (await games())?.text);
  check('catalog: …and in the card\'s Settings → Games', await until(async () => /Requested by an agent/.test((await card())?.text || '')), (await card())?.text);
  await k.gamesShot('games-window-approval');

  await click('approve:' + asked.requested.requestId);
  check('catalog: approving in the Games window installs it', await until(async () => !!(await row(GAME))?.installed) && fs.existsSync(path.join(gameDir, 'index.html')));
  check('catalog: installing does not switch games', c.catalog().active() === c.builtIn().id && !c.host());
  await k.gamesShot('games-window-installed');

  // an update: the registry lists a newer version; the Games window says so, and updating waits for Approve
  const was = (await row(GAME))?.version as string, next = was.replace(/\d+$/, (n) => String(Number(n) + 1));
  check('catalog: no update is shown while the catalog has the same version', !(await row(GAME))?.update && !(await page())?.update);
  c.publish(next);
  await click('refresh');
  check('catalog: a newer version in the catalog shows "Update available" and an Update button', await until(async () => (await row(GAME))?.update === next)
    && await until(async () => /Update available/i.test((await games())?.text || '') && ((await games())?.text || '').includes('Update to ' + next)), (await games())?.text);
  check('catalog: the Games buttons get a dot', await until(async () => !!(await page())?.update), await page());
  check('catalog: the tray says an update is waiting', await until(() => k.trayItems().some((i) => i.label === 'Games… (1 update)')), k.trayItems().map((i) => i.label));
  await k.gamesShot('games-window-update');
  await k.shot('catalog-update-dot');
  await click('update:' + GAME);
  const upd = await until(async () => ((await games())?.view?.pending || []).some((r: any) => r.action === 'update' && r.version === next));
  check('catalog: Update asks first, nothing changes yet', upd && (await row(GAME))?.version === was);
  await k.gamesShot('games-window-update-approval');
  const uid = ((await games())?.view?.pending || []).find((r: any) => r.action === 'update')?.requestId;
  await click('approve:' + uid);
  check('catalog: approving the update installs the new version', await until(async () => (await row(GAME))?.version === next && !(await row(GAME))?.update)
    && JSON.parse(fs.readFileSync(path.join(gameDir, 'game.json'), 'utf8')).version === next);
  check('catalog: the dot and the tray\'s count go once it is up to date', await until(async () => !(await page())?.update) && k.trayItems().some((i) => i.label === 'Games…'));

  // switch: the page starts again around the catalog game; the Games window stays open and says so
  await click('use:' + GAME);
  check('catalog: Play switches to the catalog game', await until(async () => (await card())?.hosted === GAME, 8000) && c.catalog().active() === GAME);
  check('catalog: the game is shown in the window, below the title bar', await until(() => !!c.host()?.shown(), 5000), c.host()?.shown());
  check('catalog: the Games window marks it Playing', await until(async () => !!(await row(GAME))?.active) && /Playing/.test((await games())?.text || ''));
  await k.gjs('gamesTest.key("Escape")');
  check('catalog: Esc closes the Games window', await until(() => !k.gamesWin()));
  check('catalog: the game page loads', await until(() => inGame<boolean>('!!document.getElementById("tokens") && document.readyState === "complete"').catch(() => false), 5000));
  const colony = fs.existsSync(c.saveFile()) ? fs.readFileSync(c.saveFile(), 'utf8') : null;

  // the sandbox
  const env = await inGame<Record<string, string>>(`({ require: typeof require, process: typeof process, module: typeof module, buffer: typeof Buffer,
    shell: typeof window.tokenShell, electron: typeof window.electron, api: Object.keys(window.tokenGame).sort().join(','), opened: String(window.open('https://example.com')) })`);
  check('catalog: the game has no Node, no Electron and no shell API', env.require === 'undefined' && env.process === 'undefined' && env.module === 'undefined'
    && env.buffer === 'undefined' && env.shell === 'undefined' && env.electron === 'undefined', env);
  check('catalog: window.tokenGame is exactly the documented bridge', env.api === API_KEYS.join(','), env.api);
  check('catalog: it cannot open windows', env.opened === 'null', env.opened);
  const reach = async (url: string) => inGame<string>(`fetch(${JSON.stringify(url)}).then(() => 'reached', () => 'blocked')`);
  const net = { web: await reach('https://example.com/'), file: await reach('file:///etc/hosts'), other: await reach('tg-game://ant-farm/game.json'), own: await reach('game.json') };
  check('catalog: no network, no files, no other game: only its own folder', net.web === 'blocked' && net.file === 'blocked' && net.other === 'blocked' && net.own === 'reached', net);

  // the feed: real transcript lines only
  const before = Number(String(await inGame('document.getElementById("tokens").textContent')).replace(/,/g, ''));
  k.transcript({ input_tokens: 1500, output_tokens: 700 }, 'msg_catalog_1');
  check('catalog: the game reads the token feed', await until(async () => Number(String(await inGame('document.getElementById("tokens").textContent')).replace(/,/g, '')) === before + 2200, 8000));
  for (let i = 2; i <= 4; i++) k.transcript({ input_tokens: 1, output_tokens: 1 }, 'msg_catalog_' + i);
  check('catalog: its status reaches the orb and the card', await until(async () => /flowers/.test((await page())?.line || '') && (await page())?.count === '1', 8000), await page());
  check('catalog: it saves into its own folder', await until(() => fs.existsSync(path.join(c.catalog().saveDir(GAME), 'save.json')), 8000));

  // the orb and the card
  k.dispatch('dock');
  check('catalog: in the orb the game is hidden and the orb shows its icon and count', await settled('orb') && await until(async () => !c.host()?.shown() && !!(await card())?.icon), { shown: c.host()?.shown() });
  await k.shot('catalog-orb');
  await sj('shellTest.clickOrb()');
  check('catalog: in the open card the game is shown again', await settled('expanded') && await until(() => !!c.host()?.shown()), c.host()?.shown());
  await sj('shellTest.key(",")');
  check('catalog: Settings opens in its own window, the game still shown in the card', await k.settingsReady() && await until(() => !!c.host()?.shown()));
  check('catalog: the built-in game\'s save is left alone while another game plays', (fs.existsSync(c.saveFile()) ? fs.readFileSync(c.saveFile(), 'utf8') : null) === colony);

  // an agent asks to remove it; the player approves right there in the card's Settings → Games: back to the built-in
  // game, the save kept
  const rm = (await callControl(c.socket(), 'remove', { id: GAME })) as { requested: { requestId: string } };
  check('catalog: Remove asks first, in the Settings window\'s Settings → Games too', await until(async () => ((await card())?.view?.pending || []).some((r: any) => r.action === 'remove'))
    && await until(async () => /Remove/.test(await k.sjs<string>('settingsTest.text()'))) && fs.existsSync(gameDir), rm);
  await k.settingsShot('catalog-settings-approval');
  await k.sjs(`settingsTest.click(${JSON.stringify(`[data-games="approve:${rm.requested.requestId}"]`)})`);
  check('catalog: removing it brings the built-in game back', await until(async () => !!(await sj('!!window.gameTest')) && (await card())?.hosted === null, 8000)
    && c.catalog().active() === c.builtIn().id && !c.host());
  check('catalog: the Settings window stays open and shows the built-in game\'s settings again', !!k.settingsWin() && await until(async () => !!(await page())?.panelOpen
    && /Reduced motion/.test(await k.sjs<string>('settingsTest.text()')), 5000));
  await k.sjs('settingsTest.key("Escape")');
  await until(() => !k.settingsWin());
  check('catalog: its files are gone and its save is kept', !fs.existsSync(gameDir) && fs.existsSync(path.join(c.catalog().saveDir(GAME), 'save.json')));
  await wait(300);
  if (k.state() !== 'orb') { k.dispatch('escape'); await settled('orb'); }
}

// The catalog-game run (TG_SMOKE_MODE=catalog-game): the app's own game packed as a catalog game (catalog/, built by
// build-web.mjs) and installed like any other. The registry is one made for this run from catalog/, or the real one
// when TG_REGISTRY_URL is set (installing from the public index proves its signature and checksum). It proves the
// bundle runs sandboxed through the hosted adapter, reads the feed, saves in its own slot when the shell closes it,
// loads that save again, and never touches the built-in game's save.
export async function catalogGameSmoke<S extends ShellSettings>(k: SmokeKit<S>, c: CatalogSmoke, game?: CatalogGameChecks): Promise<void> {
  const { check, until, wait } = k;
  const sj = <T = any>(code: string): Promise<T | null> => k.js<T>(code).catch(() => null);
  const card = () => sj<{ view: any; text: string; hosted: string | null; icon: boolean }>('shellTest.games()');
  const { games, click, openGames } = gamesWindow(k);
  const page = () => sj<any>('shellTest.state()');
  const settled = (st: string) => until(() => k.state() === st, 3000);
  const inGame = <T = any>(code: string): Promise<T> => c.host()!.view.webContents.executeJavaScript(code);
  const { id: GAME, name: NAME } = JSON.parse(fs.readFileSync(path.join(c.bundleDir(), 'game.json'), 'utf8')) as { id: string; name: string };
  check('catalog-game: the game says how to see it play in the catalog (GameSmoke.catalog)', !!game);
  const row = async (id: string) => ((await games())?.view?.rows || []).find((r: any) => r.id === id);
  const gameDir = path.join(c.catalog().gamesDir, GAME), saveFile = path.join(c.catalog().saveDir(GAME), 'save.json');
  const readSave = () => { try { return JSON.parse(fs.readFileSync(saveFile, 'utf8')); } catch { return null; } };
  const builtInSave = () => (fs.existsSync(c.saveFile()) ? fs.readFileSync(c.saveFile(), 'utf8') : null);
  const viewShot = (name: string) => gameViewShot(k, c, name);
  const { cli, hasCli } = tokengames(c);
  const play = (id: string) => playGame(k, c, id);

  k.update({ size: 'large', dock: 'br', corner: 'br' } as Partial<S>);
  if (k.state() !== 'popped') { k.dispatch('pop'); await settled('popped'); }
  check('catalog-game: the title bar\'s Games opens the Games window', await openGames());
  // the packaged game is a copy of the built-in one: hidden in the app until the developer switch is on (the catalog
  // run, in the same profile, left it on)
  await developerSwitch(k, c, 'catalog-game', false);
  await click('refresh');
  check(`catalog-game: "Check for games" hides ${GAME}, a copy of the built-in game`, await until(async () => {
    const v = (await games())?.view;
    return !!v?.catalog.signed && v.hiddenCount > 0 && !v.rows.find((r: any) => r.id === GAME);
  }, 15000), (await games())?.view);
  if (hasCli) {
    const l = await cli('list');
    check(`catalog-game: \`tokengames list\` still lists ${GAME}, marked hidden in the app as a copy of the built-in game`, l.code === 0
      && new RegExp(`^${GAME}\\s.*available\\s+hidden in the app: a copy of the built-in`, 'm').test(l.out), l.out);
  }
  await developerSwitch(k, c, 'catalog-game', true);
  if (hasCli) {
    const l = await cli('list', '--refresh');
    check(`catalog-game: \`tokengames list --refresh\` lists ${GAME} as available`, l.code === 0 && new RegExp(`^${GAME}\\s.*available\\s+not approved:`, 'm').test(l.out), l.out);
  } else await click('refresh');
  check(`catalog-game: "Check for games" lists ${GAME} from the signed index`, await until(async () => {
    const v = (await games())?.view;
    return !!v?.catalog.signed && !!v.rows.find((r: any) => r.id === GAME && !r.installed);
  }, 15000), (await games())?.view?.catalog);

  // an agent asks; the player approves in the app
  check('catalog-game: the control socket is up', await until(() => !!c.socket()), c.socket());
  const asked = hasCli
    ? await cli('install', GAME, '--json').then((r) => ({ requested: JSON.parse(r.out) as { from: string; requestId: string } }))
    : (await callControl(c.socket(), 'install', { id: GAME })) as { requested: { from: string; requestId: string } };
  check(`catalog-game: an agent's install${hasCli ? ' (`tokengames install`)' : ''} is only a request`, asked.requested.from === 'agent' && !fs.existsSync(gameDir), asked);
  check('catalog-game: the permission sheet names the game and the usage permission', await until(async () => {
    const t = (await games())?.text || '';
    return /Requested by an agent/.test(t) && t.includes('Install ' + NAME) && /tokens your Claude Code sessions use/.test(t);
  }), (await games())?.text);
  await k.gamesShot('catalog-game-sheet');
  await click('approve:' + asked.requested.requestId);
  check('catalog-game: approving downloads it, checks its sha256 and installs it', await until(async () => !!(await row(GAME))?.installed, 20000)
    && fs.existsSync(path.join(gameDir, 'index.html')) && fs.existsSync(path.join(gameDir, 'app.js')));
  await k.gamesShot('catalog-game-picker');

  if (hasCli) {
    const st = await cli('status', '--json');
    const j = (() => { try { return JSON.parse(st.out); } catch { return null; } })();
    check('catalog-game: `tokengames status` shows it installed and nothing waiting', st.code === 0 && j?.games?.some((g: any) => g.id === GAME && g.installed) && j.pending.length === 0, st.out.slice(0, 400));
  }

  const builtInWas = builtInSave();
  if (hasCli) {
    const u = await cli('use', GAME);
    check('catalog-game: `tokengames use` switches to the packaged game', u.code === 0 && await until(async () => (await card())?.hosted === GAME && c.catalog().active() === GAME, 8000), u.out);
  } else check('catalog-game: Play switches to the packaged game', await play(GAME));
  check('catalog-game: the game is shown in the window', await until(() => !!c.host()?.shown(), 5000));
  check('catalog-game: the game page loads, with its tools corner', await until(() => inGame<boolean>('document.readyState === "complete" && !!document.getElementById("view") && !!document.getElementById("tgh-gear")').catch(() => false), 8000));
  const env = await inGame<Record<string, string>>(`({ require: typeof require, process: typeof process, shell: typeof window.tokenShell,
    test: typeof window.gameTest, api: Object.keys(window.tokenGame).sort().join(','), version: String(window.tokenGame.version), hidden: String(document.hidden) })`);
  check('catalog-game: sandboxed: no Node, no shell API, no test hooks, only window.tokenGame v2', env.require === 'undefined' && env.process === 'undefined'
    && env.shell === 'undefined' && env.test === 'undefined' && env.api === API_KEYS.join(',') && env.version === '2', env);
  const net = await inGame<string>(`fetch('https://example.com/').then(() => 'reached', () => 'blocked')`);
  check('catalog-game: no network', net === 'blocked', net);
  check('catalog-game: the game draws and its status reaches the orb and the card', await until(async () => !!game?.line.test((await page())?.line || ''), 10000), { line: (await page())?.line, hidden: env.hidden });
  const painted = await inGame<number>(`(() => { const v = document.getElementById('view'); const d = v.getContext('2d').getImageData(0, 0, v.width, v.height).data; const s = new Set(); for (let i = 0; i < d.length; i += 4 * 97) s.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return s.size; })()`).catch(() => 0);
  check('catalog-game: the canvas shows the game', painted > 3, painted);
  await k.gjs('gamesTest.key("Escape")');
  await until(() => !k.gamesWin());
  await k.shot('catalog-game-window');
  await viewShot('catalog-game-playing');

  // its own Settings sheet, inside the sandbox
  await inGame('document.getElementById("tgh-gear").click()');
  check('catalog-game: the gear opens the game\'s own settings in the view', await until(() => inGame<boolean>(`!document.getElementById("tgh-panel").hidden && (${game?.settings || 'false'})`), 3000));
  await wait(1200); // previews in its settings draw on the next frames
  await viewShot('catalog-game-settings');
  await inGame('document.getElementById("tgh-close").click()');

  // the feed: a real transcript line, then the shell closes the game and it saves
  k.transcript({ input_tokens: 40000, output_tokens: 9000 }, 'msg_catalog_game_1');
  check('catalog-game: the game shows the tokens arriving', await until(() => inGame<boolean>(game?.fed || 'false').catch(() => false), 8000));
  await wait(500);
  check('catalog-game: Play on the built-in game switches back', await play(c.builtIn().id) && !c.host());
  const saved = readSave();
  check('catalog-game: closing it saves the game with the fed tokens in its own slot', saved?.v === 1 && saved?.stats?.tokens >= 49000, saved && { tokens: saved.stats?.tokens, tick: saved.tick });
  check('catalog-game: the built-in game\'s save is left alone', builtInSave() === builtInWas);

  // again: the same game comes back
  check('catalog-game: Play again', await play(GAME) && await until(() => !!c.host()?.shown(), 5000));
  await wait(1500);
  check('catalog-game: Play on the built-in game switches back again', await play(c.builtIn().id));
  const again = readSave();
  check('catalog-game: it loads its save: the same game, not a new one', !!saved && again?.seed === saved.seed && again?.stats?.tokens >= saved.stats.tokens,
    again && { seed: again.seed, was: saved?.seed, tokens: again.stats?.tokens });

  // remove, approved in the Games window; the save stays
  await openGames();
  if (hasCli) {
    const r = await cli('remove', GAME);
    check('catalog-game: `tokengames remove` only asks', r.code === 0 && fs.existsSync(gameDir), r.out);
  } else await click('remove:' + GAME);
  const asks = await until(async () => ((await games())?.view?.pending || []).some((r: any) => r.action === 'remove'));
  const rid = asks ? ((await games())?.view?.pending || []).find((r: any) => r.action === 'remove')?.requestId : null;
  check('catalog-game: Remove asks first', !!rid && fs.existsSync(gameDir));
  await click('approve:' + rid);
  check('catalog-game: removing it deletes its files and keeps its save', await until(() => !fs.existsSync(gameDir), 8000) && fs.existsSync(saveFile));
  check('catalog-game: the built-in game\'s save is still left alone', builtInSave() === builtInWas);
  await wait(300);
  if (k.state() !== 'orb') { k.dispatch('escape'); await settled('orb'); }
}

// The published run (TG_SMOKE_MODE=published; smoke.mjs --only published [--expect <id,…>]): the real, public catalog
// (DEFAULT_REGISTRY, or TG_REGISTRY_URL), trusting only the keys built into the app, from this run's clean profile.
// What a player sees after "Check for games": the approved games, and with the developer switch on still nothing else
// (TG_SMOKE_EXPECT, when set, is every id the index must hold). Then for each game: `tokengames list` finds it and
// `tokengames install` only asks (denied here); the Games window's Install shows the permission sheet; Approve
// downloads, checks and installs it; Play runs it sandboxed; a transcript line feeds it; it saves in its own slot and
// the built-in game's save is left alone. It needs the network, so the normal smoke test never runs it.
export async function publishedSmoke<S extends ShellSettings>(k: SmokeKit<S>, c: CatalogSmoke): Promise<void> {
  const { check, until, wait } = k;
  const sj = <T = any>(code: string): Promise<T | null> => k.js<T>(code).catch(() => null);
  const { games, click, openGames } = gamesWindow(k);
  const page = () => sj<any>('shellTest.state()');
  const settled = (st: string) => until(() => k.state() === st, 3000);
  const inGame = <T = any>(code: string): Promise<T> => c.host()!.view.webContents.executeJavaScript(code);
  const { cli, hasCli } = tokengames(c);
  const expect = (process.env.TG_SMOKE_EXPECT || '').split(',').map((s) => s.trim()).filter(Boolean).sort();
  const builtIn = c.builtIn().id;
  const view = async () => (await games())?.view;
  const others = (v: any): string[] => (v?.rows || []).map((r: any) => r.id).filter((id: string) => id !== builtIn).sort();
  const same = (a: string[], b: string[]) => a.join(',') === b.join(',');
  const builtInSave = () => (fs.existsSync(c.saveFile()) ? fs.readFileSync(c.saveFile(), 'utf8') : null);
  const refresh = async () => {
    const was = (await view())?.catalog.fetchedAt ?? null;
    await click('refresh');
    return until(async () => { const v = await view(); return !!v?.catalog.fetchedAt && v.catalog.fetchedAt !== was; }, 30000);
  };

  k.update({ size: 'large', dock: 'br', corner: 'br' } as Partial<S>);
  if (k.state() !== 'popped') { k.dispatch('pop'); await settled('popped'); }
  check('published: the title bar\'s Games opens the Games window', await openGames());
  await developerSwitch(k, c, 'published', false);
  await openGames();
  const url = process.env.TG_REGISTRY_URL || DEFAULT_REGISTRY;
  check('published: "Check for games" fetches the public index, signed by a key built into the app', await refresh()
    && !!(await view())?.catalog.signed && c.catalog().status().catalog.url === url, { ...(await view())?.catalog, url: c.catalog().status().catalog.url });
  const approved = others(await view());
  k.note('url', url);
  k.note('approved', approved);
  check('published: the Games window lists approved games and hides none', approved.length > 0 && (await view())?.hiddenCount === 0, await view());
  if (expect.length) check(`published: it lists exactly ${expect.join(', ')}`, same(approved, expect), approved);
  await k.gamesShot('published-games');

  await developerSwitch(k, c, 'published', true);
  await openGames();
  await refresh();
  const all = others(await view());
  k.note('developer', all);
  check('published: with the developer switch on the index holds nothing else', same(all, approved) && (await view())?.catalog.games === approved.length,
    { all, games: (await view())?.catalog.games });
  await k.gamesShot('published-games-developer');
  await developerSwitch(k, c, 'published', false);
  await openGames();

  if (hasCli) {
    const l = await cli('list', '--refresh', '--json');
    const rows = (() => { try { return JSON.parse(l.out) as any[]; } catch { return null; } })();
    const listed = (rows || []).map((r) => r.id).filter((id) => id !== builtIn).sort();
    check('published: `tokengames list --refresh` finds the same games, none of them marked', l.code === 0 && same(listed, approved)
      && (rows || []).every((r) => !r.unapproved && !r.hidden), l.out.slice(0, 600));
  }

  for (const id of approved) {
    const row = async () => ((await view())?.rows || []).find((r: any) => r.id === id);
    const name: string = (await row())?.name || id;
    const gameDir = path.join(c.catalog().gamesDir, id), saveFile = path.join(c.catalog().saveDir(id), 'save.json');
    const pending = async (from: string) => ((await view())?.pending || []).find((r: any) => r.id === id && r.action === 'install' && r.from === from);
    if (hasCli) {
      const asked = await cli('install', id, '--json');
      const req = (() => { try { return JSON.parse(asked.out); } catch { return null; } })();
      check(`published: \`tokengames install ${id}\` finds it and only asks`, asked.code === 0 && req?.from === 'agent' && !fs.existsSync(gameDir), asked.out.slice(0, 400));
      check('published: the agent\'s request waits in the Games window', await until(async () => !!(await pending('agent'))));
      await click('deny:' + (await pending('agent'))?.requestId);
      check('published: Deny drops it and installs nothing', await until(async () => !(await pending('agent'))) && !fs.existsSync(gameDir));
    }
    await click('install:' + id);
    check(`published: Install on ${name} shows the permission sheet`, await until(async () => !!(await pending('player'))));
    const req = await pending('player');
    const text = (await games())?.text || '';
    k.note(`sheet ${id}`, req?.sheet);
    check(`published: the sheet names ${name}, verified, the token counts only and no network`, text.includes('Install ' + name) && req?.tier === 'verified'
      && /tokens your Claude Code sessions use/.test(text) && (req?.network || []).length === 0, { req, text: text.slice(0, 800) });
    await k.gamesShot('published-sheet');
    await click('approve:' + req?.requestId);
    check(`published: Approve downloads ${id}, checks its sha256 against the signed index and installs it`, await until(async () => !!(await row())?.installed, 60000)
      && fs.existsSync(path.join(gameDir, 'index.html')) && fs.existsSync(path.join(gameDir, 'game.json')), (await view())?.pending);
    await k.gamesShot('published-installed');

    const builtInWas = builtInSave();
    check(`published: Play switches to ${name}`, await playGame(k, c, id) && await until(() => !!c.host()?.shown(), 5000));
    check(`published: ${id} loads`, await until(() => inGame<boolean>('document.readyState === "complete"').catch(() => false), 8000));
    const env = await inGame<Record<string, string>>(`({ require: typeof require, process: typeof process, shell: typeof window.tokenShell,
      test: typeof window.gameTest, api: Object.keys(window.tokenGame).sort().join(','), version: String(window.tokenGame.version) })`);
    check(`published: ${id} is sandboxed: no Node, no shell API, no test hooks, only window.tokenGame v2`, env.require === 'undefined' && env.process === 'undefined'
      && env.shell === 'undefined' && env.test === 'undefined' && env.api === API_KEYS.join(',') && env.version === '2', env);
    check(`published: ${id} has no network`, (await inGame<string>(`fetch('https://example.com/').then(() => 'reached', () => 'blocked')`)) === 'blocked');
    check(`published: ${id} sends its status to the orb and the card`, await until(async () => (await sj<any>('shellTest.games()'))?.hosted === id && !!(await page())?.line, 10000), await page());
    const painted = await inGame<number>(`(() => { const v = document.querySelector('canvas'); if (!v) return 0; const d = v.getContext('2d').getImageData(0, 0, v.width, v.height).data; const s = new Set(); for (let i = 0; i < d.length; i += 4 * 97) s.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return s.size; })()`).catch(() => 0);
    check(`published: ${id} draws`, painted > 3, painted);
    const before = (await page())?.line;
    await k.gjs('gamesTest.key("Escape")').catch(() => null);
    await until(() => !k.gamesWin());
    await k.shot('published-window');
    await gameViewShot(k, c, 'published-playing');
    k.transcript({ input_tokens: 40000, output_tokens: 9000 }, `msg_published_${id}`);
    check(`published: a transcript line moves ${id} on`, await until(async () => (await page())?.line !== before, 10000), { before, after: (await page())?.line });
    k.note(`line ${id}`, { before, after: (await page())?.line });
    await wait(3000);
    await gameViewShot(k, c, 'published-fed');
    check('published: Play on the built-in game switches back', await playGame(k, c, builtIn) && !c.host());
    const saved = (() => { try { return JSON.parse(fs.readFileSync(saveFile, 'utf8')); } catch { return null; } })();
    check(`published: ${id} saves in its own slot`, !!saved && (typeof saved?.stats?.tokens !== 'number' || saved.stats.tokens >= 49000),
      saved && { file: path.relative(path.dirname(c.catalog().gamesDir), saveFile), tokens: saved?.stats?.tokens });
    check('published: the built-in game\'s save is left alone', builtInSave() === builtInWas);
  }
  if (k.state() !== 'orb') { k.dispatch('escape'); await settled('orb'); }
}

// Settings → Games' developer switch, turned on or off in the Settings window the way the player would.
async function developerSwitch<S extends ShellSettings>(k: SmokeKit<S>, c: CatalogSmoke, run: string, on: boolean): Promise<void> {
  await k.js('shellTest.key(",")').catch(() => null);
  const was = (await k.settingsReady()) ? await k.sjs<boolean>('settingsTest.value("#tg-developer")') : null;
  if (was === !on) await k.sjs('settingsTest.click("#tg-developer")');
  k.check(`${run}: Settings → Games' "Show developer and unapproved games" ${was === !on ? 'turns ' : 'is '}${on ? 'on' : 'off'}`, was !== null
    && await k.until(() => c.catalog().developer === on, 3000) && await k.until(async () => (await k.sjs('settingsTest.value("#tg-developer")')) === on, 3000), was);
  await k.sjs('settingsTest.key("Escape")').catch(() => null);
  await k.until(() => !k.settingsWin());
}

// The Games window, for the catalog runs: open it with the title bar's Games button, read it, click its buttons by
// their data-games name ("refresh", "approve:<request>", "use:<id>", …).
function gamesWindow<S extends ShellSettings>(k: SmokeKit<S>) {
  const gj = <T = any>(code: string): Promise<T | null> => k.gjs<T>(code).catch(() => null);
  return {
    games: async () => { const view = await gj<any>('gamesTest.view()'); return view ? { view, text: (await gj<string>('gamesTest.text()')) || '' } : null; },
    click: (name: string) => gj<boolean>(`gamesTest.click(${JSON.stringify(name)})`),
    openGames: async () => {
      if (!k.gamesWin()) await k.js('shellTest.click("tg-gamesw")').catch(() => null);
      return k.gamesReady();
    },
  };
}

// The game's own view: a window capture holds only the shell's page, not the view laid over it.
async function gameViewShot<S extends ShellSettings>(k: SmokeKit<S>, c: CatalogSmoke, name: string): Promise<void> {
  let img = null;
  for (let i = 0; i < 10 && (!img || img.isEmpty()); i++) { await k.wait(200); img = await c.host()!.view.webContents.capturePage().catch(() => null); }
  if (img && !img.isEmpty() && process.env.TG_SMOKE) fs.writeFileSync(path.join(process.env.TG_SMOKE, name + '.png'), img.toPNG());
}

// The real tokengames CLI (cli/dist, after `npm run build` in cli/), run with this app's Electron as Node against this
// run's catalog folder; without it the runs ask over the control socket the same way the CLI does.
function tokengames(c: CatalogSmoke) {
  const cliJs = path.resolve(c.bundleDir(), '..', '..', 'cli', 'dist', 'tokengames.js');
  const cli = (...args: string[]) => new Promise<{ code: number; out: string }>((resolve) => {
    execFile(process.execPath, [cliJs, ...args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TG_CATALOG_DIR: path.dirname(c.catalog().gamesDir) }, timeout: 30000 },
      (e, out, err) => resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out: String(out) + String(err) }));
  });
  return { cli, hasCli: fs.existsSync(cliJs) };
}

// Play a game from the Games window, and wait until it is the one in the orb, its card and the window.
async function playGame<S extends ShellSettings>(k: SmokeKit<S>, c: CatalogSmoke, id: string): Promise<boolean> {
  const { click, openGames } = gamesWindow(k);
  const hosted = async () => (await k.js<{ hosted: string | null }>('shellTest.games()').catch(() => null))?.hosted;
  await openGames();
  await click('use:' + id);
  return k.until(async () => (await hosted()) === (id === c.builtIn().id ? null : id) && c.catalog().active() === id, 8000);
}
