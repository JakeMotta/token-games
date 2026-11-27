// game.json: what a valid manifest looks like, and the mistakes the build stops on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkManifest, compareVersions, SHELL_VERSION } from '../src/manifest';

const good = () => ({
  manifestVersion: 1, id: 'tower-defense', name: 'Tower Defense', description: 'Tokens queue the waves.', author: 'Someone',
  version: '0.1.0', entry: { main: 'dist/main.js', page: 'dist/index.html' }, icon: 'icon.svg', minShellVersion: '1.0.0', permissions: ['claude-usage'],
});
const errors = (m: unknown, folder?: string) => { const r = checkManifest(m, folder); return r.ok ? [] : r.errors; };

test('a complete manifest passes, and its id matches its folder', () => {
  assert.deepEqual(errors(good(), 'tower-defense'), []);
  assert.match(errors(good(), 'ant-farm').join(), /must match the folder/);
});

test('every field is required', () => {
  for (const k of Object.keys(good())) {
    const m: Record<string, unknown> = good(); delete m[k];
    assert.ok(errors(m).length > 0, `missing ${k} must fail`);
  }
});

test('bad values are named', () => {
  assert.match(errors({ ...good(), id: 'Tower_Defense' }).join(), /id must be lowercase/);
  assert.match(errors({ ...good(), version: 'one' }).join(), /version must look like/);
  assert.match(errors({ ...good(), permissions: ['network'] }).join(), /unknown permission "network"/);
  assert.match(errors({ ...good(), icon: '../secret.png' }).join(), /icon must be/);
  assert.match(errors({ ...good(), icon: 'icon.gif' }).join(), /icon must be/);
  assert.match(errors({ ...good(), entry: { main: '/etc/main.js', page: 'dist/index.html' } }).join(), /entry.main/);
  assert.match(errors({ ...good(), extra: true }).join(), /unknown field "extra"/);
  assert.match(errors({ ...good(), manifestVersion: 2 }).join(), /manifestVersion must be 1/);
  assert.match(errors([]).join(), /JSON object/);
});

test('a game that needs a newer shell is refused', () => {
  assert.match(errors({ ...good(), minShellVersion: '99.0.0' }).join(), /needs shell 99\.0\.0/);
  assert.deepEqual(errors({ ...good(), minShellVersion: SHELL_VERSION }), []);
});

test('versions compare by number, not by text', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.ok(compareVersions('0.9.9', '1.0.0') < 0);
});
