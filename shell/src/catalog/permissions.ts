// The permission model for a hosted catalog game, as pure functions so the rules are tested apart from Electron
// (catalog-host.ts applies them to the game's session). A game sees only its own files; it reaches the network only
// for https/wss hosts its game.json lists AND the player approved; everything else is cancelled.
import type { GameManifest } from '../manifest';
import type { Tier } from './registry';

export const GAME_SCHEME = 'tg-game';

export type RequestVerdict = { allow: true } | { allow: false; why: string };

export function allowRequest(url: string, approvedHosts: readonly string[], gameId: string): RequestVerdict {
  let u: URL;
  try { u = new URL(url); } catch { return { allow: false, why: 'not a URL' }; }
  switch (u.protocol) {
    case `${GAME_SCHEME}:`:
      return u.hostname === gameId ? { allow: true } : { allow: false, why: 'another game\'s files' };
    case 'data:': case 'blob:':
      return { allow: true }; // made by the page itself, from its own data
    case 'devtools:': case 'chrome-extension:': case 'file:': case 'http:': case 'ws:':
      return { allow: false, why: `${u.protocol} is never allowed` };
    case 'https:': case 'wss:':
      if (u.port && u.port !== '443') return { allow: false, why: 'only the standard port' };
      return approvedHosts.includes(u.hostname.toLowerCase()) ? { allow: true } : { allow: false, why: `${u.hostname} was not approved` };
    default:
      return { allow: false, why: `${u.protocol} is not allowed` };
  }
}

// The Content-Security-Policy sent with every file of a hosted game. No eval, no plugins, no frames, no forms
// posting anywhere; connections only to approved hosts. The session's request filter enforces the same again.
export function cspFor(gameId: string, approvedHosts: readonly string[]): string {
  const self = `${GAME_SCHEME}://${gameId}`;
  const net = approvedHosts.flatMap((h) => [`https://${h}`, `wss://${h}`]).join(' ');
  return [
    `default-src ${self}`,
    `script-src ${self}`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob:`,
    `font-src ${self} data:`,
    `media-src ${self} data: blob:`,
    `connect-src ${self}${net ? ' ' + net : ''}`,
    `worker-src ${self} blob:`,
    `object-src 'none'`,
    `frame-src 'none'`,
    `child-src 'none'`,
    `form-action 'none'`,
    `base-uri 'none'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

export interface SheetLine { kind: 'ok' | 'ask' | 'warn'; text: string }

// What the permission sheet says before an install or update: what the game can and cannot do, in plain words.
// `prev` is the installed version's manifest, so an update can say what is new.
export function permissionSheet(m: Pick<GameManifest, 'name' | 'version' | 'permissions' | 'network'>, tier: Tier, prev?: Pick<GameManifest, 'version' | 'network'>): SheetLine[] {
  const lines: SheetLine[] = [];
  if (m.permissions.includes('claude-usage')) lines.push({ kind: 'ok', text: 'Sees how many tokens your Claude Code sessions use, and when. Never your prompts, code or files.' });
  lines.push({ kind: 'ok', text: 'Keeps its own save and settings. Cannot read other games, your files or your computer.' });
  const hosts = m.network || [];
  const before = new Set(prev?.network || []);
  if (!hosts.length) lines.push({ kind: 'ok', text: 'No internet: it cannot send or fetch anything.' });
  else for (const h of hosts) lines.push({ kind: 'ask', text: `Can connect to ${h}${prev && !before.has(h) ? ' (new in this version)' : ''}.` });
  if (tier === 'community') lines.push({ kind: 'warn', text: 'Community game: listed in the catalog, but not reviewed.' });
  if (tier === 'local') lines.push({ kind: 'warn', text: 'A folder on this computer: not from the catalog and not reviewed.' });
  if (prev) lines.push({ kind: 'ok', text: `Updates ${prev.version} to ${m.version}. Your save is kept.` });
  return lines;
}

// Which hosts the player approves by saying yes to the sheet: exactly what the game listed, nothing broader.
export const approvedHostsFor = (m: Pick<GameManifest, 'network'>): string[] => [...(m.network || [])];
