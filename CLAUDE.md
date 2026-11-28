# Token Games: notes for AI agents and contributors

Idle games for people who work with AI agents. Each game lives in a small orb in a corner of the screen, opens into a
card when clicked, and pops out into a small floating window. It moves forward **only** from real Claude Code usage
(tokens spent, turns finished), read from the user's local transcripts. Every game runs inside one shared wrapper,
the **shell** (`shell/`); a game only draws itself and reacts to usage.

## Hard rules

1. **Docs must match the shell.** Any change to how the wrapper works must update `CLAUDE.md`, `README.md` and the
   docs it affects **in the same change or PR**. The wrapper is: the shell (`shell/`: window modes, the corner orb,
   pop out and dock back, the tray, the usage feed, settings, the catalog, the smoke test, the build), the manifest
   format (`game.json`, `docs/manifest.md`), the templates and generator (`templates/`, `scripts/`), the catalog CLI
   (`cli/`), the root `package.json`, install and run commands, and anything about how the app behaves on a user's
   computer. Pure gameplay changes inside one game are exempt. `npm run docs-check` fails when wrapper files changed
   but `CLAUDE.md` or `README.md` did not; CI runs it on every pull request.
2. **Usage is the only input.** Progress comes from `UsageEvent`s (`shell/src/events.ts`) and nothing else: no
   cheat, feed, test or "add tokens" buttons, keys, menu items or hidden shortcuts, not even for debugging. Tests
   feed a game by writing a real transcript line (`k.transcript()` in the smoke test).
3. **Every game uses the shell.** A corner orb first, pop out on demand ([docs/presentation.md](docs/presentation.md)). A
   game never creates its own windows, tray, settings file or feed, and never changes the shell's behaviour for itself.
   Catalog (third-party) games are `"kind": "web"`: sandboxed pages with no main-process code
   ([docs/catalog.md](docs/catalog.md)); keep the sandbox, the CSP and `window.tokenGame` that narrow.
4. **One instance, cheap when collapsed.** One app per game (the shell holds the single-instance lock), one game
   view moved between the orb, its card and the window. In the orb (`scale === 'mini'`) draw at 1–4 fps and
   skip work nobody sees; stop drawing while the page is hidden or the shell says the screen is asleep
   (`onSleep(true)`); the simulation keeps real time.
5. **Calm.** Quiet colours, no flashing, respect Reduced motion (`settings.reducedMotion`: no flights, no floating
   labels, fewer frames). Fade or dim when idle where it fits.
6. **Counts only.** The feed reads token counts and timestamps from `~/.claude/projects/**/*.jsonl`; a game never
   sees prompts, code or file contents, and never sends anything over the network.
7. **Never commit keys or personal data.** API keys (PixelLab and the like) stay in your environment. The repo is
   **public**. The catalog's private signing key is held by Jake, in his Mac's Keychain, never in the repo or in
   GitHub secrets; the index is signed on his Mac (`tg-registry sign --keychain`). Tests make a throwaway key in
   memory. Agents may only *request* installs and removals; approval happens in the app's UI and nowhere else.

## Layout

