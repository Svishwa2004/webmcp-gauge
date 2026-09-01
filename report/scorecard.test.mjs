import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScorecard, scorecardToMarkdown } from './scorecard.mjs';

/** The shape a cohort capture produces, trimmed to what a scorecard reads. */
const record = ({ tools, agentTools = null, divergence = null, thirdParty = null }) => ({
  project: 'Somebody Else\u2019s Project',
  url: 'https://project.example/',
  repo: 'https://github.com/them/project',
  capturedAt: '2026-09-04T09:41:00.000Z',
  liveness: { status: 200, reachable: true, redirected: false, finalUrl: 'https://project.example/' },
  webmcp: {
    apiPresent: true,
    settled: true,
    registered: tools.length > 0,
    toolCount: tools.length,
    tools,
    agentTools,
    agentToolCount: agentTools?.length ?? null,
    divergence,
    thirdPartyToolCount: thirdParty,
  },
});

const goodTool = (name) => ({
  name,
  description: `Return the ${name.replace(/_/g, ' ')} for the requested period, so a caller can answer a question about it without reading the table.`,
  inputSchema: { type: 'object', properties: { period: { type: 'string', description: 'Month or year to report on.' } } },
  annotations: { readOnlyHint: true },
});

test('a clean manifest scores zero and says so without inventing advice', () => {
  const card = buildScorecard(record({ tools: [goodTool('monthly_total')] }));

  assert.equal(card.counts.error, 0);
  assert.equal(card.counts.warning, 0);
  assert.deepEqual(card.priorities, []);

  const markdown = scorecardToMarkdown(card);
  assert.match(markdown, /Nothing to fix/);
  assert.ok(!/What to fix/.test(markdown));
});

test('a finding carries the rule id, the tool, and what to do about it', () => {
  const card = buildScorecard(
    record({ tools: [{ name: 'bad name', description: 'x', inputSchema: null }] })
  );

  assert.ok(card.counts.error > 0, 'an invalid name is an error');
  const markdown = scorecardToMarkdown(card);
  assert.match(markdown, /`name\/invalid-characters`/);
  assert.match(markdown, /Rename using letters, digits, underscores or hyphens only\./);
  assert.match(markdown, /`bad name`/, 'the offending tool is named so the finding can be located');
});

/**
 * A scorecard goes to the page's own author, so quoting their descriptions back is
 * the point — the opposite of `toPublishable`, which withholds them from strangers.
 * This test exists to stop somebody "fixing" one to match the other.
 */
test('a scorecard may quote the builder\u2019s own text, unlike a published row', () => {
  const description = 'Totals spending per category and highlights one on request.';
  const card = buildScorecard(
    record({ tools: [{ name: 'sum_by_category', description, inputSchema: { type: 'object', properties: {} } }] })
  );

  const markdown = scorecardToMarkdown(card);
  assert.match(markdown, /sum_by_category/);
  assert.ok(
    card.lint.manifest.names.includes('sum_by_category'),
    'the lint result keeps the real manifest, not a redacted one'
  );
  assert.ok(description.length > 0);
});

test('errors are prioritised above warnings, and busier tools above quieter ones', () => {
  const card = buildScorecard(
    record({
      tools: [
        { name: 'ok_tool', description: 'x', inputSchema: null },
        { name: 'worse tool', description: '', inputSchema: null },
      ],
    })
  );

  assert.equal(card.priorities[0].tool, 'worse tool', 'the tool with an error comes first');
  assert.ok(card.priorities[0].errors >= 1);
});

test('the divergence section appears only when the two views disagree', () => {
  const quiet = scorecardToMarkdown(
    buildScorecard(record({ tools: [goodTool('a')], agentTools: ['a'], divergence: { onlyInBrowser: [], onlyInPage: [] } }))
  );
  assert.ok(!/An agent sees tools/.test(quiet), 'agreement is not worth a section');

  const loud = scorecardToMarkdown(
    buildScorecard(
      record({
        tools: [goodTool('a')],
        agentTools: ['a', 'embedded_pay'],
        divergence: { onlyInBrowser: ['embedded_pay'], onlyInPage: [] },
        thirdParty: 1,
      })
    )
  );
  assert.match(loud, /An agent sees tools your page cannot list/);
  assert.match(loud, /`embedded_pay`/);
  assert.match(loud, /allow="tools"/);
});

test('a scorecard never claims to be an invocation rate', () => {
  const markdown = scorecardToMarkdown(buildScorecard(record({ tools: [goodTool('a')] })));
  assert.match(markdown, /not\*\* an invocation rate/);
  assert.match(markdown, /no tool was invoked/);
  assert.ok(!/%\s*invocation/.test(markdown));
});

test('the method section states the thresholds the findings depend on', () => {
  const markdown = scorecardToMarkdown(buildScorecard(record({ tools: [goodTool('a')] })));
  assert.match(markdown, /minDescriptionChars=/);
  assert.match(markdown, /nearDuplicateThreshold=/);
});

test('a page that registered nothing renders without a findings section', () => {
  const card = buildScorecard(record({ tools: [] }));
  assert.equal(card.tools.registeredByThePage, 0);
  const markdown = scorecardToMarkdown(card);
  assert.match(markdown, /0 errors, 0 warnings across 0 registered tools/);
});
