import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS, lintManifest, lintToText, RULES, similarity } from './lint.mjs';

const toolsFile = JSON.parse(
  await readFile(new URL('../fixtures/broken/tools.json', import.meta.url), 'utf8')
);

/** The linter reads a manifest, so a variant from the fixture file is one directly. */
const manifestOf = (variant) => ({
  present: true,
  settled: true,
  settledAtMs: 1000,
  tools: toolsFile.variants[variant].map(({ name, description, inputSchema, annotations }) => ({
    name,
    description,
    inputSchema,
    annotations,
  })),
});

const rulesFired = (result) => new Set(result.findings.map((finding) => finding.rule));

test('the reference-quality manifest lints clean, which is what calibrates the defaults', () => {
  const result = lintManifest({ manifest: manifestOf('clean') });

  assert.deepEqual(
    result.findings,
    [],
    `a default that flags the page measured at 100% is a broken default. Fired: ${JSON.stringify(result.findings.map((f) => `${f.rule}:${f.tool}`))}`
  );
  assert.equal(result.counts.error, 0);
  assert.equal(result.counts.warning, 0);
  assert.equal(result.manifest.toolCount, 7);
});

test('the degraded manifest trips every documented failure family except budget', () => {
  const result = lintManifest({ manifest: manifestOf('degraded') });

  // Budget needs a tool count the sweep page deliberately does not have; it is
  // reached with ?flood=N and tested separately below.
  assert.deepEqual(result.families.sort(), ['description', 'name', 'schema']);
  assert.ok(result.counts.error > 0, 'a page this bad must produce errors, not only advice');
});

test('each defect registered in the fixture fires the rule it claims to', () => {
  const fired = rulesFired(lintManifest({ manifest: manifestOf('degraded') }));

  // fixtures/broken/tools.json records, per injected defect, which rules it should
  // trip. That register is the fixture's contract with the linter: if a defect
  // stops firing its rule, one of the two changed silently.
  const claimed = new Set(
    toolsFile.defects.flatMap((defect) => defect.rules).filter((rule) => !rule.startsWith('budget/'))
  );
  assert.ok(claimed.size >= 6, 'the fixture should claim a spread of rules, not one');

  for (const rule of claimed) {
    assert.ok(fired.has(rule), `fixture claims ${rule} but the linter did not report it`);
  }
});

test('an invalid name is reported with the character that makes it invalid', () => {
  const result = lintManifest({
    manifest: { present: true, settled: true, tools: [{ name: 'Clear Highlights', description: 'x'.repeat(80), inputSchema: { type: 'object', properties: {} } }] },
  });

  const finding = result.findings.find((entry) => entry.rule === 'name/invalid-characters');
  assert.ok(finding, 'a name with a space must be flagged');
  assert.match(finding.detail, /a space/);
  assert.equal(finding.severity, 'error');
});

test('two tools with one name are reported, because only one of them is reachable', () => {
  const tool = {
    name: 'filter_rows',
    description: 'A'.repeat(80),
    inputSchema: { type: 'object', properties: {} },
  };
  const result = lintManifest({ manifest: { present: true, settled: true, tools: [tool, { ...tool, description: 'B'.repeat(80) }] } });

  assert.equal(result.findings.filter((entry) => entry.rule === 'name/duplicate').length, 1);
});

