# Creature generation: the approach

How the web model (`creatures/prototype/`) makes, grows, draws and moves a creature, and the numbers behind it. The goal for this first version is a faithful copy of the technique in the GOCHITAMA video ([video-analysis.md](video-analysis.md)); other art styles are now looks on the same pluggable renderer ([art-style-options.md](art-style-options.md)).

Pipeline: **seed → genome (two copies) → expressed genes → phenotype (+ temperament, + growth, + repair) → ring-stack body + parts → signed distance field → per-pixel ray march → banded light, ink, decals → sprite.**

## 1. Seed and genome

- A seed is any string or number. It is hashed to 32 bits and drives mulberry32 (`makeRng`). Same seed, same creature, on every machine: no `Math.random()` anywhere in generation.
- A creature is `{ seed, name, generation, copies: [A, B], parents }`. Each copy is a flat list of **105 named numbers** (`genome.js`, `GENES`), alphabetical in the page's Numbers tab, exactly like the video's step 1.
- Genes are grouped into **pieces**: head, neck, torso, tail (each: length, angle, curve, and 5/3/5/5 rings of width and height), legs, wings, horns, ears, eyes, face, decor, colour, pattern, skin. Every piece has a hidden dominance number (`<piece>.dom`); the copy with the higher one is the copy you see (`expressedCopyIndex`). That is how a trait skips a generation.
- Kind genes are continuous and rounded at use (`legs.pairs` 0–3.49 → 0…3, `ears.kind`, `pattern.kind`, `horns.count`, `decor.kind`), so a nudge can tip a kind over, but rarely.
- Some genes are sparse on purpose: wings only appear above `WING_MIN = 0.42`; horns are absent 40% of the time. Most creatures are plain, a few are showy, which is what makes rarity mean something.

## 2. Body: ring stacks and parts (`body.js`)

- Each of the four pieces is a spine (a bent curve with its own length, angle and curve) carrying rings. Neighbouring rings become **elliptical round cones**, so a piece is a "sausage with opinions". The tail ends in an optional tip (a pale or dark brush).
- Parts attach at fixed fractions along the pieces: legs (0–3 pairs, thigh + shin cones, a foot, claws), wings (thin triangle membranes with finger bones), horns (curved cone chains), ears (pointed, round, long), decor (sprout, flower, antennae, spikes), a jaw with fangs.
- Faces are **decals**, not geometry: eyes, glints, blush and a three-point mouth line are anchored to the surface and drawn after shading, so they stay crisp at sprite size. Expressions (neutral, happy, angry, sleepy, surprised) change eye openness, brows and mouth curve.
- `layout(ph)` puts the hips at a height that keeps the feet on the ground (`legIK` solves the knee), so the ground contact is always right regardless of leg length.

## 3. Rendering: "every pixel asks am I inside?" (`render.js`)

