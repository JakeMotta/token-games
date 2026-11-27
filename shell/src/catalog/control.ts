// The local control socket: how the `tokengames` CLI and the `token-games-mcp` server talk to the running app.
// One JSON object per line each way: { id, cmd, args } in, { id, ok, result | error } out. It listens on a Unix
// socket only the user can open (a named pipe on Windows), never on a network port. The commands it accepts can
// list, ask for installs and removals, and switch games; approving an install or removal is not one of them.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const CONTROL_COMMANDS = ['ping', 'list', 'status', 'refresh', 'install', 'remove', 'use'] as const;
export type ControlCommand = (typeof CONTROL_COMMANDS)[number];
export interface ControlRequest { id: number; cmd: ControlCommand; args?: Record<string, unknown> }
export interface ControlResponse { id: number; ok: boolean; result?: unknown; error?: string }
export type ControlHandler = (cmd: ControlCommand, args: Record<string, unknown>) => Promise<unknown>;

const MAX_LINE = 64 * 1024;

// The socket's path. Unix socket paths are short (about 104 bytes on macOS), so a long catalog folder falls back
// to a per-folder name in the temp folder. control.json in the catalog folder says where it is.
export function socketPathFor(catalogDir: string): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\token-games-${crypto.createHash('sha256').update(catalogDir).digest('hex').slice(0, 16)}`;
  const p = path.join(catalogDir, 'control.sock');
  if (Buffer.byteLength(p) <= 100) return p;
  return path.join(os.tmpdir(), `token-games-${crypto.createHash('sha256').update(catalogDir).digest('hex').slice(0, 16)}.sock`);
}

export const controlInfoPath = (catalogDir: string): string => path.join(catalogDir, 'control.json');

export interface ControlServer { socket: string; close(): Promise<void> }

export async function serveControl(catalogDir: string, handle: ControlHandler): Promise<ControlServer> {
  const socket = socketPathFor(catalogDir);
  if (process.platform !== 'win32') { try { fs.unlinkSync(socket); } catch { /* none left over */ } }
  const server = net.createServer((conn) => {
    let buf = '';
    conn.setEncoding('utf8');
    conn.on('error', () => conn.destroy());
    conn.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > MAX_LINE && !buf.includes('\n')) { conn.end(JSON.stringify({ id: 0, ok: false, error: 'request too large' }) + '\n'); return; }
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (line.trim()) void answer(line).then((r) => { if (!conn.destroyed) conn.write(JSON.stringify(r) + '\n'); });
      }
    });
  });
  const answer = async (line: string): Promise<ControlResponse> => {
    let req: ControlRequest;
    try { req = JSON.parse(line); } catch { return { id: 0, ok: false, error: 'not JSON' }; }
    const id = typeof req?.id === 'number' ? req.id : 0;
    if (!(CONTROL_COMMANDS as readonly unknown[]).includes(req?.cmd)) return { id, ok: false, error: `unknown command (known: ${CONTROL_COMMANDS.join(', ')})` };
    const args = req.args && typeof req.args === 'object' && !Array.isArray(req.args) ? req.args : {};
    try { return { id, ok: true, result: await handle(req.cmd, args) }; } catch (e) { return { id, ok: false, error: (e as Error).message }; }
  };
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => { server.off('error', reject); resolve(); }); });
  if (process.platform !== 'win32') fs.chmodSync(socket, 0o600);
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.writeFileSync(controlInfoPath(catalogDir), JSON.stringify({ socket, pid: process.pid }) + '\n', { mode: 0o600 });
  return {
    socket,
    close: () => new Promise<void>((resolve) => {
      try { const info = JSON.parse(fs.readFileSync(controlInfoPath(catalogDir), 'utf8')); if (info.pid === process.pid) fs.unlinkSync(controlInfoPath(catalogDir)); } catch { /* gone */ }
      server.close(() => resolve());
      if (process.platform !== 'win32') { try { fs.unlinkSync(socket); } catch { /* gone */ } }
    }),
  };
}

// Sends one command and waits for its answer.
export function callControl(socket: string, cmd: ControlCommand, args: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socket);
    let buf = '';
    const timer = setTimeout(() => { conn.destroy(); reject(new Error('the app did not answer in time')); }, timeoutMs);
    conn.setEncoding('utf8');
    conn.on('connect', () => conn.write(JSON.stringify({ id: 1, cmd, args }) + '\n'));
    conn.on('data', (c: string) => {
      buf += c;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      conn.end();
      let r: ControlResponse;
      try { r = JSON.parse(buf.slice(0, nl)); } catch { reject(new Error('the app sent something that is not JSON')); return; }
      if (r.ok) resolve(r.result); else reject(new Error(r.error || 'failed'));
    });
    conn.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? 'Token Games is not running (start a game first)' : e.message));
    });
  });
}

// Finds the running app's socket from a catalog folder.
export function findSocket(catalogDir: string): string {
  try {
    const info = JSON.parse(fs.readFileSync(controlInfoPath(catalogDir), 'utf8'));
    if (typeof info.socket === 'string') return info.socket;
  } catch { /* not running */ }
  return socketPathFor(catalogDir);
}

// The default catalog folder, the same one the app uses (catalog-host.ts): TG_CATALOG_DIR, else the user's app data.
export function defaultCatalogDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TG_CATALOG_DIR) return path.resolve(env.TG_CATALOG_DIR);
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Token Games');
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Token Games');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Token Games');
}
