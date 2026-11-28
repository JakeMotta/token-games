// The game interface: what a game hands the shell's page (mountShell in page/shell-page.ts), and what the shell
// gives the game back. Every game in this repo is a Game; the shell owns everything around it (the circle in the
// corner and its name tag, the card, the window, their top bar and size switch, the menu, the settings file, the Claude
// Code feed). A game's own buttons, if it needs any, go inside its root, below topInset: never in the shell's bar.
import type { FeedStatus } from './api';
import type { UsageEvent } from './events';
import type { Scale, ShellState } from './modes';
import type { ShellSettings } from './settings';

export type { Scale } from './modes';

export interface Game<S extends ShellSettings = ShellSettings> {
  name: string;
  // The game's view: an element (usually holding one canvas) that the shell moves between the orb's round eye, the
  // open card and the window. Size it from its own clientWidth / clientHeight, never from the window.
  root: HTMLElement;
  icon?: string; // a tiny inline SVG (or a character) beside the game's name in the card's bar and the circle's name tag
  settingsPanel?: HTMLElement; // the game's own <section>s for the Settings sheet, shown above the shell's
  keysHelp?: string; // the game's own keys, for the help line at the bottom of Settings

  start(ctx: GameContext<S>): void | Promise<void>; // the settings have arrived: load the save and begin
  onEvent(ev: UsageEvent): void; // real Claude Code usage: the only thing that may move the game forward
  onSettings?(s: S): void; // any setting changed (the game's or the shell's)
  onScale?(scale: Scale): void; // the game moved: 'mini' (the orb), 'expanded' (the open card) or 'window'
  onDark?(dark: boolean): void;
  onFeed?(f: FeedStatus): void;
  onPanel?(open: boolean): void; // the Settings sheet opened or closed
  onFullscreen?(on: boolean): void;
  onKey?(key: string, e: KeyboardEvent): boolean; // a key the shell doesn't use; return true when handled
  onHide?(): void; // the window is about to hide or close: save now
  onSleep?(asleep: boolean): void; // the screen locked or the computer slept (true), and woke (false): draw nothing meanwhile
  testHooks?(): Record<string, unknown>; // read-only views for the smoke test (window.gameTest); never a way to feed the game
}

export interface GameStatusLine {
  count: string; // the number on the orb's badge and in the menu-bar tooltip ("42")
  title: string; // what it counts ("ants")
  lead?: string; // a short bold part of the status line ("⚡ 31")
  line?: string; // the status line at the bottom of the card and in the window's title bar
  warm?: boolean; // the game needs the player (hungry, over): the orb's ring turns warm, quietly
}

export interface GameContext<S extends ShellSettings = ShellSettings> {
  readonly settings: S;
  readonly scale: Scale;
  readonly state: ShellState;
  readonly topInset: number; // pixels at the top of root covered by the window's title bar (0 in the corner)
  readonly dark: boolean;
  readonly smoke: boolean; // the hidden smoke test is driving: keep drawing although the window is never shown
  readonly feed: FeedStatus | null;
  readonly panelOpen: boolean;
  readonly fullscreen: boolean;
  set(patch: Partial<S>): void; // change settings (shown at once, saved by the main process)
  reset(): Promise<S>;
  setStatus(s: GameStatusLine): void; // cheap to call every frame: only changes reach the screen
  pulse(text: string, kind?: 'hot' | 'task'): void; // a quiet label for a moment: "+1.2k tokens"
  setTheme(t: Theme): void; // the colours of the window, its title bar and the Settings sheet
  setCalm(calm: boolean): void; // nothing is happening: the title bar dims
  openPanel(open?: boolean): void;
  save(data: unknown): Promise<boolean>; // the game's state, to its save file
  saveNow(data: unknown): boolean; // the same, synchronously, while the page is closing
  load(): Promise<unknown>; // the last save, or null
  hide(): void;
  quit(): void;
}

// The window's colours, usually from the game's palette. The circle, its name tag and the card keep the shell's own quiet
// colours (light or dark with the system), so every game looks at home in the corner.
export interface Theme { back: string; bar: string; ink: string; dim: string; hot: string; task?: string; line: string; panel?: string }
