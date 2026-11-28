# Contributing

Thanks for building a Token Game. The short version: the **shell** behaves the same for every game; what happens
inside your game is up to you, as long as only real agent usage moves it forward.

## The rules

1. **Usage only.** Progress comes from `UsageEvent`s the shell forwards (`tokens`, `task_done`, `session_start`,
   `agent_waiting`). No cheat, feed, debug or "add tokens" controls of any kind. Idle regen, if any, must not let a
   player progress without an agent working.
2. **A corner orb first, pop out.** Your game draws at three scales the shell picks: `mini` (the orb's round eye,
   about 54 px across), `expanded` (the open card, 440 × 330 with its bar) and `window` (320 × 180 up to full screen).
   Make each readable.
3. **Cheap when collapsed.** In `mini`, draw 1–4 frames a second and skip whatever nobody can see. Keep the
   simulation on the real clock so a slow frame rate doesn't slow the game.
4. **Calm.** Quiet palettes, no flashing; follow `settings.reducedMotion`; fade when idle where it fits.
5. **One instance, one view.** Don't open windows, trays or files of your own; ask the shell (`GameContext`).
6. **Counts only, nothing online.** Never read transcript contents, never use the network.
7. **Docs must match the shell.** If you change the wrapper (anything in `shell/`, `templates/`, `scripts/`, the
   manifest format, the root `package.json`, install or run commands, or how the app behaves on someone's computer),
   update `CLAUDE.md`, `README.md` and the affected docs in the same PR. `npm run docs-check` enforces the first two.
   Gameplay changes inside one game don't need this.

## A new game in 10 minutes

1. **Make it.** From the repo root: `npm run new-game -- my-game "My Game"`, then `cd my-game && npm install`.
2. **Run it.** `npm start`. The jar sits in an orb in a corner; click it, drag it, pop it out, open Settings (`,`).
3. **Your logic.** Replace `src/shared/jar.ts` with your game's state. Keep it free of the DOM; give it
   `feed(ev: UsageEvent)`, `save()` and `load()`. Write tests in `test/` (`npm test`).
4. **Your view.** In `src/game/app.ts`, draw into `#game` sized from its own `clientWidth`/`clientHeight` (minus
   `ctx.topInset` in the window). Use `onScale` to switch between the orb, the card and the window.
5. **Talk to the shell.** `ctx.setStatus({ count, title, lead, line, warm })` for the circle, its name tag, the card's status line and the window's top bar (`warm` tints
   the orb's ring when the game needs the player),
   `ctx.pulse('+3 grains')` for a quiet moment of news, `ctx.setTheme(...)` for your colours, `ctx.save(...)` /
   `ctx.load()` for your save file, `ctx.set(...)` to change a setting.
6. **Your settings.** Add fields in `src/shared/settings.ts` (defaults, sanitize, what Reset keeps) and their
   controls in `index.html`'s `#gamePanel`. The shell adds Display (presentation, size, docking, opacity, …) and Reset.
7. **Your manifest.** Edit `game.json`: description, icon (`icon.svg`), version. The build checks it.
8. **Prove it.** Add checks to `src/main/smoke.ts`, then `npm run typecheck`, `npm test`, `npm run test:smoke`,
   and look at `npm run shots`.
9. **List it** in the Games table in `README.md`, and open a PR.

## A catalog game (no build, any repo)

A game for the catalog is a sandboxed web page, not an Electron app: `npm run new-game -- my-game "My Game" --web`
(or `--into <folder>` for your own repo). Same rules as above; it talks to the app through `window.tokenGame`. How to
write, try and publish one: [docs/publishing-a-game.md](docs/publishing-a-game.md).

## Art

Pixel art fits the orb. [PixelLab](https://pixellab.ai) is fine for sprites but optional; hand-made art is just as
welcome. Keep any API key in your environment, never in the repo, and commit only the finished images (PNG or SVG)
under your game's folder.

## Testing

- Unit tests: `test/*.test.ts` in your game, run with the shell's own tests by `npm test`.
- The smoke test (`npm run test:smoke`) starts the real app with a temporary profile and a fake Claude Code
  folder, walks every mode (the circle in its corner, its name tag, the card, the size switch, the menu, dragging to
  another corner, the hotkey, the window and back, the window's sizes and corners, Settings,
  Reset, a restart), runs your game's checks, and **never shows a window**. Feed your game in it only with
  `k.transcript(...)`, which writes a real transcript line.
- Run one at a time; don't start a second Electron test while one runs.

## Branches and pull requests

- Branch from `main`: `feature/<short-name>` or `fix/<short-name>`.
- One plain-line commit message per change, saying what changed.
- Fill in the PR template; tick the docs box honestly. CI runs `npm run docs-check`.
- Keep PRs to one game or one shell change where you can.

## From outside

The repo is public; contributions are welcome by pull request from a fork.

- By contributing you agree your work is under the repo's licence ([MIT](LICENSE)). Art you add must be yours or
  under a licence that allows it here; say which in the PR. Generated art: say the tool and that its terms allow it.
- CI runs `docs-check` on every PR and `registry-check` on catalog changes. A maintainer reviews before merge; `main`
  takes changes through pull requests only.
- Never commit keys, tokens, `.env` files or personal data. Security problems: [SECURITY.md](SECURITY.md), not an
  issue.
- Be kind. Reviews are about the change, not the person.
