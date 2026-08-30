/**
 * The orchestrator's job in a failure is to notice and to kill. These tests use
 * throwaway "session" scripts instead of the real one, because what is being tested
 * is the watchdog contract - progress resets it, silence trips it, and a stall is
 * reported as a stall rather than as a crash - not anything about browsers or judges.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessions } from './orchestrate.mjs';

const withTempDir = async (body) => {
  const dir = await mkdtemp(join(tmpdir(), 'webmcp-gauge-orch-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const fakeSession = async (dir, name, source) => {
  const path = join(dir, name);
  await writeFile(path, source, 'utf8');
  return path;
};

test('a session that exits is reported by its exit code, with no stall', async () => {
  await withTempDir(async (dir) => {
    const binPath = await fakeSession(dir, 'ok-session.mjs', 'process.exitCode = 0;\n');

    const results = await runSessions({
      sessions: 2,
      binPath,
      args: [],
      progressPaths: [join(dir, 'sweep.jsonl')],
      stallTimeoutMs: 60000,
      pollIntervalMs: 50,
    });

    assert.deepEqual(
      results.map(({ session, code, stalled, error }) => ({ session, code, stalled, error })),
      [
        { session: 1, code: 0, stalled: false, error: null },
        { session: 2, code: 0, stalled: false, error: null },
      ]
    );
  });
});

test('a non-zero exit is an exit, not a stall', async () => {
  await withTempDir(async (dir) => {
    // This is what an incomplete session looks like under the exit-code contract:
    // code 2, which the parent must not confuse with a process it had to kill.
    const binPath = await fakeSession(dir, 'incomplete-session.mjs', 'process.exitCode = 2;\n');

    const [result] = await runSessions({
      sessions: 1,
      binPath,
      args: [],
      progressPaths: [join(dir, 'sweep.jsonl')],
      stallTimeoutMs: 60000,
      pollIntervalMs: 50,
    });

    assert.equal(result.code, 2);
    assert.equal(result.stalled, false);
  });
});

test('a session that writes nothing is killed and reported as stalled', async () => {
  await withTempDir(async (dir) => {
    const binPath = await fakeSession(
      dir,
      'hanging-session.mjs',
      'setInterval(() => {}, 1000);\n'
    );

    const startedMs = Date.now();
    const [result] = await runSessions({
      sessions: 1,
      binPath,
      args: [],
      progressPaths: [join(dir, 'sweep.jsonl')],
      stallTimeoutMs: 400,
      pollIntervalMs: 100,
    });

    assert.equal(result.stalled, true, 'a process that never exits must be killed, not awaited');
    assert.equal(result.code, null);
    assert.match(result.error, /wrote nothing for \d+s and was killed/);
    assert.ok(
      Date.now() - startedMs < 30000,
      'the whole point is that this returns in seconds rather than never'
    );
  });
});

test('progress resets the watchdog, so a slow session is not mistaken for a stalled one', async () => {
  await withTempDir(async (dir) => {
    const checkpoint = join(dir, 'sweep.jsonl');
    const binPath = await fakeSession(
      dir,
      'slow-session.mjs',
      `import { appendFile } from 'node:fs/promises';
let written = 0;
const tick = setInterval(async () => {
  written += 1;
  await appendFile(${JSON.stringify(checkpoint)}, JSON.stringify({ trial: written }) + '\\n', 'utf8');
  if (written >= 8) {
    clearInterval(tick);
    process.exit(0);
  }
}, 100);
`
    );

    const [result] = await runSessions({
      sessions: 1,
      binPath,
      args: [],
      progressPaths: [checkpoint],
      // Shorter than the session's total runtime, longer than the gap between writes:
      // the difference between "taking a while" and "not working" is progress.
      stallTimeoutMs: 350,
      pollIntervalMs: 50,
    });

    assert.equal(result.stalled, false, `killed a session that was making progress: ${result.error}`);
    assert.equal(result.code, 0);
    assert.equal((await readFile(checkpoint, 'utf8')).trim().split('\n').length, 8);
  });
});

test('the failure log counts as progress, so an all-failing session is not killed', async () => {
  await withTempDir(async (dir) => {
    // A session whose every trial fails writes only to the failure log. Watching the
    // checkpoint alone would kill exactly the run that has the most to report.
    const failures = join(dir, 'harness-failures.jsonl');
    const binPath = await fakeSession(
      dir,
      'failing-session.mjs',
      `import { appendFile } from 'node:fs/promises';
let n = 0;
const tick = setInterval(async () => {
  n += 1;
  await appendFile(${JSON.stringify(failures)}, JSON.stringify({ kind: 'judge_unavailable', n }) + '\\n', 'utf8');
  if (n >= 6) {
    clearInterval(tick);
    process.exit(2);
  }
}, 100);
`
    );

    const [result] = await runSessions({
      sessions: 1,
      binPath,
      args: [],
      progressPaths: [join(dir, 'sweep.jsonl'), failures],
      stallTimeoutMs: 350,
      pollIntervalMs: 50,
    });

    assert.equal(result.stalled, false, `killed an all-failing session: ${result.error}`);
    assert.equal(result.code, 2);
  });
});
