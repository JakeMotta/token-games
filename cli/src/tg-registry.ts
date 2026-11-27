// The `tg-registry` command (registry-tool.ts does the work).
import fs from 'node:fs';
import path from 'node:path';
import { buildIndexFrom, indexBytes, keygen, pack, readPointers, RegistryError, signIndex, verifyIndex, verifyPointer } from './registry-tool';
import { checkPointer, type Pointer } from '@token-games/shell/catalog/registry';

const USAGE = `tg-registry: build and check the Token Games catalog.

  tg-registry keygen <file>                          a new signing key, written outside any git checkout; prints the public key
  tg-registry pack <game-folder> [--out <dir>]       the release bundle <id>-<version>.zip and its sha256
  tg-registry check <registry-folder>                every pointer in games/ and blocklist.json
  tg-registry verify-pointer <pointer.json> --source <checkout> [--zip <released.zip>]
                                                     rebuild from the pinned commit and compare sha256
  tg-registry build-index <registry-folder> [--bundles <dir>] [--out <index.json>]
  tg-registry sign <index.json> [--key <file>]       writes index.json.sig (or TG_REGISTRY_SIGNING_KEY holds the key)
  tg-registry verify <index.json> [--public-key <base64>]`;

const args = process.argv.slice(2);
const opt = (f: string): string | undefined => { const i = args.indexOf(f); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = opt('--out'), source = opt('--source'), zip = opt('--zip'), bundles = opt('--bundles'), keyFile = opt('--key'), pub = opt('--public-key');
const [cmd, target] = args;

async function main(): Promise<number> {
  if (!cmd || !target) { console.error(USAGE); return 2; }
  switch (cmd) {
    case 'keygen': {
      const k = keygen(target);
      console.log(`Private key written to ${k.file} (keep it offline; never commit it).\nPublic key, for shell/src/catalog/keys.ts:\n${k.publicKey}`);
      return 0;
    }
    case 'pack': {
      const r = pack(target, out || '.');
      console.log(`${r.file}\nsha256 ${r.sha256}\nsize ${r.size}`);
      return 0;
    }
    case 'check': {
      const r = readPointers(target);
      if (r.errors.length) { console.error(r.errors.join('\n')); return 1; }
      console.log(`${r.pointers.length} pointer(s) and ${r.blocklist.length} blocklist entr${r.blocklist.length === 1 ? 'y' : 'ies'} are valid.`);
      return 0;
    }
    case 'verify-pointer': {
      if (!source) { console.error('verify-pointer needs --source <checkout of the pinned commit>'); return 2; }
      const p = JSON.parse(fs.readFileSync(target, 'utf8')) as Pointer;
      const e = checkPointer(p, path.basename(target, '.json'));
      const r = e.length ? { ok: false, errors: e } : verifyPointer(p, source, zip ? fs.readFileSync(zip) : undefined);
      if (!r.ok) { console.error(`${p.id}: ${r.errors.join('\n  ')}`); return 1; }
      console.log(`${p.id}: the bundle rebuilt from ${p.commit.slice(0, 12)} matches ${p.bundle.sha256}`);
      return 0;
    }
    case 'build-index': {
      const idx = await buildIndexFrom(target, bundles);
      const file = out || path.join(target, 'index.json');
      fs.writeFileSync(file, indexBytes(idx));
      console.log(`${file}: ${idx.games.length} game(s), ${idx.blocklist.length} blocked`);
      return 0;
    }
    case 'sign': {
      const pem = keyFile ? fs.readFileSync(keyFile, 'utf8') : process.env.TG_REGISTRY_SIGNING_KEY;
      if (!pem) { console.error('no signing key: pass --key <file> or set TG_REGISTRY_SIGNING_KEY'); return 2; }
      console.log(`signed: ${signIndex(target, pem)}`);
      return 0;
    }
    case 'verify': {
      const r = verifyIndex(target, pub ? [pub] : undefined);
      if (!r.ok) { console.error(r.error); return 1; }
      console.log(`${target}: signature verified, ${r.games} game(s)`);
      return 0;
    }
    default: console.error(USAGE); return 2;
  }
}

main().then((c) => { process.exitCode = c; }, (e) => { console.error(e instanceof RegistryError ? e.message : (e as Error).message); process.exitCode = 1; });
