// Where a tower may stand. The page is a soft grid of 24-unit cells; a tower covers 2 × 2 or 3 × 3 of them,
// anywhere on free paper: never on the road (the Thumbtack is the one that must sit on it), never over the bucket or
// the castle, never past the edge, never over another tower. One occupancy grid answers all of it in O(cells). Pure.
import { CELL, CELLS, COLS, ROAD, ROWS, distToRoad } from './map';
import { TOWERS, type TowerId } from './towers';

export class Grid {
  // the id of the tower on each cell, or 0
  readonly occ = new Int32Array(COLS * ROWS);

  fill(cx: number, cy: number, size: number, id: number): void {
    for (let r = cy; r < cy + size; r++) for (let c = cx; c < cx + size; c++) this.occ[r * COLS + c] = id;
  }

  clear(): void { this.occ.fill(0); }

  // Why a tower of kind `type` can't stand with its top-left cell at (cx, cy), or '' when it can.
  // `ignore` is a tower being moved: its own cells count as free.
  why(type: TowerId, cx: number, cy: number, ignore = 0): string {
    const size = TOWERS[type].size;
    if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cy < 0 || cx + size > COLS || cy + size > ROWS) return 'off the page';
    const onRoad = !!TOWERS[type].onRoad;
    if (onRoad) {
      const mid = (cx + size / 2) * CELL, mid2 = (cy + size / 2) * CELL;
      if (distToRoad(mid, mid2) > ROAD * 0.55) return 'tacks go on the road';
    }
    for (let r = cy; r < cy + size; r++) for (let c = cx; c < cx + size; c++) {
      const i = r * COLS + c, o = this.occ[i];
      if (o && o !== ignore) return 'something is there';
      if (CELLS[i] === 2) return 'keep this spot clear';
      if (CELLS[i] === 1 && !onRoad) return 'that is the road';
    }
    return '';
  }

  ok(type: TowerId, cx: number, cy: number, ignore = 0): boolean { return this.why(type, cx, cy, ignore) === ''; }
}

// The top-left cell for a tower centred under the pointer at page point (x, y): the snap of the soft grid.
export function snap(type: TowerId, x: number, y: number): [number, number] {
  const s = TOWERS[type].size;
  return [Math.round(x / CELL - s / 2), Math.round(y / CELL - s / 2)];
}

// The nearest spot within `reach` cells where it fits (a ring search), so a click a little off still builds.
export function nearest(grid: Grid, type: TowerId, cx: number, cy: number, reach = 2, ignore = 0): [number, number] | null {
  if (grid.ok(type, cx, cy, ignore)) return [cx, cy];
  let best: [number, number] | null = null, bd = Infinity;
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    const d = dx * dx + dy * dy;
    if (d < bd && grid.ok(type, cx + dx, cy + dy, ignore)) { bd = d; best = [cx + dx, cy + dy]; }
  }
  return best;
}
