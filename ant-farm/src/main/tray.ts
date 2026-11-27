// The menu-bar (Mac) or notification-area (Windows) menu, as plain data so it can be tested without Electron.
import { DOCKS, type Dock, type Settings } from '../shared/settings';

export type TrayAction =
  | { do: 'toggle-window' } | { do: 'settings' } | { do: 'fullscreen' } | { do: 'quit' }
  | { do: 'set'; patch: Partial<Settings> };

export interface TrayItem { label?: string; type?: 'normal' | 'checkbox' | 'radio' | 'separator' | 'submenu'; checked?: boolean; accelerator?: string; action?: TrayAction; submenu?: TrayItem[] }

const DOCK_LABEL: Record<Dock, string> = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right', free: 'Where I drop it' };

export function trayMenu(s: Settings, visible: boolean, clickShortcut: string): TrayItem[] {
  return [
    { label: visible ? 'Hide Ant Farm' : 'Show Ant Farm', action: { do: 'toggle-window' } },
    { label: 'Settings…', action: { do: 'settings' } },
    { type: 'separator' },
    { label: 'Small (320 × 180)', type: 'radio', checked: s.size === 'small', action: { do: 'set', patch: { size: 'small' } } },
    { label: 'Large (640 × 360)', type: 'radio', checked: s.size === 'large', action: { do: 'set', patch: { size: 'large' } } },
    { label: 'Full screen', action: { do: 'fullscreen' } },
    { type: 'separator' },
    { label: 'Click-through', type: 'checkbox', checked: s.clickThrough, accelerator: clickShortcut, action: { do: 'set', patch: { clickThrough: !s.clickThrough } } },
    { label: 'Always on top', type: 'checkbox', checked: s.alwaysOnTop, action: { do: 'set', patch: { alwaysOnTop: !s.alwaysOnTop } } },
    { label: 'Watch Claude Code', type: 'checkbox', checked: s.claudeFeed, action: { do: 'set', patch: { claudeFeed: !s.claudeFeed } } },
    {
      label: 'Dock', type: 'submenu',
      submenu: DOCKS.map((d) => ({ label: DOCK_LABEL[d], type: 'radio' as const, checked: s.dock === d, action: { do: 'set' as const, patch: { dock: d } } })),
    },
    { type: 'separator' },
    { label: 'Quit Ant Farm', accelerator: 'CommandOrControl+Q', action: { do: 'quit' } },
  ];
}
