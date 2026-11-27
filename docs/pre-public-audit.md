# Public repo audit

Repo: https://github.com/JakeMotta/token-games, **public**. Audit date: 2026-11-27. A record of what the history
held when the repo went public, and what to do about it. The scan was read-only; it printed file names and commits,
never matched values.

## Summary

**No keys, tokens or private signing keys are in any commit on any branch**, local or pushed. This confirms the
earlier quick scan ("20 commits, no keys or tokens"), with one correction: there were **22** commits across all local
refs at the time, **18** on GitHub and 4 only on the maintainer's computer. The gaps were not secrets: **no licence**
(fixed in this change: `LICENSE`, MIT), **no `SECURITY.md`** (added), `main` has **no branch protection**, **secret
scanning and push protection are off**, and some pushed prototype branches carry third-party material that needs a
decision (below).

## Method

- Branches: 19 local, 8 on GitHub (`git branch -a`, `git ls-remote origin`, `gh api …/branches`). No tags.
- Commits: `git rev-list --all` (22) and `git rev-list --remotes=origin` (18).
- Content: every added line of every commit (`git log --all -p`, about 57k lines) matched against secret patterns
  (`sk-ant-…`, `sk-…`, `gh[pousr]_…`, `github_pat_…`, `AKIA…`, `AIza…`, `xox?-…`, PEM and OpenSSH private-key blocks,
  `Bearer …`, `token|secret|api_key|password = <long value>`, 64-hex and 44-char base64 strings (raw ed25519 sizes),
  JWTs, `_authToken`, `PIXELLAB`) and personal patterns (emails, `/Users/…`, `/home/…`, `/var/folders/…`,
  `/private/tmp/…`, worktree folders, phone numbers, street addresses, calendar words). Hits were reported as file and
  commit only.
- File names in history (466 paths): `.env`, `.pem`, `.key`, `id_rsa`, `.npmrc`, `.DS_Store`, logs, `node_modules/`,
  `dist/`, archives, videos, save files, transcripts (`.jsonl`).
- Commit metadata and messages; images (a sample viewed, PNG text and EXIF chunks checked); GitHub settings through
  read-only `gh api` calls.
- gitleaks and trufflehog were not installed, so this was a pattern scan, not an entropy scan.

## Findings

| Sev | What | Where | Action |
|---|---|---|---|
| High | No licence: outsiders could read but not reuse or contribute. `shell/package.json` said `UNLICENSED` | repo root | **Fixed here**: `LICENSE` (MIT), `license` in the package files |
| High | `main` is not protected: no branch protection or rulesets | GitHub settings | Jake: protect `main` (Recommendations) |
| Medium | Secret scanning, push protection, Dependabot security updates and private vulnerability reporting are off | GitHub settings | Jake: turn them on (free for public repos) |
| Medium | A near-full caption transcript of a third-party devlog video (17 timed quotes), and that game's name in a prototype page | `creatures/docs/video-analysis.md`, `creatures/prototype/*.html`, on the pushed `creatures*` branches | Replace the quotes with a short paraphrase and a link to the video, or delete those branches |
| Medium | 125 PixelLab-generated sprites (and the same as data URIs in `art.js`), made on free generations; whether free-tier output may be published is not confirmed | `prototype/tower-defense-views/` on one pushed prototype branch | Jake: confirm PixelLab's terms for the plan used, or delete that branch |
| Low | The pushed `game-catalog-explainer` branch says "the repo you are in is private", names internal task numbers and a local branch, and gives two example repos that don't exist | `docs/game-catalog.html`, `docs/game-catalog-design.md` | **Fixed on `main` here**; delete that branch on GitHub |
| Low | Pushed prototype branch names follow an internal tool's naming (`worktree-…-task-NNN`) | GitHub branch list | Delete or rename stale prototype branches |
| Low | Two video files are named as coming from "Jake's Downloads" (no path) | `creatures/docs/*.md` | Optional: link the public videos instead |
| Low | `pixellab_views.py` falls back to reading `PIXELLAB_API_KEY` from `~/.zshrc`; no key value is committed | `prototype/tower-defense-views/tools/` | Fine; env-only would surprise contributors less |
| Low | No root `.gitignore`; only `ant-farm/` had one | root | **Fixed here**: root `.gitignore`, and one in each template |
| Low | `docs-check.yml` had no `permissions:` block (the default token is read-only, so impact was small) | `.github/workflows/` | **Fixed here**: `permissions: contents: read` |
| Info | The author name in manifests and the author's personal email in commit metadata | `game.json` files; every commit | Intentional attribution. For future commits, a GitHub `noreply` address hides the email; past commits keep it unless rewritten |
| Info | Local-only branches (never pushed) include a doc that describes a private project's code, and 91 more PixelLab sprites | the maintainer's computer only | Don't push them as they are |

