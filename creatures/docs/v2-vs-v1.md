# Version 2 vs version 1

Two prototypes of the same creatures, side by side. They share the genome, the looks (Original, Cel, Pixel), the habitats, eggs and hatching, food and hunger, mouths, the controls, and the "prototype only" food button with no cheats. They differ in one thing: how the body and legs are built and moved.

- **Version 1: rings plus limbs** (`prototype/`, unchanged except for a version label and links to the other pages). The GOCHITAMA method ([video-analysis.md](video-analysis.md)).
- **Version 2: Argonaut technique** (`prototype-v2/`). The body is a chain of joints that follows its head, with FABRIK legs ([argonaut-technique-analysis.md](argonaut-technique-analysis.md)). It also has a real light-driven shadow (below).

## How to open them

All three open straight from disk with no build step:

| Page | File | One-file copy |
|---|---|---|
| Version 1 | `prototype/index.html` | `prototype/creatures-standalone.html` |
| Version 2 | `prototype-v2/index.html` | `prototype-v2/creatures-v2-standalone.html` |
| Version 3 (top-down) | `prototype-v3/index.html` | `prototype-v3/creatures-v3-standalone.html` |
| Compare lab | `prototype-v2/compare.html` | `prototype-v2/creatures-compare-standalone.html` |

Each page has links to the others. The compare lab runs all three versions on one clock (below). Version 3 is described in [v3-topdown.md](v3-topdown.md).

## How to see the difference

Side by side in their own hatcheries, the two versions look much alike: same genome, same renderer, same looks, and each creature wanders on its own. The compare lab (`prototype-v2/compare.html`) takes that noise away and shows the machinery.

**One creature, one path, one clock.** All three versions hatch the same seed and are steered along the same scripted path by the same rule (pure pursuit, through the walkers' `drive` hook, which only steers; it never feeds or grows anything). Every step is a fixed 1/60 s, so the run is deterministic: **Play**, **Pause**, one frame back or forward, a **speed** slider from 0.1× to 2×, and a **scrubber** that re-simulates from the start and lands on exactly the same frame.

**Scenarios** (the menu): S-curve, figure eight, a sharp U-turn, a spin in place, a speed ramp, sudden stops, a very long and a very short creature, 2, 4, 6 and 8 legs (8 only here; the genome grows at most 6), and *follow a target* (it jumps every 3.2 s; click a view to place it yourself). Wavy ground is not offered: every version's feet and shadows assume a flat floor.

**Machinery** (a toggle per version, on by default). The legend on the page says what each mark is; in short:

| | Version 1 | Versions 2 and 3 |
|---|---|---|
| Body | Blue rings: the cones the body is built from, on one stiff spine | White chain: joints (dots), their widths (blue circles), the head that is steered (cyan arrow) |
| Limits | None: the body is one rigid piece | Purple wedges: how far each link may bend from the one in front; red at the limit |
| Legs | Pink hips, white bones; green feet planted, orange swinging to an orange cross | The same, plus a dashed gold circle per foot: its wanted spot and how far it may fall behind |
| Timing | A **gait clock** dial: one ring per leg, green while that foot is down; the hand sweeps and feet obey | **"How far behind" bars**: each fills as its foot falls behind; at the dashed line it steps, and a gold ring opens on the floor |

**Trails** (toggle): the body's path in yellow, footprints as dots (blue left, pink right). Ragged footprint rows mean uneven steps; a wide yellow loop at a U-turn is the chain's arc.

**Live numbers** under each view (hover for what each measures): foot slide (how far a planted foot drifts before it lifts, % of a body length), tightest and current turn radius (body lengths, over the last 45° of turning), leg crossings (two legs' floor shadows crossing), body wobble (heading jitter around its smooth turn, °/s), spine bend (degrees of curve along the body), distance off the path, and ms per frame (motion and body, plus drawing).

**What is different here**: four to six plain sentences generated from those numbers, then a verdict per scenario in two parts: *by eye* (written down from watching each scenario; it is authored, not measured) and *by the numbers* (whichever version wins more of the measures; a tie with wins on both sides is a *split* that names what each wins).

**Record 5 s of each** makes a filmstrip: ten frames half a second apart from the current time, one row per version, with the machinery as shown. It appears on the page with a **Save PNG** link.

Pictures of the lab (machinery on): [shots-v3/compare-scurve.png](shots-v3/compare-scurve.png), [compare-uturn-dark.png](shots-v3/compare-uturn-dark.png), [compare-legs6.png](shots-v3/compare-legs6.png), and filmstrips [compare-uturn-film.png](shots-v3/compare-uturn-film.png) and [compare-scurve-film.png](shots-v3/compare-scurve-film.png).

What the numbers show (seed `moss`, level 100, the full length of each scenario):

| Scenario | Spine bend v1 / v2 | Tightest turn v1 / v2 (body lengths) | Foot slide v1 / v2 |
|---|---|---|---|
| S-curve | 5° / 75° | 0.63 / 0.66 | 0.3% / 0.5% |
| Figure eight | 5° / 99° | 0.60 / 0.57 | 0.2% / 0.5% |
| U-turn | 13° / 109° | 0.30 / 0.40 | 0.3% / 0.6% |
| Long creature | 4° / 106° | 0.23 / 0.25 | 0.3% / 0.7% |
| Short creature | 7° / 40° | 1.41 / 1.44 | 0.3% / 0.1% |

The clearest difference is the spine: version 2's body bends 10 to 20 times more along its length, and that is what makes it read as a lizard rather than a rod. Turns are close on these paths because both are steered along the same line; in the U-turn and the spin version 1 turns tighter (it pivots; a chain can only loop). Planted feet barely slide in either (under 2% of a body length), so foot sliding is not what tells them apart. Leg crossings show up with many legs on a short body (version 2's neighbour rule lets adjacent feet cross more). Creatures with short legs walk slowly with 6 or 8 legs (seed `moss` covers under a body length in the 8-leg scenario); try seed `g37` or `g12` for those.

The lab's pure part is `prototype-v2/lab.js` (scenarios, steering, measures, the sentences), unit-tested in `test/lab.test.js`; the page is `compare.js`. Query parameters: `seed`, `level`, `scenario`, `style` (gochi, cel, pixel), `speed`, `t` (start paused at that time), `debug=1` (every debug drawing on), `m1` `m2` `m3` (`1` or `0` turns a version's machinery on or off), `trails=1`, `body` (own, legs-2, legs-4, legs-6, legs-8), `s1` `s2` `s3` (a seed per column, which unlocks them), `lock=0`, `feed=<seconds>` (drop a berry then), `film=1` (record the filmstrip on load). The page is dark only. Measured results across many seeds: [compare-results.md](compare-results.md).

