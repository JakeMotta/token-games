// The one token event format every source sends to every game (docs/ant-farm-design.md, "Event format", version 1).
// Counts and timestamps only: an event never carries prompts, code or any other content.

export type EventSource = 'claude-code' | 'codex' | string;

export interface TokensEvent {
  v: 1;
  source: EventSource;
  type: 'tokens';
  session?: string;
  model?: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  ts: number;
}

export interface TaskDoneEvent {
  v: 1;
  source: EventSource;
  type: 'task_done';
  session?: string;
  width?: number;
  ts: number;
}

export interface SessionEvent {
  v: 1;
  source: EventSource;
  type: 'session_start' | 'agent_waiting';
  session?: string;
  ts: number;
}

export type FarmEvent = TokensEvent | TaskDoneEvent | SessionEvent;

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
const text = (s: unknown, max = 64): string | undefined => (typeof s === 'string' && s ? s.slice(0, max) : undefined);

// Checks an event from outside and returns a clean copy holding only the known fields, or null.
export function normalizeEvent(raw: unknown, now = Date.now()): FarmEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (e.v !== undefined && e.v !== 1) return null;
  const source = text(e.source, 32) || 'unknown';
  const ts = typeof e.ts === 'number' && Number.isFinite(e.ts) ? e.ts : now;
  const session = text(e.session);
  if (e.type === 'tokens') {
    const ev: TokensEvent = { v: 1, source, type: 'tokens', input: count(e.input), output: count(e.output), cache_read: count(e.cache_read), cache_write: count(e.cache_write), ts };
    if (session) ev.session = session;
    const model = text(e.model);
    if (model) ev.model = model;
    return ev;
  }
  if (e.type === 'task_done') {
    const ev: TaskDoneEvent = { v: 1, source, type: 'task_done', ts };
    if (session) ev.session = session;
    if (typeof e.width === 'number' && Number.isFinite(e.width)) ev.width = Math.round(e.width);
    return ev;
  }
  if (e.type === 'session_start' || e.type === 'agent_waiting') {
    const ev: SessionEvent = { v: 1, source, type: e.type, ts };
    if (session) ev.session = session;
    return ev;
  }
  return null;
}
