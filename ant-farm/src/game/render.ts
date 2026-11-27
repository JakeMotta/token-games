// Drawing the farm: the world one pixel a cell (the ants too, in the first prototype's three-cell style), recoloured
// by a palette and scaled up crisp.
import type { Sim } from '../sim/sim';
import type { Cam } from './camera';
import { mapper as makeMapper, type Mapper } from './palettes';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// The grid at one pixel a cell. It keeps its own palette mapper, so give every view its own buffer.
export interface Buffer {
  canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Ctx2D; img: ImageData;
  px: Uint32Array; src: Uint32Array; kind: Uint8Array; mapper: Mapper | null; mapperKey: string;
}

export interface DrawOptions {
  palette: string; calm: number;
  dark: boolean; // desktop appearance, for palettes that follow it
  dim?: number; // 0..1, the idle fade toward the palette's backdrop
  soft?: boolean; // feathered edges
}

export function makeBuffer(sim: Sim): Buffer {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(sim.W, sim.H)
    : Object.assign(document.createElement('canvas'), { width: sim.W, height: sim.H });
  const ctx = canvas.getContext('2d') as Ctx2D, img = ctx.createImageData(sim.W, sim.H), n = sim.W * sim.H;
  return { canvas, ctx, img, px: new Uint32Array(img.data.buffer), src: new Uint32Array(n), kind: new Uint8Array(n), mapper: null, mapperKey: '' };
}

// The whole frame. Returns the palette's chrome colours and how many ants are in view.
export function drawFarm(ctx: CanvasRenderingContext2D, sim: Sim, cam: Cam, dpr: number, buf: Buffer, o: DrawOptions): { drawn: number; mapper: Mapper } {
  const key = o.palette + '|' + o.calm + '|' + o.dark;
  if (!buf.mapper || buf.mapperKey !== key) { buf.mapper = makeMapper(o.palette, { calm: o.calm, dark: o.dark }); buf.mapperKey = key; }
  const back = buf.mapper.palette.ui.back;
  sim.paint(buf.src, { ants: true, kind: buf.kind });
  buf.mapper.apply(buf.src, buf.kind, buf.px);
  buf.ctx.putImageData(buf.img, 0, 0);
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = back;
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;
  const s = cam.s * dpr;
  ctx.setTransform(s, 0, 0, s, Math.round(-cam.x * s), Math.round(-cam.y * s));
  ctx.drawImage(buf.canvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const x1 = cam.x + W / s, y1 = cam.y + H / s;
  let drawn = 0;
  for (const a of sim.ants) if (a.x >= cam.x - 1 && a.x <= x1 && a.y >= cam.y - 1 && a.y <= y1) drawn++;
  if (o.dim && o.dim > 0) { ctx.globalAlpha = Math.min(1, o.dim); ctx.fillStyle = back; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  if (o.soft) feather(ctx, back, Math.max(4, Math.round(Math.min(W, H) * 0.07)));
  return { drawn, mapper: buf.mapper };
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
