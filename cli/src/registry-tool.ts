// tg-registry: the catalog maintainer's tools (docs/publishing-a-game.md, registry/README.md). Pack a game into a
// release bundle, check pointers, rebuild a bundle from its pinned commit and compare it, build index.json from the
// pointers, sign it, and verify a signature. CI runs the same commands (.github/workflows/registry-*.yml).
//
// The signing key: `keygen` writes a new private key to a file outside any git checkout and prints the public key
// (which goes in shell/src/catalog/keys.ts). `sign` reads the private key from --key <file> or from the
// TG_REGISTRY_SIGNING_KEY environment variable (a CI secret). The key is never printed and never written to the repo.
import fs from 'node:fs';
import path from 'node:path';
import { checkBundleFiles, readBundleDir } from '@token-games/shell/catalog/bundle';
import { fetchBytes, prepareBundle } from '@token-games/shell/catalog/installer';
import { REGISTRY_KEYS } from '@token-games/shell/catalog/keys';
import { blockedBy, buildIndex, checkIndex, checkPointer, indexEntry, type BlockEntry, type CatalogIndex, type IndexGame, type Pointer } from '@token-games/shell/catalog/registry';
import { generateKeyPair, sha256, sign, verify } from '@token-games/shell/catalog/signing';
import { readZip, writeZip } from '@token-games/shell/catalog/zip';

export class RegistryError extends Error {}

// Is this path inside a git checkout? A private key must never be written into one.
export function insideGit(p: string): boolean {
  for (let d = path.resolve(p); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

export function keygen(outFile: string): { publicKey: string; file: string } {
  const file = path.resolve(outFile);
  if (insideGit(path.dirname(file))) throw new RegistryError(`${file} is inside a git checkout; keep the private key somewhere that is never committed (a password manager, or a folder outside every repo)`);
  const k = generateKeyPair();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, k.privateKeyPem, { mode: 0o600, flag: 'wx' }); // never overwrites a key
  return { publicKey: k.publicKey, file };
}

// A game folder → <out>/<id>-<version>.zip. The same files always give the same bytes, so CI can rebuild and compare.
export function pack(gameDir: string, outDir: string): { file: string; id: string; version: string; sha256: string; size: number } {
  const files = readBundleDir(gameDir);
  const c = checkBundleFiles(files);
  if (!c.ok || !c.manifest) throw new RegistryError(`${gameDir} is not a valid catalog game:\n  ${c.errors.join('\n  ')}`);
  const zip = writeZip(files);
  const file = path.join(outDir, `${c.manifest.id}-${c.manifest.version}.zip`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, zip);
  return { file, id: c.manifest.id, version: c.manifest.version, sha256: sha256(zip), size: zip.length };
}

const readJson = (f: string): unknown => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new RegistryError(`${f}: ${(e as Error).message}`); }
};

export function readPointers(registryDir: string): { pointers: Pointer[]; blocklist: BlockEntry[]; errors: string[] } {
  const errors: string[] = [], pointers: Pointer[] = [];
  const gd = path.join(registryDir, 'games');
  const names = fs.existsSync(gd) ? fs.readdirSync(gd).filter((f) => !f.startsWith('.')).sort() : [];
  for (const f of names) {
    if (!f.endsWith('.json')) { errors.push(`games/${f}: only <id>.json pointer files belong here`); continue; }
    let raw: unknown;
    try { raw = readJson(path.join(gd, f)); } catch (e) { errors.push((e as Error).message); continue; }
    const e = checkPointer(raw, f.slice(0, -5));
    if (e.length) errors.push(...e.map((x) => `games/${f}: ${x}`)); else pointers.push(raw as Pointer);
  }
  const bf = path.join(registryDir, 'blocklist.json');
  let blocklist: BlockEntry[] = [];
  if (fs.existsSync(bf)) {
    try {
      const raw = readJson(bf);
      const c = checkIndex({ indexVersion: 1, games: [], blocklist: raw });
      if (c.ok) blocklist = c.index.blocklist; else errors.push(...c.errors.map((x) => `blocklist.json: ${x}`));
    } catch (e) { errors.push((e as Error).message); }
  }
  return { pointers, blocklist, errors };
}

