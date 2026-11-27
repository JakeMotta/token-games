// The bridge between the page and the main process: only the calls in FarmApi, nothing else of Node or Electron.
import { contextBridge, ipcRenderer } from 'electron';
import { CH, type FarmApi } from '../shared/api';

const on = (ch: string) => (fn: (v: any) => void) => { ipcRenderer.on(ch, (_e, v) => fn(v)); };

const api: FarmApi = {
  getState: () => ipcRenderer.invoke(CH.state),
  setSettings: (patch) => ipcRenderer.invoke(CH.set, patch),
  resetSettings: () => ipcRenderer.invoke(CH.reset),
  setFullscreen: (v) => ipcRenderer.invoke(CH.fullscreen, v),
  resizeDrag: (d) => ipcRenderer.send(CH.resize, d),
  setGrab: (v) => ipcRenderer.send(CH.grab, v),
  hide: () => ipcRenderer.send(CH.hide),
  quit: () => ipcRenderer.send(CH.quit),
  saveColony: (d) => ipcRenderer.invoke(CH.save, d),
  saveColonyNow: (d) => ipcRenderer.sendSync(CH.saveNow, d),
  loadColony: () => ipcRenderer.invoke(CH.load),
  onSettings: on(CH.settings),
  onDark: on(CH.dark),
  onEvent: on(CH.event),
  onFeed: on(CH.feed),
  onCommand: on(CH.command),
};

contextBridge.exposeInMainWorld('antFarm', api);
