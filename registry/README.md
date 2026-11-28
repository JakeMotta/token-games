# The Token Games registry

The list of catalog games the app can install. One **pointer** per game in `games/<id>.json`, added or changed by
pull request; a **blocklist** in `blocklist.json`. The key holder turns them into one `index.json`, signs it on
their Mac (`index.json.sig`) and commits both; CI checks them and publishes them on GitHub Pages at
`https://jakemotta.github.io/token-games/registry/index.json`, the only file the app reads. No private key is ever
in GitHub.
How the app uses it: [docs/catalog.md](../docs/catalog.md). Writing a game: [docs/publishing-a-game.md](../docs/publishing-a-game.md).

## A pointer

`games/token-garden.json`:

```json
{
  "id": "token-garden",
  "tier": "verified",
  "repository": "JakeMotta/token-games",
  "path": "samples/token-garden",
  "commit": "<the full 40-character commit the bundle was built from>",
  "tag": "token-garden-v0.1.0",
  "bundle": {
    "url": "https://github.com/JakeMotta/token-games/releases/download/token-garden-v0.1.0/token-garden-0.1.0.zip",
    "sha256": "<64 hex characters>"
  }
}
```

| Field | Rule |
|---|---|
| `id` | the game's id; equals the file name and the bundle's `game.json` id |
| `tier` | `verified` (a maintainer read the code at `commit`) or `community` (CI only; hidden unless the player turns on Show developer and unapproved games) |
| `repository` | `owner/repo` on GitHub, public |
| `path` | the game's folder in that repo (`.` for the root) |
| `commit` | the full commit; CI rebuilds the bundle from it |
| `tag` | the GitHub Release the bundle is attached to |
| `bundle.url` | https only |
| `bundle.sha256` | of the zip; the app refuses any other bytes |
| `duplicates` | optional: the id of the built-in game this is a copy of (a sandboxed build of it); the app hides it unless the developer switch is on. An id like `ant-farm-web` (the built-in id plus `-web`) counts as one without it |

`blocklist.json` is a list of `{ "id", "versions"?, "sha256"?, "reason" }`. A blocked version is left out of the
index, and an installed copy stops running.

## What CI does

- **Every pull request** (`.github/workflows/registry-check.yml`, read-only, no secrets, `pull_request` not
  `pull_request_target`): the CLI's tests; every pointer's format; for each added or changed pointer, it fetches the
  pinned commit, **rebuilds the zip** with `tg-registry pack` (deterministic: sorted entries, fixed dates and modes),
  and checks that its sha256 equals the pointer's and the released zip's; it **rejects executables** (by extension and
  by MZ / ELF / Mach-O / `#!` magic) and any game that isn't `"kind": "web"`. Nothing from a game is ever run.
- **On main** (`registry-publish.yml`, no secrets): `tg-registry check-index registry` checks that the committed
  `index.json.sig` is by a key built into the app (`REGISTRY_KEYS`) and that `index.json` is byte for byte what the
  pointers and the blocklist give (it downloads every bundle and checks its sha256); then it deploys `index.json`, its
  signature and a small landing page to Pages. A pointer merged without a newly signed index fails here and publishes
  nothing, so the live index stays the last good one.
- **A tag `<id>-v<version>`** (`release-bundle.yml`): packs a game in this repo (`samples/<id>`, `<id>`, or a shell
  game's built `<game>/catalog` folder whose `game.json` has that id) and attaches the zip to a GitHub Release, never
  replacing one; the job summary prints the pointer to add here.

## Doing it by hand

```sh
cd cli && npm install && npm run build
node dist/tg-registry.js pack ../samples/token-garden --out /tmp/bundles     # the zip and its sha256
node dist/tg-registry.js check ../registry                                   # every pointer and the blocklist
node dist/tg-registry.js verify-pointer ../registry/games/<id>.json --source <checkout> [--zip <file>]
node dist/tg-registry.js build-index ../registry                             # writes ../registry/index.json
node dist/tg-registry.js sign ../registry/index.json --keychain              # the catalog key, on the key holder's Mac
node dist/tg-registry.js check-index ../registry                             # what CI checks before it publishes
node dist/tg-registry.js verify index.json [--public-key <base64>]
```

`sign` also takes `--key <private key file>` (or env `TG_REGISTRY_SIGNING_KEY`) for a developer's own registry.
The real key, its backup and rotation: [docs/first-game-walkthrough.md](../docs/first-game-walkthrough.md).

A developer's own registry: serve a folder with `index.json`, `index.json.sig` and the zips, sign it with your own
key (`tg-registry keygen`, outside any git checkout), and start the app with `TG_REGISTRY_URL=<url of index.json>`
and `TG_REGISTRY_KEY=<your public key>`.

## Reviewing a pointer (maintainers)

For `verified`: read the game's files at `commit` (they are small: HTML, JS, CSS, images), check that it does what
its description says, asks only for the `network` hosts it needs and sends nothing but what the player expects, and
that its licence allows redistribution. CI has already checked the bundle matches the commit. Community pointers need
only a green CI and a sane name and description.

## Splitting it out

This folder is laid out so it can become its own repo (say `token-games-registry`) unchanged: move `registry/` to the
new repo's root with the two `registry-*` workflows, point `DEFAULT_REGISTRY` (`shell/src/catalog/keys.ts`) at the new
Pages URL, and keep the same signing key. See "A separate registry repo" in [docs/catalog.md](../docs/catalog.md).
