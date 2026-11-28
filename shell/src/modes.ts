// The shell's states and how they change, as a pure function so every transition can be tested. The player sees three
// sizes, Circle, Card and Window (the size switch in the card and the window, the keys 1 2 3 and the menu):
//
//   orb ──enter──▶ hover (a name tag beside the circle) ──leave/drag──▶ orb
//    │  └──click/card/toggle──▶ expanded (the card) ──blur/Esc/toggle/click outside──▶ orb
//    └──────── pop ──▶ popping ──settled──▶ popped (the window)
//   popped ──dock──▶ docking ──settled──▶ orb          popped ──card/Esc──▶ returning ──settled──▶ expanded
//
// orb, hover, expanded, docking and returning live in the corner; popping and popped are the floating window. With
// reduced motion there is no flight: pop goes straight to popped, dock straight to orb and card straight to expanded.
import type { Shape } from './orb';
import type { Presentation } from './settings';

export const STATES = ['orb', 'hover', 'expanded', 'popping', 'popped', 'docking', 'returning'] as const;
export type ShellState = (typeof STATES)[number];

export type ShellEvent =
  | 'enter' | 'leave' // the pointer over the circle, or off it
  | 'click' // a click on the resting or hovered circle
  | 'drag' // the circle is being dragged to another corner
  | 'blur' | 'escape' // focus went elsewhere, Esc, a click outside the card
  | 'toggle' // the tray: open or close the card
  | 'pop' | 'card' | 'dock' // the size switch: Window, Card, Circle (from the window)
  | 'settled' // the window finished flying
  | 'display'; // the displays changed

// The events the page may send (the rest come from the main process itself).
export const PAGE_EVENTS: readonly ShellEvent[] = ['click', 'escape', 'toggle', 'pop', 'card', 'dock'];

export function next(s: ShellState, ev: ShellEvent, o: { reducedMotion?: boolean } = {}): ShellState {
  if (ev === 'pop' && (s === 'orb' || s === 'hover' || s === 'expanded')) return o.reducedMotion ? 'popped' : 'popping';
  if (ev === 'dock' && s === 'popped') return o.reducedMotion ? 'orb' : 'docking';
  // Esc in the window is one step down: back to the card, not all the way to the circle
  if ((ev === 'card' || ev === 'escape') && s === 'popped') return o.reducedMotion ? 'expanded' : 'returning';
  if (ev === 'settled') return s === 'popping' ? 'popped' : s === 'docking' ? 'orb' : s === 'returning' ? 'expanded' : s;
  if (ev === 'display' || ev === 'drag') return s === 'hover' || s === 'expanded' ? 'orb' : s;
  switch (s) {
    case 'orb': return ev === 'enter' ? 'hover' : ev === 'click' || ev === 'toggle' || ev === 'card' ? 'expanded' : s;
    case 'hover': return ev === 'leave' ? 'orb' : ev === 'click' || ev === 'toggle' || ev === 'card' ? 'expanded' : s;
    case 'expanded': return ev === 'blur' || ev === 'escape' || ev === 'toggle' || ev === 'dock' ? 'orb' : s; // leaving doesn't close it
    default: return s;
  }
}

export const presentationOf = (s: ShellState): Presentation => (s === 'popping' || s === 'popped' ? 'floating' : 'orb');

export const initialState = (p: Presentation): ShellState => (p === 'floating' ? 'popped' : 'orb');

// The size the player picked, as the switch and the menu show it (lit while it flies there).
export type Size = 'circle' | 'card' | 'window';
export const sizeOf = (s: ShellState): Size =>
  s === 'expanded' || s === 'returning' ? 'card' : s === 'popping' || s === 'popped' ? 'window' : 'circle';

// What each size asks for from a state: the event to send, or null when it is already there (or on its way).
export function goTo(s: ShellState, to: Size): ShellEvent | null {
  if (sizeOf(s) === to) return null;
  if (to === 'window') return 'pop';
  if (to === 'card') return 'card';
  return s === 'expanded' ? 'escape' : 'dock';
}

// The size the game draws at: the tiny live view in the orb, the open card, or the window.
export type Scale = 'mini' | 'expanded' | 'window';
export const scaleOf = (s: ShellState): Scale => (s === 'expanded' ? 'expanded' : s === 'popping' || s === 'popped' ? 'window' : 'mini');

// The shape in the corner in this state (none while the game is out in its window). Hovering the circle doesn't
// change its shape: a name tag shows beside it instead.
export const shapeOf = (s: ShellState): Shape | null =>
  s === 'expanded' || s === 'returning' ? 'card' : s === 'orb' || s === 'hover' || s === 'docking' ? 'orb' : null;
