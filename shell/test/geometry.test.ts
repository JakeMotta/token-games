// Window placement: 16:9 sizes, docking, snapping and the resize grip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boundsFor, clampWidth, dockPoint, GAMES_WINDOW, gamesWindowBounds, gripCorner, heightFor, MARGIN, maxWidth, nearestDock, resizeFromGrip } from '../src/geometry';
import { settingsKit } from '../src/settings';

const { applyPatch, defaults: defaultSettings } = settingsKit({ defaults: () => ({}), sanitize: () => ({}), reset: () => ({}) });

const AREA = { x: 0, y: 25, width: 1440, height: 800 }; // a Mac work area under the menu bar

test('every size is 16:9', () => {
  assert.equal(heightFor(320), 180);
  assert.equal(heightFor(640), 360);
  assert.equal(heightFor(800), 450);
});

test('docked windows sit 12 px in from the chosen corner', () => {
  assert.deepEqual(boundsFor(defaultSettings(), AREA), { x: 1440 - MARGIN - 320, y: 25 + 800 - MARGIN - 180, width: 320, height: 180 });
  const tl = boundsFor(applyPatch(defaultSettings(), { dock: 'tl', size: 'large' }), AREA);
  assert.deepEqual(tl, { x: MARGIN, y: 25 + MARGIN, width: 640, height: 360 });
});

test('a free window stays where it was dropped, inside the work area', () => {
  const s = applyPatch(defaultSettings(), { dock: 'free', bounds: { x: 500, y: 300, width: 320, height: 180 } });
  assert.deepEqual(boundsFor(s, AREA), { x: 500, y: 300, width: 320, height: 180 });
  const off = applyPatch(defaultSettings(), { dock: 'free', bounds: { x: 5000, y: -50, width: 320, height: 180 } });
  const b = boundsFor(off, AREA);
  assert.ok(b.x + b.width <= AREA.x + AREA.width && b.y >= AREA.y, JSON.stringify(b));
});

test('a window never outgrows the screen', () => {
  assert.equal(maxWidth(AREA), Math.floor(((800 - 2 * MARGIN) * 16) / 9));
  assert.equal(clampWidth(99999, AREA), maxWidth(AREA));
  assert.equal(clampWidth(10, AREA), 256);
});

test('dropping near a corner docks there; elsewhere it stays free', () => {
  const p = dockPoint('tr', AREA, 320, 180);
  assert.equal(nearestDock({ x: p.x - 30, y: p.y + 20, width: 320, height: 180 }, AREA), 'tr');
  assert.equal(nearestDock({ x: 600, y: 400, width: 320, height: 180 }, AREA), 'free');
});

test('the grip sits away from the dock and resizing keeps 16:9 with the docked corner fixed', () => {
  assert.equal(gripCorner('br'), 'tl');
  assert.equal(gripCorner('tl'), 'br');
  const start = boundsFor(defaultSettings(), AREA);
  const b = resizeFromGrip(start, 'tl', -160, -10, AREA);
  assert.equal(b.width, 480); assert.equal(b.height, 270);
  assert.equal(b.x + b.width, start.x + start.width, 'right edge stays');
  assert.equal(b.y + b.height, start.y + start.height, 'bottom edge stays');
  const tiny = resizeFromGrip(start, 'tl', 500, 500, AREA);
  assert.equal(tiny.width, 256, 'never smaller than the minimum');
});

test('the Games and Settings window: 960 × 680, centred on the work area of the game\'s display', () => {
  assert.deepEqual(gamesWindowBounds(AREA), { x: 240, y: 25 + 60, width: 960, height: 680 });
  // a second display to the left, below the first's top
  assert.deepEqual(gamesWindowBounds({ x: -1920, y: 0, width: 1920, height: 1055 }), { x: -1920 + 480, y: 188, width: 960, height: 680 });
});

test('the Games and Settings window shrinks to fit a small work area, keeping a margin, but not below its minimum', () => {
  const m = 2 * MARGIN; // in from each edge
  assert.deepEqual(gamesWindowBounds({ x: 0, y: 25, width: 1024, height: 640 }), { x: 32, y: 25 + m, width: 960, height: 640 - 2 * m });
  assert.deepEqual(gamesWindowBounds({ x: 0, y: 25, width: 680, height: 520 }), { x: 20, y: 25 + 20, width: GAMES_WINDOW.minWidth, height: GAMES_WINDOW.minHeight });
  // a work area smaller than the minimum: the whole of it, never off screen
  assert.deepEqual(gamesWindowBounds({ x: 0, y: 25, width: 600, height: 400 }), { x: 0, y: 25, width: 600, height: 400 });
});
