// The signed catalog index: ed25519 signatures, tamper rejection, the index and pointer formats, the blocklist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, publicKeyFromRaw, rawFromPublicKey, sign, verify } from '../src/catalog/signing';
import { blockedBy, buildIndex, checkIndex, checkPointer, indexEntry, isBundleUrl, type IndexGame, type Pointer } from '../src/catalog/registry';
import { REGISTRY_KEYS } from '../src/catalog/keys';
import type { GameManifest } from '../src/manifest';

test('a signature verifies with its public key and no other', () => {
  const a = generateKeyPair(), b = generateKeyPair();
  const data = Buffer.from('{"indexVersion":1}');
  const sig = sign(data, a.privateKeyPem);
  assert.ok(verify(data, sig, [a.publicKey]));
  assert.ok(verify(data, sig, [b.publicKey, a.publicKey]), 'any trusted key will do, so keys can rotate');
  assert.ok(!verify(data, sig, [b.publicKey]));
  assert.ok(!verify(data, sig, []), 'no trusted keys, nothing verifies');
  assert.equal(rawFromPublicKey(publicKeyFromRaw(a.publicKey)), a.publicKey);
});

test('any change to the index or the signature is rejected', () => {
  const k = generateKeyPair();
  const data = Buffer.from(JSON.stringify({ games: [{ id: 'a', sha256: '0'.repeat(64) }] }));
  const sig = sign(data, k.privateKeyPem);
  const changed = Buffer.from(data); changed[changed.length - 5] ^= 1;
  assert.ok(!verify(changed, sig, [k.publicKey]));
  assert.ok(!verify(Buffer.concat([data, Buffer.from(' ')]), sig, [k.publicKey]), 'even whitespace');
  const badSig = Buffer.from(sig, 'base64'); badSig[0] ^= 1;
  assert.ok(!verify(data, badSig.toString('base64'), [k.publicKey]));
  assert.ok(!verify(data, 'not base64 !!', [k.publicKey]));
  assert.ok(!verify(data, sig, ['short']), 'a malformed key is skipped, not trusted');
});

test('the app ships no signing key until the production key is made', () => {
  assert.deepEqual([...REGISTRY_KEYS], []);
});

const pointer = (): Pointer => ({
  id: 'token-garden', tier: 'verified', repository: 'JakeMotta/token-games', path: 'samples/token-garden', commit: 'a'.repeat(40),
  tag: 'token-garden-v0.1.0', bundle: { url: 'https://github.com/JakeMotta/token-games/releases/download/token-garden-v0.1.0/token-garden-0.1.0.zip', sha256: 'b'.repeat(64) },
});

test('pointers are checked field by field', () => {
  assert.deepEqual(checkPointer(pointer(), 'token-garden'), []);
  assert.match(checkPointer(pointer(), 'other').join(), /must match the file name/);
  assert.match(checkPointer({ ...pointer(), tier: 'built-in' }).join(), /tier must be/);
  assert.match(checkPointer({ ...pointer(), commit: 'main' }).join(), /full 40-character commit/);
  assert.match(checkPointer({ ...pointer(), path: '../x' }).join(), /path must be/);
  assert.match(checkPointer({ ...pointer(), repository: 'https://github.com/a/b' }).join(), /owner\/repo/);
  assert.match(checkPointer({ ...pointer(), bundle: { url: 'http://example.com/a.zip', sha256: 'b'.repeat(64) } }).join(), /https/);
  assert.match(checkPointer({ ...pointer(), bundle: { url: pointer().bundle.url, sha256: 'B'.repeat(64) } }).join(), /sha256/);
  assert.match(checkPointer({ ...pointer(), extra: 1 }).join(), /unknown field "extra"/);
});

test('bundle URLs: https, file:// or a relative .zip; never http or ..', () => {
  for (const ok of ['https://x.io/a.zip', 'file:///tmp/a.zip', 'bundles/a-0.1.0.zip']) assert.ok(isBundleUrl(ok), ok);
  for (const bad of ['http://x.io/a.zip', '../a.zip', '/abs/a.zip', 'javascript:alert(1)', 'bundles/a.exe', '']) assert.ok(!isBundleUrl(bad), bad);
});

test('an index built from pointers and game.json passes its own check', () => {
  const m = { id: 'token-garden', name: 'Token Garden', description: 'd', author: 'a', version: '0.1.0', minShellVersion: '1.2.0', permissions: ['claude-usage'], network: ['api.example.com'], license: 'MIT' } as unknown as GameManifest;
  const g = indexEntry(pointer(), m, 1234);
  assert.equal(g.repository, 'https://github.com/JakeMotta/token-games');
  assert.deepEqual(g.network, ['api.example.com']);
  const idx = buildIndex([g], [{ id: 'bad-game', reason: 'mined crypto' }], '2026-01-01T00:00:00.000Z');
  assert.ok(checkIndex(JSON.parse(JSON.stringify(idx))).ok);
  const twice = { ...idx, games: [g, g] };
  assert.match((checkIndex(twice) as { errors: string[] }).errors.join(), /listed twice/);
  const badNet: IndexGame = { ...g, network: ['*.evil.com'] };
  assert.ok(!checkIndex({ ...idx, games: [badNet] }).ok);
  assert.ok(!checkIndex({ ...idx, indexVersion: 2 }).ok);
});

test('the blocklist blocks a whole game, some versions, or exact bundles', () => {
  const bl = [{ id: 'a', reason: 'all' }, { id: 'b', versions: ['1.0.0'], reason: 'v1' }, { id: 'c', sha256: ['f'.repeat(64)], reason: 'that zip' }];
  assert.equal(blockedBy(bl, 'a', '9.9.9')?.reason, 'all');
  assert.equal(blockedBy(bl, 'b', '1.0.0')?.reason, 'v1');
  assert.equal(blockedBy(bl, 'b', '1.0.1'), null);
  assert.equal(blockedBy(bl, 'c', '1.0.0', 'f'.repeat(64))?.reason, 'that zip');
  assert.equal(blockedBy(bl, 'c', '1.0.0', 'e'.repeat(64)), null);
  assert.equal(blockedBy(bl, 'd'), null);
});
