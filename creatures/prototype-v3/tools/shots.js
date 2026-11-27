// Headless screenshots of version 3 (no window opens).
// Usage: node tools/shots.js [out-dir] [name=query ...]   e.g. node tools/shots.js ../docs/shots-v3 moss='seed=moss&level=60'
// With no name=query pairs it takes the standard set used in docs/ (default out-dir ../docs/shots-v3).
// size=WxH sets the window (default 1280x900); pause=1 is added unless the query sets pause. CHROME overrides the browser.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
if (!chrome) { console.error('No Chrome found; set CHROME=/path/to/chrome'); process.exit(2); }

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'docs', 'shots-v3'));
const A = 'seed=moss&level=100';
const STANDARD = {
  'v3-original': A + '&style=original',
  'v3-cel': A + '&style=cel',
  'v3-pixel': A + '&style=pixel',
  'v3-grass': 'seed=g9&level=80&habitat=grass&sun=left',
  'v3-dirt': 'seed=g9&level=80&habitat=dirt&sun=right',
  'v3-stones': 'seed=g12&level=100&habitat=stones&sun=afternoon',
  'v3-water': 'seed=g5&level=100&habitat=water&sun=morning',
  'v3-noon': A + '&sun=noon',
  'v3-night': A + '&sun=night',
  'v3-dark': A + '&theme=dark&sun=dusk',
  'v3-skeleton': A + '&skeleton=1',
  'v3-egg': 'seed=moss',
  'v3-hatching': 'seed=moss&hatch=1.95',
  'v3-hatched': 'seed=moss&hatch=2.6',
  'v3-eating': A + '&food=apple&eat=3&hunger=0.9',
  'v3-narrow': 'seed=moss&level=60&size=520x900',
};
const jobs = process.argv.length > 3 ? Object.fromEntries(process.argv.slice(3).map((a) => a.split(/=(.*)/s).slice(0, 2))) : STANDARD;
fs.mkdirSync(out, { recursive: true });
for (const [name, query] of Object.entries(jobs)) {
  const q = new URLSearchParams(query);
  const size = (q.get('size') || '1280x900').replace('x', ',');
  const dark = q.get('theme') === 'dark';
  q.delete('size'); const file = q.get('page') || 'index.html'; q.delete('page'); if (!q.has('pause')) q.set('pause', '1');
  const page = 'file://' + path.join(__dirname, '..', file) + '?' + q.toString();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'creatures-v3-shot-'));
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=' + size,
    '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--allow-file-access-from-files', '--virtual-time-budget=8000',
    '--screenshot=' + path.join(out, name + '.png'), page];
  // Pin the colour scheme: headless Chrome otherwise follows the Mac's own light or dark mode.
  args.unshift('--blink-settings=preferredColorScheme=' + (dark ? 0 : 1));
  if (dark) args.unshift('--force-dark-mode');
  try { execFileSync(chrome, args, { timeout: 180000, stdio: 'ignore' }); }
  finally { fs.rmSync(profile, { recursive: true, force: true }); }
  console.log('wrote', path.join(out, name + '.png'));
}
