import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../report/emit.mjs';
import { EXIT, gateRun, parseFailUnder } from './gate.mjs';

const fixture = { version: '1.3.0', frozen: true, authoring: { modelId: 'author-model' } };

/**
 * Built through the real emitter rather than hand-shaped, so the gate is tested
 * against the report contract it will actually be handed. A rename in emit.mjs
 * should break these tests loudly instead of leaving the gate reading undefined.
 */
const reportOf = ({ records = [], coverage = null, harnessFailures = [] } = {}) =>
  buildReport({
    fixture,
    records,
    harnessFailures,
    coverage,
    judge: { model: 'judge-model', baseUrl: 'https://example.invalid/v1' },
    settings: { url: 'https://example.invalid/', sessions: 1, repeatsPerSession: 1, concurrency: 1 },
    timing: { startedAt: '2026-08-30T00:00:00.000Z', finishedAt: '2026-08-30T00:01:00.000Z', elapsedMs: 60000 },
  });

const toolTrials = ({ tool, ok, total, session = 1 }) =>
  Array.from({ length: total }, (_, index) => ({
    session,
    repeat: 1,
    kind: 'tool',
    expectedTool: tool,
    utteranceId: `${tool}-${String(index + 1).padStart(2, '0')}`,
    tag: 'plain',
    outcome: index < ok ? 'ok' : 'wrong_tool',
  }));

const complete = (expectedTrials) => ({ expectedTrials, measuredTrials: expectedTrials, missingTrials: 0, missing: [] });

test('a complete run with every tool above the threshold exits 0', () => {
  const verdict = gateRun({
    report: reportOf({
      records: [
        ...toolTrials({ tool: 'top_expenses', ok: 20, total: 20 }),
        ...toolTrials({ tool: 'filter_rows', ok: 19, total: 20 }),
      ],
      coverage: complete(40),
    }),
    failUnder: 0.9,
  });

  assert.equal(verdict.code, EXIT.pass);
  assert.equal(verdict.status, 'pass');
  assert.equal(verdict.gatedTools, 2);
  assert.deepEqual(verdict.breaches, []);
  assert.match(verdict.summary, /^PASS —/);
  assert.match(verdict.summary, /40\/40 planned trials measured/);
});

