// The registry a catalog smoke run installs from: one game folder (the repo's sample game, samples/token-garden, or
// the app's own catalog bundle, catalog/) packed into a zip, listed in an index and signed with a key pair made for
// this run. The private key lives only in memory and is never written anywhere; the app trusts the public key for this
// run only.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkBundleFiles, readBundleDir } from '../catalog/bundle';
import { buildIndex, indexEntry } from '../catalog/registry';
import { generateKeyPair, sha256, sign } from '../catalog/signing';
import { writeZip } from '../catalog/zip';

export function smokeRegistry(outDir: string, gameDir: string, repoPath: string): { publicKey: string; url: string } {
  const files = readBundleDir(gameDir);
  const check = checkBundleFiles(files);
  if (!check.ok || !check.manifest) throw new Error(`${repoPath} is not a valid bundle: ${check.errors.join('; ')}`);
  const m = check.manifest;
  const zip = writeZip(files);
  const rel = `bundles/${m.id}-${m.version}.zip`;
  fs.mkdirSync(path.join(outDir, 'bundles'), { recursive: true });
  fs.writeFileSync(path.join(outDir, rel), zip);
  const entry = indexEntry(
    { id: m.id, tier: 'verified', repository: 'JakeMotta/token-games', path: repoPath, commit: '0'.repeat(40), tag: `${m.id}-v${m.version}`, bundle: { url: rel, sha256: sha256(zip) } },
    m, zip.length,
  );
  const keys = generateKeyPair();
  const bytes = Buffer.from(JSON.stringify(buildIndex([entry], []), null, 2));
  fs.writeFileSync(path.join(outDir, 'index.json'), bytes);
  fs.writeFileSync(path.join(outDir, 'index.json.sig'), sign(bytes, keys.privateKeyPem));
  return { publicKey: keys.publicKey, url: pathToFileURL(path.join(outDir, 'index.json')).href };
}
