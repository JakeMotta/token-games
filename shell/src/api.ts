// What a game's page may ask of the main process, through the preload bridge (window.tokenShell), and what the
// main process tells it. The shell's page module (page/shell-page.ts) is the only user; games talk to the shell
// through the GameContext it hands them.
import type { GameRow, PendingRequest } from './catalog/catalog';
import type { Tier } from './catalog/registry';
import type { UsageEvent } from './events';
import type { HostedStatus } from './hosted';
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
}

// The catalog game the shell hosts in place of its own (docs/catalog.md).
export interface HostedBoot { id: string; name: string; version: string; tier: Tier; icon: string } // icon: a data: URL or ''

// The Games section of Settings: what is installed, what the catalog offers, and requests waiting for the player.
export interface GamesView {
  rows: GameRow[];
  pending: PendingRequest[];
  allowCommunity: boolean;
  catalog: { fetchedAt: string | null; games: number; error: string | null; signed: boolean };
  canAddLocal: boolean; // a folder picker is available (not in the smoke test)
}
export type GamesOp =
  | { op: 'refresh' } | { op: 'request'; action: 'install' | 'update' | 'remove'; id: string } | { op: 'add-local' }
  | { op: 'approve'; requestId: string } | { op: 'deny'; requestId: string } | { op: 'use'; id: string } | { op: 'community'; on: boolean };
export interface GamesResult { ok: boolean; error?: string; view: GamesView }
export interface GameRect { x: number; y: number; width: number; height: number; radius?: number } // radius: the rounded corners of the card

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
  // the catalog (Settings → Games) and a hosted catalog game
  games(): Promise<GamesView>;
  gamesDo(op: GamesOp): Promise<GamesResult>; // approving is only possible here, in the app
  onGames(fn: (v: GamesView) => void): void;
  hostedRect(r: GameRect | null, scale: Scale): void; // where the hosted game goes in the window; null hides it
  onHostedStatus(fn: (s: HostedStatus) => void): void;
  onHostedKey(fn: (k: { key: string; meta: boolean; ctrl: boolean }) => void): void; // a shell key pressed in the game
}

export const CH = {
  state: 'shell:state', set: 'shell:set', reset: 'shell:reset', fullscreen: 'shell:fullscreen', resize: 'shell:resize',
  grab: 'shell:grab', orbDrag: 'shell:orb-drag', intent: 'shell:intent', status: 'shell:status', hide: 'shell:hide', quit: 'shell:quit',
  settings: 'shell:settings', dark: 'shell:dark', event: 'shell:event', feed: 'shell:feed', command: 'shell:command', mode: 'shell:mode',
  save: 'shell:save', saveNow: 'shell:save-now', load: 'shell:load',
  games: 'shell:games', gamesDo: 'shell:games-do', gamesChanged: 'shell:games-changed',
  hostedRect: 'shell:hosted-rect', hostedStatus: 'shell:hosted-status', hostedKey: 'shell:hosted-key',
} as const;
