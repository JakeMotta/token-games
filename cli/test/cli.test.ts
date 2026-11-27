// tokengames against a real catalog over the real control socket: it lists, asks, switches, and can never approve.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { callControl } from '@token-games/shell/catalog/control';
import { runCli, socketCall, type Call } from '../src/cli';
import { capture, runningApp } from './helpers';

test('list, install (a request only), use after the player approves, and remove (a request only)', async () => {
  const app = await runningApp();
  try {
    const call = socketCall({ TG_CATALOG_DIR: app.dir });
    const run = async (...argv: string[]) => { const c = capture(); const code = await runCli(argv, { ...c.io, call }); return { code, out: c.out.join('\n'), err: c.err.join('\n') }; };

    let r = await run('list');
    assert.equal(r.code, 0);
    assert.match(r.out, /ant-farm\s+Ant Farm\s+1\.0\.0\s+built-in\s+playing/);
    assert.doesNotMatch(r.out, /token-garden/, 'nothing from the catalog until it is fetched');
    r = await run('list', '--refresh');
    assert.match(r.out, /token-garden\s+Token Garden\s+0\.1\.0\s+verified\s+available/);

    r = await run('install', 'token-garden');
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Asked the player to approve installing Token Garden.*Nothing changes until they do/);
    assert.equal(app.catalog.requests().length, 1);
    assert.equal(fs.existsSync(path.join(app.catalog.gamesDir, 'token-garden')), false, 'asking installs nothing');
    r = await run('status');
    assert.match(r.out, /Playing: Ant Farm \(ant-farm\)/);
    assert.match(r.out, /Install Token Garden 0\.1\.0 \(asked by an agent\)/);

    r = await run('use', 'token-garden');
    assert.equal(r.code, 1);
    assert.match(r.err, /not installed/);

    app.catalog.approve(app.catalog.requests()[0].requestId); // the player, in the app
    r = await run('use', 'token-garden');
    assert.equal(r.code, 0, r.err);
    assert.equal(app.catalog.active(), 'token-garden');
    r = await run('list', '--json');
    assert.equal(JSON.parse(r.out).find((g: { id: string }) => g.id === 'token-garden').active, true);

    r = await run('remove', 'token-garden');
    assert.match(r.out, /approve removing Token Garden/);
    assert.ok(fs.existsSync(path.join(app.catalog.gamesDir, 'token-garden')), 'asking removes nothing');
    r = await run('remove', 'ant-farm');
    assert.equal(r.code, 1);
    assert.match(r.err, /built in/);
  } finally { await app.close(); }
});

test('the socket has no approve command, whatever a client sends', async () => {
  const app = await runningApp();
  try {
    await app.catalog.refresh();
    await app.catalog.request('install', 'token-garden', 'agent');
    const sock = app.server.socket;
    for (const cmd of ['approve', 'deny', 'community', 'add-local']) await assert.rejects(callControl(sock, cmd as never, {}), /unknown command/);
    assert.equal(app.catalog.requests().length, 1, 'the request still waits');
  } finally { await app.close(); }
});

test('install --dir asks to add a local folder, as an absolute path', async () => {
  const calls: unknown[] = [];
  const call: Call = async (cmd, args) => { calls.push([cmd, args]); return { requested: { requestId: 'r' }, message: 'Asked.' }; };
  const c = capture();
  assert.equal(await runCli(['install', '--dir', 'some/game'], { ...c.io, call }), 0);
  assert.deepEqual(calls, [['install', { dir: path.resolve('some/game') }]]);
});

test('wrong usage exits 2 and shows the usage; a stopped app exits 3', async () => {
  const call: Call = async () => { throw new Error('Token Games is not running (start a game first)'); };
  for (const argv of [[], ['install'], ['use'], ['frobnicate'], ['list', 'extra'], ['use', 'a', 'b'], ['install', '--dir']]) {
    const c = capture();
    assert.equal(await runCli(argv, { ...c.io, call }), 2, argv.join(' '));
    assert.ok(c.err.join('\n').length > 0);
  }
  const c = capture();
  assert.equal(await runCli(['help'], { ...c.io, call }), 0);
  assert.match(c.out[0], /tokengames list/);
  const d = capture();
  assert.equal(await runCli(['status'], { ...d.io, call }), 3);
  const e = capture();
  assert.equal(await runCli(['status'], { ...e.io, call: socketCall({ TG_CATALOG_DIR: '/nonexistent/tg' }) }), 3, 'no app on that folder');
});
