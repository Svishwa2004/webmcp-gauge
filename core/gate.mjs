/**
 * What an exit code is allowed to mean.
 *
 * A gate is only useful if `1` means one thing. Until now any harness failure
 * exited 1, so "two trials need a --resume" and "the invocation rate fell off a
 * cliff" produced the same signal, and a CI job could not tell a regression from
 * a flaky provider. The codes are therefore split by what the run *knows*:
 *
 *   0  every planned trial was measured, and nothing gated fell below the threshold
 *   1  every planned trial was measured, and a rate is below --fail-under
 *   2  the run cannot answer: planned trials have no measurement, or bad usage
 *
 * Incomplete outranks breach deliberately. Gaps are not random - a judge outage or
 * a page that never loaded can take out one tool's utterances and nothing else, so
 * a rate computed over a run with holes is a rate over a denominator the run did
 * not choose. Reporting that as a regression would be lying with a plausible
 * number, and the whole point of the taxonomy is that a non-measurement is not an
 * outcome.
 *
 * The threshold is compared against the **point rate**, not the Wilson lower
 * bound. Gating on the bound was considered and rejected: 20 of 20 has a lower
 * bound of 83.9%, so a page that never failed once would breach `--fail-under 0.9`
 * on sample size alone. The interval is printed beside the rate instead, so a
 * breach that sits inside the noise is visible to the person reading it.
 */

export const EXIT = { pass: 0, breach: 1, incomplete: 2 };

const percent = (value) => `${(value * 100).toFixed(1)}%`;

/**
 * `--fail-under 90` is the mistake this exists to catch: it parses as a number,
 * compares against every rate, and fails the build forever. Rates are fractions
 * here and nowhere else in the CLI, so the boundary check belongs at the boundary.
 */
export const parseFailUnder = (raw) => {
  if (raw === undefined || raw === null) return null;
  if (raw === true) throw new RangeError('--fail-under needs a rate, e.g. --fail-under 0.9');

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    const hint = Number.isFinite(value) && value > 1 && value <= 100 ? ` — use ${value / 100}, not ${value}` : '';
    throw new RangeError(`--fail-under takes a rate between 0 and 1, not '${raw}'${hint}`);
  }
  return value;
};

const countKinds = (failures) => {
  const kinds = {};
  for (const failure of failures) {
    const kind = failure.kind ?? 'unknown';
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  return Object.entries(kinds)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${count} ${kind}`)
    .join(', ');
};

/**
 * Decides one exit code for a finished run. Pure: it reads the report and returns
 * a verdict, so the CI contract is testable without a browser or a judge.
 */
export const gateRun = ({ report, failUnder = null }) => {
  const threshold = parseFailUnder(failUnder);
  const perTool = report.invocation?.perTool ?? [];
  const outstandingFailures = report.harnessFailures ?? [];
  const coverage = report.coverage ?? null;
  const missingTrials = coverage?.missingTrials ?? 0;
  const expectedTrials = coverage?.expectedTrials ?? null;

  const coverageNote =
    expectedTrials === null
      ? 'coverage unknown'
      : `${expectedTrials - missingTrials}/${expectedTrials} planned trials measured`;

  const breaches = (threshold === null ? [] : perTool)
    .filter((tool) => tool.invocation?.rate !== null && tool.invocation?.rate < threshold)
    .map((tool) => ({
      tool: tool.tool,
      rate: tool.invocation.rate,
      low: tool.invocation.low,
      high: tool.invocation.high,
      trials: tool.trials,
    }))
    .sort((a, b) => a.rate - b.rate);

  const nothingToGate = threshold !== null && perTool.length === 0;

  const verdict = {
    failUnder: threshold,
    gatedTools: threshold === null ? 0 : perTool.length,
    missingTrials,
    outstandingFailures: outstandingFailures.length,
    breaches,
  };

  if (missingTrials > 0 || outstandingFailures.length > 0 || nothingToGate) {
    const reasons = [];
    if (missingTrials > 0) {
      const withCause = outstandingFailures.length;
      reasons.push(
        `${missingTrials} of ${expectedTrials ?? '?'} planned trials produced no measurement` +
          (withCause > 0 ? ` (${countKinds(outstandingFailures)})` : ' with no logged cause')
      );
    } else if (outstandingFailures.length > 0) {
      reasons.push(
        `${outstandingFailures.length} logged harness failure${outstandingFailures.length === 1 ? '' : 's'} outside the measured set (${countKinds(outstandingFailures)})`
      );
    }
    if (nothingToGate) {
      reasons.push(
        `no tool trials were measured, so --fail-under ${percent(threshold)} cannot be evaluated`
      );
    }
    return {
      ...verdict,
      code: EXIT.incomplete,
      status: 'incomplete',
      summary: `INCOMPLETE — ${reasons.join('; ')}. Re-run with --resume; this is not a threshold breach.`,
    };
  }

  if (breaches.length > 0) {
    const worst = breaches[0];
    return {
      ...verdict,
      code: EXIT.breach,
      status: 'breach',
      summary:
        `FAIL — ${breaches.length} of ${perTool.length} tool${perTool.length === 1 ? '' : 's'} below --fail-under ${percent(threshold)}: ` +
        breaches
          .map(
            (breach) =>
              `\`${breach.tool}\` ${percent(breach.rate)} [${percent(breach.low)}, ${percent(breach.high)}] over ${breach.trials} trials`
          )
          .join(', ') +
        `. ${coverageNote}, so the number is the page's, not the harness's.` +
        (worst.high >= threshold
          ? ` Note ${worst.tool}'s interval still reaches ${percent(worst.high)}: the breach is inside the noise at this sample size.`
          : ''),
    };
  }

  if (threshold === null) {
    return {
      ...verdict,
      code: EXIT.pass,
      status: 'pass',
      summary: `COMPLETE — ${coverageNote}, no --fail-under given, so nothing was gated.`,
    };
  }

  const lowest = [...perTool].sort(
    (a, b) => (a.invocation.rate ?? 1) - (b.invocation.rate ?? 1)
  )[0];

  return {
    ...verdict,
    code: EXIT.pass,
    status: 'pass',
    summary: `PASS — all ${perTool.length} tools at or above --fail-under ${percent(threshold)} (lowest \`${lowest.tool}\` ${percent(lowest.invocation.rate)}), ${coverageNote}.`,
  };
};