test('a rate below --fail-under exits 1 and names the tool, its interval and its trial count', () => {
  const verdict = gateRun({
    report: reportOf({
      records: [
        ...toolTrials({ tool: 'top_expenses', ok: 20, total: 20 }),
        ...toolTrials({ tool: 'sum_by_category', ok: 16, total: 20 }),
      ],
      coverage: complete(40),
    }),
    failUnder: 0.9,
  });

  assert.equal(verdict.code, EXIT.breach);
  assert.equal(verdict.status, 'breach');
  assert.equal(verdict.breaches.length, 1);
  assert.equal(verdict.breaches[0].tool, 'sum_by_category');
  assert.equal(verdict.breaches[0].trials, 20);
  assert.match(verdict.summary, /^FAIL —/);
  assert.match(verdict.summary, /sum_by_category` 80\.0% \[\d+\.\d%, \d+\.\d%\] over 20 trials/);
});

test('a breach whose interval still reaches the threshold says so, rather than implying certainty', () => {
  // 17/20 = 85%, and the Wilson upper bound is above 90%, so the breach is inside
  // the noise. Exit 1 is still correct - the measured rate is the measured rate -
  // but a report that hid the overlap would invite a wrong conclusion.
  const verdict = gateRun({
    report: reportOf({ records: toolTrials({ tool: 'filter_rows', ok: 17, total: 20 }), coverage: complete(20) }),
    failUnder: 0.9,
  });

  assert.equal(verdict.code, EXIT.breach);
  assert.ok(verdict.breaches[0].high > 0.9, 'this fixture is only interesting if the interval overlaps');
  assert.match(verdict.summary, /inside the noise at this sample size/);
});

test('the threshold is compared against the point rate, not the Wilson lower bound', () => {
  // 20/20 has a lower bound of 83.9%. Gating on the bound would fail a page that
  // never missed once, purely on sample size, so the point rate is what is gated.
  const report = reportOf({
    records: toolTrials({ tool: 'top_expenses', ok: 20, total: 20 }),
    coverage: complete(20),
  });
  const [tool] = report.invocation.perTool;
  assert.equal(tool.invocation.rate, 1);
  assert.ok(
    tool.invocation.low < 0.9,
    `20/20 has a lower bound of ${tool.invocation.low}; the test is only meaningful while that is under the threshold`
  );

  assert.equal(gateRun({ report, failUnder: 0.9 }).code, EXIT.pass);
});

test('a rate exactly at the threshold passes: below the line is a breach, on it is not', () => {
  const verdict = gateRun({
    report: reportOf({ records: toolTrials({ tool: 'filter_rows', ok: 18, total: 20 }), coverage: complete(20) }),
    failUnder: 0.9,
  });

  assert.equal(verdict.code, EXIT.pass);
});

test('planned trials with no measurement exit 2, however healthy the rates look', () => {
  const verdict = gateRun({
    report: reportOf({
      records: toolTrials({ tool: 'top_expenses', ok: 18, total: 18 }),
      coverage: { expectedTrials: 20, measuredTrials: 18, missingTrials: 2, missing: ['1:1:top_expenses-19', '1:1:top_expenses-20'] },
      harnessFailures: [
        { session: 1, repeat: 1, utteranceId: 'top_expenses-19', kind: 'judge_unavailable', error: 'fetch failed' },
        { session: 1, repeat: 1, utteranceId: 'top_expenses-20', kind: 'trial_threw', error: 'timed out waiting for Page.loadEventFired' },
      ],
    }),
    failUnder: 0.9,
  });

  assert.equal(verdict.code, EXIT.incomplete);
  assert.equal(verdict.status, 'incomplete');
  assert.equal(verdict.missingTrials, 2);
  assert.match(verdict.summary, /2 of 20 planned trials produced no measurement/);
  assert.match(verdict.summary, /judge_unavailable/);
  assert.match(verdict.summary, /not a threshold breach/);
});

test('incomplete outranks a breach: a run with holes cannot certify a regression', () => {
  const verdict = gateRun({
    report: reportOf({
      records: toolTrials({ tool: 'sum_by_category', ok: 10, total: 18 }),
      coverage: { expectedTrials: 20, measuredTrials: 18, missingTrials: 2, missing: [] },
    }),
    failUnder: 0.9,
  });

  assert.equal(verdict.code, EXIT.incomplete);
  // The breach is still recorded - it is the reason to re-run, not a number to publish.
  assert.equal(verdict.breaches.length, 1);
  assert.match(verdict.summary, /with no logged cause/);
});

test('missing trials exit 2 even with no threshold set — the old behaviour was to exit 1', () => {
  const verdict = gateRun({
    report: reportOf({
      records: toolTrials({ tool: 'top_expenses', ok: 19, total: 19 }),
      coverage: { expectedTrials: 20, measuredTrials: 19, missingTrials: 1, missing: ['1:1:top_expenses-20'] },
    }),
  });

  assert.equal(verdict.code, EXIT.incomplete);
  assert.equal(verdict.failUnder, null);
  assert.equal(verdict.gatedTools, 0);
});

test('a complete run with no threshold exits 0 and says nothing was gated', () => {
  const verdict = gateRun({
    report: reportOf({ records: toolTrials({ tool: 'top_expenses', ok: 12, total: 20 }), coverage: complete(20) }),
  });

  assert.equal(verdict.code, EXIT.pass);
  assert.match(verdict.summary, /no --fail-under given, so nothing was gated/);
  assert.deepEqual(verdict.breaches, []);
});

test('an outstanding harness failure exits 2 even when coverage was not computed', () => {
  const verdict = gateRun({
    report: reportOf({
      records: toolTrials({ tool: 'top_expenses', ok: 20, total: 20 }),
      harnessFailures: [{ session: 1, repeat: 1, utteranceId: 'filter_rows-03', kind: 'judge_timeout', error: 'timeout' }],
    }),
    failUnder: 0.9,
  });

  assert.equal(verdict.code, EXIT.incomplete);
  assert.match(verdict.summary, /outside the measured set \(1 judge_timeout\)/);
});

test('a threshold with no tool trials at all exits 2 rather than vacuously passing', () => {
  const verdict = gateRun({ report: reportOf({ coverage: complete(0) }), failUnder: 0.9 });

  assert.equal(verdict.code, EXIT.incomplete);
  assert.match(verdict.summary, /cannot be evaluated/);
});

test('parseFailUnder accepts fractions and refuses percentages, which would fail every build', () => {
  assert.equal(parseFailUnder(undefined), null);
  assert.equal(parseFailUnder(null), null);
  assert.equal(parseFailUnder('0.9'), 0.9);
  assert.equal(parseFailUnder(0), 0);
  assert.equal(parseFailUnder('1'), 1);

  assert.throws(() => parseFailUnder('90'), /use 0\.9, not 90/);
  assert.throws(() => parseFailUnder('101'), RangeError);
  assert.throws(() => parseFailUnder('-0.1'), RangeError);
  assert.throws(() => parseFailUnder('nine tenths'), RangeError);
  assert.throws(() => parseFailUnder(true), /needs a rate/);
});

test('gateRun refuses a nonsensical threshold rather than gating on it', () => {
  assert.throws(() => gateRun({ report: reportOf({ coverage: complete(0) }), failUnder: 90 }), RangeError);
});
