// game.json: what a valid manifest looks like, and the mistakes the build stops on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

const web = () => ({
  manifestVersion: 1, id: 'token-garden', name: 'Token Garden', description: 'A garden that grows from tokens.', author: 'Someone',
  version: '0.1.0', kind: 'web', entry: { page: 'index.html' }, icon: 'icon.svg', minShellVersion: '1.2.0', permissions: ['claude-usage'],
});

test('a web game has a page and no main-process code', () => {
  assert.deepEqual(errors(web()), []);
  assert.match(errors({ ...web(), entry: { main: 'main.js', page: 'index.html' } }).join(), /never run main-process code/);
  assert.match(errors({ ...web(), entry: { page: 'game.js' } }).join(), /must be an \.html file/);
  assert.match(errors({ ...web(), kind: 'native' }).join(), /kind must be one of: app, web/);
  assert.match(errors({ ...web(), entry: { page: 'index.html', extra: 'x' } }).join(), /unknown field "entry.extra"/);
});

test('an app game still needs entry.main, and kind defaults to app', () => {
  assert.match(errors({ ...good(), entry: { page: 'dist/index.html' } }).join(), /entry.main must be/);
  assert.deepEqual(errors({ ...good(), kind: 'app' }), []);
});

test('network hosts are plain host names, for web games only', () => {
  assert.deepEqual(errors({ ...web(), network: ['api.example.com'] }), []);
  for (const bad of ['https://api.example.com', 'api.example.com:443', '*.example.com', 'localhost', 'API.example.com', 'example.com/path'])
    assert.match(errors({ ...web(), network: [bad] }).join(), /must be a plain lowercase host name/, bad);
  assert.match(errors({ ...web(), network: 'api.example.com' }).join(), /network must be a list/);
  assert.match(errors({ ...web(), network: ['a.example.com', 'a.example.com'] }).join(), /lists a host twice/);
  assert.match(errors({ ...web(), network: Array.from({ length: 9 }, (_, i) => `h${i}.example.com`) }).join(), /at most 8 hosts/);
  assert.match(errors({ ...good(), network: ['api.example.com'] }).join(), /network is for web games only/);
});

test('optional catalog fields are checked', () => {
  assert.deepEqual(errors({ ...web(), license: 'MIT', repository: 'https://github.com/someone/garden', screenshots: ['shots/a.png'] }), []);
  assert.match(errors({ ...web(), license: 'my licence!' }).join(), /SPDX/);
  assert.match(errors({ ...web(), repository: 'http://example.com' }).join(), /https:\/\//);
  assert.match(errors({ ...web(), screenshots: ['../a.png'] }).join(), /screenshot/);
});

test('both templates and the sample game have valid manifests', () => {
  // Built into <game>/dist/test/shell/test, so walk up to the folder that holds shell/ and templates/.
  let repo = __dirname;
  while (!fs.existsSync(path.join(repo, 'templates', 'web-game'))) { const up = path.dirname(repo); assert.notEqual(up, repo, 'repo root not found'); repo = up; }
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(repo, f), 'utf8').replaceAll('__GAME_ID__', 'my-game').replaceAll('__GAME_NAME__', 'My Game').replaceAll('__GAME_AUTHOR__', 'Me'));
  assert.deepEqual(errors(read('templates/game/game.json'), 'my-game'), []);
  assert.deepEqual(errors(read('templates/web-game/game.json'), 'my-game'), []);
  assert.equal(read('templates/web-game/game.json').kind, 'web');
  assert.deepEqual(errors(read('samples/token-garden/game.json'), 'token-garden'), []);
});
