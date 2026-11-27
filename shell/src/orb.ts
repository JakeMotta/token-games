// Where the orb goes: which display, which corner, and the orb's, the hover pill's and the card's place in each
// state. Pure, so it can be tested without Electron.
//
// The orb rests in a corner of a display's work area (so never under the menu bar or the Dock). One see-through
// window, as big as the open card, sits in that corner; the orb, the pill and the card are drawn inside it and grow
// out of the corner. Everything outside them lets clicks pass to what is underneath.

export interface Rect { x: number; y: number; width: number; height: number }
export interface DisplayLike { id?: number; bounds: Rect; workArea: Rect }

export const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;
export type Corner = (typeof CORNERS)[number];

export const ORB = 64; // the orb's diameter
export const EYE = 54; // the live view inside it
export const EDGE = 16; // the window's distance from the work area's edges (also the room for the card's shadow)
export const PILL = 250; // the hover pill's width (as tall as the orb)
export const CARD = { width: 440, height: 330 }; // the open card, less on a very small display

export type Shape = 'orb' | 'pill' | 'card';

export interface OrbGeo {
  corner: Corner;
  area: Rect; // the work area of the orb's display
  card: { width: number; height: number };
  displayId?: number;
}

// The remembered display if it is still there, else the main one, else any.
export function pickDisplay<D extends DisplayLike>(all: D[], id: number | null | undefined, primary?: D): D | undefined {
  return all.find((d) => id != null && d.id === id) || primary || all[0];
}

export function cardSize(area: Rect): { width: number; height: number } {
  return {
    width: Math.max(ORB, Math.min(CARD.width, area.width - 2 * EDGE)),
    height: Math.max(ORB, Math.min(CARD.height, area.height - 2 * EDGE)),
  };
}

export function orbGeo(d: DisplayLike, corner: Corner): OrbGeo {
  return { corner, area: { ...d.workArea }, card: cardSize(d.workArea), displayId: d.id };
}

const isLeft = (c: Corner) => c === 'tl' || c === 'bl';
const isTop = (c: Corner) => c === 'tl' || c === 'tr';

// The window: the card's size, EDGE in from the corner of the work area.
export function orbWindowBounds(g: OrbGeo): Rect {
  const { width, height } = g.card, a = g.area;
  return {
    x: isLeft(g.corner) ? a.x + EDGE : a.x + a.width - EDGE - width,
    y: isTop(g.corner) ? a.y + EDGE : a.y + a.height - EDGE - height,
    width, height,
  };
}

// A shape inside the window (window coordinates): each one hugs the window's corner, so it grows out of the orb.
export function shapeSize(shape: Shape, g: OrbGeo): { width: number; height: number } {
  if (shape === 'card') return { ...g.card };
  if (shape === 'pill') return { width: Math.min(PILL, g.card.width), height: ORB };
  return { width: ORB, height: ORB };
}

export function shapeRect(shape: Shape, g: OrbGeo): Rect {
  const s = shapeSize(shape, g), w = orbWindowBounds(g);
  return {
    x: w.x + (isLeft(g.corner) ? 0 : w.width - s.width),
    y: w.y + (isTop(g.corner) ? 0 : w.height - s.height),
    ...s,
  };
}

export const orbCenter = (g: OrbGeo): { x: number; y: number } => {
  const r = shapeRect('orb', g);
  return { x: r.x + ORB / 2, y: r.y + ORB / 2 };
};

// Where an orb let go at `p` settles: the corner of the quarter of the work area it is in.
export function nearestCorner(p: { x: number; y: number }, area: Rect): Corner {
  const left = p.x < area.x + area.width / 2, top = p.y < area.y + area.height / 2;
  return top ? (left ? 'tl' : 'tr') : left ? 'bl' : 'br';
}

export const contains = (r: Rect, p: { x: number; y: number }, slop = 0): boolean =>
  p.x >= r.x - slop && p.x < r.x + r.width + slop && p.y >= r.y - slop && p.y < r.y + r.height + slop;

// The orb is round: only a pointer inside the circle counts (with a little slop once it is in).
export function onOrb(g: OrbGeo, p: { x: number; y: number }, slop = 0): boolean {
  const c = orbCenter(g);
  return Math.hypot(p.x - c.x, p.y - c.y) <= ORB / 2 + slop;
}
