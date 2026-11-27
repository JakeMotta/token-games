// Installing a catalog game: the zip rules (zip-slip, symlinks, bombs), what a bundle may hold, sha256, the atomic
// swap and its rollback, and no downgrades.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { crc32, readZip, safeRelPath, writeZip, ZipError } from '../src/catalog/zip';
import { checkBundleFiles, checkBundleDir, looksExecutable } from '../src/catalog/bundle';
import { cleanGamesDir, fetchBytes, installPrepared, InstallError, prepareBundle } from '../src/catalog/installer';
import { sha256 } from '../src/catalog/signing';
import { tmpDir, webGame } from './catalog-fixtures';

// a zip whose entry name is swapped after writing, to make archives writeZip itself refuses to make
function evilZip(safeName: string, evilName: string, data = 'x'): Buffer {
  assert.equal(Buffer.byteLength(safeName), Buffer.byteLength(evilName));
  const z = writeZip([{ path: safeName, data: Buffer.from(data) }]);
  const a = Buffer.from(safeName), b = Buffer.from(evilName);
  let i = 0;
  while ((i = z.indexOf(a, i)) >= 0) { b.copy(z, i); i += a.length; }
  return z;
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('writeZip is deterministic and readZip reads it back', () => {
  const files = webGame();
  const a = writeZip(files), b = writeZip([...files].reverse());
  assert.ok(a.equals(b), 'same files, same bytes, whatever the order');
  assert.deepEqual(readZip(a).map((f) => f.path), ['game.js', 'game.json', 'icon.svg', 'index.html']);
  assert.equal(readZip(a).find((f) => f.path === 'game.js')!.data.toString(), 'document.title = "garden";');
});

test('readZip reads deflated entries, as made by ordinary zip tools', () => {
  const data = Buffer.from('hello '.repeat(100));
  const z = writeZip([{ path: 'a.txt', data }]);
  const comp = zlib.deflateRawSync(data);
  // rebuild the same zip with method 8 by hand
  const name = Buffer.from('a.txt');
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(data), 14);
  lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(data), 16);
  ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
  const cd = Buffer.concat([ch, name]); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(30 + name.length + comp.length, 16);
  const deflated = Buffer.concat([lh, name, comp, cd, end]);
  assert.ok(deflated.length < z.length);
  assert.ok(readZip(deflated)[0].data.equals(data));
});

test('zip-slip: paths that would leave the game folder are refused', () => {
  for (const [safe, evil] of [['aa/evil.txt', '../evil.txt'], ['xetc/passwd', '/etc/passwd'], ['a/b.txt', 'a\\b.txt'], ['xC/win.txt', 'C:/win.txt'], ['a/xx/b.txt', 'a/../b.txt']]) {
    assert.throws(() => readZip(evilZip(safe, evil)), ZipError, evil);
  }
  assert.equal(safeRelPath('img/ant.png'), 'img/ant.png');
  for (const bad of ['', '/x', '../x', 'a/../../x', 'a//b', 'a\\b', 'C:x', 'a\0b', './a']) assert.equal(safeRelPath(bad), null, bad);
});

test('symlinks, encrypted entries, duplicates and bad checksums are refused', () => {
  const sym = writeZip([{ path: 'link', data: Buffer.from('/etc/passwd') }]);
  const cd = sym.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  sym.writeUInt32LE((0o120777 << 16) >>> 0, cd + 38);
  assert.throws(() => readZip(sym), /symlinks are not allowed/);

  const enc = writeZip([{ path: 'a.txt', data: Buffer.from('x') }]);
  enc.writeUInt16LE(0x0801, enc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 8);
  assert.throws(() => readZip(enc), /encrypted/);

  assert.throws(() => readZip(Buffer.alloc(10)), /not a zip/);
  const dup = writeZip([{ path: 'a.txt', data: Buffer.from('1') }, { path: 'b.txt', data: Buffer.from('2') }]);
  let i = 0; while ((i = dup.indexOf(Buffer.from('b.txt'), i)) >= 0) { Buffer.from('A.txt').copy(dup, i); i += 5; }
  assert.throws(() => readZip(dup), /listed twice/, 'names that differ only in case would overwrite each other');

  const bad = writeZip([{ path: 'a.txt', data: Buffer.from('hello') }]);
  bad[30 + 5] ^= 0xff; // flip a byte of the data
  assert.throws(() => readZip(bad), /checksum/);
});

test('a zip bomb is stopped by its declared size', () => {
  const z = writeZip([{ path: 'a.txt', data: Buffer.from('x') }]);
  const cd = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  z.writeUInt32LE(100 * 1024 * 1024, cd + 24);
  assert.throws(() => readZip(z), /too large/);
});

test('a bundle is plain web files around a valid web game.json', () => {
  assert.deepEqual(checkBundleFiles(webGame()).errors, []);
  assert.match(checkBundleFiles(webGame().filter((f) => f.path !== 'game.json')).errors.join(), /game.json is missing/);
  assert.match(checkBundleFiles(webGame().filter((f) => f.path !== 'index.html')).errors.join(), /entry.page index.html is not in the bundle/);
  assert.match(checkBundleFiles(webGame({ kind: 'app', entry: { main: 'm.js', page: 'index.html' } })).errors.join(), /must be "kind": "web"/);
  assert.match(checkBundleFiles(webGame({ entry: { main: 'm.js', page: 'index.html' } })).errors.join(), /never run main-process code/);
  assert.match(checkBundleFiles(webGame(), { id: 'other' }).errors.join(), /catalog says "other"/);
  assert.match(checkBundleFiles(webGame(), { version: '0.2.0' }).errors.join(), /catalog says 0.2.0/);
});

