# Ant Farm prototype

A prototype, not the game. It tests the feel of the design in [`docs/ant-farm-design.md`](../../docs/ant-farm-design.md): per-pixel digging and carrying, falling sand, ceilings that crack and fall when dug too wide, food, brood and colony growth, and the auto camera. It needs no build step and no dependencies.

## Run

Open `index.html` in a browser. It works straight from the file system.

- **+5k tokens** feeds a token event (energy for digging, crumbs at the entrance).
- **Task done** orders a gallery. **Wide room** orders one 30 cells wide, which is too wide for its soil, so it collapses.
- Wheel zooms at the cursor, drag pans, and a double-click or the A key returns to the auto camera.
- **1× / 4× / 16×** sets the sim speed. **New seed** builds a new map.

URL options:

| Option | Effect |
| --- | --- |
| `seed=N` | Map seed. |
| `speed=N` | Starting sim speed. |
| `warp=N` | Runs N ticks before the first frame. |
| `view=all` | Fits the whole map instead of the colony. |
| `demo=collapse&then=N` | Digs the royal chamber, orders a wide gallery, waits for its ceiling to strain, then runs N more ticks. |
| `pause=1` | Draws one frame and stops (for screenshots). |
| `test=1` | Runs the in-page checks and writes JSON into `#result`. |

From script, `window.antFarmFeed({ type: 'tokens', input, output, cache_read, cache_write })` or `window.antFarmFeed({ type: 'task_done', width })` feeds an event.

## Files

- `sim.js`: the simulation (grid, physics, ants, planner, token feed, pixel painter). Deterministic per seed. Runs in Node or the browser.
- `camera.js`: fit, zoom-at-cursor, clamp and ease.
- `index.html`: the page, HUD, input and frame loop (30 fps busy, 8 fps calm, stopped when hidden).

## Test

```sh
node --test prototype/ant-farm/test/sim.test.js   # simulation and camera unit tests
node prototype/ant-farm/test/e2e.js [seed]          # loads the page in headless Chrome and runs its checks
```

The end-to-end test needs Google Chrome or Chromium installed. It runs headless and opens no window.
