// The game's own settings, stored beside the shell's (presentation, size, docking, opacity, …) in one settings.json.
// The shell builds the Display section and Reset; the game adds its own section (src/game/index.html) for these.
import { bool, oneOf, settingsKit, type GameSettingsSchema, type ShellSettings } from '@token-games/shell/settings';

export const THEMES = ['dark', 'light', 'system'] as const;
export type ThemeId = (typeof THEMES)[number];

export interface GameSettings {
  theme: ThemeId; // ink on dark paper (the default), ink on cream paper, or follow the system
  numbers: boolean; // damage numbers over the walkers
}
export type Settings = ShellSettings & GameSettings;

// The window starts at the shell's own default size, like every game; Display → Size (or 2) makes it large.
const fresh = (): GameSettings => ({ theme: 'dark', numbers: true });

export const gameSettings: GameSettingsSchema<GameSettings> = {
  defaults: fresh,
  sanitize: (raw, base) => ({ theme: oneOf(THEMES, raw.theme, base.theme), numbers: bool(raw.numbers, base.numbers) }),
  reset: fresh,
};

export const kit = settingsKit(gameSettings);
