// Builds a shell game (a Game for mountShell, like the Ant Farm) as a catalog bundle: a sandboxed "web" game folder
// that `tg-registry pack` zips (docs/catalog.md, "A shell game in the catalog"). The same source as the built-in app:
// '@token-games/shell/page/shell-page' becomes the hosted adapter (shell/src/page/hosted-shell.ts), which runs the game
// over window.tokenGame instead of the shell's page. Run it from the game's folder:
//   node ../shell/scripts/build-web.mjs            build into catalog/
//   node ../shell/scripts/build-web.mjs --check    build to a temporary folder and fail if catalog/ differs
// It expects src/web/game.json (the catalog manifest, "kind": "web"), src/web/main.ts (configures the adapter, then
// imports the game's page), src/game/index.html and the game's css, and the icon the manifest names. The output is
// the same bytes for the same source (no source maps, no timestamps), so the bundle's sha256 can be rebuilt by anyone.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const shell = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');
const check = process.argv.includes('--check');
const outDir = path.join(root, 'catalog');

function fail(lines) { console.error(lines.join('\n  ')); process.exit(1); }

// The manifest first: a catalog game with a broken manifest doesn't build
const { checkManifest } = await import('data:text/javascript;base64,' + Buffer.from((await build({
  entryPoints: [path.join(shell, 'src/manifest.ts')], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'warning',
})).outputFiles[0].text).toString('base64'));
const manifestFile = path.join(root, 'src/web/game.json');
let manifest;
try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (e) { fail([`src/web/game.json: ${e.message}`]); }
const checked = checkManifest(manifest);
if (!checked.ok) fail(['src/web/game.json is not valid:', ...checked.errors, 'See docs/manifest.md.']);
if (manifest.kind !== 'web') fail(['src/web/game.json must say "kind": "web": a catalog game is a sandboxed page']);
if (manifest.entry.page !== 'index.html') fail(['src/web/game.json: entry.page must be "index.html"']);

const out = check ? fs.mkdtempSync(path.join(os.tmpdir(), 'tg-web-')) : outDir;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// '@token-games/shell/x' is the shell's src/x, except the shell's page, which inside the sandbox is the hosted adapter
const alias = { name: 'token-games-shell', setup(b) {
  b.onResolve({ filter: /^@token-games\/shell\// }, (a) => {
    const rel = a.path.slice('@token-games/shell/'.length);
    return { path: path.join(shell, 'src', (rel === 'page/shell-page' ? 'page/hosted-shell' : rel) + '.ts') };
  });
} };
await build({
  entryPoints: ['src/web/main.ts'], outfile: path.join(out, 'app.js'), bundle: true, platform: 'browser', format: 'iife',
  target: 'es2022', sourcemap: false, legalComments: 'none', charset: 'utf8', logLevel: 'warning', absWorkingDir: root,
  plugins: [alias], nodePaths: [path.join(root, 'node_modules')],
});

// The game's page, with the adapter's styles beside the shell's
const html = fs.readFileSync(path.join(root, 'src/game/index.html'), 'utf8');
const link = '<link rel="stylesheet" href="shell.css">';
if (!html.includes(link)) fail([`src/game/index.html must link shell.css (${link})`]);
fs.writeFileSync(path.join(out, 'index.html'), html.replace(link, link + '\n<link rel="stylesheet" href="hosted-shell.css">'));
for (const f of ['shell.css', 'hosted-shell.css']) fs.copyFileSync(path.join(shell, 'src/page', f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, 'src/game'))) if (/\.(css|png)$/.test(f)) fs.copyFileSync(path.join(root, 'src/game', f), path.join(out, f));
fs.copyFileSync(manifestFile, path.join(out, 'game.json'));
if (path.basename(manifest.icon) !== manifest.icon) fail([`the icon must sit at the game's root (${manifest.icon})`]);
if (!fs.existsSync(path.join(root, manifest.icon))) fail([`the icon ${manifest.icon} is missing`]);
fs.copyFileSync(path.join(root, manifest.icon), path.join(out, manifest.icon));

const listing = (dir) => fs.readdirSync(dir).sort().map((f) => `${f} ${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')}`);
if (check) {
  const want = listing(out), have = fs.existsSync(outDir) ? listing(outDir) : [];
  fs.rmSync(out, { recursive: true, force: true });
  if (want.join('\n') !== have.join('\n')) fail(['catalog/ is out of date with the source: run `npm run build:catalog` and commit it.',
    ...want.filter((l) => !have.includes(l)).map((l) => 'differs: ' + l.split(' ')[0])]);
  console.log(`catalog/ matches the source (${manifest.id} ${manifest.version})`);
} else {
  console.log(`built ${manifest.id} ${manifest.version} into catalog/ (${fs.readdirSync(out).length} files)`);
}
