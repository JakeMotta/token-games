// The Ant Farm's main process: the shared shell (shell/src/main/shell.ts) does the windows, the corner orb, the tray, the
// settings file and the Claude Code feed; the farm adds its settings, its menu-bar ant and its smoke checks.
import { startShell } from '@token-games/shell/main/shell';
import { farmSettings } from '../shared/settings';
import { antBitmap } from './icon';
import { farmSmoke } from './smoke';

startShell({
  name: 'Ant Farm',
  dir: __dirname,
  settings: farmSettings,
  icon: (scale) => antBitmap(scale),
  saveFile: 'colony.json',
  smoke: farmSmoke,
});
