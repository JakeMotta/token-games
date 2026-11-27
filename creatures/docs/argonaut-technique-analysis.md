# The video: argonaut's "A simple procedural animation technique"

Source: `A simple procedural animation technique - argonaut.mp4` (Jake's Downloads), 510 s, 1920 × 1080, white line drawings on a dark slate background, then filled creatures (a red snake, blue fish, green lizards). Same method as [video-analysis.md](video-analysis.md): nothing below comes from the author's code. **There is no transcript.** The speech-to-text install was declined, so this is read from the frames only (contact sheets every 2 s, close-ups every second for the key parts), checked by eye. Most of the method is shown on screen as diagrams, numbers and titles, so the steps are clear. The exact wording and the reasons the author gives are not. Anything marked *(inferred)* is my reading, not something shown on screen.

## What is on screen, in order

| Time | On screen | What it teaches |
|---|---|---|
| 0–32 s | Montage: a fish, a red snake, a chain of small circles, a chain of big overlapping circles, a dashed circle round a point. | The promise: life-like creatures from a few circles. |
| 32–64 s | A lizard with its circles drawn over it. A point with an arrow to a target, and a dashed circle: the target outside the circle is pulled back onto it. | Every creature is a chain of circles. A distance constraint holds them together. |
| 64–96 s | Title **Distance Constraint**. One point kept on a circle of radius *d* around its anchor. Then many points in a row, each with a dotted circle, dragged around. | Each point stays exactly *d* from the one in front. Drag the first and the rest follow like a rope. |
| 96–128 s | The chain drawn as thick joint-to-joint bones, curling into tight loops. Then a row of circles of different sizes. | The rope can fold onto itself (the problem the later angle constraint fixes). Each joint gets its own radius. |
| 128–160 s | Radius arrays printed above the chain: `[64 × 14]` (all equal), then `[67, 82, 84, 83, 82, 76, 64, 59, 49, 36, 32, 30, 18, 14]` (a fish), then `[52, 58, 40, 60, 68, 71, 65, 50, 28, 15, 11, 9, 7, 7]` (a head, a pinched neck, a body, a long tail). The same chain bends with the new widths. Then `x = r cos θ`, `y = r sin θ`. | The body's whole shape is one list of radii, one per joint, 14 joints. The chain itself does not change. |
| 160–192 s | A unit circle with an arrow at θ = 0.52 and at θ = 3.67 (= 0.52 + π), with x and y read off. | How to find a point on a circle's edge: the two sides of a joint are the points at its heading ± 90°. |
| 192–224 s | The snake: each circle gets two small dots on its sides. A smooth outline is drawn through the dots, then filled red, with two white eyes, and dragged around. | **The skin:** a curve through the side points of every circle (plus extra points round the head and the tail tip), filled. |
| 224–256 s | The snake's head pushes into its own body and the outline tangles. Then three points and two links: the angle between them opens from 90° to a wide angle. The snake now curls only in a smooth spiral. | **The angle constraint:** each link may turn only so far from the one in front, so the body can't fold through itself. |
| 256–288 s | The snake wriggles in S-curves. Blue fish appear: a plain fish, then fish with side fins and a tail fin. | The same chain makes a fish: a different radius array, plus fins. |
| 288–320 s | Many fish, each labelled "26% curved", "5% curved", "75% curved", "45% curved". Later the fish have a lighter dorsal stripe and a thin, trailing tail fin. | The fins and tail react to how bent the body is *(inferred: the label is a curvature measure that drives the fin shapes)*. |
| 320–352 s | Title **Kinematics**. One joint, then four joints in a row ending in a gripper. The arm bends. | Introduces legs and arms: a fixed root and a free end. |
| 352–384 s | Each joint gets a circle of reach. **Forward Kinematics** (set the angles, see where the end lands). Then a target ✕ appears and the title **Inverse Kinematics** (where must the angles be so the end reaches ✕?). | FK vs IK. |
| 384–448 s | The arm reaches for ✕ in alternating passes: the end snaps to ✕ and the chain follows (forward), then the root snaps back to its anchor and the chain follows (backward). A few passes and it settles. Title **FABRIK**. Then the ✕ is dragged around and the arm tracks it, straightening when it is out of reach. | **FABRIK**: two passes of the same distance constraint, end → root then root → end, repeated. |
| 448–480 s | A tall ellipse (the body seen from above) with a two-bone leg on its side. A ✕ sits ahead of the foot. The foot stays put while the ellipse moves, then jumps to the ✕ when it gets too far. Then a green lizard: first plain, then with four legs drawn as two thick bones and round feet, then filled. | **Legs**: a two-bone FABRIK leg from a shoulder on the body to a foot on the ground. The foot steps to a target ahead when it falls a set distance behind. |
| 480–510 s | Lizards walking in all directions; then a crowd of small coloured fish schooling. | The payoff: many creatures, all from the same few rules. |

## The technique, step by step

1. **A chain of joints.** A creature is a list of points (14 in the examples), one link length apart. The first is the head.
2. **Distance constraint.** Each frame, move the head (toward the mouse, or a target). Then, for every joint behind it, pull the joint along the line to the joint in front until it is exactly one link length away. Nothing is simulated; the body is dragged like a rope.
3. **Angle constraint.** Before placing a joint, clamp the direction of its link to within a limit of the link in front. The body can bend only so much per joint, so the tightest curl is a smooth spiral and the head can't pass through the body. This also sets how tight a turn can be.
4. **A radius per joint.** A list of widths, one per joint, gives the body its shape. Same chain, different list, different animal.
5. **Skin.** For each joint, take the two points at its heading ± 90° on its circle (`x = r cos θ`, `y = r sin θ`), plus a few around the head (front) and the tail end. Draw one smooth closed curve through them and fill it. Eyes sit on the head circle.
6. **Extras (fish).** Fins hang off particular joints; the tail fin and the fins bend with the body's curvature *(inferred from the "% curved" labels)*.
7. **Legs by FABRIK.** A leg is two bones from a shoulder joint on the body to a foot. Solve it with FABRIK each frame: put the foot on its target and pull the bones back toward the shoulder, then pin the shoulder and push them back toward the foot. Repeat a few times.
8. **Stepping.** Each foot has a wanted spot, fixed relative to the body and a little ahead of the shoulder. The foot stays planted on the ground while the body moves. When the wanted spot is more than a set distance away, the foot moves there (the ✕ in the leg diagram). Opposite legs alternate *(inferred from the lizard's diagonal pairs)*.

## Formulas and pseudo-code

```
// distance constraint: keep p exactly d from anchor
constrainDistance(p, anchor, d) = anchor + normalize(p - anchor) * d

// angle constraint: keep angle a within ±limit of anchor angle (shortest way round)
constrainAngle(a, anchor, limit) = anchor + clamp(wrap(a - anchor), -limit, limit)

// the body follows its head
joints[0] = headPos; angle[0] = headHeading
for i in 1..n-1:
    want     = direction from joints[i] to joints[i-1]
    angle[i] = constrainAngle(want, angle[i-1], maxBend[i])
    joints[i] = joints[i-1] - dir(angle[i]) * link[i]

// skin
for i: left[i]  = joints[i] + r[i] * (cos(angle[i] + π/2), sin(angle[i] + π/2))
       right[i] = joints[i] + r[i] * (cos(angle[i] - π/2), sin(angle[i] - π/2))
outline = head cap + left[0..n-1] + tail cap + right[n-1..0]  → smooth closed curve, fill

// FABRIK (bones of lengths len[], root fixed, target t)
repeat k times:
    p[last] = t;           for i = last-1 .. 0: p[i] = constrainDistance(p[i], p[i+1], len[i])
    p[0]    = root;        for i = 1 .. last:   p[i] = constrainDistance(p[i], p[i-1], len[i-1])

// stepping
wanted = shoulder + body-forward * lead
if |wanted - foot| > stepDistance: move foot to wanted (over a short swing)
```

## Parameters (seen or inferred)

| Parameter | Value in the video | Notes |
|---|---|---|
| Joints | 14 in the radius examples; more for the snake (≈ 50 circles in the 192 s frames) | Shown. |
| Radii | e.g. `[52, 58, 40, 60, 68, 71, 65, 50, 28, 15, 11, 9, 7, 7]` | Shown (screen units). |
| Link length | about the radius of the smaller neighbour, so circles overlap | *(inferred)* from the drawings; never printed. |
| Bend limit | not printed; the diagram opens a 90° angle to about 150° between links, so about π/6 to π/8 of turn per joint | *(inferred)*. |
| FABRIK passes | three to four passes before the arm settles on screen | *(inferred)* from the frames. |
| Step distance | not printed; the foot jumps when the ✕ is roughly one leg length away | *(inferred)*. |

## How it differs from version 1

| | Version 1 ("rings plus limbs") | Argonaut |
|---|---|---|
| Body | A rigid ring stack in 3D, melted into one surface, moved and turned as one piece. Bends only through a tail spring and a head look. | A chain that bends at every joint and follows its head. |
| Turning | Slow down, then pivot on planted feet (180° and 360°). | The head steers and the body flows through the same arc: no pivot, so a turn needs room. |
| Legs | Gait clock: phase offsets and duty factor per foot, analytic two-bone IK. | Distance-triggered steps, FABRIK. No gait clock. |
| Skin | Per-pixel "am I inside?" over 3D cones and spheres, then banded colour and outline. | A 2D curve through side points, filled. |
| View | 3/4 perspective, 3D. | Top-down, 2D. |

## What to copy (and what version 2 copies)

- **The chain with both constraints:** copied as is (`prototype-v2/chain.js`, `follow`, `constrainDistance`, `constrainAngle`). Bend limits per body part: neck 0.42, torso 0.2, tail 0.36 rad.
- **The radius array:** copied. Read from the genome's ring sizes, so the same seed has the same outline in both versions when it stands straight. Link length = 0.55 × the torso's mean width, giving 8–26 joints.
- **FABRIK legs:** copied, with a knee pole so knees bend the right way (`legFabrik`).
- **Distance-triggered stepping:** copied (`STEP_AT` 1 stride, wanted spot led by `LEAD` 0.5 stride × speed). A foot waits while a neighbour is in the air, unless it falls 1.5 strides behind.
- **Not copied: the 2D skin.** The task keeps Version 1's looks (Original, Cel, Pixel), so the chain is turned back into the same 3D cones and melted and shaded by Version 1's renderer. The head, face, mouth, wings and decorations ride rigidly on their joint.

## Open questions

- The exact link length, bend limits, step distance and FABRIK pass count. None is printed; the audio may say.
- How the fins use "% curved": a curvature sum over the chain, or the head-to-tail angle?
- How legs are paired in time: diagonal pairs by a rule, or just "don't step while your neighbour is stepping"?
- How the skin's curve is drawn: Catmull-Rom, quadratic midpoints, or canvas `curveTo`?

## What is hand-wavy

- **Turning in place.** The chain can only follow its head, so it can't pivot. A U-turn sweeps an arc about the size of the body. Version 2 keeps the 180° and 360° turns as tight arcs (radius 0.3 body scales) rather than pivots.
- **3D.** The video is flat, top-down. Height, bob and a 3/4 camera are not covered. Version 2 keeps each joint's standing height and adds Version 1's bob.
- **Gait timing.** Distance-triggered steps look right on a lizard, but there is no rule for six legs or for hurrying. Version 2 adds the "neighbours planted" rule.
- **Steering.** Where the head goes is left to the mouse. Version 2 reuses Version 1's wander, edge steering, goals and food.
