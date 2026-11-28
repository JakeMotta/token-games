# A shell game in the catalog, end to end

How a game built on the shell becomes a catalog game, and how to do every step again: package, publish, sign,
install, uninstall, update and roll back. The worked example is the published one, **Ink Tower Defense**
(`tower-defense-web`, from `tower-defense/`). The catalog itself: [catalog.md](catalog.md). Writing a game from
scratch: [publishing-a-game.md](publishing-a-game.md).

The built-in game (the app you run with `npm start` in its folder) is unchanged and keeps its own save. The catalog
version is the same game, sandboxed, with **its own save** in the catalog's slot
(`~/Library/Application Support/Token Games/saves/tower-defense-web/save.json`) and its own settings. Installing,
playing or removing it never touches another game's save, so it sits beside the built-in Ant Farm (and its
`colony.json`) in the same app.

The Ant Farm went this way first, as **Ant Farm (web)** (`ant-farm-web`); it was taken out of the published index on
2026-11-27 (history below). `ant-farm/catalog/` is still built and checked, as the second bundle the smoke test
installs, but it is no longer published.

## 1. Package

The catalog game is not a fork. `tower-defense/src/web/main.ts` takes the game's own page (`src/game`, `src/sim`)
and runs it through the shell's **hosted adapter** (`shell/src/page/hosted-shell.ts`), which speaks
`window.tokenGame` instead of Electron; `src/web/configure.ts` hands the adapter the game's settings schema first.
`shell/scripts/build-web.mjs` bundles that into a folder of plain files:

```sh
cd tower-defense
npm run build:catalog      # writes catalog/: index.html, app.js, shell.css, hosted-shell.css, style.css, font.css, game.json, icon.svg, OFL.txt
npm run check:catalog      # fails when catalog/ no longer matches the source (run it before a release)
```

`catalog/` is committed, so the release can be rebuilt from a commit by anyone. Its `game.json` comes from
`src/web/game.json` (id `tower-defense-web`: the catalog refuses a built-in game's id). It needs shell 1.3.0 or newer
(bridge version 2: `onHide`, to save before it is closed, and `env.feed`). Licence files at the game's root (the
inlined Caveat font's `OFL.txt`) travel with the bundle.

Zip it and get its sha256:

```sh
cd cli && npm install && npm run build
node dist/tg-registry.js pack ../tower-defense/catalog --out /tmp/bundles    # tower-defense-web-1.0.0.zip and its sha256
```

`pack` is deterministic (sorted entries, fixed dates and modes): packing twice gives the same sha256, and so does
CI packing the same commit. `cli/test/registry-tool.test.ts` checks exactly that on the Ant Farm's bundle, and that
it holds only its files with no Node, Electron or local paths in `app.js`.

## 2. Publish (release, pointer, sign)

1. Bump `version` in `tower-defense/src/web/game.json`, `npm run build:catalog`, commit and push to `main`.
2. Tag that commit `tower-defense-web-v<version>` and push the tag. `release-bundle.yml` packs `tower-defense/catalog`
   (it finds the folder by the id in `game.json`) and attaches `tower-defense-web-<version>.zip` to a GitHub Release
   of the same name. Its job summary prints the pointer.

   ```sh
   git tag tower-defense-web-v1.0.0 <commit> && git push origin tower-defense-web-v1.0.0
   gh release view tower-defense-web-v1.0.0          # the zip; its sha256 is in the notes
   ```

3. Write or update the pointer, `registry/games/tower-defense-web.json`:

   ```json
   {
     "id": "tower-defense-web",
     "tier": "verified",
     "repository": "JakeMotta/token-games",
     "path": "tower-defense/catalog",
     "commit": "<the full tagged commit>",
     "tag": "tower-defense-web-v1.0.0",
     "bundle": {
       "url": "https://github.com/JakeMotta/token-games/releases/download/tower-defense-web-v1.0.0/tower-defense-web-1.0.0.zip",
       "sha256": "<the zip's sha256>"
     }
   }
   ```

4. Build the index and **sign it on the Mac that holds the key**, then check it the way CI will:

   ```sh
   cd cli
   node dist/tg-registry.js check ../registry
   node dist/tg-registry.js build-index ../registry                    # downloads each bundle, checks its sha256
   node dist/tg-registry.js sign ../registry/index.json --keychain     # macOS may ask once to allow the Keychain read
   node dist/tg-registry.js check-index ../registry
   ```

5. Commit `registry/games/tower-defense-web.json`, `registry/index.json` and `registry/index.json.sig`, and push.
   `registry-publish.yml` runs `check-index` (the signature is by a key in the app, and the index is exactly what the
   pointers give) and deploys it to <https://jakemotta.github.io/token-games/registry/index.json>. CI never holds the
   private key; a pointer pushed without a newly signed index fails there and the live index stays as it was.
6. Check it as a new player would, from a clean temp profile and the public index (it never reads your own state):

   ```sh
   cd ant-farm && npm run build
   node ../shell/scripts/smoke.mjs --only published --expect tower-defense-web --shots /tmp/published
   ```

   It lists only the expected games (also with the developer switch on), asks with `tokengames install` and denies,
   installs through the permission sheet, plays it sandboxed, feeds it a transcript line, and checks its own save.

To take a game **out** of the catalog, delete its pointer, rebuild, sign and push the index (steps 4 and 5). Its
releases stay on GitHub; copies already installed stay installed (the player can still remove them). To stop
installed copies running too, use the blocklist (Roll back, below).

## 3. Install

On the player's Mac, with Token Games running (shell 1.3.0 or newer):

- **In the app:** click the orb → **Games** (the Games and Settings window opens on its Games tab) → **Check for
  games** → **Install** on *Ink Tower Defense* → read the permission sheet (it reads only the token counts your Claude
  Code sessions use, no network) → **Approve** → **Play**.
- **From an agent or a terminal** (they can only ask; the player still approves in the app):

  ```sh
  cd cli
  node dist/tokengames.js list --refresh              # tower-defense-web … available
  node dist/tokengames.js install tower-defense-web   # the app shows the permission sheet: the player clicks Approve
  node dist/tokengames.js status                      # installed
  node dist/tokengames.js use tower-defense-web       # play it
  node dist/tokengames.js use ant-farm                # back to the built-in game
  ```

The app downloads the zip, refuses it unless its sha256 equals the signed index's, checks the bundle (no
executables, no zip-slip, a `web` game with that id), and swaps it in atomically.

