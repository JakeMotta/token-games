// Builds a game into its dist/ folder with the shell around it. Run it from the game's folder:
//   node ../shell/scripts/build-game.mjs
// It expects the layout every game has (see templates/game): game.json (checked first, see docs/manifest.md),
// src/main/main.ts (calls startShell), src/game/app.ts
// (calls mountShell), src/game/index.html and style.css, and test/*.test.ts. The shell's own tests run with every
// game's tests, so the wrapper is checked wherever it is used. Extra entry points: --extra <src.ts>:<out.js> (node).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const shell = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(path.join(root, 'package.json'))('esbuild');
const dist = path.join(root, 'dist');

// game.json first: a game with a broken manifest doesn't build
const { checkManifest, SHELL_VERSION } = await import('data:text/javascript;base64,' + Buffer.from((await build({
  entryPoints: [path.join(shell, 'src/manifest.ts')], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'warning',
})).outputFiles[0].text).toString('base64'));
const shellPkg = JSON.parse(fs.readFileSync(path.join(shell, 'package.json'), 'utf8'));
if (shellPkg.version !== SHELL_VERSION) fail([`shell/package.json says ${shellPkg.version} but SHELL_VERSION in shell/src/manifest.ts says ${SHELL_VERSION}`]);
let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf8')); } catch (e) { fail([`game.json: ${e.message}`]); }
const checked = checkManifest(manifest, path.basename(root));
if (!checked.ok) fail(checked.errors);
if (!fs.existsSync(path.join(root, manifest.icon))) fail([`the icon ${manifest.icon} is missing`]);
function fail(errors) { console.error(`game.json is not valid:\n  ${errors.join('\n  ')}\nSee docs/manifest.md.`); process.exit(1); }

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// '@token-games/shell/x' is the shell's src/x, and the shell's files find electron in the game's node_modules
const alias = { name: 'token-games-shell', setup(b) {
  b.onResolve({ filter: /^@token-games\/shell\// }, (a) => ({ path: path.join(shell, 'src', a.path.slice('@token-games/shell/'.length) + '.ts') }));
} };
const common = { bundle: true, sourcemap: 'linked', target: 'es2022', logLevel: 'warning', absWorkingDir: root, plugins: [alias], nodePaths: [path.join(root, 'node_modules')] };
const testsIn = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.test.ts')).map((f) => path.join(dir, f)) : [];
const tests = [...testsIn(path.join(root, 'test')), ...testsIn(path.join(shell, 'test'))];
const extra = process.argv.flatMap((a, i) => process.argv[i - 1] === '--extra' ? [a.split(':')] : []);

await Promise.all([
  build({ ...common, entryPoints: { main: 'src/main/main.ts', preload: path.join(shell, 'src/main/preload.ts') }, outdir: 'dist', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/game/app.ts'], outfile: 'dist/app.js', platform: 'browser', format: 'iife' }),
  tests.length && build({ ...common, entryPoints: tests, outdir: 'dist/test', outbase: path.dirname(root), platform: 'node', format: 'cjs', external: ['electron'] }),
  ...extra.map(([src, out]) => build({ ...common, entryPoints: [src], outfile: path.join('dist', out), platform: 'node', format: 'cjs' })),
]);
for (const f of ['shell.css']) fs.copyFileSync(path.join(shell, 'src/page', f), path.join(dist, f));
for (const f of fs.readdirSync(path.join(root, 'src/game'))) if (/\.(html|css|png)$/.test(f)) fs.copyFileSync(path.join(root, 'src/game', f), path.join(dist, f));
