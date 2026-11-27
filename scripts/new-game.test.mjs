// npm run test:scripts — the game generator, both templates, into a temp folder. (shell/test/manifest.test.ts
// checks that both templates' manifests are valid.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'new-game.mjs');
const run = (...a) => execFileSync(process.execPath, [script, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tg-new-game-'));

test('--web makes a catalog game: every placeholder filled, a valid web manifest', () => {
  const into = tmp();
  try {
    const out = run('sand-clock', 'Sand Clock', '--web', '--author', 'A. Author', '--into', into);
    assert.match(out, /Add local folder/);
    const dir = path.join(into, 'sand-clock');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['README.md', 'game.js', 'game.json', 'icon.svg', 'index.html', 'style.css']);
    for (const f of fs.readdirSync(dir)) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /__GAME_/, f);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'game.json'), 'utf8'));
    assert.equal(m.kind, 'web');
    assert.equal(m.author, 'A. Author');
    assert.match(fs.readFileSync(path.join(dir, 'game.js'), 'utf8'), /title: 'Sand Clock'/);
    assert.equal(m.entry.page, 'index.html');
    assert.equal(m.entry.main, undefined, 'a web game has no main-process code');
  } finally { fs.rmSync(into, { recursive: true, force: true }); }
});

test('the app template still copies, and bad ids and existing folders are refused', () => {
  const into = tmp();
  try {
    run('tower-defense', '--into', into, '--author', 'B');
    const m = JSON.parse(fs.readFileSync(path.join(into, 'tower-defense', 'game.json'), 'utf8'));
    assert.equal(m.kind, undefined);
    assert.equal(m.name, 'Tower Defense');
    assert.equal(m.entry.main, 'dist/main.js');
    assert.throws(() => run('tower-defense', '--into', into), /already exists/);
    assert.throws(() => run('Bad_Id', '--into', into), /lowercase/);
    assert.throws(() => run('registry', '--web'), /repo's own folders/);
  } finally { fs.rmSync(into, { recursive: true, force: true }); }
});
