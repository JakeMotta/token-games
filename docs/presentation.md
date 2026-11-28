# A corner circle, a card, a window

How every Token Game presents itself. The shell (`shell/`) does all of this; games only draw at the scale they're
given. Chosen from the display-modes mock-up (option 3, the corner orb), which replaced the earlier notch island;
the controls follow the controls mock-up (one top bar, a three-way size switch, one menu).

## Three sizes

The player sees three sizes, and the same three buttons everywhere choose between them: **Circle**, **Card** and
**Window**.

| Size | What the user sees | Game scale |
|---|---|---|
| Circle | A 64 px round orb in a corner of the screen: the game's tiny live view in its eye, a count on a small badge, and a quiet ring that turns warm when the game needs the player (`GameStatusLine.warm`). No buttons. Pointing at it shows a small name tag beside it (the name, the count, "Click to open · drag to move") | `mini` |
| Card | A click opens a card (440 × 330) out of the same corner: the top bar, the game large, its status line at the bottom | `expanded` |
| Window | A small frameless window (320 × 180 or 640 × 360, 16:9, or full screen) docked to a corner; nothing stays in the circle's corner | `window` |

## One top bar

The card and the window share one top bar: the game's name on the left, then **Games** and **Settings**, a thin
separator, and at the far right the size switch, **Circle · Card · Window**, in the same place in both. The button
for the size it is at is lit (`aria-current`); each has a tooltip ("Minimize to circle (1)", "Show as card (2)",
"Expand to window (3)") and an accessible name. In a narrow window the bar shows icons only. In the window the bar
is 40 px (`topInset`, full screen included) and fades back while the pointer is away, more so when the game is calm.

There are no other buttons: no Corner, no "–", no full screen button. Everything else is in **the menu**.

## The states

```
orb ◀─enter/leave─▶ hover ──click / Card──▶ expanded (card) ──Window──▶ popping ─▶ popped (window)
 ▲                                            │    ▲                                  │   │
 └──── Esc / Circle / click away / hotkey ────┘    └─ settled ◀─ returning ◀─ Esc / Card ┘   │
 ▲                                                                                          │
 └──────────────────────────────── settled ◀─ docking ◀─ Circle ───────────────────────────┘
```

`modes.ts` holds the states (`orb`, `hover`, `expanded`, `popping`, `popped`, `docking`, `returning`), the size each
one lights (`sizeOf`) and the event each button of the switch sends from each state (`goTo`). Esc always goes one
size down: Window → Card → Circle (in full screen it first leaves full screen). The circle and the card are one
shape that grows out of the circle's corner, so the card opens down from a top corner and up from a bottom one.
Flying out, home or back to the card fades the page, then the window flies (about 0.4 s); with Reduced motion it
just switches. Where it was (`presentation`: `orb` or `floating`; an old `notch` setting reads as `orb`) is
remembered for the next start.

## Where the circle goes

- **A corner of the work area**, 16 px in from its edges, so never under the menu bar or the Dock. The default is
  the bottom right of the main display.
- **Drag it** to move it: it follows the pointer once it has moved 4 px (a shorter press is a click, which opens
  the card), and when let go it settles in the corner of the quarter of the display it was dropped in, on whichever
  display that is. The corner (`corner`: `tl`, `tr`, `bl`, `br`) and the display (`display`, its id) are saved.
  Settings → Display → Circle corner and the menu's Circle corner choose it too.
- **Several displays:** the saved display while it is plugged in, else the main one. Plugging or unplugging a
  display, or changing resolution, puts the circle back in its corner and closes an open card.
- **Full-screen apps:** the circle hides over full-screen spaces; the window follows its own Always-on-top setting.
- **Clicks:** the transparent window (the card's size) lets clicks through everywhere except the circle; an open
  card takes the clicks inside it. Click-through is a setting of the window only: the circle always answers a click.

## The menu

One menu, the same data (`trayMenu()` in `shell/src/tray.ts`) from the menu-bar icon and from a right-click on the
circle, the card or the window (a game that uses the right-click itself calls `preventDefault()` and keeps it):

- the game's name and status (a heading);
- **Circle**, **Card**, **Window** (1, 2, 3), the current one ticked;
- **Games…** (with the number of updates waiting) and **Settings…**: the Games and Settings window on that tab;
- **Window**: Small, Large, Full screen (in the window only), Always on top, Click-through;
- **Circle corner**: the four corners;
- **Hide** or **Show** the game (with the hotkey beside it);
- **Quit**.

Dock corner, opacity, Reduced motion and Reset to defaults are in Settings.

## Never without a way back

- The menu-bar icon is always there, with the menu above.
- **Alt+Cmd+T** (Alt+Ctrl+T) shows or hides the game, whatever its size. Click-through is in the menu; holding Alt
  (Option) over a click-through window still grabs it.
- **Games** and **Settings** in the top bar open the Games and Settings window: a normal window of its own centred
  on the screen, with two tabs at the top, Games and Settings. It leaves the circle, the card or the window as they
  are. `G`, `,`, Cmd+, and the menu's Games… and Settings… open it too. There is only ever one: any way in brings it
  forward and switches it to its tab, and no tab is remembered between opens. Click a tab, press Cmd+1 or Cmd+2, or
  ←/→ on a focused tab; Esc, Cmd+W, its Close button or the sheet's Close closes it. It is light or dark with the
  system. The game's page keeps its Settings sheet, hidden, and the Settings tab shows a copy of it in large type
  (`shell/src/page/mirror.ts`); clicks and slider moves there go back to the page, so a game's settings code works
  unchanged.
- Keys while focused: `1` circle, `2` card, `3` window, Esc one size down, `G` Games, `,` Settings, `H` hide; in the
  window `F` full screen. Games get every other key.

The window keeps the old overlay's settings: opacity, always on top, click-through (hold Alt over it, or use the
menu, to get it back), docking to a corner when dragged near one, and a resize grip.

## Cost

There is one game view, moved between the hosts; the game never runs twice. While the circle rests, the pointer is
checked against it ten times a second and the game draws at 1–4 fps. With the card open, in the window or hidden,
the pointer is not checked.

## Not verified automatically

The smoke test checks geometry, states, the size switch, the keys, the menu's items, dragging, the hotkey and
pixels with the window hidden; the native menu itself is never shown there (a right-click only counts). A real
pointer hovering and dragging, focus, the native menu, the corner on a real screen with the Dock and the menu bar,
several displays and full-screen spaces need a look on a real Mac.
