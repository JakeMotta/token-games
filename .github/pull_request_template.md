## What changed

<!-- One or two sentences, for players or contributors. -->

## How I checked it

<!-- Commands you ran and what you looked at. -->

- [ ] `npm run typecheck`, `npm test` and `npm run test:smoke` pass in every game this touches
- [ ] I looked at `npm run shots` for anything visual

## Rules

- [ ] Only real agent usage moves the game forward: no cheat, feed, debug or "add tokens" controls
- [ ] Calm in the notch, cheap when collapsed, Reduced motion respected
- [ ] No keys, tokens or personal data committed
- [ ] **Docs match the shell:** if this changes the wrapper (`shell/`, `templates/`, `scripts/`, the manifest format,
      the root `package.json`, install or run commands, or how the app behaves on someone's computer), I updated
      `CLAUDE.md`, `README.md` and the affected docs in this PR, and `npm run docs-check` passes. Pure gameplay
      changes in one game: not needed.
