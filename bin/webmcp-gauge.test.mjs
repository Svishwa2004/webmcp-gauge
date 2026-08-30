/**
 * The exit-code contract, end to end through the CLI.
 *
 * These tests drive the real binary, with a pre-seeded checkpoint and `--port 1`
 * so no browser is launched and no judge is called: every planned trial is already
 * in the checkpoint, so `--resume` has nothing to run. That makes the contract a
 * CI job depends on - 0 pass, 1 breach, 2 unmeasurable - testable in milliseconds
 * and without a provider, which is the only reason it can be a test at all rather
 * than a paragraph in a log entry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan } from '../core/sweep.mjs';

const binPath = fileURLToPath(new URL('./webmcp-gauge.mjs', import.meta.url));
const fixture = JSON.parse(
  await readFile(new URL('../fixtures/airlock.utterances.json', import.meta.url), 'utf8')
);

const GATED_TOOL = 'top_expenses';

/**
 * Synthesises the checkpoint a finished run would have left, from the same plan
 * builder the sweep uses - so a fixture change moves the expectation with it
 * instead of leaving a stale hand-written id list behind.
 */
const seedCheckpoint = async ({ dir, ok, drop = 0 }) => {
  const plan = buildPlan({
    fixture,
    repeatsPerSession: 1,
    tools: [GATED_TOOL],
    includeControls: false,
  });
  const kept = plan.slice(0, plan.length - drop);
  const lines = kept.map((item, index) =>
    JSON.stringify({
      session: 1,
      repeat: item.repeat,
      kind: item.kind,
      utteranceId: item.utterance.id,
      tag: item.utterance.tag ?? null,
      expectedTool: item.toolName,
      outcome: index < ok ? 'ok' : 'wrong_tool',
      reason: 'synthetic record: exit-code contract test, no judge involved',
      selection: { tool: index < ok ? item.toolName : 'describe_dataset', arguments: {} },
    })
  );
  await writeFile(join(dir, 'sweep.jsonl'), `${lines.join('\n')}\n`, 'utf8');
  return { planned: plan.length, seeded: kept.length };
};

const runCli = (dir, extra = []) =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        binPath,
        'run',
        '--resume',
        // Port 1 answers nothing, which is deliberate: nothing should need it.
        '--port',
        '1',
        '--sessions',
        '1',
        '--repeats',
        '1',
        '--tools',
        GATED_TOOL,
        '--no-controls',
        '--judge',
        'exit-code-contract-judge',
        '--base-url',
        'https://judge.invalid/v1',
        '--out',
        dir,
        ...extra,
      ],
      {
        env: { ...process.env, WEBMCP_GAUGE_JUDGE_API_KEY: 'never-sent-anywhere' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

const withTempRun = async (body) => {
  const dir = await mkdtemp(join(tmpdir(), 'webmcp-gauge-exit-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const readReport = async (dir) => JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));

test('a complete run above the threshold exits 0', async () => {
  await withTempRun(async (dir) => {
    const { planned, seeded } = await seedCheckpoint({ dir, ok: 20 });
    assert.equal(seeded, planned, 'this case is only meaningful with the full plan measured');

    const result = await runCli(dir, ['--fail-under', '0.9']);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /gate: PASS —/);

    const report = await readReport(dir);
    assert.equal(report.gate.code, 0);
    assert.equal(report.coverage.missingTrials, 0);
    assert.equal(report.coverage.expectedTrials, planned);
  });
});

test('a complete run with a rate below --fail-under exits 1', async () => {
  await withTempRun(async (dir) => {
    await seedCheckpoint({ dir, ok: 16 });

    const result = await runCli(dir, ['--fail-under', '0.9']);

    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /gate: FAIL —/);
    assert.match(result.stderr, new RegExp(`\`${GATED_TOOL}\` 80\\.0%`));

    const report = await readReport(dir);
    assert.equal(report.gate.status, 'breach');
    assert.equal(report.gate.breaches[0].tool, GATED_TOOL);
    assert.equal(report.coverage.missingTrials, 0);
  });
});

test('trials that could not be measured exit 2, not 1', async () => {
  await withTempRun(async (dir) => {
    // Three trials are missing from the checkpoint, so the resumed session tries to
    // run them and cannot: port 1 has no browser. That is the real unmeasurable
    // path, not a simulated one.
    await seedCheckpoint({ dir, ok: 17, drop: 3 });

    const result = await runCli(dir, ['--fail-under', '0.9']);

    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, /gate: INCOMPLETE —/);
    assert.match(result.stderr, /3 of 20 planned trials produced no measurement/);
    assert.match(result.stderr, /trial_threw/);
    assert.match(result.stderr, /not a threshold breach/);

    const report = await readReport(dir);
    assert.equal(report.gate.code, 2);
    assert.equal(report.coverage.missingTrials, 3);
    assert.equal(report.harnessFailures.length, 3);
  });
});

test('an incomplete run exits 2 even with no threshold, where it used to exit 1', async () => {
  await withTempRun(async (dir) => {
    await seedCheckpoint({ dir, ok: 19, drop: 1 });

    const result = await runCli(dir);

    assert.equal(result.code, 2, result.stderr);
    assert.equal((await readReport(dir)).gate.failUnder, null);
  });
});

test('a complete run with no threshold exits 0 and stamps the verdict into the artifact', async () => {
  await withTempRun(async (dir) => {
    await seedCheckpoint({ dir, ok: 12 });

    const result = await runCli(dir);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /\*\*Gate:\*\* COMPLETE —/);

    const report = await readReport(dir);
    assert.equal(report.schema, 'webmcp-gauge/report/3');
    assert.equal(report.gate.status, 'pass');
    assert.equal(report.gate.gatedTools, 0);
  });
});

test('--fail-under 90 is refused rather than gating every build against 9000%', async () => {
  await withTempRun(async (dir) => {
    await seedCheckpoint({ dir, ok: 20 });

    const result = await runCli(dir, ['--fail-under', '90']);

    assert.equal(result.code, 2);
    assert.match(result.stderr, /use 0\.9, not 90/);
  });
});
