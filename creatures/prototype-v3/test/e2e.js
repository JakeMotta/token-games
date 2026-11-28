// End-to-end check for version 3: loads a page with ?test=1 in headless Chrome (no window), lets the page run its
// scripted checks, reads the JSON it writes into <pre id="result">, and fails on any console error or uncaught
// exception the browser logged.
// Usage: node test/e2e.js [seed] [page]   page is index.html (default) or creatures-v3-standalone.html
//        (CHROME=/path/to/chrome to override the browser)
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const chrome = CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) { console.error('No Chrome found; set CHROME=/path/to/chrome'); process.exit(2); }

const seed = process.argv[2] || 'test';
const file = process.argv[3] || 'index.html';
const page = 'file://' + path.join(__dirname, '..', file) + '?test=1&seed=' + encodeURIComponent(seed);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'creatures-v3-e2e-'));
const args = [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,1000',
  '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--allow-file-access-from-files', '--enable-logging=stderr', '--v=0',
  '--virtual-time-budget=30000', '--dump-dom', page,
];
let run;
try { run = spawnSync(chrome, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 64 << 20 }); }
finally { fs.rmSync(profile, { recursive: true, force: true }); }

// Console messages and uncaught exceptions show up in Chrome's log as CONSOLE lines; the page never logs anything,
// so any console line counts as a failure.
const consoleErrors = (run.stderr || '').split('\n').filter((l) => /:CONSOLE[:(]/.test(l));
for (const l of consoleErrors) console.log('FAIL console: ' + l.trim().slice(0, 300));

let pass = consoleErrors.length === 0;
const m = (run.stdout || '').match(/<pre id="result">([\s\S]*?)<\/pre>/);
if (!m || !m[1].trim()) { console.error('FAIL: the page wrote no result'); process.exit(1); }
const res = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
for (const c of res.checks) console.log((c.pass ? 'ok   ' : 'FAIL ') + c.name + (c.pass ? '' : '  ' + JSON.stringify(c.info)));
pass = pass && res.pass;
console.log(pass ? 'PASS' : 'FAIL', file, 'seed', seed, res.checks.length + ' checks,', consoleErrors.length ? consoleErrors.length + ' console errors' : 'no console errors');
process.exit(pass ? 0 : 1);