test('programs are refused, by name and by their first bytes', () => {
  for (const name of ['tool.exe', 'lib.dylib', 'addon.node', 'run.sh', 'x.bat', 'a.ps1', 'a.dll', 'a.so', 'a.jar'])
    assert.match(checkBundleFiles(webGame({}, [{ path: name, data: Buffer.from('x') }])).errors.join(), /programs and native libraries/, name);
  const magic: Record<string, Buffer> = {
    mz: Buffer.from('MZ\x90\x00'), elf: Buffer.from([0x7f, 0x45, 0x4c, 0x46]), macho: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
    fat: Buffer.from([0xca, 0xfe, 0xba, 0xbe]), shebang: Buffer.from('#!/bin/sh\nrm -rf ~'),
  };
  for (const [k, data] of Object.entries(magic)) {
    assert.ok(looksExecutable(data), k);
    assert.match(checkBundleFiles(webGame({}, [{ path: `sprite-${k}.png`, data }])).errors.join(), /programs are not allowed/, k);
  }
  assert.equal(looksExecutable(Buffer.from('<svg/>')), null);
});

test('a bundle folder with a symlink is refused', { skip: process.platform === 'win32' }, () => {
  const dir = tmpDir('dir');
  for (const f of webGame()) fs.writeFileSync(path.join(dir, f.path), f.data);
  assert.deepEqual(checkBundleDir(dir).errors, []);
  fs.symlinkSync('/etc/hosts', path.join(dir, 'hosts.txt'));
  assert.match(checkBundleDir(dir).errors.join(), /symlinks are not allowed/);
});

test('sha256 must match the catalog', () => {
  const zip = writeZip(webGame());
  assert.equal(prepareBundle(zip, { id: 'token-garden', sha256: sha256(zip) }).manifest.id, 'token-garden');
  const tampered = Buffer.from(zip); tampered[tampered.length - 30] ^= 1;
  assert.throws(() => prepareBundle(tampered, { id: 'token-garden', sha256: sha256(zip) }), /sha256 does not match/);
  assert.throws(() => prepareBundle(zip, { id: 'token-garden', sha256: 'f'.repeat(64) }), InstallError);
});

test('install unpacks the game; an update swaps it in whole', () => {
  const games = tmpDir('games');
  installPrepared(games, prepareBundle(writeZip(webGame()), { id: 'token-garden' }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(games, 'token-garden/game.json'), 'utf8')).version, '0.1.0');
  installPrepared(games, prepareBundle(writeZip(webGame({ version: '0.2.0' })), { id: 'token-garden' }), { installedVersion: '0.1.0' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(games, 'token-garden/game.json'), 'utf8')).version, '0.2.0');
  assert.deepEqual(fs.readdirSync(games), ['token-garden'], 'no staging or old folders left');
});

test('downgrades and reinstalls of the same version are refused', () => {
  const games = tmpDir('games');
  const p = prepareBundle(writeZip(webGame({ version: '0.1.0' })), { id: 'token-garden' });
  assert.throws(() => installPrepared(games, p, { installedVersion: '0.2.0' }), /downgrades are refused/);
  assert.throws(() => installPrepared(games, p, { installedVersion: '0.1.0' }), /not newer/);
  assert.throws(() => installPrepared(games, p, { installedVersion: '0.1.10' }), /not newer/, 'versions compare by number');
});

test('a failure after the swap rolls back to the old version', () => {
  const games = tmpDir('games');
  installPrepared(games, prepareBundle(writeZip(webGame()), { id: 'token-garden' }));
  const next = prepareBundle(writeZip(webGame({ version: '0.2.0' })), { id: 'token-garden' });
  assert.throws(() => installPrepared(games, next, { installedVersion: '0.1.0', afterSwap: () => { throw new Error('disk full'); } }), /rolled back: disk full/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(games, 'token-garden/game.json'), 'utf8')).version, '0.1.0');
  assert.deepEqual(fs.readdirSync(games), ['token-garden']);
  // a first install that fails leaves nothing behind
  const fresh = tmpDir('games');
  assert.throws(() => installPrepared(fresh, next, { afterSwap: () => { throw new Error('boom'); } }), /rolled back/);
  assert.deepEqual(fs.readdirSync(fresh), []);
});

test('leftovers from a crash are cleaned up, and a half-swapped game is restored', () => {
  const games = tmpDir('games');
  fs.mkdirSync(path.join(games, '.staging-token-garden-1-2'));
  fs.mkdirSync(path.join(games, '.old-token-garden-1-2'));
  fs.writeFileSync(path.join(games, '.old-token-garden-1-2', 'game.json'), '{}');
  cleanGamesDir(games);
  assert.deepEqual(fs.readdirSync(games), ['token-garden']);
});

test('fetchBytes reads file:// URLs and relative paths, and refuses http', async () => {
  const dir = tmpDir('fetch');
  fs.mkdirSync(path.join(dir, 'bundles'));
  fs.writeFileSync(path.join(dir, 'bundles', 'a.zip'), 'zip');
  const base = 'file://' + path.join(dir, 'index.json');
  assert.equal((await fetchBytes('bundles/a.zip', base)).toString(), 'zip');
  assert.equal((await fetchBytes(path.join(dir, 'bundles', 'a.zip'))).toString(), 'zip');
  await assert.rejects(fetchBytes('http://example.com/a.zip'), /http: downloads are not allowed/);
  await assert.rejects(fetchBytes('ftp://example.com/a.zip'), /not allowed/);
  await assert.rejects(fetchBytes('bundles/a.zip', base, 2), /too large/);
});
