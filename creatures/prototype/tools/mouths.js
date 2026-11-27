// A sheet of mouths: one row per seed (picked so every mouth kind shows), columns are closed and open in each look.
// Usage: node tools/mouths.js <out.png> [--seeds a,b,c] [--level N] [--w 120] [--h 96] [--scale N]
// Prints each seed's mouth kind. Rendered in Node, no browser.
'use strict';
const fs = require('fs');
const path = require('path');
const PNG = require('./png.js');
const G = require('../genome.js'), R = require('../render.js');

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : 'mouths.png');
const level = Number(opt('level', 100));
const W = Number(opt('w', 120)), H = Number(opt('h', 96)), BG = [236, 232, 220];

// Two seeds per mouth kind unless --seeds is given.
let seeds = opt('seeds', '');
if (seeds) seeds = seeds.split(',');
else {
  const want = {};
  seeds = [];
  for (let i = 0; i < 2000 && seeds.length < 10; i++) {
    const kind = G.express(G.randomCreature(i), { level }).mouth.kind;
    if ((want[kind] || 0) < 2) { want[kind] = (want[kind] || 0) + 1; seeds.push(i); }
  }
}
const cells = [];
for (const seed of seeds) {
  const ph = G.express(G.randomCreature(seed), { level });
  console.log(String(seed).padEnd(6), ph.mouth.kind);
  const adult = R.creatureScene(ph, {});
  // a 3/4 view from the front so the mouth shows
  const fit = R.frameCamera(adult, W, H, { fit: true, yaw: 0.75, pitch: 0.25 });
  // close on the head: the mouth sits a little right of the middle
  const cam = Object.assign({}, fit, { px: fit.px * 0.75, center: adult.mouth.p.map((c, i) => c - [0.35, -0.05, 0][i] * ph.scale) });
  for (const look of R.looks) for (const open of [0, 1]) {
    const sc = R.creatureScene(ph, { mouthOpen: open, expression: open ? null : undefined });
    cells.push(R.render(sc, cam, { style: look }));
  }
}
const sh = PNG.sheet(cells, R.looks.length * 2, BG);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, PNG.encode(sh.w, sh.h, sh.rgba, Number(opt('scale', 2))));
console.log('wrote', out, 'columns:', R.looks.map((l) => l + ' closed, open').join(' | '));