In the Ink Tower Defense app itself (`tower-defense/`, `npm start`), `tower-defense-web` is a copy of the built-in
game, so it stays hidden there unless the developer switch is on; in every other app it is an approved game.

## 4. Uninstall

**Games** → **Remove** on *Ink Tower Defense* → Approve, or `tokengames remove tower-defense-web` and Approve in the
app. Its files go; **its save stays**, so installing it again brings the same game back. To forget it too, delete
`~/Library/Application Support/Token Games/saves/tower-defense-web/`.

## 5. Update

Release a newer version (steps 1 to 5 of Publish with a higher `version`) and change the pointer's `commit`, `tag` and
`bundle`. Players see **Update available** and **Update to …** on the Games tab
once their app has the new index (Check for games), a dot on the Games button and **Games… (1 update)** in the tray,
and approve it like an install. The save
carries over. A released zip is never replaced: `release-bundle.yml` refuses an existing tag.

## 6. Roll back

The app never installs an older version over a newer one, so a rollback is a forward fix:

- **A bad version is out:** add it to `registry/blocklist.json` (`{ "id": "tower-defense-web", "versions": ["1.1.0"],
  "reason": "…" }`), rebuild, sign and push the index. Installed copies of that version stop running (the player can
  still remove it) and it can't be installed. Then release the old code again as a higher version (say 1.1.1 from
  1.0.0's source) and point the pointer at it.
- **A bad index is out:** check out the previous `registry/` (`git checkout <good commit> -- registry`), sign it again
  (the `generated` date stays, so `check-index` still matches) and push. The app always fetches the newest index.
- **On one Mac, during an install:** a failed or interrupted install puts the previous version back by itself.

## The signing key

The catalog's ed25519 signing key was made on Jake's Mac on 2026-11-27 and lives only in his **login Keychain**:
service `token-games-registry-signing-key`, account `registry`. Its public key is pinned in the app
(`REGISTRY_KEYS`, `shell/src/catalog/keys.ts`):

```
Fswexp3LDILw4Chds9pjXqg/YziOv9duTD5iLzOy1aY=
```

It is not in the repo, not in GitHub secrets, and never printed: `tg-registry` reads it from the Keychain only to sign.

```sh
node dist/tg-registry.js keygen --keychain        # how it was made; refuses to replace an existing key
node dist/tg-registry.js public-key --keychain    # prints the public key, to compare with REGISTRY_KEYS
```

