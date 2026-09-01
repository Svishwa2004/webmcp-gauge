/**
 * Render private scorecards from a captured cohort (project log item 13).
 *
 * Reads a snapshot's `snapshot.jsonl` and writes one Markdown file per project.
 * It **sends nothing**. Delivery to somebody who did not ask for it is a gate in
 * the log, not a flag here, and keeping the two apart is deliberate: a script that
 * could email a stranger is one typo away from doing it.
 *
 * Usage:
 *   node probes/render-scorecards.mjs --snapshot=artifacts/cohort-2026-09-04/snapshot.jsonl
 *   node probes/render-scorecards.mjs --snapshot=… --only=airlock
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { buildScorecard, scorecardToMarkdown } from '../report/scorecard.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const snapshotPath = flag('snapshot', null);
const only = flag('only', null);
if (!snapshotPath) {
  console.error('usage: node probes/render-scorecards.mjs --snapshot=<snapshot.jsonl> [--only=<substring>] [--out=<dir>]');
  process.exit(2);
}

const outDir = resolve(flag('out', `${dirname(resolve(snapshotPath))}/scorecards`));
const lines = (await readFile(resolve(snapshotPath), 'utf8')).trim().split(/\r?\n/).filter(Boolean);
await mkdir(outDir, { recursive: true });

const slug = (text) =>
  String(text ?? 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';

let written = 0;
let skipped = 0;
const summary = [];

for (const line of lines) {
  const record = JSON.parse(line);
  if (only && !`${record.project} ${record.url}`.toLowerCase().includes(only.toLowerCase())) continue;

  // A page that registered nothing gets no scorecard: there is no manifest to
  // report on, and a document saying "you have no tools" is not feedback.
  if (!record.webmcp?.registered) {
    skipped += 1;
    continue;
  }

  const card = buildScorecard(record);
  const path = `${outDir}/${slug(record.project)}.md`;
  await writeFile(path, scorecardToMarkdown(card), 'utf8');
  written += 1;
  summary.push({
    project: record.project,
    errors: card.counts.error,
    warnings: card.counts.warning,
    tools: card.tools.registeredByThePage,
    divergent: Boolean(card.tools.divergence),
    path,
  });
}

summary.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings);
console.log(`scorecards written: ${written}  ·  skipped (no tools registered): ${skipped}`);
console.log(`→ ${outDir}\n`);
for (const row of summary) {
  console.log(
    `  ${String(row.errors).padStart(3)}E ${String(row.warnings).padStart(3)}W  ${String(row.tools).padStart(3)} tools${row.divergent ? '  [views diverge]' : ''}  ${row.project}`
  );
}
console.log('\nNothing has been sent. Delivery is a separate, gated decision.');
