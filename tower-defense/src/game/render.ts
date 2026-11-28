// Draws the page: paper, the road, the castle, every tower and doodle, shots and splats, the ink bucket. A faithful
// port of the ink mock-up (prototype views, ink.js) to the simulation's 960 × 528 page. Drawing only: it reads the
// game and never changes it. Walkers, shots and cranes are drawn between their last two steps (alpha), so the motion
// is smooth at any frame rate.
import { ENEMIES } from '../sim/enemies';
import { BUCKET, CASTLE, CELL, COLS, H, ROAD, ROAD_PTS, ROWS, W } from '../sim/map';
import { fmt } from '../sim/num';
import { TOWERS, ROMAN, type TowerId } from '../sim/towers';
import type { Enemy, TDGame, Tower } from '../sim/game';
import { HAND, Pen, hash, type Palette } from './ink';

export interface View { s: number; ox: number; oy: number; w: number; h: number; dpr: number } // page → css pixels
export interface Ghost { type: TowerId; cx: number; cy: number; why: string; moving: Tower | null }
export interface DrawOpts {
  alpha: number; // how far between the last step and the next (0..1)
  t: number; // seconds, real time: the boil and the walking legs
  reduced: boolean; // Reduced motion: no floating labels or big words, the lines boil once a second
  mini: boolean; // the orb: just the page, no words
  sel: Tower | null; ghost: Ghost | null;
  toast: { text: string; at: number } | null;
}

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// the road's two edges, offset from its centre line (the mock-up's 0.42 U)
const EDGES = [1, -1].map((sgn) => ROAD_PTS.map(([x, y], i) => {
  const [ax, ay] = ROAD_PTS[Math.max(0, i - 1)], [bx, by] = ROAD_PTS[Math.min(ROAD_PTS.length - 1, i + 1)];
  const l = Math.hypot(bx - ax, by - ay) || 1;
  return [x - ((by - ay) / l) * ROAD * sgn, y + ((bx - ax) / l) * ROAD * sgn] as [number, number];
}));

export class Renderer {
  pen: Pen;
  private paperKey = '';
  private paperCv: HTMLCanvasElement | null = null;
  private order: Enemy[] = [];
  private byY: Tower[] = [];

  constructor(public c: CanvasRenderingContext2D, P: Palette) { this.pen = new Pen(c, P); }

  set palette(P: Palette) { this.pen.P = P; this.paperKey = ''; }
  get P(): Palette { return this.pen.P; }