**Back it up** (once, and after a rotation), straight into a password manager or an encrypted note, never a file in a
repo or a synced folder in the clear:

```sh
security find-generic-password -a registry -s token-games-registry-signing-key -w | base64 -d | pbcopy
```

Paste it into the password manager, then clear the clipboard. To **restore** it on a new Mac, save the PEM to a
private file and import it:

```sh
node dist/tg-registry.js import-key ~/registry-key.pem --keychain && rm -P ~/registry-key.pem
node dist/tg-registry.js public-key --keychain    # must print the key above
```

**Rotate** it (on a suspected leak, or every few years):

1. `node dist/tg-registry.js keygen --keychain --account registry-2027` makes a second key beside the first.
2. Add its public key to `REGISTRY_KEYS` **beside** the old one, and ship that app version.
3. Once players have that version, sign with the new key (`sign … --keychain --account registry-2027`) and push.
4. In a later release, drop the old public key; delete the old Keychain item
   (`security delete-generic-password -a registry -s token-games-registry-signing-key`).

If the key leaks, do the same but fast, and block anything signed with the old key you didn't publish.

## Go-live status (2026-11-27)

Done:

- Repository settings (by the dispatcher): secret scanning with push protection, Dependabot security updates, GitHub
  Pages from GitHub Actions, `main` protected against force-pushes and deletion.
- The signing key made in Jake's Keychain, its public key pinned in the app, the index signed locally; no private key
  in GitHub.
- **History, Ant Farm (web):** the Ant Farm packaged as `ant-farm-web` 1.0.0 from commit `eb48d0a` (release
  `ant-farm-web-v1.0.0`, zip sha256 `177ddc6c…3db6789`), then 1.0.1 from `e821960` (release `ant-farm-web-v1.0.1`,
  zip sha256 `25e9299a…6d290aa5`), installed from the public index in a hidden run. It proved the catalog, but in the
  Ant Farm app it is a copy of the built-in game and stays hidden there. Its pointer and index entry were removed on
  2026-11-27; both GitHub Releases are kept (delete them only if nobody needs them).
- **Ink Tower Defense:** packaged as `tower-defense-web` 1.0.0 from commit `8ad79ee`, released as
  `tower-defense-web-v1.0.0` (zip sha256 `fa64c1f4…5a6660db`, the same packed locally and in CI), its pointer in
  `registry/games/` and the index signed on Jake's Mac, in the same index that dropped Ant Farm (web), so the published
  catalog holds only this game. Checked from a clean profile against the public index (`--only published --expect
  tower-defense-web` in the Ant Farm app): listed alone, also with the developer switch on; `tokengames list` and
  `install` find it; the permission sheet asks only for token counts; it installs, plays sandboxed, feeds and saves
  in its own slot, with `colony.json` untouched.

Left for Jake:

- **Back up the signing key** into a password manager (above). Without a backup, losing this Mac means rotating the
  key and shipping a new app before the catalog can change again.

## Next steps for the public launch

1. **An installable app.** Today the app runs from source (`npm start`). Package and sign a macOS build (and later
   Windows), so players don't need Node; ship it as a GitHub Release.
2. **Private vulnerability reporting** on the repository (SECURITY.md points to it).
3. **Pull requests for outside contributors:** keep direct pushes for Momo, but require a review and the
   `docs-check` and `registry-check` checks once others contribute; turn on "Require approval for all outside
   collaborators" for fork workflow runs.
4. **Fix the Dependabot pull requests** that fail `docs-check` (a dependency bump in `cli/` is a wrapper change by
   the rule); exempt lockfile-only bumps in `scripts/check-docs.mjs` or update the docs with them.
5. **More games:** Token Garden as a second Verified game (release `token-garden-v0.1.0` and add its pointer), then
   invite outside games under Community.
6. **A landing page** on Pages that lists the games from the index, with screenshots, instead of the bare link.
7. **Pin GitHub Actions by commit** and add an entropy scan (gitleaks) in CI before outside pull requests arrive.
8. **A save export** for catalog games (the save is capped at 1 MB; a very long game could reach it).
9. **A sleep signal in the bridge.** A built-in game stops drawing while the screen is locked or the Mac sleeps
   (`Game.onSleep`); the bridge has no such event yet, so a catalog game keeps drawing at its orb rate then. Add it
   as bridge version 3 (`onSleep`) when it matters.
