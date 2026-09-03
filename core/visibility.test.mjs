import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VISIBILITY_EXIT,
  classifyApiSignal,
  classifyLsRemoteSignal,
  combineSignals,
  parseGitHubSlug,
} from './visibility.mjs';

/**
 * The first test is the bug this module exists for: on 2026-09-03 an inline check
 * printed "404 = private" when DNS was down and no HTTP status existed at all.
 */
test('a transport failure is never a private verdict, because no answer arrived', () => {
  const signal = classifyApiSignal({ transportError: 'getaddrinfo ENOTFOUND api.github.com' });
  assert.equal(signal.verdict, 'indeterminate');
  assert.match(signal.detail, /no HTTP response/);
});

test('a missing status is indeterminate even with no error to report', () => {
  assert.equal(classifyApiSignal({}).verdict, 'indeterminate');
  assert.equal(classifyApiSignal({ status: null }).verdict, 'indeterminate');
});

test('200 is public and 404 is private, and 404 says what it really means', () => {
  assert.equal(classifyApiSignal({ status: 200 }).verdict, 'public');
  const notFound = classifyApiSignal({ status: 404 });
  assert.equal(notFound.verdict, 'private');
  assert.match(notFound.detail, /not visible anonymously/);
});

test('a rate limit is not a visibility answer', () => {
  for (const status of [401, 403, 429]) {
    const signal = classifyApiSignal({ status });
    assert.equal(signal.verdict, 'indeterminate', `HTTP ${status} must not conclude`);
  }
});

test('an unexpected status is treated as no answer rather than guessed at', () => {
  assert.equal(classifyApiSignal({ status: 500 }).verdict, 'indeterminate');
  assert.equal(classifyApiSignal({ status: 301 }).verdict, 'indeterminate');
});

test('listed refs mean a stranger can read the repository', () => {
  const signal = classifyLsRemoteSignal({
    code: 0,
    stdout: '3486bc838f9e1debabb49cd5d44fd25368067a11\trefs/heads/main\n',
  });
  assert.equal(signal.verdict, 'public');
});

test('a demand for credentials is the private signature', () => {
  const signal = classifyLsRemoteSignal({
    code: 128,
    stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
  });
  assert.equal(signal.verdict, 'private');
  assert.match(signal.detail, /credentials demanded/);
});

/**
 * Observed 2026-09-03 with a credential helper in the environment: the refusal
 * arrives as GitHub's own wording rather than git's, so matching only git's
 * phrasing would have downgraded a real private answer to indeterminate.
 */
test('GitHub\u2019s own rejection wording counts as the private signature too', () => {
  for (const stderr of [
    'remote: Invalid username or token. Password authentication is not supported for Git operations.',
    "fatal: Authentication failed for 'https://github.com/owner/repo/'",
    'remote: Repository not found.',
  ]) {
    assert.equal(classifyLsRemoteSignal({ code: 128, stderr }).verdict, 'private', stderr);
  }
});

/**
 * Both of these begin `fatal: unable to access`, so the shared prefix decides
 * nothing and the transport patterns have to be tested before any conclusion.
 */
test('a DNS failure is indeterminate, not private, however fatal it looks', () => {
  const signal = classifyLsRemoteSignal({
    code: 128,
    stderr: "fatal: unable to access 'https://github.com/owner/repo/': Could not resolve host: github.com",
  });
  assert.equal(signal.verdict, 'indeterminate');
  assert.match(signal.detail, /transport failure/);
});

test('a timeout is indeterminate too', () => {
  const signal = classifyLsRemoteSignal({ code: 128, stderr: 'fatal: unable to access: Connection timed out after 15000 ms' });
  assert.equal(signal.verdict, 'indeterminate');
});

test('connecting and listing nothing is indeterminate, because an empty public repo looks the same', () => {
  const signal = classifyLsRemoteSignal({ code: 0, stdout: '' });
  assert.equal(signal.verdict, 'indeterminate');
});

test('an unclassifiable failure reports its exit code instead of picking a side', () => {
  const signal = classifyLsRemoteSignal({ code: 129, stderr: 'error: unknown option `--nope`' });
  assert.equal(signal.verdict, 'indeterminate');
  assert.match(signal.detail, /exit 129/);
});

test('two private signals are a pass, and that is the only pass', () => {
  const verdict = combineSignals([
    { name: 'api', verdict: 'private', detail: 'HTTP 404' },
    { name: 'ls-remote', verdict: 'private', detail: 'credentials demanded' },
  ]);
  assert.equal(verdict.verdict, 'private');
  assert.equal(verdict.exitCode, VISIBILITY_EXIT.private);
});

test('one lone private signal does not pass, because one signal cannot audit itself', () => {
  const verdict = combineSignals([{ name: 'api', verdict: 'private', detail: 'HTTP 404' }]);
  assert.equal(verdict.verdict, 'indeterminate');
  assert.equal(verdict.exitCode, VISIBILITY_EXIT.indeterminate);
  assert.match(verdict.reason, /one signal cannot audit itself/);
});

test('a single public signal outranks everything else', () => {
  const verdict = combineSignals([
    { name: 'api', verdict: 'private', detail: 'HTTP 404' },
    { name: 'ls-remote', verdict: 'public', detail: 'refs listed anonymously' },
  ]);
  assert.equal(verdict.verdict, 'public');
  assert.equal(verdict.exitCode, VISIBILITY_EXIT.public);
});

test('one indeterminate signal blocks a pass and names the signal that failed', () => {
  const verdict = combineSignals([
    { name: 'api', verdict: 'indeterminate', detail: 'no HTTP response (ENOTFOUND)' },
    { name: 'ls-remote', verdict: 'private', detail: 'credentials demanded' },
  ]);
  assert.equal(verdict.exitCode, VISIBILITY_EXIT.indeterminate);
  assert.match(verdict.reason, /api: no HTTP response/);
});

test('no signals at all is indeterminate rather than vacuously private', () => {
  assert.equal(combineSignals([]).exitCode, VISIBILITY_EXIT.indeterminate);
  assert.equal(combineSignals(undefined).exitCode, VISIBILITY_EXIT.indeterminate);
});

test('the slug comes off any spelling of a GitHub remote', () => {
  const expected = { owner: 'Svishwa2004', repo: 'webmcp-gauge' };
  for (const url of [
    'https://github.com/Svishwa2004/webmcp-gauge',
    'https://github.com/Svishwa2004/webmcp-gauge.git',
    'https://github.com/Svishwa2004/webmcp-gauge/',
    'https://token@github.com/Svishwa2004/webmcp-gauge.git',
    'git@github.com:Svishwa2004/webmcp-gauge.git',
    'ssh://git@github.com/Svishwa2004/webmcp-gauge.git',
  ]) {
    assert.deepEqual(parseGitHubSlug(url), expected, url);
  }
});

test('a non-GitHub or unusable remote yields null rather than a guessed slug', () => {
  for (const url of ['https://gitlab.com/owner/repo.git', 'file:///tmp/repo', '', null, undefined, 'not a url']) {
    assert.equal(parseGitHubSlug(url), null, String(url));
  }
});
