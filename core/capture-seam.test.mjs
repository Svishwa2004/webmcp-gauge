import test from 'node:test';
import assert from 'node:assert/strict';

import { pickTarget, toHarvest } from './gallery.mjs';
import { flagFormError, normalizeTargets } from './cohort.mjs';

/**
 * The seam between the two halves of the one-day capture.
 *
 * `gallery-harvest.mjs` writes a targets file; `cohort-snapshot.mjs` reads it.
 * Both halves were tested in isolation before gallery-publish day and the join
 * between them never was — so if `toHarvest`'s row shape and
 * `normalizeTargets`'s accepted shape ever disagree, the discovery would happen
 * on the one day the capture cannot be repeated. These tests are that join.
 */

const harvestOf = (projects) =>
  toHarvest(
    projects.map((project) => pickTarget(project)),
    { source: 'https://example.invalid/project-gallery', harvestedAt: '2026-09-04T00:00:00.000Z' }
  );

test('a harvest\u2019s targets are accepted by the snapshot without translation', () => {
  const harvest = harvestOf([
    {
      title: 'Project One',
      devpostUrl: 'https://devpost.com/software/one',
      links: [{ url: 'https://one.example.com/', label: 'Try it' }, { url: 'https://github.com/o/one', label: 'Code' }],
    },
    {
      title: 'Project Two',
      devpostUrl: 'https://devpost.com/software/two',
      links: [{ url: 'https://two.example.com/app', label: 'Demo' }],
    },
  ]);

  assert.equal(harvest.counts.usable, 2);

  const normalized = normalizeTargets(harvest.targets);
  assert.equal(normalized.length, 2);
  assert.deepEqual(
    normalized.map((row) => row.url),
    ['https://one.example.com/', 'https://two.example.com/app']
  );
});

test('a submission with no demo link never reaches the snapshot, and keeps its reason', () => {
  const harvest = harvestOf([
    { title: 'No Demo', devpostUrl: 'https://devpost.com/software/nodemo', links: [{ url: 'https://github.com/o/nd' }] },
    { title: 'Has Demo', devpostUrl: 'https://devpost.com/software/hasdemo', links: [{ url: 'https://demo.example.com/' }] },
  ]);

  assert.equal(harvest.counts.usable, 1);
  assert.equal(harvest.skipped.length, 1);
  assert.equal(harvest.skipped[0].reason, 'no demo-class link on the submission');
  assert.equal(normalizeTargets(harvest.targets).length, 1);
});

/**
 * The two halves dedupe on different keys — the harvest by project, the snapshot
 * by canonical URL — so two submissions pointing at one deployment are two rows
 * and one capture. That is correct, and it means the census cannot report
 * "projects" and "captures" as the same number.
 */
test('two submissions sharing one deployment are two harvest rows and one capture', () => {
  const harvest = harvestOf([
    { title: 'Team A', devpostUrl: 'https://devpost.com/software/a', links: [{ url: 'https://shared.example.com/app' }] },
    { title: 'Team B', devpostUrl: 'https://devpost.com/software/b', links: [{ url: 'https://shared.example.com/app#try' }] },
  ]);

  assert.equal(harvest.counts.usable, 2);
  assert.equal(normalizeTargets(harvest.targets).length, 1);
});

test('an empty harvest normalizes to nothing rather than throwing', () => {
  const harvest = harvestOf([]);
  assert.equal(harvest.counts.usable, 0);
  assert.deepEqual(normalizeTargets(harvest.targets), []);
});

/**
 * Found 2026-09-03, one day before the capture: `--serve fixtures/gallery` walked
 * the **live** gallery, because the probes' argument parser only reads
 * `--name=value` and silently ignored the space-separated form. On capture day the
 * same slip aims a run at the wrong target while its operator believes otherwise.
 */
test('a space-separated option is refused rather than silently ignored', () => {
  const error = flagFormError(['--serve', 'fixtures/gallery', '--probe']);
  assert.ok(error, 'a stray value must be reported');
  assert.match(error, /--serve=fixtures\/gallery/);
});

test('well-formed argv passes, switches and all', () => {
  assert.equal(flagFormError(['--serve=fixtures/gallery', '--probe', '--delay=200']), null);
  assert.equal(flagFormError([]), null);
  assert.equal(flagFormError(undefined), null);
});

test('a bare stray with no preceding option is still refused, without a bogus hint', () => {
  const error = flagFormError(['fixtures/gallery']);
  assert.ok(error);
  assert.match(error, /unexpected argument/);
  assert.doesNotMatch(error, /write =/);
});
