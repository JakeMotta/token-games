// What each control socket command does to the catalog. Install and remove only ever create a request that waits
// for the player in the app; `use` switches between games that are already installed.
import type { Catalog, PendingRequest } from './catalog';
import type { ControlHandler } from './control';
import { SHELL_VERSION, isGameId } from '../manifest';

export function catalogCommands(c: Catalog, onRequest: (r: PendingRequest) => void = () => {}): ControlHandler {
  const id = (args: Record<string, unknown>): string => {
    if (!isGameId(args.id)) throw new Error('give a game id, like token-garden');
    return args.id;
  };
  const ask = async (action: 'install' | 'remove' | 'add-local', target: string) => {
    const r = await c.request(action, target, 'agent');
    onRequest(r);
    return { requested: r, message: `Asked the player to approve ${r.action === 'add-local' ? 'adding' : r.action === 'update' ? 'updating' : r.action === 'install' ? 'installing' : 'removing'} ${r.name} in Token Games. Nothing changes until they do.` };
  };
  return async (cmd, args) => {
    switch (cmd) {
      case 'ping': return { app: 'token-games', shell: SHELL_VERSION };
      case 'list': return c.list();
      case 'status': return c.status();
      case 'refresh': return c.refresh();
      case 'install':
        if (typeof args.dir === 'string') return ask('add-local', args.dir);
        return ask('install', id(args));
      case 'remove': return ask('remove', id(args));
      case 'use': return { active: c.setActive(id(args)) };
    }
  };
}
