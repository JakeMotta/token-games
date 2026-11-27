// Headless screenshots of the web model (no window opens).
// Usage: node tools/shots.js <out-dir> [name=query ...]   e.g. node tools/shots.js ../docs/shots moss-60='seed=moss&level=60'
// With no name=query pairs it takes the standard set used in docs/. CHROME=/path/to/chrome overrides the browser.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
if (!chrome) { console.error('No Chrome found; set CHROME=/path/to/chrome'); process.exit(2); }

const out = path.resolve(process.argv[2] || 'shots');
const STANDARD = {
  'page-egg': 'seed=moss',
  'page-baby': 'seed=moss&level=1',
  'page-adult': 'seed=moss&level=100',
  'page-adult-dark': 'seed=moss&level=100&theme=dark',
  'page-narrow': 'seed=moss&level=60&size=520x900',
};
const jobs = process.argv.length > 3 ? Object.fromEntries(process.argv.slice(3).map((a) => a.split(/=(.*)/s).slice(0, 2))) : STANDARD;
fs.mkdirSync(out, { recursive: true });
for (const [name, query] of Object.entries(jobs)) {
  const q = new URLSearchParams(query);
  const size = (q.get('size') || '1280x900').replace('x', ',');
  const dark = q.get('theme') === 'dark';
  q.delete('size'); if (!q.has('pause')) q.set('pause', '1'); // pause=0 keeps it walking (the debug shot)
  const page = 'file://' + path.join(__dirname, '..', q.get('page') || 'index.html') + '?' + q.toString();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'creatures-shot-'));
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=' + size,
    '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--allow-file-access-from-files', '--virtual-time-budget=8000',
    '--screenshot=' + path.join(out, name + '.png'), page];
  // Pin the colour scheme: headless Chrome otherwise follows the Mac's own light or dark mode.
  args.unshift('--blink-settings=preferredColorScheme=' + (dark ? 0 : 1));
  if (dark) args.unshift('--force-dark-mode');
  try { execFileSync(chrome, args, { timeout: 120000, stdio: 'ignore' }); }
  finally { fs.rmSync(profile, { recursive: true, force: true }); }
  console.log('wrote', path.join(out, name + '.png'));
}
