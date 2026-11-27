// Where the island goes: notch detection, the display it picks, and its size and place in each state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contains, EAR, EXPANDED, hasNotch, islandRect, islandSize, menuBarHeight, notchGeo, notchWindowBounds, NOTCH_WIDTH, PAD, PEEK, pickDisplay, PILL, type DisplayLike } from '../src/notch';

// A 14" MacBook Pro (notch, 37 pt menu bar), an old 13" MacBook (no notch) and a 27" external display.
const mbp: DisplayLike = { id: 1, internal: true, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 945 } };
const old: DisplayLike = { id: 2, internal: true, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 24, width: 1440, height: 876 } };
const ext: DisplayLike = { id: 3, internal: false, bounds: { x: -2560, y: -200, width: 2560, height: 1440 }, workArea: { x: -2560, y: -175, width: 2560, height: 1415 } };
const hidden = (d: DisplayLike): DisplayLike => ({ ...d, workArea: { ...d.bounds } }); // the menu bar hides itself

test('the menu bar is the gap above the work area', () => {
  assert.equal(menuBarHeight(mbp), 37);
  assert.equal(menuBarHeight(ext), 25);
});

test('a notch: a built-in screen with a tall menu bar, or a notched shape when the bar is hidden', () => {
  assert.equal(hasNotch(mbp), true);
  assert.equal(hasNotch(old), false, 'a 24 pt menu bar has no notch beside it');
  assert.equal(hasNotch(ext), false, 'an external display never has a notch');
  assert.equal(hasNotch({ ...ext, workArea: { ...ext.workArea, y: ext.bounds.y + 40 } }), false, 'not even with a tall bar');
  assert.equal(hasNotch(hidden(mbp)), true, 'a 1.54 : 1 built-in screen with the bar hidden');
  assert.equal(hasNotch(hidden(old)), false, 'a 1.6 : 1 one');
});

test('several displays: the built-in one wins, else the main one', () => {
  assert.equal(pickDisplay([ext, mbp], ext), mbp);
  assert.equal(pickDisplay([ext], ext), ext);
  assert.equal(pickDisplay([ext, { ...ext, id: 9 }], { ...ext, id: 9 })!.id, 9);
  assert.equal(pickDisplay([], undefined), undefined);
});

test('with a notch the island rests as two ears either side of it, as tall as the menu bar', () => {
  const g = notchGeo(mbp);
  assert.deepEqual([g.notch, g.top, g.band, g.notchWidth, g.displayId], [true, 37, 37, NOTCH_WIDTH, 1]);
  assert.deepEqual(islandSize('collapsed', g), { width: NOTCH_WIDTH + 2 * EAR, height: 37 });
  assert.deepEqual(islandRect('collapsed', g), { x: (1512 - 350) / 2, y: 0, width: 350, height: 37 });
  assert.equal(notchGeo(hidden(mbp)).band, 32, 'with the bar hidden it still clears the notch');
});

test('without a notch it is a pill hanging from the middle of the menu bar', () => {
  const g = notchGeo(ext);
  assert.equal(g.notch, false);
  assert.deepEqual(islandSize('collapsed', g), PILL);
  assert.deepEqual(islandRect('collapsed', g), { x: -2560 + (2560 - PILL.width) / 2, y: -200, width: PILL.width, height: PILL.height });
});

test('peek and drop-down grow down from the top row, centred', () => {
  for (const g of [notchGeo(mbp), notchGeo(ext)]) {
    const peek = islandRect('peek', g), exp = islandRect('expanded', g);
    assert.equal(peek.width, PEEK.width); assert.equal(peek.height, g.band + PEEK.below);
    assert.equal(exp.width, EXPANDED.width); assert.equal(exp.height, g.band + EXPANDED.below);
    assert.equal(peek.y, g.screen.y); assert.equal(exp.y, g.screen.y);
    const mid = (r: { x: number; width: number }) => r.x + r.width / 2;
    assert.ok(Math.abs(mid(peek) - mid(islandRect('collapsed', g))) <= 0.5 && Math.abs(mid(exp) - mid(peek)) <= 0.5, 'all centred on the screen');
  }
});

test('one window holds every state, with room for the shadow', () => {
  const g = notchGeo(mbp), w = notchWindowBounds(g), exp = islandRect('expanded', g);
  assert.deepEqual(w, { x: Math.round((1512 - 688) / 2), y: 0, width: EXPANDED.width + 2 * PAD, height: 37 + EXPANDED.below + PAD });
  for (const s of ['collapsed', 'peek', 'expanded'] as const) {
    const r = islandRect(s, g);
    assert.ok(r.x >= w.x && r.x + r.width <= w.x + w.width && r.y + r.height <= w.y + w.height, s + ' fits inside');
  }
  assert.ok(exp.x - w.x === PAD);
});

test('the pointer test the click-through uses', () => {
  const r = { x: 10, y: 0, width: 100, height: 30 };
  assert.ok(contains(r, { x: 10, y: 0 }));
  assert.ok(!contains(r, { x: 110, y: 5 }));
  assert.ok(contains(r, { x: 112, y: 5 }, 4), 'a little slop around the edge');
});
