// What a catalog game's bundle may hold: plain web files around a game.json of kind "web". No programs, no native
// modules, no scripts the OS could run, no symlinks. The installer checks every downloaded bundle with this, the
// registry's CI checks every pointer with it, and `tg-registry pack` refuses to build a bundle that would fail it.
import fs from 'node:fs';
import path from 'node:path';
import { checkManifest, kindOf, type GameManifest } from '../manifest';
import { MAX_FILE, MAX_FILES, MAX_TOTAL, safeRelPath, type ZipFile } from './zip';

// Extensions that are programs or libraries on some system. A web game never needs one.
const EXEC_EXT = /\.(exe|dll|so|dylib|node|app|bat|cmd|com|sh|bash|zsh|command|ps1|psm1|vbs|msi|pkg|dmg|jar|scr|cpl|py|rb|pl|apk|deb|rpm|appimage)$/i;

// The first bytes of native programs, so a renamed one is caught too.
export function looksExecutable(data: Buffer): string | null {
  if (data.length >= 2 && data[0] === 0x4d && data[1] === 0x5a) return 'a Windows program (MZ)';
  if (data.length >= 4 && data.readUInt32BE(0) === 0x7f454c46) return 'a Linux program (ELF)';
  if (data.length >= 4) {
    const m = data.readUInt32BE(0);
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(m)) return 'a macOS program (Mach-O)';
  }
  if (data.length >= 2 && data[0] === 0x23 && data[1] === 0x21) return 'a script (#!)';
  return null;
}

export interface BundleCheck { ok: boolean; errors: string[]; manifest?: GameManifest }

// Checks a bundle's files. `expect` is what the catalog index says the bundle is; the bundle must agree.
export function checkBundleFiles(files: ZipFile[], expect?: { id?: string; version?: string }): BundleCheck {
  const errors: string[] = [];
  if (files.length > MAX_FILES) errors.push(`too many files (${files.length}; at most ${MAX_FILES})`);
  let total = 0;
  const names = new Set<string>();
  for (const f of files) {
    if (safeRelPath(f.path) === null) { errors.push(`${f.path}: unsafe path`); continue; }
    names.add(f.path);
    total += f.data.length;
    if (f.data.length > MAX_FILE) errors.push(`${f.path}: too large`);
    if (EXEC_EXT.test(f.path)) errors.push(`${f.path}: programs and native libraries are not allowed in a game bundle`);
    else { const what = looksExecutable(f.data); if (what) errors.push(`${f.path}: looks like ${what}; programs are not allowed in a game bundle`); }
  }
  if (total > MAX_TOTAL) errors.push(`the bundle is larger than ${MAX_TOTAL} bytes`);
  const gj = files.find((f) => f.path === 'game.json');
  if (!gj) return { ok: false, errors: [...errors, 'game.json is missing from the top of the bundle'] };
  let raw: unknown;
  try { raw = JSON.parse(gj.data.toString('utf8')); } catch (e) { return { ok: false, errors: [...errors, `game.json: ${(e as Error).message}`] }; }
  const mc = checkManifest(raw);
  if (!mc.ok) return { ok: false, errors: [...errors, ...mc.errors.map((e) => `game.json: ${e}`)] };
  const m = mc.manifest;
  if (kindOf(m) !== 'web') errors.push('game.json: a catalog game must be "kind": "web"');
  if (!names.has(m.entry.page)) errors.push(`entry.page ${m.entry.page} is not in the bundle`);
  if (!names.has(m.icon)) errors.push(`the icon ${m.icon} is not in the bundle`);
  for (const s of m.screenshots || []) if (!names.has(s)) errors.push(`the screenshot ${s} is not in the bundle`);
  if (expect?.id && m.id !== expect.id) errors.push(`game.json says id "${m.id}" but the catalog says "${expect.id}"`);
  if (expect?.version && m.version !== expect.version) errors.push(`game.json says version ${m.version} but the catalog says ${expect.version}`);
  return { ok: errors.length === 0, errors, manifest: m };
}

// Reads a folder (a local game, or a game to pack) into the same shape, refusing symlinks on the way.
export function readBundleDir(dir: string): ZipFile[] {
  const out: ZipFile[] = [];
  const walk = (rel: string) => {
    for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (ent.name === '.DS_Store' || ent.name === '.git' || ent.name === 'node_modules') continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) throw new Error(`${r}: symlinks are not allowed in a game bundle`);
      if (ent.isDirectory()) walk(r);
      else if (ent.isFile()) {
        if (out.length >= MAX_FILES) throw new Error(`too many files (at most ${MAX_FILES})`);
        out.push({ path: r, data: fs.readFileSync(path.join(dir, r)) });
      }
    }
  };
  walk('');
  return out;
}

export function checkBundleDir(dir: string, expect?: { id?: string; version?: string }): BundleCheck {
  try { return checkBundleFiles(readBundleDir(dir), expect); } catch (e) { return { ok: false, errors: [(e as Error).message] }; }
}
