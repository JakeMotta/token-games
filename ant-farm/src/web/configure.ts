// Before the farm's page runs: its settings schema, which the built-in app's main process gives the shell.
import { configureHosted } from '@token-games/shell/page/hosted-shell';
import { kit } from '../shared/settings';

configureHosted({ settings: kit });
