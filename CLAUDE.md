# Token Games: notes for AI agents and contributors

Idle games for people who work with AI agents. Each game lives in a small orb in a corner of the screen, opens into a
card when clicked, and pops out into a small floating window. It moves forward **only** from real Claude Code usage
(tokens spent, turns finished), read from the user's local transcripts. Every game runs inside one shared wrapper,
the **shell** (`shell/`); a game only draws itself and reacts to usage.

## Hard rules

1. **Docs must match the shell.** Any change to how the wrapper works must update `CLAUDE.md`, `README.md` and the
   docs it affects **in the same change or PR**. The wrapper is: the shell (`shell/`: window modes, the corner orb,
   pop out and dock back, the tray, the usage feed, settings, the smoke test, the build), the manifest format
   (`game.json`, `docs/manifest.md`), the template and generator (`templates/game`, `scripts/`), the root
   `package.json`, install and run commands, and anything about how the app behaves on a user's computer. Pure
   gameplay changes inside one game are exempt. `npm run docs-check` fails when wrapper files changed but
   `CLAUDE.md` or `README.md` did not; CI runs it on every pull request.
2. **Usage is the only input.** Progress comes from `UsageEvent`s (`shell/src/events.ts`) and nothing else: no
   cheat, feed, test or "add tokens" buttons, keys, menu items or hidden shortcuts, not even for debugging. Tests
   feed a game by writing a real transcript line (`k.transcript()` in the smoke test).
3. **Every game uses the shell.** A corner orb first, pop out on demand ([docs/presentation.md](docs/presentation.md)). A
   game never creates its own windows, tray, settings file or feed, and never changes the shell's behaviour for itself.
4. **One instance, cheap when collapsed.** One app per game (the shell holds the single-instance lock), one game
   view moved between the orb, its card and the window. In the orb (`scale === 'mini'`) draw at 1–4 fps and
   skip work nobody sees; the simulation keeps real time.
5. **Calm.** Quiet colours, no flashing, respect Reduced motion (`settings.reducedMotion`: no flights, no floating
   labels, fewer frames). Fade or dim when idle where it fits.
6. **Counts only.** The feed reads token counts and timestamps from `~/.claude/projects/**/*.jsonl`; a game never
   sees prompts, code or file contents, and never sends anything over the network.
7. **Never commit keys or personal data.** API keys (PixelLab and the like) stay in your environment.

## Layout

| Path | What |
|---|---|
| `shell/` | The wrapper every game runs in ([shell/README.md](shell/README.md)). Version in `shell/package.json` and `SHELL_VERSION` (`shell/src/manifest.ts`); keep them equal |
| `shell/src/main/shell.ts` | Electron main: windows, orb placement and dragging, modes, tray, hotkey, settings file, save file, feed |
| `shell/src/page/shell-page.ts` | The page side: `mountShell(game)`, the orb, its pill and card, the window's title bar, Settings |
| `shell/src/game.ts` | The game interface: `Game`, `GameContext`, `GameStatusLine`, `Theme` |
| `shell/src/orb.ts`, `modes.ts` | Orb corners, display choice and shapes; the mode state machine (pure, unit-tested) |
| `shell/src/settings.ts` | Shared settings and `settingsKit` for a game's own settings schema |
| `shell/src/manifest.ts` | `game.json` checker ([docs/manifest.md](docs/manifest.md)) |
| `shell/scripts/build-game.mjs`, `smoke.mjs` | Build any game; run its hidden end-to-end smoke test |
| `ant-farm/` | The first game ([ant-farm/README.md](ant-farm/README.md)) |
| `templates/game/` | The starter game; `npm run new-game -- <id>` copies it to `<id>/` |
| `scripts/` | Repo scripts: `new-game.mjs`, `check-docs.mjs` (+ its test) |
| `docs/` | `presentation.md` (a corner orb, pop out), `manifest.md`, `ant-farm-design.md` |
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
| `npm run test:smoke` | Hidden end-to-end test: real Electron, windows never shown, a temp profile and a fake transcript folder |
| `npm run shots` | The same, saving screenshots of every mode to `shots/` |

From the root: `npm run new-game -- <id> ["Name"]`, `npm run docs-check`, `npm run test:scripts`.

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
- Env vars the shell reads: `TG_SMOKE`, `TG_SMOKE_MODE`, `TG_USER_DATA` (a temp profile), `TG_CLAUDE_DIR` (transcripts).
- A game's settings live in the app's data folder (`~/Library/Application Support/<id>/settings.json`), its save in
  `save.json` (or the `saveFile` it names; the Ant Farm uses `colony.json`).
