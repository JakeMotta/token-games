# Creatures

Generative pet creatures for the third Token Games overlay (working title **Hatchery**): an egg hatches into a baby, Claude Code usage levels it up, and over 100 levels it grows into an adult; then a new egg. Every egg is a brand-new random creature.

The creatures are made the way the GOCHITAMA devlog video shows: a list of numbers → four ring-stack pieces plus parts → one melted body → every pixel asks "am I inside?" → banded colour, light and a 1-pixel ink outline on a see-through background.

- [docs/video-analysis.md](docs/video-analysis.md): what the video shows and says, step by step, and how the prototype mirrors each step.
- [docs/creature-generation.md](docs/creature-generation.md): the approach: genome and seed, growth stages, rendering, temperament, variation and rarity, eggs, token rates, no cheats, Calm and reduced motion.
- [docs/overlay-game-design.md](docs/overlay-game-design.md): the overlay game, in the same Electron shell and on the same Claude usage feed as the ant farm.
- [docs/shots](docs/shots/): contact sheets (seeds, levels, temperament, faces, views, eggs, breeding) and page screenshots.

## Web model

Plain HTML, JavaScript and canvas, no build step: open `prototype/index.html` straight from disk (or `prototype/creatures-standalone.html`, the same page in one file).

- **New egg / Hatch / seed field**: every egg is a new random creature; the same seed always makes the same one.
- **SCARY – CUTE**: the video's one-bar slider.
- **Level 1–100**: a preview of each growth stage. In the game, levels come only from Claude usage.
- **Genes**: sliders for the main numbers; **Numbers** shows the whole genome, coloured by which hidden copy it comes from.
- **Faces, views** (finished, melted pieces, one colour, inside?), **Ask every pixel** (replays the per-pixel test), backdrops.
- **Collection**: hatched creatures are kept (in this browser only); pick two to breed an egg.

URL options: `?seed=moss&level=60&temperament=-1&face=happy&view=pieces&back=paper&pause=1`.

## Tests and tools

```sh
cd creatures/prototype
node --test test/              # genome, renderer and motion unit tests
node test/e2e.js               # headless page checks (no window); add a seed and a page name to vary
node tools/sheets.js ../docs/shots   # contact sheets, rendered in Node
node tools/shots.js ../docs/shots    # page screenshots, headless Chrome
node tools/bundle.js           # rebuild creatures-standalone.html after editing the scripts
```
