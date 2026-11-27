# The first catalog game: the Ant Farm, end to end

How the Ant Farm became the first game in the Token Games catalog, as **Ant Farm (web)** (`ant-farm-web`), and how
to do every step again: package, publish, sign, install, uninstall, update and roll back. The catalog itself:
[catalog.md](catalog.md). Writing a game from scratch: [publishing-a-game.md](publishing-a-game.md).

The built-in Ant Farm (the app you run with `npm start`) is unchanged and keeps its own save, `colony.json`. The
catalog version is the same farm, sandboxed, with **its own colony** in the catalog's save slot
(`~/Library/Application Support/Token Games/saves/ant-farm-web/save.json`). Installing, playing or removing it never
touches `colony.json`.

## 1. Package

The catalog game is not a fork. `ant-farm/src/web/main.ts` takes the farm's own page (`src/game`, `src/sim`) and runs
it through the shell's **hosted adapter** (`shell/src/page/hosted-shell.ts`), which speaks `window.tokenGame`
instead of Electron. `shell/scripts/build-web.mjs` bundles that into a folder of plain files:

```sh
cd ant-farm
npm run build:catalog      # writes catalog/: index.html, app.js, shell.css, hosted-shell.css, style.css, game.json, icon.svg
npm run check:catalog      # fails when catalog/ no longer matches the source (run it before a release)
```

`catalog/` is committed, so the release can be rebuilt from a commit by anyone. Its `game.json` comes from
`src/web/game.json` (id `ant-farm-web`: the catalog refuses a built-in game's id). It needs shell 1.3.0 or newer
(bridge version 2: `onHide`, to save before it is closed, and `env.feed`).

Zip it and get its sha256:

```sh
cd cli && npm install && npm run build
node dist/tg-registry.js pack ../ant-farm/catalog --out /tmp/bundles    # ant-farm-web-1.0.0.zip and its sha256
```

`pack` is deterministic (sorted entries, fixed dates and modes): packing twice gives the same sha256, and so does
CI packing the same commit. `cli/test/registry-tool.test.ts` checks exactly that, and that the bundle holds only
those seven files with no Node, Electron or local paths in `app.js`.

## 2. Publish (release, pointer, sign)

1. Bump `version` in `ant-farm/src/web/game.json`, `npm run build:catalog`, commit and push to `main`.
2. Tag that commit `ant-farm-web-v<version>` and push the tag. `release-bundle.yml` packs `ant-farm/catalog` (it
   finds the folder by the id in `game.json`) and attaches `ant-farm-web-<version>.zip` to a GitHub Release of the
   same name. Its job summary prints the pointer.

   ```sh
   git tag ant-farm-web-v1.0.0 <commit> && git push origin ant-farm-web-v1.0.0
   gh release view ant-farm-web-v1.0.0          # the zip; its sha256 is in the notes
   ```

3. Write or update the pointer, `registry/games/ant-farm-web.json`:

   ```json
   {
     "id": "ant-farm-web",
     "tier": "verified",
     "repository": "JakeMotta/token-games",
     "path": "ant-farm/catalog",
     "commit": "<the full tagged commit>",
     "tag": "ant-farm-web-v1.0.0",
     "bundle": {
       "url": "https://github.com/JakeMotta/token-games/releases/download/ant-farm-web-v1.0.0/ant-farm-web-1.0.0.zip",
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

5. Commit `registry/games/ant-farm-web.json`, `registry/index.json` and `registry/index.json.sig`, and push.
   `registry-publish.yml` runs `check-index` (the signature is by a key in the app, and the index is exactly what the
   pointers give) and deploys it to <https://jakemotta.github.io/token-games/registry/index.json>. CI never holds the
   private key; a pointer pushed without a newly signed index fails there and the live index stays as it was.

## 3. Install

On the player's Mac, with Token Games running (shell 1.3.0 or newer):

- **In the app:** click the orb → Settings → **Games** → **Check for games** → **Install** on *Ant Farm (web)* →
  read the permission sheet (it reads only the token counts your Claude Code sessions use, no network) →
  **Approve** → **Play**.
- **From an agent or a terminal** (they can only ask; the player still approves in the app):

  ```sh
  cd cli
  node dist/tokengames.js list --refresh         # ant-farm-web … available
  node dist/tokengames.js install ant-farm-web   # the app shows the permission sheet: the player clicks Approve
  node dist/tokengames.js status                 # installed
  node dist/tokengames.js use ant-farm-web       # play it
  node dist/tokengames.js use ant-farm           # back to the built-in farm
  ```

The app downloads the zip, refuses it unless its sha256 equals the signed index's, checks the bundle (no
executables, no zip-slip, a `web` game with that id), and swaps it in atomically.

## 4. Uninstall

Settings → Games → **Remove** on *Ant Farm (web)* → Approve, or `tokengames remove ant-farm-web` and Approve in the
app. Its files go; **its save stays**, so installing it again brings the same colony back. To forget the colony too,
delete `~/Library/Application Support/Token Games/saves/ant-farm-web/`.

## 5. Update

Release a newer version (steps 1 to 5 of Publish with a higher `version`) and change the pointer's `commit`, `tag` and
`bundle`. Players see **Update** in Settings → Games after Check for games, and approve it like an install. The save
carries over. A released zip is never replaced: `release-bundle.yml` refuses an existing tag.

## 6. Roll back

The app never installs an older version over a newer one, so a rollback is a forward fix:

- **A bad version is out:** add it to `registry/blocklist.json` (`{ "id": "ant-farm-web", "versions": ["1.1.0"],
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
- The Ant Farm packaged as `ant-farm-web` 1.0.0 from commit `eb48d0a`, released as the GitHub Release
  `ant-farm-web-v1.0.0` (zip sha256 `177ddc6c…3db6789`; packing it locally twice and in CI gave the same bytes, and
  `verify-pointer` rebuilt it from the commit), its pointer in `registry/games/`, the index signed on Jake's Mac.
- `registry-publish` checked the signature and the pointers and deployed the index; Pages serves the same bytes at
  <https://jakemotta.github.io/token-games/registry/index.json>.
- Installed from that public URL in a hidden run of the app, trusting only the key built into it (`TG_REGISTRY_URL=…
  node ../shell/scripts/smoke.mjs --only catalog-game`): the signature, the permission sheet and the sha256 all
  checked, played sandboxed, fed tokens, saved in its own slot (the built-in `colony.json` untouched), loaded that save
  again, removed with its save kept.
- The first update, `ant-farm-web` 1.0.1 (ants glide on every display frame and face the way they walk), from commit
  `e821960`, released as `ant-farm-web-v1.0.1` (zip sha256 `25e9299a…6d290aa5`, the same packed locally and in CI),
  its pointer moved and the index signed again on Jake's Mac. A copy of 1.0.0 shows **Update** after Check for games.

Left for Jake:

- **Install it in the app.** The Token Games app running on his Mac is an older build (shell 1.2, with no trusted key
  yet), so it can't see the catalog until the new code is running. After the next restart of the Ant Farm app on the
  new code: orb → Settings → Games → Check for games → Install *Ant Farm (web)* → **Approve** → Play.
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
8. **A save export** for catalog games (the save is capped at 1 MB; a very old colony could reach it).
9. **A sleep signal in the bridge.** The built-in farm stops drawing while the screen is locked or the Mac sleeps
   (`Game.onSleep`); the bridge has no such event yet, so the catalog farm keeps drawing at its orb rate then. Add it
   as bridge version 3 (`onSleep`) when it matters.
