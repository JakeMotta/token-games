// Headless screenshots of version 2 (no window opens). page=compare.html shoots the compare lab; a name ending in
// "-film" saves the lab's filmstrip (film=1) as its own PNG instead of a screenshot.
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
  'v2-adult': 'seed=moss&level=100',
  'v2-adult-dark': 'seed=moss&level=100&theme=dark',
  'v2-sun-left': 'seed=moss&level=100&sun=left',
  'v2-sun-noon': 'seed=moss&level=100&sun=noon',
  'v2-sun-right': 'seed=moss&level=100&sun=right',
  'v2-night-dark': 'seed=moss&level=100&sun=night&theme=dark',
  'v2-pixel-cave': 'seed=g9&level=70&style=pixel&habitat=cave&sun=right',
  'v2-egg': 'seed=moss',
  'v2-narrow': 'seed=moss&level=60&size=520x900',
  'compare': 'page=compare.html&seed=moss&level=100&scenario=s-curve&t=6&size=1440x1300',
  'compare-uturn-dark': 'page=compare.html&seed=moss&level=100&scenario=u-turn&t=4.2&theme=dark&size=1440x1300',
  'compare-uturn-film': 'page=compare.html&seed=moss&level=100&scenario=u-turn&t=2&film=1',
  'compare-long-film': 'page=compare.html&seed=moss&level=100&scenario=long&t=3&film=1',
};
const jobs = process.argv.length > 3 ? Object.fromEntries(process.argv.slice(3).map((a) => a.split(/=(.*)/s).slice(0, 2))) : STANDARD;
fs.mkdirSync(out, { recursive: true });
for (const [name, query] of Object.entries(jobs)) {
  const q = new URLSearchParams(query);
  const size = (q.get('size') || '1280x900').replace('x', ',');
  const dark = q.get('theme') === 'dark';
  q.delete('size'); const file = q.get('page') || 'index.html'; q.delete('page'); if (!q.has('pause')) q.set('pause', '1'); // pause=0 keeps it walking (the debug shot)
  const page = 'file://' + path.join(__dirname, '..', file) + '?' + q.toString();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'creatures-v2-shot-'));
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=' + size,
    '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--allow-file-access-from-files', '--virtual-time-budget=8000',
    '--screenshot=' + path.join(out, name + '.png'), page];
  // Pin the colour scheme: headless Chrome otherwise follows the Mac's own light or dark mode.
  args.unshift('--blink-settings=preferredColorScheme=' + (dark ? 0 : 1));
  if (dark) args.unshift('--force-dark-mode');
  if (name.endsWith('-film')) { // dump the page and save the filmstrip it recorded
    args.splice(args.findIndex((a) => a.startsWith('--screenshot=')), 1, '--dump-dom');
    args[args.findIndex((a) => a.startsWith('--virtual-time-budget='))] = '--virtual-time-budget=30000';
  }
  let dom;
  try { dom = execFileSync(chrome, args, { timeout: 180000, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); }
  finally { fs.rmSync(profile, { recursive: true, force: true }); }
  if (name.endsWith('-film')) {
    const m = /id="strip"[^>]*src="data:image\/png;base64,([^"]+)"/.exec(dom) || /src="data:image\/png;base64,([^"]+)"[^>]*id="strip"/.exec(dom);
    if (!m) { console.error('no filmstrip in', name); process.exitCode = 1; continue; }
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(m[1], 'base64'));
  }
  console.log('wrote', path.join(out, name + '.png'));
}
