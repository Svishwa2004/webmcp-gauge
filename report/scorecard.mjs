/**
 * A private scorecard for one captured project.
 *
 * Item 13 in the project log. The cohort snapshot already holds everything this
 * needs — the page's manifest verbatim, the agent-visible view, and the liveness
 * of the URL — and `core/lint.mjs` already knows what is wrong with a manifest.
 * What did not exist was the rendering, so this is that and nothing more: it
 * writes Markdown, it sends nothing, and the decision to hand one to anybody is
 * still a gate in the log rather than a function call here.
 *
 * Publication rules do not apply to a scorecard, and the distinction matters:
 * `toPublishable` withholds a builder's descriptions because publishing them
 * would republish their work to strangers. A scorecard goes **to that builder**,
 * about **their own page**, so quoting their own text back is the entire point —
 * a finding a reader cannot locate is not actionable.
 *
 * The tone rule encoded below: every finding names what a client or a model does
 * differently because of it. "Description too short" is a fact about a string;
 * "a model choosing between this and `filter_rows` has 14 characters to go on" is
 * a reason to act. Findings the harness cannot justify that way are not shipped.
 */
import { lintManifest } from '../core/lint.mjs';

const severityLabel = { error: 'Error', warning: 'Warning' };

/** Rules whose fix is not obvious from the finding alone get a sentence here. */
const REMEDY = Object.freeze({
  'name/invalid-characters': 'Rename using letters, digits, underscores or hyphens only.',
  'name/too-long': 'Shorten it; a name is an identifier, not a sentence.',
  'name/duplicate': 'Two tools cannot share a name — the second registration is the one an agent will not see.',
  'description/missing': 'Write one sentence saying what the tool does and when to use it.',
  'description/too-short': 'Say what it does *and* when to prefer it over its neighbours.',
  'description/duplicate': 'Two tools described alike are two tools an agent cannot choose between; make the difference explicit in both.',
  'description/near-duplicate': 'Make the distinguishing condition the first thing each description says.',
  'schema/missing': 'Declare an `inputSchema`, even an empty object — a client cannot validate what is not described.',
  'schema/no-properties': 'If the tool takes arguments, name them; if it takes none, say so with an empty `properties`.',
  'schema/untyped-property': 'Give each property a `type`; an untyped property is a guess at call time.',
  'schema/undocumented-property': 'Describe each property — the description is what a model fills it from.',
  'schema/required-not-declared': 'List required properties in `required`, or a client will send a call that cannot succeed.',
  'budget/too-many-tools': 'Consider grouping; a long manifest costs context on every turn.',
});

/**
 * Everything the scorecard says, as data. Rendered separately so the numbers can
 * be checked without parsing prose.
 */
export const buildScorecard = (record, { lintOptions = {} } = {}) => {
  const manifest = {
    present: record?.webmcp?.apiPresent ?? null,
    settled: record?.webmcp?.settled ?? null,
    tools: record?.webmcp?.tools ?? [],
  };
  const lint = lintManifest({ manifest, options: lintOptions });

  const byTool = new Map();
  for (const finding of lint.findings) {
    if (!byTool.has(finding.tool)) byTool.set(finding.tool, []);
    byTool.get(finding.tool).push(finding);
  }

  // Errors first, then the tools carrying the most findings: a builder with ten
  // minutes should spend them where the manifest is worst.
  const priorities = [...byTool.entries()]
    .map(([tool, findings]) => ({
      tool,
      findings,
      errors: findings.filter((f) => f.severity === 'error').length,
    }))
    .sort((a, b) => b.errors - a.errors || b.findings.length - a.findings.length || a.tool.localeCompare(b.tool));

  const agentCount = record?.webmcp?.agentToolCount ?? null;
  const pageCount = record?.webmcp?.toolCount ?? 0;

  return {
    schema: 'webmcp-gauge/scorecard/1',
    generatedAt: new Date().toISOString(),
    project: record?.project ?? null,
    url: record?.url ?? null,
    repo: record?.repo ?? null,
    capturedAt: record?.capturedAt ?? null,
    liveness: record?.liveness ?? null,
    tools: {
      registeredByThePage: pageCount,
      visibleToAnAgent: agentCount,
      // Stated only when the two disagree, because when they agree it is noise —
      // and when they disagree it is the most surprising line on the page.
      divergence: record?.webmcp?.divergence?.onlyInBrowser?.length
        ? {
            onlyInBrowser: record.webmcp.divergence.onlyInBrowser,
            thirdParty: record.webmcp.thirdPartyToolCount ?? null,
          }
        : null,
    },
    counts: lint.counts,
    priorities,
    lint,
  };
};

export const scorecardToMarkdown = (card) => {
  const lines = [];
  const { counts, tools } = card;

  lines.push(`# WebMCP scorecard — ${card.project}`);
  lines.push('');
  lines.push(`**Page:** ${card.url}`);
  if (card.repo) lines.push(`**Repo:** ${card.repo}`);
  lines.push(`**Captured:** ${card.capturedAt}`);
  lines.push(
    `**Result:** ${counts.error} error${counts.error === 1 ? '' : 's'}, ${counts.warning} warning${counts.warning === 1 ? '' : 's'} across ${tools.registeredByThePage} registered tool${tools.registeredByThePage === 1 ? '' : 's'}`
  );
  lines.push('');
  lines.push(
    'This is a static reading of your tool manifest, taken from your live page. It is **not** an invocation rate — nothing here says how often an agent chooses your tools, only what a client and a model have to work with when they try.'
  );
  lines.push('');

  if (tools.divergence) {
    lines.push('## An agent sees tools your page cannot list');
    lines.push('');
    lines.push(
      `Your page's \`getTools()\` returns **${tools.registeredByThePage}**, but the browser offers an agent **${tools.visibleToAnAgent}**: ${tools.divergence.onlyInBrowser.map((n) => `\`${n}\``).join(', ')}. On Chrome 152 that happens when a cross-origin embed is granted \`allow="tools"\` — its registrations reach the agent while appearing in no page's manifest. Worth knowing if you did not intend it, because you cannot enumerate it from script.`
    );
    lines.push('');
  }

  if (card.priorities.length === 0) {
    lines.push('## Nothing to fix');
    lines.push('');
    lines.push('Every rule passed. The manifest is as legible as this linter knows how to check for.');
    lines.push('');
  } else {
    lines.push('## What to fix, worst first');
    lines.push('');
    for (const { tool, findings } of card.priorities) {
      lines.push(`### \`${tool}\``);
      lines.push('');
      for (const finding of findings) {
        const remedy = REMEDY[finding.rule];
        lines.push(`- **${severityLabel[finding.severity] ?? finding.severity}** · \`${finding.rule}\` — ${finding.detail}`);
        if (remedy) lines.push(`  - ${remedy}`);
      }
      lines.push('');
    }
  }

  lines.push('## How this was measured');
  lines.push('');
  lines.push(
    `Your page was loaded once in Chrome with WebMCP enabled, its manifest read after settling, and ${card.lint.families.length > 0 ? `the ${card.lint.families.join(', ')} rule families applied` : 'every rule applied'}. Thresholds: ${Object.entries(card.lint.thresholds).map(([k, v]) => `${k}=${v}`).join(', ')}. Nothing was submitted to your page and no tool was invoked.`
  );
  lines.push('');
  lines.push('Findings are advisory. If a rule is wrong about your page, it is the rule that needs fixing.');
  lines.push('');

  return `${lines.join('\n')}`;
};