test('identical descriptions are an error and near-identical ones a warning', () => {
  const identical = lintManifest({
    manifest: {
      present: true,
      settled: true,
      tools: [
        { name: 'a_tool', description: 'Works with the rows in the table and returns totals for what it finds.', inputSchema: { type: 'object', properties: {} } },
        { name: 'b_tool', description: 'Works with the rows in the table and returns totals for what it finds.', inputSchema: { type: 'object', properties: {} } },
      ],
    },
  });
  const duplicate = identical.findings.find((entry) => entry.rule === 'description/duplicate');
  assert.ok(duplicate);
  assert.equal(duplicate.severity, 'error');
  assert.equal(duplicate.tool, 'a_tool + b_tool');

  const near = lintManifest({
    manifest: {
      present: true,
      settled: true,
      tools: [
        { name: 'a_tool', description: 'Works with the rows in the table and returns totals for what it finds.', inputSchema: { type: 'object', properties: {} } },
        { name: 'b_tool', description: 'Works with the rows in the table and returns counts for what it finds.', inputSchema: { type: 'object', properties: {} } },
      ],
    },
  });
  const nearFinding = near.findings.find((entry) => entry.rule === 'description/near-duplicate');
  assert.ok(nearFinding, 'one changed word must not make two descriptions distinguishable');
  assert.equal(nearFinding.severity, 'warning');
  assert.equal(near.findings.some((entry) => entry.rule === 'description/duplicate'), false);
});

test('two genuinely different descriptions of the same length are left alone', () => {
  const result = lintManifest({
    manifest: {
      present: true,
      settled: true,
      tools: [
        { name: 'a_tool', description: 'Total the loaded spending per calendar month, oldest first, so month-on-month changes are visible.', inputSchema: { type: 'object', properties: {} } },
        { name: 'b_tool', description: 'Find rows that are unusually large compared with the rest of their own category, using a z-score.', inputSchema: { type: 'object', properties: {} } },
      ],
    },
  });

  assert.deepEqual(result.findings, []);
});

/**
 * `description/indistinguishable-pair`, adopted 2026-09-05 after five measured arms
 * showed a 45-point loss that no description-similarity threshold catches. These
 * tests pin the two halves of the rule and, more importantly, the cases it must
 * stay silent on — each of which is a manifest with a measured rate at or near the
 * ceiling, so a false positive here would be a rule that flags working pages.
 */
const pairPresent = (result) =>
  result.findings.some((entry) => entry.rule === 'description/indistinguishable-pair');

const twoTools = (aName, aDescription, bName, bDescription, options) =>
  lintManifest({
    manifest: {
      present: true,
      settled: true,
      tools: [
        { name: aName, description: aDescription, inputSchema: { type: 'object', properties: {} } },
        { name: bName, description: bDescription, inputSchema: { type: 'object', properties: {} } },
      ],
    },
    options,
  });

const VAGUE = 'Works with the rows in the table and returns totals for what it finds.';
const ALSO_VAGUE = 'Handles the listed entries and hands back combined figures for whatever turns up.';
const INFORMATIVE = 'Total the loaded spending by category, largest first, and return aggregates only.';

test('close names plus two descriptions that never say which tool is which is a warning', () => {
  const result = twoTools('sum_by_category', VAGUE, 'summarise_by_category', ALSO_VAGUE);
  const finding = result.findings.find((entry) => entry.rule === 'description/indistinguishable-pair');

  assert.ok(finding, 'this is the configuration measured at 48–58% against a 95% baseline');
  assert.equal(finding.severity, 'warning');
  assert.equal(finding.tool, 'sum_by_category + summarise_by_category');
  assert.equal(finding.evidence.nameSimilarity, 0.5);
  // It must not need the two descriptions to resemble each other: these two share
  // almost nothing, which is exactly the case the similarity rules cannot see.
  assert.ok(similarity(VAGUE, ALSO_VAGUE) < DEFAULT_OPTIONS.nearDuplicateThreshold);
  assert.equal(result.findings.some((entry) => entry.rule === 'description/near-duplicate'), false);
});

test('one description that says what its own tool is for is enough to stay silent', () => {
  // Measured: `ablate-competitor-vague` — a vague competitor beside a well-described
  // tool — cost nothing at all (95.0%, identical to clean failure for failure).
  assert.equal(pairPresent(twoTools('sum_by_category', INFORMATIVE, 'summarise_by_category', VAGUE)), false);
  assert.equal(pairPresent(twoTools('sum_by_category', VAGUE, 'summarise_by_category', INFORMATIVE)), false);
});

