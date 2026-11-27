// The pure parts of page/hosted-shell.ts, which runs a game written for the shell's page (a Game, game.ts) as a
// sandboxed catalog game over window.tokenGame instead (docs/catalog.md, "A shell game in the catalog"). Kept apart
// so they are unit-tested.
import type { FeedStatus } from './api';
import { normalizeEvent, type UsageEvent } from './events';
import type { GameStatusLine } from './game';
import type { HostedFeed, HostedStatus, HostedUsage } from './hosted';
import { shellDefaults } from './settings';

// A usage event from the bridge in the shell's own format (v1), checked like any event from outside.
export function toUsageEvent(h: HostedUsage): UsageEvent | null {
  return normalizeEvent({ ...h, v: 1 });
}

// The bridge's status has no bold lead: it goes in front of the line, as the shell's page shows it.
export function toHostedStatus(s: GameStatusLine): HostedStatus {
  const line = s.lead ? (s.line ? `${s.lead} · ${s.line}` : s.lead) : s.line;
  const out: HostedStatus = { count: s.count, title: s.title };
  if (line) out.line = line;
  if (s.warm) out.warm = true;
  return out;
}

// What a hosted game keeps in its settings file: its own settings only. Where and how it is shown (the orb's corner,
// the window, reduced motion) belongs to the shell.
const SHELL_KEYS = new Set(Object.keys(shellDefaults()));
export function ownSettings(s: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (!SHELL_KEYS.has(k)) out[k] = v;
  return out;
}

// The feed as the game's Settings describe it. A game written for bridge version 1 gets no feed: it reads as waiting.
export function toFeedStatus(f: HostedFeed | undefined): FeedStatus {
  return { watching: !!f?.watching, files: Number.isFinite(f?.files) ? Math.max(0, Math.floor(f!.files)) : 0, root: '' };
}

// A first seed for a game that has never saved settings: any 32-bit number.
export function randomSeed(): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0];
}
