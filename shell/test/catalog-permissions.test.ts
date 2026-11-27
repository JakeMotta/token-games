// What a hosted game may reach, its Content-Security-Policy, and what the permission sheet tells the player.
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowRequest, approvedHostsFor, cspFor, permissionSheet } from '../src/catalog/permissions';

const ok = (u: string, hosts: string[] = []) => allowRequest(u, hosts, 'token-garden').allow;

test('a game reaches its own files and nothing else by default', () => {
  assert.ok(ok('tg-game://token-garden/index.html'));
  assert.ok(ok('tg-game://token-garden/img/a.png'));
  assert.ok(ok('data:image/png;base64,AAAA'));
  assert.ok(ok('blob:tg-game://token-garden/1234'));
  assert.ok(!ok('tg-game://ant-farm/index.html'), 'not another game\'s files');
  for (const u of ['https://example.com/', 'http://example.com/', 'ws://example.com/', 'wss://example.com/', 'file:///etc/passwd', 'ftp://x.io/', 'chrome-extension://abc/x', 'devtools://devtools/x', 'not a url'])
    assert.ok(!ok(u), u);
});

test('the network is open only to approved hosts, over https or wss, on the standard port', () => {
  const hosts = ['api.example.com'];
  assert.ok(ok('https://api.example.com/scores', hosts));
  assert.ok(ok('wss://api.example.com/live', hosts));
  assert.ok(ok('https://API.example.com/x', hosts), 'host names are case-insensitive');
  assert.ok(ok('https://api.example.com:443/x', hosts));
  assert.ok(!ok('https://api.example.com:8443/x', hosts));
  assert.ok(!ok('http://api.example.com/x', hosts), 'never plain http');
  assert.ok(!ok('https://evil.example.com/x', hosts), 'no subdomains of their own');
  assert.ok(!ok('https://example.com/x', hosts), 'no parent domain');
  assert.ok(!ok('https://api.example.com.evil.io/x', hosts));
});

test('the CSP allows the game itself, approved hosts, and no eval, frames, plugins or forms', () => {
  const none = cspFor('token-garden', []);
  assert.match(none, /default-src tg-game:\/\/token-garden/);
  assert.match(none, /connect-src tg-game:\/\/token-garden;/);
  assert.doesNotMatch(none, /unsafe-eval/);
  assert.doesNotMatch(none, /https:/);
  for (const d of ["object-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'"]) assert.ok(none.includes(d), d);
  assert.match(cspFor('token-garden', ['api.example.com']), /connect-src tg-game:\/\/token-garden https:\/\/api.example.com wss:\/\/api.example.com/);
});

test('the permission sheet says what the game can and cannot do', () => {
  const m = { name: 'Token Garden', version: '0.1.0', permissions: ['claude-usage' as const], network: [] as string[] };
  const plain = permissionSheet(m, 'verified').map((l) => l.text).join('\n');
  assert.match(plain, /Never your prompts, code or files/);
  assert.match(plain, /No internet/);
  assert.doesNotMatch(plain, /Community/);
  const net = permissionSheet({ ...m, network: ['api.example.com'] }, 'community');
  assert.ok(net.some((l) => l.kind === 'ask' && /api\.example\.com/.test(l.text)));
  assert.ok(net.some((l) => l.kind === 'warn' && /not reviewed/.test(l.text)));
  assert.ok(permissionSheet(m, 'local').some((l) => /folder on this computer/.test(l.text)));
  const upd = permissionSheet({ ...m, version: '0.2.0', network: ['a.example.com', 'b.example.com'] }, 'verified', { version: '0.1.0', network: ['a.example.com'] });
  assert.ok(upd.some((l) => /b\.example\.com \(new in this version\)/.test(l.text)));
  assert.ok(!upd.some((l) => /a\.example\.com \(new/.test(l.text)));
  assert.ok(upd.some((l) => /0\.1\.0 to 0\.2\.0/.test(l.text)));
});

test('approving grants exactly the listed hosts', () => {
  assert.deepEqual(approvedHostsFor({ network: ['a.example.com'] }), ['a.example.com']);
  assert.deepEqual(approvedHostsFor({}), []);
});
