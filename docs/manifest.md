# game.json

Every game folder has a `game.json`. It is small on purpose, so a future catalog can list and install games without
running them. The build (`shell/scripts/build-game.mjs`) checks it with `checkManifest` (`shell/src/manifest.ts`) and
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
| `name` | shown in the island, the window and the menu bar; at most 40 characters |
| `description` | one sentence, at most 200 characters |
| `author` | a name, at most 80 characters |
| `version` | the game's version, `x.y.z` |
| `entry.main`, `entry.page` | the built main-process file and page, relative to the game folder |
| `icon` | a square `.svg` or `.png` in the game folder (128 px or larger); must exist |
| `minShellVersion` | `x.y.z`; the build refuses a game that needs a newer shell than `SHELL_VERSION` |
| `permissions` | what the game asks the shell for. Known: `claude-usage` (token counts and timestamps from Claude Code's local transcripts) |

Unknown fields are refused, so typos don't pass silently. New fields or permissions are a wrapper change: bump
`SHELL_VERSION` and `shell/package.json` together, and update this page, `CLAUDE.md` and `README.md`.
