// The Games and Settings window's bridge (window.tokenHub): the catalog calls, the Settings sheet as the game's page
// draws it and the player's input back to it, the tab, and closing the window; nothing else of Node, Electron or the
// shell. The main process answers these only from this window and the shell's own page (shell.ts).
import { contextBridge, ipcRenderer } from 'electron';
import { CH, type HubWindowApi } from '../api';

const api: HubWindowApi = {
  boot: () => ipcRenderer.invoke(CH.hubBoot),
  games: () => ipcRenderer.invoke(CH.games),
  gamesDo: (op) => ipcRenderer.invoke(CH.gamesDo, op),
  onGames: (fn) => { ipcRenderer.on(CH.gamesChanged, (_e, v) => fn(v)); },
  onTab: (fn) => { ipcRenderer.on(CH.hubTab, (_e, t) => fn(t)); },
  tab: (t) => ipcRenderer.send(CH.hubTab, t),
  onSnap: (fn) => { ipcRenderer.on(CH.settingsSnap, (_e, s) => fn(s)); },
  input: (i) => ipcRenderer.send(CH.settingsInput, i),
  close: () => ipcRenderer.send(CH.hubClose),
};

contextBridge.exposeInMainWorld('tokenHub', api);
