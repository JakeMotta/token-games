# The game catalog

Other people can write Token Games games, and players can install them from inside the app, on the **Games tab** of the Games and Settings window: the **Games** button next to Settings (in the
open card and the popped-out window's title bar), the menu-bar icon's **Games…**, or **Open Games…** in **Settings → Games**.
This page is how it works as built. The original proposal, with diagrams and a clickable mock, is
[game-catalog.html](game-catalog.html) and [game-catalog-design.md](game-catalog-design.md). Writing a game for the
catalog: [publishing-a-game.md](publishing-a-game.md).

**The token-games repo is public** (https://github.com/JakeMotta/token-games). The registry lives in its
[`registry/`](../registry/README.md) folder, the signed index is published on GitHub Pages, and game bundles are
attached to its GitHub Releases. Anything committed here is visible to everyone, history included
([pre-public-audit.md](pre-public-audit.md)).

## Defaults

| Default | Why |
|---|---|
| **Third-party games get no main-process code.** A catalog game is `"kind": "web"`: HTML, JS, CSS and images, run sandboxed | Main-process code could read any file or reach any server. A web bundle can be reviewed and boxed in |
| **One active game** per app. The Ant Farm app shows the Ant Farm or one catalog game in its orb, card and window | One view, one orb, cheap when collapsed (CLAUDE.md, rule 4) |
| **The Ant Farm stays built in.** Its own code, its `colony.json`, score and orb are unchanged; switching away and back keeps them | Built-in games are app games and are never installed or removed |
| **Only approved games are listed.** The Games tab shows the built-in game and approved catalog games; everything else waits for Settings → Games → **Show developer and unapproved games** (off by default). See [What the app lists](#what-the-app-lists) | The player sees the games we built and approved, not test, prototype or copied builds |
| **No network for games.** A game reaches only its own files. A web game may list up to 8 `network` hosts; they are shown on the permission sheet and allowed only once the player approves the install | Rule 6: counts only, nothing sent anywhere |
| **The app fetches the catalog only on request** ("Check for games", `tokengames list --refresh`), never at launch | No background network |
| **Agents can only ask.** The CLI and MCP server request installs and removals; the player approves or denies them in the app | An agent should not change what runs on your computer by itself |

## Tiers

| Tier | Where from | Review |
|---|---|---|
| Built-in | Ships with the app (the Ant Farm) | This repo's own review |
| Verified | The signed index; a maintainer read the code at the pinned commit | CI rebuild + a person |
| Community | The signed index; hidden unless the developer switch is on | CI rebuild only |
| Local | A folder on this computer ("Add local folder…", developer switch on), for developing a game | None; the sheet says so |

## What the app lists

`notApproved()` (`shell/src/catalog/catalog.ts`) gives each game a reason it is not approved, or none. A game with a
reason is **hidden**: left out of the Games tab, Settings → Games, the update dot and the tray's update count, and
an agent cannot ask to install it. The reasons, in order:

1. **A local folder** (`tier: local`).
2. **A copy of a built-in game**: its pointer (and index entry) has `"duplicates": "<built-in id>"`, or its id is the
   built-in id plus `-web` (`ant-farm-web` in the Ant Farm app, `tower-defense-web` in the Ink Tower Defense app). The rule lives in the app, so
   the committed, signed index needs no change and no re-signing.
3. **Blocked** by `blocklist.json`.
4. **A community game**, not reviewed.
5. **From a developer or test catalog**: the index was not signed by one of the app's own keys (`REGISTRY_KEYS`),
   e.g. a `TG_REGISTRY_URL` registry or a test registry.

The built-in game is always approved. **Settings → Games → Show developer and unapproved games** (off by default,
saved as `developer` in `state.json`) lists them all again, each with a **Not approved: …** tag, and allows Add local
folder. A game that is already installed always shows, so it can be played or removed; it gets no update while it is
not approved and the switch is off. `tokengames list` shows every game, with a NOTE column naming the reason
(`hidden in the app: …`, or `not approved: …` while the switch is on).

## How a game runs (the sandbox)

`shell/src/main/catalog-host.ts` puts the active catalog game in one `WebContentsView` over the shell's page:

- its own session (`persist:tg-game-<id>`), `sandbox: true`, `contextIsolation: true`, no Node, no Electron;
- its files served from its folder under `tg-game://<id>/`, refusing paths outside it and symlinks;
- a Content-Security-Policy on every response: scripts, styles, images and fetches only from `tg-game://<id>`, plus
  `https://` and `wss://` for approved hosts; no `eval` (`shell/src/catalog/permissions.ts`, `cspFor`);
- every other request is cancelled (`onBeforeRequest`), every permission prompt (camera, microphone, notifications,
  location) is denied, new windows are refused and navigation off its own origin is stopped;
- `backgroundThrottling: false`: the game keeps real time while its view is hidden in the orb, where it is told to
  draw little (`env().scale === 'mini'`).

The only bridge is `shell/src/main/game-preload.ts`, `window.tokenGame`:

| Call | What |
|---|---|
| `onUsage(fn)` | Usage counts: `{ type: 'tokens', source, input, output, cache_read, cache_write, ts }`, or `{ type: 'task_done' \| 'session_start' \| 'agent_waiting', source, ts }`. No session ids, model names, prompts or code |
| `load()`, `save(data)` | The game's own save, JSON, at most 1 MB |
| `getSettings()`, `setSettings(data)` | Its own settings, JSON, at most 64 KB |
| `env()`, `onEnv(fn)` | `{ scale: 'mini' \| 'expanded' \| 'window', dark, reducedMotion, feed }`; `feed` is `{ watching, files }`: whether Claude Code's transcripts are watched and how many (version 2) |
| `setStatus({ count, title, line?, warm? })` | The circle's number (8 chars), the title (24) and line (80) in its name tag, the card and the window's bar |
| `popOut()`, `dock()` | Ask the shell to take the game to its window, or back to the circle |
| `onHide(fn)` | Called before the game is closed (switched away from, removed, or the app quits); return a promise to finish a save first. The shell waits up to 1 s (`HIDE_WAIT_MS`), then closes it anyway (version 2) |
| `version` | The bridge's version: `2`. A change only ever adds, so a game written for version 1 runs unchanged |

The shell's `hosted.ts` turns usage events into these counts, checks save and settings sizes and trims statuses.

## A shell game in the catalog

A game written for the shell's page (a `Game`, `shell/src/game.ts`, like the Ant Farm) can also ship as a catalog
web game without a fork. `shell/scripts/build-web.mjs` bundles the game's own source with the **hosted adapter**
(`shell/src/page/hosted-shell.ts`, its pure parts in `shell/src/hosted-game.ts`) into a folder of plain files:
`index.html`, `app.js`, the shell's and the game's CSS, `game.json` and `icon.svg`. The adapter runs the same
`mountShell(game)` page over `window.tokenGame`: usage, status, settings (its own only, never the shell's), its save,
the window and back (the same top bar and size switch as a built-in game), a gear for the game's own Settings, and `onHide` to save before it is closed. It tells the game the
page is always visible, because shell games assume that and the view is hidden in the orb, not unloaded.

Ink Tower Defense's bundle is `tower-defense/catalog/` (id `tower-defense-web`, since a catalog game can't take a
built-in id; its own save slot and settings, so it plays beside the Ant Farm and never touches its `colony.json`), the
one in the published index. The Ant Farm's is `ant-farm/catalog/` (`ant-farm-web`), no longer published, kept as a
test bundle. `npm run build:catalog` makes a game's from its `src/web/` (and copies licence files at the game's root,
like a font's `OFL.txt`); `npm run check:catalog` fails when the committed folder no longer matches the source. The
whole path, from package to rollback: [first-game-walkthrough.md](first-game-walkthrough.md).

## Installing

`shell/src/catalog/installer.ts`, for a bundle from the index, a zip file, or a local folder:

1. Download (https only, size-capped) or read the zip; its **sha256** must equal the index's.
2. Unzip into a staging folder, refusing **zip-slip** (absolute paths, `..`, backslashes), symlinks, too many or too
   big files, and anything executable (by extension, or MZ / ELF / Mach-O / `#!` at the start).
3. Check its `game.json` (`checkManifest`): a `web` game, the id it claims, a shell new enough.
4. Refuse an equal or **older version** than the installed one (no downgrades).
5. **Atomic swap**: the installed folder is renamed aside, the staged one moved in; if anything fails the old one is
   put back (rollback). A crash mid-install is repaired on the next start.

Before any of this, the app shows a **permission sheet** (`permissions.ts`, `permissionSheet`): what the game reads,
its tier, its network hosts, its licence and where its source is. Install, update, remove and "Add local folder" all
wait for the player's Approve. Updates appear in the Games list when the index has a newer version.

## The signed index

The app reads one file, `index.json`, and its signature `index.json.sig` (ed25519, base64), from
`DEFAULT_REGISTRY` (`shell/src/catalog/keys.ts`). It refuses an index that doesn't verify against a key in
`REGISTRY_KEYS`, and applies the index's **blocklist**: a blocked game or version can't be installed, and an installed
one stops running (the player can still remove it). `index.json` is signed on the key holder's Mac and committed;
CI only checks it and publishes it on Pages.

How the registry, CI and Pages fit together: [registry/README.md](../registry/README.md).

### Who holds the signing key

**Jake holds the real signing key**, in his Mac's login Keychain (service `token-games-registry-signing-key`,
account `registry`). It is never committed, never in GitHub secrets and never printed. Its public key,
`Fswexp3LDILw4Chds9pjXqg/YziOv9duTD5iLzOy1aY=`, is pinned in `REGISTRY_KEYS` (`shell/src/catalog/keys.ts`).

```sh
cd cli && npm install && npm run build
node dist/tg-registry.js keygen --keychain          # once: makes the key in the Keychain; refuses to replace one
node dist/tg-registry.js public-key --keychain      # prints the public key
node dist/tg-registry.js sign ../registry/index.json --keychain
```

Backing it up, restoring it on a new Mac (`import-key --keychain`) and rotating it:
[first-game-walkthrough.md](first-game-walkthrough.md), "The signing key". `keygen <file>` (a key file, mode 600,
refused inside a git checkout) is still there for a developer's own registry. Tests make a fresh **test key** in
memory for every run and never write one.

## Agents: the control socket, the CLI and the MCP server

While the app runs, it listens on a local socket (`shell/src/catalog/control.ts`): a Unix socket only the user can
open (mode 600), never a network port. `control.json` in the catalog folder says where it is. One JSON object per
line: `{ id, cmd, args }` in, `{ id, ok, result | error }` out. Commands: `ping`, `list`, `status`, `refresh`,
`install`, `remove`, `use`. There is no approve command.

The catalog folder is `~/Library/Application Support/Token Games` on macOS (`%APPDATA%\Token Games` on Windows,
`~/.config/Token Games` on Linux), or `TG_CATALOG_DIR`.

### `tokengames` (cli/)

```sh
cd cli && npm install && npm run build      # then: node dist/tokengames.js …, or npm link
tokengames list [--refresh] [--json]        # ID NAME VERSION TIER STATE NOTE (why a game is hidden)
tokengames install <id> | --dir <folder>    # asks the player; prints what it asked
tokengames use <id>                         # switch the active game (installed games only)
tokengames remove <id>                      # asks the player
tokengames status [--json]                  # the active game and pending requests
```

Exit codes: 0 done, 1 failed, 2 wrong usage, 3 the app is not running.

### `token-games-mcp` (cli/)

An MCP server over stdio with five tools: `list_games`, `game_status`, `install_game`, `remove_game`,
`set_active_game`. `install_game` and `remove_game` say in their descriptions that they cannot approve; they return
"Asked the player to approve … in Token Games". Game names and descriptions come from strangers, so it returns them
as plain data.

**Claude Code:**

```sh
claude mcp add token-games -- node /path/to/token-games/cli/dist/token-games-mcp.js
```

**Cursor** (`~/.cursor/mcp.json`):

```json
{ "mcpServers": { "token-games": { "command": "node", "args": ["/path/to/token-games/cli/dist/token-games-mcp.js"] } } }
```

Then "what games can I play?" calls `list_games`, and "install Token Garden" calls `install_game`, after which the
app shows the permission sheet and the agent tells you to approve it there.

**A voice assistant** (Momo, for example) uses the CLI by shell command: `tokengames list --json` to read the
choices, `tokengames install <id>` to ask, then it tells the player to approve in the app, and `tokengames status
--json` for something to say about the active game. It never approves.

## The Games tab

The **Games** button (next to Settings in the open card and in the popped-out window's title bar), the tray's
**Games…** and **Open Games…** in Settings → Games open the **Games and Settings window** on its **Games** tab: a
normal window of its own with a title bar, resizable, light or dark with the system, and two tabs at the top, Games
and Settings (the Settings buttons, `,` and the tray's Settings… open it on Settings). It opens centred on the display the game is on, about 960 × 680 and never bigger than
that display's work area (`gamesWindowBounds` in `shell/src/geometry.ts`), at least 640 × 480. There is only ever one:
Games again brings it to the front and switches it to Games; Cmd+1 and Cmd+2, or the arrow keys on a focused tab,
switch tabs. Esc, Cmd+W (Ctrl+W), its Close button or the window's close button close it.
Opening it changes nothing about the game: not the active game, not where it is or whether it shows.

It lists (`shell/src/page/games-panel.ts`, layout `window`) the built-in game, installed games and approved available
games as cards ([What the app lists](#what-the-app-lists)), each with its icon, name, version, tier and description;
Play, Install, Update, Remove and the Playing mark; "Check for games" (with how many games it hides); and pending
requests at the top with Approve and Deny. With the developer switch on it also lists the hidden games, tagged **Not
approved: …**, and offers "Add local folder…".
Its page (`hub-page.ts`) runs isolated and sandboxed like the shell's own, and its bridge (`window.tokenHub`,
`shell/src/main/hub-window-preload.ts`) has only the catalog, tab and Settings calls; the main process answers the
catalog calls only from the shell's page and this window. Settings → Games (on the Settings tab, layout `summary`) is a line about the games,
the **Show developer and unapproved games** switch, any request waiting with Approve and Deny, and Open Games…. When an agent asks, the circle's ring pulses and the card's status line and the window's bar say so ("An agent asked: see
Games"), and opening Settings scrolls to the waiting request.

**Update available.** When the cached index lists a newer version of an installed game (and it is not blocked), its
card gets an **Update available** tag and an **Update to <version>** button, the Games buttons get a small dot, and the
tray says **Games… (1 update)**. Updating asks like an install: the permission sheet, then Approve. The index is
still only fetched when the player presses "Check for games" (or an agent asks); the badge reads the cached one.

## A separate registry repo (option)

The registry is a folder here because the repo is public and it keeps one place to review. It is laid out so it can
move to its own repo (say `token-games-registry`) without code changes: `registry/` becomes that repo's root, its
workflows move with it (`registry-check.yml`, `registry-publish.yml`), and `DEFAULT_REGISTRY` points at its Pages
URL. Reasons to split later: separate maintainers for game reviews, separate branch protection, and a smaller blast
radius (a pointer PR can never touch app code). The signing key and `REGISTRY_KEYS` stay the same.

## Tests

- Unit (`shell/test/catalog*.test.ts`, run by any game's `npm test`): the manifest checker, sha256 and zip-slip,
  rollback and no downgrades, signatures and tamper rejection, the blocklist, permissions and the sheet; what the app
  lists (`notApproved()`, copies of a built-in game, the developer switch and its persistence).
- CLI and MCP (`cd cli && npm test`): against a real catalog on a temp folder and a local test registry signed with a
  fresh test key, including the built MCP server over stdio and the `tg-registry` tool.
- End to end (`cd ant-farm && npm run test:smoke`, the `catalog` run, `shell/src/main/smoke-catalog.ts`): real
  Electron, hidden. Checks the test registry's games stay hidden (and an agent cannot ask for them) until the
  developer switch is on, then installs Token Garden from that local registry after approving the sheet, runs it sandboxed and
  checks it has no `require`, `process`, file access or network; feeds it a transcript line and checks its count;
  switches back to the Ant Farm and removes Token Garden. Screenshots: `catalog-*.png` in `shots/`.
- A game's own bundle (the `catalog-game` run, for a game with `catalog/`): the same, but driven by the real
  `tokengames` CLI (list, install, use, status, remove) against the built bundle, or a real registry with
  `TG_REGISTRY_URL`. It checks the bundle is hidden as a copy of the built-in game (and `tokengames list` says so)
  until the switch is on, then the permission sheet, the sandbox, the game drawing, the fed tokens reaching its own
  `save.json` (and the built-in game's save left alone), that it loads that save again, and that removing it keeps
  the save. What to look for inside the game (its status line, its settings, the fed tokens) comes from the game's
  `GameSmoke.catalog`. Screenshots: `catalog-game-*.png`.
- The published catalog (the `published` run, only with `--only published [--expect <id,…>]`; it needs the network):
  from a clean profile and the real public index, trusting only the keys built into the app. It checks the Games
  window lists exactly those games and nothing else even with the developer switch on, that `tokengames list` finds
  them and `tokengames install` only asks, then installs each through the permission sheet, plays it sandboxed,
  feeds it and checks its own save. Screenshots: `published-*.png`.
