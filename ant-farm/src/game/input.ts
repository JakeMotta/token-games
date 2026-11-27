// Camera input as plain maths (no DOM), so it can be tested: which kind of wheel event this is, how far it moves the
// camera, drag momentum and the eased zoom. app.ts wires these to the real events.
import { zoomAt, type Cam } from './camera';

// What a wheel event means. Mac trackpads send two-finger scrolls as pixel wheel events and pinches as wheel events
// with ctrlKey set; a mouse wheel sends line steps (or big pixel steps that match its legacy wheelDelta).
export interface WheelLike { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; wheelDeltaY?: number }
export type WheelKind = 'pinch' | 'pan' | 'wheel';

export const LINE_PX = 16; // one "line" of a line-mode wheel event, in pixels
export const FOLLOW_PAUSE_MS = 30_000; // after you move the camera yourself, the auto camera waits this long
export const FRICTION_MS = 325; // drag momentum decays by e every this many ms (iOS-like)
export const MIN_FLING = 0.08; // px/ms: a slower release just stops

export function classifyWheel(e: WheelLike): WheelKind {
  if (e.ctrlKey) return 'pinch';
  if (e.deltaMode !== 0) return 'wheel';
  // a mouse wheel's pixel deltas are its notches times a fixed factor; a trackpad's never line up like that
  if (e.wheelDeltaY !== undefined && e.deltaX === 0 && e.deltaY !== 0 && e.wheelDeltaY === -3 * e.deltaY) return 'wheel';
  return 'pan';
}

// The event's movement in screen pixels, whatever unit it came in (pixels, lines or pages).
export function wheelPixels(e: WheelLike, pageH: number): { dx: number; dy: number } {
  const k = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? pageH : 1;
  return { dx: e.deltaX * k, dy: e.deltaY * k };
}

// Move the camera by a screen-pixel delta, 1:1: what was under the fingers stays under them, at any zoom (so a
// zoomed-out view moves through more of the world per pixel).
export function panBy(cam: Cam, dx: number, dy: number): Cam { return { x: cam.x + dx / cam.s, y: cam.y + dy / cam.s, s: cam.s }; }

// How much one pinch or wheel event zooms (a factor; > 1 zooms in).
export const pinchFactor = (dy: number): number => Math.exp(-dy * 0.01);
export const wheelFactor = (dy: number): number => Math.exp(-dy * 0.002);

// Zoom eased toward a target scale, about a fixed screen point.
export interface ZoomGoal { s: number; sx: number; sy: number }
export function easeZoom(cam: Cam, goal: ZoomGoal, dtMs: number, o: { min?: number; max?: number; instant?: boolean } = {}): Cam {
  const k = o.instant ? 1 : 1 - Math.exp(-dtMs / 70);
  const f = Math.exp((Math.log(goal.s) - Math.log(cam.s)) * k);
  return zoomAt(cam, goal.sx, goal.sy, f, o);
}
export const zoomDone = (cam: Cam, goal: ZoomGoal): boolean => Math.abs(Math.log(cam.s / goal.s)) < 0.002;

// Drag momentum: remembers the last 100 ms of pointer movement; on release, glides on at that speed and slows down.
export class Inertia {
  private samples: { t: number; dx: number; dy: number }[] = [];
  vx = 0; vy = 0; // px/ms, in the direction the camera moves

  reset(): void { this.samples = []; this.vx = this.vy = 0; }

  // a drag moved the camera by (dx, dy) screen pixels at time t
  track(dx: number, dy: number, t: number): void {
    this.samples.push({ t, dx, dy });
    while (this.samples.length && t - this.samples[0].t > 100) this.samples.shift();
  }

  // the pointer let go at time t: start gliding if it was moving
  release(t: number): boolean {
    const s = this.samples.filter((p) => t - p.t <= 100);
    this.samples = [];
    if (s.length < 2) { this.vx = this.vy = 0; return false; }
    const span = Math.max(16, t - s[0].t);
    let dx = 0, dy = 0;
    for (const p of s.slice(1)) { dx += p.dx; dy += p.dy; }
    this.vx = dx / span; this.vy = dy / span;
    if (Math.hypot(this.vx, this.vy) < MIN_FLING) { this.vx = this.vy = 0; return false; }
    return true;
  }

  get moving(): boolean { return this.vx !== 0 || this.vy !== 0; }

  // how far to move this frame (screen pixels); null once it has stopped
  step(dtMs: number): { dx: number; dy: number } | null {
    if (!this.moving) return null;
    // the exact distance covered while the speed decays over dt
    const decay = Math.exp(-dtMs / FRICTION_MS), k = FRICTION_MS * (1 - decay);
    const out = { dx: this.vx * k, dy: this.vy * k };
    this.vx *= decay; this.vy *= decay;
    if (Math.hypot(this.vx, this.vy) < 0.01) this.vx = this.vy = 0;
    return out;
  }
}
