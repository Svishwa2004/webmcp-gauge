import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTargets,
  robotsAllows,
  toRecord,
  toPublishable,
  summarize,
  HARNESS_UA_SUFFIX,
} from './cohort.mjs';

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
