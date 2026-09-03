/**
 * Which utterances fail even when the page is described as well as it ever will be.
 *
 * Every rate this project publishes is a rate against a fixture's opinion about
 * which tool *should* have been chosen. Most of the time that opinion is obviously
 * right and the failures track the page. But `sum_by_category-12` failed 12 of 12
 * trials across four different manifests - including two carrying the reference
 * description - which means the page cannot be what is wrong with it. Something in
 * the set is, and until it is listed nobody knows how much of the floor is ours.
 *
 * Method: pool only the runs where the expected tool's description *and* its
 * neighbours are reference-quality, so a failure there cannot be blamed on injected
 * damage. Then count, per utterance, how often it missed and what it chose instead.
 * The degraded arms are read too, but only as contrast - an utterance that fails
 * everywhere is a different animal from one that fails only where the page is bad.
 *
 * Usage: node probes/utterance-floor.mjs [--min 2]
 */
import { readFile } from 'node:fs/promises';

import { parseOptions } from '../core/args.mjs';

const { options, error: optionsError } = parseOptions(process.argv.slice(2), { values: ['min'], maxPositional: 0 });
if (optionsError) {
  console.error(`cannot count: ${optionsError}`);
  process.exit(2);
}
// The usage line above has always shown `--min 2`, and until 2026-09-03 this file
// read `--min=` only — so the documented form was the one that did nothing.
const MIN_FAILURES = Number(options.min ?? '1');

/**
 * Reference-quality manifests only. The 1.2.0 sweep is excluded on purpose: the
 * `1.3.0` revision rewrote some utterance texts, so pooling it would average two
 * different questions under one id.
 */
const GOOD_MANIFEST_RUNS = [
  ['airlock live, 1.3.0, 3 repeats', 'artifacts/sweep-r3-v130'],
  ['airlock live, 1.3.0, 3 sessions x 2', 'artifacts/sweep-sessions'],
  ['clean twin, 1 session', 'artifacts/twin-clean'],
  ['clean twin, 3 sessions', 'artifacts/s3-clean'],
];

const DEGRADED_RUNS = [
  ['degraded twin, 1 session', 'artifacts/twin-degraded'],
  ['degraded twin, 3 sessions', 'artifacts/s3-degraded'],
  ['degraded twin, spaced', 'artifacts/spaced-degraded'],
  ['ablate near-duplicate', 'artifacts/ablate-near-duplicate'],
  ['ablate duplicate tool', 'artifacts/ablate-duplicate-tool'],
  ['ablate thin', 'artifacts/ablate-thin'],
  ['ablate schema', 'artifacts/ablate-schema'],
];

const load = async (dir) => {
  try {
    const text = await readFile(`${dir}/sweep.jsonl`, 'utf8');
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

const fixture = JSON.parse(
  await readFile(new URL('../fixtures/airlock.utterances.json', import.meta.url), 'utf8')
);
const textOf = new Map();
for (const tool of fixture.tools) {
  for (const utterance of tool.utterances) {
    textOf.set(utterance.id, { text: utterance.text, tag: utterance.tag, tool: tool.name });
  }
}
for (const utterance of fixture.controls?.utterances ?? []) {
  textOf.set(utterance.id, { text: utterance.text, tag: utterance.class ?? 'control', tool: null });
}

const tally = async (runs) => {
  const perUtterance = new Map();
  for (const [label, dir] of runs) {
    for (const record of await load(dir)) {
      const entry =
        perUtterance.get(record.utteranceId) ??
        { trials: 0, ok: 0, chose: new Map(), outcomes: new Map(), runs: new Set() };
      entry.trials += 1;
      entry.runs.add(label);
      const pass = record.kind === 'control' ? record.outcome === 'not_selected' : record.outcome === 'ok';
      if (pass) entry.ok += 1;
      else {
        const chosen = record.selection?.tool ?? '(none)';
        entry.chose.set(chosen, (entry.chose.get(chosen) ?? 0) + 1);
        entry.outcomes.set(record.outcome, (entry.outcomes.get(record.outcome) ?? 0) + 1);
      }
      perUtterance.set(record.utteranceId, entry);
    }
  }
  return perUtterance;
};

const good = await tally(GOOD_MANIFEST_RUNS);
const degraded = await tally(DEGRADED_RUNS);

const describe = (entry) =>
  entry
    ? `${entry.trials - entry.ok}/${entry.trials}` +
      (entry.chose.size > 0
        ? ` → ${[...entry.chose.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([tool, count]) => `${tool} ×${count}`)
            .join(', ')}`
        : '')
    : '—';

const failing = [...good.entries()]
  .filter(([, entry]) => entry.trials - entry.ok >= MIN_FAILURES)
  .sort((a, b) => (b[1].trials - b[1].ok) / b[1].trials - (a[1].trials - a[1].ok) / a[1].trials);

const totals = [...good.values()].reduce(
  (sum, entry) => ({ trials: sum.trials + entry.trials, misses: sum.misses + (entry.trials - entry.ok) }),
  { trials: 0, misses: 0 }
);

console.log('# The utterance set\'s own floor\n');
console.log(
  `Pooled over ${GOOD_MANIFEST_RUNS.length} reference-quality manifests: **${totals.trials} trials, ${totals.misses} misses**, ` +
    `${failing.length} of ${good.size} utterances missing at least ${MIN_FAILURES}.\n`
);
console.log('Runs pooled: ' + GOOD_MANIFEST_RUNS.map(([label]) => label).join(' · ') + '\n');

console.log('| utterance | tag | expected | good manifests | same utterance on degraded manifests |');
console.log('|---|---|---|---|---|');
for (const [id, entry] of failing) {
  const meta = textOf.get(id) ?? {};
  console.log(
    `| \`${id}\` | ${meta.tag ?? '?'} | ${meta.tool ?? 'no tool (control)'} | ${describe(entry)} | ${describe(degraded.get(id))} |`
  );
}

console.log('\n## Text of every flagged utterance\n');
for (const [id, entry] of failing) {
  const meta = textOf.get(id) ?? {};
  const rate = ((1 - entry.ok / entry.trials) * 100).toFixed(0);
  console.log(`- \`${id}\` (${meta.tag}, misses ${rate}% of ${entry.trials}): "${meta.text}"`);
}
