// The settings every game shares (how it presents itself and its popped-out window), and how a game adds its own.
// One flat settings.json holds both. Pure, so the main process, the page and the tests share one definition.

// Where the game lives: in the notch (or a pill in the menu bar), or popped out as a floating window.
export const PRESENTATIONS = ['notch', 'floating'] as const;
export type Presentation = (typeof PRESENTATIONS)[number];

export const DOCKS = ['tl', 'tr', 'bl', 'br', 'free'] as const;
export type Dock = (typeof DOCKS)[number];

export const SIZES = ['small', 'large', 'custom'] as const;
export type SizePreset = (typeof SIZES)[number];

export interface Bounds { x: number; y: number; width: number; height: number }

export interface ShellSettings {
  presentation: Presentation;
  reducedMotion: boolean; // no animation in the notch or the window, few frames a second
  // the popped-out window
  size: SizePreset;
  width: number; // the window size (16:9); presets set it, the grip changes it
  clickThrough: boolean;
  opacity: number; // 0.25..1
  dock: Dock; // a corner of the work area, or 'free' where it was dropped
  bounds: Bounds | null; // where the window was last, for 'free'
  alwaysOnTop: boolean;
}

export const PRESET_WIDTH: Record<Exclude<SizePreset, 'custom'>, number> = { small: 320, large: 640 };
export const MIN_WIDTH = 256;
export const MIN_OPACITY = 0.25;

export function shellDefaults(): ShellSettings {
  return {
    presentation: 'notch', reducedMotion: false,
    size: 'small', width: PRESET_WIDTH.small, clickThrough: false, opacity: 1, dock: 'br', bounds: null, alwaysOnTop: true,
  };
}

export const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
export const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
export const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

function cleanBounds(v: unknown): Bounds | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  const ok = ['x', 'y', 'width', 'height'].every((k) => typeof b[k] === 'number' && Number.isFinite(b[k] as number));
  if (!ok || (b.width as number) < 1 || (b.height as number) < 1) return null;
  return { x: Math.round(b.x as number), y: Math.round(b.y as number), width: Math.round(b.width as number), height: Math.round(b.height as number) };
}

export function sanitizeShell(r: Record<string, unknown>, base: ShellSettings): ShellSettings {
  const size = oneOf(SIZES, r.size, base.size);
  let width = Math.round(num(r.width, MIN_WIDTH, 8192, base.width));
  if (size !== 'custom') width = PRESET_WIDTH[size];
  return {
    presentation: oneOf(PRESENTATIONS, r.presentation, base.presentation),
    reducedMotion: bool(r.reducedMotion, base.reducedMotion),
    size, width,
    clickThrough: bool(r.clickThrough, base.clickThrough),
    opacity: num(r.opacity, MIN_OPACITY, 1, base.opacity),
    dock: oneOf(DOCKS, r.dock, base.dock),
    bounds: r.bounds === undefined ? base.bounds : cleanBounds(r.bounds),
    alwaysOnTop: bool(r.alwaysOnTop, base.alwaysOnTop),
  };
}

// A game's own settings: its defaults (given a fresh random seed, for games that need one), how a stored value is
// checked, and what Reset keeps (a game's map, say).
export interface GameSettingsSchema<G> {
  defaults(seed: number): G;
  sanitize(raw: Record<string, unknown>, base: G): G;
  reset(cur: G): G;
}

export interface SettingsKit<S extends ShellSettings> {
  defaults(seed?: number): S;
  // Any value in, a complete and valid S out: unknown keys dropped, bad values replaced by `base`'s.
  sanitize(raw: unknown, base?: S): S;
  // A change from a settings menu applied on top of the current settings. A size preset sets the width.
  applyPatch(cur: S, patch: Partial<S>): S;
  // Every setting back to its default, except what the game keeps.
  reset(cur: S): S;
}

export function settingsKit<G extends object>(game: GameSettingsSchema<G>): SettingsKit<ShellSettings & G> {
  type S = ShellSettings & G;
  const defaults = (seed = 1): S => ({ ...shellDefaults(), ...game.defaults(seed >>> 0) });
  const sanitize = (raw: unknown, base: S = defaults()): S => {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return { ...sanitizeShell(r, base), ...game.sanitize(r, base) };
  };
  return {
    defaults, sanitize,
    applyPatch(cur, patch) {
      const next = sanitize({ ...cur, ...patch }, cur);
      if (patch.size && patch.size !== 'custom' && patch.width === undefined) next.width = PRESET_WIDTH[patch.size as keyof typeof PRESET_WIDTH];
      return next;
    },
    reset: (cur) => ({ ...shellDefaults(), ...game.reset(cur) }),
  };
}
