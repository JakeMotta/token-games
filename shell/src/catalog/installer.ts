// Fetching and installing a game bundle. All or nothing: the bundle is checked in memory (sha256, zip rules, game.json,
// no programs), unpacked into a staging folder beside the games, and only then swapped in with renames. Any failure
// after the swap puts the old version back. An equal or older version is refused (no downgrades), and so is anything
// on the blocklist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBundleFiles } from './bundle';
import { sha256 } from './signing';
import { readZip, type ZipFile } from './zip';
import { blockedBy, isNewer, type BlockEntry } from './registry';
import type { GameManifest } from '../manifest';

export const MAX_DOWNLOAD = 25 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 30_000;

export class InstallError extends Error {}

// Reads bytes from https://, file:// or a plain path on this computer. A relative URL is resolved against `base`
// (the index's own URL), so a registry folder can point at bundles beside it. Plain http is refused.
export async function fetchBytes(url: string, base?: string, maxBytes = MAX_DOWNLOAD): Promise<Buffer> {
  let u: URL | null = null;
  try { u = new URL(url, base && /^[a-z]+:/i.test(base) ? base : undefined); } catch { /* a plain path */ }
  if (!u || (u.protocol.length === 2 && /^[a-z]:$/i.test(u.protocol))) { // a plain path (or C:\ on Windows)
    const p = base && !path.isAbsolute(url) ? path.resolve(path.dirname(base), url) : path.resolve(url);
    return readLimited(p, maxBytes);
  }
  if (u.protocol === 'file:') return readLimited(fileURLToPath(u), maxBytes);
  if (u.protocol !== 'https:') throw new InstallError(`${u.protocol} downloads are not allowed; use https`);
  const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new InstallError(`download failed: HTTP ${res.status}`);
  if (new URL(res.url).protocol !== 'https:') throw new InstallError('the download was redirected away from https');
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new InstallError(`the download is too large (${len} bytes)`);
  const chunks: Buffer[] = [];
  let got = 0;
  for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
    got += c.length;
    if (got > maxBytes) throw new InstallError('the download is too large');
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

function readLimited(p: string, maxBytes: number): Buffer {
  const st = fs.statSync(p);
  if (!st.isFile()) throw new InstallError(`${p} is not a file`);
  if (st.size > maxBytes) throw new InstallError(`${p} is too large`);
  return fs.readFileSync(p);
}

export interface Prepared { manifest: GameManifest; files: ZipFile[]; sha256: string; size: number }

// Everything that can be checked before touching the disk.
export function prepareBundle(bytes: Buffer, expect: { id: string; version?: string; sha256?: string }, blocklist: readonly BlockEntry[] = []): Prepared {
  const sha = sha256(bytes);
  if (expect.sha256 && sha !== expect.sha256) throw new InstallError(`sha256 does not match the catalog (got ${sha.slice(0, 12)}…, expected ${expect.sha256.slice(0, 12)}…); the download was changed or corrupted`);
  let files: ZipFile[];
  try { files = readZip(bytes); } catch (e) { throw new InstallError(`the bundle is not a safe zip: ${(e as Error).message}`); }
  const check = checkBundleFiles(files, expect);
  if (!check.ok || !check.manifest) throw new InstallError(`the bundle is not a valid game: ${check.errors.join('; ')}`);
  const b = blockedBy(blocklist, check.manifest.id, check.manifest.version, sha);
  if (b) throw new InstallError(`${check.manifest.id} ${check.manifest.version} is blocked: ${b.reason}`);
  return { manifest: check.manifest, files, sha256: sha, size: bytes.length };
}

export interface InstallOptions {
  installedVersion?: string; // refuse anything not newer than this
  afterSwap?: () => void; // tests: fail after the swap to prove the rollback
}

// Unpacks a prepared bundle into gamesDir/<id>, replacing an older version atomically.
export function installPrepared(gamesDir: string, p: Prepared, opts: InstallOptions = {}): string {
  const id = p.manifest.id;
  if (opts.installedVersion && !isNewer(p.manifest.version, opts.installedVersion))
    throw new InstallError(`${id} ${opts.installedVersion} is installed; ${p.manifest.version} is not newer (downgrades are refused)`);
  fs.mkdirSync(gamesDir, { recursive: true });
  const target = path.join(gamesDir, id);
  const stamp = `${process.pid}-${Date.now()}`;
  const staging = path.join(gamesDir, `.staging-${id}-${stamp}`);
  const old = path.join(gamesDir, `.old-${id}-${stamp}`);
  try {
    for (const f of p.files) {
      const out = path.join(staging, ...f.path.split('/'));
      if (!out.startsWith(staging + path.sep)) throw new InstallError(`${f.path}: unsafe path`); // readZip already refused these
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, f.data, { mode: 0o644 });
    }
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw e instanceof InstallError ? e : new InstallError(`could not unpack: ${(e as Error).message}`);
  }
  const hadOld = fs.existsSync(target);
  let swapped = false;
  try {
    if (hadOld) fs.renameSync(target, old);
    fs.renameSync(staging, target);
    swapped = true;
    opts.afterSwap?.();
  } catch (e) {
    // put things back as they were
    if (swapped) fs.rmSync(target, { recursive: true, force: true });
    if (hadOld && fs.existsSync(old)) fs.renameSync(old, target);
    fs.rmSync(staging, { recursive: true, force: true });
    throw new InstallError(`install failed and was rolled back: ${(e as Error).message}`);
  }
  fs.rmSync(old, { recursive: true, force: true });
  return target;
}

// Leftovers from a crash mid-install: staging folders are dropped; an .old- folder whose game is missing is restored.
export function cleanGamesDir(gamesDir: string): void {
  let names: string[];
  try { names = fs.readdirSync(gamesDir); } catch { return; }
  for (const n of names) {
    if (n.startsWith('.staging-')) fs.rmSync(path.join(gamesDir, n), { recursive: true, force: true });
    const m = /^\.old-([a-z][a-z0-9-]*)-\d+-\d+$/.exec(n);
    if (m) {
      const target = path.join(gamesDir, m[1]);
      if (!fs.existsSync(target)) fs.renameSync(path.join(gamesDir, n), target);
      else fs.rmSync(path.join(gamesDir, n), { recursive: true, force: true });
    }
  }
}
