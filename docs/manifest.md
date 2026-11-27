# game.json

Every game folder has a `game.json`. It is small on purpose, so the catalog ([catalog.md](catalog.md)) can list and
install games without running them. The build (`shell/scripts/build-game.mjs`) checks it with `checkManifest` (`shell/src/manifest.ts`) and
stops on any problem. Change this page, the checker and its test together.

```json
{
  "manifestVersion": 1,
  "id": "ant-farm",
  "name": "Ant Farm",
  "description": "An ant colony that digs, eats and lives on the real clock, fed only by the tokens your AI agent spends.",
  "author": "Jacob Motta",
  "version": "0.2.0",
  "entry": { "main": "dist/main.js", "page": "dist/index.html" },
  "icon": "icon.svg",
  "minShellVersion": "1.0.0",
  "permissions": ["claude-usage"]
}
```

| Field | Rule |
|---|---|
| `manifestVersion` | `1` |
| `id` | lowercase letters, digits and single dashes, starting with a letter; equals the folder name; at most 40 characters |
| `name` | shown in the orb's pill, the window and the menu bar; at most 40 characters |
| `description` | one sentence, at most 200 characters |
| `author` | a name, at most 80 characters |
| `version` | the game's version, `x.y.z` |
| `kind` | optional: `app` (the default) or `web`. An app game is its own Electron app on the shell, like the Ant Farm. A `web` game is a sandboxed page with no main-process code; only web games can be in the catalog |
| `entry.main`, `entry.page` | app: the built main-process file and page, relative to the game folder. web: only `entry.page`, an `.html` file; `entry.main` is refused |
| `icon` | a square `.svg` or `.png` in the game folder (128 px or larger); must exist |
| `minShellVersion` | `x.y.z`; the build refuses a game that needs a newer shell than `SHELL_VERSION` |
| `permissions` | what the game asks the shell for. Known: `claude-usage` (token counts and timestamps from Claude Code's local transcripts) |
| `network` | optional, web games only: up to 8 plain host names (`api.example.com`; no scheme, port, path or wildcard) the game asks to reach over https/wss. Shown on the permission sheet; nothing else is reachable |
| `license` | optional: an SPDX id, like `MIT` |
| `repository` | optional: the `https://` URL of the source |
| `screenshots` | optional: up to 6 `.png` files in the game folder, for the catalog |

A web game (the template is `templates/web-game`; how to write one: [publishing-a-game.md](publishing-a-game.md)):

```json
{
  "manifestVersion": 1,
  "id": "token-garden",
  "name": "Token Garden",
  "description": "A small garden: a seed for every thousand tokens your AI agent spends, a flower for every finished turn.",
  "author": "Jacob Motta",
  "version": "0.1.0",
  "kind": "web",
  "entry": { "page": "index.html" },
  "icon": "icon.svg",
  "minShellVersion": "1.2.0",
  "permissions": ["claude-usage"],
  "license": "MIT"
}
```

`kind`, `network`, `license`, `repository` and `screenshots` came with shell 1.2.0. Unknown fields are refused, so
typos don't pass silently. New fields or permissions are a wrapper change: bump
`SHELL_VERSION` and `shell/package.json` together, and update this page, `CLAUDE.md` and `README.md`.
