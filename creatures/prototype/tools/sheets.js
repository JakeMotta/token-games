// Contact sheets of the generator, rendered in Node with the same code the page uses (no browser).
// Usage: node tools/sheets.js <out-dir>   writes seeds.png, levels.png, temperament.png, views.png, eggs.png,
// faces.png and breeding.png, and prints how long a render takes.
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('../genome.js'), R = require('../render.js'), PNG = require('./png.js');

const out = path.resolve(process.argv[2] || 'sheets');
const W = 96, H = 96, BG = [236, 232, 220];
fs.mkdirSync(out, { recursive: true });

function shot(c, opts) {
  const ph = G.express(c, opts);
  const sc = R.creatureScene(ph, opts.pose || {});
  return R.render(sc, opts.cam || R.frameCamera(sc, W, H, { fit: true }), { style: opts.style });
}
// A camera framed on the adult and then held still, so younger levels show smaller.
function adultCam(c) {
  const sc = R.creatureScene(G.express(c, { level: 100 }), {});
  return R.frameCamera(sc, W, H, { px: R.frameCamera(sc, W, H, { fit: true }).px, groundRow: H * 0.86 });
}
const sheets = {
  seeds: [6, () => Array.from({ length: 18 }, (_, i) => shot(G.randomCreature(i + 1), { level: 100 }))],
  levels: [7, () => ['moss', 7, 12].flatMap((s) => { const c = G.randomCreature(s), cam = adultCam(c); return [1, 10, 25, 40, 55, 80, 100].map((level) => shot(c, { level, cam })); })],
  temperament: [5, () => [2, 5, 9].flatMap((s) => [-1, -0.5, 0, 0.5, 1].map((t) => shot(G.randomCreature(s), { level: 100, temperament: t })))],
  views: [4, () => [4, 11].flatMap((s) => ['inside', 'flat', 'pieces', 'gochi'].map((style) => shot(G.randomCreature(s), { level: 100, style })))],
  faces: [5, () => [3, 8].flatMap((s) => ['neutral', 'happy', 'angry', 'sleepy', 'surprised'].map((expression) => shot(G.randomCreature(s), { level: 100, expression })))],
  eggs: [6, () => [1, 2, 3, 4].flatMap((s) => { const look = G.eggLook(G.randomCreature(s)); return [{}, { crack: 0.5 }, { crack: 1 }, { crack: 1, open: 0.5 }, { crack: 1, open: 1 }].map((pose) => { const sc = R.eggScene(look, pose); return R.render(sc, R.frameCamera(sc, W, H, { px: 0.012 })); }).concat([shot(G.randomCreature(s), { level: 1, cam: R.frameCamera(R.eggScene(look, {}), W, H, { px: 0.012 }) })]); })],
  breeding: [6, () => { const a = G.randomCreature(5), b = G.randomCreature(9); return [shot(a, { level: 100 }), shot(b, { level: 100 })].concat(Array.from({ length: 10 }, (_, i) => shot(G.breed(a, b, 'kid' + i), { level: 100 }))); }],
};
for (const [name, [cols, make]] of Object.entries(sheets)) {
  const t0 = Date.now();
  const items = make();
  const ms = Date.now() - t0;
  const sh = PNG.sheet(items, cols, BG);
  fs.writeFileSync(path.join(out, name + '.png'), PNG.encode(sh.w, sh.h, sh.rgba, 2));
  console.log(name + '.png', items.length, 'renders,', Math.round(ms / items.length), 'ms each');
}
