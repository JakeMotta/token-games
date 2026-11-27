// Makes a new game from templates/game:   npm run new-game -- <id> ["Display Name"] [--author "Name"]
// <id> is the folder name, lowercase-with-dashes (tower-defense). Then: cd <id> && npm install && npm start.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const author = flag('--author') ?? gitName() ?? 'Unknown';
const [id, nameArg] = args;

if (!id || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) die('usage: npm run new-game -- <id> ["Display Name"] [--author "Name"]\n  <id>: lowercase letters, digits and single dashes, like tower-defense');
if (['shell', 'templates', 'scripts', 'docs', 'prototype', 'node_modules'].includes(id)) die(`${id} is one of the repo's own folders; pick another id`);
const name = nameArg ?? id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
if (name.length > 40) die('the display name must be at most 40 characters');
const dest = path.join(repo, id); // beside ant-farm: every game builds against ../shell
if (fs.existsSync(dest)) die(`${path.relative(process.cwd(), dest) || dest} already exists`);

const TEXT = /\.(ts|json|html|css|md|svg)$/;
const fill = (s) => s.replaceAll('__GAME_ID__', id).replaceAll('__GAME_NAME__', name).replaceAll('__GAME_AUTHOR__', author.replaceAll('"', ''));
(function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'shots'].includes(e.name)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copy(a, b);
    else if (TEXT.test(e.name)) fs.writeFileSync(b, fill(fs.readFileSync(a, 'utf8')));
    else fs.copyFileSync(a, b);
  }
})(path.join(repo, 'templates/game'), dest);

console.log(`Made ${name} in ${path.relative(process.cwd(), dest) || dest}/

Next:
  cd ${path.relative(process.cwd(), dest) || dest}
  npm install
  npm start             # runs it in a corner of the screen
  npm test && npm run test:smoke

Then replace the jar (src/shared/jar.ts, src/game/app.ts) with your game, and add it to the Games list in README.md.`);

function gitName() { try { return execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim() || undefined; } catch { return undefined; } }
function die(msg) { console.error(msg); process.exit(1); }
