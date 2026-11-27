// The Claude Code feed: watches Claude Code's own session transcripts (~/.claude/projects/<project>/<session>.jsonl,
// and <project>/<session>/subagents/*.jsonl for helper agents) and turns new lines into token events.
//
// Local only. Nothing is ever sent anywhere and nothing is copied: each new line is parsed in memory, only its token
// counts, model name, session id and time are kept, and the line is dropped. It starts at the end of every existing
// transcript, so old history never replays.
import fs from 'node:fs';
import path from 'node:path';
import type { FarmEvent, TokensEvent } from '../shared/events';

interface Usage { input: number; output: number; cache_read: number; cache_write: number }

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const MAX_IDS = 4000; // message ids remembered for de-duplication

// Turns transcript lines into events. Claude Code writes one line per content block, so the same message id (with
// the same or a growing usage) appears several times: only the growth is counted, once.
export class ClaudeParser {
  private seen = new Map<string, Usage>();
  private done = new Set<string>();

  line(line: string, subagent: boolean, now: number): FarmEvent[] {
    // Cheap test first: most lines (tool results, user turns) carry no usage and are never parsed.
    if (!line.includes('"usage"')) return [];
    let j: Record<string, any>;
    try { j = JSON.parse(line); } catch { return []; }
    if (!j || j.type !== 'assistant' || !j.message || typeof j.message !== 'object') return [];
    const m = j.message, u = m.usage;
    if (!u || typeof u !== 'object') return [];
    const id = typeof m.id === 'string' ? m.id : typeof j.uuid === 'string' ? j.uuid : '';
    const t = Date.parse(j.timestamp);
    const ts = Number.isFinite(t) ? t : now;
    const session = typeof j.sessionId === 'string' ? j.sessionId.slice(0, 64) : undefined;
    const cur: Usage = { input: n(u.input_tokens), output: n(u.output_tokens), cache_read: n(u.cache_read_input_tokens), cache_write: n(u.cache_creation_input_tokens) };
    const prev = id ? this.seen.get(id) : undefined;
    const d: Usage = prev
      ? { input: Math.max(0, cur.input - prev.input), output: Math.max(0, cur.output - prev.output), cache_read: Math.max(0, cur.cache_read - prev.cache_read), cache_write: Math.max(0, cur.cache_write - prev.cache_write) }
      : cur;
    if (id) {
      this.seen.delete(id);
      this.seen.set(id, prev ? { input: Math.max(prev.input, cur.input), output: Math.max(prev.output, cur.output), cache_read: Math.max(prev.cache_read, cur.cache_read), cache_write: Math.max(prev.cache_write, cur.cache_write) } : cur);
      if (this.seen.size > MAX_IDS) this.seen.delete(this.seen.keys().next().value as string);
    }
    const out: FarmEvent[] = [];
    if (d.input + d.output + d.cache_read + d.cache_write > 0) {
      const ev: TokensEvent = { v: 1, source: 'claude-code', type: 'tokens', ...d, ts };
      if (session) ev.session = session;
      if (typeof m.model === 'string' && m.model) ev.model = m.model.slice(0, 64);
      out.push(ev);
    }
    // A finished turn: the main agent stopped and handed back to the person (helper agents' turns don't count).
    if (m.stop_reason === 'end_turn' && !j.isSidechain && !subagent && !(id && this.done.has(id))) {
      if (id) {
        this.done.add(id);
        if (this.done.size > MAX_IDS) this.done.delete(this.done.values().next().value as string);
      }
      out.push(session ? { v: 1, source: 'claude-code', type: 'task_done', session, ts } : { v: 1, source: 'claude-code', type: 'task_done', ts });
    }
    return out;
  }
}

export interface FeedOptions {
  root: string; // ~/.claude/projects
  onEvent(ev: FarmEvent): void;
  pollMs?: number; // only used where the folder can't be watched
  now?: () => number;
}

export interface Feed { stop(): void; check(): void; watching(): boolean; files(): number }

interface Tail { offset: number; rest: string; subagent: boolean }

const MAX_READ = 8 * 1024 * 1024; // per file per check; a longer burst is read over the next checks

