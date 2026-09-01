import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTargets,
  robotsAllows,
  toRecord,
  toPublishable,
  summarize,
  attributeTools,
  localDateStamp,
  HARNESS_UA_SUFFIX,
} from './cohort.mjs';

/**
 * The capture's whole claim is the date it was taken on, and this machine runs at
 * UTC+5:30 — a run started at 00:30 local would be filed under yesterday if the
 * stamp came from toISOString().
 */
test('the date stamp is local, not UTC', () => {
  // 2026-09-02T00:30 in a +05:30 zone is 2026-09-01T19:00Z. The stamp must follow
  // the operator's calendar, whatever the machine's offset happens to be.
  const local = new Date(2026, 8, 2, 0, 30, 0);
  assert.equal(localDateStamp(local), '2026-09-02');
  assert.equal(localDateStamp(new Date(2026, 0, 5, 23, 59)), '2026-01-05', 'months and days are zero-padded');
});

test('a bare hostname becomes an https URL, and the project name defaults to the host', () => {
  const [row] = normalizeTargets(['example.netlify.app']);
  assert.equal(row.url, 'https://example.netlify.app/');
  assert.equal(row.project, 'example.netlify.app');
  assert.equal(row.repo, null);
});

test('the same page under two spellings is one capture, not two visits', () => {
  const rows = normalizeTargets([
    'https://a.example/demo/',
    'https://a.example/demo',
    'https://a.example/demo#tools',
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].aliases, ['https://a.example/demo', 'https://a.example/demo']);
});

test('a query string is part of identity, because a variant is a different page', () => {
  const rows = normalizeTargets(['https://a.example/t?variant=clean', 'https://a.example/t?variant=degraded']);
  assert.equal(rows.length, 2);
});

test('an entry with no url, or a non-http scheme, is refused rather than skipped', () => {
  assert.throws(() => normalizeTargets([{ project: 'x' }]), /has no url/);
  assert.throws(() => normalizeTargets(['ftp://a.example/x']), /not http/);
  assert.throws(() => normalizeTargets('not an array'), TypeError);
});

test('missing or empty robots.txt is permission, which is what the standard says', () => {
  assert.equal(robotsAllows('', '/demo'), true);
  assert.equal(robotsAllows(null, '/demo'), true);
});

test('a wildcard Disallow blocks, and an empty Disallow allows everything', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', '/demo'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow:', '/demo'), true);
});

test('the longest matching rule wins, so a nested Allow beats a broad Disallow', () => {
  const robots = 'User-agent: *\nDisallow: /private\nAllow: /private/public';
  assert.equal(robotsAllows(robots, '/private/secret'), false);
  assert.equal(robotsAllows(robots, '/private/public/page'), true);
});

test('a rule naming us specifically overrides the wildcard group entirely', () => {
  const robots = 'User-agent: *\nDisallow: /\n\nUser-agent: webmcp-gauge\nDisallow: /admin';
  assert.equal(robotsAllows(robots, '/demo'), true, 'our own group replaces the wildcard one');
  assert.equal(robotsAllows(robots, '/admin/x'), false);
});

test('wildcards and end-anchors in patterns are honoured', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/files/a.pdf'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/files/a.pdf.html'), true);
});

test('comments and blank lines do not become rules', () => {
  const robots = '# nothing to see\n\nUser-agent: *\n# Disallow: /\nAllow: /\n';
  assert.equal(robotsAllows(robots, '/demo'), true);
});

const manifest = {
  present: true,
  settled: true,
  inNavigator: false,
  tools: [
    {
      name: 'sum_by_category',
      description: 'Totals spending per category and optionally highlights one.',
      inputSchema: { type: 'object', properties: { highlight: { type: 'string' } }, required: ['highlight'] },
      inputSchemaWire: 'string',
      annotations: { readOnlyHint: true },
    },
  ],
};

test('the local record keeps the manifest verbatim, because the text is the measured object', () => {
  const record = toRecord({
    target: { project: 'airlock', url: 'https://airlock.example/', repo: null, aliases: [] },
    capturedAt: '2026-09-04T00:00:00.000Z',
    status: 200,
    finalUrl: 'https://airlock.example/',
    title: 'Airlock',
    manifest,
  });

  assert.equal(record.webmcp.tools[0].description, manifest.tools[0].description);
  assert.equal(record.liveness.reachable, true);
  assert.equal(record.liveness.redirected, false);
  assert.equal(record.webmcp.toolCount, 1);
  assert.equal(record.webmcp.registered, true);
});

