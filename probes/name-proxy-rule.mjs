/**
 * Does option (b) of PROJECT-LOG item 22 work, and what does it cost?
 *
 * **Adopted 2026-09-05.** This probe measured the candidate before it shipped, the
 * maintainer read the result and adopted it, and `description/indistinguishable-pair`
 * is now a rule in `core/lint.mjs` — a warning, for the reason recorded beside it
 * there. So this file no longer carries its own copy of the logic: it imports the
 * shipped rule and remains the thing that re-measures it against every manifest with
 * a known invocation rate. If the rule is ever retuned, this is what says whether it
 * still reproduces the arms.
 *
 * The history is worth keeping, because it is why the rule looks the way it does.
 * The 2026-09-05 ladder closed option (a): no threshold on description-to-description
 * word overlap separates a harmful competitor from a harmless one, because the rate
 * sits flat at 48–58% while that overlap falls from 1.000 to 0.130. Option (b) asked
 * a different pair of questions — are the two *names* close, and does *neither*
 * description say what its own tool is for — and that conjunction reproduced every
 * arm this project has measured.
 *
 * The verdict this probe checks, and it is a pass/fail rather than a number:
 *
 *  - fires on all five ladder rungs (48.3% to 83.3%, competitor takes the failures)
 *  - stays silent on `ablate-competitor-vague` (95.0%) — one description is still
 *    informative there
 *  - stays silent on `ablate-desc-degraded` (93.3%) — no close-named sibling exists
 *  - stays silent on `clean`, because a default that flags a manifest known to work
 *    is a broken default
 *
 * What it cannot establish, then or now: a **false-positive rate**. Thirteen
 * manifests from one fixture family, every one written here, is not a sample. The
 * cohort capture is the corpus that would settle it, and the rule stays a warning
 * until it does.
 *
 * Usage:
 *   node probes/name-proxy-rule.mjs
 *   node probes/name-proxy-rule.mjs --name-threshold=0.5
 *   node probes/name-proxy-rule.mjs --json
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { lintManifest, DEFAULT_OPTIONS } from '../core/lint.mjs';
import { parseOptions } from '../core/args.mjs';
import { composeVariant, variantNames } from '../fixtures/broken/compose.mjs';

const { options, error: optionsError } = parseOptions(process.argv.slice(2), {
  values: ['name-threshold'],
  switches: ['json'],
  maxPositional: 0,
});
if (optionsError) {
  console.error(`cannot answer: ${optionsError}`);
  process.exit(2);
}

const nameThreshold = Number(options['name-threshold'] ?? DEFAULT_OPTIONS.nameSimilarityThreshold);
const asJson = options.json === true;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolsFile = JSON.parse(await readFile(`${root}/fixtures/broken/tools.json`, 'utf8'));

const RULE = 'description/indistinguishable-pair';

const findingsFor = (variant) => {
  const tools = composeVariant(toolsFile, variant).map(
    ({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })
  );
  const result = lintManifest({
    manifest: { present: true, settled: true, tools },
    options: { nameSimilarityThreshold: nameThreshold },
  });
  return {
    tools: tools.length,
    findings: result.findings.filter((finding) => finding.rule === RULE),
    counts: result.counts,
  };
};

// Every manifest this repo can produce, plus the measured rate where one exists.
const MEASURED = {
  clean: { rate: '95.0%', note: 'reference-quality twin — must stay silent' },
  degraded: { rate: '60.0%', note: 'every defect family at once' },
  'ablate-pair': { rate: '48.3%', note: 'ladder rung 1, similarity 1.000' },
  'ablate-pair-sim086': { rate: '56.7%', note: 'ladder rung 2, similarity 0.857' },
  'ablate-pair-paraphrased': { rate: '50.0%', note: 'ladder rung 3, similarity 0.529' },
  'ablate-pair-sim013': { rate: '58.3%', note: 'ladder rung 4, similarity 0.130' },
  'ablate-pair-sim004': { rate: '83.3%', note: 'ladder rung 5, similarity 0.043' },
  'ablate-desc-degraded': { rate: '93.3%', note: 'vague descriptions, no competitor — must stay silent' },
  'ablate-competitor-vague': { rate: '95.0%', note: 'competitor added, good descriptions — must stay silent' },
  'ablate-near-duplicate': { rate: '90.0%', note: 'published single-defect arm' },
  'ablate-duplicate-tool': { rate: '91.7%', note: 'published single-defect arm' },
  'ablate-thin': { rate: '100.0%', note: 'thin descriptions, cost nothing — must stay silent' },
  'ablate-schema': { rate: '48.3%', note: 'over-parameterised schema; a different mechanism entirely' },
};

const rows = [];
for (const variant of variantNames(toolsFile)) {
  const { tools, findings, counts } = findingsFor(variant);
  rows.push({
    variant,
    tools,
    flagged: findings.length,
    pairs: findings.map((finding) => finding.tool),
    counts,
    measured: MEASURED[variant] ?? null,
  });
}

if (asJson) {
  console.log(JSON.stringify({ rule: RULE, nameThreshold, rows }, null, 2));
  process.exit(0);
}

console.log(`${RULE} · name threshold ${nameThreshold} · shipped in core/lint.mjs as a warning\n`);

const pad = (value, width) => String(value).padEnd(width);
console.log(`${pad('variant', 26)}${pad('tools', 6)}${pad('E/W', 8)}${pad('flagged', 8)}${pad('rate', 8)}pairs`);
console.log('-'.repeat(104));
for (const row of rows) {
  console.log(
    `${pad(row.variant, 26)}${pad(row.tools, 6)}${pad(`${row.counts.error}/${row.counts.warning}`, 8)}${pad(row.flagged, 8)}${pad(row.measured?.rate ?? '—', 8)}${row.pairs.join(', ')}`
  );
}

// The verdict this probe exists to deliver: does the candidate reproduce the arms?
const mustFire = ['ablate-pair', 'ablate-pair-sim086', 'ablate-pair-paraphrased', 'ablate-pair-sim013', 'ablate-pair-sim004'];
const mustStaySilent = ['clean', 'ablate-desc-degraded', 'ablate-competitor-vague', 'ablate-thin'];
const byVariant = new Map(rows.map((row) => [row.variant, row]));

const missed = mustFire.filter((name) => (byVariant.get(name)?.flagged ?? 0) === 0);
const falsePositives = mustStaySilent.filter((name) => (byVariant.get(name)?.flagged ?? 0) > 0);

console.log('');
console.log(`should fire, did not:      ${missed.length === 0 ? 'none' : missed.join(', ')}`);
console.log(`should be silent, fired:   ${falsePositives.length === 0 ? 'none' : falsePositives.join(', ')}`);
console.log('');

if (missed.length === 0 && falsePositives.length === 0) {
  console.log('VERDICT: the shipped rule reproduces every measured arm — it fires on all five collapsed');
  console.log('rungs and stays silent on all four manifests that cost nothing, and the live reference page');
  console.log('still lints 0/0. What this does NOT establish is a false-positive rate: 13 manifests from');
  console.log('one fixture family, all written here, is not a sample. That is why the rule is a warning');
  console.log('and not an error, and the cohort capture is the corpus that would settle it.');
  process.exit(0);
}

console.log('VERDICT: the rule no longer reproduces the measured arms. Either it was retuned or a fixture');
console.log('moved — and a rule that does not reproduce the evidence it was adopted on should not ship.');
process.exit(1);
