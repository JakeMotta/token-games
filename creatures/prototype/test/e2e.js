// End-to-end check: loads a page with ?test=1 in headless Chrome (no window), lets the page run its
// scripted checks, and reads the JSON it writes into <pre id="result">.
// Usage: node test/e2e.js [seed] [page]   page is index.html (default) or creatures-standalone.html
//        (CHROME=/path/to/chrome to override the browser)
'use strict';
const { execFileSync } = require('child_process');
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
const page = 'file://' + path.join(__dirname, '..', file) + '?test=1&seed=' + seed;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'creatures-e2e-'));
const args = [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,1000',
  '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, '--allow-file-access-from-files',
  '--virtual-time-budget=20000', '--dump-dom', page,
];
let dom;
try { dom = execFileSync(chrome, args, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] }); }
finally { fs.rmSync(profile, { recursive: true, force: true }); }

const m = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
if (!m || !m[1].trim()) { console.error('FAIL: the page wrote no result'); process.exit(1); }
const res = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
for (const c of res.checks) console.log((c.pass ? 'ok   ' : 'FAIL ') + c.name + (c.pass ? '' : '  ' + JSON.stringify(c.info)));
console.log(res.pass ? 'PASS' : 'FAIL', file, 'seed', res.seed);
process.exit(res.pass ? 0 : 1);
