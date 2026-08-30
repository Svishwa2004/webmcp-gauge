import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintManifest } from '../../core/lint.mjs';
import { composeVariant, diffVariant, variantNames } from './compose.mjs';

const toolsFile = JSON.parse(await readFile(new URL('./tools.json', import.meta.url), 'utf8'));

const ablationNames = Object.keys(toolsFile.ablations).filter(
  (key) => Array.isArray(toolsFile.ablations[key]?.tools)
);

const manifestOf = (name) => ({
  present: true,
  settled: true,
  tools: composeVariant(toolsFile, name).map(({ name: toolName, description, inputSchema, annotations }) => ({
    name: toolName,
    description,
    inputSchema,
    annotations,
  })),
});

test('the fixture declares the four ablation families the first sweep confounded', () => {
  assert.deepEqual(ablationNames.sort(), [
    'ablate-duplicate-tool',
    'ablate-near-duplicate',
    'ablate-schema',
    'ablate-thin',
  ]);
  assert.deepEqual(variantNames(toolsFile).sort(), ['clean', 'degraded', ...ablationNames].sort());
});

test('every ablation changes exactly the tools it declares and nothing else', () => {
  const clean = toolsFile.variants.clean;

  for (const name of ablationNames) {
    const ablation = toolsFile.ablations[name];
    const diff = diffVariant(clean, composeVariant(toolsFile, name));

    assert.deepEqual(diff.changed.sort(), [...ablation.changes].sort(), `${name} changed the wrong tools`);
    assert.deepEqual(diff.added.sort(), [...ablation.adds].sort(), `${name} added the wrong tools`);
    assert.deepEqual(diff.removed, [], `${name} removed a tool, which no ablation should`);
    assert.ok(
      diff.changed.length + diff.added.length > 0,
      `${name} is identical to clean, so it measures nothing`
    );
  }
});

test('each ablation trips its own linter family and no other', () => {
  for (const name of ablationNames) {
    const { family } = toolsFile.ablations[name];
    const result = lintManifest({ manifest: manifestOf(name) });
    const fired = new Set(result.findings.map((finding) => finding.rule));

    assert.ok(fired.has(family), `${name} should trip ${family}, fired ${[...fired].join(', ') || 'nothing'}`);

    // Rules within the same family are allowed to co-fire (an over-parameterised
    // schema also has undocumented properties); rules from another family are not,
    // or the ablation is not isolating anything.
    const foreign = [...fired].filter(
      (rule) => rule.split('/')[0] !== family.split('/')[0]
    );
    assert.deepEqual(foreign, [], `${name} also tripped ${foreign.join(', ')}`);
  }
});

test('every ablation records the question it answers and a prediction made before the run', () => {
  for (const name of ablationNames) {
    const ablation = toolsFile.ablations[name];
    assert.ok(ablation.question?.length > 20, `${name} has no question`);
    assert.ok(ablation.prediction?.length > 40, `${name} has no prediction`);
    assert.ok(Array.isArray(ablation.measure) && ablation.measure.length > 0, `${name} names no tools to measure`);
    for (const tool of [...ablation.measure, ...ablation.changes]) {
      assert.ok(
        toolsFile.variants.clean.some((candidate) => candidate.name === tool),
        `${name} names ${tool}, which the clean variant does not register`
      );
    }
  }
});

test('a version bump carries its reason, and the published variants stay put', () => {
  const versions = toolsFile.revisions.map((revision) => revision.version);
  assert.equal(versions.at(-1), toolsFile.version, 'the newest revision must describe the current version');
  assert.equal(new Set(versions).size, versions.length);
  for (const revision of toolsFile.revisions) {
    assert.ok(revision.date, `revision ${revision.version} has no date`);
    assert.ok(revision.change?.length > 20, `revision ${revision.version} does not say what changed`);
  }

  // The 1.0.0 arms are published numbers. If either variant is edited, the reports
  // in reports/ stop describing what this file registers.
  assert.equal(toolsFile.variants.clean.length, 7);
  assert.equal(toolsFile.variants.degraded.length, 10);
  assert.equal(
    toolsFile.variants.degraded.filter((tool) => tool.name === 'Clear Highlights').length,
    1,
    'the degraded arm must keep the space-named tool: Chrome refuses it, and that is the #145 measurement'
  );
});

test('an unknown variant composes to nothing rather than to a default', () => {
  assert.equal(composeVariant(toolsFile, 'no-such-variant'), null);
  assert.equal(composeVariant({}, 'clean'), null);
});
