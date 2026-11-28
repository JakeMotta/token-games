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
| [Ink Tower Defense](tower-defense/) | A hand-drawn tower defense on notebook paper: tokens send the waves, finished turns pay gold, twelve towers level up without end. Its own app for now (`cd tower-defense && npm start`), not yet in the catalog |

In the lab (browser prototypes, not shipped yet): Creatures (Hatchery), a pet that hatches from an egg and grows from
Claude usage, made with the generative-creature technique. Prototypes, design and the v1/v2/v3 compare page:
[creatures](creatures/).

## More games: the catalog

Anyone can write a game for Token Games, and players install them inside the app, on the **Games tab** of the Games and
Settings window: one normal, resizable window of its own (about 960 × 680, centred on the screen the game is on,
never bigger than it) with two tabs at the top, **Games** and **Settings**. The **Games** button (next to Settings in
the open card and in the popped-out window's title bar), the menu-bar icon's **Games…** and **Open Games…** in
Settings → Games open it on Games. Opening it leaves the game as it is; Esc, Cmd+W or Close closes it, and Games
again brings the same window forward on its Games tab. When the catalog has a newer version of an
installed game, the Games button gets a small dot, the game's card says **Update available** with an **Update to …**
button (approved like an install), and the menu says **Games… (1 update)**. A catalog
game is a small web page the app runs sandboxed (no Node, no files, no network unless you approve its hosts); it sees
usage counts and its own save, nothing else. Check for games, read the permission sheet, approve, press Play. One game
is active at a time; the Ant Farm stays built in. The Games tab lists only the built-in game and **approved**
games: from the catalog signed with the catalog's own key, not blocked, not a community game nobody reviewed, and not
a sandboxed copy of a built-in game (a pointer's `duplicates` field, or an id like `ant-farm-web`). Everything else
(test and developer catalogs, local folders, community games, copies) stays hidden until you turn on **Settings →
Games → Show developer and unapproved games** (off by default); a game you already installed always shows, so you can
remove it. `tokengames list` shows every game, with a NOTE for the hidden ones. The published catalog holds
**Ink Tower Defense** (`tower-defense-web`), the tower defense game packed as a catalog game with its own save, so it
plays beside the built-in Ant Farm. (Ant Farm (web), the Ant Farm's own catalog copy, is no longer published.) Sample: [Token Garden](samples/token-garden/). How it works:
[docs/catalog.md](docs/catalog.md). Write one: [docs/publishing-a-game.md](docs/publishing-a-game.md). Every step of
publishing a shell game (Ink Tower Defense), from package to rollback: [docs/first-game-walkthrough.md](docs/first-game-walkthrough.md).

Agents can ask too, never approve: the `tokengames` CLI (`list`, `install`, `use`, `remove`, `status`) and the
`token-games-mcp` server for Claude Code or Cursor, both in [cli/](cli/):

```sh
cd cli && npm install && npm run build
node dist/tokengames.js list --refresh
claude mcp add token-games -- node "$PWD/dist/token-games-mcp.js"
```

## Run a game

Needs Node 20 or newer, on macOS (Windows and Linux run it the same way; less tested).

```sh
cd ant-farm
npm install
npm start
```

It starts as an orb in the bottom-right corner. Click it to open the card, **Pop out ↗** for the window, drag it
to move it to another corner. The menu-bar icon has everything (show, open, pop out, back to the corner, the corner,
Games… and Settings… (the one Games and Settings window), Settings, size, docking, click-through, Reduced motion, Reset to defaults, quit), and **Alt+Cmd+T** (Alt+Ctrl+T)
works anywhere: it shows a hidden game, in the corner it opens and closes the card, popped out it switches
click-through. Settings are saved as you change them; Settings → Display → Presentation
chooses where it starts. Settings (its button next to Games, the gear in the window's title bar, `,`, or the menu's
Settings…) opens the same window on its Settings tab. There is only ever one: any of these brings it forward and
switches it to the tab asked for, and it remembers no tab between opens. Click a tab, press Cmd+1 or Cmd+2, or the
arrow keys on a focused tab to switch; Esc, Cmd+W or Close closes it. It follows the system's light or dark mode. Games pause their drawing while the screen is locked or the computer sleeps.

## Make a game

```sh
npm run new-game -- creature-pet "Creature Pet"
cd creature-pet && npm install && npm start
```

That copies [templates/game](templates/game) (a jar that fills with sand) with the shell already around it. Replace
the jar with your game. For a catalog game anyone can install, add `--web`: it copies
[templates/web-game](templates/web-game), plain HTML and JS with no build step. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; it has the rules and a 10-minute walkthrough.

## The repo

- `shell/`: the wrapper every game runs in: the corner orb and window modes, tray, hotkey, settings, the Claude Code feed,
  the build and the hidden smoke test ([shell/README.md](shell/README.md)).
- `<game>/`: one folder per game, each with a `game.json` manifest ([docs/manifest.md](docs/manifest.md)).
- `samples/`: catalog (web) games, like Token Garden.
- `<game>/catalog/`: a shell game bundled as a catalog game (`npm run build:catalog`), like `ant-farm/catalog/`.
- `registry/`: the catalog's game pointers, blocklist and signed `index.json` (signed on the key holder's Mac, never in
  CI); CI checks it and serves it on GitHub Pages ([registry/README.md](registry/README.md)). Bundles are attached to
  this repo's GitHub Releases.
- `cli/`: `tokengames`, `token-games-mcp` and `tg-registry` (pack, check, build and sign the index).
- `templates/game/`, `templates/web-game/`, `scripts/`: the starter games, `npm run new-game`, `npm run docs-check`.
- `docs/`, `prototype/`: design docs, mock-ups.

AI agents working here: start with [CLAUDE.md](CLAUDE.md). Changes to the shell, the template, the manifest or the
run commands must update `CLAUDE.md` and this README in the same change (`npm run docs-check`).

## Privacy

Games read only token counts and timestamps from Claude Code's local transcripts (`~/.claude/projects`). Nothing
leaves your computer. The app goes online only when you press "Check for games" or install one; a catalog game can
reach only the hosts its sheet lists, after you approve them.

## Licence, security, public repo

This repo is public. Code is [MIT](LICENSE). Report security problems privately: [SECURITY.md](SECURITY.md). What
the history held when it went public: [docs/pre-public-audit.md](docs/pre-public-audit.md).
