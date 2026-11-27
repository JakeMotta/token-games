# Tower defense: eight ways to see it

One page, eight tabs. Every tab runs the same idle tower defense (same rules engine, `td.js`):
enemies walk a road, three tower types with four upgrade levels each, a build/upgrade/sell menu,
and the token bucket that fills from agent tokens and lets a wave out. Only the look changes:
camera, grid, road shape, how everything is drawn, the menu and the HUD.

Open `index.html` in a browser. No build step, no server. `?v=<id>` opens one view, `?v=all`
shows all eight side by side.

| Tab | id | Camera and grid | Art | Menu |
|---|---|---|---|---|
| Pixel Meadow | `pixel` | Top-down, square grid, switchback road | PixelLab pixel art | RPG window |
| Mesa Outpost | `iso` | Isometric diamond tiles with height, desert at dusk | PixelLab pixel art | Stacked slanted cards |
| Honey Hive | `hex` | Top-down hex grid, road zigzags along hex lines | PixelLab pixel art | Hex petals |
| Deep Mine | `lanes` | Side view, three tunnels joined by ladders | PixelLab pixel art | Seed-card tray |
| Ink & Paper | `ink` | Free-form curvy road, no grid | Hand-drawn lines that boil | Taped paper card |
| Neon Horizon | `neon` | 3D perspective toward a horizon portal | Vector, glowing wireframes | Radial ring |
| Blueprint | `blueprint` | Plan view with dimension lines | Vector, technical symbols | Parts list + spec sheet |
| Toy Island | `toy` | Tilted floating island, spiral road | PixelLab chunky cartoon | Speech bubble |

## Files

- `td.js`: the rules engine, no drawing (the same file as `prototype/tower-defense-variants/td.js`).
- `app.js`: tabs, the loop, taps, the menu model and the in-page checks.
- `views/common.js`: shared drawing helpers. `views/<id>.js`: one file per look.
- `assets/<id>/*.png`: the PixelLab sprites. `art.js`: the same sprites packed as data URIs so the
  page works from `file://`. Rebuild it with `python3 tools/pixellab_views.py --pack`.

## Art

Sprites for the five pixel views were made with [PixelLab](https://pixellab.ai) (the pixflux
image endpoint, free generations only) by `tools/pixellab_views.py`, which reads
`PIXELLAB_API_KEY`, skips pictures that already exist and stops if paid credits would be used.
Pixel Meadow reuses the forest-glade set made for the earlier tower defense variants and only adds
its bucket and ground textures. PixelLab's flat ground textures came back sand-coloured, so Pixel
Meadow keeps their grain and sets the grass and dirt colour in code. Ink & Paper, Neon Horizon and
Blueprint are drawn in code on purpose.

`tools/sheet.html` shows every packed sprite on one page.

## Tests

```sh
node --test test/          # maps: spots off the road and in reach, same rules run on every map
node test/e2e.js           # headless Chrome: ?test=1 renders, animates, taps, build/upgrade/sell
node tools/shots.js <dir>  # headless screenshots of every view at 1440 x 900
```

`?test=1` checks each view draws a full scene that moves, has enemies and upgraded towers, that
every spot and the bucket can be tapped, that the menu builds, upgrades and sells, and that no two
views look alike (mean colour distance between thumbnails).
