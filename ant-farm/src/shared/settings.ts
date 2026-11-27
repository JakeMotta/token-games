// The player's settings: what they hold, their defaults, and how a stored or incoming value is checked.
// Pure, so the main process, the page and the tests share one definition.

export const PALETTE_IDS = ['original', 'earth', 'graphite', 'slate', 'dusk', 'terminal', 'blend'] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export const DOCKS = ['tl', 'tr', 'bl', 'br', 'free'] as const;
export type Dock = (typeof DOCKS)[number];

export const SIZES = ['small', 'large', 'custom'] as const;
export type SizePreset = (typeof SIZES)[number];

export interface Bounds { x: number; y: number; width: number; height: number }

export interface Settings {
  palette: PaletteId;
  calm: number; // 0..1: less saturation and contrast
  fadeIdle: boolean; // sink toward the backdrop after a few quiet seconds
  reducedMotion: boolean; // no floating labels or window animation, 2–5 frames a second
  size: SizePreset;
  width: number; // the window size (16:9); presets set it, the grip changes it
  clickThrough: boolean;
  opacity: number; // 0.25..1
  dock: Dock; // a corner of the work area, or 'free' where it was dropped
  bounds: Bounds | null; // where the window was last, for 'free'
  alwaysOnTop: boolean;
  claudeFeed: boolean; // watch Claude Code's usage
  seed: number; // the farm's map
}

export const PRESET_WIDTH: Record<Exclude<SizePreset, 'custom'>, number> = { small: 320, large: 640 };
export const MIN_WIDTH = 256;
export const MIN_OPACITY = 0.25;

export function defaultSettings(seed = 1): Settings {
  return {
    palette: 'blend', calm: 0, fadeIdle: false, reducedMotion: false,
    size: 'small', width: PRESET_WIDTH.small, clickThrough: false, opacity: 1, dock: 'br', bounds: null,
    alwaysOnTop: true, claudeFeed: true, seed: seed >>> 0,
  };
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

function cleanBounds(v: unknown): Bounds | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  const ok = ['x', 'y', 'width', 'height'].every((k) => typeof b[k] === 'number' && Number.isFinite(b[k] as number));
  if (!ok || (b.width as number) < 1 || (b.height as number) < 1) return null;
  return { x: Math.round(b.x as number), y: Math.round(b.y as number), width: Math.round(b.width as number), height: Math.round(b.height as number) };
}

// Any value in, a complete and valid Settings out: unknown keys dropped, bad values replaced by `base`'s.
export function sanitize(raw: unknown, base: Settings = defaultSettings()): Settings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const size = oneOf(SIZES, r.size, base.size);
  let width = Math.round(num(r.width, MIN_WIDTH, 8192, base.width));
  if (size !== 'custom') width = PRESET_WIDTH[size];
  return {
    palette: oneOf(PALETTE_IDS, r.palette, base.palette),
    calm: num(r.calm, 0, 1, base.calm),
    fadeIdle: bool(r.fadeIdle, base.fadeIdle),
    reducedMotion: bool(r.reducedMotion, base.reducedMotion),
    size, width,
    clickThrough: bool(r.clickThrough, base.clickThrough),
    opacity: num(r.opacity, MIN_OPACITY, 1, base.opacity),
    dock: oneOf(DOCKS, r.dock, base.dock),
    bounds: r.bounds === undefined ? base.bounds : cleanBounds(r.bounds),
    alwaysOnTop: bool(r.alwaysOnTop, base.alwaysOnTop),
    claudeFeed: bool(r.claudeFeed, base.claudeFeed),
    seed: typeof r.seed === 'number' && Number.isFinite(r.seed) ? r.seed >>> 0 : base.seed,
  };
}

// A change from the settings menu applied on top of the current settings. A size preset sets the width.
export function applyPatch(cur: Settings, patch: Partial<Settings>): Settings {
  const next = sanitize({ ...cur, ...patch }, cur);
  if (patch.size && patch.size !== 'custom' && patch.width === undefined) next.width = PRESET_WIDTH[patch.size];
  return next;
}

// Reset puts every setting back to its default but keeps the farm's map.
export function resetSettings(cur: Settings): Settings {
  return defaultSettings(cur.seed);
}
