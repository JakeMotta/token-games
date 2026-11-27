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
| Side by side | `prototype-v2/compare.html` | (uses the two `index.html` pages) |

Each page has links to the others. The compare page shows both versions with the same seed, level, look and habitat; change them in the form and press **Show both**. Add `&pause=1` to the compare page's URL to hold both still, or `&sun=left|noon|right` to set version 2's light.

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
node test/e2e.js [seed] [page]     # headless page checks (no window); page: index.html, creatures-v2-standalone.html, compare.html
node tools/shots.js ../docs/shots-v2   # screenshots: light and dark, sun left / noon / right, night, pixel cave, egg, narrow, compare
node tools/proof.js ../docs/shots-v2   # turn, spin, eating, habitats and sun proof sheets
node tools/bundle.js               # rebuild creatures-v2-standalone.html after editing the scripts
```

Pictures: [shots-v2/](shots-v2/), for example `v2-sun-left.png`, `v2-sun-noon.png`, `v2-sun-right.png`, `v2-adult-dark.png`, `compare.png` and `proof-sun.png`.
