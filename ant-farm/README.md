# Ant Farm

A small ant farm that sits in a corner of your screen and digs while your AI agent works. Every token Claude Code spends gives the colony digging energy and drops food crumbs; every finished turn orders a new gallery. Design: [../docs/ant-farm-design.md](../docs/ant-farm-design.md). The browser prototype it grew from is in [../prototype/ant-farm](../prototype/ant-farm/).

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
- **Click-through**: T, or the button, lets clicks pass through to whatever is behind. To get the window back, hold Alt over it, use the menu-bar menu, or press Alt+Cmd+T (Alt+Ctrl+T on Windows) anywhere.
- **Settings**: the gear button, or the , key (Cmd+, works too).
- **Camera**: it follows the colony by itself. Scroll to zoom, drag to look around, double-click or A to go back to following.
- Other keys: H hides it, P cycles palettes, D cycles docking corners, K feeds 5k test tokens, N a finished task.

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
| Watch Claude Code | Reads Claude Code's usage (below) | on |
| Test events | +5k tokens, task done, a too-wide room: try the farm without an agent | |
| Reset | Every setting back to its default; the farm itself stays | |

The farm's map comes from a seed kept with the settings, so it is the same farm each time. The colony itself starts over at each launch (saving it is not done yet).

## Where tokens come from

Claude Code writes each session's transcript as a JSON-lines file under `~/.claude/projects`. Ant Farm watches that folder and reads only the usage counts (input, output, cache read, cache write tokens), the time, and whether a turn finished. It never keeps or shows what was said, never writes there, and sends nothing anywhere: everything stays on your machine. Only lines written after it starts count, so opening it doesn't replay old work. Turns from helper agents add tokens but don't count as finished tasks.

The feed turns these into the shared event format in the design doc (`tokens`, `task_done`, `session_start`), so a Codex feed can be added beside it later.

When the farm is calm it draws 8 frames a second (2 with reduced motion), and nothing at all while it is hidden.

## Code

- `src/sim/` the simulation: soil, rock, food, ants, collapse rules, token mapping. No DOM, so it runs in tests.
- `src/game/` the page: canvas drawing, palettes, camera, title bar and settings menu.
- `src/main/` the Electron side: the window, docking, menu-bar menu, settings file.
- `src/feed/` the Claude Code feed.
- `src/shared/` settings and event format shared by both sides.

## Tests

```sh
npm test            # unit tests: simulation, token mapping, palettes, settings, window placement, feed
npm run typecheck
npm run test:smoke  # launches the app hidden and drives it: settings, sizes, full screen, feed, restart
npm run shots       # the same, and saves screenshots to shots/
```

The smoke test uses a throwaway settings folder and a fake transcript folder, never your own, and its window is never shown.

## Not done yet

- Saving the colony between launches (only the map seed and settings are kept).
- A Codex feed.
- Tested on macOS only; the Windows parts (tray, shortcuts, transparency) are written but not tried on a Windows machine.
- Packaging as an installable app.
