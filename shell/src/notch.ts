// Where the island goes: which display, whether it has a notch, and the island's size and place in each state.
// Pure, so it can be tested without Electron.
//
// Electron has no notch API, so the notch is a guess from the display: a built-in screen whose menu bar is taller
// than usual (about 37 pt beside a notch, 24 without). With the menu bar hidden, the screen's shape decides: the
// notched MacBooks are about 1.54 : 1 where the older ones are 1.6 : 1. Without a notch the island hangs from the
// middle of the menu bar as a pill.

export interface Rect { x: number; y: number; width: number; height: number }
export interface DisplayLike { id?: number; internal?: boolean; bounds: Rect; workArea: Rect }

export interface NotchGeo {
  notch: boolean; // a notch, or the pill without one
  top: number; // the menu bar's height (the notch's height, on a notched screen)
  band: number; // the height of the island's top row: the notch's height, or the pill's
  notchWidth: number; // the guess at the notch's width (0 without one)
  screen: Rect; // the chosen display's bounds
  displayId?: number;
}

export const NOTCH_MIN_BAR = 31; // a menu bar this tall sits beside a notch
export const NOTCH_WIDTH = 200; // a little wider than the real notch (about 185–195 pt), so nothing hides behind it
export const EAR = 75; // the island reaches this far past each side of the notch
export const PILL = { width: 210, height: 25 };
export const PEEK = { width: 420, below: 94 }; // below the top row
export const EXPANDED = { width: 640, below: 326 };
export const PAD = 24; // room around the largest island inside the window, for its shadow

export type Shape = 'collapsed' | 'peek' | 'expanded';

export const menuBarHeight = (d: DisplayLike): number => Math.max(0, d.workArea.y - d.bounds.y);

export function hasNotch(d: DisplayLike): boolean {
  if (!d.internal) return false;
  const bar = menuBarHeight(d);
  if (bar >= NOTCH_MIN_BAR) return true;
  if (bar > 0) return false;
  const r = d.bounds.width / d.bounds.height; // the menu bar hides itself: go by the screen's shape
  return r > 1.52 && r < 1.565;
}

// The built-in display if there is one (only it can have a notch), else the main display, else any.
export function pickDisplay<D extends DisplayLike>(all: D[], primary?: D): D | undefined {
  return all.find((d) => d.internal) || primary || all[0];
}

export function notchGeo(d: DisplayLike): NotchGeo {
  const notch = hasNotch(d), bar = menuBarHeight(d);
  const top = notch ? Math.max(bar, 32) : bar;
  return { notch, top, band: notch ? top : PILL.height, notchWidth: notch ? NOTCH_WIDTH : 0, screen: { ...d.bounds }, displayId: (d as { id?: number }).id };
}

export function islandSize(shape: Shape, g: NotchGeo): { width: number; height: number } {
  if (shape === 'peek') return { width: PEEK.width, height: g.band + PEEK.below };
  if (shape === 'expanded') return { width: EXPANDED.width, height: g.band + EXPANDED.below };
  return g.notch ? { width: g.notchWidth + 2 * EAR, height: g.band } : { ...PILL };
}

const centreX = (g: NotchGeo, w: number): number => g.screen.x + Math.round((g.screen.width - w) / 2);

// The island on the screen, hanging from the top edge, centred.
export function islandRect(shape: Shape, g: NotchGeo): Rect {
  const s = islandSize(shape, g);
  return { x: centreX(g, s.width), y: g.screen.y, width: s.width, height: s.height };
}

// The one window that holds the island in all its states (the island animates inside it). Its see-through parts
// let clicks pass to what is underneath.
export function notchWindowBounds(g: NotchGeo): Rect {
  const s = islandSize('expanded', g), width = s.width + 2 * PAD, height = s.height + PAD;
  return { x: centreX(g, width), y: g.screen.y, width, height };
}

export const contains = (r: Rect, p: { x: number; y: number }, slop = 0): boolean =>
  p.x >= r.x - slop && p.x < r.x + r.width + slop && p.y >= r.y - slop && p.y < r.y + r.height + slop;
