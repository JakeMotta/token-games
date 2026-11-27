// The menu-bar (Mac) or notification-area (Windows) menu, as plain data so it can be tested without Electron. It
// works in every state, so the game can always be found again.
import { presentationOf, type ShellState } from './modes';
import { CORNERS, type Corner } from './orb';
import { DOCKS, type Dock, type ShellSettings } from './settings';

export type TrayAction =
  | { do: 'toggle-window' } | { do: 'open' } | { do: 'pop' } | { do: 'dock' } | { do: 'settings' } | { do: 'fullscreen' }
  | { do: 'reset' } | { do: 'quit' }
  | { do: 'set'; patch: Partial<ShellSettings> };

export interface TrayItem { label?: string; type?: 'normal' | 'checkbox' | 'radio' | 'separator' | 'submenu'; checked?: boolean; enabled?: boolean; accelerator?: string; action?: TrayAction; submenu?: TrayItem[] }

export interface TrayContext { name: string; visible: boolean; state: ShellState; shortcut: string }

const DOCK_LABEL: Record<Dock, string> = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right', free: 'Where I drop it' };
const CORNER_LABEL: Record<Corner, string> = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' };

export function trayMenu(s: ShellSettings, c: TrayContext): TrayItem[] {
  const floating = presentationOf(c.state) === 'floating', open = c.state === 'expanded';
  return [
    { label: (c.visible ? 'Hide ' : 'Show ') + c.name, action: { do: 'toggle-window' } },
    floating
      ? { label: 'Back to the corner', action: { do: 'dock' } }
      : { label: open ? 'Close ' + c.name : 'Open ' + c.name, accelerator: c.shortcut, action: { do: 'open' } },
    ...(floating ? [] : [{ label: 'Pop out', action: { do: 'pop' } } as TrayItem]),
    { label: 'Settings…', action: { do: 'settings' } },
    { type: 'separator' },
    {
      label: 'Presentation', type: 'submenu',
      submenu: [
        { label: 'In the corner', type: 'radio', checked: !floating, action: { do: 'dock' } },
        { label: 'Floating window', type: 'radio', checked: floating, action: { do: 'pop' } },
      ],
    },
    {
      label: 'Corner', type: 'submenu',
      submenu: CORNERS.map((k) => ({ label: CORNER_LABEL[k], type: 'radio' as const, checked: s.corner === k, action: { do: 'set' as const, patch: { corner: k } } })),
    },
    {
      label: 'Floating window', type: 'submenu',
      submenu: [
        { label: 'Small (320 × 180)', type: 'radio', checked: s.size === 'small', action: { do: 'set', patch: { size: 'small' } } },
        { label: 'Large (640 × 360)', type: 'radio', checked: s.size === 'large', action: { do: 'set', patch: { size: 'large' } } },
        { label: 'Full screen', enabled: floating, action: { do: 'fullscreen' } },
        { type: 'separator' },
        { label: 'Click-through', type: 'checkbox', checked: s.clickThrough, accelerator: floating ? c.shortcut : undefined, action: { do: 'set', patch: { clickThrough: !s.clickThrough } } },
        { label: 'Always on top', type: 'checkbox', checked: s.alwaysOnTop, action: { do: 'set', patch: { alwaysOnTop: !s.alwaysOnTop } } },
        {
          label: 'Dock', type: 'submenu',
          submenu: DOCKS.map((d) => ({ label: DOCK_LABEL[d], type: 'radio' as const, checked: s.dock === d, action: { do: 'set' as const, patch: { dock: d } } })),
        },
      ],
    },
    { label: 'Reduced motion', type: 'checkbox', checked: s.reducedMotion, action: { do: 'set', patch: { reducedMotion: !s.reducedMotion } } },
    { type: 'separator' },
    { label: 'Reset to defaults', action: { do: 'reset' } },
    { label: 'Quit ' + c.name, accelerator: 'CommandOrControl+Q', action: { do: 'quit' } },
  ];
}
