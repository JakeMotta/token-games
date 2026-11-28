# __GAME_NAME__

A Token Games catalog game: a plain web page that the Token Games app runs in a sandbox, in the orb in a corner of
the screen, its card, or a small floating window. It moves forward only when your AI agent really works. Made from
`templates/web-game` (`npm run new-game -- <id> --web`).

Right now it is the template's placeholder: a jar that fills with sand, one grain for every thousand tokens Claude
Code spends. Replace `game.js` with your game.

## Try it

There is no build step. Open Token Games, turn on **Settings → Games → Show developer and unapproved games**, then
**Games → Add local folder** and pick this folder. It shows
up as a Local game; press Play. The app reads it straight from this folder, so after an edit, switch to another game
and back to see the change.

## Files

| File | What it is |
|---|---|
| `game.json` | The manifest: `"kind": "web"`, id, name, version, icon, permissions ([docs/manifest.md](../../docs/manifest.md)) |
| `index.html` | The page. Keep its Content-Security-Policy; the shell adds a stricter one of its own anyway |
| `game.js` | The game. It talks to the app only through `window.tokenGame` |
| `style.css`, `icon.svg` | Its look, and the icon on the orb and in the Games list |

## What a catalog game can do

- Read usage counts: `tokenGame.onUsage(ev => …)` with token counts and turn events, never prompts or code.
- Keep its own save (1 MB) and settings (64 KB): `load`, `save`, `getSettings`, `setSettings`.
- Know where it is drawn: `env()` and `onEnv()` give `scale` (`'mini'` in the orb: draw nothing or very little),
  `dark` and `reducedMotion`.
- Put a number and a line on the orb: `setStatus({ count, title, line, warm })`.
- Ask to pop out or dock back: `popOut()`, `dock()`.

It has no Node, no files and no network (unless its manifest names hosts and the player approves them). The full
API, the rules and how to publish: [docs/publishing-a-game.md](../../docs/publishing-a-game.md).
