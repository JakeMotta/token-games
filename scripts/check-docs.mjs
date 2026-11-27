// "Docs must match the shell": a change to the wrapper (the shell, the game templates, the repo scripts, the root
// package.json, the catalog CLI) must update CLAUDE.md and README.md in the same change. Pure gameplay changes inside one game don't.
//   npm run docs-check                      compares with the merge base of origin/main (and counts uncommitted work)
//   node scripts/check-docs.mjs --base <ref>
// The rule is in CLAUDE.md ("Hard rules"); CI runs this on every pull request (.github/workflows/docs-check.yml).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const WRAPPER = [/^shell\/(?!test\/)/, /^templates\//, /^scripts\/(?!.*\.test\.mjs$)/, /^package\.json$/, /^cli\/(?!test\/)/];
export const REQUIRED = ['CLAUDE.md', 'README.md'];

// Which required docs are missing from a change, given the files it touches. Empty: fine.
export function missingDocs(changed) {
  const wrapper = changed.filter((f) => WRAPPER.some((r) => r.test(f)));
  if (!wrapper.length) return { wrapper, missing: [] };
  return { wrapper, missing: REQUIRED.filter((d) => !changed.includes(d)) };
}

function git(...args) { return execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean); }

function changedFiles(base) {
  const from = git('merge-base', base, 'HEAD')[0];
  return [...new Set([
    ...git('diff', '--name-only', `${from}...HEAD`), // committed on this branch
    ...git('diff', '--name-only', 'HEAD'), // staged and unstaged
    ...git('ls-files', '--others', '--exclude-standard'), // new files
  ])];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--base');
  const base = i > 0 ? process.argv[i + 1] : 'origin/main';
  let changed;
  try { changed = changedFiles(base); } catch (e) { console.error(`docs-check: can't compare with ${base}: ${e.message.split('\n')[0]}`); process.exit(2); }
  const { wrapper, missing } = missingDocs(changed);
  if (!wrapper.length) console.log(`docs-check: ok (no wrapper changes since ${base})`);
  else if (!missing.length) console.log(`docs-check: ok (${wrapper.length} wrapper files changed, and ${REQUIRED.join(' and ')} too)`);
  else {
    console.error(`docs-check: FAIL. These wrapper files changed:\n  ${wrapper.slice(0, 12).join('\n  ')}${wrapper.length > 12 ? `\n  … and ${wrapper.length - 12} more` : ''}
but ${missing.join(' and ')} did not. Update ${missing.join(' and ')} (and the docs they link, like shell/README.md and
docs/presentation.md) so they describe the wrapper as it now works. See "Hard rules" in CLAUDE.md.`);
    process.exit(1);
  }
}
