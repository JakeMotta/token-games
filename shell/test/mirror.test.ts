// The Settings tab names the element the player clicked by its place in the sheet, and the game's page finds the
// same element in its own copy: pathOf and nodeAt must agree, and never reach outside the sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeAt, pathOf } from '../src/page/mirror';

interface Fake { name: string; children: Fake[]; parentElement: Fake | null }
const node = (name: string, ...kids: Fake[]): Fake => {
  const n: Fake = { name, children: kids, parentElement: null };
  for (const k of kids) k.parentElement = n;
  return n;
};

// a sheet: a section with a heading and a row holding a checkbox, then the footer with two buttons
const box = node('checkbox'), reset = node('reset'), close = node('close');
const sheet = node('sheet', node('section', node('h4'), node('row', node('label', box))), node('foot', node('chips', reset, close)));
const page = node('body', node('game'), sheet);

test('an element is named by its place among its parent\'s elements, from the sheet down', () => {
  assert.deepEqual(pathOf(sheet, box), [0, 1, 0, 0]);
  assert.deepEqual(pathOf(sheet, close), [1, 0, 1]);
  assert.deepEqual(pathOf(sheet, sheet), []);
});

test('the same path finds the same element on the other side', () => {
  for (const e of [box, reset, close]) assert.equal(nodeAt(sheet, pathOf(sheet, e)!), e);
  assert.equal(nodeAt(sheet, []), sheet);
});

test('nothing outside the sheet, and no element for a path that is not there', () => {
  assert.equal(pathOf(sheet, page.children[0]), null);
  assert.equal(pathOf(sheet, null), null);
  assert.equal(nodeAt(sheet, [5]), null);
  assert.equal(nodeAt(sheet, [0, 1, 0, 0, 3]), null);
});
