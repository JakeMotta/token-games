# __GAME_NAME__

A Token Games game: it lives in an orb in a corner of the screen, opens when clicked and pops out into its own window, and it moves
forward only when your AI agent really works. Made from the template in `templates/game` (`npm run new-game`).

Right now it is the template's placeholder: a jar that fills with sand, one grain for every thousand tokens Claude
Code spends. Replace `src/shared/jar.ts` and `src/game/app.ts` with your game.

## Run it

```sh
cd __GAME_ID__
npm install
npm start        # builds, then runs it in a corner of the screen
npm test         # the game's tests and the shell's
npm run test:smoke   # the hidden end-to-end test; never shows a window
```

## Files

| File | What it is |
|---|---|
| `game.json` | The manifest: id, name, version, icon, permissions ([docs/manifest.md](../docs/manifest.md)) |
| `src/main/main.ts` | Starts the shell with the game's name, settings and menu-bar icon |
| `src/main/smoke.ts` | The game's own checks in the hidden smoke test |
| `src/shared/settings.ts` | The game's settings (the shell adds Display: corner orb or floating, the corner, size, docking, …) |
| `src/shared/jar.ts` | The game's logic, free of the DOM so it can be tested |
| `src/game/app.ts` | The page: draws into `#game` and hands the shell a `Game` |
| `src/game/index.html`, `style.css` | The view and the game's Settings sections |
| `test/*.test.ts` | Unit tests (`node --test`) |

How games work, the rules (usage only, no cheats, calm, cheap in the orb) and the proof loop:
[CONTRIBUTING.md](../CONTRIBUTING.md).
