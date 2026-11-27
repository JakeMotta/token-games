// The game's own settings, stored beside the shell's (presentation, size, docking, opacity, …) in one settings.json.
// The shell builds the Display section and Reset; the game adds its own sections (src/game/index.html) for these.
import { oneOf, settingsKit, type GameSettingsSchema, type ShellSettings } from '@token-games/shell/settings';

export const SANDS = { sand: '#d8b87a', sea: '#7fb4c9', moss: '#9db67a' } as const;
export const SAND_IDS = Object.keys(SANDS) as (keyof typeof SANDS)[];
export type SandId = keyof typeof SANDS;

export interface GameSettings { sand: SandId }
export type Settings = ShellSettings & GameSettings;

export const gameSettings: GameSettingsSchema<GameSettings> = {
  defaults: () => ({ sand: 'sand' }),
  sanitize: (raw, base) => ({ sand: oneOf(SAND_IDS, raw.sand, base.sand) }),
  reset: () => ({ sand: 'sand' }),
};

export const kit = settingsKit(gameSettings);
