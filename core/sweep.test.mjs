import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFailures, buildPlan, readCheckpoint, readFailures, trialKey, __withDeadline as withDeadline } from './sweep.mjs';

const withTempDir = async (body) => {
  const dir = await mkdtemp(join(tmpdir(), 'webmcp-gauge-sweep-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const failure = (utteranceId, kind, session = 1) => ({
  session,
  repeat: 1,
  utteranceId,
  kind,
  error: `${kind} on ${utteranceId}`,
});

test('a failure is durable as soon as it is appended, one line at a time', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'nested', 'harness-failures.jsonl');

    // Written one at a time, which is how the sweep calls it: the point of the fix
    // is that a process killed after the first failure still leaves the first
    // failure on disk.
    await appendFailures(path, [failure('filter_rows-05', 'judge_truncated')]);
    const afterOne = await readFailures(path);
    assert.equal(afterOne.length, 1);

    await appendFailures(path, [failure('top_expenses-11', 'trial_threw')]);
    const afterTwo = await readFailures(path);
    assert.deepEqual(
      afterTwo.map((entry) => entry.utteranceId),
      ['filter_rows-05', 'top_expenses-11']
    );
    assert.equal((await readFile(path, 'utf8')).trim().split('\n').length, 2);
  });
});

test('appending nothing writes nothing, and a missing log reads as no failures', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'harness-failures.jsonl');
    await appendFailures(path, []);
    await appendFailures(null, [failure('a-01', 'trial_threw')]);
    assert.deepEqual(await readFailures(path), []);
  });
});

test('a trial that failed twice across attempts counts once, with its newest kind', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'harness-failures.jsonl');
    await appendFailures(path, [failure('top_expenses-11', 'judge_truncated')]);
    await appendFailures(path, [failure('top_expenses-11', 'trial_threw')]);
    await appendFailures(path, [failure('top_expenses-11', 'judge_unavailable', 2)]);

    const entries = await readFailures(path);
    // Same trial in session 1 twice - one entry, newest kind. Session 2 is a
    // different trial key and keeps its own entry.
    assert.equal(entries.length, 2);
    assert.equal(entries.find((entry) => entry.session === 1).kind, 'trial_threw');
    assert.equal(entries.find((entry) => entry.session === 2).kind, 'judge_unavailable');
  });
});

test('a malformed log line fails loudly rather than silently dropping a failure', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'harness-failures.jsonl');
    await writeFile(path, '{"session":1,"repeat":1,"utteranceId":"a-01"}\nnot json\n', 'utf8');
    await assert.rejects(() => readFailures(path), SyntaxError);
  });
});

test('a trial that never settles is stopped waiting for, and says so with a code', async () => {
  // The stall this exists to prevent: 90 minutes on one trial with no output, because
  // a CDP command never answered. A deadline turns that into a non-measurement the
  // sweep records and --resume retries.
  const neverSettles = new Promise(() => {});
  await assert.rejects(
    () => withDeadline(neverSettles, 20, 'trial x-01'),
    (error) => {
      assert.equal(error.code, 'DEADLINE');
      assert.match(error.message, /trial x-01 did not finish within 20ms/);
      return true;
    }
  );
});

test('the deadline does not interfere with work that finishes, or with its errors', async () => {
  assert.equal(await withDeadline(Promise.resolve('measured'), 1000, 'fast'), 'measured');

  // A real failure must arrive as itself, not as a timeout: the sweep classifies
  // trial_threw and trial_timeout differently and the distinction is diagnostic.
  await assert.rejects(
    () => withDeadline(Promise.reject(new Error('page threw')), 1000, 'failing'),
    (error) => {
      assert.equal(error.message, 'page threw');
      assert.equal(error.code, undefined);
      return true;
    }
  );
});

test('an abandoned trial that rejects later cannot crash the process', async () => {
  // The worker attaches a bare catch to the attempt for exactly this reason: after
  // the deadline wins, nothing is awaiting the original promise any more.
  let failLater;
  const attempt = new Promise((_, reject) => {
    failLater = reject;
  });
  attempt.catch(() => {});

  await assert.rejects(() => withDeadline(attempt, 10, 'trial y-02'));
  failLater(new Error('CDP Runtime.evaluate did not answer within 30000ms'));
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test('the plan covers every utterance once per repeat, controls included', () => {
  const fixture = {
    version: 'test',
    tools: [
      { name: 'a_tool', utterances: [{ id: 'a_tool-01' }, { id: 'a_tool-02' }] },
      { name: 'b_tool', utterances: [{ id: 'b_tool-01' }] },
    ],
    controls: { utterances: [{ id: 'control-01' }] },
  };

  const plan = buildPlan({ fixture, repeatsPerSession: 2 });
  assert.equal(plan.length, 8);
  assert.equal(plan.filter((item) => item.kind === 'control').length, 2);

  const withoutControls = buildPlan({ fixture, includeControls: false });
  assert.equal(withoutControls.length, 3);

  const oneTool = buildPlan({ fixture, tools: ['b_tool'], includeControls: false });
  assert.deepEqual(oneTool.map((item) => item.utterance.id), ['b_tool-01']);
});

test('the checkpoint reads back as records plus the trial keys already measured', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'sweep.jsonl');
    await writeFile(
      path,
      '{"session":2,"repeat":1,"utteranceId":"a_tool-01","outcome":"ok"}\n{"repeat":1,"utteranceId":"a_tool-02","outcome":"wrong_tool"}\n',
      'utf8'
    );

    const { records, keys } = await readCheckpoint(path);
    assert.equal(records.length, 2);
    assert.ok(keys.has(trialKey(2, 1, 'a_tool-01')));
    // A record written before sessions existed defaults to session 1 rather than
    // being dropped, or a resume would re-run every trial of an older run.
    assert.ok(keys.has(trialKey(1, 1, 'a_tool-02')));

    assert.deepEqual(await readCheckpoint(join(dir, 'missing.jsonl')), { records: [], keys: new Set() });
  });
});
