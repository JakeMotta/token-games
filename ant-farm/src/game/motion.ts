// How the ants are drawn between simulation steps: where each one is and which way it faces. Drawing only, so the
// simulation stays exactly as it was (same steps, same farm); this only watches the ants' cells from frame to frame.
//
// Position: the simulation moves an ant one cell a step (20 a second). Drawn as is, that is a 20 fps hop however fast
// the screen is. Here an ant glides from the cell it left to the cell it reached, over about the time it takes it to
// make one step, so a walking ant moves on every display frame.
//
// Facing: the simulation's heading is its last single step, so a bump in the floor made an ant look straight up or
// down for a step, and turning around snapped it 180° in one frame. Here the facing comes from the movement over
// steps: left or right flips only when the ant really walks the other way (and the flip is eased: the head slides
// through the body, the way a side-view ant turns), it tilts up or down only after two steps in a row the same way
// up or down (one bump is ignored), and it points straight up or down only while it climbs or drops in a shaft. Once it
// stops it levels out again, unless it rests in a shaft too narrow to turn in. An ant digging beside it turns to face
// its cell; digging above or below doesn't make it look up or down.
import { SOLID, TICK_HZ } from '../sim/world';

export const STEP_MS = 1000 / TICK_HZ;
export const TURN_MS = 45; // the facing's easing time constant: a turn is 95% done in about 130 ms

export interface Mover { id: number; x: number; y: number; hx: number; speed: number }
export interface Pose { x: number; y: number; fx: number; fy: number } // fx, fy: where the head is, from the body, in cells

interface Rec {
  x: number; y: number; // the cell it is in
  fromX: number; fromY: number; t0: number; dur: number; // the glide into it
  last: number; // when it last moved
  face: number; // -1 left, 1 right
  vSign: number; vRun: number; // up (-1) or down (1), and for how many steps in a row
  pure: number; // steps in a row straight up or down
  hx: number; // the simulation's last horizontal heading, to catch a turn to dig
  tx: number; ty: number; fx: number; fy: number; // the facing it turns to, and the facing drawn now
  seen: number;
}

// No room to turn at a cell: solid on both sides, as in a one-cell shaft. For update()'s `narrow`.
export const narrowAt = (w: { typeAt(k: number): number; idx(x: number, y: number): number }, x: number, y: number): boolean =>
  SOLID[w.typeAt(w.idx(x - 1, y))] === true && SOLID[w.typeAt(w.idx(x + 1, y))] === true;

const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export class Motion {
  private recs = new Map<number, Rec>();
  private gen = 0;
  private at = 0;
  private smooth = true;
  private p = { x: 0, y: 0 };

  // Once a frame, after the simulation stepped. smooth: glide and ease (false with reduced motion and in the orb, where
  // an ant is drawn where it is, facing its final way at once). narrow(x, y): no room to turn at that cell, asked only
  // for an ant resting after a climb (without it, it stays upright). Returns whether anything still moves on screen.
  update(ants: readonly Mover[], now: number, smooth: boolean, narrow?: (x: number, y: number) => boolean): boolean {
    const dt = this.at ? Math.max(0, now - this.at) : 0;
    this.at = now; this.smooth = smooth;
    const g = ++this.gen, k = smooth ? 1 - Math.exp(-dt / TURN_MS) : 1;
    let busy = false;
    for (const a of ants) {
      let r = this.recs.get(a.id);
      if (!r) {
        const face = sign(a.hx) || 1;
        r = { x: a.x, y: a.y, fromX: a.x, fromY: a.y, t0: now, dur: 0, last: -1e9, face, vSign: 0, vRun: 0, pure: 0, hx: a.hx, tx: face, ty: 0, fx: face, fy: 0, seen: g };
        this.recs.set(a.id, r);
      }
      r.seen = g;
      const dx = a.x - r.x, dy = a.y - r.y;
      if (dx || dy) {
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) { // carried, or many steps since the last frame: no glide across
          r.fromX = a.x; r.fromY = a.y; r.dur = 0; r.vRun = 0; r.pure = 0;
          if (dx) r.face = sign(dx);
        } else {
          this.place(r, now, this.p);
          r.fromX = this.p.x; r.fromY = this.p.y; r.t0 = now;
          // one step's time: from its last steps while it keeps walking, from its speed when it sets off
          const gap = now - r.last;
          r.dur = gap < 4 * STEP_MS ? Math.min(3 * STEP_MS, Math.max(STEP_MS, gap)) : Math.min(3 * STEP_MS, STEP_MS / Math.max(0.3, a.speed));
          const sx = sign(dx), sy = sign(dy);
          if (sx) r.face = sx;
          r.vRun = sy && sy === r.vSign ? r.vRun + 1 : sy ? 1 : 0;
          r.vSign = sy;
          r.pure = sy && !sx ? r.pure + 1 : 0;
        }
        r.x = a.x; r.y = a.y; r.last = now;
      } else if (a.hx && a.hx !== r.hx) r.face = a.hx; // turned to dig beside it
      r.hx = a.hx;
      // two steps the same way up or down before it tilts; straight up or down only in a shaft; level once it rests,
      // unless there is no room to turn
      const climbing = r.vRun >= 2 && (now - r.last <= r.dur + STEP_MS || !narrow || narrow(r.x, r.y));
      if (climbing && r.pure >= 2) { r.tx = 0; r.ty = r.vSign; }
      else if (climbing) { r.tx = r.face; r.ty = r.vSign; }
      else { r.tx = r.face; r.ty = 0; }
      r.fx += (r.tx - r.fx) * k; r.fy += (r.ty - r.fy) * k;
      if (Math.abs(r.tx - r.fx) < 0.01) r.fx = r.tx;
      if (Math.abs(r.ty - r.fy) < 0.01) r.fy = r.ty;
      if (r.fx !== r.tx || r.fy !== r.ty || (smooth && now < r.t0 + r.dur)) busy = true;
    }
    if (this.recs.size > ants.length) for (const [id, r] of this.recs) if (r.seen !== g) this.recs.delete(id);
    return busy;
  }

  // Where to draw an ant now and which way it faces, into `out` (no allocation per ant per frame). False for an ant
  // update() hasn't seen yet.
  pose(id: number, out: Pose): boolean {
    const r = this.recs.get(id);
    if (!r) return false;
    this.place(r, this.at, out);
    out.fx = r.fx; out.fy = r.fy;
    return true;
  }

  clear(): void { this.recs.clear(); this.at = 0; }

  private place(r: Rec, now: number, out: { x: number; y: number }): void {
    if (!this.smooth || r.dur <= 0 || now >= r.t0 + r.dur) { out.x = r.x; out.y = r.y; return; }
    const t = Math.max(0, (now - r.t0) / r.dur);
    out.x = r.fromX + (r.x - r.fromX) * t; out.y = r.fromY + (r.y - r.fromY) * t;
  }
}