test('two vague descriptions on unrelated names are not this rule\'s business', () => {
  // Measured: `ablate-desc-degraded` — vague descriptions with no close-named
  // sibling — cost 1.7 points, inside the harness's own noise.
  assert.equal(pairPresent(twoTools('sum_by_category', VAGUE, 'clear_highlights', ALSO_VAGUE)), false);
});

test('the name-similarity threshold is an option, and the rule follows it', () => {
  const names = ['fetch_orders', VAGUE, 'orders_report', ALSO_VAGUE];
  assert.equal(pairPresent(twoTools(...names)), false, 'these names share one token of three');
  assert.equal(pairPresent(twoTools(...names, { nameSimilarityThreshold: 0.3 })), true);
});

test('the rule reports presence, not cost — it cannot know what a pair will cost', () => {
  // The five measured rungs span 48.3% to 83.3% and the rule fires identically on
  // all of them. That is deliberate: severity is a property of the rule, and only
  // `run` measures what a defect costs.
  const identical = twoTools('sum_by_category', VAGUE, 'summarise_by_category', VAGUE);
  const distant = twoTools('sum_by_category', VAGUE, 'summarise_by_category', ALSO_VAGUE);
  const pairOf = (result) => result.findings.find((entry) => entry.rule === 'description/indistinguishable-pair');

  assert.equal(pairOf(identical).severity, pairOf(distant).severity);
  // The byte-identical case additionally trips the error-graded duplicate rule, so
  // the two rules stack rather than replace one another.
  assert.equal(identical.findings.some((entry) => entry.rule === 'description/duplicate'), true);
  assert.equal(distant.findings.some((entry) => entry.rule === 'description/duplicate'), false);
});

test('a required property with no description is an error, an optional one a warning', () => {
  const result = lintManifest({
    manifest: {
      present: true,
      settled: true,
      tools: [
        {
          name: 'top_expenses',
          description: 'D'.repeat(80),
          inputSchema: {
            type: 'object',
            required: ['mode'],
            properties: { mode: { type: 'string' }, locale: { type: 'string' } },
          },
        },
      ],
    },
  });

  const required = result.findings.find((entry) => entry.rule === 'schema/required-without-description');
  const optional = result.findings.find((entry) => entry.rule === 'schema/undocumented-property');
  assert.equal(required.severity, 'error');
  assert.match(required.detail, /must guess/);
  assert.match(optional.detail, /'locale'/);
});

test('a required property that is not declared at all is reported', () => {
  const result = lintManifest({
    manifest: {
      present: true,
      settled: true,
      tools: [{ name: 'a_tool', description: 'D'.repeat(80), inputSchema: { type: 'object', required: ['ghost'], properties: {} } }],
    },
  });

  assert.match(
    result.findings.find((entry) => entry.rule === 'schema/required-without-description').detail,
    /not declared in properties/
  );
});

test('a non-object schema stops schema analysis for that tool rather than throwing', () => {
  const result = lintManifest({
    manifest: {
      present: true,
      settled: true,
      tools: [{ name: 'top.expenses.v2', description: 'D'.repeat(80), inputSchema: { type: 'string' } }],
    },
  });

  assert.equal(result.findings.filter((entry) => entry.rule.startsWith('schema/')).length, 1);
  assert.equal(result.findings.find((entry) => entry.rule === 'schema/not-object').severity, 'error');
});

test('the property-count threshold sits exactly where the reference page does', () => {
  const propertiesOf = (count) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`p${index}`, { type: 'string', description: 'documented' }])
    );
  const at = lintManifest({
    manifest: { present: true, settled: true, tools: [{ name: 'a_tool', description: 'D'.repeat(80), inputSchema: { type: 'object', properties: propertiesOf(DEFAULT_OPTIONS.maxProperties) } }] },
  });
  const over = lintManifest({
    manifest: { present: true, settled: true, tools: [{ name: 'a_tool', description: 'D'.repeat(80), inputSchema: { type: 'object', properties: propertiesOf(DEFAULT_OPTIONS.maxProperties + 1) } }] },
  });

  assert.deepEqual(at.findings, [], 'six properties is what the reference page ships and it invokes at 99.2%');
  assert.equal(over.findings.filter((entry) => entry.rule === 'schema/over-parameterised').length, 1);
});