  draw(g: TDGame, v: View, o: DrawOpts): void {
    const c = this.c, pen = this.pen, P = pen.P;
    pen.boil = o.reduced ? Math.floor(o.t) : Math.floor(o.t * 4);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.paper(v), 0, 0);
    c.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy);
    c.lineCap = 'round'; c.lineJoin = 'round';
    this.road();
    if (o.ghost) this.grid(o.ghost);
    this.castle();
    if (o.sel && !o.mini) this.reach(o.sel.x, o.sel.y, rangeOf(o.sel), o.sel.id * 3, P.red);
    for (const t of g.towers) if (t.type === 'candle' && t.firing > 0) this.cone(t);

    // towers and walkers, back to front
    const ts = this.byY; ts.length = 0;
    for (const t of g.towers) if (t.type !== 'tack') ts.push(t); else this.tack(t, o);
    ts.sort((a, b) => a.y + TOWERS[a.type].size * 12 - (b.y + TOWERS[b.type].size * 12));
    const es = this.order; es.length = 0;
    for (const e of g.enemies) if (e.alive) es.push(e);
    es.sort((a, b) => a.y - b.y);
    let i = 0;
    for (const t of ts) {
      const foot = t.y + TOWERS[t.type].size * 12 - 7;
      while (i < es.length && lerp(es[i].py, es[i].y, o.alpha) + 6 < foot) this.enemy(es[i++], o);
      this.tower(t, o);
    }
    while (i < es.length) this.enemy(es[i++], o);

    if (o.ghost) this.ghost(o.ghost);
    this.shots(g, o);
    this.cranes(g, o);
    this.fx(g, o);
    this.bucket(g, o);
    if (o.toast && !o.mini && o.t - o.toast.at < 1.6) pen.text(o.toast.text, W / 2, 124, 38, P.red, 'center');
  }

  // ---- the paper: specks, faint rules and a red margin, drawn once per size --------------------------------------

  private paper(v: View): HTMLCanvasElement {
    const key = `${v.w}x${v.h}@${v.dpr}:${v.s.toFixed(4)},${v.ox.toFixed(1)},${v.oy.toFixed(1)}:${this.P.paper}`;
    if (this.paperCv && key === this.paperKey) return this.paperCv;
    const cv = this.paperCv ?? document.createElement('canvas'), P = this.P;
    cv.width = Math.max(1, Math.round(v.w * v.dpr)); cv.height = Math.max(1, Math.round(v.h * v.dpr));
    const c = cv.getContext('2d')!;
    c.fillStyle = P.paper; c.fillRect(0, 0, cv.width, cv.height);
    c.setTransform(v.dpr * v.s, 0, 0, v.dpr * v.s, v.dpr * v.ox, v.dpr * v.oy);
    // the page reaches past the window's edges a little, so a wide window shows more paper, not a border
    const x0 = -v.ox / v.s, y0 = -v.oy / v.s, x1 = (v.w - v.ox) / v.s, y1 = (v.h - v.oy) / v.s;
    const n = Math.round(1600 * ((x1 - x0) * (y1 - y0)) / (W * H));
    for (let i = 0; i < Math.min(6000, n); i++) {
      c.fillStyle = `rgba(${P.speck},${(hash(i * 3) * 0.08).toFixed(3)})`;
      c.fillRect(x0 + hash(i) * (x1 - x0), y0 + hash(i + 9) * (y1 - y0), 1 + hash(i * 7) * 2, 1);
    }
    c.strokeStyle = P.rule; c.lineWidth = 1;
    for (let y = 38 + Math.floor((y0 - 38) / 30) * 30; y < y1; y += 30) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); }
    c.strokeStyle = P.margin; c.beginPath(); c.moveTo(70, y0); c.lineTo(70, y1); c.stroke();
    this.paperCv = cv; this.paperKey = key;
    return cv;
  }

  // ---- the road and the castle ----------------------------------------------------------------------------------

  private road(): void {
    const c = this.c, pen = this.pen;
    c.strokeStyle = pen.P.ink; c.lineWidth = 2.4;
    EDGES.forEach((s, k) => {
      const sgn = k ? -1 : 1;
      c.beginPath();
      s.forEach(([x, y], i) => (i ? c.lineTo(x + pen.j(i * sgn, 1.2), y + pen.j(i * sgn + 50, 1.2)) : c.moveTo(x, y)));
      c.stroke();
    });
    const [a, b] = EDGES;
    c.strokeStyle = pen.P.soft; c.lineWidth = 1.2; c.beginPath();
    for (let i = 2; i < ROAD_PTS.length - 1; i += 3) pen.l(a[i][0], a[i][1], lerp(b[i][0], a[i][0], 0.55) - 6, lerp(b[i][1], a[i][1], 0.55) + 6, i * 7);
    c.stroke();
  }

  private castle(): void {
    const c = this.c, pen = this.pen, P = pen.P, [ca, cb] = CASTLE;
    c.fillStyle = P.paper; c.fillRect(ca - 30, cb - 50, 60, 50);
    c.strokeStyle = P.ink; c.lineWidth = 2.2; c.beginPath();
    pen.l(ca - 30, cb, ca - 30, cb - 50, 901); pen.l(ca + 30, cb, ca + 30, cb - 50, 902); pen.l(ca - 30, cb - 50, ca + 30, cb - 50, 903);
    for (let i = 0; i < 4; i++) pen.l(ca - 30 + i * 20, cb - 50, ca - 30 + i * 20, cb - 60, 910 + i);
    pen.l(ca, cb - 50, ca, cb - 74, 920);
    c.moveTo(ca + 11, cb); c.arc(ca, cb, 11, 0, Math.PI, true);
    c.stroke();
    c.fillStyle = P.red; c.beginPath(); c.moveTo(ca, cb - 60); c.lineTo(ca + 16, cb - 66); c.lineTo(ca, cb - 72); c.fill();
  }

  // ---- towers ---------------------------------------------------------------------------------------------------

  private tower(t: Tower, o: DrawOpts): void {
    const P = this.P, size = TOWERS[t.type].size, half = (size * CELL) / 2;
    const fx = t.x, fy = t.y + half - 7;
    this.c.strokeStyle = P.soft; this.pen.line(fx - half + 6, fy + 2, fx + half - 6, fy + 2, t.id * 7, 1);
    sketch(this.pen, t.type, t.level, fx, fy, size === 3 ? 1.2 : 1, t.id, t.heading, t.recoil, t.firing > 0, o.t);
    if (!o.mini) {
      const label = t.level < 40 ? ROMAN(t.level) : fmt(t.level);
      this.pen.text(label, fx + half - 8, fy - 8, 22, t.level >= 10 ? P.red : P.ink);
    }
  }

  // the Thumbtack sits on the road, seen from above
  private tack(t: Tower, o: DrawOpts): void {
    const c = this.c, pen = this.pen, P = pen.P, r = 10 + Math.min(4, Math.floor(t.level / 10));
    c.fillStyle = P.shadow; c.beginPath(); c.ellipse(t.x + 3, t.y + 4, r, r * 0.8, 0, 0, TAU); c.fill();
    c.strokeStyle = P.ink; pen.circle(t.x, t.y, r, t.id * 5, P.red, 2);
    pen.circle(t.x - r * 0.25, t.y - r * 0.25, r * 0.35, t.id * 5 + 20, P.paper, 1.2);
    if (t.recoil > 0 && !o.reduced) {
      c.strokeStyle = P.ink; c.lineWidth = 1.4; c.beginPath();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.3; pen.l(t.x + Math.cos(a) * (r + 3), t.y + Math.sin(a) * (r + 3), t.x + Math.cos(a) * (r + 9), t.y + Math.sin(a) * (r + 9), k + t.id); }
      c.stroke();
    }
    if (!o.mini) pen.text(t.level < 40 ? ROMAN(t.level) : fmt(t.level), t.x + r + 4, t.y - r, 20, t.level >= 10 ? P.red : P.ink);
  }

  // the Candle's flame cone while it burns
  private cone(t: Tower): void {
    const c = this.c, pen = this.pen, a = t.heading, w = t.st.area, r = t.st.range, cx = t.x, cy = t.y - 20;
    c.fillStyle = pen.P.flame; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r, a - w, a + w); c.closePath(); c.fill();
    c.strokeStyle = pen.P.red; c.lineWidth = 1.2; c.beginPath();
    pen.l(cx, cy, cx + Math.cos(a - w) * r, cy + Math.sin(a - w) * r, t.id + 1);
    pen.l(cx, cy, cx + Math.cos(a + w) * r, cy + Math.sin(a + w) * r, t.id + 2);
    c.stroke();
  }

  private reach(x: number, y: number, r: number, seed: number, color: string): void {
    const c = this.c;
    c.strokeStyle = color; c.setLineDash([2, 7]); this.pen.circle(x, y, r, seed, undefined, 1.6); c.setLineDash([]);
  }

  // ---- placing: the soft grid near the pointer, and the ghost (clear when it fits, red and hatched when not) ------

  private grid(gh: Ghost): void {
    const c = this.c, size = TOWERS[gh.type].size, mx = gh.cx + size / 2, my = gh.cy + size / 2;
    c.fillStyle = this.P.soft;
    for (let r = Math.max(0, Math.floor(my - 6)); r <= Math.min(ROWS, Math.ceil(my + 6)); r++) {
      for (let k = Math.max(0, Math.floor(mx - 8)); k <= Math.min(COLS, Math.ceil(mx + 8)); k++) {
        const d = Math.hypot(k - mx, r - my);
        if (d > 7) continue;
        c.globalAlpha = 0.9 * (1 - d / 7);
        c.fillRect(k * CELL - 1, r * CELL - 1, 2, 2);
      }
    }
    c.globalAlpha = 1;
  }

  private ghost(gh: Ghost): void {
    const c = this.c, pen = this.pen, P = pen.P, d = TOWERS[gh.type], size = d.size;
    const x = gh.cx * CELL, y = gh.cy * CELL, wpx = size * CELL, ok = !gh.why;
    const range = gh.moving ? rangeOf(gh.moving) : d.range;
    this.reach(x + wpx / 2, y + wpx / 2, range, 77, ok ? P.blue : P.red);
    c.save();
    c.beginPath(); c.rect(x, y, wpx, wpx); c.clip();
    if (ok) { c.fillStyle = P.faint; c.fillRect(x, y, wpx, wpx); }
    else {
      c.strokeStyle = P.red; c.lineWidth = 1.4; c.beginPath();
      for (let k = -wpx; k < wpx; k += 8) pen.l(x + k, y + wpx, x + k + wpx, y, 600 + k);
      c.stroke();
    }
    c.restore();
    c.strokeStyle = ok ? P.ink : P.red; c.setLineDash([5, 5]); c.lineWidth = 1.6; c.strokeRect(x + 1, y + 1, wpx - 2, wpx - 2); c.setLineDash([]);
    c.globalAlpha = ok ? 0.75 : 0.35;
    if (d.onRoad) { c.strokeStyle = P.ink; pen.circle(x + wpx / 2, y + wpx / 2, 10, 5, P.red, 2); }
    else sketch(pen, gh.type, gh.moving?.level ?? 1, x + wpx / 2, y + wpx - 7, size === 3 ? 1.2 : 1, 3, -0.6, 0, false, 0);
    c.globalAlpha = 1;
    if (!ok) {
      const tx = Math.min(W - 90, Math.max(90, x + wpx / 2)), ty = y > 60 ? y - 10 : y + wpx + 26;
      pen.text(gh.why, tx, ty, 24, P.red, 'center');
    }
  }

  // ---- walkers --------------------------------------------------------------------------------------------------

  private enemy(e: Enemy, o: DrawOpts): void {
    const c = this.c, pen = this.pen, P = pen.P, def = ENEMIES[e.type], r = def.r;
    const x = lerp(e.px, e.x, o.alpha), y = lerp(e.py, e.y, o.alpha) + 6, id = e.uid;
    const step = !o.reduced && Math.sin(o.t * 12 + id) > 0;
    const fill = e.flash > 0 && !o.reduced ? P.red : e.slow > 0 ? P.chill : P.paper;
    c.save();
    if (def.flies) {
      // a paper plane: no legs, a soft shadow on the road below
      c.fillStyle = P.shadow; c.beginPath(); c.ellipse(x, y, r, r * 0.3, 0, 0, TAU); c.fill();
      c.translate(x, y - r * 2.4 - Math.sin(o.t * 3 + id) * (o.reduced ? 0 : 2));
      if (e.dir < 0) c.scale(-1, 1);
      c.beginPath(); c.moveTo(r * 1.3, 0); c.lineTo(-r, -r * 0.7); c.lineTo(-r * 0.4, 0); c.lineTo(-r, r * 0.5); c.closePath();
      c.fillStyle = fill; c.fill();
      c.strokeStyle = P.ink; c.lineWidth = 1.8; c.beginPath();
      pen.l(r * 1.3, 0, -r, -r * 0.7, id); pen.l(-r, -r * 0.7, -r * 0.4, 0, id + 1); pen.l(-r * 0.4, 0, -r, r * 0.5, id + 2); pen.l(-r, r * 0.5, r * 1.3, 0, id + 3); pen.l(r * 1.3, 0, -r * 0.4, 0, id + 4);
      c.stroke();
      c.restore();
      this.hp(e, x, y - r * 2.4 - 4, r);
      return;
    }
    c.translate(x, y - r);
    if (e.dir < 0) c.scale(-1, 1);
    c.strokeStyle = P.ink; c.lineWidth = 1.8; c.beginPath();
    pen.l(-r * 0.4, r * 0.7, -r * 0.5 + (step ? 4 : -2), r + 4, id * 3);
    pen.l(r * 0.4, r * 0.7, r * 0.5 + (step ? -2 : 4), r + 4, id * 3 + 1);
    c.stroke();
    c.lineWidth = e.type === 'boss' || e.type === 'editor' ? 2.8 : 2.2;
    if (e.type === 'blot' || e.type === 'editor' || e.type === 'eraser') {
      // a box: the armoured Blot (with its horns), the Eraser (a band round it), the Editor (bigger, with glasses)
      const h = e.type === 'eraser' ? r * 0.75 : r;
      c.beginPath(); c.rect(-r, -h, r * 2, h * 2); c.fillStyle = fill; c.fill();
      c.beginPath(); pen.l(-r, -h, r, -h, id); pen.l(r, -h, r, h, id + 1); pen.l(r, h, -r, h, id + 2); pen.l(-r, h, -r, -h, id + 3);
      if (e.type === 'blot') { pen.l(-r * 0.6, -r, -r * 0.9, -r * 1.5, id + 4); pen.l(r * 0.6, -r, r * 0.9, -r * 1.5, id + 5); }
      if (e.type === 'eraser') { pen.l(-r * 0.2, -h, -r * 0.2, h, id + 6); }
      c.stroke();
      if (e.type === 'blot') { c.strokeStyle = P.soft; c.lineWidth = 1; c.beginPath(); for (let k = 0; k < 4; k++) pen.l(-r + 3 + k * 5, r - 2, -r + 9 + k * 5, r - 8, id + 10 + k); c.stroke(); }
    } else {
      const rr = e.type === 'gnat' ? r : r;
      c.beginPath(); pen.o(0, 0, rr, id * 5); c.fillStyle = fill; c.fill(); c.stroke();
      if (e.type === 'ditto') { c.lineWidth = 1.2; c.beginPath(); pen.o(-3, 2, rr * 0.8, id * 5 + 30); c.stroke(); }
      if (e.type === 'dash' && !o.reduced) { c.strokeStyle = P.soft; c.lineWidth = 1.2; c.beginPath(); for (let k = 0; k < 3; k++) pen.l(-r - 6, -r * 0.4 + k * r * 0.4, -r - 16, -r * 0.4 + k * r * 0.4, id + k); c.stroke(); }
      if (e.type === 'gnat') { c.strokeStyle = P.soft; c.lineWidth = 1.2; c.beginPath(); pen.o(-3, -r - 2, r * 0.7, id + 40); pen.o(4, -r - 2, r * 0.7, id + 50); c.stroke(); }
    }
    c.fillStyle = P.ink;
    const eye = Math.max(1.6, r * 0.12);
    c.beginPath(); c.arc(r * 0.3, -r * 0.2, eye, 0, TAU); c.arc(r * 0.62, -r * 0.2, eye, 0, TAU); c.fill();
    if (e.type === 'editor') {
      c.strokeStyle = P.ink; c.lineWidth = 1.4; c.beginPath(); c.arc(r * 0.3, -r * 0.2, eye * 2.6, 0, TAU); c.moveTo(r * 0.62 + eye * 2.6, -r * 0.2); c.arc(r * 0.62, -r * 0.2, eye * 2.6, 0, TAU); c.stroke();
      // the red pen it marks you down with
      c.strokeStyle = P.red; c.lineWidth = 3; c.beginPath(); pen.l(r * 0.9, r * 0.2, r * 1.5, -r * 0.6, id + 70); c.stroke();
    }
    if (e.type === 'boss' || e.type === 'editor') {
      c.strokeStyle = P.ink; c.lineWidth = 1.4; c.beginPath();
      for (let k = 0; k < 4; k++) pen.l(r * 0.05 + k * r * 0.18, r * 0.35, r * 0.12 + k * r * 0.18, r * 0.5, id * 9 + k);
      c.stroke();
      c.fillStyle = P.red; c.beginPath(); c.moveTo(-r * 0.5, -r * 0.85); c.lineTo(-r * 0.3, -r * 1.35); c.lineTo(0, -r * 0.95); c.lineTo(r * 0.3, -r * 1.35); c.lineTo(r * 0.5, -r * 0.85); c.closePath(); c.fill(); c.lineWidth = 1.6; c.stroke();
    }
    if (e.slow > 0) { c.strokeStyle = P.blue; c.lineWidth = 1; c.beginPath(); for (let k = 0; k < 3; k++) pen.l(-r - 6, -r * 0.5 + k * r * 0.5, -r - 14, -r * 0.5 + k * r * 0.5, id + k); c.stroke(); }
    if (e.stacks > 0) { c.fillStyle = P.blue; for (let k = 0; k < Math.min(5, e.stacks); k++) c.fillRect(-r + k * 4, r + 1, 2, 2); }
    if (e.burnT > 0) { c.fillStyle = P.flame; c.beginPath(); pen.o(0, -r * 0.2, r * 1.1, id + 90); c.fill(); }
    c.restore();
    this.hp(e, x, y - r * 2 - 4, r);
  }

  private hp(e: Enemy, x: number, top: number, r: number): void {
    if (e.hp >= e.max) return;
    const c = this.c, w = Math.max(24, r * 2.2);
    c.strokeStyle = this.P.ink; c.lineWidth = 1; c.strokeRect(x - w / 2, top - 8, w, 5);
    c.fillStyle = this.P.red; c.fillRect(x - w / 2 + 1, top - 7, (w - 2) * Math.max(0, e.hp / e.max), 3);
  }

  // ---- shots, cranes and effects --------------------------------------------------------------------------------

  private shots(g: TDGame, o: DrawOpts): void {
    const c = this.c, pen = this.pen, P = pen.P;
    for (const s of g.shots) {
      if (!s.alive) continue;
      const a = lerp(s.px, s.x, o.alpha), b = lerp(s.py, s.y, o.alpha);
      c.strokeStyle = P.ink; c.fillStyle = P.ink;
      if (s.kind === 'dart') {
        const ang = Math.atan2(s.ty - s.sy, s.tx - s.sx), ca = Math.cos(ang), sa = Math.sin(ang);
        c.lineWidth = 2.4; c.beginPath(); pen.l(a - ca * 14, b - sa * 14, a, b, (s.tid * 13) % 97); c.stroke();
        c.lineWidth = 1; c.beginPath(); pen.l(a - ca * 26, b - sa * 26 + 3, a - ca * 18, b - sa * 18 + 3, 7); c.stroke();
      } else if (s.kind === 'blot') {
        const f = Math.min(1, s.t / s.life), lift = Math.sin(f * Math.PI) * 50;
        c.setLineDash([2, 6]); c.lineWidth = 1; c.beginPath(); c.moveTo(s.sx, s.sy); c.quadraticCurveTo(a, b - lift * 1.4, a, b - lift); c.stroke(); c.setLineDash([]);
        pen.circle(a, b - lift, 6, 3, P.ink, 1.6);
      } else {
        // a thorn seed, spinning
        c.strokeStyle = P.blue; c.lineWidth = 2; c.beginPath();
        for (let k = 0; k < 3; k++) { const an = (k * Math.PI) / 3 + (o.reduced ? 0 : o.t * 3); pen.l(a - Math.cos(an) * 6, b - Math.sin(an) * 6, a + Math.cos(an) * 6, b + Math.sin(an) * 6, k); }
        c.stroke();
      }
    }
  }

  private cranes(g: TDGame, o: DrawOpts): void {
    for (const t of g.towers) {
      if (t.type !== 'crane') continue;
      for (const cr of t.cranes) {
        const x = lerp(cr.px, cr.x, o.alpha), y = lerp(cr.py, cr.y, o.alpha);
        bird(this.pen, x, y, 8, x < (cr.target?.x ?? t.x), o.reduced ? 0 : Math.sin(o.t * 10 + t.id));
      }
    }
  }

  private fx(g: TDGame, o: DrawOpts): void {
    const c = this.c, pen = this.pen, P = pen.P;
    for (const f of g.fx) {
      if (f.t >= f.life || f.life <= 0) continue;
      const k = f.t / f.life;
      c.globalAlpha = Math.max(0, 1 - k * 0.8);
      switch (f.kind) {
        case 'splat': {
          c.strokeStyle = P.ink; c.lineWidth = 1.6; c.beginPath();
          const r = f.size * (0.8 + k * 1.4);
          for (let i = 0; i < 6; i++) { const an = (i / 6) * TAU + 0.4 + f.seed; pen.l(f.x + Math.cos(an) * r * 0.5, f.y + Math.sin(an) * r * 0.5, f.x + Math.cos(an) * r, f.y + Math.sin(an) * r, i + 500); }
          c.stroke();
          c.fillStyle = P.ink; c.globalAlpha *= 0.5; c.beginPath(); pen.o(f.x, f.y, f.size * 0.35, f.seed); c.fill();
          break;
        }
        case 'blast': {
          c.strokeStyle = P.red; c.lineWidth = 2.4; c.beginPath();
          for (let i = 0; i < 10; i++) { const an = (i / 10) * TAU, r1 = f.size * (0.3 + k * 0.4), r2 = f.size * (0.6 + k * 0.6); pen.l(f.x + Math.cos(an) * r1, f.y + Math.sin(an) * r1, f.x + Math.cos(an) * r2, f.y + Math.sin(an) * r2, i + 300); }
          c.stroke();
          if (!o.reduced && !o.mini && f.seed % 3 === 0) pen.text(['BOOM', 'POW', 'KA-BLAM'][Math.floor(f.seed / 3) % 3], f.x, f.y - 26 - k * 14, 30, P.red, 'center');
          break;
        }
        case 'chill': c.strokeStyle = P.blue; pen.circle(f.x, f.y, f.size * (0.35 + k * 0.65), f.seed, undefined, 1.6); break;
        case 'beam': {
          // the Ruler's line: a straight ruled stroke, with its tick marks
          const len = Math.hypot(f.x2 - f.x, f.y2 - f.y) || 1, ux = (f.x2 - f.x) / len, uy = (f.y2 - f.y) / len;
          c.strokeStyle = P.ink; c.lineWidth = Math.max(2, f.size * 0.35); c.beginPath(); c.moveTo(f.x, f.y - 16); c.lineTo(f.x2, f.y2 - 16); c.stroke();
          c.lineWidth = 1; c.beginPath();
          for (let d = 12; d < len; d += 12) { const px = f.x + ux * d, py = f.y - 16 + uy * d; c.moveTo(px - uy * 5, py + ux * 5); c.lineTo(px + uy * 5, py - ux * 5); }
          c.stroke();
          break;
        }
        case 'chain': {
          c.strokeStyle = P.blue; c.lineWidth = 2; c.beginPath(); c.moveTo(f.x, f.y);
          for (let i = 0; i < f.n; i++) {
            const px = f.pts[i * 2], py = f.pts[i * 2 + 1], lx = i ? f.pts[i * 2 - 2] : f.x, ly = i ? f.pts[i * 2 - 1] : f.y;
            c.lineTo((lx + px) / 2 + pen.j(i + f.seed, 8), (ly + py) / 2 + pen.j(i + f.seed + 3, 8)); c.lineTo(px, py - 8);
          }
          c.stroke();
          break;
        }
        case 'trace': {
          c.strokeStyle = P.red; c.lineWidth = 1.2; c.setLineDash([3, 5]); c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(f.x2, f.y2 - 10); c.stroke(); c.setLineDash([]);
          c.beginPath(); pen.o(f.x2, f.y2 - 10, 9, f.seed); c.moveTo(f.x2 - 13, f.y2 - 10); c.lineTo(f.x2 + 13, f.y2 - 10); c.moveTo(f.x2, f.y2 - 23); c.lineTo(f.x2, f.y2 + 3); c.stroke();
          break;
        }
        case 'stab': {
          c.strokeStyle = P.red; c.lineWidth = 1.6; c.beginPath();
          for (let i = 0; i < 5; i++) { const an = (i / 5) * TAU; pen.l(f.x + Math.cos(an) * 6, f.y + Math.sin(an) * 6, f.x + Math.cos(an) * (12 + k * 8), f.y + Math.sin(an) * (12 + k * 8), i + 40); }
          c.stroke();
          break;
        }
        case 'num': case 'crit':
          if (!o.reduced && !o.mini) pen.text(fmt(f.value) + (f.kind === 'crit' ? '!' : ''), f.x, f.y - k * 18, f.kind === 'crit' ? 28 : 20, f.kind === 'crit' ? P.red : P.ink, 'center');
          break;
        case 'coin':
          if (!o.mini) {
            c.strokeStyle = P.gold; pen.circle(f.x - 18, f.y - (o.reduced ? 0 : k * 16) - 6, 6, f.seed, undefined, 1.6);
            if (!o.reduced) pen.text('+' + fmt(f.value), f.x - 8, f.y - k * 16, 22, P.gold);
          }
          break;
        case 'tear': {
          // the page rips across: a jagged line, then "torn!"
          c.strokeStyle = P.red; c.lineWidth = 2.6; c.beginPath(); c.moveTo(0, 250);
          for (let x = 30; x <= W; x += 30) c.lineTo(x, 250 + (hash(x + f.seed) - 0.5) * 34);
          c.stroke();
          if (!o.mini) pen.text('the page tore! back a few waves', W / 2, 228, 34, P.red, 'center');
          break;
        }
      }
      c.globalAlpha = 1;
    }
  }

  // ---- the ink bucket: hatched water for the tokens so far, tally marks for waves waiting -------------------------

  private bucket(g: TDGame, o: DrawOpts): void {
    const c = this.c, pen = this.pen, P = pen.P, [x, y] = BUCKET, w = 92, h = 92;
    const queued = g.queued(), fill = queued ? 1 : Math.max(0, Math.min(1, g.ink / g.nextCost()));
    c.save(); c.translate(x, y);
    c.save(); c.beginPath(); c.moveTo(-w / 2, -h); c.lineTo(w / 2, -h); c.lineTo(w / 2 - 12, 0); c.lineTo(-w / 2 + 12, 0); c.closePath();
    c.fillStyle = P.paper; c.fill(); c.clip();
    const top = -h * fill;
    c.strokeStyle = P.blue; c.lineWidth = 1.4; c.beginPath();
    if (fill > 0) for (let k = -w; k < w; k += 7) pen.l(k, 0, k + 26, top, k + 700);
    c.stroke();
    if (fill > 0) { c.lineWidth = 2; c.beginPath(); pen.l(-w / 2, top, w / 2, top, 760); c.stroke(); }
    c.restore();
    c.strokeStyle = P.ink; c.lineWidth = 2.2; c.beginPath();
    pen.l(-w / 2, -h, -w / 2 + 12, 0, 771); pen.l(w / 2, -h, w / 2 - 12, 0, 772); pen.l(-w / 2 + 12, 0, w / 2 - 12, 0, 773);
    c.stroke();
    c.beginPath(); c.ellipse(0, -h, w / 2, 8, 0, 0, TAU); c.stroke();
    c.beginPath(); c.arc(0, -h, w / 2 + 2, Math.PI * 1.08, Math.PI * 1.92); c.stroke();
    c.restore();
    if (o.mini) return;
    pen.text(`${fmt(g.ink)} / ${fmt(g.nextCost())} tokens`, x + 56, y - 60, 24, P.ink);
    c.strokeStyle = P.ink; c.lineWidth = 1.8; c.beginPath();
    for (let i = 0; i < Math.min(queued, 20); i++) {
      const grp = Math.floor(i / 5), k = i % 5, bx = x + 58 + grp * 34;
      if (k < 4) pen.l(bx + k * 6, y - 44, bx + k * 6 + 1, y - 22, i + 800); else pen.l(bx - 3, y - 28, bx + 22, y - 40, i + 800);
    }
    c.stroke();
    if (queued > 20) pen.text(`+${queued - 20}`, x + 58 + 4 * 34, y - 26, 22, P.ink);
    const line = queued ? (g.auto ? `${queued === 1 ? 'a wave' : queued + ' waves'} in the bucket` : `${queued === 1 ? 'a wave waits' : queued + ' waves wait'}: press send`)
      : g.busy() ? 'bucket is filling…' : 'bucket is filling… (your Claude Code tokens)';
    pen.text(line, x + 56, y - 4, 20, P.soft);
  }
}

