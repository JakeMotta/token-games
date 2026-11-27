// game.json: the small, stable description every game carries in its folder, for the build, the template and (later)
// a catalog that lists and installs games. The format is documented in docs/manifest.md; change both together.
// The build (shell/scripts/build-game.mjs) checks it and stops on any problem.

export const SHELL_VERSION = '1.0.0'; // the shell's own version (shell/package.json); a game asks for at least minShellVersion
export const MANIFEST_VERSION = 1;

// What a game may ask the shell for. 'claude-usage': read the user's Claude Code transcripts for token counts only.
export const PERMISSIONS = ['claude-usage'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface GameManifest {
  manifestVersion: 1;
  id: string; // the folder name, lowercase-with-dashes; also the app's name (its settings folder)
  name: string; // shown in the island, the window and the menu bar
  description: string; // one sentence
  author: string;
  version: string; // the game's own version, x.y.z
  entry: { main: string; page: string }; // built files, relative to the game folder
  icon: string; // a square .svg or .png in the game folder
  minShellVersion: string; // x.y.z
  permissions: Permission[];
}

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const REL = /^(?!\/)(?!.*\.\.)[\w./-]+$/;
const KEYS = ['manifestVersion', 'id', 'name', 'description', 'author', 'version', 'entry', 'icon', 'minShellVersion', 'permissions'];

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export type ManifestCheck = { ok: true; manifest: GameManifest; errors: [] } | { ok: false; errors: string[] };

// Checks a parsed game.json. `folder` is the game's folder name, which the id must match.
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
  const e = m.entry as Record<string, unknown> | undefined;
  if (!e || typeof e !== 'object') errors.push('entry must be { "main": ..., "page": ... }');
  else for (const k of ['main', 'page']) if (typeof e[k] !== 'string' || !REL.test(e[k] as string)) errors.push(`entry.${k} must be a path inside the game folder`);
  if (!Array.isArray(m.permissions)) errors.push('permissions must be a list');
  else for (const p of m.permissions) if (!(PERMISSIONS as readonly unknown[]).includes(p)) errors.push(`unknown permission "${String(p)}" (known: ${PERMISSIONS.join(', ')})`);
  for (const k of Object.keys(m)) if (!KEYS.includes(k)) errors.push(`unknown field "${k}"`);
  return errors.length ? { ok: false, errors } : { ok: true, manifest: m as unknown as GameManifest, errors: [] };
}
