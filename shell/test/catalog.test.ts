// The catalog on this computer: fetching the signed index, requests that wait for the player, installs, updates,
// removal, the active game, which games are approved, the developer switch, the blocklist, and the control socket the CLI and agents use.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Catalog, MAX_PENDING, notApproved, type CatalogOptions } from '../src/catalog/catalog';
import { catalogCommands } from '../src/catalog/commands';
import { callControl, CONTROL_COMMANDS, findSocket, serveControl, socketPathFor } from '../src/catalog/control';
import { generateKeyPair } from '../src/catalog/signing';
import { testRegistry, tmpDir, webGame } from './catalog-fixtures';

const builtIn = { id: 'ant-farm', name: 'Ant Farm', description: 'Ants.', version: '1.0.0' };
const open = (reg: { url: string; publicKey: string }, over: Partial<CatalogOptions> = {}) =>
  new Catalog({ dir: tmpDir('home'), hostApp: 'ant-farm', builtIn, trustedKeys: [reg.publicKey], registryUrl: reg.url, ...over });

test('nothing is listed until the catalog is fetched, and fetching needs a valid signature', async () => {
  const reg = testRegistry([{}]);
  const c = open(reg);
  assert.deepEqual(c.list().map((r) => r.id), ['ant-farm'], 'the built-in game only; nothing is fetched at start');
  assert.deepEqual(await c.refresh(), { ok: true, games: 1 });
  assert.deepEqual(c.list().map((r) => [r.id, r.tier, r.installed]), [['ant-farm', 'built-in', true], ['token-garden', 'verified', false]]);

  const other = open(reg, { trustedKeys: [generateKeyPair().publicKey] });
  assert.match((await other.refresh()).error!, /signature is not valid/);
  const keyless = open(reg, { trustedKeys: [] });
  assert.match((await keyless.refresh()).error!, /no catalog signing key/);
  fs.appendFileSync(path.join(reg.dir, 'index.json'), ' ');
  assert.match((await open(reg).refresh()).error!, /signature is not valid/, 'a tampered index');
});

test('an install waits for the player, then installs; the game can then be used', async () => {
  const reg = testRegistry([{ network: ['api.example.com'] }]);
  const c = open(reg);
  await c.refresh();
  const r = await c.request('install', 'token-garden', 'agent');
  assert.equal(r.from, 'agent');
  assert.ok(r.sheet.some((l) => /api\.example\.com/.test(l.text)));
  assert.equal(c.list().find((g) => g.id === 'token-garden')!.installed, false, 'nothing installed yet');
  assert.deepEqual((await c.request('install', 'token-garden', 'agent')).requestId, r.requestId, 'asking twice is one request');
  c.approve(r.requestId);
  assert.ok(fs.existsSync(path.join(c.gamesDir, 'token-garden', 'index.html')));
  assert.deepEqual(c.approvedHosts('token-garden'), ['api.example.com']);
  assert.equal(c.active(), 'ant-farm', 'installing does not switch');
  c.setActive('token-garden');
  assert.equal(c.active(), 'token-garden');
  assert.equal(open(reg, { dir: path.dirname(c.gamesDir) }).active(), 'token-garden', 'remembered across restarts');
  assert.throws(() => c.approve(r.requestId), /no longer waiting/);
});

test('a denied request changes nothing', async () => {
  const reg = testRegistry([{}]);
  const c = open(reg);
  await c.refresh();
  const r = await c.request('install', 'token-garden');
  assert.ok(c.deny(r.requestId));
  assert.deepEqual(c.requests(), []);
  assert.ok(!fs.existsSync(path.join(c.gamesDir, 'token-garden')));
});

test('a bundle whose sha256 does not match the index is refused before anything is written', async () => {
  const reg = testRegistry([{ sha: 'e'.repeat(64) }]);
  const c = open(reg);
  await c.refresh();
  await assert.rejects(c.request('install', 'token-garden'), /sha256 does not match/);
  assert.deepEqual(fs.readdirSync(c.gamesDir), []);
});

