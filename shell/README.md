# The shell

The wrapper every Token Game runs in. It owns everything around the game: where it lives (the notch island, the
drop-down, the popped-out window), the menu-bar icon and its menu, the global hotkey, the settings file and the
Display settings, the save file, the Claude Code usage feed, the build and the hidden smoke test. A game hands it a
view and reacts to usage. How it looks and behaves: [docs/presentation.md](../docs/presentation.md).

Version `1.0.0` (`package.json`, and `SHELL_VERSION` in `src/manifest.ts`; keep them equal). Games use it from
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
`onSettings`, `onKey`, `onHide`, `testHooks`, …) and `GameContext` (what it gets back: `settings`, `scale`,
`topInset`, `setStatus`, `pulse`, `setTheme`, `setCalm`, `save`/`load`, `set`, `reset`, …). Scales: `mini` (the
notch), `expanded` (the drop-down), `window`.

Settings: a game describes its own with a `GameSettingsSchema` (`defaults(seed)`, `sanitize(raw, base)`,
`reset(cur)`) and `settingsKit` (`src/settings.ts`) merges them with the shell's (`presentation`, `reducedMotion`,
`size`, `width`, `dock`, `bounds`, `opacity`, `alwaysOnTop`, `clickThrough`) into one flat `settings.json`.

## Files

| File | What |
|---|---|
| `src/main/shell.ts` | `startShell`: the one game window, the marker window while popped out, notch placement, the mode machine, pointer polling, tray, hotkey, display changes, IPC, the feed |
| `src/main/store.ts` | `SettingsStore` (debounced writes) and `SaveFile` |
| `src/main/preload.ts` | The page's bridge (`window.tokenShell`) |
| `src/main/smoke.ts`, `scripts/smoke.mjs` | The hidden end-to-end test and its runner; a game adds a `GameSmoke` |
| `src/main/pixel-icon.ts` | A menu-bar icon from a 16 × 16 pixel map |
| `src/page/shell-page.ts`, `shell.css` | `mountShell`: the island, peek strip, drop-down, window title bar, Settings sheet, keys |
| `src/page/marker.*` | The island left in the notch while the game is popped out |
| `src/notch.ts` | Menu-bar height, notch detection, display choice, island shapes and window bounds (pure) |
| `src/modes.ts` | The states `collapsed → peek → expanded → popping → popped → docking` and their scale and shape (pure) |
| `src/settings.ts` | Shared settings, `settingsKit` |
| `src/tray.ts` | The menu-bar menu (pure, so it's testable) |
| `src/feed/claude-code.ts`, `src/events.ts` | Watches Claude Code transcripts; the `UsageEvent` format (counts only) |
| `src/geometry.ts` | Floating window sizes, corners, docking |
| `src/manifest.ts` | `game.json` checker ([docs/manifest.md](../docs/manifest.md)) |
| `scripts/build-game.mjs` | Builds a game into `dist/` with the shell, after checking its `game.json` |

## Testing

`test/*.test.ts` runs with every game's `npm test`. `npm run test:smoke` in a game runs the shell's checks (notch,
peek, drop-down, pop out, docking, sizes, tray, hotkey, display changes, Settings, Reset, restart) and then the
game's. Windows are never shown in the smoke test: showing and hiding only flip a flag there.

Changing anything here is a wrapper change: update `CLAUDE.md`, `README.md` and the docs it affects in the same
change (`npm run docs-check`).
