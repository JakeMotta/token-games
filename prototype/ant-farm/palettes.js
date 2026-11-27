// Ant farm prototype: palettes. The simulation paints in its own colours and, with sim.paint(px, { kind }), says
// what each pixel shows (sky, tunnel wall, soil, food, an ant...). A palette recolours each kind of pixel through
// a short ramp, keyed by how light the source pixel is, so the soil keeps its strata, grain and spoil heaps but in
// quieter colours. The farm sits in a corner of the screen while you work, so every palette but Original keeps
// saturation and contrast low, keeps bright areas small and has no pure white. A global Calm amount (0 to 1)
// lowers saturation and contrast further on top of any palette.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AntPalette = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Must match AntSim.K.
  const K = { SKY: 0, WALL: 1, SOIL: 2, GRASS: 3, LOOSE: 4, ROCK: 5, FOOD: 6, GLASS: 7, CRACK: 8, BROOD: 9, ANT: 10, QUEEN: 11, LOAD_FOOD: 12, LOAD_GRAIN: 13 };

  // Which ramp each kind uses, and the lightness range its source colours span (so the ramp's ends are reached).
  const RAMP_OF = ['sky', 'wall', 'soil', 'soil', 'soil', 'soil', 'food', 'wall', 'soil', 'brood', 'ant', 'queen', 'food', 'soil'];
  const RANGE = {
    sky: [0.15, 0.27], wall: [0.06, 0.22], soil: [0.1, 0.66], food: [0.5, 0.85],
    ant: [0.15, 0.4], queen: [0.3, 0.56], brood: [0.68, 0.93],
  };

  // Each palette: ramps (dark end first), the window chrome around it (`ui`) and a one-line note.
  // `light`/`dark` variants are picked by the desktop's appearance.
  const PALETTES = {
    original: {
      name: 'Original', note: 'the prototype colours, for comparison', identity: true, mid: '#3b2f28',
      ui: { back: '#12151d', bar: 'rgba(12,14,20,0.78)', ink: '#cfd3dc', dim: '#9aa3b5', hot: '#e8b45e', task: '#88c58f', line: 'rgba(255,255,255,0.12)' },
    },
    earth: {
      name: 'Quiet Earth', note: 'soil, food and ants in one low warm brown',
      ramps: {
        sky: ['#2b2724', '#322d29'], wall: ['#1f1c19', '#2c2723'], soil: ['#443b33', '#5f5347', '#7b6d5e'],
        food: ['#86775f', '#998868'], ant: ['#6f5f50', '#8a7663'], queen: ['#8a7663', '#9c8670'], brood: ['#958a7a', '#a69a88'],
      },
      ui: { back: '#1f1c19', bar: 'rgba(31,28,25,0.72)', ink: '#b3a796', dim: '#8a7f71', hot: '#a8916c', task: '#8f9473', line: 'rgba(255,240,220,0.06)' },
    },
    graphite: {
      name: 'Graphite', note: 'grey only, with one soft ochre for food',
      ramps: {
        sky: ['#28292b', '#2e2f32'], wall: ['#1c1d1f', '#28292c'], soil: ['#3c3e41', '#55575b', '#6f7175'],
        food: ['#8c7a58', '#a28d66'], ant: ['#7c7e82', '#93959a'], queen: ['#93959a', '#a3a5a9'], brood: ['#8e9094', '#9c9ea2'],
      },
      ui: { back: '#1c1d1f', bar: 'rgba(28,29,31,0.72)', ink: '#aeb0b4', dim: '#7f8186', hot: '#a28d66', task: '#a28d66', line: 'rgba(255,255,255,0.06)' },
    },
    slate: {
      name: 'Slate', note: 'cool blue-grey, the lowest contrast of the dark ones',
      ramps: {
        sky: ['#262b32', '#2b313a'], wall: ['#1d2127', '#272c33'], soil: ['#353c45', '#454e58', '#56606b'],
        food: ['#6f7e83', '#7f8f92'], ant: ['#6c7884', '#7d8995'], queen: ['#7d8995', '#8a97a2'], brood: ['#848f99', '#8f9aa4'],
      },
      ui: { back: '#1d2127', bar: 'rgba(29,33,39,0.72)', ink: '#a5afba', dim: '#78828e', hot: '#8fa0a8', task: '#8fa0a8', line: 'rgba(220,235,255,0.06)' },
    },
    dusk: {
      name: 'Sepia Dusk', note: 'faded photo browns under a dull mauve sky',
      ramps: {
        sky: ['#3a3138', '#43393b'], wall: ['#261f1f', '#33292a'], soil: ['#55473f', '#6d5c4f', '#86735f'],
        food: ['#a08a68', '#b09a76'], ant: ['#7c6758', '#937c6a'], queen: ['#937c6a', '#a58d78'], brood: ['#ad9e88', '#baab94'],
      },
      ui: { back: '#261f1f', bar: 'rgba(38,31,31,0.72)', ink: '#c0b09c', dim: '#93816f', hot: '#b09a76', task: '#a3a07c', line: 'rgba(255,235,215,0.07)' },
    },
    terminal: {
      name: 'Terminal', note: 'faint green on near-black, like a dimmed terminal',
      ramps: {
        sky: ['#0f1311', '#131815'], wall: ['#0c0f0d', '#121714'], soil: ['#18211b', '#202c24', '#2a382e'],
        food: ['#4e6142', '#5c7150'], ant: ['#3e5747', '#4a6654'], queen: ['#4a6654', '#557360'], brood: ['#46584b', '#506456'],
      },
      ui: { back: '#0c0f0d', bar: 'rgba(12,15,13,0.75)', ink: '#6f8a76', dim: '#4d6153', hot: '#7f9860', task: '#7f9860', line: 'rgba(150,255,180,0.05)' },
    },
    blend: {
      name: 'Desktop Blend', note: 'follows light or dark mode and sits close to the desktop’s own greys',
      dark: {
        ramps: {
          sky: ['#222327', '#26282c'], wall: ['#1b1c1f', '#232428'], soil: ['#323438', '#3e4045', '#4b4d52'],
          food: ['#706a5c', '#7d7666'], ant: ['#64676d', '#73767c'], queen: ['#73767c', '#7f8288'], brood: ['#6f7277', '#7a7d82'],
        },
        ui: { back: '#1b1c1f', bar: 'rgba(30,31,35,0.7)', ink: '#a2a5ab', dim: '#76797f', hot: '#8f8671', task: '#8f8671', line: 'rgba(255,255,255,0.07)' },
      },
      light: {
        ramps: {
          sky: ['#dcdcdf', '#d4d4d7'], wall: ['#bdbab5', '#c8c5c0'], soil: ['#a29e98', '#b0aca5', '#bebab3'],
          food: ['#a69676', '#b3a483'], ant: ['#76726c', '#86817b'], queen: ['#6d6964', '#7b7671'], brood: ['#d3cfc8', '#dbd7d0'],
        },
        ui: { back: '#c8c5c0', bar: 'rgba(236,235,232,0.78)', ink: '#5d5a55', dim: '#86827c', hot: '#8f7c55', task: '#8f7c55', line: 'rgba(0,0,0,0.08)' },
      },
    },
  };
  const ORDER = ['original', 'earth', 'graphite', 'slate', 'dusk', 'terminal', 'blend'];

  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const pack = (r, g, b) => (0xff000000 | (clamp(b) << 16) | (clamp(g) << 8) | clamp(r)) >>> 0;
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

  // The palette for this desktop appearance, with its ramps parsed.
  function resolve(id, dark) {
    const P = PALETTES[id] || PALETTES.original;
    const v = P.dark || P.light ? (dark ? P.dark : P.light) : P;
    const out = { id: PALETTES[id] ? id : 'original', name: P.name, note: P.note, identity: !!P.identity, ui: v.ui, ramps: null, mid: null };
    if (v.ramps) {
      out.ramps = {};
      for (const [k, stops] of Object.entries(v.ramps)) out.ramps[k] = stops.map(hex);
      const w = out.ramps.wall[1], s = out.ramps.soil[0];
      out.mid = [(w[0] + s[0]) / 2, (w[1] + s[1]) / 2, (w[2] + s[2]) / 2];
    } else out.mid = hex(P.mid);
    return out;
  }

  function sampleRamp(stops, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), u = f - i, a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  }

  // One colour: source pixel `c` (0xAABBGGRR) showing `kind`, under resolved palette `p` and calm 0..1.
  function mapColour(p, kind, c, calm) {
    let r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
    if (!p.identity) {
      const name = RAMP_OF[kind] || 'soil', [lo, hi] = RANGE[name];
      [r, g, b] = sampleRamp(p.ramps[name], (luma(r, g, b) - lo) / (hi - lo));
    }
    if (calm > 0) {
      // less colour first, then less contrast, pulled toward the palette's own middle tone rather than grey
      const y = luma(r, g, b) * 255, ks = 1 - 0.85 * calm, kc = 1 - 0.5 * calm, m = p.mid;
      r = m[0] + (y + (r - y) * ks - m[0]) * kc; g = m[1] + (y + (g - y) * ks - m[1]) * kc; b = m[2] + (y + (b - y) * ks - m[2]) * kc;
    }
    return pack(r, g, b);
  }

  // A reusable mapper for one palette: apply(src, kind, out) recolours a whole painted frame. It only recomputes
  // pixels that changed since the last frame, and caches each (kind, colour) pair.
  function mapper(id, o) {
    o = o || {};
    const p = resolve(id, !!o.dark), calm = Math.max(0, Math.min(1, o.calm || 0));
    const cache = new Map();
    let ps = null, pk = null;
    function apply(src, kind, out) {
      if (p.identity && calm === 0) { out.set(src); return; }
      const n = src.length;
      if (!ps || ps.length !== n) { ps = new Uint32Array(n); pk = new Uint8Array(n).fill(255); }
      for (let i = 0; i < n; i++) {
        const s = src[i], kd = kind[i];
        if (s === ps[i] && kd === pk[i]) continue;
        ps[i] = s; pk[i] = kd;
        const key = kd * 16777216 + (s & 0xffffff);
        let v = cache.get(key);
        if (v === undefined) { v = mapColour(p, kd, s, calm); cache.set(key, v); }
        out[i] = v;
      }
    }
    return { id: p.id, palette: p, calm, dark: !!o.dark, apply };
  }

  return { K, PALETTES, ORDER, resolve, mapColour, mapper, luma };
});
