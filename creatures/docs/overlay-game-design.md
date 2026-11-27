# Hatchery: the third Token Games overlay

Working title **Hatchery**. A Tamagotchi/Digimon-style pet that lives in a corner of your screen and grows from the work Claude Code does. After the ant farm and the tower defense, it is the third game in the same shell, fed by the same usage feed. The creature technique is the one from the GOCHITAMA video, reproduced in [creature-generation.md](creature-generation.md); the web model is in [../prototype](../prototype/).

## The loop

1. **An egg arrives.** Its shell already shows the creature inside (tint, markings, shape all come from its genome), so you can tell eggs apart, but not what will hatch.
2. **Warm it with work.** The first 25,000 weighted tokens of Claude use (`HATCH_TOKENS`, about one short session) warm the egg: it wobbles more and more, cracks, and hatches.
3. **Raise it.** Every token after that feeds the pet. Level-ups cost `3000 × L^1.15` weighted tokens, so baby to adult (level 100) is about 27.5M weighted tokens: two to four weeks of steady use. Every level visibly changes it; stage changes (child at 26, teen at 56, adult at 100) get a small ceremony.
4. **Adult → new egg.** At level 100 the creature takes its final form (extra gloss), joins the collection for good, and a new egg appears. The adult keeps living in the collection and can visit the overlay.
5. **Collect, and later breed.** Every egg is a brand-new random creature from a fresh seed. Breeding (two adults from the collection lay an egg, video rules: whole pieces, two copies, nudges, 6% surprise, names breed) is a later feature; the web model already has it.

What it is not: there are **no cheats**. No feed button, no test-token key, no level slider in the game. Levels come only from real Claude usage through the feed. The pet also never dies or gets sick from a quiet day: no tokens, it naps.

## What the pet does on screen

- Walks its strip of the window with planted feet and a springy tail (video step 6); idles, blinks, looks around; turns at the edges.
- Wings big enough to lift it: it takes short flights. Too small: it flaps hard and hops ("it tries anyway").
- Reacts to the feed: a token burst → it perks up (happy face, a hop); a finished task (`task_done`, from the Stop hook) → a little celebration; a level-up → a glow and the new body; a long quiet stretch → sleepy face, then it curls up and sleeps.
- Temperament: each creature is born somewhere on the SCARY–CUTE bar. In Settings you can nudge your pet's temperament (look only; not a cheat).
- Faces follow its mood: happy when fed, sleepy when idle, surprised on a sudden burst, angry never (unless scary and woken).

## Window and shell

Same Electron shell as `ant-farm/` (copy the structure, share the code later in a `shared/` package):

- `src/main/`: frameless always-on-top window, tray menu, settings store, geometry (docking, sizes), click-through, smoke test.
- `src/feed/claude-code.ts`: unchanged. Tails `~/.claude/projects/*/*.jsonl`, dedupes by `message.id`, emits `tokens` and `task_done` events.
- `src/sim/tokens.ts`: the same weighting (`CACHE_READ_WEIGHT = 0.1`, `SOFT_CAP = 200k`/hour); the creature adds `levelFromTokens` from `genome.js` on top.
- `src/game/`: the prototype's `genome.js`, `body.js`, `render.js`, `motion.js` as modules (they already run in Node and the browser), plus the pet state machine (egg → hatching → creature → adult).
- Window sizes 320 × 180 and 640 × 360 (16:9), the same docking corners, opacity, click-through, Calm, fade when idle, reduced motion, colour schemes (backdrop palettes: transparent desktop blend by default, since the sprite is see-through).
- The sprite renders at 1 game pixel = 2 screen pixels (small) or 4 (large); the creature's adult framing fills about 70% of the window height.

## Saved state

`~/Library/Application Support/hatchery/state.json` (or the shell's store):

```json
{ "v": 1, "current": { "seed": "k3j9x", "tokens": 1840000, "hatched": true, "temperament": 0.2, "born": 1764230400000 },
  "collection": [ { "seed": "…", "name": "Flickle", "parents": null, "adultAt": 1764230400000 } ],
  "eggs": 0, "settings": { } }
```

A creature is fully described by its seed (and, for bred ones, its two genome copies), so the save is tiny and the same on every machine. Tokens fed are stored, levels are derived (`levelFromTokens`), so a tuning change to the curve re-levels everyone consistently.

## Settings (same names as the ant farm)

| Setting | Hatchery behaviour |
|---|---|
| Calm | Lowers sprite saturation and contrast; slower idle; no celebration bursts |
| Fade when idle | Window sinks toward the desktop when the pet sleeps; the next token event wakes both |
| Reduced motion | No walking, flying or hops; hatching and level-ups are instant with a glow |
| Backdrop | Transparent (default), night, paper, peach |
| Temperament | The SCARY–CUTE bar for the current pet (look only) |
| Watch Claude Code | On/off for the feed, as in the ant farm |

## Performance budget

One creature, ~120 × 100 sprite, ray-marched on the CPU at 12 fps: 20–40 ms per frame, well under one core, and nothing at all while it sleeps (the last frame stays). If that is too much on battery, the same SDF moves to a WebGL fragment shader without changing the look.

## Build order

1. Port the four prototype modules into `hatchery/src/game` as ES modules with types; keep their tests.
2. Copy the ant farm shell; swap the game view for the pet view; wire the feed to `tokens` → `levelFromTokens`.
3. Egg → hatch → level-ups → adult → new egg; save and restore.
4. Collection window (a second, normal window from the tray).
5. Breeding (later).

## Open questions for Jake

- Should a finished task (Stop hook) be worth bonus tokens toward levels, or only trigger a reaction? (Default chosen: reaction only, so levels are purely token-driven.)
- Should more than one egg queue up (one per N tokens after adulthood), or exactly one at a time? (Default: one at a time.)
- Is two to four weeks per creature the right pace? It is one constant (`LEVEL_BASE_TOKENS`).
