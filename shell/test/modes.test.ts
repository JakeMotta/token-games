// The shell's states: collapsed, peek, expanded, popping, popped and docking, and every way between them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, next, PAGE_EVENTS, presentationOf, scaleOf, shapeOf, STATES, type ShellEvent, type ShellState } from '../src/modes';

const run = (s: ShellState, evs: ShellEvent[], o = {}) => evs.reduce((st, e) => next(st, e, o), s);

test('it starts where it was left: in the notch, or popped out', () => {
  assert.equal(initialState('notch'), 'collapsed');
  assert.equal(initialState('floating'), 'popped');
});

test('hover peeks, leaving folds it back', () => {
  assert.equal(next('collapsed', 'enter'), 'peek');
  assert.equal(next('peek', 'leave'), 'collapsed');
  assert.equal(next('peek', 'enter'), 'peek');
});

test('a click (or the shortcut) drops it down, from resting or peeking', () => {
  for (const s of ['collapsed', 'peek'] as const) {
    assert.equal(next(s, 'click'), 'expanded');
    assert.equal(next(s, 'toggle'), 'expanded');
  }
});

test('the drop-down stays open when the pointer leaves; Esc, the shortcut or a click elsewhere fold it', () => {
  assert.equal(next('expanded', 'leave'), 'expanded');
  assert.equal(next('expanded', 'enter'), 'expanded');
  for (const e of ['escape', 'toggle', 'blur'] as const) assert.equal(next('expanded', e), 'collapsed');
  assert.equal(next('collapsed', 'blur'), 'collapsed');
  assert.equal(next('collapsed', 'escape'), 'collapsed');
});

test('Pop out flies to the window; ↩ Notch flies home', () => {
  for (const s of ['collapsed', 'peek', 'expanded'] as const) assert.equal(next(s, 'pop'), 'popping');
  assert.equal(next('popping', 'settled'), 'popped');
  assert.equal(next('popped', 'dock'), 'docking');
  assert.equal(next('docking', 'settled'), 'collapsed');
  assert.equal(run('collapsed', ['click', 'pop', 'settled', 'dock', 'settled']), 'collapsed');
});

test('with reduced motion there is no flight', () => {
  const o = { reducedMotion: true };
  assert.equal(next('expanded', 'pop', o), 'popped');
  assert.equal(next('popped', 'dock', o), 'collapsed');
});

test('nothing interrupts a flight, and popped ignores the notch\'s events', () => {
  for (const s of ['popping', 'docking'] as const) {
    for (const e of ['enter', 'leave', 'click', 'blur', 'escape', 'toggle', 'pop', 'dock', 'display'] as const) assert.equal(next(s, e), s, `${s} + ${e}`);
  }
  for (const e of ['enter', 'leave', 'click', 'blur', 'escape', 'toggle', 'pop', 'settled', 'display'] as const) assert.equal(next('popped', e), 'popped', e);
  assert.equal(next('collapsed', 'dock'), 'collapsed');
  assert.equal(next('collapsed', 'settled'), 'collapsed');
});

test('a display change folds the island back to rest', () => {
  assert.equal(next('peek', 'display'), 'collapsed');
  assert.equal(next('expanded', 'display'), 'collapsed');
  assert.equal(next('collapsed', 'display'), 'collapsed');
});

test('every state has a presentation, a scale and an outline', () => {
  const table = STATES.map((s) => [s, presentationOf(s), scaleOf(s), shapeOf(s)]);
  assert.deepEqual(table, [
    ['collapsed', 'notch', 'mini', 'collapsed'],
    ['peek', 'notch', 'mini', 'peek'],
    ['expanded', 'notch', 'expanded', 'expanded'],
    ['popping', 'floating', 'window', null],
    ['popped', 'floating', 'window', null],
    ['docking', 'notch', 'mini', 'collapsed'],
  ]);
});

test('the page can only ask, not fake the pointer or the flight', () => {
  for (const e of ['enter', 'leave', 'blur', 'settled', 'display'] as const) assert.ok(!PAGE_EVENTS.includes(e), e);
});
