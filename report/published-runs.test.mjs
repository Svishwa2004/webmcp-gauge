/**
 * The published record's own invariants.
 *
 * `reports/README.md` states the rule: every run is `<page>-<set>-<judge>-<shape>`,
 * and "`.json` is the machine record — same numbers, plus the per-tool outcome
 * counts, the coverage diff and the gate verdict."
 *
 * That rule was written down and not enforced, and on 2026-09-05 a reviewer with
 * no repository access found the gap by reading the draft alone: the Edge
 * second-client run — the newest and most quotable result in the folder — had a
 * write-up and no machine record. Its `report.json` had sat in `artifacts/edge-s1/`
 * since 2026-09-03 and was never copied. Nothing failed, because nothing checked.
 *
 * So the rule is a test now. It is deliberately narrow: it does not validate the
 * contents of a report (`emit` and `gate` own that), only that the pair exists and
 * that a machine record is the schema it claims to be. A published rate whose
 * numbers cannot be re-read by a machine is an anecdote with a table.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const reportsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'reports');

// The npm package ships without `reports/` — it carries the harness, not the
// published record. This test is about this *repository's* folder discipline,
// so on a package install there is nothing for it to check and it says so
// rather than failing.
const reportsStat = await readdir(reportsDir).then(
  () => true,
  () => false
);
const suite = reportsStat ? test : test.skip;

/**
 * A run file names its four coordinates and its shape. Write-ups (`README`,
 * `compatibility-matrix`, `spacing-2026-09-01`, …) are prose about runs and carry
 * no machine record, so they are matched out by the shape suffix rather than by a
 * list of exceptions that someone would have to remember to extend.
 */
const RUN_FILE = /^[a-z0-9-]+-\d+\.\d+\.\d+-[a-z0-9.-]+-(s\d+r\d+|r\d+)(-[a-z0-9-]+)?\.md$/;

const listReports = async () => (await readdir(reportsDir)).sort();

suite('every published run write-up has its machine record beside it', async () => {
  const files = await listReports();
  const runs = files.filter((name) => RUN_FILE.test(name));

  // If this ever reads zero, the pattern has drifted away from the naming
  // convention and the test would pass by measuring nothing.
  assert.ok(runs.length >= 13, `expected at least 13 run write-ups, found ${runs.length}`);

  const missing = runs.filter((name) => !files.includes(name.replace(/\.md$/, '.json')));
  assert.deepEqual(missing, [], `run write-ups with no .json machine record: ${missing.join(', ')}`);
});

suite('every machine record is a report of the schema it claims', async () => {
  const files = await listReports();
  const records = files.filter(
    (name) => name.endsWith('.json') && RUN_FILE.test(name.replace(/\.json$/, '.md'))
  );
  assert.ok(records.length >= 13, `expected at least 13 machine records, found ${records.length}`);

  for (const name of records) {
    const record = JSON.parse(await readFile(`${reportsDir}/${name}`, 'utf8'));
    assert.match(record.schema ?? '', /^webmcp-gauge\/report\/\d+$/, `${name} carries no report schema`);
    assert.ok(record.stamps?.judge?.model, `${name} does not stamp its judge model`);
    assert.ok(record.stamps?.utteranceSet?.version, `${name} does not stamp its utterance set version`);
    // The coverage block is what stops an incomplete run reading as a rate; it
    // arrived in schema 3, so older records are allowed to lack it.
    if (record.schema === 'webmcp-gauge/report/3') {
      assert.equal(typeof record.coverage?.expectedTrials, 'number', `${name} has no coverage block`);
    }
  }
});