## Secrets

- **None found** in 22 commits on 19 local and 8 remote branches.
- **PixelLab key**: not present. Every mention is the variable name, a `PIXELLAB_API_KEY=...` placeholder or an
  `os.environ.get` read; the `Authorization` header is built at run time.
- **Signing key**: no PEM or OpenSSH block, no 64-hex or 44-char base64 strings, no `.pem`, `.key` or `id_rsa` files.
  The catalog's signing key has not been made yet; tests make a fresh key in memory and never write it
  ([catalog.md](catalog.md), "Who holds the signing key"). `tg-registry keygen` refuses to write inside a git checkout.
- No `.env`, `.npmrc` or auth tokens; every `resolved` URL in `package-lock.json` points at `registry.npmjs.org`.
- "secret" appears only in prose and tests (a test checks that prompt text never leaks into a game).

## Personal data and paths

- **Absolute paths**: none in any file in any commit (no `/Users/…`, `/home/…`, `/var/folders/…`, `/private/tmp/…`).
- **Emails**: one, only in commit metadata, none in file contents.
- **Phone numbers, street addresses, calendar or meeting data**: none.
- **Screenshots**: `main` had no images. The pushed `creatures*` branches have 64 headless captures of a prototype
  page; the ones viewed show page content only (no desktop, menu bar, notifications, paths or names) and carry no PNG
  text or EXIF chunks. This change adds no screenshots to the repo.
- **Names**: "Jake" and "Jacob Motta" in design notes, manifests and a test comment. Harmless.

## Licences

- **Declared**: none before this change. Now `LICENSE` (MIT) at the root; `license: "MIT"` in the root, `shell/`,
  `ant-farm/`, `cli/` and template package files; catalog games declare theirs in `game.json`.
- **Copied code**: no third-party licence headers or vendored libraries.
- **Fonts**: prototypes and `docs/game-catalog.html` link Google Fonts (open-licensed, not bundled). Linking sends a
  request to Google when someone opens the page: fine for docs and prototypes, never in a shipped game (rule 6).
- **PixelLab art and the third-party transcript**: see Findings; this audit does not decide either.

## GitHub settings (read-only, at audit time)

| Setting | Value |
|---|---|
| Visibility | public; default branch `main` |
| Branch protection / rulesets | none, on all 8 branches |
| Pages | not enabled |
| Secret scanning, push protection | disabled |
| Dependabot security updates, private vulnerability reporting | disabled |
| Actions | enabled; all actions allowed; default token read-only; fork PRs need approval for first-time contributors |
| Actions secrets | none |
| Collaborators | the owner only |

## Recommendations

Done in this change: `LICENSE` (MIT), [SECURITY.md](../SECURITY.md), a section for outside contributors in
[CONTRIBUTING.md](../CONTRIBUTING.md), a root `.gitignore`, `permissions:` on every workflow, and the stale "private"
note removed from the catalog explainer.

For Jake, in GitHub's settings:

1. **Protect `main`**: require a pull request (PR-only), at least one approving review for outside contributors,
   the `docs-check` and `registry-check` status checks, no force-pushes or deletion. Consider "Require approval for
   all outside collaborators" for fork workflow runs.
2. **Turn on** secret scanning, push protection, Dependabot alerts and security updates, and private vulnerability
   reporting (SECURITY.md points to it).
3. **Pages**: Settings → Pages → Source: GitHub Actions, so `registry-publish.yml` can deploy the index.
4. **The signing key**: decide who holds it, make it outside the repo, add the public key to the app and the private
   key as the `TG_REGISTRY_SIGNING_KEY` secret ([catalog.md](catalog.md)).
5. **CODEOWNERS** (optional): `/shell/`, `/.github/`, `/scripts/`, `/registry/`, `/cli/` owned by the maintainer, with
   "Require review from Code Owners".
6. **Clean up pushed branches**: delete or rewrite `creatures*` (the transcript), the PixelLab prototype branch (until
   the terms are confirmed) and `game-catalog-explainer`. Deleted branches' commits can stay reachable by hash on
   GitHub for a while.
7. **Before pushing local-only branches**: remove the private project's description and confirm PixelLab terms.
8. **Optional**: a GitHub `noreply` email for future commits; gitleaks in CI for an entropy scan; pin actions by SHA.
