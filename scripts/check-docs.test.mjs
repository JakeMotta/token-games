// npm run test:scripts — the docs check's rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { missingDocs } from './check-docs.mjs';

test('a shell change without the docs fails, naming the missing ones', () => {
  assert.deepEqual(missingDocs(['shell/src/orb.ts']).missing, ['CLAUDE.md', 'README.md']);
  assert.deepEqual(missingDocs(['shell/src/orb.ts', 'README.md']).missing, ['CLAUDE.md']);
});

test('a shell change with CLAUDE.md and README.md passes', () => {
  assert.deepEqual(missingDocs(['shell/src/main/shell.ts', 'CLAUDE.md', 'README.md', 'shell/README.md']).missing, []);
});

test('the template, the repo scripts and the root package.json count as the wrapper', () => {
  for (const f of ['templates/game/src/game/app.ts', 'scripts/new-game.mjs', 'package.json', 'shell/scripts/build-game.mjs', 'shell/package.json', 'templates/web-game/game.js', 'cli/src/mcp.ts']) {
    assert.equal(missingDocs([f]).missing.length, 2, f);
  }
});

test('gameplay inside one game, tests and docs alone need nothing', () => {
  for (const f of ['ant-farm/src/sim/sim.ts', 'ant-farm/package.json', 'shell/test/orb.test.ts', 'scripts/check-docs.test.mjs', 'docs/presentation.md', 'prototype/ant-farm/index.html', 'cli/test/cli.test.ts', 'samples/token-garden/game.js', 'registry/games/token-garden.json']) {
    assert.deepEqual(missingDocs([f]).missing, [], f);
  }
});
