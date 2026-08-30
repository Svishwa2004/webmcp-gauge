/**
 * Report emitters.
 *
 * A report that does not name its judge, its browser build and its utterance-set
 * version is not a measurement, because invocation rate is a property of
 * (page, client, judge, utterances) rather than of the page alone. Every stamp
 * therefore travels with the numbers, and the Markdown is generated from the same
 * object as the JSON so the two cannot drift.
 */
import { rollUpControls, rollUpTool } from '../core/stats.mjs';

const percent = (value) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

const interval = (wilsonResult) =>
  wilsonResult.rate === null
    ? '—'
    : `${percent(wilsonResult.rate)} [${percent(wilsonResult.low)}, ${percent(wilsonResult.high)}]`;

export const buildReport = ({ fixture, sweep, judge, browser }) => {
  const toolRecords = sweep.records.filter((record) => record.kind === 'tool');
  const controlRecords = sweep.records.filter((record) => record.kind === 'control');

  const toolNames = [...new Set(toolRecords.map((record) => record.expectedTool))];
  const tools = toolNames.map((tool) =>
    rollUpTool({
      tool,
      records: toolRecords.filter((record) => record.expectedTool === tool),
      repeats: sweep.settings.repeats,
    })
  );

  const byTag = {};
  for (const record of toolRecords) {
    const tag = record.tag ?? 'untagged';
    byTag[tag] ??= { trials: 0, ok: 0 };
    byTag[tag].trials += 1;
    if (record.outcome === 'ok') byTag[tag].ok += 1;
  }
  for (const tag of Object.keys(byTag)) {
    byTag[tag].rate = byTag[tag].ok / byTag[tag].trials;
  }

  const overallOk = toolRecords.filter((record) => record.outcome === 'ok').length;

  return {
    schema: 'webmcp-gauge/report/1',
    generatedAt: new Date().toISOString(),
    subject: { url: sweep.settings.url, name: fixture.subject?.name ?? null },
    stamps: {
      utteranceSet: {
        version: fixture.version,
        frozen: fixture.frozen === true,
        authoringModel: fixture.authoring?.modelId ?? null,
      },
      judge: { model: judge.model, baseUrl: judge.baseUrl, requested: judge.requested ?? judge.model },
      browser,
      harness: { repeats: sweep.settings.repeats, concurrency: sweep.settings.concurrency },
    },
    invocation: {
      overall: { trials: toolRecords.length, ok: overallOk },
      perTool: tools,
      perTag: byTag,
    },
    controls:
      controlRecords.length > 0
        ? rollUpControls({ records: controlRecords, repeats: sweep.settings.repeats })
        : null,
    harnessFailures: sweep.failures,
    timing: sweep.timing,
  };
};

export const toMarkdown = (report) => {
  const lines = [];

  lines.push(`# webmcp-gauge — ${report.subject.name ?? report.subject.url}`);
  lines.push('');
  lines.push(
    `Utterance set \`${report.stamps.utteranceSet.version}\`${report.stamps.utteranceSet.frozen ? ' (frozen)' : ' (DRAFT — numbers are not comparable)'} · judge \`${report.stamps.judge.model}\` · browser \`${report.stamps.browser?.build ?? 'unknown'}\` · R=${report.stamps.harness.repeats}, concurrency ${report.stamps.harness.concurrency}`
  );
  lines.push('');
  lines.push(
    `Authored by \`${report.stamps.utteranceSet.authoringModel ?? 'unrecorded'}\`, which is disqualified as a judge for these numbers.`
  );
  lines.push('');

  lines.push('## Invocation rate');
  lines.push('');
  lines.push('| Tool | Rate (95% Wilson) | σ across runs | Trials | Outcomes |');
  lines.push('|---|---|---|---|---|');
  for (const tool of [...report.invocation.perTool].sort(
    (a, b) => (b.invocation.rate ?? 0) - (a.invocation.rate ?? 0)
  )) {
    const outcomes = Object.entries(tool.outcomes)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} ${count}`)
      .join(', ');
    lines.push(
      `| \`${tool.tool}\` | ${interval(tool.invocation)} | ${tool.variance.sigma === null ? '—' : tool.variance.sigma.toFixed(3)} | ${tool.trials} | ${outcomes} |`
    );
  }
  lines.push('');

  lines.push('## By phrasing difficulty');
  lines.push('');
  lines.push('| Tag | Rate | Trials |');
  lines.push('|---|---|---|');
  for (const tag of ['plain', 'paraphrase', 'oblique']) {
    const entry = report.invocation.perTag[tag];
    if (!entry) continue;
    lines.push(`| ${tag} | ${percent(entry.rate)} | ${entry.trials} |`);
  }
  lines.push('');

  if (report.controls) {
    lines.push('## Control false positives');
    lines.push('');
    lines.push(
      `A control utterance is one no registered tool can serve, so **not selecting anything is the pass**. This rate is never pooled with invocation rate.`
    );
    lines.push('');
    lines.push(`False positive rate: **${interval(report.controls.falsePositiveRate)}** over ${report.controls.trials} trials.`);
    lines.push('');
    lines.push('| Control class | False positives | Rate |');
    lines.push('|---|---|---|');
    for (const [tag, entry] of Object.entries(report.controls.byClass)) {
      lines.push(`| ${tag} | ${entry.falsePositives}/${entry.trials} | ${interval(entry.rate)} |`);
    }
    lines.push('');
    if (report.controls.injectionFailures.length > 0) {
      lines.push(
        `⚠️ **Injection-class false positives — a safety finding, not a scoring miss:** ${report.controls.injectionFailures
          .map((failure) => `${failure.id} → \`${failure.selected}\``)
          .join(', ')}`
      );
      lines.push('');
    }
  }

  if (report.harnessFailures.length > 0) {
    lines.push('## Harness failures');
    lines.push('');
    lines.push(
      'Trials that produced no measurement at all — an unreachable or truncated judge says nothing about the page. These are excluded from every rate above rather than counted as outcomes, and `--resume` retries them.'
    );
    lines.push('');
    for (const failure of report.harnessFailures) {
      lines.push(
        `- \`${failure.utteranceId}\` (repeat ${failure.repeat}, ${failure.kind ?? 'unknown'}): ${failure.error}`
      );
    }
    lines.push('');
  }

  lines.push(
    `_${report.invocation.overall.ok}/${report.invocation.overall.trials} tool trials returned \`ok\`. Generated ${report.generatedAt} in ${(report.timing.elapsedMs / 1000).toFixed(0)}s._`
  );

  return `${lines.join('\n')}\n`;
};
