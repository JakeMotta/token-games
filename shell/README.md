# The shell

The wrapper every Token Game runs in. It owns everything around the game: where it lives (the corner orb, its
card, the popped-out window), the menu-bar icon and its menu, the global hotkey, the settings file and the
Display settings, the save file, the Claude Code usage feed, the game catalog, the build and the hidden smoke test. A
game hands it a view and reacts to usage. How it looks and behaves: [docs/presentation.md](../docs/presentation.md).

Version `1.2.0` (`package.json`, and `SHELL_VERSION` in `src/manifest.ts`; keep them equal). Games use it from
source: their tsconfig maps `@token-games/shell/*` to `../shell/src/*`, and `scripts/build-game.mjs` does the same
for esbuild.

## Using it from a game

Main process (`src/main/main.ts`):

```ts
import { startShell } from '@token-games/shell/main/shell';
import { pixelIcon } from '@token-games/shell/main/pixel-icon';
startShell({ name: 'My Game', dir: __dirname, settings: gameSettings, icon: (s) => pixelIcon(ICON, s), saveFile: 'save.json', smoke: gameSmoke });
```

Page (`src/game/app.ts`):

```ts
import { mountShell } from '@token-games/shell/page/shell-page';
mountShell<Settings>({ name: 'My Game', root: $('game'), settingsPanel: $('gamePanel'), start(ctx) { … }, onEvent(ev) { … }, onScale(s) { … } });
```

The full interface is `src/game.ts`: `Game` (what the game gives: `root`, `start`, `onEvent`, optional `onScale`,
`onSettings`, `onKey`, `onHide`, `onSleep` (the screen locked or the computer asleep: stop drawing), `testHooks`, …) and `GameContext` (what it gets back: `settings`, `scale`,
`topInset`, `setStatus`, `pulse`, `setTheme`, `setCalm`, `save`/`load`, `set`, `reset`, …). Scales: `mini` (the
orb), `expanded` (the card), `window`. `setStatus` takes `warm` to tint the orb's ring.

Settings: a game describes its own with a `GameSettingsSchema` (`defaults(seed)`, `sanitize(raw, base)`,
`reset(cur)`) and `settingsKit` (`src/settings.ts`) merges them with the shell's (`presentation`, `corner`,
`display`, `reducedMotion`, `size`, `width`, `dock`, `bounds`, `opacity`, `alwaysOnTop`, `clickThrough`) into one flat `settings.json`.

## Catalog games

The shell can also run a **catalog game** (`"kind": "web"` in `game.json`) in place of its own: installed from the
signed registry, a zip, or a local folder, chosen in Settings → Games, and run in a sandboxed `WebContentsView` whose
only bridge is `window.tokenGame`. The built-in game (the one whose app this is) keeps its own code and save. One game
is active at a time. While the app runs it also listens on a local control socket for the `tokengames` CLI and the
`token-games-mcp` server, which can ask but never approve. All of it: [docs/catalog.md](../docs/catalog.md).

## Files

| File | What |
|---|---|
| `src/main/shell.ts` | `startShell`: the one game window, the orb's corner and dragging, the mode machine, pointer polling, tray, hotkey, display changes, IPC, the feed |
| `src/main/store.ts` | `SettingsStore` (debounced writes) and `SaveFile` |
| `src/main/preload.ts` | The page's bridge (`window.tokenShell`) |
| `src/main/smoke.ts`, `scripts/smoke.mjs` | The hidden end-to-end test and its runner; a game adds a `GameSmoke` |
| `src/main/pixel-icon.ts` | A menu-bar icon from a 16 × 16 pixel map |
| `src/page/shell-page.ts`, `shell.css` | `mountShell`: the orb, its pill and card, dragging, window title bar, Settings sheet, keys |
| `src/orb.ts` | Corners, display choice, the orb's window bounds and shapes, the nearest corner after a drag (pure) |
| `src/modes.ts` | The states `orb → hover → expanded → popping → popped → docking` and their scale and shape (pure) |
| `src/settings.ts` | Shared settings, `settingsKit` |
| `src/tray.ts` | The menu-bar menu (pure, so it's testable) |
| `src/feed/claude-code.ts`, `src/events.ts` | Watches Claude Code transcripts; the `UsageEvent` format (counts only) |
| `src/geometry.ts` | Floating window sizes, corners, docking |
| `src/manifest.ts` | `game.json` checker ([docs/manifest.md](../docs/manifest.md)) |
| `scripts/build-game.mjs` | Builds a game into `dist/` with the shell (and `game-preload.js`), after checking its `game.json` |
| `src/catalog/catalog.ts` | The catalog on this computer: installed and local games, the active one, requests, approve and deny |
| `src/catalog/registry.ts`, `signing.ts`, `keys.ts` | Pointer and index formats, ed25519 signatures, the trusted keys and the registry URL |
| `src/catalog/zip.ts`, `bundle.ts`, `installer.ts` | Reading zips safely (no zip-slip), what a bundle may hold, install with sha256, atomic swap and rollback |
| `src/catalog/permissions.ts` | The permission sheet, the game's CSP and which requests it may make |
| `src/catalog/control.ts`, `commands.ts` | The local control socket and the commands it accepts (no approve) |
| `src/main/catalog-host.ts`, `game-preload.ts`, `src/hosted.ts` | Runs a catalog game sandboxed; `window.tokenGame`; what of the feed, save and status it gets |
| `src/page/games-panel.ts` | Settings → Games |
| `src/main/smoke-catalog.ts`, `smoke-registry.ts` | The smoke test's `catalog` run and its signed test registry |

## Testing

`test/*.test.ts` runs with every game's `npm test`. `npm run test:smoke` in a game runs the shell's checks (the orb's
corner, the pill, the card, dragging, hiding and the hotkey, pop out, docking, sizes, tray, hotkey, display changes, Settings, Reset, restart) and then the
game's. Settings' closing is checked with real mouse input: its ×, Esc, a click outside, and a slider dragged past
the sheet's edge (which must not close it). A third run, `catalog`, installs the sample Token Garden from a signed test registry, proves it has no Node,
files or network, feeds it a transcript line, switches back and removes it. Windows are never shown in the smoke test:
showing and hiding only flip a flag there. `npm run perf` (`smoke.mjs --perf [--profile <folder>]`) is a single hidden
run that measures what frames cost in each mode (`GameSmoke.perf`, `k.note`, `k.cpu`) and writes `perf.json`;
`--profile` copies a profile's `*.json` (settings and save) into the temp profile first, so a real save can be
measured without touching it.

Changing anything here is a wrapper change: update `CLAUDE.md`, `README.md` and the docs it affects in the same
change (`npm run docs-check`).