// Every transcript under root: <project>/*.jsonl and <project>/<session>/subagents/*.jsonl.
function listTranscripts(root: string): string[] {
  const out: string[] = [];
  const dirs = (p: string) => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } };
  for (const proj of dirs(root)) {
    if (!proj.isDirectory()) continue;
    const pdir = path.join(root, proj.name);
    for (const e of dirs(pdir)) {
      if (e.isFile() && e.name.endsWith('.jsonl')) out.push(path.join(pdir, e.name));
      else if (e.isDirectory()) {
        const sub = path.join(pdir, e.name, 'subagents');
        for (const s of dirs(sub)) if (s.isFile() && s.name.endsWith('.jsonl')) out.push(path.join(sub, s.name));
      }
    }
  }
  return out;
}

const isSubagent = (file: string): boolean => file.split(path.sep).includes('subagents');

export function watchClaudeCode(o: FeedOptions): Feed {
  const now = o.now || Date.now;
  const parser = new ClaudeParser();
  const tails = new Map<string, Tail>();
  const pending = new Set<string>();
  let watcher: fs.FSWatcher | null = null, timer: NodeJS.Timeout | null = null, poll: NodeJS.Timeout | null = null, stopped = false;

  // Start at the end of everything that is already there.
  for (const f of listTranscripts(o.root)) {
    try { tails.set(f, { offset: fs.statSync(f).size, rest: '', subagent: isSubagent(f) }); } catch { /* gone already */ }
  }

  function read(file: string): void {
    let t = tails.get(file);
    if (!t) {
      // A transcript that appeared while we run: a new session (or helper agent), read from its start.
      t = { offset: 0, rest: '', subagent: isSubagent(file) };
      tails.set(file, t);
      if (!t.subagent) o.onEvent({ v: 1, source: 'claude-code', type: 'session_start', session: path.basename(file, '.jsonl').slice(0, 64), ts: now() });
    }
    let fd: number | null = null;
    try {
      const size = fs.statSync(file).size;
      if (size < t.offset) { t.offset = 0; t.rest = ''; } // rewritten
      if (size === t.offset) return;
      const len = Math.min(MAX_READ, size - t.offset), buf = Buffer.alloc(len);
      fd = fs.openSync(file, 'r');
      const got = fs.readSync(fd, buf, 0, len, t.offset);
      t.offset += got;
      const lines = (t.rest + buf.toString('utf8', 0, got)).split('\n');
      t.rest = lines.pop() || '';
      if (t.rest.length > MAX_READ) t.rest = ''; // a runaway line: skip it rather than hold it
      for (const line of lines) for (const ev of parser.line(line, t.subagent, now())) o.onEvent(ev);
      if (size > t.offset) pending.add(file);
    } catch {
      tails.delete(file);
    } finally {
      if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ }
    }
  }

  function flush(): void {
    timer = null;
    const files = [...pending];
    pending.clear();
    for (const f of files) read(f);
    if (pending.size && !stopped) schedule();
  }
  // Writes come in bursts of several lines; gather a quarter second of them into one read.
  function schedule(): void { if (!timer && !stopped) timer = setTimeout(flush, 250); }

  function check(): void {
    for (const f of listTranscripts(o.root)) {
      const t = tails.get(f);
      if (!t) pending.add(f);
      else { try { if (fs.statSync(f).size !== t.offset) pending.add(f); } catch { tails.delete(f); } }
    }
    flush();
  }

  try {
    watcher = fs.watch(o.root, { recursive: true, persistent: false }, (_ev, name) => {
      if (!name) return;
      const rel = name.toString();
      if (!rel.endsWith('.jsonl')) return;
      pending.add(path.join(o.root, rel));
      schedule();
    });
    watcher.on('error', () => { watcher?.close(); watcher = null; startPolling(); });
  } catch {
    watcher = null;
    startPolling();
  }
  function startPolling(): void {
    if (poll || stopped) return;
    poll = setInterval(check, o.pollMs || 5000);
    poll.unref?.();
  }

  return {
    stop() { stopped = true; watcher?.close(); watcher = null; if (timer) clearTimeout(timer); if (poll) clearInterval(poll); timer = poll = null; },
    check,
    watching: () => !!watcher,
    files: () => tails.size,
  };
}
