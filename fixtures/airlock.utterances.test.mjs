import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const fixture = JSON.parse(
  await readFile(new URL('./airlock.utterances.json', import.meta.url), 'utf8')
);

// Verified live against Chrome 152.0.7977.65 on 2026-08-30, and against
// airlock/src/tools.ts. A mismatch means the subject changed under the fixture.
const TOOL_ARG_KEYS = {
  describe_dataset: [],
  sum_by_category: ['highlight'],
  filter_rows: ['from', 'to', 'category', 'min_amount', 'max_amount', 'limit'],
  monthly_trend: [],
  find_anomalies: ['threshold'],
  top_expenses: ['limit'],
  clear_highlights: [],
};

const TAGS = new Set(['plain', 'paraphrase', 'oblique']);
const CONTROL_TAGS = new Set(['off_topic', 'out_of_scope', 'injection']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const { categories, dateRange } = fixture.subject.dataset;
const allUtterances = fixture.tools.flatMap((tool) =>
  tool.utterances.map((utterance) => ({ tool: tool.name, ...utterance }))
);
const controls = fixture.controls.utterances;
const everyUtterance = [...allUtterances, ...controls];

test('covers exactly the tools the subject registers', () => {
  assert.deepEqual(
    fixture.tools.map((t) => t.name).sort(),
    Object.keys(TOOL_ARG_KEYS).sort()
  );
  assert.equal(fixture.tools.length, fixture.subject.toolCount);
});

test('every tool carries the declared number of utterances', () => {
  for (const tool of fixture.tools) {
    assert.equal(
      tool.utterances.length,
      fixture.conventions.utterancesPerTool,
      `${tool.name} has ${tool.utterances.length}`
    );
  }
});

test('every tool carries the identical tag mix, or per-tool rates are not comparable', () => {
  for (const tool of fixture.tools) {
    const mix = tool.utterances.reduce((acc, u) => ({ ...acc, [u.tag]: (acc[u.tag] ?? 0) + 1 }), {});
    for (const [tag, expected] of Object.entries(fixture.conventions.tagMix)) {
      assert.equal(mix[tag] ?? 0, expected, `${tool.name} has ${mix[tag] ?? 0} ${tag}, expected ${expected}`);
    }
  }
});

test('the declared tag mix sums to the per-tool utterance count', () => {
  const total = Object.values(fixture.conventions.tagMix).reduce((a, b) => a + b, 0);
  assert.equal(total, fixture.conventions.utterancesPerTool);
});

test('argument constraints are directional, numeric, and back a required key', () => {
  const operators = new Set(['gt', 'gte', 'lt', 'lte']);
  for (const { tool, id, argConstraints, requiredArgKeys, expectedArgs } of allUtterances) {
    if (argConstraints === undefined) continue;
    for (const [key, constraint] of Object.entries(argConstraints)) {
      assert.ok(TOOL_ARG_KEYS[tool].includes(key), `${id} constrains unknown arg ${key}`);
      assert.ok(
        (requiredArgKeys ?? []).includes(key),
        `${id} constrains ${key} without requiring it — presence must be checked too`
      );
      assert.ok(
        !(key in (expectedArgs ?? {})),
        `${id} both pins and constrains ${key}; pick one`
      );
      const entries = Object.entries(constraint);
      assert.ok(entries.length > 0, `${id} has an empty constraint on ${key}`);
      for (const [operator, value] of entries) {
        assert.ok(operators.has(operator), `${id} uses unknown operator ${operator}`);
        assert.equal(typeof value, 'number', `${id} constrains ${key} with a non-number`);
      }
    }
  }
});

test('a tool whose utterances presuppose state declares how to seed it', () => {
  const clearHighlights = fixture.tools.find((t) => t.name === 'clear_highlights');
  assert.ok(
    clearHighlights.setup?.seedState,
    'clear_highlights utterances refer to existing highlighting, which fresh-context trials will not have'
  );

  for (const tool of fixture.tools) {
    if (tool.setup === undefined) continue;
    assert.equal(typeof tool.setup.seedState, 'string');
    const seed = tool.setup.seedCall;
    assert.ok(seed, `${tool.name} declares seedState without a seedCall`);
    assert.ok(TOOL_ARG_KEYS[seed.tool], `${tool.name} seeds with unknown tool ${seed.tool}`);
    assert.notEqual(seed.tool, tool.name, `${tool.name} cannot seed itself`);
    for (const key of Object.keys(seed.args ?? {})) {
      assert.ok(
        TOOL_ARG_KEYS[seed.tool].includes(key),
        `${tool.name} seed passes unknown arg ${key} to ${seed.tool}`
      );
    }
  }
});

test('ids are unique, prefixed by tool and numbered from 01', () => {
  const seen = new Set();
  for (const tool of fixture.tools) {
    tool.utterances.forEach((utterance, index) => {
      const expected = `${tool.name}-${String(index + 1).padStart(2, '0')}`;
      assert.equal(utterance.id, expected);
      assert.ok(!seen.has(utterance.id), `duplicate id ${utterance.id}`);
      seen.add(utterance.id);
    });
  }
});

test('utterance texts are non-empty and unique across the whole set, controls included', () => {
  const seen = new Map();
  for (const { id, text } of everyUtterance) {
    assert.ok(typeof text === 'string' && text.trim().length > 0, `${id} has no text`);
    const key = text.trim().toLowerCase();
    assert.ok(!seen.has(key), `${id} duplicates ${seen.get(key)}`);
    seen.set(key, id);
  }
});

test('no utterance leaks a tool name — that would measure copying, not selection', () => {
  for (const { id, text } of everyUtterance) {
    for (const name of Object.keys(TOOL_ARG_KEYS)) {
      assert.ok(!text.toLowerCase().includes(name), `${id} contains the tool name ${name}`);
      assert.ok(
        !text.toLowerCase().includes(name.replace(/_/g, ' ')),
        `${id} contains the tool name ${name} with spaces`
      );
    }
  }
});

test('tags come from the declared vocabulary', () => {
  for (const { id, tag } of allUtterances) {
    assert.ok(TAGS.has(tag), `${id} has tag ${tag}`);
  }
});

test('expected and required argument keys exist in the tool schema', () => {
  for (const { tool, id, expectedArgs, requiredArgKeys } of allUtterances) {
    const allowed = TOOL_ARG_KEYS[tool];
    for (const key of Object.keys(expectedArgs ?? {})) {
      assert.ok(allowed.includes(key), `${id} expects unknown arg ${key} for ${tool}`);
    }
    for (const key of requiredArgKeys ?? []) {
      assert.ok(allowed.includes(key), `${id} requires unknown arg ${key} for ${tool}`);
      assert.ok(
        !(key in (expectedArgs ?? {})),
        `${id} lists ${key} as both expected and required-only`
      );
    }
  }
});

test('expected category values exist in the dataset', () => {
  for (const { id, expectedArgs } of allUtterances) {
    const category = expectedArgs?.category ?? expectedArgs?.highlight;
    if (category === undefined) continue;
    assert.ok(categories.includes(category), `${id} names unknown category ${category}`);
  }
});

test('expected dates are ISO and inside the dataset range', () => {
  for (const { id, expectedArgs } of allUtterances) {
    for (const key of ['from', 'to']) {
      const value = expectedArgs?.[key];
      if (value === undefined) continue;
      assert.match(value, DATE, `${id} has a non-ISO ${key}`);
      assert.ok(
        value >= dateRange[0] && value <= dateRange[1],
        `${id} ${key}=${value} falls outside ${dateRange[0]}..${dateRange[1]}`
      );
    }
    const { from, to } = expectedArgs ?? {};
    if (from && to) assert.ok(from <= to, `${id} has from after to`);
  }
});

test('numeric bounds are coherent', () => {
  for (const { id, expectedArgs } of allUtterances) {
    const { min_amount: min, max_amount: max, limit, threshold } = expectedArgs ?? {};
    if (min !== undefined && max !== undefined) assert.ok(min < max, `${id} has min >= max`);
    if (limit !== undefined) assert.ok(limit > 0, `${id} has a non-positive limit`);
    if (threshold !== undefined) assert.ok(threshold > 0, `${id} has a non-positive threshold`);
  }
});

test('authoring provenance is recorded before the set can be frozen', () => {
  assert.ok(fixture.authoring.rule.length > 0);
  if (fixture.frozen === true) {
    assert.notEqual(
      fixture.authoring.modelId,
      'UNRECORDED — fill this in',
      'a frozen set must name the authoring model, so a judge can be chosen that differs from it'
    );
    assert.ok(fixture.authoring.reviewedBy, 'a frozen set must record its human reviewer');
  }
});

test('negative controls exist in the declared number and expect no tool', () => {
  assert.equal(fixture.controls.expected, 'no_tool');
  assert.equal(controls.length, fixture.conventions.controlUtterances);
});

test('control ids are unique, numbered from 01, and do not collide with tool utterances', () => {
  const toolIds = new Set(allUtterances.map((u) => u.id));
  controls.forEach((control, index) => {
    assert.equal(control.id, `control-${String(index + 1).padStart(2, '0')}`);
    assert.ok(!toolIds.has(control.id), `${control.id} collides with a tool utterance id`);
  });
});

test('control tags come from the control vocabulary', () => {
  for (const { id, tag } of controls) {
    assert.ok(CONTROL_TAGS.has(tag), `${id} has tag ${tag}`);
  }
});

test('controls carry no argument expectations — there is no tool to pass them to', () => {
  for (const control of controls) {
    assert.equal(control.expectedArgs, undefined, `${control.id} has expectedArgs`);
    assert.equal(control.requiredArgKeys, undefined, `${control.id} has requiredArgKeys`);
  }
});

test('controls cover every control tag, so one failure mode cannot hide behind another', () => {
  const present = new Set(controls.map((c) => c.tag));
  for (const tag of CONTROL_TAGS) {
    assert.ok(present.has(tag), `no control tagged ${tag}`);
  }
});
