// The catalog's two file formats, and their checks (docs/catalog.md, registry/README.md):
//
//   registry/games/<id>.json  a pointer, written by a game's author in a pull request: where the game's source is
//                             (repository, path, pinned commit), and its release bundle (url and sha256).
//   index.json                built by CI from all pointers and the bundles' game.json files, signed, and served by
//                             GitHub Pages. The app reads only this, and only when the player opens the catalog.
import { compareVersions, isGameId, isHost, isVersion, PERMISSIONS, type GameManifest } from '../manifest';

export const INDEX_VERSION = 1;
export const TIERS = ['verified', 'community'] as const; // what a registry may list; 'built-in' and 'local' never come from it
export type RegistryTier = (typeof TIERS)[number];
export type Tier = 'built-in' | RegistryTier | 'local';

export interface Pointer {
  id: string;
  tier: RegistryTier;
  repository: string; // owner/repo on GitHub, where the source is
  path: string; // the game's folder in that repo ("" or "." for the root)
  commit: string; // the full commit the bundle was built from; CI rebuilds it and compares
  tag: string; // the release the bundle is attached to
  bundle: { url: string; sha256: string };
  duplicates?: string; // the id of a built-in game this is a copy of (like ant-farm-web of ant-farm): the app hides it
}

export interface IndexGame {
  id: string; name: string; description: string; author: string; version: string;
  tier: RegistryTier; minShellVersion: string; permissions: string[]; network: string[];
  license?: string; repository: string; commit: string;
  bundle: { url: string; sha256: string; size: number };
  duplicates?: string; // as in the pointer
}

export interface BlockEntry { id: string; versions?: string[]; sha256?: string[]; reason: string }

export interface CatalogIndex { indexVersion: 1; generated: string; games: IndexGame[]; blocklist: BlockEntry[] }

const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]{1,40}\/[A-Za-z0-9_.-]{1,100}$/;
const TAG = /^[A-Za-z0-9._\/-]{1,100}$/;
const DIR = /^(\.|[\w-]+(\/[\w-]+)*)?$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown, max = 300): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

