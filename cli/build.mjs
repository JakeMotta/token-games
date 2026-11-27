// Builds the three commands into dist/ (plain Node, no Electron) and the tests into dist/test/. The catalog code
// comes from the shell's source (@token-games/shell/catalog/...), the same code the app runs.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const shell = path.join(root, '..', 'shell');
const dist = path.join(root, 'dist');
const alias = { name: 'token-games-shell', setup(b) {
  b.onResolve({ filter: /^@token-games\/shell\// }, (a) => ({ path: path.join(shell, 'src', a.path.slice('@token-games/shell/'.length) + '.ts') }));
} };
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning', absWorkingDir: root, plugins: [alias] };
const tests = fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.ts')).map((f) => path.join('test', f));

fs.rmSync(dist, { recursive: true, force: true });
await Promise.all([
  build({ ...common, entryPoints: { tokengames: 'src/tokengames.ts', 'token-games-mcp': 'src/token-games-mcp.ts', 'tg-registry': 'src/tg-registry.ts' }, outdir: 'dist', banner: { js: '#!/usr/bin/env node' } }),
  build({ ...common, entryPoints: tests, outdir: 'dist/test', sourcemap: 'linked' }),
]);
for (const f of ['tokengames.js', 'token-games-mcp.js', 'tg-registry.js']) fs.chmodSync(path.join(dist, f), 0o755);
