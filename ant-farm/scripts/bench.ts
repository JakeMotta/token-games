// What a frame costs at each map size, headless: simulation ticks, painting one screen of chunk tiles, and memory.
//   npm run bench
//   npm run bench -- --save <colony.json>   the same for a saved farm (read only, never written)
// A frame here is three ticks (the simulation runs at 20 Hz, the picture at up to 60) plus repainting the tiles that
// changed. "screen" is the worst case: every tile on a 1280 × 720 window at zoom 2 painted afresh (a palette change).
import fs from 'node:fs';
import { createSim, readSave, type Sim } from '../src/sim/sim';
import type { MapSize } from '../src/sim/world';
import { CELLS, CS } from '../src/sim/chunks';
import { mapper } from '../src/game/palettes';
import { visibleBox, visibleChunks } from '../src/game/render';

const gc = (globalThis as { gc?: () => void }).gc;
const mem = () => { gc?.(); const m = process.memoryUsage(); return (m.heapUsed + m.arrayBuffers) / 1048576; };
const tokens = { v: 1 as const, source: 'bench', type: 'tokens' as const, input: 40_000, output: 20_000, cache_read: 0, cache_write: 0, ts: 0 };

const saveAt = process.argv.includes('--save') ? process.argv[process.argv.indexOf('--save') + 1] : '';
const fresh = (size: MapSize): Sim => { const sim = createSim({ seed: 7, size }); sim.feed(tokens); sim.run(400); return sim; };
const saved = (): Sim => {
  const raw = JSON.parse(fs.readFileSync(saveAt, 'utf8'));
  const sim = createSim({ restore: readSave(raw, raw.seed, raw.W, raw.H)! });
  sim.feed(tokens);
  return sim;
};

for (const size of (saveAt ? ['saved'] : ['classic', 'large', 'huge', 'ridiculous']) as (MapSize | 'saved')[]) {
  const m0 = mem();
  const sim = size === 'saved' ? saved() : fresh(size);
  const cam = { ...(() => { const b = sim.interestBox(); return { x: b.x, y: b.y }; })(), s: 2 };
  const box = visibleBox(cam, 1280, 720, 1, sim.W, sim.H), cc = visibleChunks(box);
  sim.setView(box);

  // ticks, and which chunks changed while they ran
  const ver = new Map<number, number>();
  for (let cy = cc.cy0; cy <= cc.cy1; cy++) for (let cx = cc.cx0; cx <= cc.cx1; cx++) ver.set(cy * sim.chunks.cw + cx, sim.chunks.ver(cy * sim.chunks.cw + cx));
  let dirty = 0;
  const t0 = performance.now();
  for (let i = 0; i < 400; i++) {
    sim.step();
    if (i % 3 === 2) for (const [ci, v] of ver) { const now = sim.chunks.ver(ci); if (now !== v) { dirty++; ver.set(ci, now); } }
  }
  const tickMs = (performance.now() - t0) / 400;

  const px = new Uint32Array(CELLS), kind = new Uint8Array(CELLS), out = new Uint32Array(CELLS), mp = mapper('slate', { calm: 0.2, dark: true });
  const tiles = (cc.cx1 - cc.cx0 + 1) * (cc.cy1 - cc.cy0 + 1);
  const t1 = performance.now();
  for (let r = 0; r < 10; r++) for (let cy = cc.cy0; cy <= cc.cy1; cy++) for (let cx = cc.cx0; cx <= cc.cx1; cx++) { sim.paintChunk(cx, cy, px, kind); mp.paint(px, kind, out); }
  const screenMs = (performance.now() - t1) / 10, perTile = screenMs / tiles;
  const dirtyPerFrame = dirty / (400 / 3);
  const st = sim.chunkStats();
  console.log(JSON.stringify({
    size, W: sim.W, H: sim.H, ants: sim.ants.length, tickMs: +tickMs.toFixed(3), screenTiles: tiles, screenPaintMs: +screenMs.toFixed(2),
    dirtyTilesPerFrame: +dirtyPerFrame.toFixed(2), frameMs: +(3 * tickMs + dirtyPerFrame * perTile).toFixed(2),
    chunksLoaded: st.loaded, chunksChanged: st.modified, memMB: +(mem() - m0).toFixed(1), cellsPerChunk: 1 << (2 * CS),
  }));
}
