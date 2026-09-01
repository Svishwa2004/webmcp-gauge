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

/**
 * The static lint path needs no browser, no judge and no key, which is the claim
 * being tested as much as the exit code: L0 is the free on-ramp, so no judge
 * variable is passed here at all.
 */
const runLint = (extra = []) =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [binPath, 'lint', '--manifest', fileURLToPath(new URL('../fixtures/broken/tools.json', import.meta.url)), ...extra],
      {
        env: {
          ...process.env,
          WEBMCP_GAUGE_JUDGE_MODEL: '',
          WEBMCP_GAUGE_JUDGE_BASE_URL: '',
          WEBMCP_GAUGE_JUDGE_API_KEY: '',
        },
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
const readBadge = async (dir) => JSON.parse(await readFile(join(dir, 'badge.json'), 'utf8'));

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

/**
 * The badge is written by the same command that writes the report, so these two
 * cases check the wiring rather than the formatting (report/badge.test.mjs owns
 * that): a complete run gets a rate, and an incomplete one must not.
 */
test('a complete run leaves a badge carrying the rate and the trial count', async () => {
  await withTempRun(async (dir) => {
    const { planned } = await seedCheckpoint({ dir, ok: 20 });

    const result = await runCli(dir, ['--badge-label', 'airlock']);

    assert.equal(result.code, 0, result.stderr);
    const badge = await readBadge(dir);
    assert.equal(badge.label, 'airlock');
    assert.equal(badge.message, `100% (n=${planned})`);
    assert.equal(badge.color, 'brightgreen');

    const svg = await readFile(join(dir, 'badge.svg'), 'utf8');
    assert.match(svg, /<svg/);
    assert.match(svg, new RegExp(`100% \\(n=${planned}\\)`));
  });
});

test('an incomplete run leaves a badge that says incomplete, not a rate', async () => {
  await withTempRun(async (dir) => {
    const { planned } = await seedCheckpoint({ dir, ok: 12, drop: 8 });

    const result = await runCli(dir);

    assert.equal(result.code, 2, result.stderr);
    const badge = await readBadge(dir);
    assert.equal(badge.message, `incomplete (${planned - 8}/${planned})`);
    assert.equal(badge.isError, true);
    assert.ok(!/%/.test(badge.message), 'an unmeasured run must not publish a percentage');
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

    // One line per failed trial, written during the session rather than at the end
    // of it. A double-append would show six, and an end-of-session append would
    // lose all three if the process were killed first.
    const log = await readFile(join(dir, 'harness-failures.jsonl'), 'utf8');
    assert.equal(log.trim().split('\n').length, 3);
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

test('lint runs with no judge configured at all and exits 0 on a clean manifest', async () => {
  const result = await runLint(['--variant', 'clean']);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /No findings/);
});

test('lint exits 1 on a manifest with error-level findings, and says it is not a measured rate', async () => {
  const result = await runLint(['--variant', 'degraded']);

  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stdout, /ERROR\s+name\/invalid-characters/);
  assert.match(result.stderr, /not a measured invocation rate/);
});

test('--fail-on warning promotes advice to a failure, and the default does not', async () => {
  // The clean manifest carries no findings at all until the description floor is
  // raised past what the reference page ships, which then makes every description
  // thin: warnings only, so the two --fail-on levels are separable on one input.
  const advisory = await runLint(['--variant', 'clean', '--min-description', '400']);
  assert.equal(advisory.code, 0, 'warnings alone must not fail a build by default');
  assert.match(advisory.stdout, /WARN\s+description\/thin/);

  const strict = await runLint(['--variant', 'clean', '--min-description', '400', '--fail-on', 'warning']);
  assert.equal(strict.code, 1, strict.stderr);
});

test('lint exits 2 when the manifest cannot be read as one', async () => {
  const result = await runLint(['--variant', 'no-such-variant']);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /has no variants\.no-such-variant array/);
});

test('lint refuses a --fail-on level it does not implement rather than guessing', async () => {
  const result = await runLint(['--variant', 'clean', '--fail-on', 'nit']);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /takes 'error' or 'warning'/);
});
