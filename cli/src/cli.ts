// tokengames: asks the running Token Games app to list, install, switch or remove games, over its control socket
// (shell/src/catalog/control.ts). Installing and removing only ask: the player approves or denies in the app, and
// nothing here can approve. Exit codes: 0 done, 1 failed, 2 wrong usage, 3 the app is not running.
import path from 'node:path';
import type { GameRow, PendingRequest } from '@token-games/shell/catalog/catalog';
import { callControl, defaultCatalogDir, findSocket, type ControlCommand } from '@token-games/shell/catalog/control';

export type Call = (cmd: ControlCommand, args?: Record<string, unknown>) => Promise<unknown>;
export interface Io { out(s: string): void; err(s: string): void; call: Call }

export const USAGE = `tokengames: ask the running Token Games app to change games. Installs and removals wait for the player to approve them in the app.

  tokengames list [--refresh] [--json]   every game: built in, installed, and in the catalog (--refresh fetches the signed catalog first);
                                         NOTE says which are not approved and hidden in the app's Games window
  tokengames status [--json]             what is playing, the catalog, and requests waiting for the player
  tokengames install <id>                ask the player to install a catalog game
  tokengames install --dir <folder>      ask the player to add a web game from a folder on this computer
  tokengames use <id>                    switch to a game that is already installed
  tokengames remove <id>                 ask the player to remove a game (its save is kept)

The app must be running. TG_CATALOG_DIR points at another catalog folder (tests).`;

// The real thing: the socket of the app using this catalog folder.
export function socketCall(env: NodeJS.ProcessEnv = process.env): Call {
  const socket = findSocket(defaultCatalogDir(env));
  return (cmd, args = {}) => callControl(socket, cmd, args);
}

export const rowState = (g: GameRow): string =>
  g.active ? 'playing' : g.blocked ? 'blocked' : g.update ? `update ${g.update}` : g.installed ? 'installed' : 'available';

// The app's Games window lists only approved games unless "Show developer and unapproved games" is on; the CLI lists
// everything and says which ones the window hides, and why.
export const rowNote = (g: GameRow): string =>
  !g.unapproved ? '' : g.hidden ? `hidden in the app: ${g.unapproved}` : `not approved: ${g.unapproved}`;

export function table(rows: GameRow[]): string {
  const cells = [['ID', 'NAME', 'VERSION', 'TIER', 'STATE', 'NOTE'], ...rows.map((g) => [g.id, g.name, g.version, g.tier, rowState(g), rowNote(g)])];
  const w = cells[0].map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  return cells.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]))).join('  ').trimEnd()).join('\n');
}

export const describeRequest = (r: PendingRequest): string =>
  `${{ install: 'Install', update: 'Update', remove: 'Remove', 'add-local': 'Add' }[r.action]} ${r.name}${r.action === 'remove' ? '' : ' ' + r.version} (${r.from === 'agent' ? 'asked by an agent' : 'asked in the app'})`;

interface Status {
  active: string;
  catalog: { fetchedAt: string | null; games: number; error: string | null; signed: boolean };
  games: GameRow[]; pending: PendingRequest[];
}

export function statusText(s: Status): string {
  const playing = s.games.find((g) => g.id === s.active);
  const c = s.catalog;
  const lines = [
    `Playing: ${playing ? `${playing.name} (${playing.id})` : s.active}`,
    `Catalog: ${c.error ? 'could not be read: ' + c.error : c.fetchedAt ? `${c.games} game${c.games === 1 ? '' : 's'}, signature verified, checked ${c.fetchedAt}` : 'not fetched yet (tokengames list --refresh)'}`,
  ];
  lines.push(s.pending.length ? 'Waiting for the player:\n' + s.pending.map((r) => '  ' + describeRequest(r)).join('\n') : 'Nothing is waiting for the player.');
  return lines.join('\n');
}

export async function runCli(argv: string[], io: Io): Promise<number> {
  const args = [...argv];
  const take = (f: string) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
  const json = take('--json'), refresh = take('--refresh');
  let dir: string | undefined;
  const di = args.indexOf('--dir');
  if (di >= 0) { dir = args[di + 1]; args.splice(di, 2); if (!dir) { io.err('--dir needs a folder'); return 2; } }
  const [cmd, id, ...extra] = args;
  const usage = (msg?: string) => { if (msg) io.err(msg); io.err(USAGE); return 2; };
  if (!cmd) return usage();
  if (['help', '--help', '-h'].includes(cmd)) { io.out(USAGE); return 0; }
  if (extra.length) return usage(`unexpected: ${extra.join(' ')}`);
  const needId = ['use', 'remove'].includes(cmd) || (cmd === 'install' && !dir);
  if (needId && !id) return usage(`${cmd} needs a game id (see tokengames list)`);
  if (!needId && id) return usage(`unexpected: ${id}`);

  try {
    switch (cmd) {
      case 'list': {
        if (refresh) {
          const r = (await io.call('refresh')) as { ok: boolean; error?: string };
          if (!r.ok) io.err(`The catalog could not be read: ${r.error}`);
        }
        const rows = (await io.call('list')) as GameRow[];
        io.out(json ? JSON.stringify(rows, null, 2) : table(rows));
        return 0;
      }
      case 'status': {
        const s = (await io.call('status')) as Status;
        io.out(json ? JSON.stringify(s, null, 2) : statusText(s));
        return 0;
      }
      case 'install':
      case 'remove': {
        const r = (await io.call(cmd, dir ? { dir: path.resolve(dir) } : { id })) as { requested: PendingRequest; message: string };
        io.out(json ? JSON.stringify(r.requested, null, 2) : r.message);
        return 0;
      }
      case 'use': {
        const r = (await io.call('use', { id })) as { active: string };
        io.out(json ? JSON.stringify(r) : `Now playing ${r.active}.`);
        return 0;
      }
      default:
        return usage(`unknown command: ${cmd}`);
    }
  } catch (e) {
    const msg = (e as Error).message;
    io.err(msg);
    return /not running/.test(msg) ? 3 : 1;
  }
}
