# Ant Farm

A small ant farm that lives in a corner of your screen and digs while your AI agent works. Every token Claude Code spends gives the colony digging energy and drops food crumbs; every finished turn orders a new gallery. Real Claude Code use is the only thing that feeds it: there are no test buttons or free energy, and a colony left without tokens slowly goes hungry. Design: [../docs/ant-farm-design.md](../docs/ant-farm-design.md). The browser prototype it grew from is in [../prototype/ant-farm](../prototype/ant-farm/).

## Run it

```sh
cd ant-farm
npm install
npm start
```

Needs Node 20 or newer. It runs inside the Token Games shell ([../shell](../shell/README.md)), like every game in this repo: it starts as a small round orb in the bottom-right corner of the screen, with a tiny live view of the colony and the number of ants on a badge. Its ring turns warm when the colony is hungry or the game is over. A little ant in the menu bar (the system tray on Windows) has every control. Quit from that menu or with Cmd+Q / Ctrl+Q.

Already running an older Ant Farm? Quit it first: only one runs at a time. Your colony and settings carry over.

## Using it

In the corner ([../docs/presentation.md](../docs/presentation.md)):

- **Point at the circle** and a small tag beside it shows the farm's name and the ants.
- **Click it** for a card with the whole farm, large. Its top bar has **Games**, **Settings** and the size switch, **Circle · Card · Window**, at the far right. Esc, Circle or a click elsewhere folds it back.
- **Drag it** to another corner, on any display; it settles in the nearest corner and stays there. Settings → Display → Circle corner and the menu move it too.
- **Window** (or 3) turns it into the floating window below; Circle (or 1) sends the farm back to its corner, Card (2, or Esc) back to the card. It starts at the size you left it at.
- **Right-click** the farm or the circle, or use the menu-bar icon, for the menu: the sizes, Games… and Settings…, the window's size, full screen, always on top and click-through, the circle's corner, hide and quit.
- Hidden (H, or the menu), Alt+Cmd+T (Alt+Ctrl+T) or the menu-bar menu brings it back. Over full-screen apps the circle stays out of the way.

In the floating window:

- **Move it**: drag the top bar. Dropped near a corner, it docks there.
- **Resize it**: drag the grip on the corner away from its dock (it stays 16:9), or choose Small (320 × 180) or Large (640 × 360) in the menu's Window.
- **Full screen**: F, or the menu. Esc comes back.
- **Click-through**: in the menu or Settings, lets clicks pass through to whatever is behind. To get the window back, hold Alt over it or use the menu-bar menu.
- Opacity, always on top and click-through apply to the floating window only; the circle is always solid and always answers a click.
- **Settings**: the Settings button, or the , key (Cmd+, works too).
- **Camera** (in the card and the window; in the orb it always shows the whole colony): it follows the colony by itself, until you move it:
  - two fingers on a trackpad pan, 1:1 with your fingers and with no easing;
  - pinch to zoom around the pointer (a mouse wheel zooms too);
  - drag with the mouse to pan; let go while moving and it glides on and slows down;
  - arrow keys pan, + and − zoom.
  Panning covers more of the map per pixel when zoomed out. Moving the camera yourself pauses the auto camera for 30 seconds; double-click, A, or the **Follow** chip that shows at the top of the farm gives it back at once. Reduced motion turns off the zoom easing and the glide. Zoom out stops at a view of about 768 × 432 cells (at most about a hundred chunks on screen, on any map), zoom in at 12 cells on the short side, and the view never leaves the world.
- **Stats**: I shows what a frame costs: draw time, ticks, chunks on screen, painted and loaded, tile memory and the JS heap.
- Other keys: H hides it, P cycles palettes, M cycles map sizes.

## Settings

Every change shows at once and is saved straight away (on a Mac in `~/Library/Application Support/ant-farm/settings.json`), so the farm reopens the way you left it.

