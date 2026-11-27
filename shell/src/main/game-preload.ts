// The preload of a hosted catalog game (catalog-host.ts): a sandboxed page with no Node. It exposes window.tokenGame
// (hosted.ts) and nothing else. The shell's own keys (Esc, Settings, Pop out, …) are passed on to the shell's page, so
// they work while the game has focus.
import { contextBridge, ipcRenderer } from 'electron';
import { GAME_CH, HOSTED_API_VERSION, type HostedEnv, type TokenGameApi } from '../hosted';

const envFns: ((e: HostedEnv) => void)[] = [];
ipcRenderer.on(GAME_CH.envChanged, (_e, v: HostedEnv) => { for (const fn of envFns) { try { fn(v); } catch { /* the game's */ } } });

const api: TokenGameApi = {
  version: HOSTED_API_VERSION,
  onUsage: (fn) => { ipcRenderer.on(GAME_CH.usage, (_e, ev) => fn(ev)); },
  env: () => ipcRenderer.invoke(GAME_CH.env),
  onEnv: (fn) => { envFns.push(fn); },
  load: () => ipcRenderer.invoke(GAME_CH.load),
  save: (d) => ipcRenderer.invoke(GAME_CH.save, d),
  getSettings: () => ipcRenderer.invoke(GAME_CH.getSettings),
  setSettings: (s) => ipcRenderer.invoke(GAME_CH.setSettings, s),
  setStatus: (s) => ipcRenderer.send(GAME_CH.status, s),
  popOut: () => ipcRenderer.send(GAME_CH.pop),
  dock: () => ipcRenderer.send(GAME_CH.dock),
};
contextBridge.exposeInMainWorld('tokenGame', api);

// Esc, ',' settings, O pop out, H hide, popped out 1 2 F T D, and Cmd/Ctrl+, and +Q.
const SHELL_KEYS = new Set(['Escape', ',', 'o', 'h', '1', '2', 'f', 't', 'd']);
window.addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mod = e.metaKey || e.ctrlKey;
  if (mod ? (k === ',' || k === 'q') : !e.altKey && SHELL_KEYS.has(k)) ipcRenderer.send(GAME_CH.key, { key: e.key, meta: e.metaKey, ctrl: e.ctrlKey });
}, true);
