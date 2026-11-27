// The signing key in the Keychain: made and stored without ever being an argument or a file, read back to sign,
// never replaced, and a backed-up key comes back with the same public key. `security` is a fake that keeps items in
// memory and records every call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPair } from '@token-games/shell/catalog/signing';
import { KEYCHAIN_SERVICE, hasKey, keygenKeychain, publicKeyOf, readKey, storeKey, type Security } from '../src/keychain';
import { buildIndexFrom, indexBytes, signIndex, verifyIndex } from '../src/registry-tool';

function fakeSecurity() {
  const items = new Map<string, string>();
  const calls: { args: string[]; input?: string }[] = [];
  const sec: Security = (args, input) => {
    calls.push({ args, input });
    const val = (flag: string, a = args) => a[a.indexOf(flag) + 1];
    if (args[0] === '-i') {
      // `security -i` reads one command per line: add-generic-password -a <acct> -s <service> ... -w <secret>
      const words = (input || '').trim().split(' ');
      if (words[0] !== 'add-generic-password' || val('-s', words) !== KEYCHAIN_SERVICE) return { code: 1, stdout: '' };
      items.set(val('-a', words), val('-w', words));
      return { code: 0, stdout: '' };
    }
    if (args[0] === 'find-generic-password') {
      const v = items.get(val('-a'));
      if (v === undefined || val('-s') !== KEYCHAIN_SERVICE) return { code: 44, stdout: '' };
      return { code: 0, stdout: args.includes('-w') ? v + '\n' : 'keychain: "login.keychain-db"\n' };
    }
    return { code: 1, stdout: '' };
  };
  return { sec, items, calls };
}

test('keygen --keychain stores the key over stdin, never as an argument, and signs an index the app verifies', async () => {
  const { sec, calls } = fakeSecurity();
  const publicKey = keygenKeychain('registry', sec);
  assert.match(publicKey, /^[A-Za-z0-9+/]{43}=$/, 'a raw ed25519 public key, base64');
  const pem = readKey('registry', sec);
  assert.match(pem, /BEGIN PRIVATE KEY/);
  assert.equal(publicKeyOf(pem), publicKey);
  const b64 = Buffer.from(pem).toString('base64');
  for (const c of calls) assert.ok(!c.args.some((a) => a.includes(b64) || a.includes('PRIVATE')), 'the secret is never a command-line argument');
  assert.ok(calls.some((c) => c.args[0] === '-i' && c.input?.includes(b64)), 'it goes in on standard input');

  const reg = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-kc-'));
  fs.mkdirSync(path.join(reg, 'games'));
  fs.writeFileSync(path.join(reg, 'blocklist.json'), '[]\n');
  const idx = path.join(reg, 'index.json');
  fs.writeFileSync(idx, indexBytes(await buildIndexFrom(reg, undefined, '2026-11-27T00:00:00.000Z')));
  signIndex(idx, pem);
  assert.equal(verifyIndex(idx, [publicKey]).ok, true);
  assert.equal(verifyIndex(idx, [generateKeyPair().publicKey]).ok, false, 'another key does not verify it');
});

test('a key is never replaced; another account holds a rotated key; a backup comes back with the same public key', () => {
  const { sec } = fakeSecurity();
  const first = keygenKeychain('registry', sec);
  assert.throws(() => keygenKeychain('registry', sec), /never replaced/);
  const second = keygenKeychain('registry-2027', sec);
  assert.notEqual(first, second);
  assert.equal(publicKeyOf(readKey('registry', sec)), first, 'the first key is untouched');

  const backup = generateKeyPair();
  assert.equal(storeKey(backup.privateKeyPem, 'restored', sec), backup.publicKey);
  assert.equal(readKey('restored', sec), backup.privateKeyPem);
});

test('a missing key, a bad account name and a non-key item are refused', () => {
  const { sec, items } = fakeSecurity();
  assert.throws(() => readKey('registry', sec), /no key for "registry"/);
  assert.throws(() => hasKey('Registry; rm -rf', sec), /lower-case letters/);
  items.set('junk', Buffer.from('hello').toString('base64'));
  assert.throws(() => readKey('junk', sec), /not a private key/);
  assert.throws(() => storeKey('not a pem', 'registry', sec));
});
