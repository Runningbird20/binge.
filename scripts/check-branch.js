// Runs before `npm start` (the "prestart" script) so the branch you're about
// to run has the current code from GitHub.
//
// A branch cut from a stale local `main` has old code. On 2026-11-05 that
// meant the Neon-era catalog code, whose database no longer accepts logins,
// so Movies/TV/Books came up empty on every new branch.
//
//   - A branch with no commits of its own that's behind origin/main (main
//     itself, or a branch just cut from an old main) is fast-forwarded to it,
//     and local main moves along. Fast-forward only: nothing is merged,
//     rebased or dropped.
//   - A branch with commits of its own that's behind gets a note with the
//     command to bring main's changes in.
//   - Offline, no origin, detached HEAD, CI or BINGE_NO_AUTO_UPDATE=1: nothing.
// It never stops `npm start`.
const { execFileSync } = require('node:child_process');

const say = (text) => console.log(`binge.: ${text}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
    ...options,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
  }).trim();
}

function countCommits(range) {
  return Number(git(['rev-list', '--count', range])) || 0;
}

function checkBranch() {
  if (process.env.BINGE_NO_AUTO_UPDATE || process.env.CI) return 'skipped';
  let branch;
  try {
    branch = git(['symbolic-ref', '--short', '-q', 'HEAD']);
    git(['remote', 'get-url', 'origin']);
    git(['fetch', '--quiet', 'origin', 'main'], { timeout: 8000 });
  } catch {
    return 'skipped'; // detached HEAD, no origin, offline or slow: start anyway
  }

  const behind = countCommits('HEAD..origin/main');
  if (!behind) return 'current';
  const own = countCommits('origin/main..HEAD');
  if (own) {
    say(`${branch} is ${plural(behind, 'commit')} behind origin/main. If something's missing (like Movies not loading), bring main's changes in: git merge origin/main`);
    return 'behind';
  }

  const packagesChanged = Boolean(git(['diff', '--name-only', 'HEAD', 'origin/main', '--', 'package.json', 'package-lock.json']));
  try {
    git(['merge', '--ff-only', '--quiet', 'origin/main']);
  } catch {
    say(`${branch} is ${plural(behind, 'commit')} behind origin/main, and uncommitted changes stop it moving forward. Commit or stash them, then run: git merge --ff-only origin/main`);
    return 'blocked';
  }
  if (branch !== 'main') {
    try { git(['fetch', '--quiet', '.', 'origin/main:main']); } catch { /* main has commits of its own, or is checked out elsewhere */ }
  }
  say(`moved ${branch} forward ${plural(behind, 'commit')} to origin/main, so it has the current code.`);
  if (packagesChanged) say('package.json changed too: run npm install before using the app.');
  return 'updated';
}

module.exports = { checkBranch };

if (require.main === module) {
  try { checkBranch(); } catch (error) { say(`couldn't check the branch (${error.message.split('\n')[0]}); starting anyway.`); }
}
