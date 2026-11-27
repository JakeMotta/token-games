# The game catalog

Other people can write Token Games games, and players can install them from inside the app: **Settings → Games**.
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
| **The Community tier is off.** Settings → Games has a switch; until the player turns it on, community games are not listed and cannot be installed | They passed CI only; no person read them |
| **No network for games.** A game reaches only its own files. A web game may list up to 8 `network` hosts; they are shown on the permission sheet and allowed only once the player approves the install | Rule 6: counts only, nothing sent anywhere |
| **The app fetches the catalog only on request** ("Check for games", `tokengames list --refresh`), never at launch | No background network |
| **Agents can only ask.** The CLI and MCP server request installs and removals; the player approves or denies them in the app | An agent should not change what runs on your computer by itself |

## Tiers

| Tier | Where from | Review |
|---|---|---|
| Built-in | Ships with the app (the Ant Farm) | This repo's own review |
| Verified | The signed index; a maintainer read the code at the pinned commit | CI rebuild + a person |
| Community | The signed index; off by default | CI rebuild only |
| Local | A folder on this computer ("Add local folder…"), for developing a game | None; the sheet says so |

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
| `setStatus({ count, title, line?, warm? })` | The orb's number (8 chars), the pill's title (24) and line (80) |
| `popOut()`, `dock()` | Ask the shell to pop the game out into its window, or dock it back |
| `onHide(fn)` | Called before the game is closed (switched away from, removed, or the app quits); return a promise to finish a save first. The shell waits up to 1 s (`HIDE_WAIT_MS`), then closes it anyway (version 2) |
| `version` | The bridge's version: `2`. A change only ever adds, so a game written for version 1 runs unchanged |

The shell's `hosted.ts` turns usage events into these counts, checks save and settings sizes and trims statuses.

## A shell game in the catalog

A game written for the shell's page (a `Game`, `shell/src/game.ts`, like the Ant Farm) can also ship as a catalog
web game without a fork. `shell/scripts/build-web.mjs` bundles the game's own source with the **hosted adapter**
(`shell/src/page/hosted-shell.ts`, its pure parts in `shell/src/hosted-game.ts`) into a folder of plain files:
`index.html`, `app.js`, the shell's and the game's CSS, `game.json` and `icon.svg`. The adapter runs the same
`mountShell(game)` page over `window.tokenGame`: usage, status, settings (its own only, never the shell's), its save,
pop out and dock, a gear for the game's own Settings, and `onHide` to save before it is closed. It tells the game the
page is always visible, because shell games assume that and the view is hidden in the orb, not unloaded.

The Ant Farm's bundle is `ant-farm/catalog/` (id `ant-farm-web`, since a catalog game can't take a built-in id; its
own save slot, so it never touches the built-in farm's `colony.json`). `npm run build:catalog` makes it from
`ant-farm/src/web/` and `npm run check:catalog` fails when the committed folder no longer matches the source. The
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
tokengames list [--refresh] [--json]        # ID NAME VERSION TIER STATE
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

## Settings → Games

The Games section of the shell's Settings (`shell/src/page/games-panel.ts`) lists the built-in game, installed,
local and available games with their tier and state; Play, Install, Update, Remove; "Check for games"; "Add local
folder…"; the Community switch; and pending requests with Approve and Deny. When an agent asks, the orb's pill says
so ("An agent asked: see Settings → Games"), and opening Settings scrolls to the waiting request.

## A separate registry repo (option)

The registry is a folder here because the repo is public and it keeps one place to review. It is laid out so it can
move to its own repo (say `token-games-registry`) without code changes: `registry/` becomes that repo's root, its
workflows move with it (`registry-check.yml`, `registry-publish.yml`), and `DEFAULT_REGISTRY` points at its Pages
URL. Reasons to split later: separate maintainers for game reviews, separate branch protection, and a smaller blast
radius (a pointer PR can never touch app code). The signing key and `REGISTRY_KEYS` stay the same.

## Tests

- Unit (`shell/test/catalog*.test.ts`, run by any game's `npm test`): the manifest checker, sha256 and zip-slip,
  rollback and no downgrades, signatures and tamper rejection, the blocklist, permissions and the sheet.
- CLI and MCP (`cd cli && npm test`): against a real catalog on a temp folder and a local test registry signed with a
  fresh test key, including the built MCP server over stdio and the `tg-registry` tool.
- End to end (`cd ant-farm && npm run test:smoke`, the `catalog` run, `shell/src/main/smoke-catalog.ts`): real
  Electron, hidden. Installs Token Garden from a local registry after approving the sheet, runs it sandboxed and
  checks it has no `require`, `process`, file access or network; feeds it a transcript line and checks its count;
  switches back to the Ant Farm and removes Token Garden. Screenshots: `catalog-*.png` in `shots/`.
- The packaged Ant Farm (the `catalog-game` run): the same, but driven by the real `tokengames` CLI (list, install,
  use, status, remove) against the built `ant-farm/catalog` bundle, or a real registry with `TG_REGISTRY_URL`. It
  checks the permission sheet, the sandbox, the farm drawing, the fed tokens reaching its own `save.json` (and the
  built-in `colony.json` left alone), that it loads that save again, and that removing it keeps the save.
  Screenshots: `catalog-game-*.png`.
