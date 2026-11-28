// The Settings window's bridge (window.tokenSettings): the Settings sheet as the game's page draws it, the player's
// input back to it, and closing the window; nothing else of Node, Electron or the shell. The main process answers
// these only from the Settings window itself (shell.ts).
import { contextBridge, ipcRenderer } from 'electron';
import { CH, type SettingsWindowApi } from '../api';

const api: SettingsWindowApi = {
  boot: () => ipcRenderer.invoke(CH.settingsBoot),
  onSnap: (fn) => { ipcRenderer.on(CH.settingsSnap, (_e, s) => fn(s)); },
  input: (i) => ipcRenderer.send(CH.settingsInput, i),
  close: () => ipcRenderer.send(CH.settingsClose),
};

contextBridge.exposeInMainWorld('tokenSettings', api);
