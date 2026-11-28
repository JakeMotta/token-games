// What a game's page may ask of the main process, through the preload bridge (window.tokenShell), and what the
// main process tells it. The shell's page module (page/shell-page.ts) is the only user; games talk to the shell
// through the GameContext it hands them.
import type { GameRow, PendingRequest } from './catalog/catalog';
import type { Tier } from './catalog/registry';
import type { UsageEvent } from './events';
import type { HostedStatus } from './hosted';
import type { HubTab } from './hub';
import type { Scale, ShellEvent, ShellState } from './modes';
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
  hosted: HostedBoot | null; // a catalog game is the active one: the page hosts it instead of its own game
  settingsOpen: boolean; // the Games and Settings window shows Settings (the page was reloaded under it, switching games)
}

// The catalog game the shell hosts in place of its own (docs/catalog.md).
export interface HostedBoot { id: string; name: string; version: string; tier: Tier; icon: string } // icon: a data: URL or ''

// The Games tab (the Games buttons, the tray's Games…, Settings → Games): what is installed, what the catalog offers,
// and requests waiting for the player. rows are the games shown: the built-in one, approved catalog games and what is
// on this computer, plus every developer and unapproved game while developer is on (Catalog.shown()).
export interface GamesView {
  rows: GameRow[];
  pending: PendingRequest[];
  developer: boolean; // Settings → Games: "Show developer and unapproved games"
  hiddenCount: number; // games left out because developer is off
  catalog: { fetchedAt: string | null; games: number; error: string | null; signed: boolean };
  canAddLocal: boolean; // a folder picker is available (not in the smoke test)
  icons: Record<string, string>; // game id → its icon as a data: URL, for the games on this computer
}
// How many installed games the catalog has a newer version of (the Games button's dot, the tray's "Games… (1 update)").
export const updatesIn = (rows: GameRow[]): number => rows.filter((r) => r.installed && !!r.update && !r.blocked).length;

export type GamesOp =
  | { op: 'refresh' } | { op: 'request'; action: 'install' | 'update' | 'remove'; id: string } | { op: 'add-local' }
  | { op: 'approve'; requestId: string } | { op: 'deny'; requestId: string } | { op: 'use'; id: string } | { op: 'developer'; on: boolean };
export interface GamesResult { ok: boolean; error?: string; view: GamesView }
export interface GameRect { x: number; y: number; width: number; height: number; radius?: number } // radius: the rounded corners of the card

export interface FeedStatus { watching: boolean; files: number; root: string; error?: string }

// Commands the main process sends the page (tray menu, global shortcut, window changes).
export type ShellCommand = 'fullscreen-on' | 'fullscreen-off';

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
  onSleep(fn: (asleep: boolean) => void): void; // the screen locked or the computer went to sleep, and back
  onEvent(fn: (ev: UsageEvent) => void): void;
  onFeed(fn: (f: FeedStatus) => void): void;
  onCommand(fn: (c: ShellCommand) => void): void;
  onMode(fn: (m: ModeInfo) => void): void;
  // the catalog (the Games tab, Settings → Games) and a hosted catalog game
  games(): Promise<GamesView>;
  gamesDo(op: GamesOp): Promise<GamesResult>; // approving is only possible in the app: here or in the Games tab
  onGames(fn: (v: GamesView) => void): void;
  openGames(): void; // open the Games and Settings window on Games, or bring it forward and switch to Games
  // Settings: the page keeps the Settings sheet (the game's own sections, Display, Games, Reset) and its code; the
  // window's Settings tab shows a copy (page/mirror.ts) and sends the player's input back
  openSettings(open: boolean): void; // open the window on Settings (or bring it forward and switch), or close it
  onSettingsWindow(fn: (open: boolean) => void): void; // the Settings tab started or stopped showing, however that happened
  settingsSnap(s: SettingsSnap): void; // what the sheet looks like now
  onSettingsInput(fn: (i: SettingsInput) => void): void; // the player did something in the window
  hostedRect(r: GameRect | null, scale: Scale): void; // where the hosted game goes in the window; null hides it
  onHostedStatus(fn: (s: HostedStatus) => void): void;
  onHostedKey(fn: (k: { key: string; meta: boolean; ctrl: boolean }) => void): void; // a shell key pressed in the game
}

// The catalog calls, all the Games tab gets.
export type GamesApi = Pick<ShellApi, 'games' | 'gamesDo' | 'onGames'>;

// The Settings sheet as the Settings tab shows it: its HTML (live values written in, canvases as images) and the
// game's own stylesheets (file names next to the page, shell.css left out).
export interface SettingsSnap { html: string; css: string[] }
// A click, or a new value, on the element at path (child indexes from the sheet's root, elements only).
export interface SettingsInput { path: number[]; type: 'click' | 'input' | 'change'; value?: string; checked?: boolean }

// The Games and Settings window's bridge (window.tokenHub, hub-window-preload.ts): the catalog calls, the Settings
// sheet and the player's input back to it, the tab, closing. Nothing else of Node, Electron or the shell.
export interface HubBoot { name: string; smoke: boolean; tab: HubTab; snap: SettingsSnap | null } // name: the app's built-in game
export interface HubWindowApi extends GamesApi {
  boot(): Promise<HubBoot>;
  onTab(fn: (tab: HubTab) => void): void; // opened again from the game, on this tab
  tab(tab: HubTab): void; // the player picked this tab in the window
  onSnap(fn: (s: SettingsSnap) => void): void;
  input(i: SettingsInput): void;
  close(): void;
}

export const CH = {
  state: 'shell:state', set: 'shell:set', reset: 'shell:reset', fullscreen: 'shell:fullscreen', resize: 'shell:resize',
  grab: 'shell:grab', orbDrag: 'shell:orb-drag', intent: 'shell:intent', status: 'shell:status', hide: 'shell:hide', quit: 'shell:quit',
  settings: 'shell:settings', dark: 'shell:dark', sleep: 'shell:sleep', event: 'shell:event', feed: 'shell:feed', command: 'shell:command', mode: 'shell:mode',
  save: 'shell:save', saveNow: 'shell:save-now', load: 'shell:load',
  games: 'shell:games', gamesDo: 'shell:games-do', gamesChanged: 'shell:games-changed',
  gamesOpen: 'shell:games-open', settingsOpen: 'shell:settings-open', settingsWin: 'shell:settings-win', settingsSnap: 'shell:settings-snap',
  settingsInput: 'shell:settings-input', hubBoot: 'shell:hub-boot', hubTab: 'shell:hub-tab', hubClose: 'shell:hub-close',
  hostedRect: 'shell:hosted-rect', hostedStatus: 'shell:hosted-status', hostedKey: 'shell:hosted-key',
} as const;
