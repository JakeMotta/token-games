// Screenshot every view (and the side-by-side grid) headlessly at 1440x900.
// Run: node tools/shots.js <out-dir> [view ...]
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = path.resolve(process.argv[2] || 'shots');
const ids = process.argv.slice(3).length ? process.argv.slice(3) : ['pixel', 'iso', 'hex', 'lanes', 'ink', 'neon', 'blueprint', 'toy', 'all'];
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const flags = ['--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check'];
const index = 'file://' + path.join(__dirname, '..', 'index.html');
fs.mkdirSync(out, { recursive: true });
for (const id of ids) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'td-shot-'));
  const file = path.join(out, id + '.png');
  try {
    execFileSync(chrome, ['--headless=new', ...flags, '--user-data-dir=' + profile, '--window-size=1440,900', '--hide-scrollbars',
      '--allow-file-access-from-files', '--virtual-time-budget=6000', '--screenshot=' + file, index + '?v=' + id],
    { timeout: 120000, stdio: 'ignore' });
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(file);
}
