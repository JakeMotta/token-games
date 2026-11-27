// The catalog index is signed with ed25519, so a game listed as Verified really was reviewed, even if the web host
// that serves the index is compromised. The signature is detached (index.json.sig, base64) and covers the exact
// bytes of index.json. The app holds only public keys (keys.ts); the private key never enters this repo
// (docs/catalog.md, "Who holds the signing key").
import crypto from 'node:crypto';

// An ed25519 public key in SPKI DER is this fixed prefix followed by the raw 32-byte key.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function publicKeyFromRaw(rawB64: string): crypto.KeyObject {
  const raw = Buffer.from(rawB64, 'base64');
  if (raw.length !== 32) throw new Error('an ed25519 public key is 32 bytes');
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

export function rawFromPublicKey(key: crypto.KeyObject): string {
  return (key.export({ format: 'der', type: 'spki' }) as Buffer).subarray(SPKI_PREFIX.length).toString('base64');
}

// A new key pair. The private key comes back as PKCS#8 PEM, to be kept offline; the public key as raw base64,
// the form keys.ts and test registries use.
export function generateKeyPair(): { publicKey: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicKey: rawFromPublicKey(publicKey), privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string };
}

export function sign(data: Buffer, privateKeyPem: string): string {
  return crypto.sign(null, data, crypto.createPrivateKey(privateKeyPem)).toString('base64');
}

// True when `sigB64` is a valid signature of `data` by any of the trusted public keys. Several keys let us rotate.
export function verify(data: Buffer, sigB64: string, trusted: readonly string[]): boolean {
  let sig: Buffer;
  try { sig = Buffer.from(sigB64.trim(), 'base64'); } catch { return false; }
  if (sig.length !== 64) return false;
  for (const k of trusted) {
    try { if (crypto.verify(null, data, publicKeyFromRaw(k), sig)) return true; } catch { /* a malformed key: try the next */ }
  }
  return false;
}

export const sha256 = (data: Buffer): string => crypto.createHash('sha256').update(data).digest('hex');
