// The cost benchmark in headless Chrome (no window): loads bench.html, which times versions 1, 2 and 3 at 1, 5 and 20
// creatures as it loads, and prints (or saves) the JSON it writes. Chrome runs with --disable-gpu, so canvases are
// drawn on the CPU: the same for every version, slower than a real window with the GPU on.
// Usage: node tools/bench.js [out.json] [frames=300] [warm=60] [counts=1,5,20]   (CHROME=/path/to/chrome overrides)
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function findChrome() {
  return [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
}

function bench(query) {
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome found; set CHROME=/path/to/chrome');
  const page = 'file://' + path.join(__dirname, '..', 'bench.html') + '?' + new URLSearchParams(query || {}).toString();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'creatures-bench-'));
  // No virtual time: it would stop the clock the benchmark reads. The page measures synchronously while it loads,
  // so --dump-dom returns once it has finished.
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1000,800',
    '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--allow-file-access-from-files', '--dump-dom', page];
  let run;
  try { run = spawnSync(chrome, args, { encoding: 'utf8', timeout: 540000, maxBuffer: 64 << 20 }); }
  finally { fs.rmSync(profile, { recursive: true, force: true }); }
  const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(run.stdout || '');
  if (!m || !m[1].startsWith('{')) throw new Error('the benchmark page wrote no result' + (run.error ? ': ' + run.error.message : ''));
  const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  out.chrome = path.basename(chrome);
  return out;
}

if (require.main === module) {
  const file = process.argv[2] && !process.argv[2].includes('=') ? process.argv[2] : null;
  const query = Object.fromEntries(process.argv.slice(file ? 3 : 2).map((a) => a.split('=')));
  const out = bench(query);
  for (const r of out.results) console.log(r.kind, String(r.n).padStart(2), 'update', r.update.avg.toFixed(3), 'p95', r.update.p95.toFixed(3), '| draw', r.draw.avg.toFixed(3), 'p95', r.draw.p95.toFixed(3));
  console.log('total', out.totalMs, 'ms; timer', out.env.timerResolutionMs, 'ms');
  if (file) { fs.writeFileSync(file, JSON.stringify(out, null, 1)); console.log('wrote', file); }
}
module.exports = { bench };
