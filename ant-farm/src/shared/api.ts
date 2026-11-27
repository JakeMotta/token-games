// What the page may ask of the main process, through the preload bridge (window.antFarm).
import type { FarmEvent } from './events';
import type { Settings } from './settings';

export interface FarmState {
  settings: Settings;
  dark: boolean; // the desktop's appearance
  platform: string;
  fullscreen: boolean;
  feed: FeedStatus;
  smoke: boolean; // the automated smoke test is driving: draw even though the window is hidden
}

export interface FeedStatus { watching: boolean; files: number; root: string; error?: string }

// Commands the main process sends the page (tray menu, global shortcut, window changes).
export type FarmCommand = 'settings' | 'fullscreen-on' | 'fullscreen-off';

export interface ResizeDrag { phase: 'start' | 'move' | 'end'; x: number; y: number } // screen coordinates

export interface FarmApi {
  getState(): Promise<FarmState>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  resetSettings(): Promise<Settings>;
  setFullscreen(on: boolean): Promise<boolean>;
  resizeDrag(d: ResizeDrag): void;
  setGrab(on: boolean): void; // while click-through is on: take the mouse back (Alt held)
  hide(): void;
  saveColony(data: unknown): Promise<boolean>; // the farm, to colony.json in the app's data folder
  saveColonyNow(data: unknown): boolean; // the same, synchronously, for when the page is closing
  loadColony(): Promise<unknown>; // what was saved last, or null
  quit(): void;
  onSettings(fn: (s: Settings) => void): void;
  onDark(fn: (dark: boolean) => void): void;
  onEvent(fn: (ev: FarmEvent) => void): void;
  onFeed(fn: (f: FeedStatus) => void): void;
  onCommand(fn: (c: FarmCommand) => void): void;
}

export const CH = {
  state: 'farm:state', set: 'farm:set', reset: 'farm:reset', fullscreen: 'farm:fullscreen', resize: 'farm:resize',
  grab: 'farm:grab', hide: 'farm:hide', quit: 'farm:quit', settings: 'farm:settings', dark: 'farm:dark', event: 'farm:event', feed: 'farm:feed',
  command: 'farm:command', save: 'farm:save', saveNow: 'farm:save-now', load: 'farm:load',
} as const;
