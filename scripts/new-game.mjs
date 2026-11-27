// Makes a new game from a template:   npm run new-game -- <id> ["Display Name"] [--author "Name"] [--web] [--into <folder>]
// <id> is the folder name, lowercase-with-dashes (tower-defense).
//   default   an app game from templates/game, beside ant-farm. Then: cd <id> && npm install && npm start.
//   --web     a catalog (web) game from templates/web-game, in samples/<id>: plain HTML and JS, no build step, run
//             sandboxed by the shell's catalog (docs/publishing-a-game.md). This is the kind anyone can publish.
//   --into    make it in <folder>/<id> instead, for example a folder of your own outside this repo.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const toggle = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const author = flag('--author') ?? gitName() ?? 'Unknown';
const into = flag('--into');
const web = toggle('--web');
const [id, nameArg] = args;

if (!id || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) die('usage: npm run new-game -- <id> ["Display Name"] [--author "Name"] [--web] [--into <folder>]\n  <id>: lowercase letters, digits and single dashes, like tower-defense');
if (!into && ['shell', 'templates', 'scripts', 'docs', 'prototype', 'node_modules', 'samples', 'cli', 'registry'].includes(id)) die(`${id} is one of the repo's own folders; pick another id`);
const name = nameArg ?? id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
if (name.length > 40) die('the display name must be at most 40 characters');
// An app game sits beside ant-farm, since it builds against ../shell. A web game needs nothing from the repo.
const dest = path.resolve(into ?? (web ? path.join(repo, 'samples') : repo), id);
const shown = path.relative(process.cwd(), dest) || dest;
if (fs.existsSync(dest)) die(`${shown} already exists`);

const TEXT = /\.(ts|js|json|html|css|md|svg)$/;
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
})(path.join(repo, web ? 'templates/web-game' : 'templates/game'), dest);

console.log(web ? `Made ${name} in ${shown}/

Next:
  Try it: open Token Games, then Settings > Games > Add local folder, and pick ${shown}
  (or: tokengames install --dir ${shown}, then approve it in the app).
  Edit game.js, index.html and style.css; there is no build step.
  Publish it: docs/publishing-a-game.md.` : `Made ${name} in ${shown}/

Next:
  cd ${shown}
  npm install
  npm start             # runs it in a corner of the screen
  npm test && npm run test:smoke

Then replace the jar (src/shared/jar.ts, src/game/app.ts) with your game, and add it to the Games list in README.md.`);

function gitName() { try { return execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim() || undefined; } catch { return undefined; } }
function die(msg) { console.error(msg); process.exit(1); }
