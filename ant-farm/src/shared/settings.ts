// The farm's own settings (colours, calm, the map), on top of the settings every game shares (how it shows itself,
// the popped-out window: see shell/src/settings.ts). Pure, so the main process, the page and the tests share them.
import { bool, num, oneOf, settingsKit, type GameSettingsSchema, type ShellSettings } from '@token-games/shell/settings';

export const PALETTE_IDS = ['original', 'earth', 'graphite', 'slate', 'dusk', 'terminal', 'blend'] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

// How big the farm's map is (see MAP_SIZES in sim/world.ts). Changing it starts a new farm.
export const MAP_SIZE_IDS = ['large', 'huge', 'ridiculous'] as const;
export type MapSizeId = (typeof MAP_SIZE_IDS)[number];

export interface FarmSettings {
  palette: PaletteId;
  calm: number; // 0..1: less saturation and contrast
  fadeIdle: boolean; // sink toward the backdrop after a few quiet seconds
  mapSize: MapSizeId;
  seed: number; // the farm's map
}

export type Settings = ShellSettings & FarmSettings;

export const farmSettings: GameSettingsSchema<FarmSettings> = {
  defaults: (seed) => ({ palette: 'blend', calm: 0, fadeIdle: false, mapSize: 'ridiculous', seed: seed >>> 0 }),
  sanitize: (r, base) => ({
    palette: oneOf(PALETTE_IDS, r.palette, base.palette),
    calm: num(r.calm, 0, 1, base.calm),
    fadeIdle: bool(r.fadeIdle, base.fadeIdle),
    mapSize: oneOf(MAP_SIZE_IDS, r.mapSize, base.mapSize),
    seed: typeof r.seed === 'number' && Number.isFinite(r.seed) ? r.seed >>> 0 : base.seed,
  }),
  // Reset puts every setting back to its default but keeps the farm's map.
  reset: (cur) => farmSettings.defaults(cur.seed),
};

export const kit = settingsKit(farmSettings);
export const defaultSettings = kit.defaults;
export const sanitize = kit.sanitize;
export const applyPatch = kit.applyPatch;
export const resetSettings = kit.reset;
