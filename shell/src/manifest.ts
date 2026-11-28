// game.json: the small, stable description every game carries in its folder, for the build, the template and the
// catalog that lists and installs games. The format is documented in docs/manifest.md; change both together.
// The build (shell/scripts/build-game.mjs) checks it and stops on any problem; the installer checks it again inside
// every downloaded bundle (catalog/bundle.ts).
//
// Two kinds of game share the format:
//   "app": a game in this repo, built into its own Electron app with the shell around it (the Ant Farm). It has
//          main-process code (entry.main). This is the default when "kind" is left out.
//   "web": a sandboxed web bundle the catalog installs and the shell hosts (docs/catalog.md). Plain files only:
//          entry.page and what it loads. It never has main-process code, so entry.main is refused.

export const SHELL_VERSION = '1.3.0'; // the shell's own version (shell/package.json); a game asks for at least minShellVersion
export const MANIFEST_VERSION = 1;

// What a game may ask the shell for. 'claude-usage': token counts and timestamps from Claude Code's transcripts.
export const PERMISSIONS = ['claude-usage'] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const KINDS = ['app', 'web'] as const;
export type GameKind = (typeof KINDS)[number];

export interface GameManifest {
  manifestVersion: 1;
  id: string; // the folder name, lowercase-with-dashes; also the app's name (its settings folder)
  name: string; // shown in the circle's name tag, the top bar of the card and the window, and the menu
  description: string; // one sentence
  author: string;
  version: string; // the game's own version, x.y.z
  kind?: GameKind; // 'app' when left out
  entry: { main?: string; page: string }; // built files, relative to the game folder; a web game has no main
  icon: string; // a square .svg or .png in the game folder
  minShellVersion: string; // x.y.z
  permissions: Permission[];
  network?: string[]; // web games: the https hosts it asks to reach; the player approves them, nothing else is reachable
  license?: string; // an SPDX id, like "MIT"
  repository?: string; // https URL of the source
  screenshots?: string[]; // .png files in the game folder, for the catalog
}

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const REL = /^(?!\/)(?!.*\.\.)[\w./-]+$/;
// a plain host name: letters, digits, dashes and dots, at least one dot, no scheme, port, path or wildcard
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SPDX = /^[A-Za-z0-9.+-]{2,40}$/;
const KEYS = ['manifestVersion', 'id', 'name', 'description', 'author', 'version', 'kind', 'entry', 'icon', 'minShellVersion', 'permissions', 'network', 'license', 'repository', 'screenshots'];
export const MAX_NETWORK_HOSTS = 8;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export const isGameId = (s: unknown): s is string => typeof s === 'string' && s.length <= 40 && ID.test(s);
export const isVersion = (s: unknown): s is string => typeof s === 'string' && SEMVER.test(s);
export const isHost = (s: unknown): s is string => typeof s === 'string' && HOST.test(s);
export const kindOf = (m: Pick<GameManifest, 'kind'>): GameKind => m.kind || 'app';

export type ManifestCheck = { ok: true; manifest: GameManifest; errors: [] } | { ok: false; errors: string[] };

