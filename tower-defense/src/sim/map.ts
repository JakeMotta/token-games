// The page: a sheet 960 × 528 with a free-hand road from the left edge to the castle in the bottom right, and the
// soft grid towers snap to (24-unit cells, 40 × 22). The road's curve is the ink mock-up's. Pure.

export const W = 960, H = 528, CELL = 24, COLS = W / CELL, ROWS = H / CELL;
export const ROAD = 23; // half the road's width
export type Pt = [number, number];

const U = 54, OX = 24, OY = 26;
const CTRL: Pt[] = [[-0.5, 2], [3, 1.5], [5.5, 3.5], [4, 6.5], [7, 8.5], [10, 6.5], [9.5, 3], [12.5, 1.8], [15, 4], [13.8, 7.5], [16.5, 8.6]];

// A smooth path through control points (Catmull-Rom), as a polyline every `step` units.
export function spline(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [], P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1].slice() as Pt);
  return out;
}

export const ROAD_PTS: Pt[] = spline(CTRL.map(([x, y]) => [OX + x * U, OY + y * U] as Pt), 0.25 * U);
export const CASTLE: Pt = [OX + 15.9 * U, OY + 8.9 * U];
export const BUCKET: Pt = [96, 516]; // the ink bucket's foot, bottom left

// distance along the road for every point, so walkers move at an even speed
const CUM: number[] = [0];
for (let i = 1; i < ROAD_PTS.length; i++) CUM.push(CUM[i - 1] + Math.hypot(ROAD_PTS[i][0] - ROAD_PTS[i - 1][0], ROAD_PTS[i][1] - ROAD_PTS[i - 1][1]));
export const ROAD_LEN = CUM[CUM.length - 1];

// The point `d` units along the road (clamped to its ends), written into `out` to avoid garbage.
export function along(d: number, out: { x: number; y: number }): void {
  if (d <= 0) { out.x = ROAD_PTS[0][0]; out.y = ROAD_PTS[0][1]; return; }
  if (d >= ROAD_LEN) { const p = ROAD_PTS[ROAD_PTS.length - 1]; out.x = p[0]; out.y = p[1]; return; }
  let lo = 0, hi = CUM.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (CUM[m] <= d) lo = m; else hi = m; }
  const t = (d - CUM[lo]) / (CUM[hi] - CUM[lo] || 1), a = ROAD_PTS[lo], b = ROAD_PTS[hi];
  out.x = a[0] + (b[0] - a[0]) * t; out.y = a[1] + (b[1] - a[1]) * t;
}

function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t);
}

export function distToRoad(x: number, y: number): number {
  let best = Infinity;
  for (let i = 1; i < ROAD_PTS.length; i++) best = Math.min(best, segDist(x, y, ROAD_PTS[i - 1], ROAD_PTS[i]));
  return best;
}

// What each cell is: 0 free paper, 1 road (or too close to it), 2 kept clear (the bucket and the castle).
export const CELLS: Uint8Array = (() => {
  const g = new Uint8Array(COLS * ROWS);
  const keep: [number, number, number, number][] = [[0, 17, 5, 5], [35, 16, 5, 6]]; // col, row, cols, rows
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    // the cell's square must stay clear of the road's edge: the road's points against the square, the square's
    // corners against the road (its segments are shorter than a cell, so nothing slips between)
    const x0 = c * CELL, y0 = r * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
    let near = Infinity;
    for (const [px, py] of ROAD_PTS) near = Math.min(near, Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1)));
    for (const [qx, qy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) near = Math.min(near, distToRoad(qx, qy));
    g[r * COLS + c] = near < ROAD ? 1 : 0;
    for (const [kc, kr, kw, kh] of keep) if (c >= kc && c < kc + kw && r >= kr && r < kr + kh) g[r * COLS + c] = 2;
  }
  return g;
})();
