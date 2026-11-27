# Ant Farm: design

A glass-sided ant farm that digs itself while your agent works. Every pixel is one grain of soil. Ants bite grains loose one at a time, carry them up the shaft and drop them on a spoil heap. They tunnel toward buried food, carry it home crumb by crumb, raise brood in chambers they dug, and grow. Tokens your agent spends become the colony's energy and food. Bad digging has consequences: a ceiling dug too wide cracks and falls in.

A playable prototype lives in [`prototype/ant-farm/`](../prototype/ant-farm/). It proves the feel of digging, carrying, collapse and the camera. It is not the game.

## The design in one page

- **One grid, one rule set.** The world is a fixed grid of cells, 420 × 260 to start. A cell is air, dirt, rock, loose grain, food, crumb or glass. Nothing teleports. Each tick, an ant moves at most one cell, and it moves only through air it can cling to. Each grain an ant digs is the same grain it carries and drops, and it keeps its colour. Soil is conserved exactly, and the tests check that.
- **Ants follow jobs, the colony picks the projects.** A small planner chooses what to dig next: the royal chamber, the brood room, tunnels to food it can smell, scouting tunnels, galleries, and clearing rubble. Ants take free slots on those projects, and otherwise forage, nurse or rest. This keeps the behaviour readable to a watcher, where pure pheromone emergence would read as noise at this scale. The research supports a hybrid: real nests come from local rules plus a building pheromone (Khuong et al. 2016), but the player needs to see purpose.
- **Physics is falling sand plus a span rule.** Loose grains and crumbs fall and pile at about 45°. Packed soil holds up a flat ceiling only up to its layer's span. Past that, the ceiling cracks for about 2 s and then its middle drops as loose rubble. The new, narrower ceiling is checked again, so a bad room settles into a dome on its own. Soil cut off from the frame falls (the Dwarf Fortress rule).
- **Tokens are fuel, not score.** Each weighted token adds energy (one grain dug per 40 tokens) and food (one crumb per 500 tokens). Food crumbs fall from the sky at the entrance. Digging spends energy. With no tokens, the colony slows down and rests, but it never dies of a quiet afternoon. A finished agent task orders a new gallery.
- **The camera frames the farm, not the map.** Auto mode eases to fit everything the colony has touched, snapping to whole-pixel scales. The view zooms out as the farm grows. Wheel zooms at the cursor, drag pans, and a double-click or the A key returns to auto.
- **Calm by default.** The sim runs at 20 Hz in a fixed box. Frames render at 30 fps while things move, about 8 fps when calm, and zero when hidden. All motion stays inside the glass.

## Core loop

1. **The agent works** and token events arrive, which adds energy and drops crumbs at the entrance.
2. **The colony spends it.** Workers dig the current projects grain by grain and carry spoil to the surface. Foragers carry crumbs and harvested food to the store on the royal chamber floor.
3. **The queen eats** two crumbs and lays an egg. Nurses carry eggs to the brood room. An egg becomes a larva, then a pupa, then a worker (about 35 s at 20 Hz in the prototype). Brood outside the brood room develops at 0.4× speed.
4. **More workers dig more and smell farther.** The population cap grows by 8 for every finished room, and scouting widens the colony's scent radius. The farm spreads, the camera zooms out, and deeper soil layers bring new spans and colours.
5. **Mistakes happen.** A too-wide gallery collapses, and rubble buries tunnels and sometimes ants. Workers dig themselves out and the colony opens a clear-rubble project. A collapse is the drama beat; it costs time, never the save.

When the agent is idle, energy regenerates slowly (0.03 per tick), so the farm keeps a slow pulse without fake progress.

## Ant roles and behaviour

| Role | What it does | Notes |
| --- | --- | --- |
| Queen | Waits beside the entrance until the royal chamber is dug, then walks down and lives on its floor. Lays an egg for every two crumbs within reach, up to the population cap. | Never digs or carries. Slow (0.25 cells/tick). |
| Digger | Takes a slot on a project (at most 3 on a tunnel face, 5 on a room). Bites one face cell next to it, carries the grain up and out, walks the surface to a dump spot of its own choosing 18+ cells from the hole, and drops the grain. | Dump distance grows with the colony, so the spoil heaps spread into two mounds. |
| Forager | Fetches loose crumbs (from tokens or a collapsed food store) and carries them to the store. | Up to a third of the workers. |
| Harvester | A digger on a food project: digs a tunnel to the pocket, then mines the pocket. Each food cell becomes a carried crumb. | |
| Nurse | Carries eggs and larvae from the queen to the brood room's floor. | Real colonies keep brood in the bottom third of the nest (Tschinkel 2004). |
| Resting | Idles near where it is. | Deliberate: idle workers reduce traffic jams in narrow tunnels (Aguilar et al. 2018). |

