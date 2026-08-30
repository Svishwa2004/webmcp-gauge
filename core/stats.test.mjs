import test from 'node:test';
import assert from 'node:assert/strict';
import { countOutcomes, rollUpControls, rollUpTool, spread, wilson, Z_95 } from './stats.mjs';

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} is not within ${tolerance} of ${expected}`
  );

test('wilson matches a hand-derived interval for a small proportion', () => {
  // 7/20, z=1.96, derived by hand rather than copied from the implementation:
  //   denominator = 1 + z^2/n            = 1 + 3.8415/20      = 1.192074
  //   centre      = p + z^2/(2n)         = 0.35 + 0.0960375   = 0.4460375
  //   spread      = z*sqrt((p(1-p) + z^2/(4n))/n)
  //               = 1.96*sqrt((0.2275 + 0.04801875)/20)       = 0.230046
  //   low  = (0.4460375 - 0.230046)/1.192074 = 0.181190
  //   high = (0.4460375 + 0.230046)/1.192074 = 0.567149
  const interval = wilson(7, 20);
  near(interval.rate, 0.35);
  near(interval.low, 0.18119, 5e-5);
  near(interval.high, 0.567149, 5e-5);
  assert.equal(interval.n, 20);
  assert.equal(interval.z, Z_95);
});

test('wilson stays inside [0,1] at the edges, where the normal approximation does not', () => {
  const none = wilson(0, 20);
  near(none.rate, 0);
  assert.equal(none.low, 0);
  assert.ok(none.high > 0 && none.high < 0.2, `implausible upper bound ${none.high}`);

  const all = wilson(20, 20);
  near(all.rate, 1);
  assert.equal(all.high, 1);
  assert.ok(all.low > 0.8 && all.low < 1, `implausible lower bound ${all.low}`);
});

test('wilson narrows as n grows for the same proportion', () => {
  const small = wilson(7, 20);
  const large = wilson(70, 200);
  near(small.rate, large.rate);
  assert.ok(
    large.high - large.low < small.high - small.low,
    'the same fraction from more trials must be a tighter claim'
  );
});

test('wilson refuses nonsensical counts rather than returning a number', () => {
  assert.throws(() => wilson(3, 2), RangeError);
  assert.throws(() => wilson(-1, 10), RangeError);
  assert.throws(() => wilson(1.5, 10), TypeError);
});

test('an empty set has no rate at all, rather than zero', () => {
  const interval = wilson(0, 0);
  assert.equal(interval.rate, null);
  assert.equal(interval.low, null);
  assert.equal(interval.n, 0);
});

test('spread reports population sigma across repeats', () => {
  const result = spread([0.4, 0.5, 0.6]);
  near(result.mean, 0.5);
  near(result.sigma, Math.sqrt(((0.1 ** 2) * 2) / 3));
  near(result.min, 0.4);
  near(result.max, 0.6);
  assert.equal(result.runs, 3);
});

test('identical repeats have zero spread, and one repeat has no spread to report', () => {
  near(spread([0.5, 0.5, 0.5]).sigma, 0);
  near(spread([0.5]).sigma, 0);
  assert.equal(spread([]).sigma, null);
});

test('outcome counts are exact, not bucketed', () => {
  assert.deepEqual(
    countOutcomes([{ outcome: 'ok' }, { outcome: 'ok' }, { outcome: 'bad_args' }]),
    { ok: 2, bad_args: 1 }
  );
});

test('only ok counts towards invocation rate — bad_args is not a partial success', () => {
  const records = [
    { session: 1, repeat: 1, outcome: 'ok' },
    { session: 1, repeat: 1, outcome: 'bad_args' },
    { session: 2, repeat: 1, outcome: 'ok' },
    { session: 2, repeat: 1, outcome: 'wrong_tool' },
  ];
  const rollUp = rollUpTool({ tool: 'sum_by_category', records });

  assert.equal(rollUp.trials, 4);
  assert.equal(rollUp.ok, 2);
  near(rollUp.invocation.rate, 0.5);
  assert.deepEqual(rollUp.outcomes, { ok: 2, bad_args: 1, wrong_tool: 1 });
  near(rollUp.betweenSession.mean, 0.5);
  near(rollUp.betweenSession.sigma, 0);
  assert.equal(rollUp.betweenSession.runs, 2);
});

test('between-session and within-session sigma are computed from different groupings', () => {
  // Session 1 is internally stable at 1.0; session 2 is internally split 1.0/0.0.
  // Between-session sigma compares 1.0 against 0.5; within-session averages 0 and 0.5.
  const records = [
    { session: 1, repeat: 1, outcome: 'ok' },
    { session: 1, repeat: 2, outcome: 'ok' },
    { session: 2, repeat: 1, outcome: 'ok' },
    { session: 2, repeat: 2, outcome: 'wrong_tool' },
  ];
  const rollUp = rollUpTool({ tool: 'filter_rows', records });

  near(rollUp.betweenSession.mean, 0.75);
  near(rollUp.betweenSession.sigma, 0.25);
  assert.equal(rollUp.betweenSession.runs, 2);
  near(rollUp.withinSession.sigma, 0.25);
  assert.equal(rollUp.withinSession.sessions, 2);
});

test('identical sessions report zero between-session sigma, which is a floor not a proof', () => {
  const records = [
    { session: 1, repeat: 1, outcome: 'wrong_tool' },
    { session: 2, repeat: 1, outcome: 'wrong_tool' },
    { session: 3, repeat: 1, outcome: 'wrong_tool' },
  ];
  const rollUp = rollUpTool({ tool: 'sum_by_category', records });
  near(rollUp.invocation.rate, 0);
  near(rollUp.betweenSession.sigma, 0);
});

test('controls invert the taxonomy: not_selected is the pass', () => {
  const records = [
    { session: 1, repeat: 1, outcome: 'not_selected', tag: 'off_topic', utteranceId: 'control-01' },
    { session: 1, repeat: 1, outcome: 'ok', tag: 'out_of_scope', utteranceId: 'control-07' },
    {
      session: 2,
      repeat: 1,
      outcome: 'ok',
      tag: 'injection',
      utteranceId: 'control-19',
      selection: { tool: 'describe_dataset' },
    },
  ];
  const rollUp = rollUpControls({ records });

  assert.equal(rollUp.trials, 3);
  assert.equal(rollUp.falsePositives, 2);
  near(rollUp.falsePositiveRate.rate, 2 / 3);
  assert.equal(rollUp.byClass.off_topic.falsePositives, 0);
  assert.equal(rollUp.byClass.out_of_scope.falsePositives, 1);
  assert.deepEqual(rollUp.injectionFailures, [
    { id: 'control-19', session: 2, selected: 'describe_dataset' },
  ]);
  // Session 1 was half bad, session 2 fully bad: sigma over [0.5, 1.0].
  near(rollUp.betweenSession.sigma, 0.25);
});
