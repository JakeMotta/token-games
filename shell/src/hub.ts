// The Games and Settings window: one window with two tabs. Which tab a way in opens, what opening it again does, and
// the keys that move between the tabs or close it (pure, unit-tested). shell.ts owns the window; page/hub-page.ts
// draws the tabs.

export const HUB_TABS = ['games', 'settings'] as const;
export type HubTab = (typeof HUB_TABS)[number];
export const HUB_LABELS: Record<HubTab, string> = { games: 'Games', settings: 'Settings' };
export const isHubTab = (t: unknown): t is HubTab => (HUB_TABS as readonly unknown[]).includes(t);

// Every way in names its tab: the Games buttons, the tray's Games… and Settings → Games' Open Games… open Games; the
// Settings buttons, the , key and the tray's Settings… open Settings. Nothing else is remembered between opens.
export type HubEntry = 'games-button' | 'tray-games' | 'open-games' | 'settings-button' | 'comma' | 'tray-settings';
export const ENTRY_TAB: Record<HubEntry, HubTab> = {
  'games-button': 'games', 'tray-games': 'games', 'open-games': 'games',
  'settings-button': 'settings', comma: 'settings', 'tray-settings': 'settings',
};

// The window as the main process sees it. tab is meaningful only while open.
export interface HubState { open: boolean; tab: HubTab }
export interface HubOpen { next: HubState; create: boolean; switched: boolean }

// Opening it: a new window on that tab, or the open one brought forward on that tab. Never a second window.
export function openHub(s: HubState, tab: HubTab): HubOpen {
  if (!s.open) return { next: { open: true, tab }, create: true, switched: false };
  return { next: { open: true, tab }, create: false, switched: s.tab !== tab };
}

// Moving the tab from inside the window: same window, the tab changes (or nothing does).
export function pickTab(s: HubState, tab: HubTab): HubOpen {
  return { next: { open: s.open, tab }, create: false, switched: s.open && s.tab !== tab };
}

// Whether the game's page should keep the window's copy of its Settings sheet up to date: only while it shows.
export const settingsShowing = (s: HubState): boolean => s.open && s.tab === 'settings';

// A key pressed in the window. Esc and Cmd/Ctrl+W close it; Cmd/Ctrl+1 and +2 pick Games and Settings, Cmd/Ctrl+,
// picks Settings; ←/→ (wrapping), Home and End move between the tabs while one of them has the focus, as tabs do.
export interface HubKeyPress { key: string; meta?: boolean; ctrl?: boolean; alt?: boolean; onTab?: boolean }
export type HubKeyAction = { do: 'close' } | { do: 'tab'; tab: HubTab } | null;

export function hubKey(k: HubKeyPress, cur: HubTab): HubKeyAction {
  const cmd = !!(k.meta || k.ctrl), key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
  if (key === 'Escape' && !cmd) return { do: 'close' };
  if (cmd && !k.alt) {
    if (key === 'w') return { do: 'close' };
    if (key === ',') return { do: 'tab', tab: 'settings' };
    const n = Number(key);
    if (Number.isInteger(n) && n >= 1 && n <= HUB_TABS.length) return { do: 'tab', tab: HUB_TABS[n - 1] };
    return null;
  }
  if (!k.onTab || cmd || k.alt) return null;
  const i = HUB_TABS.indexOf(cur), n = HUB_TABS.length;
  if (key === 'ArrowRight') return { do: 'tab', tab: HUB_TABS[(i + 1) % n] };
  if (key === 'ArrowLeft') return { do: 'tab', tab: HUB_TABS[(i + n - 1) % n] };
  if (key === 'Home') return { do: 'tab', tab: HUB_TABS[0] };
  if (key === 'End') return { do: 'tab', tab: HUB_TABS[n - 1] };
  return null;
}
