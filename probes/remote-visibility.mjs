/**
 * Is the remote still invisible to a stranger? Two independent signals, run before
 * a push.
 *
 * The publishing policy keeps this repository private until the report launch, so
 * every push has a precondition somebody has to check. It was checked by hand on
 * 2026-08-29 correctly, and by hand again on 2026-09-03 with a one-liner whose
 * catch block reported "404 = private" for any thrown error — including the DNS
 * failure that was actually happening. This probe is that check, written once,
 * with the classification rules in `core/visibility.mjs` under test.
 *
 * Signals, chosen because their *failure modes* differ:
 *   1. an unauthenticated GitHub API read — 200 public, 404 not visible anonymously
 *   2. `git ls-remote` with the credential helper disabled and prompts off — a
 *      private repo has no way to succeed, so a demand for credentials is the
 *      private signature and listed refs are the public one
 *
 * Usage:
 *   node probes/remote-visibility.mjs
 *   node probes/remote-visibility.mjs --remote=upstream --timeout=20000
 *   node probes/remote-visibility.mjs --url=https://github.com/owner/repo
 *
 * `--url=` exists so the two answers this gate must get right can be exercised on
 * demand rather than only when they happen: point it at a known-public repository
 * and it must exit 1, and `--timeout=1` must exit 2 rather than reporting private.
 *
 * Exit codes, per `core/gate.mjs`'s contract: 0 private on every signal, 1 a
 * definitive public answer, 2 cannot answer. Read 2 as "do not push yet", never
 * as "probably fine".
 */
import { execFile } from 'node:child_process';

import { VISIBILITY_EXIT, classifyApiSignal, classifyLsRemoteSignal, combineSignals, parseGitHubSlug } from '../core/visibility.mjs';
import { parseOptions } from '../core/args.mjs';

const { options, error: optionsError } = parseOptions(process.argv.slice(2), {
  values: ['remote', 'url', 'timeout'],
  maxPositional: 0,
});
if (optionsError) {
  console.error(`cannot check visibility: ${optionsError}`);
  process.exit(VISIBILITY_EXIT.indeterminate);
}
const flag = (name, fallback) => options[name] ?? fallback;

const remoteName = flag('remote', 'origin');
const urlOverride = flag('url', null);
const timeoutMs = Number(flag('timeout', '15000'));

/**
 * Never rejects: a failed git call is data, and its stderr is the useful part.
 *
 * A killed call is reported as one. `execFile`'s timeout kills the child and
 * leaves `error.code` undefined, which read as "exit 0" until 2026-09-03 — a
 * timeout that looked like a successful empty answer, which is the same mistake
 * this whole probe exists to stop making.
 */
const git = (args, { env = {}, timeout = 10000, label = args.find((arg) => !arg.startsWith('-')) ?? 'git' } = {}) =>
  new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: process.cwd(), timeout, env: { ...process.env, ...env }, windowsHide: true },
      (error, stdout, stderr) => {
        const killed = Boolean(error?.killed) || error?.signal != null;
        resolve({
          code: killed ? null : (error?.code ?? 0),
          stdout: stdout ?? '',
          stderr: killed
            ? `git ${label} timed out after ${timeout} ms (operation timed out)`
            : (stderr || error?.message || ''),
        });
      }
    );
  });

// The remote lookup is a local config read, so the network timeout does not apply
// to it: a 1 ms --timeout should exercise the network signals, not kill `git
// remote get-url` and report a missing remote.
const remote = urlOverride ? { code: 0, stdout: urlOverride, stderr: '' } : await git(['remote', 'get-url', remoteName]);
const remoteUrl = remote.stdout.trim();
if (remoteUrl === '') {
  const detail = remote.stderr.trim() || (remote.code === null ? 'the lookup was killed' : `exit ${remote.code}`);
  console.error(`cannot check visibility: no URL for remote '${remoteName}' — ${detail}`);
  process.exit(VISIBILITY_EXIT.indeterminate);
}

const slug = parseGitHubSlug(remoteUrl);

const apiSignal = await (async () => {
  if (!slug) {
    return { name: 'github-api', verdict: 'indeterminate', detail: `remote is not a GitHub URL (${remoteUrl})` };
  }
  const url = `https://api.github.com/repos/${slug.owner}/${slug.repo}`;
  try {
    // No Authorization header on purpose: the question is what an anonymous
    // reader sees, and a cached credential would answer a different question.
    const response = await fetch(url, {
      headers: { 'User-Agent': 'webmcp-gauge visibility check (+https://github.com/Svishwa2004/webmcp-gauge)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { name: 'github-api', ...classifyApiSignal({ status: response.status }) };
  } catch (error) {
    return { name: 'github-api', ...classifyApiSignal({ transportError: error.message }) };
  }
})();

// GIT_TERMINAL_PROMPT=0 with the credential helper disabled is the exact pair
// verified by hand on 2026-08-29 and again on 2026-09-03: a private repo cannot
// answer, and its refusal names itself. GIT_ASKPASS was tried here and removed —
// supplying an empty username turns a clean "cannot read Username" into a failed
// authentication attempt against someone else's server, which is a worse signal
// and a worse manner.
const lsRemote = await git(['-c', 'credential.helper=', 'ls-remote', '--heads', remoteUrl], {
  env: { GIT_TERMINAL_PROMPT: '0' },
  timeout: timeoutMs,
  label: 'ls-remote',
});
const lsSignal = { name: 'anonymous-ls-remote', ...classifyLsRemoteSignal(lsRemote) };

const signals = [apiSignal, lsSignal];
const verdict = combineSignals(signals);

console.log(`remote ${urlOverride ? '(--url)' : remoteName}: ${remoteUrl}`);
for (const signal of signals) console.log(`  ${signal.name.padEnd(20)} ${signal.verdict.padEnd(14)} ${signal.detail}`);
console.log(`\nverdict: ${verdict.verdict.toUpperCase()} — ${verdict.reason}`);
console.log(
  verdict.exitCode === VISIBILITY_EXIT.private
    ? 'safe to push under the private-during-judging policy.'
    : verdict.exitCode === VISIBILITY_EXIT.public
      ? 'DO NOT PUSH: the remote is readable without credentials, which the policy forbids until the report launch.'
      : 'DO NOT PUSH YET: this run could not establish visibility. Fix the signal above and re-run — an unmeasured check is not a pass.'
);

process.exit(verdict.exitCode);
