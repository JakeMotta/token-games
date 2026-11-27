// Camera math (pure, no DOM). A camera is the world point at the top-left of the view and the scale in screen
// pixels per world cell.

export interface Cam { x: number; y: number; s: number }
export interface Box { x: number; y: number; w: number; h: number }

// Fit a world box into a vw × vh view with padding. Scales of 2 and up snap to whole numbers so every grain stays a
// crisp square.
export function fit(box: Box, vw: number, vh: number, o: { pad?: number; min?: number; max?: number } = {}): Cam {
  const pad = o.pad == null ? 8 : o.pad, min = o.min || 0.5, max = o.max || 12;
  let s = Math.min((vw - pad * 2) / Math.max(1, box.w), (vh - pad * 2) / Math.max(1, box.h));
  s = Math.max(min, Math.min(max, s));
  if (s >= 2) s = Math.floor(s);
  return { x: box.x + box.w / 2 - vw / s / 2, y: box.y + box.h / 2 - vh / s / 2, s };
}

// Zoom by factor f keeping the world point under screen point (sx, sy) fixed.
export function zoomAt(cam: Cam, sx: number, sy: number, f: number, o: { min?: number; max?: number } = {}): Cam {
  const min = o.min || 0.5, max = o.max || 24;
  const s = Math.max(min, Math.min(max, cam.s * f));
  const wx = cam.x + sx / cam.s, wy = cam.y + sy / cam.s;
  return { x: wx - sx / s, y: wy - sy / s, s };
}

// Keep at least `keep` screen pixels of the world in view on each side.
export function clamp(cam: Cam, W: number, H: number, vw: number, vh: number, keep = 40): Cam {
  const kx = keep / cam.s, ky = keep / cam.s;
  const x = Math.min(W - kx, Math.max(kx - vw / cam.s, cam.x));
  const y = Math.min(H - ky, Math.max(ky - vh / cam.s, cam.y));
  return { x, y, s: cam.s };
}

// Ease from cam toward target by t in 0..1. Scale moves in log space so zooming feels even, and the view centre (not
// the corner) is what slides.
export function lerp(cam: Cam, target: Cam, t: number, vw: number, vh: number): Cam {
  const s = Math.exp(Math.log(cam.s) + (Math.log(target.s) - Math.log(cam.s)) * t);
  const cx = cam.x + vw / cam.s / 2, cy = cam.y + vh / cam.s / 2;
  const tx = target.x + vw / target.s / 2, ty = target.y + vh / target.s / 2;
  const nx = cx + (tx - cx) * t, ny = cy + (ty - cy) * t;
  return { x: nx - vw / s / 2, y: ny - vh / s / 2, s };
}

export const near = (a: Cam, b: Cam): boolean => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.s - b.s) < 0.002;
