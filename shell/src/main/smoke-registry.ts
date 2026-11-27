// The registry the catalog smoke test installs from: the repo's sample game (samples/token-garden) packed into a zip,
// listed in an index and signed with a key pair made for this run. The private key lives only in memory and is
// never written anywhere; the app trusts the public key for this run only.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkBundleFiles, readBundleDir } from '../catalog/bundle';
import { buildIndex, indexEntry } from '../catalog/registry';
import { generateKeyPair, sha256, sign } from '../catalog/signing';
import { writeZip } from '../catalog/zip';

export function smokeRegistry(outDir: string, samplesDir: string): { publicKey: string; url: string } {
  const files = readBundleDir(path.join(samplesDir, 'token-garden'));
  const check = checkBundleFiles(files);
  if (!check.ok || !check.manifest) throw new Error(`samples/token-garden is not a valid bundle: ${check.errors.join('; ')}`);
  const m = check.manifest;
  const zip = writeZip(files);
  const rel = `bundles/${m.id}-${m.version}.zip`;
  fs.mkdirSync(path.join(outDir, 'bundles'), { recursive: true });
  fs.writeFileSync(path.join(outDir, rel), zip);
  const entry = indexEntry(
    { id: m.id, tier: 'verified', repository: 'JakeMotta/token-games', path: 'samples/token-garden', commit: '0'.repeat(40), tag: `${m.id}-v${m.version}`, bundle: { url: rel, sha256: sha256(zip) } },
    m, zip.length,
  );
  const keys = generateKeyPair();
  const bytes = Buffer.from(JSON.stringify(buildIndex([entry], []), null, 2));
  fs.writeFileSync(path.join(outDir, 'index.json'), bytes);
  fs.writeFileSync(path.join(outDir, 'index.json.sig'), sign(bytes, keys.privateKeyPem));
  return { publicKey: keys.publicKey, url: pathToFileURL(path.join(outDir, 'index.json')).href };
}
