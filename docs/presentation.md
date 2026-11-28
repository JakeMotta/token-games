# A corner orb, pop out

How every Token Game presents itself. The shell (`shell/`) does all of this; games only draw at the scale they're
given. Chosen from the display-modes mock-up (option 3, the corner orb), which replaced the earlier notch island.

## The states

```
orb ──hover──▶ hover (pill) ──click──▶ expanded (card) ──Pop out──▶ popping ─▶ popped (floating window)
 ▲  ◀──leave──────┘                        │                                     │
 └────────── Esc / – / click away / hotkey ┘                  ↩ Corner ─▶ docking ─▶ orb
```

| State | What the user sees | Game scale |
|---|---|---|
| orb | A 64 px round orb in a corner of the screen: the game's tiny live view in its eye, a count on a small badge, and a quiet ring that turns warm when the game needs the player (`GameStatusLine.warm`) | `mini` |
| hover | Pointing at it grows a pill (250 × 64) out of the orb with the game's name, its count and its status line | `mini` |
| expanded | A click opens a card (440 × 330) out of the same corner: the game large, its status, **Pop out ↗**, **Games**, **Settings** and **–** | `expanded` |
| popped | A small frameless window (320 × 180 or 640 × 360, 16:9) docked to a corner; nothing stays in the orb's corner | `window` |

The orb, the pill and the card are one shape that grows out of the orb's corner, so the card opens down from a top
corner and up from a bottom one. Popping out and docking fade the page, then the window flies (about 0.4 s); with
Reduced motion it just switches. The choice is remembered (`presentation`: `orb` or `floating`; an old `notch`
setting reads as `orb`), and Settings → Display sets it.

## Where the orb goes

- **A corner of the work area**, 16 px in from its edges, so never under the menu bar or the Dock. The default is
  the bottom right of the main display.
- **Drag it** to move it: it follows the pointer once it has moved 4 px (a shorter press is a click), and when let
  go it settles in the corner of the quarter of the display it was dropped in, on whichever display that is. The
  corner (`corner`: `tl`, `tr`, `bl`, `br`) and the display (`display`, its id) are saved. Settings → Display →
  Corner and the tray's Corner menu choose it too.
- **Several displays:** the saved display while it is plugged in, else the main one. Plugging or unplugging a
  display, or changing resolution, puts the orb back in its corner and closes an open card.
- **Full-screen apps:** the orb hides over full-screen spaces; the popped-out window follows its own Always-on-top
  setting.
- **Clicks:** the transparent window (the card's size) lets clicks through everywhere except the orb (or the pill
  while it shows); an open card takes the clicks inside it. Click-through is a setting of the floating window only:
  the orb always answers a click.

## Never without a way back

- The menu-bar (tray) icon is always there: show or hide, open the card or **Back to the corner**, **Pop out**,
  **Games…** and **Settings…** (the Games and Settings window on that tab; Games… with the number of updates waiting), Settings, Presentation, Corner, the floating window's size, full screen, click-through, always on top and dock
  corner, Reduced motion, **Reset to defaults**, Quit.
- **Alt+Cmd+T** (Alt+Ctrl+T): shows a hidden game; in the corner, opens or closes the card; popped out, switches
  click-through (so a click-through window can always be grabbed again).
- The **Games** button sits next to Settings in the card and in the popped-out window's title bar; it opens the
  Games and Settings window on its Games tab: a normal window of its own centred on the screen, with two tabs at the
  top, Games and Settings. It leaves the orb, the card or the floating window as they are. **Settings** (its button
  next to Games, the gear in the window's title bar, `,`, Cmd+, or the tray's Settings…) opens the same window on its
  Settings tab. There is only ever one: any way in brings it forward and switches it to its tab, and no tab is
  remembered between opens. Click a tab, press Cmd+1 or Cmd+2, or ←/→ on a focused tab; Esc, Cmd+W, its Close button
  or the sheet's Close closes it. It is light or dark with the system. The game's page keeps its Settings sheet,
  hidden, and the Settings tab shows a copy of it in large type
  (`shell/src/page/mirror.ts`); clicks and slider moves there go back to the page, so a game's settings code works
  unchanged.
- Keys while focused: Esc closes, `,` Settings, `O` pop out / back to the corner, `H` hide; popped out: `1` small,
  `2` large, `F` full screen, `T` click-through, `D` next corner. Games get every other key.

The floating window keeps the old overlay's settings: opacity, always on top, click-through (hold Alt over it, or
use the hotkey, to get it back), docking to a corner when dragged near one, and a resize grip.

## Cost

There is one game view, moved between the hosts; the game never runs twice. While the orb rests, the pointer is
checked against it ten times a second and the game draws at 1–4 fps. With the card open, popped out or hidden, the
pointer is not checked.

## Not verified automatically

The smoke test checks geometry, states, dragging, the hotkey and pixels with the window hidden. A real pointer
hovering and dragging, focus, the corner on a real screen with the Dock and the menu bar, several displays and
full-screen spaces need a look on a real Mac.
