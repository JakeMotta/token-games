# Creatures

Generative pet creatures for the third Token Games overlay (working title **Hatchery**): an egg hatches into a baby, Claude Code usage levels it up, and over 100 levels it grows into an adult; then a new egg. Every egg is a brand-new random creature.

The creatures are made the way the GOCHITAMA devlog video shows: a list of numbers → four ring-stack pieces plus parts → one melted body → every pixel asks "am I inside?" → banded colour, light and a 1-pixel ink outline on a see-through background.

- [docs/video-analysis.md](docs/video-analysis.md): what the video shows and says, step by step, and how the prototype mirrors each step.
- [docs/creature-generation.md](docs/creature-generation.md): the approach: genome and seed, growth stages, rendering, temperament, variation and rarity, eggs, token rates, no cheats, Calm and reduced motion.
- [docs/art-style-options.md](docs/art-style-options.md): the art styles (looks), what each costs to ship, what stays procedural and where PixelLab fits, and a recommendation.
- [docs/overlay-game-design.md](docs/overlay-game-design.md): the overlay game, in the same Electron shell and on the same Claude usage feed as the ant farm.
- [docs/shots](docs/shots/): contact sheets (seeds, levels, temperament, faces, views, eggs, breeding, styles, palettes, shine, mouths), walk strips, proof sheets (a 180° turn, a 360° spin, eating, every habitat) and page screenshots.

## Web model

Plain HTML, JavaScript and canvas, no build step: open `prototype/index.html` straight from disk (or `prototype/creatures-standalone.html`, the same page in one file).

- **New egg / Hatch / seed field**: every egg is a new random creature; the same seed always makes the same one.
- **SCARY – CUTE**: the video's one-bar slider.
- **Level 1–100**: a preview of each growth stage. In the game, levels come only from Claude usage.
- **Genes**: sliders for the main numbers; **Numbers** shows the whole genome, coloured by which hidden copy it comes from.
- **Faces, views** (finished, melted pieces, one colour, inside?), **Ask every pixel** (replays the per-pixel test).
- **Style** (Original, Cel, Pixel), a **Palette** for the pixel look (Game Boy, PICO-8, warm earth) and a **Shine** slider. The same creature in every look; eggs, hatching and the collection follow.
- **Habitat**: six code-drawn floors in the same 3/4 perspective: Soft grass, Flat, Pixel meadow, Cave at night, Wildwood (chunky outlined pixels like Tap Slay Die's forest) and Studio. Far layers drift a little with the creature (parallax) and grass sways in the wind; both stop under Reduced motion.
- **Walk**: it wanders the floor (x and depth) with a limited turn rate, steers off the edges, and now and then turns right round (decelerates and pivots on planted feet, a 180° turn, or rarely a 360° spin). **Walk debug** adds heading (yellow) and facing (cyan) arrows, the turn rate, the pivot, the goal, the floor edges, planted (green) and swinging (orange) feet, and the gait.
- **Food (prototype only)**: pick a berry, seed, leaf, apple or fish and click the floor. It walks over, turns to face it, bites (the food shrinks), chews, swallows (a lump goes down) and is happy; a little later, a cute poop. The **hunger** meter rises slowly with time and a meal lowers it. In the game food comes only from tokens of real Claude Code use; this click does not ship.
- **Collection**: hatched creatures are kept (in this browser only); pick two to breed an egg.

URL options: `?seed=moss&level=60&temperament=-1&face=happy&view=pieces&pause=1`, `&style=pixel&palette=gameboy&shine=0.3&debug=1&gait=walk|hurry` (`gait` keeps it walking), and `&habitat=meadow&heading=-0.8&hunger=0.8&food=apple`.

## Tests and tools

```sh
cd creatures/prototype
node --test test/              # genome, renderer and motion unit tests
node test/e2e.js               # headless page checks (no window); add a seed and a page name to vary
node tools/sheets.js ../docs/shots   # contact sheets, rendered in Node
node tools/shots.js ../docs/shots    # page screenshots, headless Chrome (name='query' pairs for others)
node tools/sheets.js ../docs/shots styles palettes shine   # only the named sheets
node tools/walkstrip.js out.png --view side --level 100 --mode walk   # walk frame strip, prints slip and stretch
node tools/mouths.js ../docs/shots/mouths.png   # every mouth kind, closed and open, in each look
node tools/proof.js ../docs/shots    # turn, spin, eating and habitat proof sheets, drawn by the page headless
node tools/bundle.js           # rebuild creatures-standalone.html after editing the scripts
```

## Version 2: Argonaut technique

A second, separate prototype in `prototype-v2/` (Version 1 above is unchanged). Same genome, looks, habitats, eggs, food, hunger, mouths and controls; only the body and legs differ. The body is a chain of joints that follows its head, with distance and angle constraints and a radius per joint. The legs are two-bone FABRIK legs that step when they fall a stride behind. It adds a real light-driven shadow: a sun that sweeps from left to right (a slider and an Auto day cycle), dawn and dusk tints, a dim moon, and a shadow projected from the creature's actual pieces.

- Open `prototype-v2/index.html` (or `prototype-v2/creatures-v2-standalone.html`). Every page links to the others.
- [docs/argonaut-technique-analysis.md](docs/argonaut-technique-analysis.md): what argonaut's video shows (frames only, no transcript), the method, formulas, pseudo-code, parameters and open questions.
- [docs/v2-vs-v1.md](docs/v2-vs-v1.md): how each version works, strengths, weaknesses, performance, what to look for, the lighting model and its commands.
- [docs/shots-v2](docs/shots-v2/): screenshots (light, dark, sun left, noon and right, night, pixel cave, egg, narrow, compare) and proof sheets.

## Version 3: top-down

A third prototype in `prototype-v3/`: version 2's chain walker seen from straight above, where the bending spine and the stepping feet are the whole picture. The body outline is drawn from each joint's width, with a head and eyes, a tail, the mouth kinds, legs solved by two-bone IK in the plane, and a sun-cast shadow. It keeps the hatching, habitats seen from above, the three looks, food, hunger and the "prototype only" labelling.

- Open `prototype-v3/index.html` (or `prototype-v3/creatures-v3-standalone.html`).
- [docs/v3-topdown.md](docs/v3-topdown.md): how it is drawn, what it shares with version 2, and its commands.
- [docs/shots-v3](docs/shots-v3/): screenshots of version 3 and of the compare lab.

## Compare lab

`prototype-v2/compare.html` runs all three versions on one clock with the same seed and the same scripted scenario (S-curve, figure eight, U-turn, spin, speed ramp, stops, long and short bodies, 2 to 8 legs, follow a target), with play, pause, frame steps, 0.1× to 2× speed and a scrubber. A *machinery* toggle per version draws how it works (version 1's rings and gait clock; the chain, angle limits, foot targets and step triggers of versions 2 and 3), with trails, live numbers (foot slide, turn radius, leg crossings, wobble, spine bend, ms per frame), a "what is different" panel with a verdict, and a one-click filmstrip. See "How to see the difference" in [docs/v2-vs-v1.md](docs/v2-vs-v1.md).
