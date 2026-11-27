// tg-registry: packing is reproducible and refuses programs, CI's rebuild-and-compare catches a changed source or
// zip, the index honours the blocklist, signatures catch tampering, and a key is never written into a git checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Pointer } from '@token-games/shell/catalog/registry';
import { generateKeyPair, sha256 } from '@token-games/shell/catalog/signing';
import { buildIndexFrom, indexBytes, insideGit, keygen, pack, readPointers, signIndex, verifyIndex, verifyPointer } from '../src/registry-tool';

const repo = path.join(__dirname, '..', '..', '..'); // cli/dist/test → the repo
const sample = path.join(repo, 'samples', 'token-garden');
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `tg-reg-${tag}-`));
const copyDir = (from: string) => { const d = tmp('src'); fs.cpSync(from, path.join(d, 'game'), { recursive: true }); return d; };

function pointerFor(sha: string, over: Partial<Pointer> = {}): Pointer {
  return { id: 'token-garden', tier: 'verified', repository: 'JakeMotta/token-games', path: 'game', commit: 'b'.repeat(40), tag: 'token-garden-v0.1.0',
    bundle: { url: 'https://github.com/JakeMotta/token-games/releases/download/token-garden-v0.1.0/token-garden-0.1.0.zip', sha256: sha }, ...over };
}

test('pack makes the same bytes every time, and refuses programs', () => {
  const a = pack(sample, tmp('a')), b = pack(sample, tmp('b'));
  assert.equal(a.sha256, b.sha256, 'reproducible');
  assert.equal(path.basename(a.file), 'token-garden-0.1.0.zip');
  assert.equal(a.sha256, sha256(fs.readFileSync(a.file)));

  for (const [name, data] of [['tool.sh', 'echo hi'], ['helper.dll', 'x'], ['data.bin', Buffer.from([0x4d, 0x5a, 0x90, 0])], ['run.txt', '#!/bin/sh\nrm -rf ~']] as const) {
    const src = copyDir(sample);
    fs.writeFileSync(path.join(src, 'game', name), data);
    assert.throws(() => pack(path.join(src, 'game'), tmp('x')), /not allowed/, name);
  }
});

test('verify-pointer rebuilds from the pinned source and compares sha256 with the pointer and the released zip', () => {
  const src = copyDir(sample);
  const built = pack(path.join(src, 'game'), tmp('rel'));
  const zip = fs.readFileSync(built.file);
  assert.deepEqual(verifyPointer(pointerFor(built.sha256), src, zip), { ok: true, errors: [] });

  const changedSource = copyDir(sample);
  fs.appendFileSync(path.join(changedSource, 'game', 'game.js'), '\n// changed after release\n');
  const r1 = verifyPointer(pointerFor(built.sha256), changedSource);
  assert.equal(r1.ok, false);
  assert.match(r1.errors[0], /rebuilt from JakeMotta\/token-games@bbbbbbbbbbbb has sha256/);

  const tampered = Buffer.from(zip); tampered[tampered.length - 30] ^= 1;
  assert.match(verifyPointer(pointerFor(built.sha256), src, tampered).errors.join(), /released zip has sha256/);
  assert.match(verifyPointer(pointerFor(built.sha256, { id: 'other-game' }), src).errors.join(), /says id "token-garden"/);
  assert.match(verifyPointer(pointerFor('z'), src).errors.join(), /sha256 must be/);
});

test('build-index lists each pointer from its bundle, leaves blocked ones out, and refuses a wrong sha256', async () => {
  const reg = tmp('registry'), bundles = tmp('bundles');
  const built = pack(sample, tmp('p'));
  fs.copyFileSync(built.file, path.join(bundles, 'token-garden.zip'));
  fs.mkdirSync(path.join(reg, 'games'));
  fs.writeFileSync(path.join(reg, 'games', 'token-garden.json'), JSON.stringify(pointerFor(built.sha256, { path: 'samples/token-garden' })));
  fs.writeFileSync(path.join(reg, 'blocklist.json'), '[]');

  const idx = await buildIndexFrom(reg, bundles, '2026-01-01T00:00:00.000Z');
  assert.equal(idx.games.length, 1);
  assert.deepEqual([idx.games[0].id, idx.games[0].version, idx.games[0].tier, idx.games[0].bundle.size], ['token-garden', '0.1.0', 'verified', built.size]);
  assert.equal(idx.games[0].repository, 'https://github.com/JakeMotta/token-games');

  fs.writeFileSync(path.join(reg, 'blocklist.json'), JSON.stringify([{ id: 'token-garden', versions: ['0.1.0'], reason: 'test' }]));
  const blocked = await buildIndexFrom(reg, bundles);
  assert.deepEqual([blocked.games.length, blocked.blocklist.length], [0, 1]);

  fs.writeFileSync(path.join(reg, 'games', 'token-garden.json'), JSON.stringify(pointerFor('c'.repeat(64))));
  await assert.rejects(buildIndexFrom(reg, bundles), /sha256 does not match/);
});

test('check: the repo\'s own registry folder is valid, and a bad pointer is caught', () => {
  assert.deepEqual(readPointers(path.join(repo, 'registry')).errors, []);
  const reg = tmp('bad');
  fs.mkdirSync(path.join(reg, 'games'));
  fs.writeFileSync(path.join(reg, 'games', 'my-game.json'), JSON.stringify(pointerFor('a'.repeat(64))));
  fs.writeFileSync(path.join(reg, 'games', 'notes.txt'), 'hi');
  fs.writeFileSync(path.join(reg, 'blocklist.json'), JSON.stringify([{ id: 'x' }]));
  const e = readPointers(reg).errors.join('\n');
  assert.match(e, /must match the file name "my-game.json"/);
  assert.match(e, /only <id>.json pointer files/);
  assert.match(e, /blocklist\.json: .*needs an id and a reason/);
});

test('sign and verify: the exact bytes, by a trusted key', () => {
  const k = generateKeyPair(), other = generateKeyPair();
  const dir = tmp('sign');
  const file = path.join(dir, 'index.json');
  fs.writeFileSync(file, indexBytes({ indexVersion: 1, generated: '2026-01-01T00:00:00.000Z', games: [], blocklist: [] }));
  signIndex(file, k.privateKeyPem);
  assert.deepEqual(verifyIndex(file, [k.publicKey]), { ok: true, games: 0 });
  assert.match(verifyIndex(file, [other.publicKey]).error!, /signature does not match/);
  assert.match(verifyIndex(file, []).error!, /no public key/);
  fs.appendFileSync(file, ' ');
  assert.match(verifyIndex(file, [k.publicKey]).error!, /signature does not match/, 'one added space is caught');
  fs.writeFileSync(file, '{"indexVersion":2}');
  assert.throws(() => signIndex(file, k.privateKeyPem), /not a valid index/, 'never signs a broken index');
});

test('keygen never writes a key into a git checkout and never overwrites one', () => {
  assert.equal(insideGit(repo), true);
  assert.throws(() => keygen(path.join(repo, 'registry', 'signing-key.pem')), /inside a git checkout/);
  assert.equal(fs.existsSync(path.join(repo, 'registry', 'signing-key.pem')), false);
  const dir = tmp('key');
  if (insideGit(dir)) return; // an unusual temp folder; nothing more to check here
  const k = keygen(path.join(dir, 'key.pem'));
  assert.equal(Buffer.from(k.publicKey, 'base64').length, 32);
  if (process.platform !== 'win32') assert.equal(fs.statSync(k.file).mode & 0o777, 0o600);
  assert.throws(() => keygen(k.file), /EEXIST/);
});
