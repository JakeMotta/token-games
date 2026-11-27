// The event format and the Claude Code feed: counts and times only, each token counted once, nothing old replayed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeParser, watchClaudeCode } from '../src/feed/claude-code';
import { normalizeEvent, type UsageEvent } from '../src/events';

const usage = { input_tokens: 1200, output_tokens: 850, cache_read_input_tokens: 40000, cache_creation_input_tokens: 3000 };
const line = (o: Record<string, unknown> = {}, m: Record<string, unknown> = {}) => JSON.stringify({
  type: 'assistant', sessionId: 's-1', timestamp: '2026-11-27T10:00:00.000Z', isSidechain: false,
  message: { id: 'msg_1', model: 'claude-x', stop_reason: 'tool_use', content: [{ type: 'text', text: 'SECRET PROMPT TEXT' }], usage, ...m }, ...o,
});

test('events: the v1 format, cleaned to known fields only', () => {
  const ev = normalizeEvent({ v: 1, source: 'claude-code', type: 'tokens', input: 10.4, output: -3, cache_read: 5, extra: 'x', prompt: 'hi', ts: 7 });
  assert.deepEqual(ev, { v: 1, source: 'claude-code', type: 'tokens', input: 10, output: 0, cache_read: 5, cache_write: 0, ts: 7 });
  assert.equal(normalizeEvent({ v: 2, type: 'tokens' }), null, 'unknown versions are refused');
  assert.equal(normalizeEvent({ type: 'nope' }), null);
  assert.equal(normalizeEvent({ v: 1, type: 'task_done', source: 'codex', session: 'r-77', ts: 1 })!.type, 'task_done');
  assert.equal((normalizeEvent({ v: 1, type: 'task_done', width: 30.2, ts: 1 }) as { width: number }).width, 30);
});

test('parser: an assistant line becomes a tokens event with counts and time, never content', () => {
  const evs = new ClaudeParser().line(line(), false, 0);
  assert.equal(evs.length, 1);
  assert.deepEqual(evs[0], { v: 1, source: 'claude-code', type: 'tokens', input: 1200, output: 850, cache_read: 40000, cache_write: 3000, ts: Date.parse('2026-11-27T10:00:00.000Z'), session: 's-1', model: 'claude-x' });
  assert.ok(!JSON.stringify(evs).includes('SECRET'), 'no content leaks into events');
});

test('parser: the same message on several lines counts once, and only its growth', () => {
  const p = new ClaudeParser();
  assert.equal(p.line(line(), false, 0).length, 1);
  assert.equal(p.line(line(), false, 0).length, 0, 'a repeat adds nothing');
  const grown = p.line(line({}, { usage: { ...usage, output_tokens: 900 } }), false, 0);
  assert.equal(grown.length, 1);
  assert.equal((grown[0] as { output: number; input: number }).output, 50);
  assert.equal((grown[0] as { output: number; input: number }).input, 0);
});

test('parser: a finished main turn is a task done; helper agents and tool calls are not', () => {
  const p = new ClaudeParser();
  const end = p.line(line({}, { id: 'm2', stop_reason: 'end_turn' }), false, 0);
  assert.deepEqual(end.map((e) => e.type), ['tokens', 'task_done']);
  assert.equal(p.line(line({}, { id: 'm2', stop_reason: 'end_turn' }), false, 0).length, 0, 'counted once');
  assert.deepEqual(p.line(line({ isSidechain: true }, { id: 'm3', stop_reason: 'end_turn' }), false, 0).map((e) => e.type), ['tokens']);
  assert.deepEqual(p.line(line({}, { id: 'm4', stop_reason: 'end_turn' }), true, 0).map((e) => e.type), ['tokens']);
});

test('parser: other lines and broken lines are ignored', () => {
  const p = new ClaudeParser();
  assert.equal(p.line('{"type":"user","message":{"content":"hello"}}', false, 0).length, 0);
  assert.equal(p.line('{"usage": broken', false, 0).length, 0);
  assert.equal(p.line('', false, 0).length, 0);
});

const until = async (fn: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};

test('watcher: starts at the end of existing transcripts and reads only what is added', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-farm-feed-'));
  fs.mkdirSync(path.join(root, 'proj', 's-1', 'subagents'), { recursive: true });
  const main = path.join(root, 'proj', 's-1.jsonl'), sub = path.join(root, 'proj', 's-1', 'subagents', 'agent-a.jsonl');
  fs.writeFileSync(main, line({}, { id: 'old', stop_reason: 'end_turn' }) + '\n');
  fs.writeFileSync(sub, '');
  const got: UsageEvent[] = [];
  const feed = watchClaudeCode({ root, onEvent: (e) => got.push(e), pollMs: 100 });
  try {
    assert.equal(feed.files(), 2);
    // a line written in two pieces is read once it is whole
    const l = line({}, { id: 'new', stop_reason: 'end_turn' }) + '\n';
    fs.appendFileSync(main, l.slice(0, 40));
    feed.check();
    fs.appendFileSync(main, l.slice(40));
    fs.appendFileSync(sub, line({}, { id: 'helper', stop_reason: 'end_turn' }) + '\n');
    assert.ok(await until(() => { feed.check(); return got.length >= 3; }), JSON.stringify(got));
    assert.deepEqual(got.map((e) => e.type).sort(), ['task_done', 'tokens', 'tokens']);
    assert.ok(!got.some((e) => e.type === 'tokens' && e.input === 0 && e.output === 0));
    // a new session appearing is read from its start
    fs.writeFileSync(path.join(root, 'proj', 's-2.jsonl'), line({ sessionId: 's-2' }, { id: 'n2' }) + '\n');
    assert.ok(await until(() => { feed.check(); return got.some((e) => e.session === 's-2' && e.type === 'tokens'); }));
    assert.ok(got.some((e) => e.type === 'session_start' && e.session === 's-2'));
  } finally {
    feed.stop();
  }
});

test('watcher: a missing folder is not an error', () => {
  const feed = watchClaudeCode({ root: path.join(os.tmpdir(), 'ant-farm-no-such-dir-' + process.pid), onEvent: () => {}, pollMs: 50 });
  assert.equal(feed.files(), 0);
  feed.check();
  feed.stop();
});
