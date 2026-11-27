# Ant Farm

A small ant farm that sits in a corner of your screen and digs while your AI agent works. Every token Claude Code spends gives the colony digging energy and drops food crumbs; every finished turn orders a new gallery. Real Claude Code use is the only thing that feeds it: there are no test buttons or free energy, and a colony left without tokens slowly goes hungry. Design: [../docs/ant-farm-design.md](../docs/ant-farm-design.md). The browser prototype it grew from is in [../prototype/ant-farm](../prototype/ant-farm/).

## Run it

```sh
cd ant-farm
npm install
npm start
```

Needs Node 20 or newer. It opens a small frameless window in the bottom-right corner, always on top, and a little ant in the menu bar (the system tray on Windows) with the same controls. Quit from that menu or with Cmd+Q / Ctrl+Q.

## Using it

- **Move it**: drag the title bar. Dropped near a corner, it docks there.
- **Resize it**: drag the grip on the corner away from its dock (it stays 16:9), or press 1 for small (320 × 180) and 2 for large (640 × 360).
- **Full screen**: F, or the square button. Esc comes back.
- **Click-through**: T, or the setting, lets clicks pass through to whatever is behind. To get the window back, hold Alt over it, use the menu-bar menu, or press Alt+Cmd+T (Alt+Ctrl+T on Windows) anywhere.
- **Settings**: the gear button, or the , key (Cmd+, works too).
- **Camera**: it follows the colony by itself, until you move it:
  - two fingers on a trackpad pan, 1:1 with your fingers and with no easing;
  - pinch to zoom around the pointer (a mouse wheel zooms too);
  - drag with the mouse to pan; let go while moving and it glides on and slows down;
  - arrow keys pan, + and − zoom.
  Panning covers more of the map per pixel when zoomed out. Moving the camera yourself pauses the auto camera for 30 seconds; double-click, A, or the target button in the title bar gives it back at once. Reduced motion turns off the zoom easing and the glide.
- **Stats**: I shows what a frame costs: draw time, ticks, chunks on screen, painted and loaded, tile memory and the JS heap.
- Other keys: H hides it, P cycles palettes, D cycles docking corners, M cycles map sizes.

## Settings

Every change shows at once and is saved straight away (on a Mac in `~/Library/Application Support/ant-farm/settings.json`), so the farm reopens the way you left it.

