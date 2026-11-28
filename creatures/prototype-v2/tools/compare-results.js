// The compare lab's measured results: runs versions 1, 2 and 3 through the same scenarios with the same creatures (in
// node, no window), feeds each one the same berries, adds the cost benchmark from headless Chrome (tools/bench.js) and
// writes compare-results.js, which the compare page shows as its results table. The verdict lines below are written
// by hand from these numbers; rerun this after changing a walker and read them again.
// Usage: node tools/compare-results.js [--bench bench.json] [--print]   (without --bench it runs the benchmark, ~4 min)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Lab = require('../lab.js');
const TD = require('../../prototype-v3/topdown.js');

const KINDS = ['v1', 'v2', 'v3'];
const SCENARIOS = ['s-curve', 'figure-eight', 'u-turn', 'legs-2', 'legs-4', 'legs-6', 'stops'];
const SEEDS = ['moss', 'g9', 'fern', 'ember', 'tide'];
const FEED_BODIES = ['own', 'legs-2', 'legs-4', 'legs-6'];

const VERDICT = {
  v1: 'The most regular step timing (it walks to a clock) and a slightly cheaper update, but its hips judder almost three times as much as version 2\'s, its worst foot slip is five times bigger and its legs cross nearly twice as often. Once in 20 feedings (two legs) it circled the berry and never reached it.',
  v2: 'The smoothest to look at: the hips glide, a planted foot hardly ever slides, fewer crossed legs and it keeps closer to the path. Its steps come when a foot falls behind, so the timing is a little less even. It costs a little more to draw than version 1 (about 29 ms a creature on the CPU against 26, its body has more pieces) and its update is a little dearer too.',
  v3: 'Version 2\'s motion seen from above, so it moves just as smoothly, and it is about eight times cheaper to draw because it paints flat shapes instead of ray-marching: five creatures fit in a 60 fps frame (15 ms) on the CPU, where versions 1 and 2 cannot draw even one (26 to 29 ms). Its wider-set feet step less evenly.',
  pick: 'Version 2\'s motion: it is the smoother one, and the difference you could not quite see is mostly the hips (version 1 jitters) and the odd sliding foot. Draw it the version 3 way whenever more than one or two creatures are on screen, because drawing, not moving, is what costs. Keep version 1 only if a clock-steady gait matters more than how smooth it looks.',
};
const CAVEATS = [
  'Cost is headless Chrome with the GPU off: every canvas is drawn on the CPU, the same for all three, and slower than a real window.',
  'Versions 1 and 2 ray-march each creature into a small sprite every frame, which is most of their drawing time; version 3 draws flat shapes.',
  'All three are timed with their shadow on. Here versions 1 and 2 both use version 1\'s cast shadow; version 2\'s own page lights its shadow differently (light.js), which is not timed.',
  'The timer in a file:// page is rounded to 0.1 ms, so update times under that are averages of many rounded readings.',
  'Smoothness and eating numbers are the same on every machine (a fixed 1/60 s step); cost numbers are this machine only.',
  'The berry and the Feed button are a prototype tool for comparing eating, not part of the game.',
];

const mean = (xs) => { const v = xs.filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const round = (x, d) => (x == null ? null : +x.toFixed(d));

function runScenario(id, seed) {
  const run = Lab.createRun({ scenario: id, seed, level: 100, kinds: KINDS, topRig: TD.rig });
  const n = Math.round(run.scn.seconds / Lab.DT);
  for (let i = 0; i < n; i++) Lab.step(run);
  return run;
}
function smoothness() {
  const byKind = {}, rows = {};
  for (const k of KINDS) rows[k] = [];
  for (const id of SCENARIOS) for (const seed of SEEDS) {
    const run = runScenario(id, seed);
    for (const a of run.actors) rows[a.kind].push(Lab.summary(a.meter));
  }
  for (const k of KINDS) {
    const r = rows[k], m = (f) => mean(r.map(f));
    byKind[k] = {
      footSlide: round(m((s) => s.footSlide), 3), footSlideMax: round(m((s) => s.footSlideMax), 2), hipJitter: round(m((s) => s.hipJitter), 3),
      wobble: round(m((s) => s.wobble), 2), strideCV: round(m((s) => s.strideCV), 1), crossings: round(m((s) => s.crossings), 2),
      pathError: round(m((s) => s.pathError), 3), tightestTurn: round(m((s) => s.tightestTurn), 3), bend: round(m((s) => s.bend), 1),
    };
  }
  return { scenarios: SCENARIOS, seeds: SEEDS, runs: SCENARIOS.length * SEEDS.length, byKind };
}
// Every version gets the same berry at the same moment (1 s in, ahead and to the left of its mouth) and the time to
// reach it and to eat it is measured.
function eating() {
  const rows = {};
  for (const k of KINDS) rows[k] = [];
  for (const body of FEED_BODIES) for (const seed of SEEDS) {
    const run = Lab.createRun({ scenario: 's-curve', seed, level: 100, kinds: KINDS, topRig: TD.rig, body, feeds: [{ at: 1 }] });
    for (let i = 0; i < 40 / Lab.DT && (run.t < 1.5 || run.actors.some((a) => a.food || a.w.mode === 'eat')); i++) Lab.step(run);
    for (const a of run.actors) rows[a.kind].push(a.meals[0]);
  }
  const byKind = {};
  for (const k of KINDS) {
    const ms = rows[k];
    byKind[k] = {
      reach: round(mean(ms.map((m) => (m.reach == null ? null : m.reach - m.drop))), 2),
      eat: round(mean(ms.map((m) => (m.swallow == null || m.reach == null ? null : m.swallow - m.reach))), 2),
      eaten: ms.filter((m) => m.done != null).length,
    };
  }
  return { bodies: FEED_BODIES, seeds: SEEDS, runs: FEED_BODIES.length * SEEDS.length, byKind };
}

function main() {
  const args = process.argv.slice(2), bi = args.indexOf('--bench');
  const b = bi >= 0 ? JSON.parse(fs.readFileSync(args[bi + 1], 'utf8')) : require('./bench.js').bench({ frames: 200, warm: 40 });
  const smooth = smoothness(), eat = eating();
  const cpu = (os.cpus()[0] || {}).model || 'unknown CPU';
  const out = {
    generated: new Date().toISOString().slice(0, 10),
    machine: cpu + ', ' + os.cpus().length + ' cores, ' + (b.chrome || 'Chrome') + ' headless, GPU off',
    bench: { counts: b.opts && b.opts.counts || [1, 5, 20], frames: b.opts.frames, warm: b.opts.warm, timerResolutionMs: b.env.timerResolutionMs,
      results: b.results.map((r) => ({ kind: r.kind, n: r.n, update: { avg: round(r.update.avg, 3), p95: round(r.update.p95, 3) }, draw: { avg: round(r.draw.avg, 2), p95: round(r.draw.p95, 2) } })) },
    smooth, eating: eat, verdict: VERDICT, caveats: CAVEATS,
  };
  out.bench.counts = [...new Set(out.bench.results.map((r) => r.n))];
  if (args.includes('--print')) { console.log(JSON.stringify({ bench: out.bench.results, smooth: smooth.byKind, eating: eat.byKind }, null, 1)); }
  const file = path.join(__dirname, '..', 'compare-results.js');
  fs.writeFileSync(file, '// Made by tools/compare-results.js: do not edit by hand.\nwindow.CreatureCompareResults = ' + JSON.stringify(out, null, 1) + ';\n');
  console.log('wrote', path.relative(process.cwd(), file));
}
main();
