// The bridge a hosted catalog game gets (window.tokenGame), and the rules for what crosses it. A catalog game is a
// sandboxed web page with no Node and no Electron (docs/catalog.md); this small API is all it can ask the shell for.
// Change it with care: it is a promise to every published game. Its version is HOSTED_API_VERSION; a change only ever
// adds, so a game written for version 1 runs unchanged.
//   1  usage, env, load/save, settings, status, pop out and dock
//   2  onHide (save before the game is closed: switched away from, removed or the app quits) and env.feed
import type { UsageEvent } from './events';
import type { Scale } from './modes';

export const HOSTED_API_VERSION = 2;
export const MAX_SAVE_BYTES = 1024 * 1024;
export const MAX_SETTINGS_BYTES = 64 * 1024;

// What the game sees of a usage event: counts and timestamps. No session ids, no model names.
export type HostedUsage =
  | { type: 'tokens'; source: string; input: number; output: number; cache_read: number; cache_write: number; ts: number }
  | { type: 'task_done'; source: string; ts: number }
  | { type: 'session_start' | 'agent_waiting'; source: string; ts: number };

// Presentation hints: where the game is shown and how. A game should draw less in 'mini' and honour reducedMotion.
// feed says whether usage can arrive at all: whether Claude Code's transcripts are being watched, and how many (a count;
// never a path).
export interface HostedEnv { scale: Scale; dark: boolean; reducedMotion: boolean; feed: HostedFeed }
export interface HostedFeed { watching: boolean; files: number }

export interface HostedStatus { count: string; title: string; line?: string; warm?: boolean }

export interface TokenGameApi {
  readonly version: number;
  onUsage(fn: (ev: HostedUsage) => void): void;
  env(): Promise<HostedEnv>;
  onEnv(fn: (env: HostedEnv) => void): void;
  load(): Promise<unknown>; // the game's last save, or null
  save(data: unknown): Promise<boolean>; // a JSON object, at most 1 MB
  getSettings(): Promise<Record<string, unknown>>;
  setSettings(s: Record<string, unknown>): Promise<boolean>; // a JSON object, at most 64 KB
  setStatus(s: HostedStatus): void; // the number on the circle and the status line in the card and the window
  popOut(): void;
  dock(): void;
  // The game is about to be closed: save now. The shell waits for the handlers (and the saves they start) for up to
  // HIDE_WAIT_MS, then closes the game anyway.
  onHide(fn: () => void | Promise<unknown>): void;
}

export const HIDE_WAIT_MS = 1000;

export const GAME_CH = {
  env: 'game:env', load: 'game:load', save: 'game:save', getSettings: 'game:get-settings', setSettings: 'game:set-settings',
  status: 'game:status', pop: 'game:pop', dock: 'game:dock', usage: 'game:usage', envChanged: 'game:env-changed',
  key: 'game:key', hide: 'game:hide', hidden: 'game:hidden',
} as const;

export function forHostedGame(ev: UsageEvent): HostedUsage {
  const source = ev.source === 'claude-code' || ev.source === 'codex' ? ev.source : 'other';
  if (ev.type === 'tokens') return { type: 'tokens', source, input: ev.input, output: ev.output, cache_read: ev.cache_read, cache_write: ev.cache_write, ts: ev.ts };
  return { type: ev.type, source, ts: ev.ts };
}

// A save or settings object from the game: a plain JSON object under the limit, or null.
export function checkGameData(data: unknown, maxBytes: number): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  let text: string;
  try { text = JSON.stringify(data); } catch { return null; }
  return Buffer.byteLength(text) <= maxBytes ? text : null;
}

const short = (v: unknown, max: number): string => (typeof v === 'string' ? v : String(v ?? '')).replace(/[\u0000-\u001f]/g, ' ').slice(0, max);

export function cleanStatus(raw: unknown): HostedStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const out: HostedStatus = { count: short(s.count, 8), title: short(s.title, 24) };
  if (s.line !== undefined) out.line = short(s.line, 80);
  if (s.warm === true) out.warm = true;
  return out;
}
