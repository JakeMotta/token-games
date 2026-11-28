// Window geometry, pure so it can be tested without Electron: 16:9 sizes, the four docking corners, snapping a
// dropped window to a corner, and resizing from the grip while keeping 16:9.
import type { Corner } from './orb';
import { type Bounds, type Dock, MIN_WIDTH, type ShellSettings } from './settings';

export interface Area { x: number; y: number; width: number; height: number }

export const MARGIN = 12; // docked windows sit this far in from the work area's edges
export const SNAP = 48; // let go this close to a corner and the window docks there

export const heightFor = (width: number): number => Math.round((width * 9) / 16);

// The largest 16:9 width that fits the work area (less the margins).
export const maxWidth = (area: Area): number => Math.max(MIN_WIDTH, Math.floor(Math.min(area.width - 2 * MARGIN, ((area.height - 2 * MARGIN) * 16) / 9)));

export const clampWidth = (width: number, area: Area): number => Math.max(MIN_WIDTH, Math.min(maxWidth(area), Math.round(width)));

// Top-left of a window of size w × h docked in a corner.
export function dockPoint(dock: Exclude<Dock, 'free'>, area: Area, w: number, h: number): { x: number; y: number } {
  const left = dock === 'tl' || dock === 'bl', top = dock === 'tl' || dock === 'tr';
  return {
    x: left ? area.x + MARGIN : area.x + area.width - MARGIN - w,
    y: top ? area.y + MARGIN : area.y + area.height - MARGIN - h,
  };
}

// The corner a window dropped at `b` snaps to, or 'free' when it is not near one.
export function nearestDock(b: Bounds, area: Area): Dock {
  for (const d of ['tl', 'tr', 'bl', 'br'] as const) {
    const p = dockPoint(d, area, b.width, b.height);
    if (Math.abs(p.x - b.x) <= SNAP && Math.abs(p.y - b.y) <= SNAP) return d;
  }
  return 'free';
}

// Keep a window fully inside the work area.
export function clampToArea(b: Bounds, area: Area): Bounds {
  const width = Math.min(b.width, area.width), height = Math.min(b.height, area.height);
  return {
    x: Math.max(area.x, Math.min(area.x + area.width - width, b.x)),
    y: Math.max(area.y, Math.min(area.y + area.height - height, b.y)),
    width, height,
  };
}

// Where the window goes for these settings.
export function boundsFor(s: Pick<ShellSettings, 'width' | 'dock' | 'bounds'>, area: Area): Bounds {
  const width = clampWidth(s.width, area), height = heightFor(width);
  if (s.dock !== 'free') return { ...dockPoint(s.dock, area, width, height), width, height };
  const at = s.bounds || { ...dockPoint('br', area, width, height), width, height };
  return clampToArea({ x: at.x, y: at.y, width, height }, area);
}

// The resize grip sits on the corner away from the dock, so the window grows into the screen.
export function gripCorner(dock: Dock): Corner {
  return ({ tl: 'br', tr: 'bl', bl: 'tr', br: 'tl', free: 'br' } as const)[dock];
}

// Resizing by dragging the grip at `grip` by (dx, dy) screen pixels from `start`. The opposite corner stays put
// and the result is always 16:9, between the minimum width and what fits the work area.
export function resizeFromGrip(start: Bounds, grip: Corner, dx: number, dy: number, area: Area): Bounds {
  const sx = grip === 'tr' || grip === 'br' ? 1 : -1, sy = grip === 'bl' || grip === 'br' ? 1 : -1;
  const byX = start.width + sx * dx, byY = ((start.height + sy * dy) * 16) / 9;
  // follow whichever edge the pointer moved further
  const want = Math.abs(sx * dx) >= Math.abs(((sy * dy) * 16) / 9) ? byX : byY;
  const width = clampWidth(want, area), height = heightFor(width);
  const x = sx > 0 ? start.x : start.x + start.width - width;
  const y = sy > 0 ? start.y : start.y + start.height - height;
  return { x, y, width, height };
}

// The Games window: a normal window, about 960 × 680, never larger than the work area (less a margin) nor smaller than
// its minimum unless the work area itself is, centred on the display the game is on.
export const GAMES_WINDOW = { width: 960, height: 680, minWidth: 640, minHeight: 480 };
export function gamesWindowBounds(area: Area): Bounds {
  const fit = (want: number, min: number, room: number) => Math.min(room, Math.max(Math.min(want, room - 2 * MARGIN * 2), min));
  const width = fit(GAMES_WINDOW.width, GAMES_WINDOW.minWidth, area.width), height = fit(GAMES_WINDOW.height, GAMES_WINDOW.minHeight, area.height);
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height };
}
