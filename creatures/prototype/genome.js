/* Creatures prototype: the genome. A creature is a flat list of named numbers (the video's "step 1: numbers"),
   carried twice (one hidden copy from each parent). Everything here is deterministic per seed and has no DOM,
   so the tests run it in Node. In a browser it defines window.CreatureGenome. */
(function (root) {
  'use strict';

  // ---------- seeded randomness ----------
  // A seed is any string or number. It is hashed to 32 bits and drives a small fast generator (mulberry32).
  function hashSeed(seed) {
    const s = String(seed);
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function makeRng(seed) {
    let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rng = () => next();
    rng.range = (lo, hi) => lo + (hi - lo) * next();
    rng.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    rng.pick = (arr) => arr[Math.floor(next() * arr.length)];
    rng.chance = (p) => next() < p;
    rng.normal = () => { let u = 0, v = 0; while (u === 0) u = next(); v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    return rng;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

  // ---------- the gene table ----------
  // Every gene: [min, max]. Genes are grouped into pieces; a piece is inherited whole (the video's "rule 1").
  const RINGS = { head: 5, neck: 3, torso: 5, tail: 5 };
  const GENES = {};
  const PIECE = {}; // gene name -> piece
  function gene(piece, name, min, max) { GENES[name] = [min, max]; PIECE[name] = piece; }
  for (const p of ['head', 'neck', 'torso', 'tail']) {
    gene(p, p + '.length', ...({ head: [0.32, 0.85], neck: [0, 0.6], torso: [0.45, 1.25], tail: [0, 1.5] })[p]);
    gene(p, p + '.angle', ...({ head: [-0.55, 0.3], neck: [0.25, 1.25], torso: [-0.22, 0.22], tail: [-0.5, 0.9] })[p]);
    gene(p, p + '.curve', ...({ head: [-0.35, 0.35], neck: [-0.5, 0.5], torso: [-0.3, 0.3], tail: [-0.9, 0.9] })[p]);
    for (let i = 0; i < RINGS[p]; i++) {
      gene(p, `${p}.rings[${i}].width`, 0.025, 0.42);
      gene(p, `${p}.rings[${i}].height`, 0.025, 0.42);
    }
    gene(p, p + '.dom', 0, 1);
  }
  gene('tail', 'tail.tip', 0, 1);           // pale tip, like a fox brush
  gene('legs', 'legs.pairs', 0, 3.49);      // rounded: 0..3 pairs
  gene('legs', 'legs.length', 0.12, 0.8);
  gene('legs', 'legs.width', 0.028, 0.11);
  gene('legs', 'legs.foot', 0.025, 0.11);
  gene('legs', 'legs.knee', -1, 1);         // which way the knees bend
  gene('legs', 'legs.spread', 0.55, 1.15);
  gene('legs', 'legs.claws', 0, 1);
  gene('legs', 'legs.dom', 0, 1);
  gene('wings', 'wings.size', 0, 1);        // under WING_MIN: no wings
  gene('wings', 'wings.span', 0.4, 1.4);
  gene('wings', 'wings.angle', 0.2, 1.25);
  gene('wings', 'wings.fingers', 2, 4.49);
  gene('wings', 'wings.dom', 0, 1);
  gene('horns', 'horns.count', 0, 2.49);    // rounded: 0, 1 (a unicorn horn) or 2
  gene('horns', 'horns.length', 0.04, 0.5);
  gene('horns', 'horns.curve', -1, 1);
  gene('horns', 'horns.spread', 0, 1);
  gene('horns', 'horns.width', 0.02, 0.07);
  gene('horns', 'horns.dom', 0, 1);
  gene('ears', 'ears.kind', 0, 3.49);       // rounded: none, pointed, round, long
  gene('ears', 'ears.size', 0.05, 0.3);
  gene('ears', 'ears.angle', -0.6, 0.6);
  gene('ears', 'ears.dom', 0, 1);
  gene('eyes', 'eyes.size', 0.3, 1);
  gene('eyes', 'eyes.spacing', 0.35, 1);
  gene('eyes', 'eyes.height', 0, 1);
  gene('eyes', 'eyes.dom', 0, 1);
  gene('face', 'mouth.width', 0, 1);
  gene('face', 'mouth.smile', -1, 1);
  gene('face', 'fangs', 0, 1);
  gene('face', 'blush', 0, 1);
  gene('face', 'face.dom', 0, 1);
  gene('decor', 'decor.kind', 0, 4.49);     // rounded: none, sprout, flower, antennae, back spikes
  gene('decor', 'decor.size', 0, 1);
  gene('decor', 'decor.hue', 0, 360);
  gene('decor', 'decor.dom', 0, 1);
  gene('colour', 'colour.hue', 0, 360);
  gene('colour', 'colour.sat', 0.12, 0.85);
  gene('colour', 'colour.light', 0.2, 0.72);
  gene('colour', 'colour.belly', 0, 1);      // how pale the underside is
  gene('colour', 'colour.accent', 0, 1);     // horns and claws: bone white .. body colour
  gene('colour', 'colour.wing', -60, 60);    // wing membrane hue shift
  gene('colour', 'colour.dom', 0, 1);
  gene('pattern', 'pattern.kind', 0, 4.49);  // rounded: none, spots, stripes, patches, speckles
  gene('pattern', 'pattern.scale', 0, 1);
  gene('pattern', 'pattern.amount', 0, 1);
  gene('pattern', 'pattern.light', -1, 1);   // darker (-) or paler (+) marks
  gene('pattern', 'pattern.dom', 0, 1);
  gene('skin', 'gloss', 0, 1);
  gene('skin', 'fluff', 0, 1);               // how much the pieces melt together
  gene('skin', 'temperament', -1, 1);        // the video's one-bar slider: scary -1 .. +1 cute
  gene('skin', 'skin.dom', 0, 1);
  const GENE_NAMES = Object.keys(GENES);
  const PIECES = [...new Set(GENE_NAMES.map((g) => PIECE[g]))];

  const LEG_KINDS = 4, EAR_KINDS = ['none', 'pointed', 'round', 'long'];
  const DECOR_KINDS = ['none', 'sprout', 'flower', 'antennae', 'spikes'];
  const PATTERN_KINDS = ['none', 'spots', 'stripes', 'patches', 'speckles'];
  const WING_MIN = 0.42;

  // ---------- one random copy ----------
  // Pieces are drawn with some structure (a ring profile, a body size) so a random list of numbers still reads
  // as an animal; every number stays inside its gene's range.
  function ringProfile(rng, n, base, shape) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      let r;
      if (shape === 'taper') r = base * lerp(1, rng.range(0.12, 0.6), t);
      else if (shape === 'bulge') r = base * (0.65 + 0.45 * Math.sin(Math.PI * clamp(t * 0.9 + 0.05, 0, 1)));
      else if (shape === 'snout') r = base * (i === 0 ? rng.range(0.75, 0.95) : i === 1 ? 1 : lerp(0.95, rng.range(0.3, 0.7), (i - 1) / (n - 2)));
      else r = base * lerp(rng.range(0.7, 1.1), rng.range(0.7, 1.1), t);
      const squash = rng.range(0.8, 1.2);
      out.push([r * rng.range(0.92, 1.08), r * squash * rng.range(0.92, 1.08)]);
    }
    return out;
  }
  function randomCopy(rng) {
    const g = {};
    const set = (name, v) => { const [lo, hi] = GENES[name]; g[name] = clamp(v, lo, hi); };
    const any = (name) => set(name, rng.range(GENES[name][0], GENES[name][1]));
    for (const n of GENE_NAMES) any(n); // start fully random, then shape the pieces
    const torsoR = rng.range(0.13, 0.33);
    const rings = (p, base, shape) => ringProfile(rng, RINGS[p], base, shape).forEach(([w, h], i) => {
      set(`${p}.rings[${i}].width`, w); set(`${p}.rings[${i}].height`, h);
    });
    rings('torso', torsoR, 'bulge');
    // The head is usually a bit smaller than the body, sometimes far bigger (the video's owl-snake).
    const headR = torsoR * (rng.chance(0.08) ? rng.range(1.7, 2.6) : rng.range(0.55, 1.2));
    rings('head', headR, 'snout');
    rings('neck', Math.min(headR, torsoR) * rng.range(0.45, 0.8), 'even');
    rings('tail', torsoR * rng.range(0.3, 0.9), rng.chance(0.25) ? 'even' : 'taper');
    if (rng.chance(0.3)) set('tail.length', rng.range(0, 0.3));
    if (rng.chance(0.45)) set('neck.length', rng.range(0, 0.15));
    if (rng.chance(0.55)) set('wings.size', rng.range(0, WING_MIN)); // most have no wings
    if (rng.chance(0.4)) set('horns.count', rng.range(0, 0.49));
    if (rng.chance(0.35)) set('decor.kind', rng.range(0, 0.49));
    if (rng.chance(0.25)) set('pattern.kind', rng.range(0, 0.49));
    if (rng.chance(0.6)) set('fangs', rng.range(0, 0.4));
    set('legs.pairs', rng.chance(0.12) ? rng.range(0, 0.49) : rng.chance(0.7) ? rng.range(1.5, 2.49) : rng.range(0.5, 3.49));
    set('legs.width', torsoR * rng.range(0.22, 0.42));
    set('colour.light', rng.range(0.28, 0.68));
    set('temperament', rng.range(-0.6, 0.6));
    return g;
  }

  // ---------- names ----------
  const SYL_A = ['Fli', 'Cro', 'Mo', 'Pip', 'Bu', 'Ki', 'Zu', 'Lu', 'Ta', 'Gri', 'No', 'Wi', 'Sa', 'Dra', 'Pe', 'Ru', 'Mi', 'Fo', 'Ga', 'Chi'];
  const SYL_B = ['ck', 'ak', 'm', 'zz', 'b', 'n', 'pp', 'r', 'sh', 'gg', 'l', 'x', 'nd', 'ff', 'tt'];
  const SYL_C = ['er', 'le', 'o', 'y', 'a', 'it', 'kin', 'ble', 'oo', 'ie', 'us', 'el', 'on', 'ette'];
  function randomName(rng) { return rng.pick(SYL_A) + rng.pick(SYL_B) + rng.pick(SYL_C); }
  // Names breed too: the front of one parent's name and the back of the other's (Flicker + Croakle = Flickle).
  function breedName(a, b, rng) {
    const cut = (s, front) => {
      const m = front ? s.match(/^[^aeiouy]*[aeiouy]+[^aeiouy]+/i) : s.match(/[^aeiouy]*[aeiouy]+[^aeiouy]*$/i);
      return m ? m[0] : s;
    };
    const [x, y] = rng.chance(0.5) ? [a, b] : [b, a];
    let n = cut(x, true) + cut(y, false).replace(/^[^aeiouy]+/i, '');
    n = n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
    return n.length < 3 ? x : n;
  }

  // ---------- creatures ----------
  // { seed, name, generation, copies: [copyA, copyB], parents }
  function randomCreature(seed) {
    const rng = makeRng('creature:' + seed);
    return { seed: String(seed), name: randomName(rng), generation: 0, copies: [randomCopy(rng), randomCopy(rng)], parents: null };
  }

  // The copy each piece shows: whichever copy has the higher dominance number for that piece.
  function expressedCopyIndex(c, piece) { return c.copies[1][piece + '.dom'] > c.copies[0][piece + '.dom'] ? 1 : 0; }
  function genotype(c) {
    const g = {};
    for (const n of GENE_NAMES) g[n] = c.copies[expressedCopyIndex(c, PIECE[n])][n];
    return g;
  }

  // Breeding (the video's three rules): each parent passes one of its two copies of each piece, whole (rule 1 and 2,
  // so a hidden trait can skip a generation and come back); every number gets a tiny nudge, and about six babies in
  // a hundred get a real surprise (rule 3).
  const NUDGE = 0.025, SURPRISE_CHANCE = 0.06;
  function gamete(parent, rng) {
    const g = {};
    for (const piece of PIECES) {
      const from = parent.copies[rng.chance(0.5) ? 1 : 0];
      for (const n of GENE_NAMES) if (PIECE[n] === piece) g[n] = from[n];
    }
    return g;
  }
  function mutate(g, rng, surprise) {
    for (const n of GENE_NAMES) {
      const [lo, hi] = GENES[n];
      g[n] = clamp(g[n] + rng.normal() * NUDGE * (hi - lo), lo, hi);
    }
    if (surprise) {
      const fresh = randomCopy(rng);
      const piece = rng.pick(PIECES.filter((p) => !['skin'].includes(p)));
      for (const n of GENE_NAMES) if (PIECE[n] === piece) g[n] = fresh[n];
    }
    return g;
  }
  function breed(a, b, seed) {
    const rng = makeRng('breed:' + seed);
    const surprise = rng.chance(SURPRISE_CHANCE);
    const copies = [mutate(gamete(a, rng), rng, surprise), mutate(gamete(b, rng), rng, false)];
    return { seed: String(seed), name: breedName(a.name, b.name, rng), generation: Math.max(a.generation, b.generation) + 1,
      copies, parents: [a.name, b.name], surprise };
  }

  // ---------- phenotype: genome -> body numbers ----------
  // Rounded kinds and a few derived numbers, plus the one-bar slider and growth on top.
  function rings(g, p) {
    const r = [];
    for (let i = 0; i < RINGS[p]; i++) r.push({ w: g[`${p}.rings[${i}].width`], h: g[`${p}.rings[${i}].height`] });
    return r;
  }
  function maxRing(rs) { return Math.max(...rs.map((r) => Math.max(r.w, r.h))); }

  // The video's slider: one number, temperament, from scary (-1) to cute (+1). Cute: big head, big eyes, short legs,
  // blush, rounder and paler. Scary: bigger, darker, fangs, longer horns, smaller narrower eyes.
  const SPROUT_HORNS = 0.3;             // how far toward scary before a hornless creature grows horns
  function applyTemperament(ph, t) {
    const cute = Math.max(0, t), scary = Math.max(0, -t);
    // The video's captions: "cute: big head, big eyes, short legs, blush"; "scary: bigger, darker, fangs, horns".
    ph.scale *= 1 - 0.2 * cute + 0.3 * scary;
    const hs = 1 + 0.45 * cute - 0.1 * scary;
    ph.head.rings.forEach((r) => { r.w *= hs; r.h *= hs; });
    ph.head.length *= 1 - 0.25 * cute + 0.12 * scary;
    // Cute rounds the snout off: the front rings move toward the widest one.
    const m = maxRing(ph.head.rings);
    ph.head.rings.forEach((r, i) => { if (i >= 2) { r.w = lerp(r.w, m * 0.85, 0.5 * cute); r.h = lerp(r.h, m * 0.8, 0.5 * cute); } });
    ph.eyes.size *= 1 + 0.9 * cute - 0.45 * scary;
    ph.eyes.round = cute;
    ph.eyes.slant = scary;
    ph.legs.length *= 1 - 0.38 * cute + 0.15 * scary;
    ph.blush = clamp(ph.blush * 0.6 + cute * 0.9 - scary, 0, 1);
    ph.fangs = clamp(ph.fangs + scary * 1.2 - cute * 1.2, 0, 1);
    ph.horns.length *= 1 - 0.55 * cute + 0.8 * scary;
    // A hornless creature sprouts a pair as it is pushed toward scary.
    if (ph.horns.count === 0 && scary > SPROUT_HORNS) { ph.horns.count = 2; ph.horns.length *= smooth(SPROUT_HORNS, 1, scary); }
    ph.ears.size *= 1 + 0.25 * cute;
    ph.mouth.smile = clamp(ph.mouth.smile + cute - scary, -1, 1);
    ph.colour.light = clamp(ph.colour.light + 0.28 * cute * (1 - ph.colour.light) - 0.42 * scary * ph.colour.light, 0.06, 0.9);
    ph.colour.sat = clamp(ph.colour.sat * (1 - 0.45 * cute) + 0.18 * scary, 0.05, 0.95);
    ph.colour.hueShift = 25 * cute;       // a cute shift drifts the hue a little (the video's dragon turns lilac)
    ph.eyes.glow = scary;
    ph.temperament = t;
    return ph;
  }

  // ---------- growth: level 1..100 ----------
  const LEVEL_MAX = 100;
  const STAGES = [ // first level of each stage
    { name: 'baby', from: 1 }, { name: 'child', from: 26 }, { name: 'teen', from: 56 }, { name: 'adult', from: 100 },
  ];
  function stageOf(level) { let s = STAGES[0]; for (const st of STAGES) if (level >= st.from) s = st; return s.name; }
  // Growth from 0 (just hatched) to 1 (level 100). Every level moves every growing number a little, so each
  // level-up changes the body; parts also have their own windows (horns sprout in childhood, wings unfold as a teen).
  function growthOf(level) { return clamp((level - 1) / (LEVEL_MAX - 1), 0, 1); }
  function applyGrowth(ph, level) {
    const g = growthOf(level);
    const e = 1 - Math.pow(1 - g, 1.6); // fast early, slow late
    ph.level = level; ph.growth = g; ph.stage = stageOf(level);
    ph.scale *= lerp(0.5, 1, e);
    // Babies: big round head, big eyes, short legs, stubby neck and tail, pale colours, faint markings.
    const baby = 1 - e;
    const hs = 1 + 0.5 * baby;
    ph.head.rings.forEach((r) => { r.w *= hs; r.h *= hs; });
    ph.head.length *= 1 - 0.3 * baby;
    const m = maxRing(ph.head.rings);
    ph.head.rings.forEach((r, i) => { if (i >= 2) { r.w = lerp(r.w, m * 0.8, 0.55 * baby); r.h = lerp(r.h, m * 0.75, 0.55 * baby); } });
    ph.neck.length *= lerp(0.25, 1, e);
    ph.tail.length *= lerp(0.3, 1, e);
    ph.torso.length *= lerp(0.75, 1, e);
    ph.legs.length *= lerp(0.6, 1, e);
    ph.eyes.size *= 1 + 0.55 * baby;
    ph.eyes.round = clamp(ph.eyes.round + 0.8 * baby, 0, 1);
    ph.blush = clamp(ph.blush + 0.4 * baby, 0, 1);
    ph.horns.length *= smooth(20, 75, level);
    ph.ears.size *= lerp(0.55, 1, e);
    ph.wings.size *= smooth(12, 85, level);
    ph.decor.size *= lerp(0.35, 1, e);
    ph.fangs *= smooth(40, 90, level);
    ph.pattern.amount *= smooth(6, 70, level);
    ph.colour.light = clamp(ph.colour.light + 0.18 * baby * (1 - ph.colour.light), 0, 0.92);
    ph.colour.sat *= lerp(0.7, 1, e);
    ph.claws = smooth(30, 80, level) * ph.legs.claws;
    // Fully grown at 100: a final flourish (extra gloss).
    ph.gloss = clamp(ph.gloss + (level >= LEVEL_MAX ? 0.25 : 0), 0, 1);
    return ph;
  }

  // ---------- repair pass ----------
  // Rules that stop the worst babies (the video's owl-snake and potato): heads at most 1.6x the body, legs back
  // when a body has none, a neck no longer than the body, a tail no fatter than the body, rings that don't jump.
  const HEAD_MAX_RATIO = 1.6;
  function repair(ph) {
    const notes = [];
    const torsoMax = maxRing(ph.torso.rings), headMax = maxRing(ph.head.rings);
    if (headMax > HEAD_MAX_RATIO * torsoMax) {
      const s = (HEAD_MAX_RATIO * torsoMax) / headMax;
      ph.head.rings.forEach((r) => { r.w *= s; r.h *= s; });
      notes.push('head ' + HEAD_MAX_RATIO + 'x');
    }
    if (ph.legs.pairs === 0) { ph.legs.pairs = 2; notes.push('legs back'); }
    if (ph.neck.length > ph.torso.length * 1.1) { ph.neck.length = ph.torso.length * 1.1; notes.push('neck'); }
    const tailCap = torsoMax * 0.9;
    ph.tail.rings.forEach((r) => { if (r.w > tailCap) r.w = tailCap; if (r.h > tailCap) r.h = tailCap; });
    for (const p of ['head', 'neck', 'torso', 'tail']) {
      const rs = ph[p].rings;
      for (let i = 1; i < rs.length; i++) for (const k of ['w', 'h']) rs[i][k] = clamp(rs[i][k], rs[i - 1][k] / 1.9, rs[i - 1][k] * 1.9);
    }
    // Legs long enough to hold the body off the ground.
    const minLeg = maxRing(ph.torso.rings) * 0.9;
    if (ph.legs.pairs > 0 && ph.legs.length < minLeg) ph.legs.length = minLeg;
    ph.repairs = notes;
    return ph;
  }

  function phenotype(g, opts) {
    opts = opts || {};
    const piece = (p) => ({ length: g[p + '.length'], angle: g[p + '.angle'], curve: g[p + '.curve'], rings: rings(g, p) });
    const ph = {
      scale: 1,
      head: piece('head'), neck: piece('neck'), torso: piece('torso'), tail: Object.assign(piece('tail'), { tip: g['tail.tip'] }),
      legs: { pairs: Math.round(g['legs.pairs']), length: g['legs.length'], width: g['legs.width'], foot: g['legs.foot'],
        knee: g['legs.knee'], spread: g['legs.spread'], claws: g['legs.claws'] },
      wings: { size: g['wings.size'] < WING_MIN ? 0 : (g['wings.size'] - WING_MIN) / (1 - WING_MIN), span: g['wings.span'],
        angle: g['wings.angle'], fingers: Math.round(g['wings.fingers']) },
      horns: { count: Math.round(g['horns.count']), length: g['horns.length'], curve: g['horns.curve'], spread: g['horns.spread'], width: g['horns.width'] },
      ears: { kind: EAR_KINDS[Math.round(g['ears.kind'])], size: g['ears.size'], angle: g['ears.angle'] },
      eyes: { size: g['eyes.size'], spacing: g['eyes.spacing'], height: g['eyes.height'], round: 0, slant: 0, glow: 0 },
      mouth: { width: g['mouth.width'], smile: g['mouth.smile'] },
      fangs: g.fangs, blush: g.blush,
      decor: { kind: DECOR_KINDS[Math.round(g['decor.kind'])], size: g['decor.size'], hue: g['decor.hue'] },
      colour: { hue: g['colour.hue'], sat: g['colour.sat'], light: g['colour.light'], belly: g['colour.belly'],
        accent: g['colour.accent'], wing: g['colour.wing'], hueShift: 0 },
      pattern: { kind: PATTERN_KINDS[Math.round(g['pattern.kind'])], scale: g['pattern.scale'], amount: g['pattern.amount'], light: g['pattern.light'] },
      gloss: g.gloss, fluff: g.fluff, claws: g['legs.claws'],
    };
    const t = opts.temperament != null ? opts.temperament : g.temperament;
    applyTemperament(ph, clamp(t, -1, 1));
    applyGrowth(ph, opts.level != null ? clamp(Math.round(opts.level), 1, LEVEL_MAX) : LEVEL_MAX);
    if (opts.repair !== false) repair(ph); else ph.repairs = [];
    ph.expression = opts.expression || 'neutral';
    return ph;
  }

  // Genes that move when a gene slider in the prototype is dragged: overrides are applied to the shown genotype.
  function express(creature, opts) {
    opts = opts || {};
    const g = Object.assign(genotype(creature), opts.overrides || {});
    return phenotype(g, opts);
  }

  // ---------- traits and rarity ----------
  // A few readable traits, and a rarity from how unusual the creature's numbers are.
  function traits(creature) {
    const g = genotype(creature);
    const ph = phenotype(g, { level: LEVEL_MAX });
    const t = [];
    if (ph.wings.size > 0) t.push(ph.wings.size > 0.55 ? 'great wings' : 'wings');
    if (ph.horns.count === 1) t.push('unicorn horn'); else if (ph.horns.count === 2) t.push('horns');
    if (ph.legs.pairs === 3) t.push('six legs'); else if (ph.legs.pairs === 1) t.push('two legs');
    if (ph.decor.kind !== 'none') t.push(ph.decor.kind);
    if (ph.pattern.kind !== 'none') t.push(ph.pattern.kind);
    if (ph.ears.kind !== 'none') t.push(ph.ears.kind + ' ears');
    if (g['tail.length'] > 1.1) t.push('long tail');
    if (g['neck.length'] > 0.45) t.push('long neck');
    if (g.temperament > 0.45) t.push('sweet'); else if (g.temperament < -0.45) t.push('fierce');
    // Rarity: count how far out on the tails each of a few signature numbers sits.
    let score = 0;
    const far = (v, lo, hi) => { const u = (v - lo) / (hi - lo); return u < 0.06 || u > 0.94 ? 1 : 0; };
    for (const n of ['colour.hue', 'colour.sat', 'tail.length', 'neck.length', 'head.length', 'legs.length', 'eyes.size', 'wings.span', 'horns.length'])
      score += far(g[n], ...GENES[n]);
    if (ph.wings.size > 0 && ph.horns.count > 0) score += 1;
    if (ph.legs.pairs === 3) score += 1;
    if (ph.decor.kind !== 'none' && ph.pattern.kind !== 'none' && ph.wings.size > 0) score += 1;
    const rarity = score >= 4 ? 'legendary' : score >= 3 ? 'rare' : score >= 2 ? 'uncommon' : 'common';
    return { traits: t, rarity, score };
  }

  // ---------- eggs ----------
  // The egg's shell comes from the genome too, so eggs differ before they hatch: shell tint from the body colour,
  // markings from the pattern piece, marking colour from the accent/decor hue, egg shape from the body shape.
  function eggLook(creature) {
    const g = genotype(creature);
    const kinds = ['speckles', 'spots', 'zigzag', 'bands', 'speckles'];
    return {
      hue: g['colour.hue'], sat: clamp(g['colour.sat'] * 0.55, 0.08, 0.5), light: clamp(0.62 + g['colour.belly'] * 0.22, 0.6, 0.86),
      markHue: (g['colour.hue'] + 180 + g['decor.hue'] * 0.25) % 360, markLight: g['pattern.light'] > 0 ? 0.88 : 0.36,
      marks: kinds[Math.round(g['pattern.kind'])], markScale: g['pattern.scale'], markAmount: 0.35 + 0.6 * g['pattern.amount'],
      round: clamp(0.78 + (g['torso.rings[2].width'] - 0.2) * 0.8, 0.7, 0.95), gloss: g.gloss,
    };
  }

  // ---------- tokens -> levels (see docs/creature-generation.md, "Levels from Claude usage") ----------
  const HATCH_TOKENS = 25_000;          // weighted tokens of warmth to hatch an egg
  const LEVEL_BASE_TOKENS = 3_000;      // cost of level 1 -> 2
  const LEVEL_EXP = 1.15;               // each level costs a bit more than the last
  function tokensForLevelUp(level) { return Math.round(LEVEL_BASE_TOKENS * Math.pow(level, LEVEL_EXP)); }
  function tokensToReach(level) { let s = 0; for (let l = 1; l < level; l++) s += tokensForLevelUp(l); return s; }
  // Level from total weighted tokens fed since hatching.
  function levelFromTokens(tokens) {
    let l = 1, left = tokens;
    while (l < LEVEL_MAX && left >= tokensForLevelUp(l)) { left -= tokensForLevelUp(l); l++; }
    return { level: l, into: left, need: l < LEVEL_MAX ? tokensForLevelUp(l) : 0 };
  }

  // A stable short fingerprint of a creature's shown numbers (for tests and the gallery).
  function fingerprint(creature) {
    const g = genotype(creature);
    return hashSeed(GENE_NAMES.map((n) => g[n].toFixed(4)).join(',')).toString(36);
  }

  const api = { hashSeed, makeRng, GENES, GENE_NAMES, PIECES, PIECE, RINGS, WING_MIN, EAR_KINDS, DECOR_KINDS, PATTERN_KINDS,
    randomCreature, randomCopy, genotype, expressedCopyIndex, breed, breedName, randomName, phenotype, express, repair,
    applyTemperament, applyGrowth, traits, eggLook, fingerprint, STAGES, stageOf, growthOf, LEVEL_MAX, HEAD_MAX_RATIO,
    HATCH_TOKENS, LEVEL_BASE_TOKENS, LEVEL_EXP, tokensForLevelUp, tokensToReach, levelFromTokens, NUDGE, SURPRISE_CHANCE,
    clamp, lerp, smooth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreatureGenome = api;
})(typeof window !== 'undefined' ? window : globalThis);