| Setting | What it does | Default |
|---|---|---|
| Colours | Original, Quiet Earth, Graphite, Slate, Sepia Dusk, Terminal, Desktop Blend (follows the system's light or dark mode) | Desktop Blend |
| Calm | Less colour and contrast, from 0 to 100% | 0% |
| Fade when idle | Sinks toward the desktop after a few quiet seconds, comes back on the next event or when you point at it | off |
| Reduced motion | No floating labels, fewer frames | off |
| Window size | Small, large, full screen; a dragged size is kept as custom | small |
| Docking | Top left, top right, bottom left, bottom right, or free where you drop it | bottom right |
| Opacity | 25% to 100% | 100% |
| Always on top | Floats above other windows | on |
| Click-through | Clicks pass through to what is behind | off |
| Map | Large (2,048 × 1,024), Huge (8,192 × 4,096) or Ridiculous (65,536 × 16,384 cells); another size starts a new farm | Ridiculous |
| Reset | Every setting back to its default; the farm itself stays | |

Settings also shows the colony's health (ants, brood, stored food, the oldest ant's age, the queen's age, and whether it is fed, hungry or starving) and whether Claude Code is being watched. The title bar shows energy, tokens, ants and food, and "hungry" or "starving" when it is.

The farm's map comes from a seed kept with the settings. The colony is saved beside them in `colony.json` every 30 seconds, when the window hides and when the app quits, so it carries on where it was.

## The map

The map is cut into 64 × 64 chunks. A chunk exists in memory only once something touches it: the colony digs it, or the camera looks at it. Every other cell is worked out from the seed when it's needed, so the Ridiculous map (a billion cells) costs no more than a small one. Unchanged chunks the colony and the camera have left are dropped; changed ones are packed down to their differences from the generated soil after a minute, and that's also how they are saved.

Only the chunks on screen are drawn. Each one is painted once into a small tile, in the palette, and painted again only when it changes; ants, brood and cracks are drawn on top. A frame paints at most 8 ms of tiles, and the widest zoom-out shows at most about 600 chunks. Loose soil away from the ants settles at an eighth of the rate, and ants nobody needs rest where they are.

`npm run bench` measures it headless. On an M-series Mac:

| Map | Before (one flat map) | Now (chunks) |
|---|---|---|
| Classic 420 × 260 | 3.3 ms a frame, 7 MB | 0.3 ms, 2 MB |
| Large 2,048 × 1,024 | 41 ms, 79 MB | 0.6 ms, under 1 MB |
| Huge 8,192 × 4,096 | 583 ms, 1.2 GB | 0.8 ms, under 1 MB |
| Ridiculous 65,536 × 16,384 | would need about 37 GB | 0.6 ms, under 1 MB |

A frame there is three simulation ticks plus repainting the tiles that changed. Painting a whole fresh 1280 × 720 screen (after a palette change) takes about 20 ms, spread over a few frames by the budget. In the app, with the colony young, the whole page uses about 10 MB of JS heap.

## How the colony lives

Everything here runs on the real clock, including while the app is closed: a farm reopened after a weekend has lived through the weekend.

| | | Constant |
|---|---|---|
| Digging | one grain per 15 weighted tokens | `TOKENS_PER_ENERGY` |
| Food | one crumb per 2,500 weighted tokens | `TOKENS_PER_CRUMB` |
| Worker life | about 48 hours (± 15%), then it fades out | `ANT_LIFESPAN_MS` |
| Queen life | about 14 days; the youngest worker then takes over | `QUEEN_LIFESPAN_MS` |
| Eating | each ant eats one stored crumb every 6 hours | `ANT_MEAL_MS` |
| Starving | with the store empty, one worker dies every 45 minutes | `STARVE_DEATH_MS` |
| Grace | the queen and the last 2 workers hold out for 7 days | `STARVE_GRACE_MS`, `MIN_SURVIVORS` |

Weighted tokens are input + output + cache writes + a tenth of cache reads, softly capped past 200k an hour. Foragers carry crumbs into the store by the queen; the queen lays an egg for every two crumbs near her, up to what the dug rooms can hold, and the brood hatches into workers. Food never piles up: crumbs wait in the sky while 30 lie uncollected, and a full store (80) feeds the forager who brings one more. A starving colony's brood stops growing. Nobody starves while food is on its way (in the 45 minutes after tokens arrive), so the colony recovers as soon as you work again, and tokens reaching an empty farm bring a new queen. All of it lives in `src/sim/world.ts` and `src/sim/tokens.ts`.

## Where tokens come from

Claude Code writes each session's transcript as a JSON-lines file under `~/.claude/projects`. Ant Farm always watches that folder (if it can't, Settings says so quietly and the farm just waits) and reads only the usage counts (input, output, cache read, cache write tokens), the time, and whether a turn finished. It never keeps or shows what was said, never writes there, and sends nothing anywhere: everything stays on your machine. Only lines written after it starts count, so opening it doesn't replay old work. Turns from helper agents add tokens but don't count as finished tasks.

The feed turns these into the shared event format in the design doc (`tokens`, `task_done`, `session_start`), so a Codex feed can be added beside it later.

When the farm is calm it draws 8 frames a second (2 with reduced motion), 60 while you move the camera, and nothing at all while it is hidden.

## Code

- `src/sim/` the simulation: chunks, soil, rock, food, ants, life, collapse rules, token mapping. No DOM, so it runs in tests.
- `src/game/` the page: tile drawing and culling, palettes, camera and its input, title bar and settings menu.
- `src/main/` the Electron side: the window, docking, menu-bar menu, settings and colony files.
- `src/feed/` the Claude Code feed.
- `src/shared/` settings and event format shared by both sides.

## Tests

```sh
npm test            # unit tests: simulation, chunks and culling, life on a fake clock, camera input, tokens, palettes, settings, feed
npm run typecheck
npm run test:smoke  # launches the app hidden and drives it: the big map, camera, settings, sizes, full screen, feed, saving, restart
npm run shots       # the same, and saves screenshots to shots/
npm run bench       # frame time and memory at each map size
```

The smoke test uses a throwaway settings folder and a fake transcript folder, never your own, and its window is never shown. It feeds the farm the only way the app allows: by writing a transcript line. Hooks for driving the simulation directly live in the tests, never in the app.

## Not done yet

- Ants don't remember their current job across a restart; they pick a new one.
- Far chunks sleep rather than being simulated coarsely: nothing happens where no ant is, so only loose soil near the colony keeps settling.
- A Codex feed.
- Tested on macOS only; the Windows parts (tray, shortcuts, transparency) are written but not tried on a Windows machine.
- Packaging as an installable app.
