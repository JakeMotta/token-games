// Proof sheets from the real page, headless (no window opens): the page draws them itself with ?proof=<kind> and this
// saves the PNG. Kinds: turn (a 180° turn), spin (a 360° spin), eat (walk to a snack, bite, swallow, be happy),
// habitats (the creature in every habitat), light (each look with the sun left, at noon, right, at dusk and at night).
// Usage: node tools/proof.js <out-dir> [name=query ...]   e.g. node tools/proof.js ../docs/shots turn-moss='proof=turn&seed=moss&level=60'
// With no name=query pairs it makes the standard set used in docs/. CHROME=/path/to/chrome overrides the browser.
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
  'proof-turn-2legs': 'proof=turn&seed=g37&level=70&debug=1',
  'proof-turn-4legs': 'proof=turn&seed=moss&level=70&debug=1',
  'proof-spin-6legs': 'proof=spin&seed=g12&level=70&debug=1',
  'proof-eat': 'proof=eat&seed=moss&level=70&habitat=meadow',
  'proof-eat-beak-pixel': 'proof=eat&seed=g9&level=60&habitat=cave&style=pixel&food=fish',
  'habitats': 'proof=habitats&seed=moss&level=70',
  'habitats-cel': 'proof=habitats&seed=g15&level=60&style=cel',
  'habitats-dusk-pixel': 'proof=habitats&seed=g37&level=70&style=pixel&time=17.3',
  'light-2legs': 'proof=light&seed=g37&level=70',
  'light-4legs': 'proof=light&seed=moss&level=70&habitat=meadow',
  'light-6legs': 'proof=light&seed=g12&level=70&habitat=studio',
  'proof-turn-dawn-4legs': 'proof=turn&seed=moss&level=70&time=7',
  'proof-spin-dusk-6legs-cel': 'proof=spin&seed=g12&level=70&time=17.2&style=cel',
};
const jobs = process.argv.length > 3 ? Object.fromEntries(process.argv.slice(3).map((a) => a.split(/=(.*)/s).slice(0, 2))) : STANDARD;
fs.mkdirSync(out, { recursive: true });
let failed = 0;
for (const [name, query] of Object.entries(jobs)) {
  const page = 'file://' + path.join(__dirname, '..', 'index.html') + '?' + query;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'creatures-proof-'));
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1280,900',
    '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--allow-file-access-from-files', '--virtual-time-budget=60000', '--dump-dom', page];
  let dom = '';
  try { dom = execFileSync(chrome, args, { encoding: 'utf8', timeout: 300000, maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); }
  finally { fs.rmSync(profile, { recursive: true, force: true }); }
  const m = dom.match(/<pre id="result">data:image\/png;base64,([A-Za-z0-9+/=]+)<\/pre>/);
  if (!m) { failed++; console.error('FAIL', name, (dom.match(/<pre id="result">([\s\S]{0,400})/) || [])[1] || 'no result'); continue; }
  fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(m[1], 'base64'));
  console.log('wrote', path.join(out, name + '.png'));
}
process.exit(failed ? 1 : 0);
