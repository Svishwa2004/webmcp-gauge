/**
 * The fourteenth rule's false-positive question, put to the first manifests
 * nobody here wrote.
 *
 * `description/indistinguishable-pair` shipped as a warning on 2026-09-05 with
 * the reason recorded in its own rule comment: all 13 manifests it had fired on
 * were written in this repo, and a severity decided by the author's own fixtures
 * is not a false-positive rate. The rule comment names the corpus that would
 * settle it — manifests captured from pages this project does not control. The
 * pilot cohort capture of 2026-09-25 (`artifacts/cohort-2026-09-25/`, 461
 * targets from the first 523 listed) is that corpus's first slice.
 *
 * What this probe does: imports the **shipped** linter and runs every rule
 * against every reachable manifest the capture recorded, then reports per-rule
 * fire rates across manifests and prints the indistinguishable-pair firings
 * with their descriptions, because the judgment the severity decision needs is
 * a human reading whether those pairs are genuinely indistinguishable. The
 * probe measures; the promotion decision stays the maintainer's.
 *
 * Every other rule's rate falls out of the same pass — the first time the
 * thirteen rules meet manifests written by strangers, which is a measurement
 * the linter has never had.
 *
 * Usage: node probes/lint-cohort.mjs [--snapshot=artifacts/cohort-2026-09-25/snapshot.jsonl]
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { lintManifest, RULES } from '../core/lint.mjs';
import { localDateStamp } from '../core/cohort.mjs';
import { parseOptions } from '../core/args.mjs';

const { options, error: optionsError } = parseOptions(process.argv.slice(2), {
  values: ['snapshot', 'out'],
  maxPositional: 0,
});
if (optionsError) {
  console.error(`cannot measure: ${optionsError}`);
  process.exit(2);
}

const snapshotPath = resolve(options.snapshot ?? 'artifacts/cohort-2026-09-25/snapshot.jsonl');
const outDir = resolve(options.out ?? `artifacts/lint-cohort-${localDateStamp()}`);
await mkdir(outDir, { recursive: true });

const records = (await readFile(snapshotPath, 'utf8'))
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const manifests = records.filter((record) => record.liveness.reachable && record.webmcp.registered);

console.log(`linting ${manifests.length} captured manifests (of ${records.length} records) from ${snapshotPath}\n`);

const PAIR_RULE = 'description/indistinguishable-pair';
const perManifest = [];
const byRule = new Map(); // rule id -> { severity, firings, manifests: Set }
const pairFirings = [];

for (const record of manifests) {
  // The record already stores exactly what the linter reads: name, description,
  // parsed inputSchema, annotations. Passing the capture through untouched is
  // the point — a linter fed cleaned-up shapes would measure a cleaned-up world.
  const tools = (record.webmcp.tools ?? []).map(
    ({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })
  );
  const result = lintManifest({ manifest: { present: true, settled: true, tools } });

  perManifest.push({
    project: record.project,
    url: record.url,
    toolCount: tools.length,
    errors: result.counts.error,
    warnings: result.counts.warning,
    findings: result.findings.map(({ rule, severity, tool, detail }) => ({ rule, severity, tool, detail })),
  });

  for (const finding of result.findings) {
    const entry = byRule.get(finding.rule) ?? {
      severity: finding.severity,
      firings: 0,
      manifests: new Set(),
    };
    entry.firings += 1;
    entry.manifests.add(record.project);
    byRule.set(finding.rule, entry);
    if (finding.rule === PAIR_RULE) {
      pairFirings.push({
        project: record.project,
        pair: finding.tool,
        nameSimilarity: finding.evidence?.nameSimilarity ?? null,
        left: finding.evidence?.left ?? null,
        right: finding.evidence?.right ?? null,
      });
    }
  }
}

const clean = perManifest.filter((m) => m.errors === 0 && m.warnings === 0);
const pairManifests = new Set(pairFirings.map((f) => f.project));

console.log('per-rule, by manifests affected:');
const rows = [...byRule.entries()]
  .map(([id, entry]) => ({ id, ...entry, manifests: entry.manifests.size }))
  .sort((a, b) => b.manifests - a.manifests || b.firings - a.firings);
for (const row of rows) {
  console.log(
    `  ${row.severity === 'error' ? 'E' : 'W'}  ${row.id.padEnd(40)} ${String(row.manifests).padStart(4)} manifests · ${row.firings} firings`
  );
}
for (const rule of RULES) {
  if (!byRule.has(rule.id)) console.log(`  ${rule.severity === 'error' ? 'E' : 'W'}  ${rule.id.padEnd(40)}    0 manifests · 0 firings`);
}

console.log(`\nmanifests entirely clean (0E/0W): ${clean.length} of ${perManifest.length}`);
console.log(`indistinguishable-pair fired on ${pairManifests.size} of ${perManifest.length} manifests (${pairFirings.length} firings)`);

const distinctPairs = new Map();
for (const firing of pairFirings) {
  const key = firing.pair;
  if (!distinctPairs.has(key)) distinctPairs.set(key, firing);
}
console.log(`distinct pairs: ${distinctPairs.size}\n`);
let shown = 0;
for (const [pair, firing] of distinctPairs) {
  if (shown >= 12) {
    console.log(`  … and ${distinctPairs.size - shown} more distinct pairs (see ${outDir})`);
    break;
  }
  console.log(`  ${pair}  [similarity ${firing.nameSimilarity}] — ${firing.project}`);
  console.log(`    left:  ${(firing.left ?? '').slice(0, 110)}`);
  console.log(`    right: ${(firing.right ?? '').slice(0, 110)}`);
  shown += 1;
}

await writeFile(`${outDir}/lint-cohort.jsonl`, perManifest.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf8');
await writeFile(
  `${outDir}/summary.json`,
  JSON.stringify(
    {
      schema: 'webmcp-gauge/lint-cohort/1',
      measuredAt: new Date().toISOString(),
      snapshot: snapshotPath,
      corpus: 'first 523 listed (461 usable), convenience sample — manifests nobody in this repo wrote',
      manifestsLinted: perManifest.length,
      cleanManifests: clean.length,
      perRule: rows.map(({ id, severity, manifests: count, firings }) => ({ id, severity, manifests: count, firings })),
      indistinguishablePair: {
        firings: pairFirings.length,
        manifestsAffected: pairManifests.size,
        distinctPairs: distinctPairs.size,
      },
    },
    null,
    2
  ) + '\n',
  'utf8'
);

console.log(`\nper-manifest rows: ${outDir}/lint-cohort.jsonl`);
console.log(`summary: ${outDir}/summary.json`);
