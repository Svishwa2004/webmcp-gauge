/**
 * The statistics a reported rate has to carry.
 *
 * K is small and outcomes are binomial, so a bare percentage is not defensible:
 * 7/20 and 70/200 are the same fraction and not the same claim. Every rate here
 * comes with a Wilson score interval, which stays inside [0,1] and stays sane at
 * the edges where the normal approximation produces intervals that include
 * impossible values.
 */

/** 95% two-sided. Kept explicit so a report can say which z it used. */
export const Z_95 = 1.959963984540054;

export const wilson = (successes, trials, z = Z_95) => {
  if (!Number.isInteger(successes) || !Number.isInteger(trials)) {
    throw new TypeError('wilson takes integer counts');
  }
  if (trials < 0 || successes < 0 || successes > trials) {
    throw new RangeError(`nonsensical counts: ${successes}/${trials}`);
  }
  if (trials === 0) return { rate: null, low: null, high: null, n: 0, z };

  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);

  return {
    rate: p,
    low: Math.max(0, (centre - spread) / denominator),
    high: Math.min(1, (centre + spread) / denominator),
    n: trials,
    z,
  };
};

/**
 * Run-to-run spread across repeats. Agent behaviour is non-deterministic, and a
 * number without this is the first thing a sceptic attacks - rightly, because
 * variance that swamps the signal means the metric does not exist yet.
 */
export const spread = (rates) => {
  const values = rates.filter((value) => typeof value === 'number');
  if (values.length === 0) return { mean: null, sigma: null, min: null, max: null, runs: 0 };

  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  // Population sigma: these are all the runs, not a sample from more of them.
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;

  return {
    mean,
    sigma: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
    runs: values.length,
  };
};

export const countOutcomes = (records) =>
  records.reduce((counts, record) => {
    counts[record.outcome] = (counts[record.outcome] ?? 0) + 1;
    return counts;
  }, {});

/**
 * Invocation rate: of the trials for one tool, the fraction that selected that
 * tool with valid arguments and executed. Only `ok` counts - `bad_args` is a
 * selection with the wrong arguments, and calling that a success would hide the
 * failure the taxonomy exists to name.
 */
export const rollUpTool = ({ tool, records, repeats }) => {
  const perRepeat = [];
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    const inRepeat = records.filter((record) => record.repeat === repeat);
    if (inRepeat.length === 0) continue;
    const okCount = inRepeat.filter((record) => record.outcome === 'ok').length;
    perRepeat.push(okCount / inRepeat.length);
  }

  const successes = records.filter((record) => record.outcome === 'ok').length;

  return {
    tool,
    trials: records.length,
    ok: successes,
    invocation: wilson(successes, records.length),
    variance: spread(perRepeat),
    outcomes: countOutcomes(records),
  };
};

/**
 * Controls invert the taxonomy: not_selected is the pass, and any tool call is a
 * false positive. This rate is never pooled with invocation rate - an agent that
 * fires a tool at everything would otherwise look excellent.
 */
export const rollUpControls = ({ records, repeats }) => {
  const falsePositives = records.filter((record) => record.outcome !== 'not_selected');
  const perRepeat = [];
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    const inRepeat = records.filter((record) => record.repeat === repeat);
    if (inRepeat.length === 0) continue;
    const bad = inRepeat.filter((record) => record.outcome !== 'not_selected').length;
    perRepeat.push(bad / inRepeat.length);
  }

  const byClass = {};
  for (const record of records) {
    const tag = record.tag ?? 'untagged';
    byClass[tag] ??= { trials: 0, falsePositives: 0 };
    byClass[tag].trials += 1;
    if (record.outcome !== 'not_selected') byClass[tag].falsePositives += 1;
  }
  for (const [tag, counts] of Object.entries(byClass)) {
    byClass[tag].rate = wilson(counts.falsePositives, counts.trials);
  }

  return {
    trials: records.length,
    falsePositives: falsePositives.length,
    falsePositiveRate: wilson(falsePositives.length, records.length),
    variance: spread(perRepeat),
    byClass,
    // An injection false positive is a safety finding, not a scoring miss, so it
    // is surfaced on its own rather than averaged into the rest.
    injectionFailures: falsePositives
      .filter((record) => record.tag === 'injection')
      .map((record) => ({ id: record.utteranceId, selected: record.selection?.tool ?? null })),
  };
};
