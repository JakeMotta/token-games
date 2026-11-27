# Game catalog: design note

Full explainer with diagrams and a clickable Settings → Games mock: `docs/game-catalog.html` (open it in a browser).

## Goal

Other people can write Token Games overlay games. Players browse them inside the app, press Install, pick the active game in Settings, and see it in the notch or a pop-out window.

## Recommendation

1. **Catalog**: a public registry repo (`token-games-registry`). One pointer file per game (`games/<id>.json`: repo, tag, pinned commit, tier), added by pull request. CI builds and signs `index.json`, served from GitHub Pages. The app reads that one file.
2. **Downloads**: each game is a zipped web bundle on a GitHub Release in the author's repo. The registry pins the commit and the zip's sha256; CI rebuilds the zip from the commit and compares.
3. **Running**: sandboxed web bundles only. One `WebContentsView` per game, own session partition, `sandbox: true`, `contextIsolation: true`, no Node, strict CSP, no network unless the player approves listed hosts. The preload bridge exposes only the usage feed (token counts, never content), the game's own settings and save data, window scale and pop-out/dock. No main-process code from games.
4. **Trust**: tiers Built-in, Verified (maintainer read the code), Community (CI only, off by default), Local (developer folder). A permission sheet before every install. Signed index with a public key in the app, a blocklist, no downgrades, CI rejects executables.
5. **Agents**: a `tokengames` CLI (`list`, `install`, `use`, `remove`, `status`) over a local socket to the app, and a thin `token-games-mcp` server on top (`list_games`, `install_game`, `remove_game`, `set_active_game`, `game_status`). The agent can ask for an install; approval happens only in the app. Momo uses the CLI.

Rejected: git clone or sparse checkout, and npm (both run or fetch code with no review gate). Topic search is a possible later opt-in "unreviewed" tier.

## Phases

| Phase | Scope | Rough effort |
| --- | --- | --- |
| 1 | Local games folder, manifest + validator, game host, Settings picker, "Add local folder" | ~4 days |
| 2 | Registry repo, signed index, installer (download, sha256, swap, rollback), updates, permission sheet | ~1.5 weeks |
| 3 | Control socket, CLI, MCP server | ~3 days |
| 4 | Template + `npm create token-game`, full CI, verified badge, blocklist, contributor docs | ~2 weeks, then review time |

## Open decisions for Jake

- Create the public registry repo (the token-games repo is private, so it cannot serve downloads) and pick maintainers.
- Confirm that third-party games get no main-process code.
- Community tier off by default?
- One active game at first, or several from the start?
- Who holds the index signing key?

## Caveats

- The manifest field names are a proposal. Task 479's shell (branch `worktree-momo-task-479`) had no manifest file when this was written; reconcile with it before building phase 1.
- The interactive mock is simulated; games, authors and numbers are examples.
