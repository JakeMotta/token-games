// Builds the app into dist/: the main process and preload for Node, the page for the browser, and the tests.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const common = { bundle: true, sourcemap: 'linked', target: 'es2022', logLevel: 'warning', absWorkingDir: root };
const tests = fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.ts')).map((f) => 'test/' + f);

await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts', 'src/main/preload.ts'], outdir: 'dist', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/game/app.ts'], outfile: 'dist/app.js', platform: 'browser', format: 'iife' }),
  build({ ...common, entryPoints: tests, outdir: 'dist/test', platform: 'node', format: 'cjs', external: ['electron'] }),
]);
for (const f of ['index.html', 'style.css']) fs.copyFileSync(path.join(root, 'src/game', f), path.join(dist, f));
