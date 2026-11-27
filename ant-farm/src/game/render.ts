// Drawing the farm. The map is cut into the simulation's 64 × 64 chunks; each chunk on screen is painted once into
// a small tile (recoloured by the palette) and only painted again when the chunk changed, the palette changed or it
// was dropped. Chunks off screen are never touched, so a frame costs the same on a map of any size. Ants, brood and
// cracks are drawn on top each frame, one rectangle per cell.
import type { Sim } from '../sim/sim';
import { CHUNK, CS } from '../sim/chunks';
import type { Cam } from './camera';
import { mapper as makeMapper, type Mapper } from './palettes';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface DrawOptions {
  palette: string; calm: number;
  dark: boolean; // desktop appearance, for palettes that follow it
  dim?: number; // 0..1, the idle fade toward the palette's backdrop
  soft?: boolean; // feathered edges
  budgetMs?: number; // time for painting tiles this frame; the rest wait for the next frame
}
export interface ViewStats {
  visible: number; // chunks on screen
  painted: number; // tiles painted this frame
  waiting: number; // tiles on screen still waiting to be painted
  tiles: number; // tiles kept
  tileMB: number;
  ms: number; // time spent drawing this frame
}
export interface Frame { drawn: number; mapper: Mapper; stats: ViewStats; box: { x0: number; y0: number; x1: number; y1: number } }

interface Tile { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Ctx2D; ver: number; key: string; used: number }

const css = (c: number) => 'rgb(' + (c & 255) + ',' + ((c >>> 8) & 255) + ',' + ((c >>> 16) & 255) + ')';
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// The visible world box for a camera on a vw × vh device-pixel canvas (s already includes the device pixel ratio).
export function visibleBox(cam: Cam, vw: number, vh: number, dpr: number, W: number, H: number) {
  const s = cam.s * dpr;
  return {
    x0: Math.max(0, Math.floor(cam.x)), y0: Math.max(0, Math.floor(cam.y)),
    x1: Math.min(W - 1, Math.ceil(cam.x + vw / s)), y1: Math.min(H - 1, Math.ceil(cam.y + vh / s)),
  };
}
// The chunks that box covers.
export function visibleChunks(b: { x0: number; y0: number; x1: number; y1: number }) {
  return { cx0: b.x0 >> CS, cy0: b.y0 >> CS, cx1: b.x1 >> CS, cy1: b.y1 >> CS };
}

// The widest zoom-out for a vw × vh window: about MAX_TILES chunks on screen, so a frame's cost has a ceiling.
export const MAX_TILES = 600;
export function minScale(vw: number, vh: number): number {
  let s = 0.25;
  while (s < 4 && (vw / (s * CHUNK) + 1) * (vh / (s * CHUNK) + 1) > MAX_TILES) s *= 1.1;
  return s;
}

// One view of a farm: its tiles and its palette. Give each canvas its own.
export class View {
  readonly tiles = new Map<number, Tile>();
  private mapper: Mapper | null = null;
  private mapperKey = '';
  private frame = 0;
  private px = new Uint32Array(CHUNK * CHUNK);
  private kind = new Uint8Array(CHUNK * CHUNK);
  private out: Uint32Array;
  private img: ImageData;

  constructor() {
    this.img = new ImageData(CHUNK, CHUNK);
    this.out = new Uint32Array(this.img.data.buffer);
  }

  private tile(): Tile {
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(CHUNK, CHUNK)
      : Object.assign(document.createElement('canvas'), { width: CHUNK, height: CHUNK });
    return { canvas, ctx: canvas.getContext('2d') as Ctx2D, ver: -1, key: '', used: 0 };
  }