/**
 * The defect this guards against was found by the 2026-09-01 dry run, not by
 * reasoning: document.modelContext exists on every page in a WebMCP-enabled
 * browser, so "present" was true for example.com and for a 404 page.
 */
test('a page where only the browser API exists has not adopted WebMCP', () => {
  const record = toRecord({
    target: { project: 'example.com', url: 'https://example.com/', repo: null, aliases: [] },
    capturedAt: 'now',
    status: 200,
    finalUrl: 'https://example.com/',
    manifest: { present: true, settled: false, tools: [] },
  });

  assert.equal(record.webmcp.apiPresent, true, 'the browser fact is still recorded');
  assert.equal(record.webmcp.registered, false, 'but it is not adoption');
  assert.equal(record.webmcp.toolCount, 0);
});

test('a redirect is recorded as one, and a 4xx page registers nothing whatever its error document does', () => {
  const target = { project: 'x', url: 'https://x.example/', repo: null, aliases: [] };
  const moved = toRecord({ target, capturedAt: 'now', status: 200, finalUrl: 'https://y.example/' });
  assert.equal(moved.liveness.redirected, true);

  const gone = toRecord({ target, capturedAt: 'now', status: 404, finalUrl: 'https://x.example/', manifest });
  assert.equal(gone.liveness.reachable, false);
  assert.equal(gone.webmcp.registered, false);
  assert.equal(gone.webmcp.toolCount, 0, 'a 404 page\u2019s tools are not the project\u2019s tools');
  assert.deepEqual(gone.webmcp.tools, []);
});

test('the published row carries tool names and shapes but never a description', () => {
  const record = toRecord({
    target: { project: 'airlock', url: 'https://airlock.example/', repo: 'https://github.com/x/y', aliases: [] },
    capturedAt: '2026-09-04T00:00:00.000Z',
    status: 200,
    finalUrl: 'https://airlock.example/',
    title: 'Airlock',
    manifest,
  });
  const published = toPublishable(record);

  const serialized = JSON.stringify(published);
  assert.ok(!serialized.includes('Totals spending'), 'a description must not leave this machine');
  assert.equal(published.tools[0].name, 'sum_by_category');
  assert.equal(published.tools[0].descriptionLength, manifest.tools[0].description.length);
  assert.equal(published.tools[0].propertyCount, 1);
  assert.equal(published.tools[0].requiredCount, 1);
  assert.equal(published.tools[0].hasAnnotations, true);
  assert.equal(published.usesWebmcp, true);
  assert.equal(published.title, undefined, 'a page title is prose too, and is not published');
});

test('the census counts adoption, not browser support', () => {
  const at = '2026-09-04T00:00:00.000Z';
  const mk = (project, status, tools) =>
    toRecord({
      target: { project, url: `https://${project}.example/`, repo: null, aliases: [] },
      capturedAt: at,
      status,
      finalUrl: `https://${project}.example/`,
      // present: true everywhere, because that is what a WebMCP-enabled browser
      // actually reports — the census must not be fooled by it.
      manifest: { present: true, tools },
    });

  const summary = summarize([
    mk('live-with-tools', 200, [{ name: 'a' }, { name: 'b' }]),
    mk('live-registered-nothing', 200, []),
    mk('dead-with-an-error-page', 404, [{ name: 'ghost' }]),
  ]);

  assert.equal(summary.projects, 3);
  assert.equal(summary.reachable, 2);
  assert.equal(summary.dead, 1);
  assert.equal(summary.usingWebmcp, 1, 'one project registered a tool');
  assert.equal(summary.reachableWithoutTools, 1);
  assert.equal(summary.totalTools, 2);
  assert.equal(summary.maxToolCount, 2);
});

/**
 * The union decision, taken 2026-09-02 before the capture. A cross-origin embed
 * with allow="tools" puts a tool in the browser's view and in nobody's
 * getTools(), so "what this builder shipped" and "what an agent can call here"
 * stop being the same number. Both are captured; neither is allowed to stand in
 * for the other.
 */
