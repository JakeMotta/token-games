# Token Games

Idle games that play themselves from the work your AI agent does. Every token Claude Code spends and every turn it
finishes moves the game forward, and nothing else does: no buttons to grind, no cheats. Codex and other agents come
later.

Every game lives in a **corner orb**: a small round window in a corner of the screen with a live view of the game
and a count. Point at it and a pill grows out with its name and status; click and it opens into a card; **Pop out ↗**
turns it into a small floating window, and **↩ Corner** sends it back. Drag the orb to any corner of any display and
it stays there. See [docs/presentation.md](docs/presentation.md).

## Games

| Game | What |
|---|---|
| [Ant Farm](ant-farm/) | A colony that digs, eats and lives on the real clock, fed only by your tokens. Design: [docs/ant-farm-design.md](docs/ant-farm-design.md) |

Planned: a tower defense where tokens queue the waves; a site where people find, share and install agent idle games.

## Run a game

Needs Node 20 or newer, on macOS (Windows and Linux run it the same way; less tested).

```sh
cd ant-farm
npm install
npm start
```

It starts as an orb in the bottom-right corner. Click it to open the card, **Pop out ↗** for the window, drag it
to move it to another corner. The menu-bar icon has everything (show, open, pop out, back to the corner, the corner,
Settings, size, docking, click-through, Reduced motion, Reset to defaults, quit), and **Alt+Cmd+T** (Alt+Ctrl+T)
works anywhere: it shows a hidden game, in the corner it opens and closes the card, popped out it switches
click-through. Settings are saved as you change them; Settings → Display → Presentation
chooses where it starts.

## Make a game

```sh
npm run new-game -- tower-defense "Tower Defense"
cd tower-defense && npm install && npm start
```

That copies [templates/game](templates/game) (a jar that fills with sand) with the shell already around it. Replace
the jar with your game. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; it has the rules and a 10-minute walkthrough.

## The repo

- `shell/`: the wrapper every game runs in: the corner orb and window modes, tray, hotkey, settings, the Claude Code feed,
  the build and the hidden smoke test ([shell/README.md](shell/README.md)).
- `<game>/`: one folder per game, each with a `game.json` manifest ([docs/manifest.md](docs/manifest.md)).
- `templates/game/`, `scripts/`: the starter game, `npm run new-game`, `npm run docs-check`.
- `docs/`, `prototype/`: design docs, mock-ups.

AI agents working here: start with [CLAUDE.md](CLAUDE.md). Changes to the shell, the template, the manifest or the
run commands must update `CLAUDE.md` and this README in the same change (`npm run docs-check`).

## Privacy

Games read only token counts and timestamps from Claude Code's local transcripts (`~/.claude/projects`). Nothing
leaves your computer.
