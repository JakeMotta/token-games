// The bridge between the page and the main process: only the calls in ShellApi, nothing else of Node or Electron.
import { contextBridge, ipcRenderer } from 'electron';
import { CH, type ShellApi } from '../api';

const on = (ch: string) => (fn: (v: any) => void) => { ipcRenderer.on(ch, (_e, v) => fn(v)); };

const api: ShellApi = {
  getState: () => ipcRenderer.invoke(CH.state),
  setSettings: (patch) => ipcRenderer.invoke(CH.set, patch),
  resetSettings: () => ipcRenderer.invoke(CH.reset),
  setFullscreen: (v) => ipcRenderer.invoke(CH.fullscreen, v),
  resizeDrag: (d) => ipcRenderer.send(CH.resize, d),
  setGrab: (v) => ipcRenderer.send(CH.grab, v),
  orbDrag: (d) => ipcRenderer.send(CH.orbDrag, d),
  intent: (ev) => ipcRenderer.send(CH.intent, ev),
  status: (st) => ipcRenderer.send(CH.status, st),
  hide: () => ipcRenderer.send(CH.hide),
  menu: () => ipcRenderer.send(CH.menu),
  quit: () => ipcRenderer.send(CH.quit),
  saveGame: (d) => ipcRenderer.invoke(CH.save, d),
  saveGameNow: (d) => ipcRenderer.sendSync(CH.saveNow, d),
  loadGame: () => ipcRenderer.invoke(CH.load),
  onSettings: on(CH.settings),
  onDark: on(CH.dark),
  onSleep: on(CH.sleep),
  onEvent: on(CH.event),
  onFeed: on(CH.feed),
  onCommand: on(CH.command),
  onMode: on(CH.mode),
  games: () => ipcRenderer.invoke(CH.games),
  gamesDo: (op) => ipcRenderer.invoke(CH.gamesDo, op),
  onGames: on(CH.gamesChanged),
  openGames: () => ipcRenderer.send(CH.gamesOpen),
  openSettings: (open) => ipcRenderer.send(CH.settingsOpen, open),
  onSettingsWindow: on(CH.settingsWin),
  settingsSnap: (snap) => ipcRenderer.send(CH.settingsSnap, snap),
  onSettingsInput: on(CH.settingsInput),
  hostedRect: (r, scale) => ipcRenderer.send(CH.hostedRect, r, scale),
  onHostedStatus: on(CH.hostedStatus),
  onHostedKey: on(CH.hostedKey),
};

contextBridge.exposeInMainWorld('tokenShell', api);