Priority each time an ant is free: nurse waiting brood, then forage loose food, then dig (clear-rubble first, then galleries, then the project with the fewest diggers that has a reachable face), else rest. An ant that can't reach its job drops it within 8 ticks so another ant can take it. Workers buried by rubble climb into open air if they can. Otherwise they pick up the grain on top of them and dig out.

Later, age polyethism: young workers nurse, middle-aged ones dig, old ones forage (Tschinkel 2004). It adds a readable "career" to each ant at little cost.

## Map seeding

Everything comes from one 32-bit seed (mulberry32), so the same seed always builds and plays the same farm, given the same token events. The tests check this.

- **Surface:** a gently rolling grass line with sky above.
- **Layers:** a thin topsoil (4–7 cells), then bands 14–38 cells thick drawn from a loam / sand / clay / deep cycle. Each layer has its own flat-ceiling span: topsoil 10, loam 14, sand 8, clay 20, deep 16. Layer boundaries wave. Each grain gets a slight colour jitter, so dug and carried grains stay readable as individual pixels.
- **Rock:** 6 to 12 blobs that cannot be dug. Tunnels steer around them.
- **Food:** 10 to 16 pockets, at least 28 cells apart and kept away from the entrance. 60% are seed caches (gold) and 40% are fungus (green). Pockets start beyond the colony's scent radius (40 cells), which grows by 10 with each scouting tunnel.
- **Entrance:** placed near the middle third. The royal chamber goal sits 24 to 30 cells below it.

## Food, brood and growth

- **Food sources:** token crumbs (dropped at the entrance) and seeded pockets (dug out cell by cell). Stored food sits on the royal chamber floor. Crumbs are only set down where they rest on solid ground, so they don't roll down a shaft and get shuffled forever.
- **Eggs:** the queen lays one egg for every 2 crumbs within reach, at most one every 40 ticks, while ants plus brood are under the cap.
- **Stages:** egg, larva, pupa, adult, at 220, 480 and 700 ticks of care. Brood moves through them at full speed in the brood room and at 0.4× elsewhere.
- **Cap:** min(90, 10 + 8 × finished rooms). Rooms are the growth lever, which ties population to digging, and digging to tokens.
- **Later:** larvae eat. A starving colony stops laying first, then brood dies back. This happens only if the player turns on "hard mode".

## Dig and carry rules, per pixel

- An ant digs only a cell it is touching (Chebyshev distance 1). Digging takes 4 ticks, costs 1 energy, and the grain leaves the grid and becomes the ant's load. It is drawn as one pixel in front of the ant's head, in the grain's own colour.
- **Tunnel faces** are a plus shape around the tip and heading, which makes tunnels 3 cells wide. That's about one body length, matching the ~1.06 body-length tunnels fire ants dig (Gravish et al. 2013). The tip advances only once its face is open. Its heading wobbles toward the goal, which breaks long flat ceilings.
- **Rooms** are ellipses. Domes are dug top-down and nearest-first, so the ceiling is always arched. Flat rooms (galleries) are rectangles with a flat ceiling, which is why they are the ones that fail.
- **A loaded ant** walks the "surface" distance field up and out, then walks the ground to its dump spot and sets the grain down in an open cell next to it. The grain then falls and slides under sand rules.
- **Navigation** is a BFS distance field over walkable air: air with at least one solid neighbour. Diagonal steps need an open side cell, so ants never squeeze through corners. Fields are cached per target and rebuilt when the grid changes (at most every 4 ticks).
- **Occupancy:** ants occupy cells, so falling grains rest on an ant instead of filling its cell. An ant moving out from under a grain wakes the sand.

## Collapse rules

