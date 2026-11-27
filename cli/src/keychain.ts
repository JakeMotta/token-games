// The catalog's signing key in the macOS Keychain (docs/first-game-walkthrough.md, "The signing key"): made there,
// read from there to sign, never written to a file, printed or passed on a command line. The `security` tool gets
// the secret on its standard input (`security -i`), so it never shows in the process list. The Keychain item holds the
// PEM as base64, one line; its account names the key, so a rotated key sits beside the old one.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { generateKeyPair, rawFromPublicKey } from '@token-games/shell/catalog/signing';
import { RegistryError } from './registry-tool';

export const KEYCHAIN_SERVICE = 'token-games-registry-signing-key';
export const KEYCHAIN_ACCOUNT = 'registry'; // the first key; a rotated one gets another account, e.g. registry-2027

// `security` with these arguments and, optionally, this standard input. Tests pass a fake.
export type Security = (args: string[], input?: string) => { code: number; stdout: string };

export const realSecurity: Security = (args, input) => {
  const r = spawnSync('/usr/bin/security', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  return { code: r.status ?? 1, stdout: r.stdout || '' };
};

const ACCOUNT = /^[a-z0-9][a-z0-9-]{0,40}$/;
function account(a: string): string {
  if (!ACCOUNT.test(a)) throw new RegistryError(`keychain account "${a}": lower-case letters, digits and dashes only`);
  return a;
}

export const hasKey = (acct: string, sec: Security = realSecurity): boolean =>
  sec(['find-generic-password', '-a', account(acct), '-s', KEYCHAIN_SERVICE]).code === 0;

// Stores a private key (PEM) under this account. Never replaces one: a lost key can't be undone.
export function storeKey(pem: string, acct: string, sec: Security = realSecurity): string {
  const publicKey = rawFromPublicKey(crypto.createPublicKey(crypto.createPrivateKey(pem)));
  if (hasKey(acct, sec)) throw new RegistryError(`the Keychain already holds a key for "${acct}" (${KEYCHAIN_SERVICE}); it is never replaced`);
  const b64 = Buffer.from(pem, 'utf8').toString('base64');
  const line = `add-generic-password -a ${acct} -s ${KEYCHAIN_SERVICE} -l "Token Games catalog signing key (${acct})" -j "ed25519 private key that signs registry/index.json" -w ${b64}\n`;
  const r = sec(['-i'], line);
  if (r.code !== 0 || !hasKey(acct, sec)) throw new RegistryError('the Keychain did not take the key (is the login keychain unlocked?)');
  return publicKey;
}

// A new key pair, the private half straight into the Keychain. Returns the public key, for shell/src/catalog/keys.ts.
export function keygenKeychain(acct: string, sec: Security = realSecurity): string {
  return storeKey(generateKeyPair().privateKeyPem, acct, sec);
}

// The private key (PEM), for signing in this process only.
export function readKey(acct: string, sec: Security = realSecurity): string {
  const r = sec(['find-generic-password', '-a', account(acct), '-s', KEYCHAIN_SERVICE, '-w']);
  if (r.code !== 0) throw new RegistryError(`no key for "${acct}" in the Keychain (${KEYCHAIN_SERVICE}); make one with \`tg-registry keygen --keychain\``);
  const pem = Buffer.from(r.stdout.trim(), 'base64').toString('utf8');
  if (!pem.includes('PRIVATE KEY')) throw new RegistryError(`the Keychain item for "${acct}" is not a private key`);
  return pem;
}

export const publicKeyOf = (pem: string): string => rawFromPublicKey(crypto.createPublicKey(crypto.createPrivateKey(pem)));
