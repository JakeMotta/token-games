# The Token Games registry

The list of catalog games the app can install. One **pointer** per game in `games/<id>.json`, added or changed by
pull request; a **blocklist** in `blocklist.json`. CI turns them into one signed `index.json` and publishes it on
GitHub Pages at `https://jakemotta.github.io/token-games/registry/index.json`, the only file the app reads.
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
| `tier` | `verified` (a maintainer read the code at `commit`) or `community` (CI only; hidden unless the player turns Community on) |
| `repository` | `owner/repo` on GitHub, public |
| `path` | the game's folder in that repo (`.` for the root) |
| `commit` | the full commit; CI rebuilds the bundle from it |
| `tag` | the GitHub Release the bundle is attached to |
| `bundle.url` | https only |
| `bundle.sha256` | of the zip; the app refuses any other bytes |

`blocklist.json` is a list of `{ "id", "versions"?, "sha256"?, "reason" }`. A blocked version is left out of the
index, and an installed copy stops running.

## What CI does

- **Every pull request** (`.github/workflows/registry-check.yml`, read-only, no secrets, `pull_request` not
  `pull_request_target`): the CLI's tests; every pointer's format; for each added or changed pointer, it fetches the
  pinned commit, **rebuilds the zip** with `tg-registry pack` (deterministic: sorted entries, fixed dates and modes),
  and checks that its sha256 equals the pointer's and the released zip's; it **rejects executables** (by extension and
  by MZ / ELF / Mach-O / `#!` magic) and any game that isn't `"kind": "web"`. Nothing from a game is ever run.
- **On main** (`registry-publish.yml`): builds `index.json` from all pointers, signs it with the
  `TG_REGISTRY_SIGNING_KEY` secret, verifies it against the key built into the app, and deploys it to Pages. Until the
  secret is set it stops with a warning and publishes nothing.
- **A tag `<id>-v<version>`** (`release-bundle.yml`): packs a game in this repo (`samples/<id>` or `<id>`) and
  attaches the zip to a GitHub Release, never replacing one; the job summary prints the pointer to add here.

## Doing it by hand

```sh
cd cli && npm install && npm run build
node dist/tg-registry.js pack ../samples/token-garden --out /tmp/bundles     # the zip and its sha256
node dist/tg-registry.js check ../registry                                   # every pointer and the blocklist
node dist/tg-registry.js verify-pointer ../registry/games/<id>.json --source <checkout> [--zip <file>]
node dist/tg-registry.js build-index ../registry [--bundles <dir>] --out index.json
node dist/tg-registry.js sign index.json --key <private key file>            # or env TG_REGISTRY_SIGNING_KEY
node dist/tg-registry.js verify index.json [--public-key <base64>]
```

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
