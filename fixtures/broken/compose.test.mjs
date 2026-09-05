import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintManifest } from '../../core/lint.mjs';
import { composeVariant, diffVariant, variantNames } from './compose.mjs';

const toolsFile = JSON.parse(await readFile(new URL('./tools.json', import.meta.url), 'utf8'));

const ablationNames = Object.keys(toolsFile.ablations).filter(
  (key) => Array.isArray(toolsFile.ablations[key]?.tools)
);

/**
 * An ablation declares one defect family, or — for the one arm that exists to
 * measure an interaction — the several it deliberately carries. Keeping the two
 * kinds separate is the point: the single-defect arms are what let a rate be
 * attributed to one family, while an interaction arm is only interpretable
 * against the variant it is a subset of, so that subset relation is checked.
 */
const familiesOf = (ablation) => ablation.families ?? [ablation.family];
const isSubsetArm = (name) => typeof toolsFile.ablations[name].subsetOf === 'string';

const rulesFired = (name) => {
  const findings = lintManifest({ manifest: manifestOf(name) }).findings;
  return findings.reduce((counts, finding) => {
    counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
    return counts;
  }, {});
};

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

test('the fixture declares the four ablation families the first sweep confounded, and the arms derived from degraded', () => {
  assert.deepEqual(ablationNames.filter((name) => !isSubsetArm(name)).sort(), [
    'ablate-duplicate-tool',
    'ablate-near-duplicate',
    'ablate-schema',
    'ablate-thin',
  ]);
  // Every arm that exists to be read against another variant says so, and says
  // which one — the pair and the two halves it decomposes into.
  assert.deepEqual(ablationNames.filter(isSubsetArm).sort(), [
    'ablate-competitor-vague',
    'ablate-desc-degraded',
    'ablate-pair',
  ]);
  for (const name of ablationNames.filter(isSubsetArm)) {
    assert.equal(toolsFile.ablations[name].subsetOf, 'degraded');
  }
  assert.deepEqual(variantNames(toolsFile).sort(), ['clean', 'degraded', ...ablationNames].sort());
});

test('the pair decomposes into its two halves, on the same tool entries', () => {
  // The point of the two halves is that they are the pair's terms rather than
  // lookalikes measured on other manifests — which is the mistake this fixture
  // already had to record once. So the halves must partition the pair exactly.
  const key = (tool) => JSON.stringify(tool);
  const pair = toolsFile.ablations['ablate-pair'];
  const halves = ['ablate-desc-degraded', 'ablate-competitor-vague'].map((name) => toolsFile.ablations[name]);

  const fromHalves = halves.flatMap((half) => half.tools).map(key).sort();
  assert.deepEqual(fromHalves, pair.tools.map(key).sort(), 'the halves do not partition the pair');

  const names = halves.flatMap((half) => half.subsetTools);
  assert.equal(new Set(names).size, names.length, 'the halves overlap, so they are not a partition');
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

test('each ablation trips its own linter families and no other', () => {
  for (const name of ablationNames) {
    const families = familiesOf(toolsFile.ablations[name]);
    const result = lintManifest({ manifest: manifestOf(name) });
    const fired = new Set(result.findings.map((finding) => finding.rule));

    for (const family of families) {
      assert.ok(fired.has(family), `${name} should trip ${family}, fired ${[...fired].join(', ') || 'nothing'}`);
    }

    // Rules within a declared family are allowed to co-fire (an over-parameterised
    // schema also has undocumented properties); rules from a family the ablation
    // did not declare are not, or it is not isolating what it says it isolates.
    const declared = new Set(families.map((family) => family.split('/')[0]));
    const foreign = [...fired].filter((rule) => !declared.has(rule.split('/')[0]));
    assert.deepEqual(foreign, [], `${name} also tripped ${foreign.join(', ')}`);
  }
});

test('an interaction arm is a strict subset of the variant it is read against', () => {
  // The whole value of this arm is that it can be compared with the degraded
  // manifest, and the comparison only means "the neighbourhood" if every tool it
  // shares with that manifest is byte-identical to it. One reworded description
  // and it silently becomes a different experiment — as the first attempt at this
  // arm was, which is why the check exists rather than the promise.
  const key = (tool) => JSON.stringify(tool);

  for (const name of ablationNames.filter(isSubsetArm)) {
    const ablation = toolsFile.ablations[name];
    const target = toolsFile.variants[ablation.subsetOf];
    assert.ok(Array.isArray(target), `${name} subsets ${ablation.subsetOf}, which is not a variant`);

    assert.deepEqual(
      [...ablation.subsetTools].sort(),
      ablation.tools.map((tool) => tool.name).sort(),
      `${name} declares subsetTools that are not the tools it patches`
    );

    for (const toolName of ablation.subsetTools) {
      const mine = ablation.tools.find((tool) => tool.name === toolName);
      const theirs = target.find((tool) => tool.name === toolName);
      assert.ok(theirs, `${ablation.subsetOf} does not register ${toolName}`);
      assert.equal(key(mine), key(theirs), `${name}'s ${toolName} is not byte-identical to ${ablation.subsetOf}'s`);
    }

    // It carries a subset of the defects, so it must lint as a subset: no rule the
    // target does not fire, and never more of a rule than the target has.
    const mineRules = rulesFired(name);
    const targetRules = rulesFired(ablation.subsetOf);
    for (const [rule, count] of Object.entries(mineRules)) {
      assert.ok(targetRules[rule], `${name} fires ${rule}, which ${ablation.subsetOf} does not`);
      assert.ok(
        count <= targetRules[rule],
        `${name} fires ${rule} ${count} times against ${ablation.subsetOf}'s ${targetRules[rule]}`
      );
    }

    // And its declared families are exactly what it fires — an interaction arm has
    // no headline rule to stand for the rest, so the declaration is the full list.
    assert.deepEqual(familiesOf(ablation).slice().sort(), Object.keys(mineRules).sort());
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