| Path | What |
|---|---|
| `shell/` | The wrapper every game runs in ([shell/README.md](shell/README.md)). Version in `shell/package.json` and `SHELL_VERSION` (`shell/src/manifest.ts`); keep them equal |
| `shell/src/main/shell.ts` | Electron main: windows, orb placement and dragging, modes, the menu (tray and right-click), hotkey (show or hide), settings file, save file, feed |
| `shell/src/page/shell-page.ts` | The page side: `mountShell(game)`, the circle (no buttons; a name tag on hover), the card, the window, and the one top bar the card and the window share: Games and Settings (open the Games and Settings window on that tab) and the size switch Circle · Card · Window at the far right; keys 1/2/3, Esc one size down, G, `,`, H, F; a right-click asks for the menu. The Settings sheet itself stays in the page, hidden, and the Settings tab shows a copy of it |
| `shell/src/game.ts` | The game interface: `Game`, `GameContext`, `GameStatusLine`, `Theme` |
| `shell/src/orb.ts`, `modes.ts` | Orb corners, display choice and shapes; the mode state machine, the size each state lights (`sizeOf`) and what each size button sends (`goTo`) (pure, unit-tested) |
| `shell/src/tray.ts` | The one menu, as data: the menu-bar icon and a right-click on the game show the same items (pure, unit-tested) |
| `shell/src/settings.ts` | Shared settings and `settingsKit` for a game's own settings schema |
| `shell/src/manifest.ts` | `game.json` checker ([docs/manifest.md](docs/manifest.md)) |
| `shell/src/catalog/` | The catalog: index, signatures and keys, zip and bundle checks, installer, permissions, control socket; `notApproved()` decides which games the app hides ([docs/catalog.md](docs/catalog.md)) |
| `shell/src/main/catalog-host.ts`, `game-preload.ts`, `shell/src/hosted.ts` | Runs a catalog game sandboxed in a `WebContentsView`; `window.tokenGame` (version 2), its only bridge |
| `shell/src/page/hosted-shell.ts`, `shell/src/hosted-game.ts`, `shell/scripts/build-web.mjs` | The hosted adapter and its build: a shell game shipped as a sandboxed catalog game, no fork ([docs/catalog.md](docs/catalog.md)) |
| `shell/src/page/games-panel.ts` | The game picker in two layouts: `window` (the Games tab: game cards, the Update available badge, permission sheets, the Not approved tag, Add local folder with the developer switch on) and `summary` (Settings → Games: a line, the "Show developer and unapproved games" switch, waiting requests with Approve, Open Games…) |
| `shell/src/hub.ts`, `shell/src/page/hub-page.ts`, `hub.html`, `hub.css`, `mirror.ts`, `shell/src/main/hub-window-preload.ts` | The Games and Settings window: one normal window of its own (`showHub()` in `shell.ts`, sized by `gamesWindowBounds` in `geometry.ts`) with two tabs, Games and Settings. Every way in opens it on its tab (`ENTRY_TAB` in `hub.ts`): the Games buttons, the tray's Games… and Open Games… on Games; the Settings buttons, `,` and the tray's Settings… on Settings. One only: opening it again focuses it and switches the tab; no tab is remembered between opens. Cmd+1/Cmd+2, ←/→ on a focused tab, Esc and Cmd+W (`hubKey()`); light or dark with the system. The Settings tab shows a copy of the page's hidden Settings sheet (`mirror.ts`) and sends clicks and values back, so a game's settings code never changes; its bridge `window.tokenHub` |
| `shell/scripts/build-game.mjs`, `smoke.mjs` | Build any game; run its hidden end-to-end smoke test |
| `ant-farm/` | The first game ([ant-farm/README.md](ant-farm/README.md)); `ant-farm/catalog/` is its built catalog bundle, `ant-farm-web`: no longer published, kept as a test bundle for the smoke test and the CLI tests |
| `tower-defense/` | The second game, Ink Tower Defense ([tower-defense/README.md](tower-defense/README.md)): `src/sim/` is the pure simulation (map, towers, enemies, placement, big numbers), `src/game/` the ink renderer and the page; `tower-defense/catalog/` is its built catalog bundle, `tower-defense-web`, the published catalog game ([docs/first-game-walkthrough.md](docs/first-game-walkthrough.md)) |
| `samples/token-garden/` | The sample catalog (web) game |
| `templates/game/`, `templates/web-game/` | The starter games; `npm run new-game -- <id>` copies the first to `<id>/`, `--web` the second to `samples/<id>/` |
| `cli/` | `tokengames` (CLI), `token-games-mcp` (MCP server), `tg-registry` (pack, check, build and sign the index; `src/keychain.ts` keeps the key in the macOS Keychain) |
| `registry/` | Catalog pointers (`games/<id>.json`), `blocklist.json`, and the committed `index.json` + `index.json.sig` (signed on Jake's Mac); CI checks them and publishes them on Pages ([registry/README.md](registry/README.md)) |
| `scripts/` | Repo scripts: `new-game.mjs`, `check-docs.mjs` (+ their tests) |
| `docs/` | `presentation.md` (the circle, the card, the window; the top bar, the size switch and the menu), `manifest.md`, `catalog.md`, `publishing-a-game.md`, `first-game-walkthrough.md` (package, sign, release, install, rollback; the signing key; go-live), `pre-public-audit.md`, `ant-farm-design.md` |
| `prototype/` | Browser prototypes and mock-ups; not shipped |

Each game is a folder at the root beside `shell/`, with `game.json`, its own `package.json` (Electron, esbuild,
TypeScript) and `node_modules`. It imports the shell from source as `@token-games/shell/...` (a tsconfig path and an
esbuild alias to `../shell/src`). There is no root install.

## Commands

From a game folder (`cd ant-farm`):

| Command | What |
|---|---|
| `npm install` | Once |
| `npm start` | Build and run it (in a corner of the screen) |
| `npm run typecheck` | `tsc --noEmit`, the game and the shell |
| `npm test` | Build, then the game's and the shell's unit tests (`node --test`) |
| `npm run test:smoke` | Hidden end-to-end test: real Electron, windows never shown, a temp profile and a fake transcript folder. Four runs: `full`, `reopen`, `catalog` (installs Token Garden from a local signed test registry, proves its sandbox, switches and removes it) and, for a game with a `catalog/` bundle, `catalog-game` (the same for that bundle, driven by the real `tokengames` CLI, checking its own save; a game's `GameSmoke.catalog` says what to look for in it). `node ../shell/scripts/smoke.mjs --only <run>` runs one. `--only published [--expect <id,…>]` (never by default; needs the network) checks the real public catalog from a clean profile: it lists only those games, even with the developer switch on, and each one installs, plays, feeds and saves in its own slot |
| `npm run shots` | The same, saving screenshots of every mode to `shots/` |
| `npm run perf [-- --profile <folder>]` | Hidden frame-cost benchmark in every mode (fps, ms, CPU) into `perf.json`; `--profile` measures a copy of a real profile's settings and save |
| `npm run build:catalog`, `npm run check:catalog` | The Ant Farm and Ink Tower Defense: build the game's catalog bundle into `catalog/` (with licence files at the game's root, like `OFL.txt`), or check the committed one matches the source |
| `npm run busy-farm -- <folder>`, `npm run facing-trace -- <folder>` | The Ant Farm only: a profile with a busy colony (for `perf --profile`); a frame-by-frame trace of how ants move and face |
| `npm run autoplay -- [--balance \| <folder> [--waves N]]` | Ink Tower Defense only: a headless bot plays it; `--balance` prints how far it gets, `<folder>` writes a late-game profile (for `perf --profile`) |

From the root: `npm run new-game -- <id> ["Name"] [--web] [--into <folder>]`, `npm run docs-check`, `npm run test:scripts`.

From `cli/`: `npm install`, `npm run typecheck`, `npm test` (the CLI, the MCP server and `tg-registry` against a real
catalog and a test registry), `npm run build` (`dist/tokengames.js`, `dist/token-games-mcp.js`, `dist/tg-registry.js`).

## Proof loop

1. Write the expected results first, edge cases included.
2. Unit-test pure logic (`test/*.test.ts`); add checks to the game's `src/main/smoke.ts` for what the player sees.
3. `npm run typecheck`, `npm test`, `npm run test:smoke` (one at a time). Look at `npm run shots`.
4. The smoke test and screenshots never show a window (`TG_SMOKE`); don't add code paths that call `show()` there.
5. If you changed the wrapper: update the docs (rule 1) and run `npm run docs-check`.

## Conventions

- Branches `feature/<short-name>` or `fix/<short-name>`; pull requests use `.github/pull_request_template.md`.
- Commit messages: one plain line saying what changed for the player or contributor.
- Code: TypeScript, strict; small pure modules with tests; comments say why, in plain words.
- Env vars the shell reads: `TG_SMOKE`, `TG_SMOKE_MODE`, `TG_USER_DATA` (a temp profile), `TG_CLAUDE_DIR` (transcripts),
  `TG_CATALOG_DIR` (the catalog folder; the CLI reads it too), `TG_REGISTRY_URL` and `TG_REGISTRY_KEY` (a developer's
  own registry and its public key; the `catalog-game` smoke run installs from it when set). `TG_REGISTRY_SIGNING_KEY`
  signs a developer's own index with `tg-registry sign`; the real catalog key is only in Jake's Keychain.
- A game's settings live in the app's data folder (`~/Library/Application Support/<id>/settings.json`), its save in
  `save.json` (or the `saveFile` it names; the Ant Farm uses `colony.json`). The catalog (installed games, their saves,
  the active game, `control.json`) lives in `~/Library/Application Support/Token Games/`.