test('updates go through the sheet, keep the save, and never downgrade', async () => {
  const reg = testRegistry([{}]);
  const c = open(reg);
  await c.refresh();
  c.approve((await c.request('install', 'token-garden')).requestId);
  fs.mkdirSync(c.saveDir('token-garden'), { recursive: true });
  fs.writeFileSync(path.join(c.saveDir('token-garden'), 'save.json'), '{"flowers":3}');
  await assert.rejects(c.request('install', 'token-garden'), /nothing newer/);

  reg.republish([{ version: '0.2.0', network: ['api.example.com'] }]);
  await c.refresh();
  assert.equal(c.list().find((g) => g.id === 'token-garden')!.update, '0.2.0');
  const u = await c.request('install', 'token-garden');
  assert.equal(u.action, 'update');
  assert.ok(u.sheet.some((l) => /new in this version/.test(l.text)));
  c.approve(u.requestId);
  assert.equal(c.list().find((g) => g.id === 'token-garden')!.version, '0.2.0');
  assert.equal(fs.readFileSync(path.join(c.saveDir('token-garden'), 'save.json'), 'utf8'), '{"flowers":3}');

  reg.republish([{ version: '0.1.5' }]);
  await c.refresh();
  assert.equal(c.list().find((g) => g.id === 'token-garden')!.update, undefined);
  await assert.rejects(c.request('install', 'token-garden'), /nothing newer/);
});

test('remove waits for approval, deletes the files, keeps the save and falls back to the built-in game', async () => {
  const reg = testRegistry([{}]);
  const c = open(reg);
  await c.refresh();
  c.approve((await c.request('install', 'token-garden')).requestId);
  c.setActive('token-garden');
  fs.mkdirSync(c.saveDir('token-garden'), { recursive: true });
  fs.writeFileSync(path.join(c.saveDir('token-garden'), 'save.json'), '{}');
  const r = await c.request('remove', 'token-garden', 'agent');
  assert.ok(fs.existsSync(path.join(c.gamesDir, 'token-garden')), 'not removed until approved');
  c.approve(r.requestId);
  assert.ok(!fs.existsSync(path.join(c.gamesDir, 'token-garden')));
  assert.ok(fs.existsSync(path.join(c.saveDir('token-garden'), 'save.json')));
  assert.equal(c.active(), 'ant-farm');
  await assert.rejects(c.request('remove', 'ant-farm'), /built in/);
  await assert.rejects(c.request('remove', 'nope'), /not installed/);
  assert.throws(() => c.setActive('token-garden'), /not installed/);
});

