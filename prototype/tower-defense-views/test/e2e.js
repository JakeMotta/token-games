// End to end: load index.html?test=1 in headless Chrome and read the in-page checks.
// Run: node test/e2e.js   (CHROME=/path/to/chrome to override)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const page = 'file://' + path.join(__dirname, '..', 'index.html') + '?test=1';
const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'td-views-'));
const flags = ['--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check'];
let dom;
try {
  dom = execFileSync(chrome, ['--headless=new', ...flags, '--user-data-dir=' + profile, '--window-size=1440,900',
    '--allow-file-access-from-files', '--virtual-time-budget=15000', '--dump-dom', page], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] });
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
const m = dom.match(/<[^>]+id="result"[^>]*>([^<]*)</);
if (!m || !m[1]) { console.error('No result in the page.'); process.exit(1); }
const res = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
for (const c of res.checks) console.log((c.pass ? 'ok   ' : 'FAIL ') + c.name + (c.pass ? '' : '  ' + JSON.stringify(c.info)));
const closest = res.checks.find((c) => c.name.startsWith('no two views'));
if (closest) console.log('closest pairs:', JSON.stringify(closest.info));
console.log(res.pass ? 'PASS' : 'FAIL');
process.exit(res.pass ? 0 : 1);
