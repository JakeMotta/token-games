# Security

Token Games runs on people's computers, reads their Claude Code usage counts and, through the catalog, runs games
other people wrote. Please report anything that could let a game, a registry entry or another program get past
that.

## Reporting

Report privately through GitHub: the repo's **Security** tab → **Report a vulnerability**. Please don't open a public
issue or pull request for it. Say what you found, how to reproduce it, and what it lets someone do. You'll get an
answer there, and a credit in the fix if you'd like one.

## What counts

- A catalog game reaching Node, Electron, files, other games' data, the network beyond its approved hosts, or any
  part of `window.tokenGame` it shouldn't ([docs/catalog.md](docs/catalog.md)).
- An install that skips the sha256 check, writes outside its folder (zip-slip), installs an older version, or runs
  without the player's approval.
- An index accepted with a bad or missing signature, or a blocklisted game still running.
- The control socket, CLI or MCP server approving anything, or reachable by another user or over the network.
- Prompt, code or file contents reaching a game or leaving the computer (games get counts only).
- A secret committed to this repo.

A game that is merely bad, misleading or breaks the rules (no network use, usage only, calm): open an issue or a
pull request to `registry/blocklist.json` instead.

## Supported versions

The latest release of each game and the shell on `main`.
