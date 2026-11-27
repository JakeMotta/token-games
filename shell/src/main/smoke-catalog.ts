// The catalog's smoke run (TG_SMOKE_MODE=catalog), inside the real app with no window shown: fetch the signed test
// registry built from samples/, ask for an install over the control socket like an agent would, approve it in
// Settings → Games, switch to the game and prove it runs sandboxed (no Node, no file or network access, only
// window.tokenGame), that it gets the usage feed and its own save, that the built-in game's save is left alone, and
// that removing it brings the built-in game back. Screenshots: the picker and the permission sheet, dark and light.
import fs from 'node:fs';
import path from 'node:path';
import type { Catalog, BuiltIn } from '../catalog/catalog';
import { callControl } from '../catalog/control';
import type { ShellSettings } from '../settings';
import type { GameHost } from './catalog-host';
import type { SmokeKit } from './smoke';

export interface CatalogSmoke {
  catalog(): Catalog;
  host(): GameHost | null;
  socket(): string;
  builtIn(): BuiltIn;
  saveFile(): string; // the built-in game's save
}

const GAME = 'token-garden';
const API_KEYS = ['dock', 'env', 'getSettings', 'load', 'onEnv', 'onUsage', 'popOut', 'save', 'setSettings', 'setStatus', 'version'];

export async function catalogSmoke<S extends ShellSettings>(k: SmokeKit<S>, c: CatalogSmoke): Promise<void> {
  const { check, until, wait } = k;
  const sj = <T = any>(code: string): Promise<T | null> => k.js<T>(code).catch(() => null); // the page may be reloading
  const games = () => sj<{ view: any; text: string; hosted: string | null; icon: boolean }>('shellTest.games()');
  const click = (name: string) => sj<boolean>(`shellTest.gamesClick(${JSON.stringify(name)})`);
  const page = () => sj<any>('shellTest.state()');
  const settled = (st: string) => until(() => k.state() === st, 3000);
  const inGame = <T = any>(code: string): Promise<T> => c.host()!.view.webContents.executeJavaScript(code);
  const row = async (id: string) => ((await games())?.view?.rows || []).find((r: any) => r.id === id);
  const gameDir = path.join(c.catalog().gamesDir, GAME);
  const showGames = () => sj('document.getElementById("tg-games").scrollIntoView({ block: "start" })');
  const openPanel = async () => { if (!(await page())?.panelOpen) await sj('shellTest.key(",")'); return until(async () => !!(await page())?.panelOpen); };

  check('catalog: the built-in game is active and nothing else is listed before a fetch', c.catalog().active() === c.builtIn().id
    && await until(async () => JSON.stringify(((await games())?.view?.rows || []).map((r: any) => r.id)) === JSON.stringify([c.builtIn().id])), (await games())?.view);

  // pop out, large, so the sheet has room for its screenshots
  k.update({ size: 'large', dock: 'br', corner: 'br' } as Partial<S>);
  if (k.state() !== 'popped') { k.dispatch('pop'); await settled('popped'); }
  check('catalog: Settings → Games opens in the window', await openPanel() && /games/i.test((await games())?.text || ''));

  await click('refresh');
  check('catalog: "Check for games" fetches the signed index and lists the sample game', await until(async () => {
    const v = (await games())?.view;
    return !!v?.catalog.signed && !!v.rows.find((r: any) => r.id === GAME && !r.installed);
  }), (await games())?.view?.catalog);

  // an agent asks over the control socket; it can only ask
  check('catalog: the control socket is up', await until(() => !!c.socket()), c.socket());
  const asked = (await callControl(c.socket(), 'install', { id: GAME })) as { requested: { from: string; requestId: string } };
  check('catalog: an agent\'s install is only a request', asked.requested.from === 'agent' && !fs.existsSync(gameDir), asked);
  check('catalog: the request appears as a permission sheet marked "Requested by an agent"', await until(async () => /Requested by an agent/.test((await games())?.text || '')), (await games())?.text);
  await showGames();
  await k.shots('catalog-sheet');

  await click('approve:' + asked.requested.requestId);
  check('catalog: approving in the app installs it', await until(async () => !!(await row(GAME))?.installed) && fs.existsSync(path.join(gameDir, 'index.html')));
  check('catalog: installing does not switch games', c.catalog().active() === c.builtIn().id && !c.host());
  await showGames();
  await k.shots('catalog-picker');

  // switch: the page starts again around the catalog game
  await click('use:' + GAME);
  check('catalog: Play switches to the catalog game', await until(async () => (await games())?.hosted === GAME, 8000) && c.catalog().active() === GAME);
  check('catalog: the game is shown in the window, below the title bar', await until(() => !!c.host()?.shown(), 5000), c.host()?.shown());
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
  check('catalog: in the orb the game is hidden and the orb shows its icon and count', await settled('orb') && await until(async () => !c.host()?.shown() && !!(await games())?.icon), { shown: c.host()?.shown() });
  await k.shot('catalog-orb');
  await sj('shellTest.clickOrb()');
  check('catalog: in the open card the game is shown again', await settled('expanded') && await until(() => !!c.host()?.shown()), c.host()?.shown());
  await openPanel();
  check('catalog: Settings covers the game, so its view steps aside', await until(() => !c.host()?.shown()));
  check('catalog: the built-in game\'s save is left alone while another game plays', (fs.existsSync(c.saveFile()) ? fs.readFileSync(c.saveFile(), 'utf8') : null) === colony);

  // remove, approved in the app: back to the built-in game, the save kept
  await click('remove:' + GAME);
  const req = await until(async () => ((await games())?.view?.pending || []).some((r: any) => r.action === 'remove'));
  const rid = ((await games())?.view?.pending || []).find((r: any) => r.action === 'remove')?.requestId;
  check('catalog: Remove asks first', req && fs.existsSync(gameDir));
  await click('approve:' + rid);
  check('catalog: removing it brings the built-in game back', await until(async () => !!(await sj('!!window.gameTest')) && (await games())?.hosted === null, 8000)
    && c.catalog().active() === c.builtIn().id && !c.host());
  check('catalog: its files are gone and its save is kept', !fs.existsSync(gameDir) && fs.existsSync(path.join(c.catalog().saveDir(GAME), 'save.json')));
  await wait(300);
  if (k.state() !== 'orb') { k.dispatch('escape'); await settled('orb'); }
}
