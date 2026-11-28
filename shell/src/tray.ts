// The game's one menu, as plain data so it can be tested without Electron. The menu-bar (Mac) or notification-area
// (Windows) icon opens it, and so does a right-click on the game or the circle. It works in every state, so the game
// can always be found again; everything that isn't the size switch, Games or Settings lives here.
import { sizeOf, type ShellState, type Size } from './modes';
import { CORNERS, type Corner } from './orb';
import type { ShellSettings } from './settings';

export type TrayAction =
  | { do: 'size'; to: Size } | { do: 'toggle-window' } | { do: 'settings' } | { do: 'games' } | { do: 'fullscreen' } | { do: 'quit' }
  | { do: 'set'; patch: Partial<ShellSettings> };

export interface TrayItem { label?: string; type?: 'normal' | 'checkbox' | 'radio' | 'separator' | 'submenu'; checked?: boolean; enabled?: boolean; accelerator?: string; action?: TrayAction; submenu?: TrayItem[] }

export interface TrayContext {
  name: string;
  visible: boolean;
  state: ShellState;
  shortcut: string; // the global hotkey: shows or hides the game
  status?: string; // "6 ants", for the menu's first line
  updates?: number; // installed games with a newer version
  full?: boolean; // the window is full screen
}

const CORNER_LABEL: Record<Corner, string> = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' };
const SIZES: { to: Size; label: string; key: string }[] = [{ to: 'circle', label: 'Circle', key: '1' }, { to: 'card', label: 'Card', key: '2' }, { to: 'window', label: 'Window', key: '3' }];

export function trayMenu(s: ShellSettings, c: TrayContext): TrayItem[] {
  const now = sizeOf(c.state), inWindow = now === 'window';
  return [
    { label: c.name + (c.status ? ' · ' + c.status : ''), enabled: false },
    ...SIZES.map((z): TrayItem => ({ label: z.label, type: 'radio', checked: c.visible && now === z.to, accelerator: z.key, action: { do: 'size', to: z.to } })),
    { type: 'separator' },
    { label: 'Games…' + (c.updates ? ` (${c.updates} update${c.updates === 1 ? '' : 's'})` : ''), accelerator: 'G', action: { do: 'games' } },
    { label: 'Settings…', accelerator: 'CommandOrControl+,', action: { do: 'settings' } },
    { type: 'separator' },
    {
      label: 'Window', type: 'submenu',
      submenu: [
        { label: 'Small (320 × 180)', type: 'radio', checked: s.size === 'small', action: { do: 'set', patch: { size: 'small' } } },
        { label: 'Large (640 × 360)', type: 'radio', checked: s.size === 'large', action: { do: 'set', patch: { size: 'large' } } },
        { label: c.full ? 'Leave full screen' : 'Full screen', accelerator: 'F', enabled: inWindow, action: { do: 'fullscreen' } },
        { type: 'separator' },
        { label: 'Always on top', type: 'checkbox', checked: s.alwaysOnTop, action: { do: 'set', patch: { alwaysOnTop: !s.alwaysOnTop } } },
        { label: 'Click-through', type: 'checkbox', checked: s.clickThrough, action: { do: 'set', patch: { clickThrough: !s.clickThrough } } },
      ],
    },
    {
      label: 'Circle corner', type: 'submenu',
      submenu: CORNERS.map((k) => ({ label: CORNER_LABEL[k], type: 'radio' as const, checked: s.corner === k, action: { do: 'set' as const, patch: { corner: k } } })),
    },
    { label: (c.visible ? 'Hide ' : 'Show ') + c.name, accelerator: c.shortcut, action: { do: 'toggle-window' } },
    { type: 'separator' },
    { label: 'Quit ' + c.name, accelerator: 'CommandOrControl+Q', action: { do: 'quit' } },
  ];
}
