# Notch first, pop out

How every Token Game presents itself. The shell (`shell/`) does all of this; games only draw at the scale they're
given. Designed in the display-modes mock-up (`prototype/ant-farm/display-modes.html` on the `ant-farm-display-modes`
branch).

## The states

```
collapsed ──hover──▶ peek ──click──▶ expanded ──Pop out──▶ popping ─▶ popped (floating window)
    ▲  ◀──leave───────┘                  │                                │
    └───────────── Esc / click away / hotkey                ↩ Notch ─▶ docking ─▶ collapsed
```

| State | What the user sees | Game scale |
|---|---|---|
| collapsed | A black island hugging the notch: the game's tiny live view on the left ear, a count and a dot on the right | `mini` |
| peek | Pointing at it widens the island (420 px) with a strip of the game and its status line | `mini` |
| expanded | A click drops it down (640 px): the game large, its status, **Pop out ↗** and **Settings** | `expanded` |
| popped | A small frameless window (320 × 180 or 640 × 360, 16:9) docked to a corner; the island stays as a marker and a click on it docks the game back | `window` |

Popping out and docking fade the page, then the window flies (about 0.4 s); with Reduced motion it just switches.
The choice is remembered (`presentation`: `notch` or `floating`), and Settings → Display → Presentation sets it.

## Where the island goes

- **A notch:** on a built-in display whose menu bar is 31 pt or taller (or a hidden menu bar on a notch-shaped
  screen), the island spans the notch (200 pt) plus 75 pt each side, as tall as the menu bar.
- **No notch:** a 210 × 25 pill hanging from the middle of the menu bar.
- **Several displays:** the built-in one when it's connected, else the main display. Plugging or unplugging a
  display, or changing resolution, moves the island and closes an open drop-down.
- **Full-screen apps:** the island hides (it isn't shown over full-screen spaces); the popped-out window follows
  its own Always-on-top setting.
- **Clicks:** the transparent window around the island lets clicks through everywhere except the island itself.

## Controls, in every mode

- The menu-bar (tray) icon: show or hide, open the drop-down or **Back to the notch**, **Pop out**, Settings,
  Presentation, the floating window's size, full screen, click-through, always on top and dock corner, Reduced motion,
  **Reset to defaults**, Quit.
- **Alt+Cmd+T** (Alt+Ctrl+T): in the notch, opens or closes the drop-down; popped out, switches click-through.
- Keys while focused: Esc closes, `,` Settings, `O` pop out / back to the notch, `H` hide; popped out: `1` small,
  `2` large, `F` full screen, `T` click-through, `D` next corner. Games get every other key.

The floating window keeps the old overlay's settings: opacity, always on top, click-through (hold Alt over it, or
use the hotkey, to get it back), docking to a corner when dragged near one, and a resize grip.

## Cost

There is one game view, moved between the hosts; the game never runs twice. While collapsed, the pointer is
checked against the island ten times a second and the game draws at 1–4 fps. Hidden, nothing is checked.

## Not verified automatically

The smoke test checks geometry, states and pixels with the window hidden. Real notch hardware, hovering with a
real pointer, focus and full-screen spaces need a look on a real Mac.
