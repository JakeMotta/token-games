// The shell's states: orb, hover, expanded, popping, popped, docking and returning, and every way between them, plus
// the three sizes the player sees (Circle, Card, Window) and what the size switch sends from each state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { goTo, initialState, next, PAGE_EVENTS, presentationOf, scaleOf, shapeOf, sizeOf, STATES, type ShellEvent, type ShellState, type Size } from '../src/modes';

const run = (s: ShellState, evs: ShellEvent[], o = {}) => evs.reduce((st, e) => next(st, e, o), s);

test('it starts where it was left: in the corner, or popped out', () => {
  assert.equal(initialState('orb'), 'orb');
  assert.equal(initialState('floating'), 'popped');
});

test('pointing at the circle shows its name tag, leaving hides it', () => {
  assert.equal(next('orb', 'enter'), 'hover');
  assert.equal(next('hover', 'leave'), 'orb');
  assert.equal(next('hover', 'enter'), 'hover');
});

test('a click, the switch\'s Card or the menu opens the card, from resting or hovering', () => {
  for (const s of ['orb', 'hover'] as const) {
    assert.equal(next(s, 'click'), 'expanded');
    assert.equal(next(s, 'card'), 'expanded');
    assert.equal(next(s, 'toggle'), 'expanded');
  }
  assert.equal(next('expanded', 'card'), 'expanded');
});

test('the card stays open when the pointer leaves; Esc, the switch\'s Circle or a click elsewhere fold it', () => {
  assert.equal(next('expanded', 'leave'), 'expanded');
  assert.equal(next('expanded', 'enter'), 'expanded');
  for (const e of ['escape', 'toggle', 'blur', 'dock'] as const) assert.equal(next('expanded', e), 'orb');
  assert.equal(next('orb', 'blur'), 'orb');
  assert.equal(next('orb', 'escape'), 'orb');
});

test('Window flies out to the window; Circle flies home', () => {
  for (const s of ['orb', 'hover', 'expanded'] as const) assert.equal(next(s, 'pop'), 'popping');
  assert.equal(next('popping', 'settled'), 'popped');
  assert.equal(next('popped', 'dock'), 'docking');
  assert.equal(next('docking', 'settled'), 'orb');
  assert.equal(run('orb', ['click', 'pop', 'settled', 'dock', 'settled']), 'orb');
});

test('Esc in the window, or Card, flies back to the card; Esc there folds it into the circle', () => {
  for (const e of ['escape', 'card'] as const) assert.equal(next('popped', e), 'returning', e);
  assert.equal(next('returning', 'settled'), 'expanded');
  assert.equal(run('popped', ['escape', 'settled', 'escape']), 'orb');
  assert.equal(run('popped', ['card', 'settled']), 'expanded');
});

test('with reduced motion there is no flight', () => {
  const o = { reducedMotion: true };
  assert.equal(next('expanded', 'pop', o), 'popped');
  assert.equal(next('popped', 'dock', o), 'orb');
  assert.equal(next('popped', 'escape', o), 'expanded');
  assert.equal(next('popped', 'card', o), 'expanded');
});

test('nothing interrupts a flight, and popped ignores the circle\'s events', () => {
  for (const s of ['popping', 'docking', 'returning'] as const) {
    for (const e of ['enter', 'leave', 'click', 'drag', 'blur', 'escape', 'toggle', 'pop', 'card', 'dock', 'display'] as const) assert.equal(next(s, e), s, `${s} + ${e}`);
  }
  for (const e of ['enter', 'leave', 'click', 'drag', 'blur', 'toggle', 'pop', 'settled', 'display'] as const) assert.equal(next('popped', e), 'popped', e);
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

test('every state has a presentation, a scale, an outline and the size the switch lights', () => {
  const table = STATES.map((s) => [s, presentationOf(s), scaleOf(s), shapeOf(s), sizeOf(s)]);
  assert.deepEqual(table, [
    ['orb', 'orb', 'mini', 'orb', 'circle'],
    ['hover', 'orb', 'mini', 'orb', 'circle'],
    ['expanded', 'orb', 'expanded', 'card', 'card'],
    ['popping', 'floating', 'window', null, 'window'],
    ['popped', 'floating', 'window', null, 'window'],
    ['docking', 'orb', 'mini', 'orb', 'circle'],
    ['returning', 'orb', 'mini', 'card', 'card'],
  ]);
});

test('the size switch: each button sends what gets there, nothing when already there', () => {
  const want: Record<string, Record<Size, ShellEvent | null>> = {
    orb: { circle: null, card: 'card', window: 'pop' },
    hover: { circle: null, card: 'card', window: 'pop' },
    expanded: { circle: 'escape', card: null, window: 'pop' },
    popped: { circle: 'dock', card: 'card', window: null },
  };
  for (const [s, row] of Object.entries(want)) {
    for (const to of ['circle', 'card', 'window'] as const) assert.equal(goTo(s as ShellState, to), row[to], `${s} → ${to}`);
  }
  // and each one lands on its size, from every resting state, with or without motion
  for (const s of ['orb', 'hover', 'expanded', 'popped'] as const) {
    for (const to of ['circle', 'card', 'window'] as const) {
      for (const o of [{}, { reducedMotion: true }]) {
        const ev = goTo(s, to);
        const end = ev ? run(s, [ev, 'settled'], o) : s;
        assert.equal(sizeOf(end), to, `${s} → ${to} ${JSON.stringify(o)}`);
      }
    }
  }
});

test('the page can only ask, not fake the pointer or the flight', () => {
  for (const e of ['enter', 'leave', 'drag', 'blur', 'settled', 'display'] as const) assert.ok(!PAGE_EVENTS.includes(e), e);
  for (const e of ['click', 'escape', 'toggle', 'pop', 'card', 'dock'] as const) assert.ok(PAGE_EVENTS.includes(e), e);
});