// Checks a parsed game.json. `folder` is the game's folder name, which the id must match (leave it out for a
// downloaded bundle, whose id is checked against the catalog instead). Every error says what to change.
export function checkManifest(raw: unknown, folder?: string, shellVersion = SHELL_VERSION): ManifestCheck {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['game.json must be a JSON object'] };
  const m = raw as Record<string, unknown>;
  const str = (k: string, max = 200) => {
    if (typeof m[k] !== 'string' || !(m[k] as string).trim()) errors.push(`${k} must be a non-empty string`);
    else if ((m[k] as string).length > max) errors.push(`${k} must be at most ${max} characters`);
  };
  if (m.manifestVersion !== MANIFEST_VERSION) errors.push(`manifestVersion must be ${MANIFEST_VERSION}`);
  str('id', 40); str('name', 40); str('description'); str('author', 80); str('version', 20); str('icon'); str('minShellVersion', 20);
  if (typeof m.id === 'string' && !ID.test(m.id)) errors.push('id must be lowercase letters, digits and single dashes, starting with a letter');
  if (typeof m.id === 'string' && folder && m.id !== folder) errors.push(`id "${m.id}" must match the folder name "${folder}"`);
  if (typeof m.version === 'string' && !SEMVER.test(m.version)) errors.push('version must look like 1.2.3');
  if (typeof m.minShellVersion === 'string') {
    if (!SEMVER.test(m.minShellVersion)) errors.push('minShellVersion must look like 1.2.3');
    else if (compareVersions(m.minShellVersion, shellVersion) > 0) errors.push(`needs shell ${m.minShellVersion}, this is ${shellVersion}`);
  }
  if (typeof m.icon === 'string' && (!REL.test(m.icon) || !/\.(svg|png)$/.test(m.icon))) errors.push('icon must be a .svg or .png path inside the game folder');
  if (m.kind !== undefined && !(KINDS as readonly unknown[]).includes(m.kind)) errors.push(`kind must be one of: ${KINDS.join(', ')}`);
  const kind: GameKind = m.kind === 'web' ? 'web' : 'app';
  const e = m.entry as Record<string, unknown> | undefined;
  if (!e || typeof e !== 'object' || Array.isArray(e)) errors.push(kind === 'web' ? 'entry must be { "page": "index.html" }' : 'entry must be { "main": ..., "page": ... }');
  else {
    if (typeof e.page !== 'string' || !REL.test(e.page)) errors.push('entry.page must be a path inside the game folder');
    else if (kind === 'web' && !/\.html$/.test(e.page)) errors.push('entry.page must be an .html file');
    if (kind === 'web') { if (e.main !== undefined) errors.push('a web game has no entry.main: catalog games never run main-process code'); }
    else if (typeof e.main !== 'string' || !REL.test(e.main)) errors.push('entry.main must be a path inside the game folder');
    for (const k of Object.keys(e)) if (k !== 'main' && k !== 'page') errors.push(`unknown field "entry.${k}"`);
  }
  if (!Array.isArray(m.permissions)) errors.push('permissions must be a list');
  else for (const p of m.permissions) if (!(PERMISSIONS as readonly unknown[]).includes(p)) errors.push(`unknown permission "${String(p)}" (known: ${PERMISSIONS.join(', ')})`);
  if (m.network !== undefined) {
    if (kind !== 'web') errors.push('network is for web games only');
    else if (!Array.isArray(m.network)) errors.push('network must be a list of host names, like ["api.example.com"]');
    else {
      if (m.network.length > MAX_NETWORK_HOSTS) errors.push(`network may list at most ${MAX_NETWORK_HOSTS} hosts`);
      for (const h of m.network) if (!isHost(h)) errors.push(`network host "${String(h)}" must be a plain lowercase host name (no https://, port, path or *)`);
      if (new Set(m.network).size !== m.network.length) errors.push('network lists a host twice');
    }
  }
  if (m.license !== undefined && (typeof m.license !== 'string' || !SPDX.test(m.license))) errors.push('license must be an SPDX id, like "MIT"');
  if (m.repository !== undefined && (typeof m.repository !== 'string' || !/^https:\/\/[^\s]{4,200}$/.test(m.repository))) errors.push('repository must be an https:// URL');
  if (m.screenshots !== undefined) {
    if (!Array.isArray(m.screenshots) || m.screenshots.length > 6) errors.push('screenshots must be a list of at most 6 .png paths');
    else for (const s of m.screenshots) if (typeof s !== 'string' || !REL.test(s) || !/\.png$/.test(s)) errors.push(`screenshot "${String(s)}" must be a .png path inside the game folder`);
  }
  for (const k of Object.keys(m)) if (!KEYS.includes(k)) errors.push(`unknown field "${k}"`);
  return errors.length ? { ok: false, errors } : { ok: true, manifest: m as unknown as GameManifest, errors: [] };
}
