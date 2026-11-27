// Test games and a throwaway signed registry for the catalog tests. The key pair is made fresh for every test run
// and lives only in memory; no private key is ever written to the repo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeZip, type ZipFile } from '../src/catalog/zip';
import { generateKeyPair, sha256, sign } from '../src/catalog/signing';
import { buildIndex, type BlockEntry, type IndexGame, type RegistryTier } from '../src/catalog/registry';

export const tmpDir = (tag = 'cat') => fs.mkdtempSync(path.join(os.tmpdir(), `tg-${tag}-`));

export function webGame(over: Record<string, unknown> = {}, extra: ZipFile[] = []): ZipFile[] {
  const m = {
    manifestVersion: 1, id: 'token-garden', name: 'Token Garden', description: 'A garden that grows from tokens.', author: 'Tester',
    version: '0.1.0', kind: 'web', entry: { page: 'index.html' }, icon: 'icon.svg', minShellVersion: '1.2.0', permissions: ['claude-usage'], ...over,
  };
  return [
    { path: 'game.json', data: Buffer.from(JSON.stringify(m)) },
    { path: 'index.html', data: Buffer.from('<!doctype html><title>g</title><script src="game.js"></script>') },
    { path: 'game.js', data: Buffer.from('document.title = "garden";') },
    { path: 'icon.svg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') },
    ...extra,
  ];
}

export interface TestRegistry { dir: string; url: string; publicKey: string; privateKeyPem: string; zips: Record<string, Buffer>; republish(games: Spec[], blocklist?: BlockEntry[]): void }
export interface Spec { id?: string; version?: string; tier?: RegistryTier; network?: string[]; files?: ZipFile[]; sha?: string; minShellVersion?: string }

// A registry folder: bundles/<id>-<version>.zip, index.json and its signature, served by file:// URL.
export function testRegistry(games: Spec[], blocklist: BlockEntry[] = []): TestRegistry {
  const dir = tmpDir('reg');
  const keys = generateKeyPair();
  const reg: TestRegistry = {
    dir, url: pathToFileURL(path.join(dir, 'index.json')).href, publicKey: keys.publicKey, privateKeyPem: keys.privateKeyPem, zips: {},
    republish(list, bl = []) {
      fs.mkdirSync(path.join(dir, 'bundles'), { recursive: true });
      const entries: IndexGame[] = list.map((s) => {
        const id = s.id || 'token-garden', version = s.version || '0.1.0';
        const files = s.files || webGame({ id, version, ...(s.network ? { network: s.network } : {}), ...(s.minShellVersion ? { minShellVersion: s.minShellVersion } : {}) });
        const zip = writeZip(files);
        const rel = `bundles/${id}-${version}.zip`;
        fs.writeFileSync(path.join(dir, rel), zip);
        reg.zips[`${id}@${version}`] = zip;
        return {
          id, name: 'Token Garden', description: 'A garden.', author: 'Tester', version, tier: s.tier || 'verified', minShellVersion: s.minShellVersion || '1.2.0',
          permissions: ['claude-usage'], network: s.network || [], repository: 'https://github.com/example/garden', commit: 'a'.repeat(40),
          bundle: { url: rel, sha256: s.sha || sha256(zip), size: zip.length },
        };
      });
      const bytes = Buffer.from(JSON.stringify(buildIndex(entries, bl, '2026-01-01T00:00:00.000Z'), null, 2));
      fs.writeFileSync(path.join(dir, 'index.json'), bytes);
      fs.writeFileSync(path.join(dir, 'index.json.sig'), sign(bytes, keys.privateKeyPem));
    },
  };
  reg.republish(games, blocklist);
  return reg;
}
