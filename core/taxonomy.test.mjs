import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTCOMES,
  checkArguments,
  classifyAfterExecution,
  classifyBeforeExecution,
} from './taxonomy.mjs';

const manifest = {
  present: true,
  tools: [
    {
      name: 'sum_by_category',
      inputSchema: { type: 'object', properties: { highlight: { type: 'string' } } },
    },
    {
      name: 'find_anomalies',
      inputSchema: { type: 'object', properties: { threshold: { type: 'number' } } },
    },
  ],
};

test('the taxonomy is exactly the nine documented outcomes', () => {
  assert.deepEqual(OUTCOMES, [
    'not_supported',
    'not_registered',
    'not_discovered',
    'not_selected',
    'wrong_tool',
    'bad_args',
    'exec_error',
    'silent_fail',
    'ok',
  ]);
});

test('a client with no modelContext is not_supported, not not_registered', () => {
  const verdict = classifyBeforeExecution({
    manifest: { present: false },
    expectedTool: 'sum_by_category',
    selection: { tool: 'sum_by_category' },
  });
  assert.equal(verdict.outcome, 'not_supported');
});

test('an empty or mismatched page manifest is not_registered', () => {
  assert.equal(
    classifyBeforeExecution({
      manifest: { present: true, tools: [] },
      expectedTool: 'sum_by_category',
      selection: null,
    }).outcome,
    'not_registered'
  );

  assert.equal(
    classifyBeforeExecution({
      manifest,
      expectedTool: 'top_expenses',
      selection: { tool: 'top_expenses' },
    }).outcome,
    'not_registered'
  );
});

test('not_discovered needs the browser view, and is never guessed without it', () => {
  const withoutBrowserView = classifyBeforeExecution({
    manifest,
    expectedTool: 'sum_by_category',
    selection: { tool: 'sum_by_category', arguments: {} },
  });
  assert.equal(withoutBrowserView, null, 'proceeds to execution rather than inventing a diagnosis');

  const withBrowserView = classifyBeforeExecution({
    manifest,
    expectedTool: 'sum_by_category',
    selection: { tool: 'sum_by_category', arguments: {} },
    browserToolNames: ['find_anomalies'],
  });
  assert.equal(withBrowserView.outcome, 'not_discovered');
});

test('no selection is not_selected, another tool is wrong_tool', () => {
  assert.equal(
    classifyBeforeExecution({ manifest, expectedTool: 'sum_by_category', selection: null }).outcome,
    'not_selected'
  );
  assert.equal(
    classifyBeforeExecution({
      manifest,
      expectedTool: 'sum_by_category',
      selection: { tool: 'find_anomalies', arguments: {} },
    }).outcome,
    'wrong_tool'
  );
});

test('expected argument values must match, and misses are bad_args', () => {
  const verdict = classifyBeforeExecution({
    manifest,
    expectedTool: 'sum_by_category',
    selection: { tool: 'sum_by_category', arguments: { highlight: 'Dining' } },
    expectation: { expectedArgs: { highlight: 'Groceries' } },
  });
  assert.equal(verdict.outcome, 'bad_args');
  assert.equal(verdict.violations[0].kind, 'wrong_value');
});

test('a forbidden argument is over-reach, not a near miss', () => {
  const verdict = classifyBeforeExecution({
    manifest,
    expectedTool: 'sum_by_category',
    selection: { tool: 'sum_by_category', arguments: { highlight: 'Dining' } },
    expectation: { forbiddenArgKeys: ['highlight'] },
  });
  assert.equal(verdict.outcome, 'bad_args');
  assert.equal(verdict.violations[0].kind, 'forbidden_key');
});

test('constraint direction is enforced, so "be stricter" answered lower fails', () => {
  const stricter = { requiredArgKeys: ['threshold'], argConstraints: { threshold: { gt: 2.5 } } };

  assert.equal(
    classifyBeforeExecution({
      manifest,
      expectedTool: 'find_anomalies',
      selection: { tool: 'find_anomalies', arguments: { threshold: 1 } },
      expectation: stricter,
    }).violations[0].kind,
    'constraint_violated'
  );

  assert.equal(
    classifyBeforeExecution({
      manifest,
      expectedTool: 'find_anomalies',
      selection: { tool: 'find_anomalies', arguments: { threshold: 4 } },
      expectation: stricter,
    }),
    null
  );
});

test('arguments outside the tool schema are rejected', () => {
  const { valid, violations } = checkArguments({
    args: { nonsense: 1 },
    inputSchema: manifest.tools[0].inputSchema,
  });
  assert.equal(valid, false);
  assert.equal(violations[0].kind, 'unknown_key');
});

test('a missing required key is reported even when nothing else is expected', () => {
  const { violations } = checkArguments({
    args: {},
    expectation: { requiredArgKeys: ['threshold'] },
    inputSchema: manifest.tools[1].inputSchema,
  });
  assert.deepEqual(violations, [{ kind: 'missing_required_key', key: 'threshold' }]);
});

test('a throwing call is exec_error', () => {
  assert.equal(
    classifyAfterExecution({ execution: { ok: false, error: 'boom' } }).outcome,
    'exec_error'
  );
});

test('silent_fail needs both an empty result and an unchanged page', () => {
  const unchanged = { highlightClass: '' };

  assert.equal(
    classifyAfterExecution({ execution: { ok: true, result: null }, before: unchanged, after: unchanged })
      .outcome,
    'silent_fail'
  );

  // A read-only tool legitimately changes no DOM, so a payload alone is enough.
  assert.equal(
    classifyAfterExecution({
      execution: { ok: true, result: { totals: [] } },
      before: unchanged,
      after: unchanged,
    }).outcome,
    'ok'
  );

  // And an empty payload with a visible change is a real effect.
  assert.equal(
    classifyAfterExecution({
      execution: { ok: true, result: null },
      before: unchanged,
      after: { highlightClass: 'has-highlight' },
    }).outcome,
    'ok'
  );
});