| Setting | What it does | Default |
|---|---|---|
| Colours | Original, Quiet Earth, Graphite, Slate, Sepia Dusk, Terminal, Desktop Blend (follows the system's light or dark mode) | Desktop Blend |
| Calm | Less colour and contrast, from 0 to 100% | 0% |
| Show performance | Frames a second and what a frame costs, in the farm's bottom-right corner (not in the orb) | off |
| Fade when idle | Sinks toward the desktop after a few quiet seconds, comes back on the next event or when you point at it | off |
| Presentation | In the corner orb, or a floating window | corner orb |
| Corner | Where the orb sits: top left, top right, bottom left, bottom right (or drag it) | bottom right |
| Reduced motion | No floating labels, no pop-out flight, no gliding ants: they step from cell to cell at a few frames a second (moving the camera stays smooth) | off |
| Window size | Small, large, full screen; a dragged size is kept as custom | small |
| Docking | Top left, top right, bottom left, bottom right, or free where you drop it | bottom right |
| Opacity | 25% to 100% | 100% |
| Always on top | Floats above other windows | on |
| Click-through | Clicks pass through to what is behind | off |
| Map | Large (2,048 × 1,024), Huge (8,192 × 4,096) or Ridiculous (65,536 × 16,384 cells); another size starts a new farm | Ridiculous |
| Reset | Every setting back to its default (back in the bottom-right orb too); the farm itself stays. In Settings and the menu-bar menu | |

Settings also shows the colony's health (ants, brood, stored food, the oldest ant's age, the queen's age, and whether it is fed, hungry or starving) and whether Claude Code is being watched. The title bar shows energy, tokens, ants and food, and "hungry" or "starving" when it is.

The farm's map comes from a seed kept with the settings. The colony is saved beside them in `colony.json` every 30 seconds, when the window hides and when the app quits, so it carries on where it was.

## The map

The map is cut into 64 × 64 chunks. A chunk exists in memory only once something touches it: the colony digs it, or the camera looks at it. Every other cell is worked out from the seed when it's needed, so the Ridiculous map (a billion cells) costs no more than a small one. Unchanged chunks the colony and the camera have left are dropped; changed ones are packed down to their differences from the generated soil after a minute, and that's also how they are saved.

Above the ground there is only a thin strip of sky: a dozen rows above the highest ground. It opens further only when something grows into it (a mound, an ant climbing one), and crumbs drop in just below it. Saves from the days of the tall sky load as they were; anything left in the old sky (a crumb still falling) drops in again, so nothing is lost.

Only the chunks on screen are drawn. Each one is painted once into a small tile, in the palette, and painted again only when it changes; ants, brood and cracks are drawn on top. The ants are always drawn; repainting changed soil gets what is left of a frame's budget and the rest waits a frame. A quality governor watches the frame time: when frames keep running long it first draws fewer pixels on a high-density screen (1.5× at most, then 1×), then drops the soft edges and repaints less soil a frame; after a long stretch of easy frames it steps back up. Loose soil away from the ants settles at an eighth of the rate, and ants nobody needs rest where they are.

The farm draws only what anyone can see. Opened or popped out it draws on every display frame (60 or 120 a second) while anything on screen moves: walking ants glide between cells rather than hopping one cell per simulation step, and the camera moves. When nothing moves it drops to 8 a second; with reduced motion the ants step from cell to cell at 2 to 10 frames a second. In the orb it draws 1 to 4 a second, and nothing while it is hidden or the screen is locked or asleep. A frame draws the soil from a cached picture while the camera stands still, and draws the ants in one path per colour.

How an ant faces (`src/game/motion.ts`, drawing only: the simulation is the same): it faces the way it walks. Turning around on level ground is a quick eased flip (about 125 ms) that never points up or down. One bump in the floor doesn't tilt it; two steps the same way up or down do. It points straight up or down only while it climbs or drops in a shaft, and levels out once it stops unless the shaft is too narrow to turn in. Digging above or below doesn't make it look up or down; digging beside it turns it to face its cell.

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

## Score

Each colony is one run, from its founding queen to its last ant. Its score is the sum of whole units (so it never
jitters), shown in Settings (Score, and the best so far) and on the Game Over screen with its breakdown:

| Part | Points |
|---|---|
| Ants born (raised from eggs) | 10 each |
| Blocks dug | 1 each |
| Depth: rows below the surface of the deepest block dug | 5 per row |
| Food crumbs collected | 2 each |
| Weighted tokens fed | 1 per 1,000 |
| The oldest ant's life, dead or alive | 20 per hour |
| Days the colony has lived | 100 per day |
| Rooms finished (the queen's chamber, the nursery, galleries) | 100 each |
| Tunnels finished on their own (to food, scouting) | 25 each |

When the last ant dies, **Game Over** shows the score, the breakdown, the best score so far, how it compares with
the last run, and the last five runs; the orb's ring turns warm and counts 0. **Start a new farm** begins a fresh
map and colony at once, without restarting the app. The record (the last 20 runs, and the best one, which is never
dropped) is kept in `colony.json` on this computer only and never uploaded. The formula lives in `src/sim/score.ts`.

## Where tokens come from

Claude Code writes each session's transcript as a JSON-lines file under `~/.claude/projects`. Ant Farm always watches that folder (if it can't, Settings says so quietly and the farm just waits) and reads only the usage counts (input, output, cache read, cache write tokens), the time, and whether a turn finished. It never keeps or shows what was said, never writes there, and sends nothing anywhere: everything stays on your machine. Only lines written after it starts count, so opening it doesn't replay old work. Turns from helper agents add tokens but don't count as finished tasks.

The feed turns these into the shared event format in the design doc (`tokens`, `task_done`, `session_start`), so a Codex feed can be added beside it later.

Resting in the orb it draws 2 frames a second (4 while tokens arrive, 1 with reduced motion). Opened or popped out it draws every display frame while ants walk or the camera moves, 8 when nothing moves (2 to 10 with reduced motion), and nothing at all while it is hidden. The simulation keeps real time at any frame rate.

## Code

- `src/sim/` the simulation: chunks, soil, rock, food, ants, life, collapse rules, token mapping. No DOM, so it runs in tests.
- `src/game/` the page: tile drawing and culling, palettes, camera and its input, and the farm's Settings sections. It hands the shell a `Game` (`mountShell`).
- `src/main/` the Electron side: `main.ts` starts the shell with the farm's settings, menu-bar ant and save file (`colony.json`); `smoke.ts` adds the farm's checks to the shell's smoke test.
- `src/shared/settings.ts` the farm's settings (palette, calm, fade, map size, seed), stored beside the shell's.
- `game.json`, `icon.svg` the manifest ([../docs/manifest.md](../docs/manifest.md)).
- `src/web/` the farm as a catalog game (`ant-farm-web`, no longer in the published catalog; kept as the smoke test's and CLI tests' bundle): the same `src/game` and `src/sim`, run sandboxed by the shell's hosted adapter. `npm run build:catalog` writes it to `catalog/` (committed; `npm run check:catalog` says when it is out of date). Its save is its own, never `colony.json` ([../docs/first-game-walkthrough.md](../docs/first-game-walkthrough.md)).
- The window, corner orb, tray, hotkey, settings file and Claude Code feed are the shell's ([../shell](../shell/README.md)).

## Tests

```sh
npm test            # unit tests: simulation, chunks and culling, life on a fake clock, camera input, tokens, palettes, settings, and the shell's
npm run typecheck
npm run test:smoke  # launches the app hidden and drives it: the circle, its name tag and the card, the size switch and the menu, the Follow chip, dragging to a corner, the window and back, the big map, camera, settings, sizes, full screen, feed, saving, game over and a new farm, restart
npm run shots       # the same, and saves screenshots to shots/
npm run build:catalog   # the catalog bundle in catalog/; npm run check:catalog checks it is up to date
npm run bench       # frame time and memory at each map size (-- --save <colony.json> for a saved farm, read only)
npm run perf        # the real app, hidden: frames a second, ms (average, p95), draw calls, CPU, page script and layout time, and the costliest functions a frame, in the orb, card, window, zoomed in and out and moving (-- --profile <folder> for a copy of a real profile)
npm run busy-farm -- <folder> [--hours 3] [--size ridiculous]   # a profile with a busy colony (hours of usage played through the real simulation), for perf --profile
npm run facing-trace -- <folder> [--save <colony.json>]          # how ants move and face, frame by frame, old and new: trace.json and frames.html
```

The smoke test uses a throwaway settings folder and a fake transcript folder, never your own, and its window is never shown. It feeds the farm the only way the app allows: by writing a transcript line. Hooks for driving the simulation directly live in the tests, never in the app.

## Not done yet

- Ants don't remember their current job across a restart; they pick a new one.
- Far chunks sleep rather than being simulated coarsely: nothing happens where no ant is, so only loose soil near the colony keeps settling.
- A Codex feed.
- Tested on macOS only; the Windows parts (tray, shortcuts, transparency) are written but not tried on a Windows machine.
- Packaging as an installable app (the farm is in the catalog as a sandboxed web game, but the app itself is still run from source).