const embedRecord = () =>
  toRecord({
    target: { project: 'host', url: 'https://host.example/', repo: null, aliases: [] },
    capturedAt: 'now',
    status: 200,
    finalUrl: 'https://host.example/',
    manifest: { present: true, tools: [{ name: 'own_one', description: 'x' }] },
    browserTools: [
      { name: 'own_one', frameId: 'F1' },
      {
        name: 'embedded_pay',
        frameId: 'F2',
        stackTrace: { callFrames: [{ url: 'https://widget.example/w.js' }] },
      },
    ],
    frames: [
      { id: 'F1', origin: 'https://host.example' },
      { id: 'F2', origin: 'https://widget.example' },
    ],
  });

test('a third party\u2019s tool is agent-visible but never credited to the page', () => {
  const record = embedRecord();

  assert.equal(record.webmcp.toolCount, 1, 'the page shipped one tool');
  assert.equal(record.webmcp.agentToolCount, 2, 'an agent can call two');
  assert.equal(record.webmcp.thirdPartyToolCount, 1);
  assert.deepEqual(record.webmcp.divergence.onlyInBrowser, ['embedded_pay']);
  assert.deepEqual(record.webmcp.divergence.onlyInPage, []);

  const attributed = record.webmcp.attribution.find((t) => t.name === 'embedded_pay');
  assert.equal(attributed.origin, 'https://widget.example');
  assert.equal(attributed.sameOrigin, false);
});

test('the published row carries the counts but not a third party\u2019s identity', () => {
  const published = toPublishable(embedRecord());

  assert.equal(published.toolCount, 1);
  assert.equal(published.agentVisibleToolCount, 2);
  assert.equal(published.thirdPartyToolCount, 1);
  assert.equal(published.viewsDiverge, true);
  assert.ok(
    !JSON.stringify(published).includes('widget.example'),
    "a fourth party's origin must not appear in somebody else's published row"
  );
});

test('a tool whose origin cannot be established is unattributed, not assumed to be the page\u2019s', () => {
  const attributed = attributeTools([{ name: 'mystery', frameId: 'gone' }], [], 'https://host.example');
  assert.equal(attributed[0].origin, null);
  assert.equal(attributed[0].sameOrigin, null, 'null, not true');
});

test('no browser view means null throughout, never zero or an empty list', () => {
  const record = toRecord({
    target: { project: 'x', url: 'https://x.example/', repo: null, aliases: [] },
    capturedAt: 'now',
    status: 200,
    finalUrl: 'https://x.example/',
    manifest: { present: true, tools: [{ name: 'a' }] },
    browserTools: null,
  });

  assert.equal(record.webmcp.agentTools, null);
  assert.equal(record.webmcp.agentToolCount, null);
  assert.equal(record.webmcp.divergence, null);
  assert.equal(record.webmcp.thirdPartyToolCount, null);

  const summary = summarize([record]);
  assert.equal(summary.pagesWithAgentView, 0);
  assert.equal(summary.totalAgentVisibleTools, null, 'a cohort with no browser view reports null, not 0');
  assert.equal(summary.pagesWhereViewsDiverge, null);
});

test('the census reports agent-side totals separately from adoption', () => {
  const summary = summarize([embedRecord()]);

  assert.equal(summary.usingWebmcp, 1);
  assert.equal(summary.totalTools, 1, 'adoption counts what the builder shipped');
  assert.equal(summary.totalAgentVisibleTools, 2, 'reality counts what an agent can call');
  assert.equal(summary.pagesWithThirdPartyTools, 1);
  assert.equal(summary.pagesWhereViewsDiverge, 1);
});

test('an empty cohort summarizes to zeroes rather than throwing', () => {
  const summary = summarize([]);
  assert.equal(summary.projects, 0);
  assert.equal(summary.medianToolCount, null);
  assert.equal(summary.maxToolCount, null);
});

test('the user agent identifies the harness and offers a contact, per the publishing policy', () => {
  assert.match(HARNESS_UA_SUFFIX, /webmcp-gauge/);
  assert.match(HARNESS_UA_SUFFIX, /github\.com/);
});
