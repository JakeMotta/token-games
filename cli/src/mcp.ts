// token-games-mcp: the control socket as an MCP server (JSON-RPC 2.0, one message per line on stdin and stdout), so
// an agent such as Claude Code or Cursor can see the games and ask for changes. Like the CLI it can only ask:
// installs and removals wait for the player to approve them in the app, and no tool approves anything.
import path from 'node:path';
import type { GameRow, PendingRequest } from '@token-games/shell/catalog/catalog';
import type { ControlCommand } from '@token-games/shell/catalog/control';
import { statusText, table, type Call } from './cli';

export const SERVER_VERSION = '0.1.0';
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']; // newest first

const id = { type: 'string', description: 'The game id, like token-garden (see list_games)', pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' };
const ASK = 'Nothing changes until the player approves it in the Token Games window; this tool cannot approve, and a request may be denied.';

export const TOOLS = [
  {
    name: 'list_games',
    description: 'Lists the Token Games games: the built-in one, installed ones and what the signed catalog offers, with which one is playing; NOTE marks games that are not approved (hidden in the app unless the player shows developer games).',
    inputSchema: { type: 'object', properties: { refresh: { type: 'boolean', description: 'Fetch the signed catalog first' } }, additionalProperties: false },
    annotations: { title: 'List games', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'game_status',
    description: 'What is playing in Token Games, the state of the catalog, and the requests waiting for the player.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Game status', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'install_game',
    description: `Asks the player to install (or update) a catalog game, or with "dir" to add a web game from a folder on this computer. ${ASK}`,
    inputSchema: { type: 'object', properties: { id, dir: { type: 'string', description: 'An absolute path to a local web game folder (instead of id)' } }, additionalProperties: false },
    annotations: { title: 'Ask to install a game', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'remove_game',
    description: `Asks the player to remove an installed game. Its save is kept. ${ASK}`,
    inputSchema: { type: 'object', properties: { id }, required: ['id'], additionalProperties: false },
    annotations: { title: 'Ask to remove a game', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'set_active_game',
    description: 'Switches Token Games to a game that is already installed (or back to the built-in one). Installs nothing.',
    inputSchema: { type: 'object', properties: { id }, required: ['id'], additionalProperties: false },
    annotations: { title: 'Switch game', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
] as const;

type Msg = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type Reply = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

export function mcpServer(call: Call) {
  async function runTool(name: string, a: Record<string, unknown>): Promise<ReturnType<typeof text>> {
    const req = async (cmd: ControlCommand, args: Record<string, unknown>) => {
      const r = (await call(cmd, args)) as { requested: PendingRequest; message: string };
      return text(`${r.message}\nRequest ${r.requested.requestId}: ${r.requested.action} ${r.requested.id} ${r.requested.version}.`);
    };
    switch (name) {
      case 'list_games': {
        let note = '';
        if (a.refresh === true) { const r = (await call('refresh')) as { ok: boolean; error?: string }; if (!r.ok) note = `The catalog could not be read: ${r.error}\n`; }
        return text(note + table((await call('list')) as GameRow[]));
      }
      case 'game_status': return text(statusText((await call('status')) as Parameters<typeof statusText>[0]));
      case 'install_game':
        if (typeof a.dir === 'string' && a.id === undefined) {
          if (!path.isAbsolute(a.dir)) return text('dir must be an absolute path', true);
          return req('install', { dir: a.dir });
        }
        if (typeof a.id !== 'string' || a.dir !== undefined) return text('give either id or dir', true);
        return req('install', { id: a.id });
      case 'remove_game': return req('remove', { id: a.id });
      case 'set_active_game': return text(`Now playing ${((await call('use', { id: a.id })) as { active: string }).active}.`);
      default: throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
    }
  }

  // One JSON-RPC message in; the reply out, or null for a notification.
  async function handle(m: Msg): Promise<Reply | null> {
    const rid = typeof m?.id === 'string' || typeof m?.id === 'number' ? m.id : null;
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return { jsonrpc: '2.0', id: rid, error: { code: -32600, message: 'not a JSON-RPC 2.0 request' } };
    if (m.id === undefined) return null; // a notification (notifications/initialized, cancelled, …): nothing to answer
    const ok = (result: unknown): Reply => ({ jsonrpc: '2.0', id: rid, result });
    const fail = (code: number, message: string): Reply => ({ jsonrpc: '2.0', id: rid, error: { code, message } });
    const p = (m.params && typeof m.params === 'object' ? m.params : {}) as Record<string, unknown>;
    switch (m.method) {
      case 'initialize': {
        const asked = typeof p.protocolVersion === 'string' ? p.protocolVersion : '';
        return ok({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'token-games-mcp', version: SERVER_VERSION },
          instructions: 'Token Games runs idle games in a corner of the screen. These tools can see the games and switch between installed ones. '
            + 'Installing and removing only ask the player: tell them to approve it in the Token Games window, and never claim it is installed until list_games says so.',
        });
      }
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: TOOLS });
      case 'tools/call': {
        if (typeof p.name !== 'string') return fail(-32602, 'tools/call needs a tool name');
        const a = (p.arguments && typeof p.arguments === 'object' && !Array.isArray(p.arguments) ? p.arguments : {}) as Record<string, unknown>;
        try { return ok(await runTool(p.name, a)); } catch (e) {
          const err = e as Error & { code?: number };
          if (err.code === -32602) return fail(-32602, err.message);
          return ok(text(err.message, true)); // the app said no (not running, not installed, …): the agent sees why
        }
      }
      default: return fail(-32601, `unknown method: ${m.method}`);
    }
  }

  // A line from stdin: parse it (or answer a parse error) and handle it.
  async function line(s: string): Promise<Reply | null> {
    if (!s.trim()) return null;
    let m: Msg;
    try { m = JSON.parse(s); } catch { return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } }; }
    return handle(m);
  }

  return { handle, line };
}
