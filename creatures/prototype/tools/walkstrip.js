// Frame strips of the walk cycle, rendered in Node (no browser), for checking the gait by eye.
// Usage: node tools/walkstrip.js <out.png> [--view side|game] [--level N] [--seeds 8,65,1] [--frames 14] [--mode walk|hurry]
//        [--lib dir] [--w 112] [--h 84] [--scale N]
// One row per seed, one column per frame at the sprite clock (12 fps), the camera fixed in the world so a sliding foot
// shows as a foot that moves while it is down. Markers: green = foot planted, orange = foot in the air, a grey dot
// row = the ground contact line. --lib points at another copy of genome/body/render/motion (to draw a "before").
// Prints, per seed: foot slip while planted, worst leg stretch, and how many feet are up at once.
'use strict';
const fs = require('fs');
const path = require('path');
const PNG = require('./png.js');

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : d; };
const out = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : 'walkstrip.png');
const lib = path.resolve(opt('lib', path.join(__dirname, '..')));
const G = require(path.join(lib, 'genome.js')), R = require(path.join(lib, 'render.js')), M = require(path.join(lib, 'motion.js'));
const B = require(path.join(lib, 'body.js'));
const view = opt('view', 'side');
const level = Number(opt('level', 100));
const seeds = opt('seeds', '8,65,1,9,13,86,84').split(',').map((s) => (/^\d+$/.test(s) ? Number(s) : s));
const FRAMES = Number(opt('frames', 14));
const FPS = 12, W = Number(opt('w', 112)), H = Number(opt('h', 84)), BG = [236, 232, 220];
const camView = view === 'side' ? { yaw: 0, pitch: 0.12 } : { yaw: 1.0, pitch: 0.45 };

function mark(res, x, y, rgb, r) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
    if (xx < 0 || yy < 0 || xx >= res.w || yy >= res.h) continue;
    const i = (yy * res.w + xx) * 4;
    res.rgba[i] = rgb[0]; res.rgba[i + 1] = rgb[1]; res.rgba[i + 2] = rgb[2]; res.rgba[i + 3] = 255;
  }
}

const rows = [];
for (const seed of seeds) {
  const c = G.randomCreature(seed);
  const ph = G.express(c, { level });
  const w = M.createWalker(ph, 7, { x: 0 });
  // Walk to the right for good: old and new walkers both understand these.
  const drive = { walk: true, force: opt('mode', 'walk') };
  Object.assign(w, { walking: true, walkFor: 1e9, idleFor: 1e9, dir: 1, x: -10 });
  for (let t = 0; t < 3; t += 1 / 60) M.step(w, 1 / 60, -100, 100, drive);
  const adult = R.creatureScene(ph, {});
  const fit = R.frameCamera(adult, W, H, Object.assign({ fit: true }, camView));
  const cam0 = R.frameCamera(adult, W, H, Object.assign({ px: fit.px * 1.25, groundRow: H * 0.86 }, camView));
  const x0 = w.x;
  const planted = new Map();
  let slip = 0, stretch = 0;
  const upCounts = {};
  const frames = [];
  for (let f = 0; f < FRAMES; f++) {
    let st;
    for (let k = 0; k < 5; k++) st = M.step(w, 1 / (FPS * 5), -100, 100, drive);
    const sc = R.creatureScene(ph, st.pose);
    const cam = Object.assign({}, cam0, { center: [cam0.center[0] - (st.x - x0), cam0.center[1], cam0.center[2]] });
    const res = R.render(sc, cam, {});
    const cc = R.camera(cam);
    // the ground contact line under the body path
    for (let gx = -1; gx <= 1; gx += 0.01) { const p = R.project(cc, [gx, 0, 0]); mark(res, p.x, p.y, [150, 145, 135], 0); }
    const feet = st.pose.feet || [];
    const states = (st.feetState || (w.feet || []).map((ft) => !ft.stepping && !ft.swing));
    let up = 0;
    feet.forEach((fp, i) => {
      const down = !!states[i];
      if (!down) up++;
      const p = R.project(cc, fp);
      mark(res, p.x, p.y + 2, down ? [40, 170, 70] : [240, 130, 30], 1);
      const worldX = fp[0] + st.x;
      if (down) { if (planted.has(i)) slip = Math.max(slip, Math.abs(worldX - planted.get(i))); else planted.set(i, worldX); }
      else planted.delete(i);
    });
    upCounts[up] = (upCounts[up] || 0) + 1;
    // leg stretch: hip to foot over the leg length (the scene reports its legs when the body supports it)
    if (sc.legs) for (const lg of sc.legs) stretch = Math.max(stretch, lg.stretch);
    else {
      const L = B.layout(ph);
      L.hips.forEach((hp, i) => { if (feet[i]) stretch = Math.max(stretch, B.v.len(B.v.sub(feet[i], hp.p)) / L.legLen); });
    }
    frames.push(res);
  }
  console.log(String(seed).padEnd(6), 'legs', ph.legs.pairs * 2, 'slip', (slip / ph.scale).toFixed(3), 'stretch', stretch.toFixed(2), 'feet up', JSON.stringify(upCounts));
  rows.push(...frames);
}
const sh = PNG.sheet(rows, FRAMES, BG);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, PNG.encode(sh.w, sh.h, sh.rgba, Number(opt("scale", 1))));
console.log('wrote', out);
