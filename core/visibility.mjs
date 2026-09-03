/**
 * Is this repository still invisible to a stranger? Classification rules only.
 *
 * The publishing policy is that the remote stays private until the report launch,
 * so "still private?" is a precondition for every push. It was checked by hand on
 * 2026-08-29 the right way — two independent signals, both of whose failure modes
 * are informative — and then by hand again on 2026-09-03 the wrong way, in an
 * inline one-liner whose catch block printed "404 = private" for **any** thrown
 * error. DNS was down at that moment, so a transport failure that never received
 * an HTTP status at all was reported as a private repo. The push was held only
 * because the second signal named the real cause (`Could not resolve host`).
 *
 * That is the same defect as the `d.name`/`d.domain` bug corrected the same day: a
 * check whose failure path cannot distinguish *no answer* from *the answer I
 * expected* is not a check. So the rules live here, with tests, and the I/O lives
 * in `probes/remote-visibility.mjs` — the split this project already uses for
 * `cohort.mjs`, `gallery.mjs` and `scorecard.mjs`.
 *
 * Three verdicts, never two. `indeterminate` is a first-class answer: the only
 * failure this gate must never produce is a confident "private" it did not measure.
 *
 * Exit codes follow the harness contract in `gate.mjs`, for the same reason:
 *
 *   0  every signal answered, and all of them say private
 *   1  a signal definitively says public — a real answer that breaks the policy
 *   2  cannot answer: a transport failure, an unexpected status, one lone signal,
 *      or signals that disagree
 */

export const VISIBILITY_EXIT = { private: 0, public: 1, indeterminate: 2 };

/**
 * The slug comes from the configured remote rather than a constant, because a
 * hardcoded `owner/repo` is how a check quietly starts testing a different
 * repository than the one being pushed. Returns null for anything that is not a
 * GitHub remote, which the caller must treat as "this signal does not apply"
 * rather than as a pass.
 */
export const parseGitHubSlug = (remoteUrl) => {
  if (typeof remoteUrl !== 'string' || remoteUrl.trim() === '') return null;
  const url = remoteUrl.trim();

  const patterns = [
    /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
    /^ssh:\/\/git@github\.com(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return { owner: match[1], repo: match[2] };
  }
  return null;
};

/**
 * Signal 1 — an unauthenticated GitHub API read.
 *
 * `status: null` is the case that motivated this file: no response arrived, so
 * there is nothing to read a verdict off. 403 and 429 are GitHub's rate limits,
 * which are also not visibility answers. A 404 means "not visible anonymously",
 * which covers both private and deleted — either way a stranger cannot read it,
 * and either way a push is not made unsafe by it.
 */
export const classifyApiSignal = ({ status = null, transportError = null } = {}) => {
  if (transportError) {
    return { verdict: 'indeterminate', detail: `no HTTP response (${transportError})` };
  }
  if (status === null || status === undefined) {
    return { verdict: 'indeterminate', detail: 'no HTTP status was captured' };
  }
  if (status === 200) return { verdict: 'public', detail: 'HTTP 200 — readable without credentials' };
  if (status === 404) return { verdict: 'private', detail: 'HTTP 404 — not visible anonymously' };
  if (status === 401 || status === 403 || status === 429) {
    return { verdict: 'indeterminate', detail: `HTTP ${status} — rate limit or auth, not a visibility answer` };
  }
  return { verdict: 'indeterminate', detail: `HTTP ${status} — unexpected, treated as no answer` };
};

const DEMANDS_CREDENTIALS =
  /could not read Username|could not read Password|terminal prompts disabled|Authentication failed|Invalid username or (?:password|token)|Password authentication is not supported|Permission denied \(publickey\)|Repository not found/i;

const TRANSPORT_FAILURE =
  /could not resolve host|couldn't resolve host|connection timed out|failed to connect|operation timed out|network is unreachable|connection reset|SSL certificate problem|proxy/i;

/**
 * Signal 2 — an anonymous `git ls-remote`, credential helper disabled and prompts
 * off, so a private repo has no way to succeed.
 *
 * Order matters. Git reports a DNS failure as `fatal: unable to access '…':
 * Could not resolve host`, and an HTTP error as `unable to access '…': The
 * requested URL returned error: 403` — the shared prefix is worthless, so the
 * transport patterns are checked before anything is concluded, and only a message
 * that actually demands credentials counts as private.
 *
 * Exit 0 with no refs is deliberately indeterminate: an empty *public* repository
 * answers exactly that way, and this project's remote has a `main` to report.
 */
export const classifyLsRemoteSignal = ({ code = null, stdout = '', stderr = '' } = {}) => {
  const out = String(stdout);
  const err = String(stderr);

  if (/refs\/heads\//.test(out)) {
    return { verdict: 'public', detail: 'refs listed anonymously' };
  }
  if (TRANSPORT_FAILURE.test(err)) {
    return { verdict: 'indeterminate', detail: `transport failure (${firstLine(err)})` };
  }
  if (DEMANDS_CREDENTIALS.test(err)) {
    return { verdict: 'private', detail: `credentials demanded (${firstLine(err)})` };
  }
  if (code === 0) {
    return { verdict: 'indeterminate', detail: 'connected and listed no refs — an empty public repo looks like this' };
  }
  return { verdict: 'indeterminate', detail: err.trim() === '' ? `exit ${code}, no output` : `exit ${code}: ${firstLine(err)}` };
};

const firstLine = (text) => String(text).trim().split('\n')[0].slice(0, 200);

/**
 * One signal cannot audit itself — that is the whole lesson of 2026-09-03, twice
 * over — so a `private` pass requires at least two signals that all say private.
 * A single `public` outranks everything: it is a real answer, and it is the one
 * answer that must stop a push.
 */
export const combineSignals = (signals) => {
  const list = Array.isArray(signals) ? signals : [];
  if (list.length === 0) {
    return { verdict: 'indeterminate', exitCode: VISIBILITY_EXIT.indeterminate, reason: 'no signals were collected' };
  }

  const publics = list.filter((signal) => signal.verdict === 'public');
  if (publics.length > 0) {
    return {
      verdict: 'public',
      exitCode: VISIBILITY_EXIT.public,
      reason: `readable without credentials — ${publics.map((signal) => signal.detail).join('; ')}`,
    };
  }

  const unknown = list.filter((signal) => signal.verdict !== 'private');
  if (unknown.length > 0) {
    return {
      verdict: 'indeterminate',
      exitCode: VISIBILITY_EXIT.indeterminate,
      reason: `cannot conclude — ${unknown.map((signal) => `${signal.name ?? 'signal'}: ${signal.detail}`).join('; ')}`,
    };
  }

  if (list.length < 2) {
    return {
      verdict: 'indeterminate',
      exitCode: VISIBILITY_EXIT.indeterminate,
      reason: 'only one signal answered, and one signal cannot audit itself',
    };
  }

  return {
    verdict: 'private',
    exitCode: VISIBILITY_EXIT.private,
    reason: `${list.length} independent signals agree the remote is not readable without credentials`,
  };
};
