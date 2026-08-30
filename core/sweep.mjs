/**
 * One measurement session: every utterance, P repeats deep, one fresh tab per trial.
 *
 * A session owns its browser process and its cold profile, and runs in its own
 * OS process, so nothing is shared with the sessions before or after it - not the
 * page cache, not the renderer, not the judge's HTTP connection pool. That
 * separation is the whole point: repeats inside a session are correlated by
 * construction, and the first two sweeps reported their sigma as if it described
 * reproducibility.
 *
 * A fresh tab per trial is the expensive choice and the correct one - reusing a
 * tab means trial N's highlighting is trial N+1's starting state.
 *
 * Every completed trial is appended to a JSONL checkpoint before the next one
 * starts, so a run that dies mid-session loses nothing and resumes.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { openSession } from '../browser/session.mjs';
import { runTrial } from './trial.mjs';

/**
 * Bounds one trial. Every wait inside a trial is bounded on its own now, but a
 * sweep is a long-running unattended thing and a stall is its worst failure mode:
 * the run that produced this comment sat on trial 160 of 160 for ninety minutes,
 * printing nothing, because a CDP command never answered and nothing was watching.
 * A trial that overruns is recorded as a non-measurement and retried by --resume,
 * which is what every other unmeasurable trial already does.
 */
const withDeadline = (promise, ms, label) => {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} did not finish within ${ms}ms`);
      error.code = 'DEADLINE';
      reject(error);
    }, ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
};

/** Exported for tests: the deadline is the invariant, not an implementation detail. */
export const __withDeadline = withDeadline;

export const trialKey = (session, repeat, utteranceId) => `${session}:${repeat}:${utteranceId}`;

/**
 * Appends harness failures as they happen rather than at the end of a session.
 *
 * This was written at session end once, and a session killed mid-plan then took its
 * failure kinds with it: the run that produced `reports/discrimination-2026-08-30.md`
 * lost three of them to an external timeout. Coverage still caught the missing
 * trials, because that is computed from the plan rather than from this log - but the
 * diagnosis was gone, and a diagnosis that only survives a clean exit is not much of
 * a diagnosis.
 */
export const appendFailures = async (path, failures) => {
  if (!path || failures.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${failures.map((failure) => JSON.stringify(failure)).join('\n')}\n`, 'utf8');
};

/**
 * Reads the failure log, keeping the newest entry per trial. The log accumulates
 * across `--resume` attempts, so the same trial can appear more than once; a report
 * wants "how many trials failed at least once", not "how many attempts failed".
 */
