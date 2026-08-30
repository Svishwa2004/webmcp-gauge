/**
 * Prints one table across several report.json files.
 *
 * The ablation design only pays off if the arms are read side by side: a per-tool
 * rate on its own says a page is bad, while the same tool across the clean arm, the
 * bundled degraded arm and the single-defect ablation says *which defect* did it.
 * This is a probe rather than a `compare` subcommand on purpose - the product shape
 * of a comparison (what a baseline is, what a regression is) is not decided yet, and
 * guessing it in the CLI would be harder to undo than a script in probes/.
 *
 * Usage: node probes/compare-arms.mjs <dir-or-report.json> [...]
 *   node probes/compare-arms.mjs artifacts/s3-clean artifacts/s3-degraded
 */
import { readFile } from 'node:fs/promises';

const pad = (text, width) => String(text).padEnd(width).slice(0, width);
const percent = (value) => (typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '—');
const interval = (block) =>
  block ? `${percent(block.rate)} [${percent(block.low)}, ${percent(block.high)}]` : '—';
const sigma = (value) => (typeof value === 'number' ? value.toFixed(3) : '—');

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: node probes/compare-arms.mjs <dir-or-report.json> [...]');
  process.exit(2);
}

const arms = [];
for (const path of paths) {
  const file = path.endsWith('.json') ? path : `${path}/report.json`;
  try {
    const report = JSON.parse(await readFile(file, 'utf8'));
    arms.push({ label: report.subject?.name ?? file, file, report });
  } catch (error) {
    console.error(`skipped ${file}: ${error.code ?? error.message}`);
  }
}

console.log('# Arms\n');
for (const arm of arms) {
  const { report } = arm;
  const gate = report.gate ? `${report.gate.status} (exit ${report.gate.code})` : '—';
  const coverage = report.coverage
    ? `${report.coverage.expectedTrials - report.coverage.missingTrials}/${report.coverage.expectedTrials}`
    : '—';
  const shape = report.stamps?.harness;
  const overall = report.invocation.overall;
  console.log(
    `- **${arm.label}** — ${report.subject?.url ?? '?'} · set ${report.stamps?.utteranceSet?.version} · judge ${report.stamps?.judge?.model} · ` +
      `${shape?.sessions ?? '?'}s×${shape?.repeatsPerSession ?? '?'}r c${shape?.concurrency ?? '?'} · ` +
      `overall ${percent(overall.trials > 0 ? overall.ok / overall.trials : null)} (${overall.ok}/${overall.trials}) ` +
      `· coverage ${coverage} · gate ${gate}` +
      (report.controls
        ? ` · controls ${percent(report.controls.falsePositiveRate?.rate)} of ${report.controls.trials}`
        : ' · no controls')
  );
}

const tools = [...new Set(arms.flatMap((arm) => arm.report.invocation.perTool.map((tool) => tool.tool)))].sort();

console.log('\n# Invocation rate by tool\n');
console.log(`| ${pad('tool', 18)} | ${arms.map((arm) => pad(arm.label, 30)).join(' | ')} |`);
console.log(`|${'-'.repeat(20)}|${arms.map(() => '-'.repeat(32)).join('|')}|`);
for (const tool of tools) {
  const cells = arms.map((arm) => {
    const entry = arm.report.invocation.perTool.find((candidate) => candidate.tool === tool);
    return pad(entry ? `${interval(entry.invocation)} n=${entry.trials}` : '', 30);
  });
  console.log(`| ${pad(tool, 18)} | ${cells.join(' | ')} |`);
}

console.log('\n# Between-session sigma by tool (— where an arm never ran it)\n');
for (const tool of tools) {
  const cells = arms.map((arm) => {
    const entry = arm.report.invocation.perTool.find((candidate) => candidate.tool === tool);
    return pad(
      entry
        ? `${sigma(entry.betweenSession?.sigma)} over ${entry.betweenSession?.runs ?? '?'} · within ${sigma(entry.withinSession?.sigma)}`
        : '',
      30
    );
  });
  console.log(`| ${pad(tool, 18)} | ${cells.join(' | ')} |`);
}

console.log('\n# Failure mix by tool (non-ok outcomes only)\n');
for (const tool of tools) {
  for (const arm of arms) {
    const entry = arm.report.invocation.perTool.find((candidate) => candidate.tool === tool);
    if (!entry) continue;
    const failures = Object.entries(entry.outcomes ?? {})
      .filter(([outcome, count]) => outcome !== 'ok' && count > 0)
      .map(([outcome, count]) => `${count} ${outcome}`)
      .join(', ');
    if (failures) console.log(`- \`${tool}\` · ${arm.label}: ${failures}`);
  }
}

console.log('\n# By phrasing tag\n');
const tags = [...new Set(arms.flatMap((arm) => Object.keys(arm.report.invocation.perTag ?? {})))];
for (const tag of tags) {
  const cells = arms.map((arm) => {
    const entry = arm.report.invocation.perTag?.[tag];
    return pad(entry ? `${percent(entry.rate)} n=${entry.trials}` : '', 30);
  });
  console.log(`| ${pad(tag, 18)} | ${cells.join(' | ')} |`);
}