  draw(ctx: CanvasRenderingContext2D, sim: Sim, cam: Cam, dpr: number, o: DrawOptions): Frame {
    const t0 = now();
    this.frame++;
    const key = o.palette + '|' + o.calm + '|' + o.dark;
    if (!this.mapper || this.mapperKey !== key) { this.mapper = makeMapper(o.palette, { calm: o.calm, dark: o.dark }); this.mapperKey = key; }
    const m = this.mapper, back = m.palette.ui.back;
    const W = ctx.canvas.width, H = ctx.canvas.height, s = cam.s * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;

    const box = visibleBox(cam, W, H, dpr, sim.W, sim.H), cc = visibleChunks(box);
    // whole device pixels for each chunk edge, so neighbouring tiles meet without seams
    const sx = (wx: number) => Math.round((wx - cam.x) * s), sy = (wy: number) => Math.round((wy - cam.y) * s);
    const budget = o.budgetMs ?? 8;
    let visible = 0, painted = 0, waiting = 0;
    for (let cy = cc.cy0; cy <= cc.cy1; cy++) for (let cx = cc.cx0; cx <= cc.cx1; cx++) {
      visible++;
      const ci = cy * sim.chunks.cw + cx, ver = sim.chunks.ver(ci);
      let t = this.tiles.get(ci);
      const stale = !t || t.ver !== ver || t.key !== key;
      if (stale && (painted < 4 || now() - t0 < budget)) {
        if (!t) { t = this.tile(); this.tiles.set(ci, t); }
        sim.paintChunk(cx, cy, this.px, this.kind);
        m.paint(this.px, this.kind, this.out);
        t.ctx.putImageData(this.img, 0, 0);
        t.ver = ver; t.key = key;
        painted++;
      } else if (stale) waiting++;
      if (!t || t.ver < 0) continue;
      t.used = this.frame;
      const x0 = sx(cx << CS), y0 = sy(cy << CS);
      ctx.drawImage(t.canvas, x0, y0, sx((cx + 1) << CS) - x0, sy((cy + 1) << CS) - y0);
    }
    // keep about two screens of tiles, dropping the ones unseen longest
    const cap = Math.max(256, visible * 2);
    if (this.tiles.size > cap) {
      const old = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < old.length && this.tiles.size > cap; i++) if (old[i][1].used !== this.frame) this.tiles.delete(old[i][0]);
    }

    // ants, brood and cracks on top
    let drawn = 0, alpha = 1, fill = '';
    sim.overlay(box, (x, y, c, kind, a) => {
      if (a !== alpha) { ctx.globalAlpha = alpha = a; }
      const f = css(m.map(kind, c));
      if (f !== fill) ctx.fillStyle = fill = f;
      const x0 = sx(x), y0 = sy(y);
      ctx.fillRect(x0, y0, sx(x + 1) - x0, sy(y + 1) - y0);
    });
    ctx.globalAlpha = 1;
    for (const a of sim.ants) if (a.x >= box.x0 && a.x <= box.x1 && a.y >= box.y0 && a.y <= box.y1) drawn++;

    if (o.dim && o.dim > 0) { ctx.globalAlpha = Math.min(1, o.dim); ctx.fillStyle = back; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    if (o.soft) feather(ctx, back, Math.max(4, Math.round(Math.min(W, H) * 0.07)));
    const stats: ViewStats = { visible, painted, waiting, tiles: this.tiles.size, tileMB: (this.tiles.size * CHUNK * CHUNK * 4) / 1048576, ms: now() - t0 };
    return { drawn, mapper: m, stats, box };
  }

  clear(): void { this.tiles.clear(); }
}

// Edges that fade into the window's backdrop instead of ending in a hard line.
function feather(ctx: CanvasRenderingContext2D, col: string, d: number): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh);
  };
  ctx.globalAlpha = 0.8;
  edge(0, 0, d, 0, 0, 0, d, H); edge(W, 0, W - d, 0, W - d, 0, d, H);
  edge(0, H, 0, H - d, 0, H - d, W, d); edge(0, 0, 0, d, 0, 0, W, d);
  ctx.globalAlpha = 1;
}