test('only approved games show: community, test-catalog, blocked and built-in copies are hidden until developer games are on', async () => {
  const reg = testRegistry([{ id: 'wild-game', tier: 'community' }, { id: 'ant-farm-web' }, { id: 'token-garden' }, { id: 'bad-game' }],
    [{ id: 'bad-game', reason: 'it sends your data away' }]);
  const c = open(reg);
  await c.refresh();
  assert.equal(c.developer, false, 'off by default');
  assert.deepEqual(c.shown().map((g) => g.id), ['ant-farm', 'token-garden'], 'the built-in game and the approved one');
  const hidden = Object.fromEntries(c.list().filter((g) => g.hidden).map((g) => [g.id, g.unapproved]));
  assert.deepEqual(hidden, { 'wild-game': 'a community game, not reviewed', 'ant-farm-web': 'a copy of the built-in Ant Farm', 'bad-game': 'blocked' });
  await assert.rejects(c.request('install', 'wild-game'), /not an approved game \(a community game.*Show developer and unapproved games/);
  await assert.rejects(c.request('install', 'ant-farm-web'), /copy of the built-in Ant Farm/);
  await assert.rejects(c.request('add-local', tmpDir('local')), /Show developer and unapproved games/);

  c.setDeveloper(true);
  assert.equal(open(reg, { dir: path.dirname(c.gamesDir) }).developer, true, 'remembered across restarts');
  assert.deepEqual(c.shown().map((g) => g.id).sort(), ['ant-farm', 'ant-farm-web', 'bad-game', 'token-garden', 'wild-game']);
  assert.equal(c.shown().find((g) => g.id === 'wild-game')!.unapproved, 'a community game, not reviewed', 'still marked');
  const r = await c.request('install', 'wild-game');
  assert.ok(r.sheet.some((l) => /not reviewed/.test(l.text)));
  const w = await c.request('install', 'ant-farm-web');
  c.setDeveloper(false);
  c.approve(r.requestId); c.approve(w.requestId);
  assert.ok(c.gameDir('wild-game'), 'an approval still goes through after the switch is turned off');

  reg.republish([{ id: 'wild-game', tier: 'community', version: '0.2.0' }, { id: 'ant-farm-web', version: '0.2.0' }, { id: 'token-garden' }]);
  await c.refresh();
  const shown = c.shown();
  assert.deepEqual(shown.map((g) => g.id).sort(), ['ant-farm', 'ant-farm-web', 'token-garden', 'wild-game'], 'installed ones stay, so they can be removed');
  assert.ok(shown.every((g) => g.update === undefined), 'no update offers for unapproved games while the switch is off');
  c.setDeveloper(true);
  assert.equal(c.shown().find((g) => g.id === 'wild-game')!.update, '0.2.0');
});

test('a duplicate is a game named ant-farm-web or one whose pointer says duplicates', () => {
  const b = { id: 'ant-farm', name: 'Ant Farm', description: '', version: '1.0.0' };
  const ok = { builtIn: b, approvedIndex: true };
  assert.equal(notApproved({ id: 'ant-farm', tier: 'built-in' }, ok), '');
  assert.equal(notApproved({ id: 'token-garden', tier: 'verified' }, ok), '');
  assert.equal(notApproved({ id: 'ant-farm-web', tier: 'verified' }, ok), 'a copy of the built-in Ant Farm');
  assert.equal(notApproved({ id: 'farm-two', tier: 'verified', duplicates: 'ant-farm' }, ok), 'a copy of the built-in Ant Farm');
  assert.equal(notApproved({ id: 'farm-two', tier: 'verified', duplicates: 'other' }, ok), '');
  assert.equal(notApproved({ id: 'my-game', tier: 'local' }, ok), 'a local folder');
  assert.equal(notApproved({ id: 'token-garden', tier: 'verified', blocked: 'bad' }, ok), 'blocked');
  assert.equal(notApproved({ id: 'token-garden', tier: 'community' }, ok), 'a community game, not reviewed');
  assert.equal(notApproved({ id: 'token-garden', tier: 'verified' }, { builtIn: b, approvedIndex: false }), 'from a developer or test catalog');
});

test('Ink Tower Defense from the catalog is approved beside the Ant Farm, and a copy only in its own app', () => {
  const td = { id: 'tower-defense-web', tier: 'verified' as const };
  assert.equal(notApproved(td, { builtIn: { id: 'ant-farm', name: 'Ant Farm', description: '', version: '1.0.0' }, approvedIndex: true }), '');
  assert.equal(notApproved(td, { builtIn: { id: 'tower-defense', name: 'Ink Tower Defense', description: '', version: '0.1.0' }, approvedIndex: true }),
    'a copy of the built-in Ink Tower Defense');
});

test('games from an index signed only by a developer key are trusted but not approved', async () => {
  const reg = testRegistry([{}]);
  const c = open(reg, { approvedKeys: [generateKeyPair().publicKey] });
  assert.deepEqual(await c.refresh(), { ok: true, games: 1 });
  assert.deepEqual(c.shown().map((g) => g.id), ['ant-farm']);
  assert.equal(c.list().find((g) => g.id === 'token-garden')!.unapproved, 'from a developer or test catalog');
  await assert.rejects(c.request('install', 'token-garden'), /developer or test catalog/);
  c.setDeveloper(true);
  assert.equal((await c.request('install', 'token-garden')).action, 'install');
});

test('the blocklist stops installs and switches off a game already installed', async () => {
  const reg = testRegistry([{}]);
  const c = open(reg);
  await c.refresh();
  c.approve((await c.request('install', 'token-garden')).requestId);
  c.setActive('token-garden');
  reg.republish([{}], [{ id: 'token-garden', versions: ['0.1.0'], reason: 'it sends your data away' }]);
  await c.refresh();
  const row = c.list().find((g) => g.id === 'token-garden')!;
  assert.equal(row.blocked, 'it sends your data away');
  assert.equal(c.active(), 'ant-farm');
  assert.equal(c.gameDir('token-garden'), null, 'a blocked game is not served');
  assert.throws(() => c.setActive('token-garden'), /blocked/);

  const fresh = open(reg);
  await fresh.refresh();
  await assert.rejects(fresh.request('install', 'token-garden'), /blocked/);
});

test('a game for a newer shell is listed but cannot be installed', async () => {
  const reg = testRegistry([{ minShellVersion: '99.0.0' }]);
  const c = open(reg);
  await c.refresh();
  assert.match(c.list().find((g) => g.id === 'token-garden')!.blocked!, /newer Token Games/);
  await assert.rejects(c.request('install', 'token-garden'), /needs shell 99/);
});

test('a local folder is added after approval and served from where it is', async () => {
  const reg = testRegistry([]);
  const c = open(reg);
  c.setDeveloper(true);
  const dir = tmpDir('local');
  for (const f of webGame({ id: 'my-game' })) fs.writeFileSync(path.join(dir, f.path), f.data);
  const r = await c.request('add-local', dir);
  assert.equal(r.tier, 'local');
  c.approve(r.requestId);
  assert.equal(c.gameDir('my-game'), dir);
  assert.equal(c.list().find((g) => g.id === 'my-game')!.tier, 'local');
  c.setDeveloper(false);
  assert.equal(c.shown().find((g) => g.id === 'my-game')!.unapproved, 'a local folder', 'still shown, so it can be removed');
  c.setDeveloper(true);
  const bad = tmpDir('local');
  fs.writeFileSync(path.join(bad, 'game.json'), '{}');
  await assert.rejects(c.request('add-local', bad), /not a web game/);
});

test('at most a few requests wait at once, so an agent cannot flood the player', async () => {
  const reg = testRegistry(Array.from({ length: MAX_PENDING + 1 }, (_, i) => ({ id: `game-${i}` })));
  const c = open(reg);
  await c.refresh();
  for (let i = 0; i < MAX_PENDING; i++) await c.request('install', `game-${i}`, 'agent');
  await assert.rejects(c.request('install', `game-${MAX_PENDING}`, 'agent'), /already 5 requests/);
});

test('the control socket offers no way to approve, and its commands only ask', async () => {
  assert.ok(!(CONTROL_COMMANDS as readonly string[]).some((c) => /approve|allow|confirm|grant/.test(c)));
  const reg = testRegistry([{}]);
  const c = open(reg);
  const dir = tmpDir('ctl');
  const asked: string[] = [];
  const srv = await serveControl(dir, catalogCommands(c, (r) => asked.push(r.id)));
  try {
    const sock = findSocket(dir);
    assert.equal(sock, srv.socket);
    if (process.platform !== 'win32') assert.equal(fs.statSync(sock).mode & 0o777, 0o600, 'only this user can connect');
    assert.deepEqual(await callControl(sock, 'ping'), { app: 'token-games', shell: '1.3.0' });
    assert.equal(((await callControl(sock, 'refresh')) as { ok: boolean }).ok, true);
    const res = (await callControl(sock, 'install', { id: 'token-garden' })) as { requested: { from: string }; message: string };
    assert.equal(res.requested.from, 'agent');
    assert.match(res.message, /Nothing changes until they do/);
    assert.deepEqual(asked, ['token-garden']);
    assert.ok(!fs.existsSync(path.join(c.gamesDir, 'token-garden')));
    await assert.rejects(callControl(sock, 'use', { id: 'token-garden' }), /not installed/);
    await assert.rejects(callControl(sock, 'install', { id: '../etc' }), /give a game id/);
    await assert.rejects(callControl(sock, 'approve' as never, {}), /unknown command/);
    c.approve(c.requests()[0].requestId); // the player, in the app
    assert.deepEqual(await callControl(sock, 'use', { id: 'token-garden' }), { active: 'token-garden' });
    const st = (await callControl(sock, 'status')) as { active: string; pending: unknown[] };
    assert.equal(st.active, 'token-garden');
    assert.deepEqual(st.pending, []);
  } finally { await srv.close(); }
  await assert.rejects(callControl(srv.socket, 'ping'), /not running/);
});

test('a long catalog folder gets a short socket path', () => {
  const long = path.join(tmpDir('x'), 'a'.repeat(120));
  const p = socketPathFor(long);
  if (process.platform !== 'win32') assert.ok(Buffer.byteLength(p) <= 104, p);
});