// A bundle URL: https anywhere; a relative path (resolved against the index, for a local registry folder); or
// file:// (a registry on this computer, for development and tests). Never plain http.
export function isBundleUrl(u: unknown): u is string {
  if (!isStr(u, 500)) return false;
  if (/^https:\/\/[^\s]+$/.test(u) || /^file:\/\/\/[^\s]+$/.test(u)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('/') && !u.split('/').includes('..') && /^[\w./-]+\.zip$/.test(u);
}

export function checkPointer(raw: unknown, fileId?: string): string[] {
  const e: string[] = [];
  if (!isObj(raw)) return ['the pointer must be a JSON object'];
  if (!isGameId(raw.id)) e.push('id must be a game id (lowercase letters, digits and dashes)');
  else if (fileId && raw.id !== fileId) e.push(`id "${raw.id}" must match the file name "${fileId}.json"`);
  if (!(TIERS as readonly unknown[]).includes(raw.tier)) e.push(`tier must be one of: ${TIERS.join(', ')}`);
  if (!isStr(raw.repository) || !REPO.test(raw.repository)) e.push('repository must be owner/repo on GitHub');
  if (typeof raw.path !== 'string' || !DIR.test(raw.path) || raw.path.includes('..')) e.push('path must be the game folder inside the repository, like "games/my-game" (or "." for the root)');
  if (!isStr(raw.commit) || !COMMIT.test(raw.commit)) e.push('commit must be the full 40-character commit the bundle was built from');
  if (!isStr(raw.tag) || !TAG.test(raw.tag)) e.push('tag must be the release tag the bundle is attached to');
  const b = raw.bundle;
  if (!isObj(b)) e.push('bundle must be { "url": ..., "sha256": ... }');
  else {
    if (!isBundleUrl(b.url)) e.push('bundle.url must be an https:// URL to the release zip');
    if (!isStr(b.sha256) || !SHA.test(b.sha256)) e.push('bundle.sha256 must be 64 lowercase hex characters');
  }
  if (raw.duplicates !== undefined && (!isGameId(raw.duplicates) || raw.duplicates === raw.id)) e.push('duplicates must be the id of the built-in game this is a copy of');
  for (const k of Object.keys(raw)) if (!['id', 'tier', 'repository', 'path', 'commit', 'tag', 'bundle', 'duplicates'].includes(k)) e.push(`unknown field "${k}"`);
  return e;
}

export function checkIndex(raw: unknown): { ok: true; index: CatalogIndex } | { ok: false; errors: string[] } {
  const e: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['the index must be a JSON object'] };
  if (raw.indexVersion !== INDEX_VERSION) e.push(`indexVersion must be ${INDEX_VERSION}`);
  if (!Array.isArray(raw.games)) e.push('games must be a list');
  if (!Array.isArray(raw.blocklist)) e.push('blocklist must be a list');
  if (e.length) return { ok: false, errors: e };
  const seen = new Set<string>();
  (raw.games as unknown[]).forEach((g, i) => {
    const at = isObj(g) && typeof g.id === 'string' ? g.id : `games[${i}]`;
    if (!isObj(g)) { e.push(`${at}: must be an object`); return; }
    if (!isGameId(g.id)) e.push(`${at}: bad id`);
    else if (seen.has(g.id)) e.push(`${at}: listed twice`); else seen.add(g.id);
    for (const k of ['name', 'description', 'author', 'repository', 'commit']) if (!isStr(g[k])) e.push(`${at}: ${k} is missing`);
    if (!isVersion(g.version) || !isVersion(g.minShellVersion)) e.push(`${at}: bad version`);
    if (!(TIERS as readonly unknown[]).includes(g.tier)) e.push(`${at}: bad tier`);
    if (!Array.isArray(g.permissions) || g.permissions.some((p) => !(PERMISSIONS as readonly unknown[]).includes(p))) e.push(`${at}: bad permissions`);
    if (!Array.isArray(g.network) || g.network.some((h) => !isHost(h))) e.push(`${at}: bad network hosts`);
    const b = g.bundle;
    if (!isObj(b) || !isBundleUrl(b.url) || !isStr(b.sha256) || !SHA.test(b.sha256) || typeof b.size !== 'number' || b.size <= 0) e.push(`${at}: bad bundle`);
    if (g.duplicates !== undefined && !isGameId(g.duplicates)) e.push(`${at}: duplicates must be a game id`);
  });
  (raw.blocklist as unknown[]).forEach((b, i) => {
    if (!isObj(b) || !isGameId(b.id) || !isStr(b.reason)) e.push(`blocklist[${i}]: needs an id and a reason`);
    else {
      if (b.versions !== undefined && (!Array.isArray(b.versions) || !b.versions.every(isVersion))) e.push(`blocklist[${i}]: versions must be x.y.z`);
      if (b.sha256 !== undefined && (!Array.isArray(b.sha256) || !b.sha256.every((s) => typeof s === 'string' && SHA.test(s)))) e.push(`blocklist[${i}]: bad sha256`);
    }
  });
  return e.length ? { ok: false, errors: e } : { ok: true, index: raw as unknown as CatalogIndex };
}

// Is this exact game blocked? An entry with no versions and no sha256 blocks every version of the game.
export function blockedBy(blocklist: readonly BlockEntry[], id: string, version?: string, sha?: string): BlockEntry | null {
  for (const b of blocklist) {
    if (b.id !== id) continue;
    if (!b.versions && !b.sha256) return b;
    if (version && b.versions?.includes(version)) return b;
    if (sha && b.sha256?.includes(sha)) return b;
  }
  return null;
}

// The index entry for one pointer, from the game.json inside its bundle. CI calls this after it has rebuilt the
// bundle from the pinned commit and checked the sha256.
export function indexEntry(p: Pointer, m: GameManifest, size: number): IndexGame {
  const g: IndexGame = {
    id: p.id, name: m.name, description: m.description, author: m.author, version: m.version, tier: p.tier,
    minShellVersion: m.minShellVersion, permissions: [...m.permissions], network: [...(m.network || [])],
    repository: `https://github.com/${p.repository}`, commit: p.commit, bundle: { url: p.bundle.url, sha256: p.bundle.sha256, size },
  };
  if (m.license) g.license = m.license;
  if (p.duplicates) g.duplicates = p.duplicates;
  return g;
}

export function buildIndex(games: IndexGame[], blocklist: BlockEntry[], generated = new Date().toISOString()): CatalogIndex {
  return { indexVersion: INDEX_VERSION, generated, games: [...games].sort((a, b) => a.id.localeCompare(b.id)), blocklist };
}

// Is `next` an update for what is installed? Equal and older versions are not.
export const isNewer = (next: string, installed: string): boolean => compareVersions(next, installed) > 0;
