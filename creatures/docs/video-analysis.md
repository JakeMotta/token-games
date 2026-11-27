# The video: how GOCHITAMA's creatures work

Source: `generative creatures.mp4` (Jake's Downloads), a 152-second vertical devlog (720 × 1280, captions burned in), "GOCHITAMA devlog #1". The developer is making a game "where you raise and breed little monsters" and shows how the creatures are made, and what goes wrong. Nothing below comes from the developer's code; it is read from the frames and captions (OCR every 0.3 s, then checked by eye) and from what the pictures show. Where something is my inference rather than a caption, it says so.

## The narration, in order

| Time | Caption (cleaned up) | What is on screen |
|---|---|---|
| 0–6 s | "This is a dragon. This is the same dragon with one number changed. Nobody drew either of them." | Two pixel-art dragons side by side, same pose, one changed proportion. |
| 8–21 s | "I'm making Gochitama, a game where you raise and breed little monsters. Here's how they're made, and what goes wrong, which is a lot. Drawing every creature by hand is fine if you have ten. You have infinity, and infinity doesn't fit in my schedule." | Grid of many different creatures. |
| 22–31 s | "So a creature is a list of numbers. Four body pieces: tail, torso, neck, head. Each one is a stack of rings. Basically a sausage with opinions." | A list of named numbers in alphabetical order (`head.length`, `head.rings[0].width`…), then each piece drawn as rings of different sizes along a curve. |
| 32–39 s | "Then parts: legs, wings, horns, eyes. 31 kinds. One of them is a throat sac. Please stop asking about the throat sac." | Parts snapping onto the ring stack. |
| 41–47 s | "Then the game melts it all into one smooth body, and every pixel asks: am I inside the creature?" | The pieces blend into one surface; a scanline sweeps the canvas, pixel by pixel, filling the silhouette. |
| 47–53 s | "Yes: colour, light, outline. No: stay see-through, so it fits into anything." | Silhouette → flat colour → banded light → dark outline. Background stays transparent; shown over different backdrops. |
| 54–56 s | "Pixel art, and nobody pixelled it." | The finished sprite at real size, then zoomed. |
| 57–74 s | "And since it's all numbers, this slider makes anything cuter or scarier. Cute: big head, big eyes, short legs, blush. Scary: bigger, darker, fangs, horns. Here's the dragon fully cute. It's lilac now. It will never forgive me." | One slider, SCARY on the left, CUTE on the right. Dragging it morphs the creature smoothly; the fully cute dragon has shifted hue toward lilac. |
| 75–81 s | "Faces work the same way: happy, angry, sleepy, surprised. After the slider, mostly angry." | The same face in four expressions: eye shape, brows and mouth change. |
| 82–93 s | "Now average two parents and you get something round and… keep averaging and the whole world becomes one beige ball. Biologists call that losing variance. I call it soup." | Generations of averaged children converging to a beige blob. |
| 94–99 s | "So whole pieces come from one parent about half the time. Fox tail, toad body." | A child with one parent's tail and the other's torso, unblended. |
| 99–108 s | "And every creature secretly carries two copies of itself, one from each parent. Its babies inherit one, so grandma's eyes can skip a generation and come back." | Two hidden genomes per creature; one shows. |
| 110–115 s | "Anyway: add a tiny random nudge to every number, and a real surprise for about six babies in a hundred." | Children varying slightly; an occasional child with a wildly different piece. |
| 115–119 s | "Even names breed: Flicker plus Croakle makes Flickle." | Two name tags combining. |
| 120–129 s | "Sometimes it goes wrong. An owl's head on a snake. No legs from an octopus, no tentacles from a crab. It just lays there, considering its options." | Broken children: a huge head on a thin body; a legless lump on the ground. |
| 130–135 s | "So now every baby goes through a repair pass. Every rule in it has a victim." | Rules list; before/after of the broken babies. |
| 136–150 s | "Nobody animated the walking either. Feet stay planted until the body gets too far ahead. The tail swings on a spring. And wings only lift a body when they're big enough. Too small and it doesn't fly. It tries anyway." | A creature walking: feet stick to the ground, step when stretched; tail lags and swings; a small-winged creature flaps hard and hops without lifting off. |

## The technique, step by step

1. **Genome = flat list of named numbers.** Alphabetical, human-readable (`neck.length = 0.42`). Everything else is derived. "One number changed" makes a visibly different but related creature, so the mapping is smooth.
2. **Body = four ring stacks (tail, torso, neck, head).** Each piece is a spine (length, angle, bend) with several rings (width, height) along it. This is a generalised cylinder / "sausage": radius varies along a curve.
3. **Parts from a catalogue of 31 kinds** (legs, wings, horns, eyes, ears, decorations, throat sac…), attached at positions on the pieces.
4. **Melt into one body.** The pieces and parts are joined with a smooth blend, so there are no seams where neck meets torso. That is a smooth union of signed distance fields (SDF `smin`), the standard way to "melt" shapes.
5. **Every pixel asks "am I inside?".** The renderer does not draw polygons. For each pixel it tests the point(s) along that pixel's ray against the blended distance field (ray marching / sphere tracing). Inside = creature, outside = transparent. The scanline animation in the video shows exactly this per-pixel test.
6. **If inside: colour, light, outline.** Colour from the genome (base hue, belly, pattern), light from the surface normal, cut into a few hard bands (no smooth gradients: that is what makes it read as pixel art), and a 1-pixel dark, coloured outline where the silhouette or depth jumps. If outside: stay transparent, so the sprite sits on any backdrop. A soft ground shadow ellipse sits under it.
7. **Rendered at low resolution, shown with nearest-neighbour scaling**, so every rendered pixel becomes a crisp square. "Nobody pixelled it."
8. **One temperament slider (−1 scary … +1 cute)** applied on top of the genome as a set of coordinated nudges: cute = big head, big round eyes, short legs, blush, rounder, paler and slightly hue-shifted (the dragon turns lilac); scary = bigger, darker, fangs, horns, narrower slanted eyes.
9. **Faces = the same trick for expressions**: happy, angry, sleepy, surprised are offsets to eye and mouth shape.
10. **Breeding** (to avoid the "beige ball"): whole pieces come from one parent (not averaged); two hidden copies per creature (diploid; the expressed copy wins per piece, so a trait can skip a generation); a small random nudge on every number; about 6% of babies get a real surprise (a piece rerolled); names breed (front of one, back of the other).
11. **Repair pass**: rules that fix impossible babies after breeding: head no bigger than the body allows, legs restored when a body has none, and so on. "Every rule has a victim": each rule removes some creature that was interesting.
12. **Procedural motion**: planted feet that step when the body gets too far ahead (inverse kinematics), a spring-driven tail, and wings that only lift if their area is large enough for the body; otherwise the creature flaps and hops ("it tries anyway").

## What the pictures show about the look

- **Camera**: a fixed three-quarter view from slightly above (creatures face right and toward the viewer), orthographic (no perspective).
- **Size**: sprites around 64–100 pixels tall, scaled up 3–5× on screen with hard pixel edges.
- **Light**: one key light from the upper left-front; three or four flat bands per colour (deep shadow, shadow, base, light) plus a small specular highlight on glossy creatures. Shadow colours shift toward blue/purple, highlights toward warm yellow, rather than just darker or lighter.
- **Outline**: one pixel, dark and tinted with the body colour (not pure black), around the silhouette and where a nearer part overlaps a farther one (a head over the body, a leg in front).
- **Faces**: eyes are pixel decals placed on the surface (black with a white glint; big and round when cute), a small mouth line, blush as two pink pixels.
- **Background**: transparent; shown over flat colour cards and a ground-shadow ellipse.

## How the prototype mirrors each step

| Video step | Prototype |
|---|---|
| list of numbers | `genome.js`: 105 named genes, alphabetical; shown live in the page's Numbers tab |
| four ring stacks | `body.js`: head, neck, torso, tail as rings on a bent spine (5/3/5/5 rings) |
| parts | legs (0–3 pairs), wings, horns (0/1/2), ears (3 kinds), eyes, mouth, fangs, blush, claws, decor (sprout, flower, antennae, spikes), patterns (spots, stripes, patches, speckles): about 30 kinds in all, counting each kind and count |
| melt | `render.js`: polynomial smooth-min over round cones and ellipsoids |
| every pixel asks | `render.js`: an orthographic sphere-tracer per pixel; the page's "Ask every pixel" button replays it as a scanline |
| colour, light, outline | banded lambert with hue-shifted 6-step ramps, belly and pattern noise, 1 px coloured ink on silhouette and depth jumps; transparent background + ground shadow |
| one slider | `applyTemperament` in `genome.js`, wired to the SCARY–CUTE slider |
| faces | five expressions (neutral plus the four) as eye/mouth offsets |
| breeding | `breed()`: whole pieces per parent, two copies, nudge on every number, 6% surprise, names breed |
| repair pass | `repair()`: head ≤ 1.6× body, legs back, neck ≤ body, tail thinner than body, no ring jumps, legs long enough |
| motion | `motion.js`: planted feet with diagonal gait, tail spring, wings lift only above a lift ratio, else flap-and-hop |

The 31 kinds in the video are the developer's own catalogue; the prototype has its own set of a similar size, and the throat sac is not one of them (yet).