1. **Falling sand.** Loose grains and crumbs fall straight down, else diagonally (random side, scan direction alternating each tick). The result is roughly 45° heaps. Packed dirt and food don't fall.
2. **Span check.** About every 5 ticks after the grid changes, scan for runs of packed soil with air directly below. If a run is longer than its layer's span, it becomes a strain: the ceiling shows spreading hairline cracks for 40 ticks (2 s).
3. **Failure.** When the strain times out, the middle of the run (all but a quarter-span margin at each end) turns to loose grains, and food cells turn to crumbs. They fall. The new ceiling above is checked again on a short 8-tick fuse, so a failure cascades into a dome and stops once the arch is narrow enough. This arching heuristic is ours, not taken from a source; it is cheap and looks right.
4. **Islands.** About every 3 s, packed soil not connected to the glass frame through solid neighbours (diagonals don't count) turns loose and falls. This rule comes from Dwarf Fortress's cave-ins.
5. **Aftermath.** Each collapse opens a clear-rubble project over the area and logs an event, which the page shows as "A ceiling gave way". Finished rooms that fill with more than 6 loose grains get cleared too.

Later: ants caught under a failing ceiling are stunned for a few seconds (not killed by default), plus rain that wets topsoil and lowers its span, and roots that raise it.

## Camera

- **Auto (default):** fits the interest box, which is every cell the colony has touched, every ant, and a margin around the nest. It eases toward the target with the scale moving in log space, and snaps to whole-pixel scales at 2× and above so grains stay crisp squares.
- **Manual:** the wheel zooms at the cursor (the world point under the cursor stays put), drag pans, and the view is clamped so at least 40 px of farm stays on screen. Any manual input leaves auto. A double-click, the A key or the button returns to it.
- **Whole map:** `?view=all` shows the full seeded map, which is handy for seeing where food is.
- **Later:** a follow-ant mode that tracks a random forager for 20 s at a time, and a "what changed" pulse: a brief outline on cells dug since you last looked.

## How tokens feed it

### Event format (JSON lines, version 1)

Every source sends the same small events to the game over a local bridge:

```json
{"v":1,"source":"claude-code","type":"tokens","session":"c0ffee","model":"claude-opus-5-5","input":1200,"output":850,"cache_read":40000,"cache_write":3000,"ts":1764230400000}
{"v":1,"source":"codex","type":"task_done","session":"r-77","ts":1764230460000}
```

| type | Meaning | Game effect |
| --- | --- | --- |
| `tokens` | An API request finished. Counts are for that one request, not running totals. | energy += w / 40, crumbs += w / 500, where w = input + output + cache_write + 0.1 × cache_read |
| `task_done` | The agent finished a turn or task. | Queues a gallery (optional `width`). |
| `session_start` | A new agent session started. | A scout tunnel (later). |
| `agent_waiting` | The agent is waiting on the human. | The colony rests and the frame rate drops (later). |

Cache reads count a tenth because they are cheap re-reads of the same context. Without that, one long session would flood the farm. Past a soft cap of about 200k weighted tokens per hour, conversion goes logarithmic, so a heavy day reads as a busy farm, not a flood. All values are tunable constants.

### Collecting the events

A tiny local bridge (later: one Node script, no dependencies) watches the agent and serves events to the page over a localhost WebSocket. The prototype already exposes `window.antFarmFeed(event)` for this.

- **Claude Code (first):**
  - Preferred: tail the session transcripts at `~/.claude/projects/<project>/*.jsonl`. Each assistant line carries `message.usage` (input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens). Deduplicate by `message.id`, since one response can span several lines. `input_tokens` is sometimes a placeholder 1, so treat it as a lower bound.
  - Alternative: OpenTelemetry. `CLAUDE_CODE_ENABLE_TELEMETRY=1` with an OTLP exporter pointed at the bridge on localhost:4317. The `claude_code.api_request` log event carries input, output, cache-read and cache-creation tokens, cost and model; logs flush every ~5 s. This is the most accurate, but it needs the user to set environment variables.
  - Task done: a `Stop` hook (it fires when Claude finishes responding). Hooks carry no token counts, only `transcript_path`, so the hook just posts `task_done`.
- **Codex (later):**
  - Tail `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Lines with `type: "event_msg"` and `payload.type: "token_count"` hold `info.last_token_usage` (input, cached_input, output, reasoning_output and total tokens). Emit `last_token_usage` as one `tokens` event, mapping cached_input to cache_read. This format is unofficial and may change, so keep the parser in one small function.
  - Task done: the `notify` program in `~/.codex/config.toml` receives a JSON argument on `agent-turn-complete`.
  - Alternative: Codex's `[otel]` exporter (`codex.api_request`, token usage by type).

The bridge never sends prompts or code to the game, only counts, model names and timestamps.

## Performance targets

| Target | Budget | Prototype today |
| --- | --- | --- |
| Sim tick, 420 × 260 grid, up to 90 ants | ≤ 0.5 ms | ~0.15 ms with 25 ants (Node, M-series Mac) |
| Sim rate | 20 Hz, fixed step, at most 80 catch-up steps per frame | as specified |
| Render | 30 fps while anything moves, ~8 fps when calm, 0 when hidden | as specified; calm rate not yet measured in a real window |
| Draw cost | one W × H `putImageData` and one scaled `drawImage` per frame | as specified |
| Memory | under 30 MB for the page | not measured |
| Always-on overlay | readable at 320 × 200, no controls, one stats line | checked by screenshot |

If the map grows past about 1000 × 600, split it into 64 × 64 chunks that sleep when nothing in them changed, the way Noita does. Then move the sim to a Web Worker with an OffscreenCanvas. Neither is needed at the first-playable size.

## First playable

Ship this, then watch it for a week of real agent use before adding more:

- The prototype's sim, cleaned up: everything it does now, plus the soft token cap and saving state to localStorage every 30 s (seed + event log + snapshot).
- A bridge for Claude Code: transcript tailing plus a Stop hook, a WebSocket on localhost and a one-line setup.
- An always-on small window mode (frameless, 320 × 200 minimum) with the auto camera, and a hover reveals the HUD.
- Day/night sky tied to the local clock. It's cheap and makes an always-on window feel alive.
- A start screen: new seed or replay a seed, and the token rate shown in plain words ("this hour: 41k tokens ≈ 1,000 grains").

## Later

- Codex bridge, then a generic "POST an event" endpoint for any agent.
- Age polyethism and pheromone trails drawn as faint pixels.
- Larvae that eat, weather (rain lowers spans), roots, worms that loosen soil.
- Several colonies on one map, one per agent or per repo, that compete for food.
- Bigger maps with chunked sleeping and a worker thread.
- Share a farm as a seed plus an event log (tiny, replayable), for the TTG website.
- Sound: soft digging ticks, off by default.

## Bigger ideas

1. **Replays as the share format.** Because the sim is deterministic, a farm is just a seed plus its token event log. A week of work compresses to a few kilobytes that anyone can replay at 100× speed on the website. "My week in ants" is the viral object, and it costs no server-side rendering.
2. **The farm as a work journal.** Tag each gallery with the task that ordered it (repo, branch, commit title). Hovering a chamber shows "dug while you fixed the login bug". The nest becomes a map of what you built.
3. **Cross-game tokens.** The same bridge and event format drive the tower defense. Let the player point one agent's stream at the ant farm and another's at the tower defense, so the two games share one plumbing layer and the website lists both.

## Open questions for Jake

1. **Can ants die?** Today collapses only bury ants and they dig out. Should a collapse be able to kill a few ants (more drama, a real cost) or stay gentle (a calmer always-on window)? I recommend gentle by default with a hard-mode toggle.
2. **Palette:** the prototype uses warm natural soil under the muted night-blue sky from the pitch. Do you want it fully muted (grey-blue soils like the pitch) or this warmer look?
3. **How fast should a farm fill?** At 20 Hz the colony digs about 1 grain per second per 4 workers, so a farm takes days of agent use to fill the map. Is "days" right, or should a single long session show visible growth (a smaller map or faster ants)?

## Sources

- Gravish N. et al. (2013), "Climbing, falling, and jamming during ant locomotion in confined environments", *PNAS*: fire-ant tunnel width ≈ 1.06 body lengths.
- Aguilar J. et al. (2018), "Collective clog control: optimizing traffic flow in confined biological and robophysical excavation", *Science*: idle workers reduce clogging.
- Khuong A. et al. (2016), "Stigmergic construction and topochemical information shape ant nest architecture", *PNAS*: a building pheromone with a lifetime shapes the nest.
- Buhl J. et al. (2004, 2005): self-organised tunnel networks in *Messor sancta*.
- Tschinkel W. (2004), "The nest architecture of the Florida harvester ant, *Pogonomyrmex badius*", *J. Insect Science*: larger chambers near the surface, brood low, workers move up with age.
- SimAnt (Maxis, 1991), Empires of the Undergrowth, and Uncle Milton's ant farms: the genre references for readability and the glass-farm look.
- Dwarf Fortress cave-in rules: disconnected material falls and diagonals don't connect.
- Sandspiel (Max Bittker) and Noita (Nolla Games, GDC 2019 talk): falling-sand cells, chunked sleeping regions and dirty rectangles.
- Claude Code docs: Monitoring (OpenTelemetry metrics and events) and Hooks reference. Codex docs: config (`notify`, `[otel]`); the session rollout format was read from local files and is unofficial.