- **Field**: every primitive is a signed distance function (round cone, ellipsoid, thin triangle). They are joined with a polynomial smooth-min, `smin(a, b, k)`, with a per-part blend radius: the body pieces melt strongly, eyes, horns and claws barely.
- **Ray march**: orthographic camera (yaw 1.0, pitch 0.45: the video's three-quarter view from above). Each pixel gets a list of candidate primitives whose bounding spheres its ray crosses, then sphere-traces only those. A 96 × 96 creature takes **20–40 ms** in Node on one core; an egg about 8 ms.
- **Normal and light**: tetrahedron normals; one key light upper-left-front; lambert cut into bands (thresholds 0.18 / 0.45 / 0.8) plus a highlight when the creature is glossy.
- **Colour**: every material has a six-step **hue-shifted ramp** (ink, shadow, mid, base, light, highlight): shadows drift toward blue-violet, lights toward warm yellow, the way pixel artists pick colours. Belly, pattern (value noise in body space), tail tip, wing, accent and decor each get their own ramp.
- **Ink**: a 1-pixel outline in the darkest ramp colour (tinted, never black) wherever the silhouette ends or depth jumps by more than a threshold (nearer part over farther part).
- **Background**: transparent. A soft ground ellipse (sized from the body's footprint, shrinking when it hops or flies) is the only thing drawn outside the body.
- **Pluggable styles**: a style is a function from a hit (material, position along the piece, normal, light) to a colour, plus whether to ink. `registerStyle(name, fn)` adds one. Shipped: `gochi` (the video's finished look), `pieces` (rainbow per piece, the video's debug view), `flat` (one colour silhouette) and `inside` (the raw inside/outside mask). A new art style is a new entry, nothing else changes.

### Options considered

| Option | Verdict |
|---|---|
| **CPU ray-marched SDF (chosen)** | Exactly the video's technique; deterministic; runs in Node for tests and sheets; fast enough at sprite size, because we render ~10k pixels, not millions. |
| WebGL fragment shader of the same SDF | The same pictures 100× faster. Worth it only if many creatures animate at once; the overlay shows one. Keep as the upgrade path; the field code ports almost line by line. |
| Polygon meshes (marching cubes) | Seams and faceting at small sizes; extra step for nothing. |
| Hand-drawn part sprites layered | The thing the video set out to avoid; doesn't melt, doesn't scale to infinity. |
| PixelLab or other image AI per creature | Not deterministic, costs credits per creature, can't morph per level. Allowed only for UI chrome or backgrounds (and not used yet). |

### Animation and performance

- Sprites re-render at a pixel-art clock of **12 fps** (`SPRITE_FPS`), which is both the look and the budget: ~30 ms per frame on one creature leaves most of a core free. The overlay renders at most one creature per frame, and only when its pose changed.
- Poses are cheap to change (they move primitives), so the whole body re-renders each frame; no caching of parts is needed at this size.
- Idle (no pose change, Calm on, faded) costs nothing: the last frame stays on the canvas.

### Looks (the style switcher)

Seven finished looks share the body, light and pose and differ only in how a hit pixel becomes a colour: Original (`gochi`, the default), Matte, Cel, Pixel, Chunky, Ink and Sticker. Pixel and Chunky render at half or quarter size and blow up with nearest-neighbour, take an optional fixed palette (Game Boy, PICO-8, warm earth) and are 3–10 times cheaper. A Shine option (0–1) removes the glint in every look. `registerLook(name, { label, shade, pixel, inkWidth, decals, post })` adds one. Options, costs and the recommendation: [art-style-options.md](art-style-options.md).

### Motion: the walk (`motion.js`)

Nobody animates the walk; it is a gait clock and planted feet. The constants are named at the top of `motion.js`.

- **Gaits per leg count**: one clock (phase 0–1 per stride) and, for each foot, a phase offset (when it lands) and a duty factor (share of the cycle on the ground). Two legs: walk (duty 0.62, alternating) and jog (0.5). Four: lateral-sequence walk (0.75, three feet down) and trot (0.56, diagonal pairs). Six: wave (0.7, a back-to-front ripple) and tripod (0.52). Legless: a scoot. Offsets blend smoothly between walk and hurry.
- **Planted feet**: in stance a foot is pinned to the world (no slide, tested to 10⁻⁶); in swing it lifts (a share of the leg length) and lands half a stride ahead of its rest spot. The clock runs by distance travelled, so a stance sweeps exactly one stride, whatever the speed.
- **Stride, cadence and speed** come from leg length: cadence scales with 1/√leg, stride with leg length, and a stride takes a whole number of 12 fps frames so walks loop crisply. A level 1 baby takes 60% of an adult's stride at a higher cadence and waddles more; adults stride.
- **Reach**: the stride is capped so hip-to-foot never passes 95% of the leg (tested ≤ 0.985 with the body moving, for 2, 4 and 6 legs at every level 1–100); the body may crouch up to 10% of a leg to make room. Two-bone IK puts the knee forward.
- **Body**: it bobs (highest over the planted foot when walking, dipping when hurrying), pitches toward the feet holding it, rolls and sways toward the standing side. The head counters part of the bob and pitch; the tail follows on a lagging spring; wings flap out of phase with the steps.
- **Start, stop and turn**: speed ramps up in 0.45 s with a lean into it, the left hind foot first; stopping keeps stepping until every foot is back under its hip; it turns round only when stopped and settled.
- **Walk debug** (`?debug=1` or the Walk debug button): ground contact lines, hip–knee–foot lines, planted feet green, swinging feet orange with a cross where they will land, and the gait's name, phase and duty. `?gait=walk|hurry` keeps it walking. `tools/walkstrip.js` draws frame strips and prints foot slip, stretch and how many feet are up per frame.

Before this pass a foot stepped only once the body had got too far ahead of it, with a fixed step time, one diagonal rule for every leg count and one walking speed: hexapod legs were pulled to 1.1× their length, feet left in bursts and the body then glided on planted feet, and babies walked at the same speed as adults. Strips: [before](shots/walk-before-side.png), [after](shots/walk-after-side.png), [babies after](shots/walk-after-baby.png), [hurry](shots/walk-after-hurry.png).

## 4. Growth: level 1 to 100

Stages, named constants in `genome.js` (`STAGES`, `LEVEL_MAX`):

| Levels | Stage |
|---|---|
| 1–25 | baby |
| 26–55 | child |
| 56–99 | teen |
| 100 | adult (final form) |

`applyGrowth(ph, level)` uses growth g = (level − 1) / 99 eased fast-early (e = 1 − (1 − g)^1.6), and every level changes every growing number a little, so **each level-up visibly changes the creature** (tested: all 100 levels render differently). Babies are half size, with a big round head (×1.5), big round eyes, blush, short neck, stubby tail and short legs, paler and less saturated. Parts arrive in their own windows: markings fade in from level 6, wings unfold from 12 to 85, horns sprout 20 to 75, claws 30 to 80, fangs 40 to 90. Level 100 adds a final gloss. The page and the overlay frame the camera on the adult, so a baby really looks small next to where it will be.

## 5. Temperament: the one bar

`applyTemperament(ph, t)` with t from −1 (SCARY) to +1 (CUTE), applied before growth, exactly the video's captions:

- **Cute**: smaller (−20%), head ×1.45 and rounder snout, eyes ×1.9 and round, legs −38%, blush, paler and desaturated, hue drifts +25° (the dragon goes lilac), fangs and horns shrink.
- **Scary**: bigger (+30%), darker (−42% lightness), more saturated, longer head, eyes smaller and slanted with a glow, fangs, horns grow (+80%), and a hornless creature **sprouts a pair** past `SPROUT_HORNS = 0.3`.

Each creature is born with its own temperament gene; the slider overrides it. In the game the slider is not a cheat (it changes look, not level); it is the "personality" you choose for your pet.

## 6. Variation and rarity

- **Uniqueness**: a fingerprint of the expressed genes; the tests check 1,000 seeds give 1,000 different fingerprints and that every visible kind (all leg counts, horn counts, ear, decor and pattern kinds, wings on/off) actually appears.
- **No beige soup**: breeding keeps whole pieces (never averages), two copies, `NUDGE = 0.025` of each gene's range per breeding, `SURPRISE_CHANCE = 0.06` rerolls one piece. Tested: ~6% surprises, pieces trace back to a parent's copy.
- **Repair pass** (`repair`): head ≤ `HEAD_MAX_RATIO = 1.6` × body, legs back if none, neck ≤ 1.1 × torso, tail thinner than torso, no ring jumps over 1.9×, legs long enough to clear the belly. Notes what it fixed (the About tab shows them).
- **Rarity** from how far out a few signature numbers sit plus showy combinations (wings and horns, six legs, decor + pattern + wings). Over 2,000 seeds: **common 54%, uncommon 26%, rare 15%, legendary 6%**. About 28% of creatures have wings; a third of those can actually fly (lift ≥ `FLY_RATIO = 0.9`); the rest try anyway.

## 7. Eggs and hatching

- The egg comes from the genome too (`eggLook`), so eggs differ before they hatch: shell tint from the body colour, markings (speckles, spots, zigzag, bands) from the pattern piece, mark colour from the accent/decor hue, shape (round vs tall) from the body. Rendered by the same ray marcher, with a shell thickness and a zigzag cut.
- Hatching: wobble (now and then while waiting, faster when ready), crack lines grow over the shell (0 → 1), the cap tips off along the zigzag, the baby appears with a hop, the shell fades. About 3 seconds; instant with reduced motion.

## 8. Levels from Claude usage (no cheats)

Levels come **only** from the same Claude Code feed the ant farm reads (transcript tailing, `tokens` events). Weighted tokens are the ant farm's: `w = input + output + cache_write + 0.1 × cache_read` (`CACHE_READ_WEIGHT`), with the ant farm's soft cap (`SOFT_CAP = 200k` weighted an hour, logarithmic above it).

| Constant (`genome.js`) | Value | Meaning |
|---|---|---|
| `HATCH_TOKENS` | 25,000 | weighted tokens to hatch an egg (a short session) |
| `LEVEL_BASE_TOKENS` | 3,000 | level 1 → 2 |
| `LEVEL_EXP` | 1.15 | level L → L+1 costs `3000 × L^1.15` |

Milestones: level 10 at 176k, child (26) at 1.5M, level 50 at 6.1M, teen (56) at 7.9M, level 75 at 14.8M, **adult (100) at 27.5M weighted tokens**. For a steady user (1–2M weighted a day) that is two to four weeks per creature, like a real pet; a heavy day can't skip ahead because of the soft cap.

There is no feed button, no "add level" key, no debug token injection in the game. The web model's level slider is a preview of what each level will look like, labelled as such; the game has no slider.

## 9. Calm, fade when idle, reduced motion

Same settings and meanings as the ant farm, from the same shell (the web model honours only the system reduced-motion setting; Calm and fade belong to the overlay):

- **Calm** (0–100%): lowers saturation and contrast of the rendered sprite (applied to the ramps), slows idle animation.
- **Fade when idle**: after a few quiet seconds the window sinks toward the desktop; the creature curls up to sleep (sleepy face, slow breathing); a token event wakes it.
- **Reduced motion** (and the system setting): no walking, no flying, no hops; blinks and breathing only; hatching and level-ups are instant with a short glow instead.

## Files

- `genome.js`: seed, genes, breeding, temperament, growth, repair, traits, egg look, tokens → levels.
- `body.js`: phenotype → primitives and decals (pieces, parts, face, egg).
- `render.js`: SDF, ray marcher, styles, palette, ink, decals, camera framing.
- `motion.js`: walker (gaits per leg count, planted feet, body bob and sway, tail and head springs, wings, hop, blink, look).
- `app.js` + `index.html`: the web model page.
- `test/`: unit tests (`node --test test/`) and `test/e2e.js` (headless page checks).
- `tools/`: `sheets.js` (contact sheets in Node), `shots.js` (headless page screenshots), `walkstrip.js` (walk frame strips and foot metrics), `bundle.js` (single-file page), `png.js`.