// CI's main check: rebuild the bundle from the source at the pinned commit (already checked out in `sourceDir`) and
// compare it, byte for byte (by sha256), with what the pointer says; check the released zip too when given.
export function verifyPointer(p: Pointer, sourceDir: string, releasedZip?: Buffer): { ok: boolean; errors: string[] } {
  const errors = checkPointer(p);
  if (errors.length) return { ok: false, errors };
  const dir = path.join(sourceDir, p.path === '.' ? '' : p.path);
  let files;
  try { files = readBundleDir(dir); } catch (e) { return { ok: false, errors: [`${p.path}: ${(e as Error).message}`] }; }
  const c = checkBundleFiles(files, { id: p.id });
  if (!c.ok) return { ok: false, errors: c.errors };
  const rebuilt = sha256(writeZip(files));
  if (rebuilt !== p.bundle.sha256) errors.push(`the bundle rebuilt from ${p.repository}@${p.commit.slice(0, 12)} has sha256 ${rebuilt}, but the pointer says ${p.bundle.sha256}`);
  if (releasedZip) {
    const got = sha256(releasedZip);
    if (got !== p.bundle.sha256) errors.push(`the released zip has sha256 ${got}, but the pointer says ${p.bundle.sha256}`);
    else {
      try { const rc = checkBundleFiles(readZip(releasedZip), { id: p.id }); if (!rc.ok) errors.push(...rc.errors.map((x) => 'released zip: ' + x)); } catch (e) { errors.push('released zip: ' + (e as Error).message); }
    }
  }
  return { ok: errors.length === 0, errors };
}

// index.json from every pointer and its bundle (from `bundlesDir/<id>.zip` when given, else downloaded). A blocked
// version stays out of the games list; the blocklist itself goes in, so installed copies stop too.
export async function buildIndexFrom(registryDir: string, bundlesDir?: string, generated?: string): Promise<CatalogIndex> {
  const { pointers, blocklist, errors } = readPointers(registryDir);
  if (errors.length) throw new RegistryError(errors.join('\n'));
  const games: IndexGame[] = [];
  for (const p of pointers) {
    const bytes = bundlesDir ? fs.readFileSync(path.join(bundlesDir, `${p.id}.zip`)) : await fetchBytes(p.bundle.url);
    let prepared;
    try { prepared = prepareBundle(bytes, { id: p.id, sha256: p.bundle.sha256 }); } catch (e) { throw new RegistryError(`${p.id}: ${(e as Error).message}`); }
    if (blockedBy(blocklist, p.id, prepared.manifest.version, prepared.sha256)) continue;
    games.push(indexEntry(p, prepared.manifest, bytes.length));
  }
  return buildIndex(games, blocklist, generated);
}

export const indexBytes = (idx: CatalogIndex): Buffer => Buffer.from(JSON.stringify(idx, null, 2) + '\n');

export function signIndex(indexFile: string, privateKeyPem: string): string {
  const bytes = fs.readFileSync(indexFile);
  const c = checkIndex(JSON.parse(bytes.toString('utf8')));
  if (!c.ok) throw new RegistryError(`${indexFile} is not a valid index:\n  ${c.errors.join('\n  ')}`);
  const sigFile = indexFile + '.sig';
  fs.writeFileSync(sigFile, sign(bytes, privateKeyPem) + '\n');
  return sigFile;
}

// The app's own check: the signature by a trusted key over the exact bytes, then the index's shape.
export function verifyIndex(indexFile: string, keys: readonly string[] = REGISTRY_KEYS): { ok: boolean; error?: string; games?: number } {
  if (!keys.length) return { ok: false, error: 'no public key to check against (pass --public-key, or add one to shell/src/catalog/keys.ts)' };
  const bytes = fs.readFileSync(indexFile);
  let sig = '';
  try { sig = fs.readFileSync(indexFile + '.sig', 'utf8'); } catch { return { ok: false, error: `${indexFile}.sig is missing` }; }
  if (!verify(bytes, sig, keys)) return { ok: false, error: 'the signature does not match: the index was changed, or signed with another key' };
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString('utf8')); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const c = checkIndex(raw);
  return c.ok ? { ok: true, games: c.index.games.length } : { ok: false, error: c.errors.join('; ') };
}