// What the selected tower reaches (the Thumbtack's tiny reach shows as its own ring).
export function rangeOf(t: Tower): number { return t.st.range; }

// A folded paper crane at (x, y), `s` across; `flap` -1..1 lifts the wings.
function bird(pen: Pen, x: number, y: number, s: number, flip: boolean, flap: number): void {
  const c = pen.c, P = pen.P, d = flip ? -1 : 1;
  c.beginPath(); c.moveTo(x - s * d, y); c.lineTo(x + s * 1.2 * d, y - s * 0.2); c.lineTo(x, y + s * 0.4); c.closePath();
  c.moveTo(x - s * 0.2 * d, y - s * 0.1); c.lineTo(x + s * 0.2 * d, y - s * (0.9 + flap * 0.4)); c.lineTo(x + s * 0.5 * d, y - s * 0.1);
  c.fillStyle = P.paper; c.fill(); c.strokeStyle = P.ink; c.lineWidth = 1.4; c.stroke();
  c.beginPath(); c.moveTo(x + s * 1.2 * d, y - s * 0.2); c.lineTo(x + s * 1.5 * d, y - s * 0.8); c.stroke();
}

// One tower's sketch with its feet at (x, y). `k` scales it (the build menu's icons use a smaller k). The drawing grows
// with each milestone (every 10 levels) up to a point; the red accents come in at the first milestone.
export function sketch(pen: Pen, type: TowerId, level: number, x: number, y: number, k: number, seed: number, aim: number, rec: number, firing: boolean, t: number): void {
  const c = pen.c, P = pen.P, s = seed * 31, v = Math.min(5, Math.floor(level / 10)), hot = level >= 10;
  c.save(); c.translate(x, y); c.scale(k, k);
  c.strokeStyle = P.ink; c.fillStyle = P.paper; c.lineWidth = 2.2;
  const ax = Math.cos(aim), ay = Math.sin(aim);
  switch (type) {
    case 'quill': {
      const h = 32 + v * 5;
      c.fillRect(-12, -h, 24, h);
      c.beginPath();
      pen.l(-12, 0, -12, -h, s); pen.l(12, 0, 12, -h, s + 6); pen.l(-12, 0, 12, 0, s + 12);
      for (let i = 0; i < 3; i++) pen.l(-12 + i * 9, -h, -12 + i * 9 + 6, -h, s + 18 + i);
      pen.l(-12, -h, -12, -h - 6, s + 30); pen.l(-3, -h, -3, -h - 6, s + 31); pen.l(6, -h, 6, -h - 6, s + 32); pen.l(12, -h, 12, -h - 6, s + 33);
      c.stroke();
      if (v) { c.lineWidth = 1.2; c.beginPath(); for (let i = 1; i <= Math.min(v, 4); i++) pen.l(-8, -i * 8, 8, -i * 8 - 2, s + 40 + i); c.stroke(); }
      // the quill: a long nib that kicks back as it throws
      const L = 20 * (1 - rec * 0.3), bx = 0, by = -h + 10;
      c.lineWidth = 3; c.beginPath(); pen.l(bx - ax * 6, by - ay * 6, bx + ax * L, by + ay * L, s + 50); c.stroke();
      c.fillStyle = hot ? P.red : P.ink; c.beginPath(); c.arc(bx + ax * L, by + ay * L, 2.2, 0, TAU); c.fill();
      if (hot) { c.lineWidth = 2.2; c.beginPath(); pen.l(0, -h - 6, 0, -h - 22, s + 60); c.stroke(); c.fillStyle = P.red; c.beginPath(); c.moveTo(0, -h - 22); c.lineTo(14, -h - 18); c.lineTo(0, -h - 14); c.fill(); }
      break;
    }
    case 'bomb': {
      const w = 22 + v * 2, arm = -0.9 + rec * 0.8, len = 28 + v * 3;
      c.fillRect(-w, -16, w * 2, 12);
      c.beginPath(); pen.l(-w, -16, w, -16, s); pen.l(-w, -4, w, -4, s + 3); pen.l(-w, -16, -w, -4, s + 5); pen.l(w, -16, w, -4, s + 7); c.stroke();
      pen.circle(-w + 7, -3, 6, s + 9, P.paper); pen.circle(w - 7, -3, 6, s + 11, P.paper);
      const ex = Math.cos(Math.PI + arm) * len, ey = Math.sin(Math.PI + arm) * len;
      c.lineWidth = 3; c.beginPath(); pen.l(0, -16, -ex, -16 + ey, s + 13); c.stroke();
      pen.circle(-ex, -16 + ey - 4, 6, s + 15, hot ? P.red : P.ink);
      if (v) { c.lineWidth = 1.2; c.beginPath(); for (let i = 1; i <= Math.min(v, 4); i++) pen.l(-w + 4 + i * 8, -14, -w + 8 + i * 8, -6, s + 20 + i); c.stroke(); }
      break;
    }
    case 'frost': {
      const n = 2 + Math.min(v, 4);
      for (let i = 0; i < n; i++) {
        const ox = (i - (n - 1) / 2) * 9, h = 22 + (i % 2 ? 8 : 16) + v * 2;
        c.beginPath(); c.moveTo(ox, 0); c.lineTo(ox - 6, -h * 0.6); c.lineTo(ox, -h); c.lineTo(ox + 6, -h * 0.6); c.closePath();
        c.fillStyle = hot && i === Math.floor(n / 2) ? 'rgba(210,58,42,.25)' : P.chill; c.fill();
        c.beginPath(); pen.l(ox, 0, ox - 6, -h * 0.6, s + i * 5); pen.l(ox - 6, -h * 0.6, ox, -h, s + i * 5 + 1); pen.l(ox, -h, ox + 6, -h * 0.6, s + i * 5 + 2); pen.l(ox + 6, -h * 0.6, ox, 0, s + i * 5 + 3); c.stroke();
      }
      const t2 = 1 - rec, top = -50 - v * 2;
      c.strokeStyle = P.blue; c.lineWidth = 1.4; c.beginPath();
      for (let a = 0; a < 3; a++) { const an = (a * Math.PI) / 3; pen.l(-Math.cos(an) * 8 * t2, top - Math.sin(an) * 8 * t2, Math.cos(an) * 8 * t2, top + Math.sin(an) * 8 * t2, s + 80 + a); }
      c.stroke();
      break;
    }
    case 'ruler': {
      c.fillRect(-14, -12, 28, 12);
      c.beginPath(); pen.l(-14, 0, 14, 0, s); pen.l(-14, -12, 14, -12, s + 1); pen.l(-14, 0, -14, -12, s + 2); pen.l(14, 0, 14, -12, s + 3); c.stroke();
      // the ruler itself, swung to aim, with its ticks
      const L = (36 + v * 3) * (1 - rec * 0.15), px = -ay, py = ax, bx = 0, by = -16;
      c.beginPath(); c.moveTo(bx + px * 4, by + py * 4); c.lineTo(bx + ax * L + px * 4, by + ay * L + py * 4); c.lineTo(bx + ax * L - px * 4, by + ay * L - py * 4); c.lineTo(bx - px * 4, by - py * 4); c.closePath();
      c.fillStyle = P.paper; c.fill(); c.lineWidth = 2; c.stroke();
      c.lineWidth = 1; c.beginPath();
      for (let d = 5; d < L - 2; d += 5) { const big = (d / 5) % 2 === 0 ? 3.5 : 2; c.moveTo(bx + ax * d + px * 4, by + ay * d + py * 4); c.lineTo(bx + ax * d + px * (4 - big), by + ay * d + py * (4 - big)); }
      c.stroke();
      if (hot) { c.fillStyle = P.red; c.fillRect(bx + ax * L - 3, by + ay * L - 3, 6, 6); }
      break;
    }
    case 'spark': {
      const h = 30 + v * 2;
      c.fillRect(-11, -h, 22, h);
      c.beginPath(); pen.l(-11, 0, -11, -h, s); pen.l(11, 0, 11, -h, s + 1); pen.l(-11, 0, 11, 0, s + 2); pen.l(-13, -h, 13, -h, s + 3); c.stroke();
      c.fillRect(-8, -h - 7, 16, 7); c.lineWidth = 1.6; c.strokeRect(-8, -h - 7, 16, 7);
      c.strokeStyle = hot ? P.red : P.blue; c.lineWidth = 2 + Math.min(v, 3) * 0.4; c.beginPath();
      c.moveTo(2, -h + 4); c.lineTo(-5, -h / 2); c.lineTo(3, -h / 2 + 2); c.lineTo(-2, -4); c.stroke();
      if (rec > 0) { c.lineWidth = 1.2; c.beginPath(); for (let i = 0; i < 4; i++) { const an = -Math.PI / 2 + (i - 1.5) * 0.5; pen.l(Math.cos(an) * 12, -h - 8 + Math.sin(an) * 6, Math.cos(an) * 20, -h - 8 + Math.sin(an) * 14, s + 60 + i); } c.stroke(); }
      break;
    }
    case 'thorn': {
      const n = 3 + Math.min(v, 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI, ox = -Math.cos(a) * 12, oy = -10 - Math.sin(a) * 10;
        c.strokeStyle = P.ink; pen.circle(ox, oy, 10, s + i * 7, P.paper, 2);
      }
      c.beginPath(); c.lineWidth = 1.4;
      for (let i = 0; i < 8; i++) { const a = -Math.PI + (i / 7) * Math.PI, r = 20; pen.l(Math.cos(a) * r, -10 + Math.sin(a) * r * 0.9, Math.cos(a) * (r + 6), -10 + Math.sin(a) * (r + 6) * 0.9, s + 30 + i); }
      c.stroke();
      c.fillStyle = hot ? P.red : P.blue;
      for (let i = 0; i < 2 + Math.min(v, 4); i++) { c.beginPath(); c.arc(-12 + ((i * 7) % 24), -18 + ((i * 5) % 12), 2.4, 0, TAU); c.fill(); }
      break;
    }
    case 'glass': {
      c.beginPath(); pen.l(0, -20, -13, 0, s); pen.l(0, -20, 13, 0, s + 1); pen.l(0, -20, 2, 0, s + 2); c.stroke();
      const L = (30 + v * 2) * (1 - rec * 0.2), px = -ay, py = ax, bx = 0 - ax * 8, by = -24 - ay * 8;
      c.beginPath(); c.moveTo(bx + px * 4, by + py * 4); c.lineTo(bx + ax * L + px * 6, by + ay * L + py * 6); c.lineTo(bx + ax * L - px * 6, by + ay * L - py * 6); c.lineTo(bx - px * 4, by - py * 4); c.closePath();
      c.fillStyle = P.paper; c.fill(); c.lineWidth = 2.2; c.stroke();
      c.lineWidth = 1.2; c.beginPath(); for (let i = 1; i < 3; i++) { const d = (L * i) / 3; c.moveTo(bx + ax * d + px * 5, by + ay * d + py * 5); c.lineTo(bx + ax * d - px * 5, by + ay * d - py * 5); } c.stroke();
      c.strokeStyle = hot ? P.red : P.ink; c.lineWidth = 2; c.beginPath(); c.ellipse(bx + ax * L, by + ay * L, 2.5, 6.5, aim, 0, TAU); c.stroke();
      break;
    }
    case 'flag': {
      const h = 50 + v * 4, wave = Math.sin(t * 2 + seed) * 3;
      c.beginPath(); pen.l(0, 0, 0, -h, s); pen.l(-10, 0, 10, 0, s + 1); c.stroke();
      c.fillStyle = P.red; c.beginPath(); c.moveTo(1, -h); c.quadraticCurveTo(12, -h - 4 + wave, 24 + v * 2, -h + 2); c.quadraticCurveTo(14, -h + 8 - wave, 24 + v * 2, -h + 14); c.quadraticCurveTo(12, -h + 10 + wave, 1, -h + 14); c.closePath(); c.fill();
      c.lineWidth = 1.4; c.stroke();
      c.lineWidth = 1.4; c.beginPath(); for (let i = 0; i < Math.min(v, 4); i++) pen.l(-5, -8 - i * 6, 5, -8 - i * 6, s + 10 + i); c.stroke();
      break;
    }
    case 'well': {
      c.beginPath(); c.moveTo(-22, 0); c.lineTo(-16, -22); c.lineTo(16, -22); c.lineTo(22, 0); c.closePath(); c.fillStyle = P.paper; c.fill();
      c.beginPath(); pen.l(-22, 0, -16, -22, s); pen.l(16, -22, 22, 0, s + 1); pen.l(-22, 0, 22, 0, s + 2); pen.l(-16, -22, 16, -22, s + 3); c.stroke();
      c.fillStyle = P.ink; c.fillRect(-8, -29, 16, 7); c.lineWidth = 1.6; c.strokeRect(-8, -29, 16, 7);
      c.fillStyle = P.blue; c.beginPath(); c.moveTo(-19, -8); c.lineTo(19, -8); c.lineTo(21, -2); c.lineTo(-21, -2); c.closePath(); c.fill();
      // a quill stuck in it, its barbs drawn
      c.strokeStyle = P.ink; c.lineWidth = 2; c.beginPath(); pen.l(2, -28, 18, -60, s + 5); c.stroke();
      c.lineWidth = 1; c.beginPath(); for (let i = 0; i < 6; i++) { const f = 0.35 + i * 0.1, qx = 2 + 16 * f, qy = -28 - 32 * f; pen.l(qx, qy, qx - 7, qy + 2, s + 10 + i); pen.l(qx, qy, qx + 6, qy + 4, s + 20 + i); } c.stroke();
      c.strokeStyle = P.gold; for (let i = 0; i < 1 + Math.min(v, 4); i++) pen.circle(28, -4 - i * 5, 5, s + 40 + i, P.paper, 1.4);
      break;
    }
    case 'tack': {
      pen.circle(0, -10, 10, s, P.red, 2);
      break;
    }
    case 'candle': {
      const h = 26 + v * 3;
      c.beginPath(); c.ellipse(0, -2, 16, 4, 0, 0, TAU); c.fillStyle = P.paper; c.fill(); c.lineWidth = 2; c.stroke();
      c.fillStyle = P.paper; c.fillRect(-6, -h, 12, h - 3);
      c.beginPath(); pen.l(-6, -3, -6, -h, s); pen.l(6, -3, 6, -h, s + 1); pen.l(-6, -h, 6, -h, s + 2); pen.l(0, -h, 0, -h - 5, s + 3); c.stroke();
      c.lineWidth = 1.2; c.beginPath(); pen.l(-6, -h + 3, -3, -h + 10, s + 4); pen.l(6, -h + 4, 4, -h + 14, s + 5); c.stroke();
      const f = firing ? 1.5 : 1, fy = -h - 6;
      c.fillStyle = hot ? P.red : P.flame; c.beginPath(); c.moveTo(0, fy - 14 * f); c.quadraticCurveTo(7 * f, fy - 4, 0, fy + 2); c.quadraticCurveTo(-7 * f, fy - 4, 0, fy - 14 * f); c.fill();
      c.strokeStyle = P.red; c.lineWidth = 1.4; c.stroke();
      break;
    }
    case 'crane': {
      c.fillRect(-20, -16, 40, 16);
      c.beginPath(); pen.l(-20, 0, 20, 0, s); pen.l(-20, -16, 20, -16, s + 1); pen.l(-20, 0, -20, -16, s + 2); pen.l(20, 0, 20, -16, s + 3); c.stroke();
      c.lineWidth = 1; c.beginPath(); for (let i = 0; i < 5; i++) pen.l(-16 + i * 8, -2, -12 + i * 8, -14, s + 10 + i); c.stroke();
      bird(pen, 0, -24, 13, false, 0.3);
      if (hot) { c.fillStyle = P.red; c.beginPath(); c.arc(17, -27, 2.4, 0, TAU); c.fill(); }
      break;
    }
  }
  c.restore();
}