export const readFailures = async (path) => {
  try {
    const text = await readFile(path, 'utf8');
    const byTrial = new Map();
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue;
      const failure = JSON.parse(line);
      byTrial.set(trialKey(failure.session ?? 1, failure.repeat, failure.utteranceId), failure);
    }
    return [...byTrial.values()];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

export const readCheckpoint = async (path) => {
  try {
    const text = await readFile(path, 'utf8');
    const records = text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    return {
      records,
      keys: new Set(records.map((r) => trialKey(r.session ?? 1, r.repeat, r.utteranceId))),
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { records: [], keys: new Set() };
    throw error;
  }
};

/** Flattens the fixture into one session's trial plan, controls included. */
export const buildPlan = ({
  fixture,
  repeatsPerSession = 1,
  tools = null,
  includeControls = true,
}) => {
  const plan = [];

  for (let repeat = 1; repeat <= repeatsPerSession; repeat += 1) {
    for (const toolBlock of fixture.tools) {
      if (tools && !tools.includes(toolBlock.name)) continue;
      for (const utterance of toolBlock.utterances) {
        plan.push({
          repeat,
          kind: 'tool',
          toolName: toolBlock.name,
          utterance,
          setup: toolBlock.setup ?? null,
        });
      }
    }

    if (includeControls && fixture.controls) {
      for (const utterance of fixture.controls.utterances) {
        plan.push({ repeat, kind: 'control', toolName: null, utterance, setup: null });
      }
    }
  }

  return plan;
};

const toCheckpointRecord = ({ item, record, session, sessionMeta }) => ({
  session,
  repeat: item.repeat,
  kind: item.kind,
  utteranceId: item.utterance.id,
  tag: item.utterance.tag ?? null,
  expectedTool: item.toolName,
  outcome: record.outcome,
  reason: record.reason,
  selection: record.selection,
  violations: record.violations ?? null,
  execution: record.execution ?? null,
  observationChanged: record.observation?.changed ?? null,
  client: record.client,
  judge: record.judge,
  seed: record.seed ?? null,
  startedAt: record.trial.startedAt,
  sessionMeta,
});

export const runSessionSweep = async ({
  fixture,
  judge,
  url,
  session = 1,
  sessionMeta = null,
  repeatsPerSession = 1,
  tools = null,
  includeControls = true,
  concurrency = 1,
  port,
  checkpointPath,
  failureLogPath = null,
  /**
   * Generous on purpose: the judge alone may take 60s, and a trial is a navigation,
   * a manifest settle, a judge call and an execution. The observed median is under
   * ten seconds, so this catches stalls rather than slow work.
   */
  trialTimeoutMs = 180000,
  onProgress = () => {},
}) => {
  const plan = buildPlan({ fixture, repeatsPerSession, tools, includeControls });
  const { keys: done } = checkpointPath
    ? await readCheckpoint(checkpointPath)
    : { keys: new Set() };
  const pending = plan.filter(
    (item) => !done.has(trialKey(session, item.repeat, item.utterance.id))
  );

  if (checkpointPath) await mkdir(dirname(checkpointPath), { recursive: true });

  const written = [];
  const failures = [];
  let completed = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < pending.length) {
      const item = pending[cursor];
      cursor += 1;

      // Recorded the moment it happens, not at the end of the session: a killed
      // process must not take the reason with it.
      const recordFailure = async (failure) => {
        failures.push(failure);
        await appendFailures(failureLogPath, [failure]).catch(() => {});
      };

      let tab;
      try {
        // The work is started as its own promise so the deadline can stop *waiting*
        // for it. Abandoned work still settles later, and its rejection must not
        // reach the process as an unhandled one, hence the bare catch.
        const attempt = (async () => {
          tab = await openSession({ port });
          return runTrial({
            session: tab,
            judge,
            url,
            toolName: item.toolName,
            utterance: item.utterance,
            expectation: item.kind === 'tool' ? item.utterance : {},
            setup: item.setup,
            fixtureVersion: fixture.version,
            controlMode: item.kind === 'control',
          });
        })();
        attempt.catch(() => {});

        const record = await withDeadline(
          attempt,
          trialTimeoutMs,
          `trial ${item.utterance.id} (session ${session}, repeat ${item.repeat})`
        );

        if (record.outcome === null) {
          // The trial ran but produced no measurement - an unreachable or truncated
          // judge says nothing about the page. It stays out of the checkpoint so a
          // later --resume retries it instead of baking a non-result into the rates.
          await recordFailure({
            session,
            repeat: item.repeat,
            utteranceId: item.utterance.id,
            kind: record.harnessFailure?.kind ?? 'unknown',
            error: record.harnessFailure?.detail ?? 'no outcome and no reason given',
          });
        } else {
          const checkpointRecord = toCheckpointRecord({ item, record, session, sessionMeta });
          written.push(checkpointRecord);
          if (checkpointPath) {
            await appendFile(checkpointPath, `${JSON.stringify(checkpointRecord)}\n`, 'utf8');
          }
        }
      } catch (error) {
        await recordFailure({
          session,
          repeat: item.repeat,
          utteranceId: item.utterance.id,
          kind: error.code === 'DEADLINE' ? 'trial_timeout' : 'trial_threw',
          error: String(error.message ?? error),
        });
      } finally {
        if (tab) await tab.close().catch(() => {});
      }

      completed += 1;
      onProgress({ completed, total: pending.length, item, session, failures: failures.length });
    }
  };

  const startedMs = Date.now();
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));

  return {
    session,
    written,
    failures,
    plan: { total: plan.length, attempted: pending.length },
    elapsedMs: Date.now() - startedMs,
  };
};
