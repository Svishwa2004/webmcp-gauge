/**
 * Report emitters.
 *
 * A report that does not name its judge, its browser build and its utterance-set
 * version is not a measurement, because invocation rate is a property of
 * (page, client, judge, utterances) rather than of the page alone. Every stamp
 * therefore travels with the numbers, and the Markdown is generated from the same
 * object as the JSON so the two cannot drift.
 *
 * Two spreads are reported and never merged: between-session sigma, which compares
 * whole sessions that shared nothing but the machine, and within-session sigma,
 * which compares repeats that shared a browser and a warm cache. The first two
 * sweeps of this project reported the second and described it as the first.
 */
import { rollUpControls, rollUpTool } from '../core/stats.mjs';

const percent = (value) =>
  value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;

const sigma = (value) => (typeof value === 'number' ? value.toFixed(3) : '—');

const interval = (wilsonResult) =>
  !wilsonResult || wilsonResult.rate === null
    ? '—'
    : `${percent(wilsonResult.rate)} [${percent(wilsonResult.low)}, ${percent(wilsonResult.high)}]`;

export const buildReport = ({
  fixture,
  records,
  harnessFailures = [],
  judge,
  settings,
  sessionResults = [],
  timing,
}) => {
  const toolRecords = records.filter((record) => record.kind === 'tool');
  const controlRecords = records.filter((record) => record.kind === 'control');

  const toolNames = [...new Set(toolRecords.map((record) => record.expectedTool))];
  const tools = toolNames.map((tool) =>
    rollUpTool({ tool, records: toolRecords.filter((record) => record.expectedTool === tool) })
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

  const sessionMetas = [];
  for (const record of records) {
    const session = record.session ?? 1;
    if (sessionMetas.some((entry) => entry.session === session)) continue;
    sessionMetas.push({ session, ...(record.sessionMeta ?? {}) });
  }

  return {
    schema: 'webmcp-gauge/report/2',
    generatedAt: new Date().toISOString(),
    subject: { url: settings.url, name: fixture.subject?.name ?? null },
    stamps: {
      utteranceSet: {
        version: fixture.version,
        frozen: fixture.frozen === true,
        authoringModel: fixture.authoring?.modelId ?? null,
      },
      judge,
      harness: {
        sessions: settings.sessions,
        repeatsPerSession: settings.repeatsPerSession,
        concurrency: settings.concurrency,
        gapSeconds: settings.gapSeconds ?? 0,
        isolatedSessions: settings.isolatedSessions !== false,
      },
      browsers: sessionMetas,
    },
    /**
     * What a session does not isolate. Stated in the artifact rather than in a
     * commit message, because someone reading the number a month from now is the
     * person who needs it.
     */
    isolationCaveats: [
      'Sessions share the machine, the OS network stack and the route to the provider.',
      'Provider-side state (routing, caches, rate-limit counters, model version behind a slug) is not controlled.',
      settings.gapSeconds > 0
        ? `Sessions were spaced ${settings.gapSeconds}s apart, which is not the same as spanning days.`
        : 'Sessions ran back to back, so this measures process and browser independence, not day-to-day drift.',
      settings.isolatedSessions === false
        ? 'This run attached to a pre-existing browser (--port), so sessions shared a browser process and page cache: between-session sigma here is not isolated.'
        : 'Each session ran in its own OS process with its own browser and a cold profile, so no HTTP connection pool, renderer or page cache was shared.',
    ],
    invocation: {
      overall: {
        trials: toolRecords.length,
        ok: toolRecords.filter((record) => record.outcome === 'ok').length,
      },
      perTool: tools,
      perTag: byTag,
    },
    controls: controlRecords.length > 0 ? rollUpControls({ records: controlRecords }) : null,
    harnessFailures,
    sessionResults,
    timing,
  };
};

export const toMarkdown = (report) => {
  const lines = [];
  const { harness } = report.stamps;

  lines.push(`# webmcp-gauge — ${report.subject.name ?? report.subject.url}`);
  lines.push('');
  lines.push(
    `Utterance set \`${report.stamps.utteranceSet.version}\`${report.stamps.utteranceSet.frozen ? ' (frozen)' : ' (DRAFT — numbers are not comparable)'} · judge \`${report.stamps.judge.model}\` · ${harness.sessions} session${harness.sessions === 1 ? '' : 's'} × ${harness.repeatsPerSession} repeat${harness.repeatsPerSession === 1 ? '' : 's'} · concurrency ${harness.concurrency}${harness.isolatedSessions ? '' : ' · **shared browser, sessions not isolated**'}`
  );
  lines.push('');
  lines.push(
    `Authored by \`${report.stamps.utteranceSet.authoringModel ?? 'unrecorded'}\`, which is disqualified as a judge for these numbers.`
  );
  lines.push('');

  lines.push('## Invocation rate');
  lines.push('');
  lines.push('| Tool | Rate (95% Wilson) | σ between sessions | σ within session | Trials | Outcomes |');
  lines.push('|---|---|---|---|---|---|');
  for (const tool of [...report.invocation.perTool].sort(
    (a, b) => (b.invocation.rate ?? 0) - (a.invocation.rate ?? 0)
  )) {
    const outcomes = Object.entries(tool.outcomes)
      .sort((a, b) => b[1] - a[1])
      .map(([outcome, count]) => `${outcome} ${count}`)
      .join(', ');
    lines.push(
      `| \`${tool.tool}\` | ${interval(tool.invocation)} | ${sigma(tool.betweenSession.sigma)} | ${sigma(tool.withinSession.sigma)} | ${tool.trials} | ${outcomes} |`
    );
  }
  lines.push('');
  lines.push(
    '**σ between sessions** compares whole sessions, each with its own process, browser and cold profile — the only figure that speaks to reproducibility. **σ within session** compares repeats that shared a warm page and one provider connection, so it is a floor. Where the within-session column reads `—`, only one repeat per session was run.'
  );
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
      'A control utterance is one no registered tool can serve, so **not selecting anything is the pass**. This rate is never pooled with invocation rate.'
    );
    lines.push('');
    lines.push(
      `False positive rate: **${interval(report.controls.falsePositiveRate)}** over ${report.controls.trials} trials · σ between sessions ${sigma(report.controls.betweenSession.sigma)}.`
    );
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
          .map((failure) => `${failure.id} (session ${failure.session}) → \`${failure.selected}\``)
          .join(', ')}`
      );
      lines.push('');
    }
  }

  lines.push('## What a session does not isolate');
  lines.push('');
  for (const caveat of report.isolationCaveats) lines.push(`- ${caveat}`);
  lines.push('');

  if (report.stamps.browsers.length > 0) {
    lines.push('| Session | Browser | Headless | Profile |');
    lines.push('|---|---|---|---|');
    for (const entry of report.stamps.browsers) {
      lines.push(
        `| ${entry.session} | ${entry.build ?? 'attached'} | ${entry.headless === undefined ? '—' : String(entry.headless)} | ${entry.profileDir ?? entry.note ?? '—'} |`
      );
    }
    lines.push('');
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
        `- \`${failure.utteranceId}\` (session ${failure.session ?? '?'}, repeat ${failure.repeat}, ${failure.kind ?? 'unknown'}): ${failure.error}`
      );
    }
    lines.push('');
  }

  lines.push(
    `_${report.invocation.overall.ok}/${report.invocation.overall.trials} tool trials returned \`ok\`. Generated ${report.generatedAt} in ${(report.timing.elapsedMs / 1000).toFixed(0)}s._`
  );

  return `${lines.join('\n')}\n`;
};
