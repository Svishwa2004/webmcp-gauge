/**
 * The sweep: every utterance, R times, one fresh tab per trial.
 *
 * A fresh tab per trial is the expensive choice and the correct one - reusing a
 * tab means trial N's highlighting is trial N+1's starting state, and the number
 * then measures the order of the utterance file.
 *
 * Every completed trial is appended to a JSONL checkpoint before the next one
 * starts, so a 480-trial run that dies at 300 loses nothing and resumes.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { openSession } from '../browser/session.mjs';
import { runTrial } from './trial.mjs';

const trialKey = (repeat, utteranceId) => `${repeat}:${utteranceId}`;

export const readCheckpoint = async (path) => {
  try {
    const text = await readFile(path, 'utf8');
    const records = text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    return { records, keys: new Set(records.map((r) => trialKey(r.repeat, r.utteranceId))) };
  } catch (error) {
    if (error.code === 'ENOENT') return { records: [], keys: new Set() };
    throw error;
  }
};

/** Flattens the fixture into the trial plan, controls included, R repeats deep. */
export const buildPlan = ({ fixture, repeats, tools = null, includeControls = true }) => {
  const plan = [];

  for (let repeat = 1; repeat <= repeats; repeat += 1) {
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

const toCheckpointRecord = (item, record) => ({
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
});

/**
 * Runs the plan with bounded concurrency. Tabs are independent documents, so
 * parallel trials do not share page state; what they do share is CPU and the
 * judge's rate limit, so the concurrency used is recorded in the report - settle
 * timings are not comparable across different values.
 */
export const runSweep = async ({
  fixture,
  judge,
  url,
  repeats = 3,
  tools = null,
  includeControls = true,
  concurrency = 1,
  port,
  checkpointPath,
  onProgress = () => {},
}) => {
  const plan = buildPlan({ fixture, repeats, tools, includeControls });
  const { records: existing, keys: done } = checkpointPath
    ? await readCheckpoint(checkpointPath)
    : { records: [], keys: new Set() };
  const pending = plan.filter((item) => !done.has(trialKey(item.repeat, item.utterance.id)));

  if (checkpointPath) await mkdir(dirname(checkpointPath), { recursive: true });

  const collected = [...existing];
  const failures = [];
  let completed = 0;
  let cursor = 0;

  const worker = async (workerIndex) => {
    while (cursor < pending.length) {
      const item = pending[cursor];
      cursor += 1;

      let session;
      try {
        session = await openSession({ port });
        const record = await runTrial({
          session,
          judge,
          url,
          toolName: item.toolName,
          utterance: item.utterance,
          expectation: item.kind === 'tool' ? item.utterance : {},
          setup: item.setup,
          fixtureVersion: fixture.version,
          controlMode: item.kind === 'control',
        });

        if (record.outcome === null) {
          // The trial ran but produced no measurement - an unreachable or truncated
          // judge says nothing about the page. It stays out of the checkpoint so a
          // later --resume retries it instead of baking a non-result into the rates.
          failures.push({
            repeat: item.repeat,
            utteranceId: item.utterance.id,
            kind: record.harnessFailure?.kind ?? 'unknown',
            error: record.harnessFailure?.detail ?? 'no outcome and no reason given',
          });
        } else {
          const checkpointRecord = toCheckpointRecord(item, record);
          collected.push(checkpointRecord);
          if (checkpointPath) {
            await appendFile(checkpointPath, `${JSON.stringify(checkpointRecord)}\n`, 'utf8');
          }
        }
      } catch (error) {
        // A trial that could not be run is not an outcome: recording it as one
        // would put harness failures inside the measurement.
        failures.push({
          repeat: item.repeat,
          utteranceId: item.utterance.id,
          kind: 'trial_threw',
          error: String(error.message ?? error),
        });
      } finally {
        if (session) await session.close().catch(() => {});
      }

      completed += 1;
      onProgress({ completed, total: pending.length, item, workerIndex, failures: failures.length });
    }
  };

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, (_, index) => worker(index))
  );

  return {
    records: collected,
    failures,
    plan: { total: plan.length, alreadyDone: existing.length, attempted: pending.length },
    timing: { startedAt, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - startedMs },
    settings: { repeats, concurrency, tools, includeControls, url, port: port ?? null },
  };
};
