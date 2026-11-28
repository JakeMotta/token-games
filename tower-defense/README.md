# Ink Tower Defense

The second Token Game: a tower defense drawn in ink on a page of a notebook. It lives in an orb in the bottom-right
corner of the screen, opens when clicked and pops out into its own window, like the Ant Farm. It moves forward only
when your AI agent really works:

- **Tokens fill the bucket.** Every token Claude Code spends pours ink into the bucket at the bottom left; a full
  bucket sends the next wave (wave *n* costs 1,500 + 600·(*n* − 1) tokens). With **auto** off, full buckets wait and
  **send** lets them go when you are ready.
- **Finished turns pay gold**, and so do the doodles you beat and the waves you clear.
- Nothing happens while the app is closed: no offline progress, no catch-up.

Paper is dark by default; Settings → Paper switches to light (or follows the system) and turns damage numbers off.

## How it plays

Doodles walk the road from the top left to the castle at the bottom right; each one that gets there takes lives (a
boss takes five). Build towers anywhere on the paper:

- **Placing.** **build** (or B) opens the card; pick a tower and a ghost follows the pointer, snapped to a loose
  24-pixel grid. A dashed ghost fits; a red, hatched one says why not (*that is the road*, *something is there*, *not
  enough gold*). Towers take 2 × 2 or 3 × 3 cells, never overlap and never sit on the road, except the Thumbtack, which
  only goes on it. A click near a spot that doesn't fit takes the closest one that does. Clicking empty paper offers to
  build right there. Esc or a right-click puts the ghost away; with nothing open, a right-click is the shell's menu.
- **A tower's card** (click a tower): its damage, rate, reach, damage a second and kills, **+1**, **+10** and **max**
  upgrades, **aim** (first, strongest, nearest, last), **move** and **sell** (70 % of what it cost back).
- **Levels never end.** Each level costs 18 % more than the last and adds damage; every 10th level is a milestone that
  doubles damage and grows the tower's own trick. Its look gains a stage every 10 levels, up to 50.
- **Waves never end.** Hit points grow about 3 % a wave (wave 100 is about 200× wave 1); new doodles join early on, a
  boss leads every 10th wave and the Editor every 50th. Past wave 2000 growth slows to logarithmic so numbers stay
  finite. Big numbers read 1.2K, 3.4M, 5.6B, 7.8T, then 1.2e15.
- **Speed** 1×, 2× or 4×; **pause** (P or space).

## The towers

| Tower | Unlocks | What it does | Milestones add |
|---|---|---|---|
| Quill | wave 1 | Fast darts at one target | +1 dart every 10 levels |
| Ink Bomb | wave 1 | Lobbed blots that splash a crowd | A wider splash |
| Snowflake | wave 3 | A chill pulse that slows everyone near | Colder and longer |
| Ruler | wave 5 | A straight line that pierces every doodle on it | A wider line |
| Spark Jar | wave 8 | Lightning that jumps between doodles | +1 jump every 5 levels |
| Thornbush | wave 11 | Poison that keeps hurting, and stacks | +1 stack |
| Spyglass | wave 14 | A slow, huge shot across the page; armour is no help | More critical hits |
| Banner | wave 18 | Cheers on towers nearby: more damage and speed | A bigger cheer |
| Inkwell | wave 22 | Gold after every wave, more for kills nearby | Richer every level |
| Thumbtack | wave 26 | A trap on the road that stabs and slows | Stabs twice |
| Candle | wave 30 | A short flame cone that burns everything in it | A wider flame |
| Paper Crane | wave 35 | Folds cranes that fly out and peck | +1 crane |

## Run it

```sh
cd tower-defense
npm install
npm start            # builds, then runs it in the bottom-right corner
npm run typecheck
npm test             # the game's tests and the shell's
npm run test:smoke   # the hidden end-to-end test; never shows a window
npm run shots        # the same, saving screenshots to shots/
npm run perf         # frame cost in every mode, and the 50-tower, 100-walker benchmark, into perf.json
npm run autoplay -- --balance                 # a headless bot plays; prints how far it gets and when
npm run autoplay -- <folder> --waves 300      # writes a late-game profile; then: npm run perf -- --profile <folder>
```

The window starts at the shell's small size; press 2 (or Settings → Display → Size) for the large one.

## Files

| File | What it is |
|---|---|
| `game.json` | The manifest ([docs/manifest.md](../docs/manifest.md)) |
| `src/sim/num.ts` | Big numbers: compact formatting, and guards so nothing ever becomes Infinity or NaN |
| `src/sim/map.ts` | The page, the road and its cells |
| `src/sim/towers.ts`, `enemies.ts` | Tower and doodle tables, upgrade costs, wave rolls and scaling |
| `src/sim/placement.ts` | The loose grid: footprints, why a spot doesn't fit, the nearest one that does |
| `src/sim/game.ts` | The simulation: fixed 1/30 s steps, pooled shots and effects, save and load |
| `src/game/ink.ts`, `render.ts` | The wobbly pen, both palettes, and the drawing of the page, towers, doodles and effects |
| `src/game/app.ts` | The page: the frame loop (interpolated, cheap in the orb), the HUD, cards, ghost and tips |
| `src/game/index.html`, `style.css`, `font.css` | The view; the hand is Caveat (SIL Open Font License, `OFL.txt`) |
| `src/main/main.ts`, `smoke.ts` | Starts the shell; the game's own smoke checks and perf run |
| `src/web/` | The game as a catalog game, **Ink Tower Defense** (`tower-defense-web`, the one in the published catalog): the same `src/game` and `src/sim`, run sandboxed by the shell's hosted adapter, with its own save and settings ([docs/first-game-walkthrough.md](../docs/first-game-walkthrough.md)) |
| `catalog/` | Its built bundle: `npm run build:catalog` writes it, `npm run check:catalog` says when it is out of date (committed, so a release can be rebuilt from a commit) |
| `scripts/autoplay.ts` | The headless bot behind `npm run autoplay` |
| `test/*.test.ts` | Unit tests: the game, placement (with an overlap fuzz test) and scaling |

How games work, the rules (usage only, no cheats, calm, cheap in the orb) and the proof loop:
[CONTRIBUTING.md](../CONTRIBUTING.md).