## How each works

**Version 1.** The genome is expressed as four ring stacks (tail, torso, neck, head) plus parts. Each frame the whole body is one rigid piece with a position and a heading. It bends in only two places: the tail swings on a spring and the head looks around. The legs run on a gait clock. Each foot has a phase offset and a duty factor; it is pinned while down and swings half a stride ahead when its phase comes up. The knees use two-bone IK. A big turn is a pivot: it slows down and turns on the spot on planted feet. A ground ellipse is its shadow.

**Version 2.** `chain.js` resamples the same ring stacks into a chain of 8–26 joints along the body's centre line. The link length is 0.55 × the torso's mean width, and each joint keeps its ring width and standing height (the video's radius array). Each frame `motion2.js` moves the head and calls `follow`:

- Every joint keeps its link length to the joint in front (the distance constraint).
- Every link bends at most 0.42 rad (neck), 0.2 (torso) or 0.36 (tail) from the one in front (the angle constraint).

Hips ride on the torso joint nearest to them. A foot stays planted until its wanted spot (the rest spot, led by half a stride × speed) is one stride away, and only if the feet next to it are down. It then swings there, and the two-bone leg is solved by FABRIK with a knee pole. The chain is then turned back into the same round cones Version 1 draws, and Version 1's renderer melts and shades them in the chosen look. The head, face, mouth, wings and decorations ride rigidly on their joint. U-turns and spins are tight arcs (the head circles at 0.3 body scales and the body flows after it), not pivots.

## Strengths and weaknesses

| | Version 1 | Version 2 |
|---|---|---|
| Bending | Stiff body; only the tail and head move | The whole spine curves through turns, like a lizard |
| Turns | Turns on the spot: compact, good in a small notch | Sweeps an arc; needs room. A tight U-turn is a little loop |
| Legs | Even, rhythmic gaits (walk, hurry) per leg count | Steps when needed, so it is uneven and organic. At a standstill feet settle back |
| Long bodies | A long tail or neck is one rigid piece | Long creatures look best: tails and necks trail and curl |
| Predictability | Easy to time (the gait clock) | Emergent. Odd poses are possible when the head turns fast |
| Shadow | Ground ellipse | Projected from the real pieces, light-driven (below) |
| Code | One rigid transform | Chain plus one rig per creature (cached), a little more per frame |

## Performance

Measured in Node (motion step plus building the scene the renderer draws), per frame, averaged over 600 frames at level 80:

| Seed (legs, joints) | v1 step | v1 step + scene | v2 step | v2 step + scene | v2 + shadow blobs |
|---|---|---|---|---|---|
| moss (4, 9) | 0.016 ms | 0.078 ms | 0.016 ms | 0.096 ms | 0.104 ms (212 blobs) |
| g12 (6, 8) | 0.013 ms | 0.061 ms | 0.013 ms | 0.068 ms | 0.083 ms (131 blobs) |
| g37 (2, 13) | 0.006 ms | 0.047 ms | 0.003 ms | 0.041 ms | 0.056 ms (99 blobs) |

Both versions take well under a tenth of a millisecond per frame for motion and scene. Both draw with the same per-pixel renderer, whose cost depends on the number of pieces (26–43 in both), so drawing costs about the same. The extra cost in Version 2 is the shadow layer: its blobs are drawn to an offscreen canvas every frame and turned into the look's alpha. That was not timed separately in the browser. In the notch (1–4 fps) it does not matter; in the window it is one extra full-stage canvas pass.

## What to look for

- **Turns:** watch a 180° turn in both. Version 1 pivots in place; Version 2's head loops round and the body follows the same path. See `shots-v2/proof-turn-4legs.png` and `proof-spin-6legs.png`, and Version 1's `shots/` proofs.
- **Spine:** in Version 2 the torso and tail curve while it wanders. In Version 1 they stay straight.
- **Feet:** planted feet never slide in either version (unit-tested). Version 2's steps are less regular.
- **Long creatures:** long tails and necks (try seed `g37`) show the difference most.
- **Shadows:** move the time-of-day slider in Version 2. The shadow swings from right (morning) to short (noon) to left (evening), stretches at a low sun and follows the legs.

## The lighting model (version 2 only)

`prototype-v2/light.js`, unit-tested in `test/light.test.js`.

- **Time of day** *t* runs from 0 to 1. Sunrise on the left is 0, noon is 0.25, sunset on the right is 0.5. From 0.5 to 1 is night, and a dim moon crosses the same way.
  - **Slider:** the time-of-day slider sets it.
  - **Auto:** the Auto button cycles one day and night in 90 seconds.
  - **URL:** `?sun=` takes `dawn`, `left`, `morning`, `noon`, `afternoon`, `right`, `dusk`, `night` or a number.
- **Direction:**
  - The share of the way across the sky is *u*.
  - Elevation = 10° + (64° for the sun, 42° for the moon − 10°) · sin(π*u*).
  - The direction toward the light runs from left to right across the screen, a little behind the scene (z weight −0.45), so shadows fall slightly toward the viewer.
- **Strength:** the sun is 0.4 at noon, fading toward the horizon; the moon is 0.13.
- **Tint:** the picture is multiplied by a tint:
  - warm (255, 198, 160) near dawn and dusk
  - white by day
  - blue (124, 138, 196) at night, when the dim moon disc shows in the sky
- **Casting:** every piece the renderer draws is sampled as a row of spheres. This covers body cones, legs and feet, head parts, wings and tail.
  - Each sphere's centre *c* lands on the ground at *c − L · c.y / L.y*.
  - Its shadow is an ellipse *r / sin(elevation)* long along the light and *r* wide.
  - The result: long and thin at a low sun, short at noon, always pointing away from the light. It moves with every step, turn and hop, because it is built from that frame's pieces.
- **Softness:** a piece higher above the ground casts a softer, fainter shadow:
  - edge = 0.08 r + 0.14 · height / sin(elevation)
  - density = 1 / (1 + 1.6 · height / size)
- **Drawing:** the ellipses are drawn together into one coverage layer, so overlaps don't double up. That layer is turned into shadow alpha by look:
  - **Pixel:** hard, in 2-pixel blocks, one tone.
  - **Cel:** two tones.
  - **Original:** soft.
  - The shadow colour is a cool dark (22, 24, 44). It is drawn under the creature on every habitat floor.

**Known gaps.**
- The creature's own shading still uses the renderer's fixed light, because Version 1's `render.js` is shared and unchanged. Only the cast shadow, the sky marker and the tint follow the sun.
- Food lying in the creature's shadow is not darkened.
- The Cave habitat still shows its sun or moon disc on the back wall.
- The proof sheet's turn label reports the body's heading, which lags the head. It reads about 150° when the head has finished 180°.

## Commands

```sh
cd creatures/prototype-v2
node --test test/                  # chain, motion and light unit tests, plus the headless page check
node --test test/lab.test.js      # the compare lab: scenarios, determinism, measures, verdicts
node test/e2e.js [seed] [page]     # headless page checks (no window); page: index.html, creatures-v2-standalone.html, compare.html (the lab's own checks)
node tools/shots.js ../docs/shots-v2   # screenshots: light and dark, sun left / noon / right, night, pixel cave, egg, narrow, compare
node tools/proof.js ../docs/shots-v2   # turn, spin, eating, habitats and sun proof sheets
node tools/bundle.js               # rebuild creatures-v2-standalone.html after editing the scripts
```

Pictures: [shots-v2/](shots-v2/), for example `v2-sun-left.png`, `v2-sun-noon.png`, `v2-sun-right.png`, `v2-adult-dark.png`, `compare.png` and `proof-sun.png`.
