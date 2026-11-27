// The shell's states: orb, hover, expanded, popping, popped and docking, and every way between them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, next, PAGE_EVENTS, presentationOf, scaleOf, shapeOf, STATES, type ShellEvent, type ShellState } from '../src/modes';

const run = (s: ShellState, evs: ShellEvent[], o = {}) => evs.reduce((st, e) => next(st, e, o), s);

test('it starts where it was left: in the corner, or popped out', () => {
  assert.equal(initialState('orb'), 'orb');
  assert.equal(initialState('floating'), 'popped');
});

test('pointing at the orb shows the pill, leaving folds it back', () => {
  assert.equal(next('orb', 'enter'), 'hover');
  assert.equal(next('hover', 'leave'), 'orb');
  assert.equal(next('hover', 'enter'), 'hover');
});

test('a click (or the shortcut) opens the card, from resting or hovering', () => {
  for (const s of ['orb', 'hover'] as const) {
    assert.equal(next(s, 'click'), 'expanded');
    assert.equal(next(s, 'toggle'), 'expanded');
  }
});

test('the card stays open when the pointer leaves; Esc, the shortcut or a click elsewhere fold it', () => {
  assert.equal(next('expanded', 'leave'), 'expanded');
  assert.equal(next('expanded', 'enter'), 'expanded');
  for (const e of ['escape', 'toggle', 'blur'] as const) assert.equal(next('expanded', e), 'orb');
  assert.equal(next('orb', 'blur'), 'orb');
  assert.equal(next('orb', 'escape'), 'orb');
});

test('Pop out flies to the window; ↩ Corner flies home', () => {
  for (const s of ['orb', 'hover', 'expanded'] as const) assert.equal(next(s, 'pop'), 'popping');
  assert.equal(next('popping', 'settled'), 'popped');
  assert.equal(next('popped', 'dock'), 'docking');
  assert.equal(next('docking', 'settled'), 'orb');
  assert.equal(run('orb', ['click', 'pop', 'settled', 'dock', 'settled']), 'orb');
});

test('with reduced motion there is no flight', () => {
  const o = { reducedMotion: true };
  assert.equal(next('expanded', 'pop', o), 'popped');
  assert.equal(next('popped', 'dock', o), 'orb');
});

test('nothing interrupts a flight, and popped ignores the orb\'s events', () => {
  for (const s of ['popping', 'docking'] as const) {
    for (const e of ['enter', 'leave', 'click', 'drag', 'blur', 'escape', 'toggle', 'pop', 'dock', 'display'] as const) assert.equal(next(s, e), s, `${s} + ${e}`);
  }
  for (const e of ['enter', 'leave', 'click', 'drag', 'blur', 'escape', 'toggle', 'pop', 'settled', 'display'] as const) assert.equal(next('popped', e), 'popped', e);
  assert.equal(next('orb', 'dock'), 'orb');
  assert.equal(next('orb', 'settled'), 'orb');
});

test('a display change or a drag folds it back to the orb', () => {
  for (const e of ['display', 'drag'] as const) {
    assert.equal(next('hover', e), 'orb');
    assert.equal(next('expanded', e), 'orb');
    assert.equal(next('orb', e), 'orb');
  }
});

test('every state has a presentation, a scale and an outline', () => {
  const table = STATES.map((s) => [s, presentationOf(s), scaleOf(s), shapeOf(s)]);
  assert.deepEqual(table, [
    ['orb', 'orb', 'mini', 'orb'],
    ['hover', 'orb', 'mini', 'pill'],
    ['expanded', 'orb', 'expanded', 'card'],
    ['popping', 'floating', 'window', null],
    ['popped', 'floating', 'window', null],
    ['docking', 'orb', 'mini', 'orb'],
  ]);
});

test('the page can only ask, not fake the pointer or the flight', () => {
  for (const e of ['enter', 'leave', 'drag', 'blur', 'settled', 'display'] as const) assert.ok(!PAGE_EVENTS.includes(e), e);
});
