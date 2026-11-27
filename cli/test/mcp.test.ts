// token-games-mcp: the MCP handshake, the five tools, and that install and remove only ask. The last test runs the
// built server as a child process over stdio, the way Claude Code or Cursor start it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { socketCall } from '../src/cli';
import { mcpServer, PROTOCOL_VERSIONS, TOOLS } from '../src/mcp';
import { runningApp } from './helpers';

const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: '2.0', id, method, params });
const textOf = (r: any): string => r.result.content.map((c: { text: string }) => c.text).join('\n');

test('initialize, tools/list, and the protocol errors', async () => {
  const s = mcpServer(async () => { throw new Error('unused'); });
  const init: any = await s.handle(rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } }));
  assert.equal(init.result.protocolVersion, '2025-03-26', 'a version we speak is kept');
  assert.equal(init.result.serverInfo.name, 'token-games-mcp');
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  assert.match(init.result.instructions, /approve it in the Token Games window/);
  assert.equal(((await s.handle(rpc(2, 'initialize', { protocolVersion: '1999-01-01' }))) as any).result.protocolVersion, PROTOCOL_VERSIONS[0]);
  assert.equal(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'notifications get no reply');
  assert.deepEqual(((await s.handle(rpc(3, 'ping'))) as any).result, {});

  const list: any = await s.handle(rpc(4, 'tools/list'));
  assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ['list_games', 'game_status', 'install_game', 'remove_game', 'set_active_game']);
  for (const t of TOOLS) assert.equal(t.inputSchema.type, 'object');
  for (const n of ['install_game', 'remove_game']) assert.match(TOOLS.find((t) => t.name === n)!.description, /cannot approve/);
  assert.ok(!list.result.tools.some((t: { name: string }) => /approve/.test(t.name)), 'no tool approves');

  assert.equal(((await s.handle(rpc(5, 'resources/list'))) as any).error.code, -32601);
  assert.equal(((await s.handle(rpc(6, 'tools/call', { name: 'approve_install', arguments: {} }))) as any).error.code, -32602);
  assert.equal(((await s.line('{nope')) as any).error.code, -32700);
  assert.equal(((await s.handle({ id: 7, method: 'ping' } as never)) as any).error.code, -32600, 'jsonrpc 2.0 only');
});

test('the tools against a real catalog: list, ask to install, switch after approval, ask to remove', async () => {
  const app = await runningApp();
  try {
    const s = mcpServer(socketCall({ TG_CATALOG_DIR: app.dir }));
    const call = (name: string, args: Record<string, unknown> = {}) => s.handle(rpc(1, 'tools/call', { name, arguments: args }));

    let r: any = await call('list_games', { refresh: true });
    assert.match(textOf(r), /token-garden\s+Token Garden\s+0\.1\.0\s+verified\s+available/);
    r = await call('install_game', { id: 'token-garden' });
    assert.equal(r.result.isError, undefined);
    assert.match(textOf(r), /Nothing changes until they do/);
    assert.equal(app.catalog.requests()[0].from, 'agent');
    assert.equal(fs.existsSync(path.join(app.catalog.gamesDir, 'token-garden')), false, 'an agent cannot install');
    assert.match(textOf(await call('game_status')), /Install Token Garden 0\.1\.0 \(asked by an agent\)/);

    r = await call('set_active_game', { id: 'token-garden' });
    assert.equal(r.result.isError, true);
    assert.match(textOf(r), /not installed/);
    app.catalog.approve(app.catalog.requests()[0].requestId); // the player, in the app
    assert.match(textOf(await call('set_active_game', { id: 'token-garden' })), /Now playing token-garden/);
    assert.equal(app.catalog.active(), 'token-garden');

    r = await call('remove_game', { id: 'token-garden' });
    assert.match(textOf(r), /approve removing Token Garden/);
    assert.ok(fs.existsSync(path.join(app.catalog.gamesDir, 'token-garden')), 'an agent cannot remove');

    assert.equal(((await call('install_game', { id: 'token-garden', dir: '/x' })) as any).result.isError, true, 'id or dir, not both');
    assert.equal(((await call('install_game', { dir: 'relative/path' })) as any).result.isError, true);
    assert.equal(((await call('remove_game', {})) as any).result.isError, true);
  } finally { await app.close(); }
});

test('the built server speaks MCP over stdio', async () => {
  const app = await runningApp();
  const bin = path.join(__dirname, '..', 'token-games-mcp.js');
  const child = spawn(process.execPath, [bin], { env: { ...process.env, TG_CATALOG_DIR: app.dir }, stdio: ['pipe', 'pipe', 'inherit'] });
  try {
    const replies: any[] = [];
    let buf = '';
    child.stdout.setEncoding('utf8');
    const got = new Promise<void>((resolve) => child.stdout.on('data', (c: string) => {
      buf += c;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) { replies.push(JSON.parse(buf.slice(0, nl))); buf = buf.slice(nl + 1); }
      if (replies.length >= 3) resolve();
    }));
    child.stdin.write([
      rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      rpc(2, 'tools/list'),
      rpc(3, 'tools/call', { name: 'game_status', arguments: {} }),
    ].map((m) => JSON.stringify(m)).join('\n') + '\n');
    await got;
    assert.deepEqual(replies.map((r) => r.id), [1, 2, 3], 'answers in order, none for the notification');
    assert.equal(replies[1].result.tools.length, 5);
    assert.match(replies[2].result.content[0].text, /Playing: Ant Farm/);
  } finally { child.kill(); await app.close(); }
});
