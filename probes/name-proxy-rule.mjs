/**
 * Does option (b) of PROJECT-LOG item 22 actually work, and what does it cost?
 *
 * The 2026-09-05 ladder closed option (a): no threshold on description-to-description
 * word overlap separates a harmful competitor from a harmless one, because the rate
 * sits flat at 48–58% while that overlap falls from 1.000 to 0.130. Option (b) is
 * the remaining model-free candidate, and item 22 states it as:
 *
 *   flag two tools whose *names* are lexically close **and** whose descriptions
 *   both fall below an informativeness bar
 *
 * This probe implements that as a candidate rule and measures it against every
 * manifest this repository has, including the ones with a measured invocation rate.
 * It is deliberately **not** a change to `core/lint.mjs`: shipping a default that
 * could flag a working manifest is the maintainer's decision, and item 22's
 * done-condition says the rule is measured *before* it ships. This is that
 * measurement.
 *
 * The candidate, both halves cheap and model-free:
 *
 *  1. **Name proximity.** Two tools whose names, split on `_` into token sets,
 *     score at or above `--name-threshold` by the linter's own Jaccard measure —
 *     the same function the description rules use, so the rule adds no new notion
 *     of similarity. `sum_by_category` against `summarise_by_category` scores 0.500
 *     ({sum,by,category} against {summarise,by,category}).
 *  2. **Neither description echoes its own name.** A description is treated as
 *     informative about *which* tool it is when it contains the distinguishing
 *     tokens of its own name — the tokens that name does not share with its close
 *     sibling. `sum_by_category`'s reference description says "Total the loaded
 *     spending **by category**"; the degraded one says "Works with the rows in the
 *     table and returns totals for what it finds", which never says what it is for.
 *     The bar is absolute rather than relative, which is the whole point: the
 *     ladder proved relative similarity is the wrong quantity.
 *
 * A pair is flagged only when **both** hold. That conjunction is what the measured
 * arms demand, and the prediction registered here before the first run is that it
 * reproduces all seven of them:
 *
 *  - fires on all five ladder rungs (48–83%, competitor takes the failures)
 *  - stays silent on `ablate-competitor-vague` (95.0%, cost zero) — one of the two
 *    descriptions is still informative there
 *  - stays silent on `ablate-desc-degraded` (93.3%) — no close-named sibling exists
 *  - stays silent on `clean` and on the reference page, because a default that
 *    flags a manifest known to work is a broken default
 *
 * The honest weakness, stated up front: a deterministic static computation is not a
 * measurement of the world, so pre-registering it proves less than pre-registering
 * a judge sweep. Anyone can re-run this and check. What it can still do is fail.
 *
 * Usage:
 *   node probes/name-proxy-rule.mjs
 *   node probes/name-proxy-rule.mjs --name-threshold=0.4
 *   node probes/name-proxy-rule.mjs --json
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { similarity } from '../core/lint.mjs';
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

const nameThreshold = Number(options['name-threshold'] ?? '0.4');
const asJson = options.json === true;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolsFile = JSON.parse(await readFile(`${root}/fixtures/broken/tools.json`, 'utf8'));

const tokensOf = (name) => new Set(String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const words = (text) => new Set(String(text ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []);

/**
 * The candidate rule. Returns one finding per flagged pair, in the shape
 * `core/lint.mjs` uses, so a decision to adopt it is a copy rather than a rewrite.
 */
export const nameProxyFindings = (tools, { threshold = 0.4 } = {}) => {
  const findings = [];

  for (let i = 0; i < tools.length; i += 1) {
    for (let j = i + 1; j < tools.length; j += 1) {
      const a = tools[i];
      const b = tools[j];
      const nameScore = similarity([...tokensOf(a.name)].join(' '), [...tokensOf(b.name)].join(' '));
      if (nameScore < threshold) continue;

      // The tokens that tell these two names apart — what a description has to
      // mention to say which of the pair it is.
      const aTokens = tokensOf(a.name);
      const bTokens = tokensOf(b.name);
      const aOnly = [...aTokens].filter((token) => !bTokens.has(token));
      const bOnly = [...bTokens].filter((token) => !aTokens.has(token));
      // Shared tokens count too: "by category" is what makes either description
      // informative about the job, even though both names carry it.
      const echoes = (tool, own) => {
        const said = words(tool.description);
        const wanted = [...own, ...[...tokensOf(tool.name)].filter((t) => t.length > 2)];
        return wanted.some((token) => said.has(token));
      };

      const aEchoes = echoes(a, aOnly);
      const bEchoes = echoes(b, bOnly);
      if (aEchoes || bEchoes) continue;

      findings.push({
        rule: 'description/indistinguishable-pair',
        severity: 'error',
        tools: [a.name, b.name],
        nameSimilarity: Number(nameScore.toFixed(3)),
        detail:
          `\`${a.name}\` and \`${b.name}\` have similar names (${nameScore.toFixed(2)}) and neither description ` +
          `says which one it is. An agent that cannot tell them apart from the text will choose on the name.`,
      });
    }
  }

  return findings;
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
  const tools = composeVariant(toolsFile, variant);
  const findings = nameProxyFindings(tools, { threshold: nameThreshold });
  rows.push({
    variant,
    tools: tools.length,
    flagged: findings.length,
    pairs: findings.map((finding) => finding.tools.join(' + ')),
    measured: MEASURED[variant] ?? null,
  });
}

if (asJson) {
  console.log(JSON.stringify({ nameThreshold, rows }, null, 2));
  process.exit(0);
}

console.log(`candidate rule: description/indistinguishable-pair · name threshold ${nameThreshold}`);
console.log('(a measurement, not a shipped rule — item 22 option (b))\n');

const pad = (value, width) => String(value).padEnd(width);
console.log(`${pad('variant', 26)}${pad('tools', 6)}${pad('flagged', 8)}${pad('rate', 8)}pairs`);
console.log('-'.repeat(96));
for (const row of rows) {
  console.log(
    `${pad(row.variant, 26)}${pad(row.tools, 6)}${pad(row.flagged, 8)}${pad(row.measured?.rate ?? '—', 8)}${row.pairs.join(', ')}`
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
  console.log('VERDICT: the candidate reproduces every measured arm — it fires on all five collapsed');
  console.log('rungs and stays silent on all four manifests that cost nothing. That is not a licence to');
  console.log('ship it: 13 manifests from one fixture family is not a false-positive rate, and a real one');
  console.log('needs manifests this project did not write. It is a licence to take option (b) seriously.');
  process.exit(0);
}

console.log('VERDICT: the candidate does not reproduce the measured arms. Option (b) as stated in item 22');
console.log('does not survive its own evidence, and the row should say so rather than keeping it open.');
process.exit(1);