test('budget headroom warns well below the count that has been reported to break a page, and stays a warning at it', () => {
  const manifestWith = (count) => ({
    present: true,
    settled: true,
    tools: Array.from({ length: count }, (_, index) => ({
      name: `filler_tool_${index}`,
      description: 'A filler tool registered only to occupy a slot in this manifest.',
      inputSchema: { type: 'object', properties: {} },
    })),
  });

  assert.equal(
    lintManifest({ manifest: manifestWith(DEFAULT_OPTIONS.budgetWarnAt - 1) }).findings.some((entry) => entry.rule === 'budget/headroom'),
    false
  );
  const warned = lintManifest({ manifest: manifestWith(DEFAULT_OPTIONS.budgetWarnAt) }).findings.find((entry) => entry.rule === 'budget/headroom');
  assert.equal(warned.severity, 'warning');
  assert.match(warned.detail, /headroom here is unknown rather than fine/);

  // Chrome 152 registered and surfaced all 507 tools of a flooded fixture (measured
  // 2026-08-31), so the 296 field report is an unknown rather than a ceiling. An
  // error here would be the false positive the calibrated defaults exist to prevent.
  const atReported = lintManifest({ manifest: manifestWith(DEFAULT_OPTIONS.budgetBreakAt) }).findings.find((entry) => entry.rule === 'budget/headroom');
  assert.equal(atReported.severity, 'warning');
  assert.match(atReported.detail, /does not reproduce on Chrome 152/);
});

test('thresholds are options, so a project can set its own and still be reported', () => {
  const manifest = {
    present: true,
    settled: true,
    tools: [{ name: 'a_tool', description: 'Short one.', inputSchema: { type: 'object', properties: {} } }],
  };

  assert.equal(lintManifest({ manifest }).findings.some((entry) => entry.rule === 'description/thin'), true);
  assert.equal(
    lintManifest({ manifest, options: { minDescriptionChars: 5 } }).findings.some((entry) => entry.rule === 'description/thin'),
    false
  );
  assert.equal(lintManifest({ manifest, options: { minDescriptionChars: 5 } }).thresholds.minDescriptionChars, 5);
});

test('similarity is symmetric, 1 for identical text and 0 against nothing', () => {
  assert.equal(similarity('a b c', 'c b a'), 1);
  assert.equal(similarity('a b c', ''), 0);
  assert.equal(similarity('one two', 'two three'), similarity('two three', 'one two'));
});

test('every rule in the registry has a severity the emitter can render', () => {
  for (const rule of RULES) {
    assert.ok(['error', 'warning'].includes(rule.severity), `${rule.id} has severity ${rule.severity}`);
    assert.ok(rule.id.includes('/'), `${rule.id} is not family-prefixed`);
  }
  assert.equal(new Set(RULES.map((rule) => rule.id)).size, RULES.length);
});

test('the text report never lets a clean lint read as a measured invocation rate', () => {
  const text = lintToText(lintManifest({ manifest: manifestOf('clean') }), { subject: 'clean' });

  assert.match(text, /No findings/);
  assert.match(text, /A clean lint is not a measured invocation rate/);
});

test('the text report leads with errors and names the thresholds it used', () => {
  const text = lintToText(lintManifest({ manifest: manifestOf('degraded') }), { subject: 'degraded' });
  const firstFindingLine = text.split('\n').find((line) => line.startsWith('ERROR') || line.startsWith('WARN'));

  assert.ok(firstFindingLine.startsWith('ERROR'), `errors must sort first, got ${firstFindingLine}`);
  assert.match(text, /Calibrated on the reference page, not taken from the spec/);
});
