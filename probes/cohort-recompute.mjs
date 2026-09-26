/**
 * Recompute a capture's summary and publishable files from its own records —
 * and reconcile against whatever the runner left behind rather than trusting it.
 *
 * The runner writes `summary.json` and `publishable.json` when a run *finishes*.
 * A run that died never did, and — before `--resume` — a run continued in parts
 * summarised only its own part. This derives both files over the **whole**
 * `snapshot.jsonl`, prints any field where an existing summary disagrees with
 * the recomputed counts, and writes the corrected files. Nothing here is
 * clever: `summarize()` and `toPublishable()` are the same functions the runner
 * uses, which is the point — one definition of every census number.
 *
 * Usage:
 *   node probes/cohort-recompute.mjs --snapshot=artifacts/cohort-2026-09-25/snapshot.jsonl
 *   node probes/cohort-recompute.mjs --snapshot=… --out=…   # default: the snapshot's own directory
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { summarize, toPublishable, localDateStamp } from '../core/cohort.mjs';
import { parseOptions } from '../core/args.mjs';

const { options, error: optionsError } = parseOptions(process.argv.slice(2), {
  values: ['snapshot', 'out'],
  maxPositional: 0,
});
if (optionsError) {
  console.error(`cannot recompute: ${optionsError}`);
  process.exit(2);
}
if (!options.snapshot) {
  console.error('usage: node probes/cohort-recompute.mjs --snapshot=<snapshot.jsonl> [--out=<dir>]');
  process.exit(2);
}

const snapshotPath = resolve(options.snapshot);
const outDir = resolve(options.out ?? dirname(snapshotPath));
await mkdir(outDir, { recursive: true });

const records = (await readFile(snapshotPath, 'utf8'))
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

if (records.length === 0) {
  console.error('cannot recompute: the snapshot file holds no records');
  process.exit(2);
}

const counts = summarize(records);
const existing = await readFile(`${outDir}/summary.json`, 'utf8')
  .then((text) => JSON.parse(text))
  .catch(() => null);

if (existing) {
  const mismatches = Object.entries(counts).filter(
    ([field, value]) => field in existing && existing[field] !== value
  );
  if (mismatches.length > 0) {
    console.log(`reconcile: ${mismatches.length} field(s) disagree with the existing summary:`);
    for (const [field, value] of mismatches) {
      console.log(`  ${field}: existing ${JSON.stringify(existing[field])} → recomputed ${JSON.stringify(value)}`);
    }
  } else {
    console.log('reconcile: every recomputed field matches the existing summary');
  }
} else {
  console.log('reconcile: no existing summary to check against (a run that died never wrote one)');
}

const summary = {
  schema: 'webmcp-gauge/cohort/1',
  // Carried from the runner's own summary when one exists — the record file
  // alone cannot know the browser build or the invocation's start time.
  ...(existing
    ? {
        startedAt: existing.startedAt,
        finishedAt: existing.finishedAt,
        browser: existing.browser ?? null,
        userAgentSuffix: existing.userAgentSuffix ?? null,
        targetsGiven: existing.targetsGiven ?? records.length,
        ...(existing.alreadyCaptured !== undefined ? { alreadyCaptured: existing.alreadyCaptured } : {}),
      }
    : {
        startedAt: records[0].capturedAt,
        finishedAt: records.at(-1).capturedAt,
        browser: null,
        targetsGiven: records.length,
      }),
  ...counts,
  recomputedAt: new Date().toISOString(),
  recordsInFile: records.length,
};

await writeFile(`${outDir}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
await writeFile(
  `${outDir}/publishable.json`,
  `${JSON.stringify(
    { schema: 'webmcp-gauge/cohort-publishable/1', capturedOn: localDateStamp(new Date(records.at(-1).capturedAt)), projects: records.map(toPublishable) },
    null,
    2
  )}\n`,
  'utf8'
);

console.log(`\nrecords: ${records.length}`);
console.log(JSON.stringify(counts, null, 2));
console.log(`\nsummary: ${outDir}/summary.json`);
console.log(`publishable: ${outDir}/publishable.json`);
