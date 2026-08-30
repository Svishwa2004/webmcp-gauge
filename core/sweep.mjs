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

export const trialKey = (session, repeat, utteranceId) => `${session}:${repeat}:${utteranceId}`;

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

      let tab;
      try {
        tab = await openSession({ port });
        const record = await runTrial({
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

        if (record.outcome === null) {
          // The trial ran but produced no measurement - an unreachable or truncated
          // judge says nothing about the page. It stays out of the checkpoint so a
          // later --resume retries it instead of baking a non-result into the rates.
          failures.push({
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
        failures.push({
          session,
          repeat: item.repeat,
          utteranceId: item.utterance.id,
          kind: 'trial_threw',
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
