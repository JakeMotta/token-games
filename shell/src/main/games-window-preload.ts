// The Games window's bridge (window.tokenGames): the catalog calls and closing the window, nothing else of Node,
// Electron or the shell. The main process answers these only from its own two pages (shell.ts).
import { contextBridge, ipcRenderer } from 'electron';
import { CH, type GamesWindowApi } from '../api';

const api: GamesWindowApi = {
  boot: () => ipcRenderer.invoke(CH.gamesBoot),
  games: () => ipcRenderer.invoke(CH.games),
  gamesDo: (op) => ipcRenderer.invoke(CH.gamesDo, op),
  onGames: (fn) => { ipcRenderer.on(CH.gamesChanged, (_e, v) => fn(v)); },
  close: () => ipcRenderer.send(CH.gamesClose),
};

contextBridge.exposeInMainWorld('tokenGames', api);
