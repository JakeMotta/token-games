# Versions 1, 2 and 3 compared: measured

Versions 1 and 2 look much alike side by side. These are the numbers behind the compare lab's results table
(`prototype-v2/compare.html`, section *Measured*). They come from `node prototype-v2/tools/compare-results.js`,
which writes `prototype-v2/compare-results.js`. Measured on 2026-11-27 on an Apple M1 Pro (10 cores), Chrome
headless with the GPU off.

## Verdict

- **Version 1** (rings and limbs on a gait clock). It has the most regular step timing, because it walks to a
  clock, and a slightly cheaper update. But its hips judder almost three times as much as version 2's, its worst
  foot slip is five times bigger, and its legs cross nearly twice as often. Once in 20 feedings (two legs, seed
  `moss`), it circled the berry and gave up after 30 s.
- **Version 2** (Argonaut chain, 3/4 view). It is the smoothest to look at:
  - the hips glide
  - a planted foot hardly ever slides
  - fewer crossed legs
  - it keeps closer to the path

  Its steps come when a foot falls behind, so the timing is a little less even. It costs a little more to draw
  than version 1, about 29 ms a creature against 26, because its body has more pieces.
- **Version 3** (version 2's motion, drawn from above). It moves just as smoothly and is **about eight times
  cheaper to draw**, because it paints flat shapes instead of ray-marching. On the CPU, five version 3 creatures
  fit in a 60 fps frame (15 ms); versions 1 and 2 cannot draw even one (26 to 29 ms). Its wider-set feet step less
  evenly.

**Pick: version 2's motion.** It is the smoother one. The difference you could not quite see is mostly in the hips,
where version 1 jitters, and the odd sliding foot. Draw it the version 3 way whenever more than one or two
creatures are on screen: drawing is what costs, not moving. Keep version 1 only if a clock-steady gait matters more
than how smooth it looks.

## Cost

Milliseconds per frame, as average · 95th percentile, over 200 frames after 40 warm-up frames. *Update* is the
motion; *draw* is the drawing. All three are drawn with their shadow on.

| Creatures | | Version 1 | Version 2 | Version 3 |
|---|---|---|---|---|
| 1 | update | 0.13 · 0.20 | 0.16 · 0.20 | **0.02 · 0.10** |
| 1 | draw | 26.0 · 30.2 | 28.8 · 34.6 | **3.5 · 3.7** |
| 5 | update | 0.34 · 0.50 | 0.42 · 0.60 | **0.08 · 0.20** |
| 5 | draw | 115.6 · 129.4 | 129.5 · 141.5 | **15.1 · 15.7** |
| 20 | update | 1.02 · 1.30 | 1.35 · 1.90 | **0.14 · 0.20** |
| 20 | draw | 391.1 · 409.5 | 448.2 · 477.6 | **58.3 · 60.2** |

The motion is cheap in all three: 20 creatures update in about a millisecond. Drawing is the cost. Versions 1 and 2
ray-march each creature into a small sprite every frame; version 3 draws flat canvas shapes.

## Smoothness

35 runs (7 scenarios × 5 creatures) at a fixed 1/60 s step, so these numbers are the same on any machine. Lower is
smoother, except where noted.

| Measure | Version 1 | Version 2 | Version 3 |
|---|---|---|---|
| Foot slip, average (% of body length) | 0.42 | 0.45 | **0.18** |
| Foot slip, worst (% of body length) | 5.3 | 1.1 | **0.3** |
| Hip jitter (‰ of body length) | 0.43 | **0.16** | **0.16** |
| Heading wobble (°/s) | 4.4 | **4.3** | **4.3** |
| Step timing spread (% of the mean stride) | **13** | 15 | 45 |
| Leg crossings per run | 33.8 | 18.9 | **5.7** |
| Off the path (body lengths) | 0.06 | **0.05** | **0.05** |
| Tightest turn radius (body lengths) | **0.76** | 0.79 | 0.79 |

The scenarios are S-curve, figure eight, U-turn, 2, 4 and 6 legs, and stops. The seeds are `moss`, `g9`, `fern`,
`ember` and `tide`. Version 3 shares version 2's hips, path and turns, because it runs the same chain. Its feet
differ: they are set wider so they read from above.

## Eating

20 berries per version: 4 bodies (the seed's own, 2, 4 and 6 legs) × the 5 seeds. Each is dropped at 1 s, in the
same place relative to the mouth.

| | Version 1 | Version 2 | Version 3 |
|---|---|---|---|
| Reached the berry in | 5.2 s | 5.1 s | 5.1 s |
| Ate it in | 2.8 s | 2.8 s | 2.8 s |
| Berries eaten | 19 of 20 | **20 of 20** | **20 of 20** |

Each eats its own way:

- **Version 1** walks to a spot a neck's length away, stops, pivots on the spot to face it, lowers its head and
  bites.
- **Version 2** steers its head to the berry, and the chain follows. It stops with its mouth over the berry, turns
  the head the last bit, and the front of the chain dips.
- **Version 3** is version 2's way, seen from above: the head leads, and the body curves after it.

The berry and the Feed button are a prototype tool for comparing eating, not part of the game (usage is still the
game's only input).

## Caveats

- Cost is measured in headless Chrome with the GPU off. Every canvas is drawn on the CPU, the same for all three, and
  this is slower than a real window. Cost numbers are for this machine only.
- Versions 1 and 2 both use version 1's cast shadow here. Version 2's own page lights its shadow differently
  (`light.js`), and that was not timed.
- An earlier run had versions 1 and 2 without a shadow, which was unfair to version 3. Their scenes lacked the floor
  footprint the cast shadow needs. This run fixes that, and the compare page's Shadow switch now draws it for all
  three.
- The timer in a `file://` page is rounded to 0.1 ms, so update times below that are averages of many rounded
  readings.
- **Run the benchmark here**, on the compare page, times the browser you open it in, GPU included, and replaces the
  cost rows.

## Rerunning

```sh
cd creatures/prototype-v2
node tools/compare-results.js              # runs tools/bench.js (about 4 min), then the smoothness and eating runs
node tools/compare-results.js --bench b.json --print   # reuse a saved benchmark (node tools/bench.js b.json)
node tools/bundle.js                       # refresh creatures-compare-standalone.html with the new numbers
```

The verdict lines are written by hand in `tools/compare-results.js`. Read them again after changing a walker.
