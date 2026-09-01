/**
 * The badge a CI run leaves behind.
 *
 * A badge is a bare number in a coloured pill, which is exactly the thing this
 * project refuses to publish. That tension is not resolved by making the badge
 * prettier; it is resolved by making the badge unable to overstate:
 *
 *  - a run with unmeasured trials shows **incomplete**, never a rate, because a
 *    rate over a denominator the run did not choose is the wrong number however
 *    it is coloured (this mirrors the exit-code contract, where incomplete
 *    outranks a breach);
 *  - the message carries `n`, so a 100% from twenty trials cannot be mistaken
 *    for a 100% from a thousand;
 *  - colour is a threshold, not a grade, and the thresholds are stated here
 *    rather than tuned to flatter a particular subject.
 *
 * The output is the Shields "endpoint" schema, which any README can point at
 * without this project hosting anything, plus a self-contained SVG for repos
 * that would rather not call out to a third party at page load.
 */

/** Thresholds are deliberately coarse: a badge is a smoke alarm, not a gauge. */
export const BADGE_THRESHOLDS = [
  { atLeast: 0.95, color: 'brightgreen' },
  { atLeast: 0.85, color: 'green' },
  { atLeast: 0.7, color: 'yellowgreen' },
  { atLeast: 0.5, color: 'yellow' },
  { atLeast: 0.0, color: 'red' },
];

const colorFor = (rate) => BADGE_THRESHOLDS.find((band) => rate >= band.atLeast)?.color ?? 'lightgrey';

/**
 * Reads only what a finished report already carries, so a badge can never
 * disagree with the report beside it.
 */
export const buildBadge = (report, { label = 'webmcp invocation' } = {}) => {
  const overall = report?.invocation?.overall ?? null;

  if (!overall || overall.trials === 0) {
    return { schemaVersion: 1, label, message: 'no trials', color: 'lightgrey', isError: true };
  }

  // A schema-2 report has no `coverage` block, and `report/emit.mjs` is explicit
  // that its absence means **unknown**, not complete — that is why the schema
  // version moved. Reading a missing block as zero missing trials would publish a
  // rate for a run whose completeness nobody established, which is the exact
  // overstatement this file exists to prevent.
  if (!report.coverage) {
    return { schemaVersion: 1, label, message: 'coverage unknown', color: 'lightgrey', isError: true };
  }

  const missing = report.coverage.missingTrials ?? 0;
  if (missing > 0) {
    const expected = report.coverage.expectedTrials ?? overall.trials + missing;
    return {
      schemaVersion: 1,
      label,
      // Named for what it is. "incomplete" is not a bad score, it is the absence
      // of a score, and a reader must not be able to read it as one.
      message: `incomplete (${expected - missing}/${expected})`,
      color: 'lightgrey',
      isError: true,
    };
  }

  const rate = overall.ok / overall.trials;
  return {
    schemaVersion: 1,
    label,
    message: `${(rate * 100).toFixed(0)}% (n=${overall.trials})`,
    color: colorFor(rate),
  };
};

const PALETTE = {
  brightgreen: '#4c1',
  green: '#97ca00',
  yellowgreen: '#a4a61d',
  yellow: '#dfb317',
  red: '#e05d44',
  lightgrey: '#9f9f9f',
};

/** Rough advance width for the 11px DejaVu-ish face Shields uses. */
const textWidth = (text) => Math.round([...text].reduce((sum, ch) => sum + (/[iljI.,:'|]/.test(ch) ? 3 : /[mwMW%]/.test(ch) ? 9 : 6.4), 0)) + 10;

/**
 * A self-contained SVG, so a README can commit the badge instead of fetching it.
 * Deliberately plain: no gradients, no external font reference, nothing that
 * needs a network request to render.
 */
export const renderBadgeSvg = (badge) => {
  const labelWidth = textWidth(badge.label);
  const messageWidth = textWidth(badge.message);
  const total = labelWidth + messageWidth;
  const fill = PALETTE[badge.color] ?? PALETTE.lightgrey;
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escape(badge.label)}: ${escape(badge.message)}">
  <title>${escape(badge.label)}: ${escape(badge.message)}</title>
  <rect width="${labelWidth}" height="20" fill="#555"/>
  <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${fill}"/>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="14">${escape(badge.label)}</text>
    <text x="${labelWidth + messageWidth / 2}" y="14">${escape(badge.message)}</text>
  </g>
</svg>
`;
};
