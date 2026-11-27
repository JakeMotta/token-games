// The shell's states and how they change, as a pure function so every transition can be tested.
//
//   collapsed ──enter──▶ peek ──click──▶ expanded ──blur/Esc/toggle──▶ collapsed
//       │                 └──leave──▶ collapsed          │
//       └──────────────── pop ──▶ popping ──settled──▶ popped ──dock──▶ docking ──settled──▶ collapsed
//
// collapsed, peek, expanded and docking live in the notch; popping and popped are the floating window. With reduced
// motion there is no flight: pop goes straight to popped and dock straight to collapsed.
import type { Presentation } from './settings';
import type { Shape } from './notch';

export const STATES = ['collapsed', 'peek', 'expanded', 'popping', 'popped', 'docking'] as const;
export type ShellState = (typeof STATES)[number];

export type ShellEvent =
  | 'enter' | 'leave' // the pointer over the island, or off it
  | 'click' // a click on the resting or peeking island
  | 'blur' | 'escape' // focus went elsewhere, Esc
  | 'toggle' // the hotkey or the tray: open or close the drop-down
  | 'pop' | 'dock' // Pop out ↗, ↩ Notch
  | 'settled' // the window finished flying
  | 'display'; // the displays changed

// The events the page may send (the rest come from the main process itself).
export const PAGE_EVENTS: readonly ShellEvent[] = ['click', 'escape', 'toggle', 'pop', 'dock'];

export function next(s: ShellState, ev: ShellEvent, o: { reducedMotion?: boolean } = {}): ShellState {
  if (ev === 'pop' && (s === 'collapsed' || s === 'peek' || s === 'expanded')) return o.reducedMotion ? 'popped' : 'popping';
  if (ev === 'dock' && s === 'popped') return o.reducedMotion ? 'collapsed' : 'docking';
  if (ev === 'settled') return s === 'popping' ? 'popped' : s === 'docking' ? 'collapsed' : s;
  if (ev === 'display') return s === 'peek' || s === 'expanded' ? 'collapsed' : s;
  switch (s) {
    case 'collapsed': return ev === 'enter' ? 'peek' : ev === 'click' || ev === 'toggle' ? 'expanded' : s;
    case 'peek': return ev === 'leave' ? 'collapsed' : ev === 'click' || ev === 'toggle' ? 'expanded' : s;
    case 'expanded': return ev === 'blur' || ev === 'escape' || ev === 'toggle' ? 'collapsed' : s; // leaving doesn't close it
    default: return s;
  }
}

export const presentationOf = (s: ShellState): Presentation => (s === 'popping' || s === 'popped' ? 'floating' : 'notch');

export const initialState = (p: Presentation): ShellState => (p === 'floating' ? 'popped' : 'collapsed');

// The size the game draws at: a tiny live strip, the drop-down, or the window.
export type Scale = 'mini' | 'expanded' | 'window';
export const scaleOf = (s: ShellState): Scale => (s === 'expanded' ? 'expanded' : s === 'popping' || s === 'popped' ? 'window' : 'mini');

// The island's outline in this state (none while the game is out in its window).
export const shapeOf = (s: ShellState): Shape | null =>
  s === 'peek' ? 'peek' : s === 'expanded' ? 'expanded' : s === 'collapsed' || s === 'docking' ? 'collapsed' : null;
