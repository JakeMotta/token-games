// Where the orb goes: the display it picks, its corner, the shapes that grow out of it, and where a dropped orb settles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD, cardSize, contains, CORNERS, EDGE, nearestCorner, ORB, orbCenter, orbGeo, orbWindowBounds, onOrb, pickDisplay, PILL, shapeRect, type DisplayLike } from '../src/orb';

// A 14" MacBook Pro (37 pt menu bar, Dock at the bottom) and a 27" display to its left and a little higher.
const mbp: DisplayLike = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 870 } };
const ext: DisplayLike = { id: 3, bounds: { x: -2560, y: -200, width: 2560, height: 1440 }, workArea: { x: -2560, y: -175, width: 2560, height: 1415 } };
const inside = (r: { x: number; y: number; width: number; height: number }, a: { x: number; y: number; width: number; height: number }) =>
  r.x >= a.x && r.y >= a.y && r.x + r.width <= a.x + a.width && r.y + r.height <= a.y + a.height;

test('the remembered display if it is still there, else the main one', () => {
  assert.equal(pickDisplay([ext, mbp], 3, mbp), ext);
  assert.equal(pickDisplay([mbp], 3, mbp), mbp, 'unplugged: back to the main display');
  assert.equal(pickDisplay([ext, mbp], null, mbp), mbp);
  assert.equal(pickDisplay([ext], null, undefined), ext);
  assert.equal(pickDisplay([], null, undefined), undefined);
});

test('the window sits EDGE in from each corner of the work area, never under the menu bar or the Dock', () => {
  const a = mbp.workArea;
  const at = Object.fromEntries(CORNERS.map((c) => [c, orbWindowBounds(orbGeo(mbp, c))]));
  assert.deepEqual(at.br, { x: a.x + a.width - EDGE - CARD.width, y: a.y + a.height - EDGE - CARD.height, ...CARD });
  assert.deepEqual(at.tl, { x: a.x + EDGE, y: a.y + EDGE, ...CARD });
  assert.equal(at.tr.y, a.y + EDGE); assert.equal(at.tr.x, at.br.x);
  assert.equal(at.bl.x, a.x + EDGE); assert.equal(at.bl.y, at.br.y);
  for (const c of CORNERS) assert.ok(inside(at[c], a), c);
});

test('the orb, the pill and the card all hug the same corner, so each grows out of the orb', () => {
  for (const c of CORNERS) {
    const g = orbGeo(ext, c), w = orbWindowBounds(g), orb = shapeRect('orb', g), pill = shapeRect('pill', g), card = shapeRect('card', g);
    assert.deepEqual([orb.width, orb.height, pill.width, pill.height], [ORB, ORB, PILL, ORB]);
    assert.deepEqual(card, w, 'the open card fills the window');
    const left = c[1] === 'l', top = c[0] === 't';
    for (const r of [orb, pill]) {
      assert.equal(left ? r.x : r.x + r.width, left ? w.x : w.x + w.width, c + ' side');
      assert.equal(top ? r.y : r.y + r.height, top ? w.y : w.y + w.height, c + ' top or bottom');
    }
    // the orb's corner of the screen is the corner its shapes share
    const ctr = orbCenter(g);
    assert.ok(contains(orb, ctr) && contains(pill, ctr) && contains(card, ctr), c);
  }
});

test('a pointer counts as on the orb only inside its circle', () => {
  const g = orbGeo(mbp, 'br'), c = orbCenter(g), r = shapeRect('orb', g);
  assert.ok(onOrb(g, c));
  assert.ok(onOrb(g, { x: c.x + ORB / 2 - 1, y: c.y }));
  assert.ok(!onOrb(g, { x: r.x + 1, y: r.y + 1 }), 'the square\'s corner is outside the circle');
  assert.ok(onOrb(g, { x: c.x + ORB / 2 + 3, y: c.y }, 4), 'with slop once inside');
});

test('a dropped orb settles in the corner of the quarter it was dropped in', () => {
  const a = mbp.workArea;
  assert.equal(nearestCorner({ x: a.x + 10, y: a.y + 10 }, a), 'tl');
  assert.equal(nearestCorner({ x: a.x + a.width - 1, y: a.y + 300 }, a), 'tr');
  assert.equal(nearestCorner({ x: a.x + 700, y: a.y + 500 }, a), 'bl');
  assert.equal(nearestCorner({ x: a.x + a.width + 50, y: a.y + a.height + 50 }, a), 'br', 'past the edge still counts');
  assert.equal(nearestCorner({ x: -100, y: 0 }, ext.workArea), 'tr', 'on another display: that display\'s corners');
});

test('on a tiny display the card shrinks to fit', () => {
  const tiny: DisplayLike = { bounds: { x: 0, y: 0, width: 400, height: 300 }, workArea: { x: 0, y: 0, width: 400, height: 300 } };
  assert.deepEqual(cardSize(tiny.workArea), { width: 400 - 2 * EDGE, height: 300 - 2 * EDGE });
  for (const c of CORNERS) assert.ok(inside(orbWindowBounds(orbGeo(tiny, c)), tiny.workArea), c);
  assert.deepEqual(cardSize(mbp.workArea), CARD);
});
