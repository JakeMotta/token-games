// What a game's page may ask of the main process, through the preload bridge (window.tokenShell), and what the
// main process tells it. The shell's page module (page/shell-page.ts) is the only user; games talk to the shell
// through the GameContext it hands them.
import type { UsageEvent } from './events';
import type { ShellEvent, ShellState } from './modes';
import type { OrbGeo } from './orb';
import type { ShellSettings } from './settings';

export interface ModeInfo {
  state: ShellState;
  geo: OrbGeo; // the orb's corner, its display's work area and the card's size
  visible: boolean;
}

export interface ShellBoot<S extends ShellSettings = ShellSettings> {
  name: string;
  settings: S;
  dark: boolean; // the desktop's appearance
  platform: string;
  fullscreen: boolean;
  feed: FeedStatus;
  smoke: boolean; // the automated smoke test is driving: draw even though the window is hidden
  mode: ModeInfo;
  shortcut: string;
}

export interface FeedStatus { watching: boolean; files: number; root: string; error?: string }

// Commands the main process sends the page (tray menu, global shortcut, window changes).
export type ShellCommand = 'settings' | 'fullscreen-on' | 'fullscreen-off';

export interface ResizeDrag { phase: 'start' | 'move' | 'end'; x: number; y: number } // screen coordinates
export type OrbDrag = ResizeDrag; // the orb dragged to another corner, the same way

// What the menu-bar tooltip shows: a number and a word, kept short.
export interface GameStatus { count: string; title: string }

export interface ShellApi<S extends ShellSettings = ShellSettings> {
  getState(): Promise<ShellBoot<S>>;
  setSettings(patch: Partial<S>): Promise<S>;
  resetSettings(): Promise<S>;
  setFullscreen(on: boolean): Promise<boolean>;
  resizeDrag(d: ResizeDrag): void;
  setGrab(on: boolean): void; // while click-through is on: take the mouse back (Alt held)
  orbDrag(d: OrbDrag): void; // the orb is being dragged; the main process moves the window and settles it in a corner
  intent(ev: ShellEvent): void; // click, escape, toggle, pop, dock
  status(s: GameStatus): void;
  hide(): void;
  saveGame(data: unknown): Promise<boolean>; // the game's state, to its save file in the app's data folder
  saveGameNow(data: unknown): boolean; // the same, synchronously, for when the page is closing
  loadGame(): Promise<unknown>; // what was saved last, or null
  quit(): void;
  onSettings(fn: (s: S) => void): void;
  onDark(fn: (dark: boolean) => void): void;
  onEvent(fn: (ev: UsageEvent) => void): void;
  onFeed(fn: (f: FeedStatus) => void): void;
  onCommand(fn: (c: ShellCommand) => void): void;
  onMode(fn: (m: ModeInfo) => void): void;
}

export const CH = {
  state: 'shell:state', set: 'shell:set', reset: 'shell:reset', fullscreen: 'shell:fullscreen', resize: 'shell:resize',
  grab: 'shell:grab', orbDrag: 'shell:orb-drag', intent: 'shell:intent', status: 'shell:status', hide: 'shell:hide', quit: 'shell:quit',
  settings: 'shell:settings', dark: 'shell:dark', event: 'shell:event', feed: 'shell:feed', command: 'shell:command', mode: 'shell:mode',
  save: 'shell:save', saveNow: 'shell:save-now', load: 'shell:load',
} as const;
