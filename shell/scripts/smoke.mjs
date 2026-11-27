// Runs a game's smoke test without ever showing a window: a fresh settings folder and a fake Claude Code folder in a
// temp directory, a full run, a second launch that checks everything came back, and a third that installs the sample
// catalog game from a test registry (samples/) and plays it sandboxed. Exits 1 on any failure.
// Run it from the game's folder, after building it:
//   node ../shell/scripts/smoke.mjs                 (screenshots go to the temp folder)
//   node ../shell/scripts/smoke.mjs --shots <dir>   (and are copied to <dir>)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const electron = createRequire(path.join(root, 'package.json'))('electron');
const shotsAt = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
const name = path.basename(root);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-smoke-`));
const out = path.join(tmp, 'out'), userData = path.join(tmp, 'user-data'), claude = path.join(tmp, 'claude-projects');
fs.mkdirSync(path.join(claude, 'demo-project'), { recursive: true });
// a transcript that already exists before the app starts: its tokens must not be counted
fs.writeFileSync(path.join(claude, 'demo-project', 'session-1.jsonl'), JSON.stringify({
  type: 'assistant', sessionId: 'session-1', timestamp: new Date(Date.now() - 60000).toISOString(),
  message: { id: 'msg_old', stop_reason: 'end_turn', usage: { input_tokens: 99999, output_tokens: 99999 } },
}) + '\n');

function run(mode) {
  return new Promise((resolve) => {
    const env = { ...process.env, TG_SMOKE: out, TG_SMOKE_MODE: mode, TG_USER_DATA: userData, TG_CLAUDE_DIR: claude };
    delete env.ELECTRON_RUN_AS_NODE;
    const p = spawn(electron, [root], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    p.stdout.on('data', (d) => { log += d; });
    p.stderr.on('data', (d) => { log += d; });
    const kill = setTimeout(() => { log += '\n(timed out after 120 s)'; p.kill('SIGKILL'); }, 120000);
    p.on('exit', (code) => {
      clearTimeout(kill);
      let result = { ok: false, checks: [{ name: 'the app wrote a result', ok: false, detail: log.slice(-2000) }] };
      try { result = JSON.parse(fs.readFileSync(path.join(out, `result-${mode}.json`), 'utf8')); } catch { /* keep the failure */ }
      resolve({ code, result });
    });
  });
}

let ok = true;
for (const mode of ['full', 'reopen', 'catalog']) {
  const { result } = await run(mode);
  console.log(`\n${mode} run`);
  for (const c of result.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok || !c.detail ? '' : '  ' + c.detail}`);
  ok = ok && result.ok;
}
const shots = fs.existsSync(out) ? fs.readdirSync(out).filter((f) => f.endsWith('.png')) : [];
if (shotsAt) {
  fs.mkdirSync(shotsAt, { recursive: true });
  for (const f of shots) fs.copyFileSync(path.join(out, f), path.join(shotsAt, f));
}
console.log(`\n${ok ? 'PASS' : 'FAIL'}: ${shots.length} screenshots in ${shotsAt || out}`);
process.exit(ok ? 0 : 1);
