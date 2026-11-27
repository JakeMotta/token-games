// The shell's states and how they change, as a pure function so every transition can be tested.
//
//   orb ──enter──▶ hover ──click──▶ expanded ──blur/Esc/toggle/click outside──▶ orb
//    │              └──leave/drag──▶ orb
//    └──────────────── pop ──▶ popping ──settled──▶ popped ──dock──▶ docking ──settled──▶ orb
//
// orb, hover, expanded and docking live in the corner; popping and popped are the floating window. With reduced
// motion there is no flight: pop goes straight to popped and dock straight to orb.
import type { Shape } from './orb';
import type { Presentation } from './settings';

export const STATES = ['orb', 'hover', 'expanded', 'popping', 'popped', 'docking'] as const;
export type ShellState = (typeof STATES)[number];

export type ShellEvent =
  | 'enter' | 'leave' // the pointer over the orb, or off the pill
  | 'click' // a click on the resting or hovered orb
  | 'drag' // the orb is being dragged to another corner
  | 'blur' | 'escape' // focus went elsewhere, Esc, a click outside the card
  | 'toggle' // the hotkey or the tray: open or close the card
  | 'pop' | 'dock' // Pop out ↗, ↩ Corner
  | 'settled' // the window finished flying
  | 'display'; // the displays changed

// The events the page may send (the rest come from the main process itself).
export const PAGE_EVENTS: readonly ShellEvent[] = ['click', 'escape', 'toggle', 'pop', 'dock'];

export function next(s: ShellState, ev: ShellEvent, o: { reducedMotion?: boolean } = {}): ShellState {
  if (ev === 'pop' && (s === 'orb' || s === 'hover' || s === 'expanded')) return o.reducedMotion ? 'popped' : 'popping';
  if (ev === 'dock' && s === 'popped') return o.reducedMotion ? 'orb' : 'docking';
  if (ev === 'settled') return s === 'popping' ? 'popped' : s === 'docking' ? 'orb' : s;
  if (ev === 'display' || ev === 'drag') return s === 'hover' || s === 'expanded' ? 'orb' : s;
  switch (s) {
    case 'orb': return ev === 'enter' ? 'hover' : ev === 'click' || ev === 'toggle' ? 'expanded' : s;
    case 'hover': return ev === 'leave' ? 'orb' : ev === 'click' || ev === 'toggle' ? 'expanded' : s;
    case 'expanded': return ev === 'blur' || ev === 'escape' || ev === 'toggle' ? 'orb' : s; // leaving doesn't close it
    default: return s;
  }
}

export const presentationOf = (s: ShellState): Presentation => (s === 'popping' || s === 'popped' ? 'floating' : 'orb');

export const initialState = (p: Presentation): ShellState => (p === 'floating' ? 'popped' : 'orb');

// The size the game draws at: the tiny live view in the orb, the open card, or the window.
export type Scale = 'mini' | 'expanded' | 'window';
export const scaleOf = (s: ShellState): Scale => (s === 'expanded' ? 'expanded' : s === 'popping' || s === 'popped' ? 'window' : 'mini');

// The shape in the corner in this state (none while the game is out in its window).
export const shapeOf = (s: ShellState): Shape | null =>
  s === 'hover' ? 'pill' : s === 'expanded' ? 'card' : s === 'orb' || s === 'docking' ? 'orb' : null;
