// The huge map: chunks made on demand, let go or packed when far away, saved as differences; culling to the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChunkStore, CELLS, CHUNK, diff, applyDiff } from '../src/sim/chunks';
import { createSim } from '../src/sim/sim';
import { AIR, DIRT, MAP_SIZES } from '../src/sim/world';
import { visibleBox, visibleChunks, minScale, MAX_TILES } from '../src/game/render';

// a generator that fills each chunk with its own index, and counts its work
function store(W = 64 * 100, H = 64 * 50) {
  let made = 0;
  const s = new ChunkStore(W, H, (cx, cy, t, c) => { made++; t.fill(DIRT); c.fill((cy * 100 + cx) & 0xffff); });
  return { s, made: () => made };
}

test('chunks are made only when something touches them', () => {
  const { s, made } = store();
  assert.equal(s.map.size, 0);
  const c = s.get(5 * 100 + 7);
  assert.equal(made(), 1);
  assert.equal(c.col![0], 507);
  s.get(507);
  assert.equal(made(), 1, 'the same chunk again is not made again');
  // reading a chunk for a picture doesn't keep it
  const t = new Uint8Array(CELLS), col = new Uint16Array(CELLS);
  s.read(42, t, col);
  assert.equal(col[0], 42);
  assert.equal(s.map.size, 1);
});

test('unchanged chunks beyond the cap are let go; changed ones are packed, never lost', () => {
  const { s } = store();
  for (let i = 0; i < 300; i++) { s.tick = i; s.get(i); }
  const changed = s.get(1000);
  changed.type![5] = AIR; changed.modified = true; changed.ver++;
  s.tick = 5000;
  s.maintain(() => false, 100, 1200);
  const st = s.stats();
  assert.ok(s.map.size <= 101, 'at most the cap plus the changed chunk: ' + s.map.size);
  assert.equal(st.packed, 1, 'the changed chunk is packed');
  assert.ok(st.bytes < 101 * CELLS * 3);
  // and comes back intact
  const back = s.get(1000);
  assert.equal(back.type![5], AIR);
  assert.equal(back.type![6], DIRT);
  // kept chunks stay
  for (let i = 0; i < 300; i++) s.get(i);
  s.maintain((c) => c.ci < 300, 10);
  assert.ok(s.map.size >= 300);
});

test('packing stores only the differences, and round-trips', () => {
  const gt = new Uint8Array(CELLS).fill(DIRT), gc = new Uint16Array(CELLS).fill(300);
  const t = gt.slice(), c = gc.slice();
  for (let i = 0; i < 200; i++) { const k = (i * 97) % CELLS; t[k] = i % 3 === 0 ? AIR : DIRT; c[k] = 1000 + i; }
  const p = diff(gt, gc, t, c);
  assert.ok(p.length < 200 * 6, 'small: ' + p.length + ' bytes');
  assert.equal(diff(gt, gc, gt, gc).length <= 4, true, 'an unchanged chunk packs to almost nothing');
  const t2 = gt.slice(), c2 = gc.slice();
  applyDiff(p, t2, c2);
  for (let k = 0; k < CELLS; k++) {
    assert.equal(t2[k], t[k]);
    if (t[k] !== AIR) assert.equal(c2[k], c[k]);
  }
});

test('the Ridiculous map starts with only a handful of chunks in memory', () => {
  const { W, H } = MAP_SIZES.ridiculous;
  const heap0 = process.memoryUsage().heapUsed;
  const sim = createSim({ seed: 8, size: 'ridiculous' });
  assert.equal(sim.W, W); assert.equal(sim.H, H);
  const st = sim.chunkStats();
  assert.ok(st.loaded < 200, 'loaded ' + st.loaded + ' of ' + (W / CHUNK) * (H / CHUNK));
  sim.run(400);
  assert.ok(sim.chunkStats().loaded < 300);
  assert.ok(process.memoryUsage().heapUsed - heap0 < 150 * 1048576, 'well under the 3 GB a flat map would need');
});

test('looking all over the Ridiculous map keeps memory bounded', () => {
  const sim = createSim({ seed: 8, size: 'ridiculous', chunkCap: 128 });
  const px = new Uint32Array(CELLS), kind = new Uint8Array(CELLS);
  for (let i = 0; i < 30; i++) {
    const x = (i * 7919) % (sim.W - 2000), y = (i * 104729) % (sim.H - 1000);
    sim.setView({ x0: x, y0: y, x1: x + 1000, y1: y + 600 });
    sim.run(40); // maintain runs every 20 ticks
    // painting what's on screen doesn't load it
    const before = sim.chunkStats().loaded;
    sim.paintChunk(x >> 6, y >> 6, px, kind);
    assert.equal(sim.chunkStats().loaded, before);
  }
  const st = sim.chunkStats();
  assert.ok(st.loaded <= 128 + 80, 'loaded ' + st.loaded);
});

test('a far, quiet part of the map does not change while the colony works', () => {
  const sim = createSim({ seed: 12, size: 'huge' });
  const far = { x0: sim.W - 600, y0: sim.H - 400, x1: sim.W - 1, y1: sim.H - 1 };
  const cells = () => { const { air, dirt, rock, loose, food, crumb } = sim.count(far); return { air, dirt, rock, loose, food, crumb }; };
  const c0 = cells();
  sim.feed({ v: 1, source: 'test', type: 'tokens', input: 20000, output: 10000, cache_read: 0, cache_write: 0, ts: 0 });
  sim.run(2000);
  assert.deepEqual(cells(), c0);
  assert.ok(sim.stats.dug > 0, 'the colony dug');
});

test('culling: only the chunks under the camera are drawn', () => {
  const cam = { x: 1000.5, y: 200.25, s: 2 };
  const b = visibleBox(cam, 800, 400, 2, 65536, 16384); // 800 × 400 device px at 2× pixel ratio, zoom 2
  assert.deepEqual(b, { x0: 1000, y0: 200, x1: 1201, y1: 301 });
  assert.deepEqual(visibleChunks(b), { cx0: 15, cy0: 3, cx1: 18, cy1: 4 });
  // the map's edges clip the box
  const e = visibleBox({ x: -50, y: -50, s: 1 }, 200, 200, 1, 100, 100);
  assert.deepEqual(e, { x0: 0, y0: 0, x1: 99, y1: 99 });
  // the farthest zoom-out still shows a bounded number of chunks
  for (const [w, h] of [[320, 180], [640, 360], [1920, 1080], [3008, 1692]]) {
    const s = minScale(w, h), v = visibleChunks(visibleBox({ x: 100.5, y: 100.5, s }, w, h, 1, 65536, 16384));
    assert.ok((v.cx1 - v.cx0 + 1) * (v.cy1 - v.cy0 + 1) <= MAX_TILES + 10, `${w} × ${h} at ×${s.toFixed(2)}`);
  }
  assert.equal(minScale(320, 180), 0.25, 'a small window zooms out all the way');
});
