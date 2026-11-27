// The Electron main process: the shell does all of it (the corner orb, the pop-out window, the tray, the settings
// file, the Claude Code feed, the hidden smoke test). The game only names itself and hands over its settings.
import { startShell } from '@token-games/shell/main/shell';
import { pixelIcon } from '@token-games/shell/main/pixel-icon';
import { gameSettings } from '../shared/settings';
import { gameSmoke } from './smoke';

// the menu-bar icon, 16 × 16: a jar
const ICON = [
  '................', '................', '.....######.....', '....#......#....', '....#......#....', '....#......#....',
  '....#......#....', '....#......#....', '....#......#....', '....########....', '....########....', '....########....',
  '....########....', '.....######.....', '................', '................',
];

startShell({ name: '__GAME_NAME__', dir: __dirname, settings: gameSettings, icon: (scale) => pixelIcon(ICON, scale), saveFile: 'save.json', smoke: gameSmoke });
