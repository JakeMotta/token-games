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
| `palette=original\|earth\|graphite\|slate\|dusk\|terminal\|blend` | Colour palette (default Original here; see `palettes.js`). |
| `ants=new&look=rust\|black\|glow` | Draws round two's side-view sprite ants instead of the original ones, for comparing. |
| `pause=1` | Draws one frame and stops (for screenshots). |
| `test=1` | Runs the in-page checks and writes JSON into `#result`. |

From script, `window.antFarmFeed({ type: 'tokens', input, output, cache_read, cache_write })` or `window.antFarmFeed({ type: 'task_done', width })` feeds an event.

## Files

- `sim.js`: the simulation (grid, physics, ants, planner, token feed, pixel painter). Deterministic per seed. Runs in Node or the browser.
- `camera.js`: fit, zoom-at-cursor, clamp and ease.
- `palettes.js`: the colour palettes. The painter marks what each pixel shows (sky, wall, soil, food, ant, queen…), and a palette recolours each kind through its own low-contrast ramp, keeping the pixel's light and dark. Original is the prototype's colours unchanged. A Calm amount lowers saturation and contrast in any palette.
- `render.js`: draws a frame: the world one pixel a cell, ants included (the first prototype's ants), through the chosen palette, scaled up crisp. Options: `palette`, `calm`, `dark`, `dim` (idle fade), `soft` (feathered edges). `ants: 'new'` draws round two's side-view sprites instead, kept only for comparing.
- `sprites.html`: the original ants in every palette at the 320 × 180 window size and zoomed; `?ants=new` shows round two's sprite sheet.
- `overlay.html`: a mock-up of the farm as an always-on-top window over a Mac desktop where Claude Code is working (each step it takes feeds the farm). Keys: `1` small 320 × 180, `2` large 640 × 360, drag the corner grip for any size (kept 16:9), `F` full screen and `Esc` back, `T` click-through (hold `⌥` to grab it again), `D` cycles the docking corner, `K` feeds 5k tokens, `H` hides it to the menu bar, `P` cycles the palette, `C` toggles the palette comparison (every palette at 320 × 180 next to a work window). The strip also has a Calm slider, Fade when idle (sinks toward the backdrop after 5 quiet seconds, back on the next token) and Reduced motion (no floaters or window animation, 2–5 fps). The real app would be a native transparent, frameless, always-on-top window; this page only fakes the desktop around it. URL options: `size=S|L|F`, `dock=tl|tr|bl|br`, `theme=light|dark`, `palette=`, `calm=0..100`, `fade=1`, `rm=1`, `view=compare`, `opacity=`, `pause=1`, `test=1`.
- `index.html`: the page, HUD, input and frame loop (30 fps busy, 8 fps calm, stopped when hidden).

## Test

```sh
node --test prototype/ant-farm/test/             # simulation, camera and sprite unit tests
node prototype/ant-farm/test/e2e.js [seed]          # loads the page in headless Chrome and runs its checks
node prototype/ant-farm/test/e2e.js 7 overlay.html  # the same for the desktop overlay mock-up
```

The end-to-end test needs Google Chrome or Chromium installed. It runs headless and opens no window.
