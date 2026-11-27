# Writing and publishing a catalog game

A catalog game is a small web page that Token Games runs in a sandbox, in the orb in a corner of the screen, its
card, or a floating window. It moves forward only when the player's AI agent really works. How the catalog works on
the player's side: [catalog.md](catalog.md).

## 1. Start from the template

```sh
npm run new-game -- sand-clock "Sand Clock" --web                    # in this repo: samples/sand-clock
npm run new-game -- sand-clock "Sand Clock" --web --into ~/games     # or a folder of your own
```

It copies [`templates/web-game`](../templates/web-game): `game.json`, `index.html`, `game.js`, `style.css`,
`icon.svg`. There is no build step. Use one if you like (Vite, esbuild…), as long as the folder you publish holds
only the built files and `game.json`. [samples/token-garden](../samples/token-garden) is a complete example.

## 2. Try it

Open Token Games (`cd ant-farm && npm start` from this repo), then **Settings → Games → Add local folder…**, pick
your folder and approve the sheet. Press Play. The app reads it straight from your folder: switch to another game and
back to see a change. From a terminal: `tokengames install --dir <folder>`, then approve it in the app.

## 3. The rules

The same as for every Token Games game ([CLAUDE.md](../CLAUDE.md), "Hard rules"):

- **Usage is the only input.** Progress comes from `tokenGame.onUsage` and nothing else: no cheat or "add tokens"
  buttons, keys or hidden shortcuts.
- **Calm.** Quiet colours, no flashing. Respect `reducedMotion` (no flights or floating labels, fewer frames).
- **Cheap in the orb.** When `env.scale === 'mini'` the orb shows your icon and `setStatus` count; draw nothing or very
  little, and keep the simulation on real time.
- **Counts only.** You get token counts and timestamps, never prompts or code. Send nothing anywhere you don't need
  to; if you need a server, list it in `network` and say why in your description.

## 4. `window.tokenGame`

```js
const tg = window.tokenGame;
tg.onUsage((ev) => {                       // { type: 'tokens', source, input, output, cache_read, cache_write, ts }
  if (ev.type === 'tokens') grow(ev.input + ev.output);
  else if (ev.type === 'task_done') celebrate();   // also 'session_start', 'agent_waiting'
});
const saved = await tg.load();             // your save (JSON, ≤ 1 MB), or null
await tg.save(state);                      // save every few seconds when something changed, not every frame
const s = await tg.getSettings();          // your settings (JSON, ≤ 64 KB); await tg.setSettings(s)
const env = await tg.env();                // { scale: 'mini' | 'expanded' | 'window', dark, reducedMotion }
tg.onEnv((e) => restyle(e));
tg.setStatus({ count: '12', title: 'Sand Clock', line: '12 jars · 300 grains' });  // the orb and its pill
tg.popOut(); tg.dock();                    // ask to open in the window, or dock back
```

`source` is which agent the usage came from (`claude-code` today). Usage arrives as it happens; while the app was
closed nothing arrives, so a game that lives on the real clock catches up from saved timestamps itself.

What you **cannot** do, by design: use Node or Electron, read or write files, open windows, navigate away, use the
camera, microphone or notifications, load scripts from elsewhere, use `eval`, or reach any server not in `network`
and approved by the player.

## 5. `game.json`

```json
{
  "manifestVersion": 1,
  "id": "sand-clock",
  "name": "Sand Clock",
  "description": "A jar that fills with sand, one grain for every thousand tokens your AI agent spends.",
  "author": "Your Name",
  "version": "0.1.0",
  "kind": "web",
  "entry": { "page": "index.html" },
  "icon": "icon.svg",
  "minShellVersion": "1.2.0",
  "permissions": ["claude-usage"],
  "license": "MIT",
  "repository": "https://github.com/you/sand-clock"
}
```

Every field: [manifest.md](manifest.md). A web game has no `entry.main`. Optional: `network` (up to 8 host names),
`license` (an SPDX id), `repository`, `screenshots` (up to 6 `.png` files in the folder).

## 6. Publish

1. Put the game in a **public** GitHub repo (or in `samples/` of this one, by pull request).
2. Bump `version` in `game.json`, commit, and note the full commit hash.
3. Make the bundle and a release. In this repo, push a tag `<id>-v<version>` and `release-bundle.yml` does it. In your
   own repo:

   ```sh
   git clone https://github.com/JakeMotta/token-games && cd token-games/cli && npm install && npm run build
   node dist/tg-registry.js pack /path/to/your/game --out /tmp/bundles     # prints the zip and its sha256
   gh release create sand-clock-v0.1.0 /tmp/bundles/sand-clock-0.1.0.zip   # in your game's repo
   ```

   `pack` is deterministic, so CI can rebuild the same bytes from your commit. It refuses programs and libraries
   (`.exe`, `.dll`, `.so`, `.sh`, `.node`, … or files that start like one).
4. Open a pull request here adding `registry/games/<id>.json` (format: [registry/README.md](../registry/README.md))
   with `tier: "community"`, or `"verified"` if you'd like a maintainer to read it. CI rebuilds your bundle from the
   commit and compares. Once it is merged, the signed index is republished and players see your game after "Check
   for games".

To update, release a new version and change `commit`, `tag` and `bundle` in your pointer. Released bundles are never
replaced, and the app never installs an older version over a newer one.
