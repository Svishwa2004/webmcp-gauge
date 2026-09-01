import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBadge, renderBadgeSvg, BADGE_THRESHOLDS } from './badge.mjs';

const report = ({ ok, trials, missing = 0, expected = trials }) => ({
  invocation: { overall: { ok, trials } },
  coverage: missing > 0 ? { missingTrials: missing, expectedTrials: expected } : { missingTrials: 0, expectedTrials: expected },
});

test('a complete run shows the rate and the trial count, so 20 cannot pass for 1000', () => {
  const badge = buildBadge(report({ ok: 399, trials: 480 }));
  assert.equal(badge.message, '83% (n=480)');
  assert.equal(badge.schemaVersion, 1);
  assert.ok(!badge.isError);
});

/**
 * The rule this file exists for. A rate over a denominator the run did not choose
 * is the wrong number however it is coloured, and the exit-code contract already
 * says incomplete outranks everything else.
 */
test('a run with unmeasured trials shows incomplete, never a rate', () => {
  const badge = buildBadge(report({ ok: 100, trials: 100, missing: 60, expected: 160 }));
  assert.equal(badge.message, 'incomplete (100/160)');
  assert.equal(badge.color, 'lightgrey');
  assert.equal(badge.isError, true);
  assert.ok(!/%/.test(badge.message), 'a percentage must not appear on an incomplete run');
});

test('a perfect but incomplete run still says incomplete, not 100%', () => {
  const badge = buildBadge(report({ ok: 20, trials: 20, missing: 140, expected: 160 }));
  assert.match(badge.message, /^incomplete/);
});

test('no trials at all is an error state rather than a zero', () => {
  const badge = buildBadge(report({ ok: 0, trials: 0 }));
  assert.equal(badge.message, 'no trials');
  assert.equal(badge.isError, true);
  const missingReport = buildBadge({});
  assert.equal(missingReport.message, 'no trials');
});

/**
 * Caught by generating a badge from a real published report: the 960-trial
 * reference run predates schema 3 and carries no `coverage` block at all, and
 * `report/emit.mjs` says plainly that its absence means unknown rather than
 * complete. The first version of this file read it as zero missing trials and
 * happily published "99% (n=840)" for a run whose completeness nobody had
 * established.
 */
test('a schema-2 report with no coverage block says unknown, not a rate', () => {
  const badge = buildBadge({ invocation: { overall: { ok: 831, trials: 840 } } });
  assert.equal(badge.message, 'coverage unknown');
  assert.equal(badge.color, 'lightgrey');
  assert.equal(badge.isError, true);
  assert.ok(!/%/.test(badge.message));
});

test('zero of many is red and says so, which is different from having no trials', () => {
  const badge = buildBadge(report({ ok: 0, trials: 60 }));
  assert.equal(badge.message, '0% (n=60)');
  assert.equal(badge.color, 'red');
});

test('colour bands are ordered and cover the whole range', () => {
  const rates = BADGE_THRESHOLDS.map((band) => band.atLeast);
  assert.deepEqual(rates, [...rates].sort((a, b) => b - a), 'bands must be descending or the first match is wrong');
  assert.equal(rates.at(-1), 0, 'the last band must catch every remaining rate');
});

test('the band boundaries are inclusive, so exactly 95% is the better colour', () => {
  assert.equal(buildBadge(report({ ok: 95, trials: 100 })).color, 'brightgreen');
  assert.equal(buildBadge(report({ ok: 94, trials: 100 })).color, 'green');
  assert.equal(buildBadge(report({ ok: 85, trials: 100 })).color, 'green');
  assert.equal(buildBadge(report({ ok: 60, trials: 100 })).color, 'yellow');
});

test('the label can be overridden, because a repo may measure more than one page', () => {
  const badge = buildBadge(report({ ok: 1, trials: 1 }), { label: 'airlock' });
  assert.equal(badge.label, 'airlock');
});

test('the SVG is self-contained: no external font, no network reference', () => {
  const svg = renderBadgeSvg(buildBadge(report({ ok: 399, trials: 480 })));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(!/<image|xlink:href|@import|https?:\/\/(?!www\.w3\.org)/.test(svg), 'nothing may be fetched to render this');
  assert.match(svg, /83% \(n=480\)/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /<title>/, 'a badge without a title is unreadable to a screen reader');
});

test('angle brackets and ampersands in a label cannot break the SVG', () => {
  const svg = renderBadgeSvg(buildBadge(report({ ok: 1, trials: 1 }), { label: 'a & b <c>' }));
  assert.match(svg, /a &amp; b &lt;c&gt;/);
  assert.ok(!/<c>/.test(svg));
});
