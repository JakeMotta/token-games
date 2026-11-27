# Token Games CLI

Three small programs that talk to the catalog ([docs/catalog.md](../docs/catalog.md)):

| Program | What |
|---|---|
| `tokengames` | `list`, `install`, `use`, `remove`, `status`, over the running app's local control socket. Installs and removals are requests the player approves in the app |
| `token-games-mcp` | The same as an MCP server over stdio, for Claude Code, Cursor and other agents: `list_games`, `game_status`, `install_game`, `remove_game`, `set_active_game` |
| `tg-registry` | For the registry and CI: `keygen`, `pack`, `check`, `verify-pointer`, `build-index`, `sign`, `verify` ([registry/README.md](../registry/README.md)) |

```sh
npm install
npm run build        # dist/tokengames.js, dist/token-games-mcp.js, dist/tg-registry.js
npm run typecheck
npm test             # against a real catalog in a temp folder and a test registry signed with a throwaway key
```

They use the shell's catalog code from source (`@token-games/shell/*` → `../shell/src/*`). Nothing is published to
npm; run them with `node dist/<name>.js`, or `npm link` here to get the commands on your PATH.
