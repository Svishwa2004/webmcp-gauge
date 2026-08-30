#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { openSession } from '../browser/session.mjs';
import { readCheckpoint, runSweep } from '../core/sweep.mjs';
import { runTrial } from '../core/trial.mjs';
import { createJudge } from '../judges/openai-compatible.mjs';
import { buildReport, toMarkdown } from '../report/emit.mjs';

const { name, version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
);

const usage = `${name} ${version}

Usage: webmcp-gauge <command> [options]

Commands:
  trial          run one trial: one utterance, one expected tool, one outcome
  run            sweep the whole utterance set and emit a stamped report
  lint <url>     static checks on the manifest, no model      (not implemented)

Shared options:
  --fixture <path>     utterance set (default fixtures/airlock.utterances.json)
  --url <url>          subject page (default the fixture's subject url)
  --judge <model>      judge model id (env WEBMCP_GAUGE_JUDGE_MODEL)
  --base-url <url>     judge endpoint (env WEBMCP_GAUGE_JUDGE_BASE_URL)
  --port <n>           Chrome debugging port (env CDP_PORT, default 9333)

trial options:
  --tool <name>        expected tool
  --utterance <id>     utterance id, e.g. sum_by_category-05

run options:
  --repeats <n>        repeats per utterance (default 3)
  --concurrency <n>    parallel tabs (default 1; recorded in the report)
  --tools <a,b>        restrict to these tools
  --no-controls        skip the negative controls
  --out <dir>          report directory (default artifacts/)
  --resume             reuse the JSONL checkpoint in the report directory

The judge must not be the model that authored the utterance set; the set records
which one that was. See docs/getting-started.md and .env.example.`;

/**
 * Walks argv once so a flag's value is never mistaken for a positional. Filtering
 * on "does not start with --" looks equivalent and is not: it swallowed the judge
 * model and the port as positionals, and the first one became the target url.
 */
const parseArgs = (argv) => {
  const flags = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { flags, positional };
};

const fail = (message) => {
  console.error(`webmcp-gauge: ${message}`);
  process.exit(2);
};

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

const command = process.argv[2];

if (command === undefined || command === '--help' || command === '-h') {
  console.log(usage);
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  console.log(version);
  process.exit(0);
}

if (command !== 'trial' && command !== 'run') {
  console.error(`webmcp-gauge: no such command '${command}'\n`);
  console.error(usage);
  process.exit(2);
}

const { flags, positional } = parseArgs(process.argv.slice(3));

const fixturePath = new URL(
  typeof flags.fixture === 'string' ? flags.fixture : '../fixtures/airlock.utterances.json',
  import.meta.url
);
const fixture = await readJson(fixturePath);
const url =
  (typeof flags.url === 'string' && flags.url) || positional[0] || fixture.subject?.url;
if (!url) fail('no url given and the fixture names no subject url');

const judgeModel =
  (typeof flags.judge === 'string' && flags.judge) || process.env.WEBMCP_GAUGE_JUDGE_MODEL;
const judgeBaseUrl =
  (typeof flags['base-url'] === 'string' && flags['base-url']) ||
  process.env.WEBMCP_GAUGE_JUDGE_BASE_URL;
if (!judgeModel || !judgeBaseUrl) {
  fail('pass --judge and --base-url, or set WEBMCP_GAUGE_JUDGE_MODEL and WEBMCP_GAUGE_JUDGE_BASE_URL');
}

if (fixture.authoring?.modelId && judgeModel === fixture.authoring.modelId) {
  fail(
    `judge '${judgeModel}' authored this utterance set, so it cannot judge it: the metric would measure self-consistency`
  );
}

const port = typeof flags.port === 'string' ? flags.port : process.env.CDP_PORT;
const judge = createJudge({ baseUrl: judgeBaseUrl, model: judgeModel });

if (command === 'trial') {
  const utteranceId = typeof flags.utterance === 'string' ? flags.utterance : null;
  const toolName =
    typeof flags.tool === 'string' ? flags.tool : utteranceId?.replace(/-\d+$/, '') ?? null;
  if (!toolName) fail('pass --tool <name> or --utterance <id>');

  const toolBlock = fixture.tools.find((tool) => tool.name === toolName);
  if (!toolBlock) fail(`fixture has no block for tool '${toolName}'`);

  const utterance = utteranceId
    ? toolBlock.utterances.find((candidate) => candidate.id === utteranceId)
    : toolBlock.utterances[0];
  if (!utterance) fail(`fixture has no utterance '${utteranceId}'`);

  const session = await openSession({ port });
  try {
    const record = await runTrial({
      session,
      judge,
      url,
      toolName,
      utterance,
      expectation: utterance,
      setup: toolBlock.setup ?? null,
      fixtureVersion: fixture.version,
    });
    console.log(JSON.stringify(record, null, 2));
    process.exitCode = record.outcome === 'ok' ? 0 : 1;
  } finally {
    await session.close();
  }
} else {
  const repeats = Number(flags.repeats ?? 3);
  const concurrency = Number(flags.concurrency ?? 1);
  const tools =
    typeof flags.tools === 'string' ? flags.tools.split(',').map((part) => part.trim()) : null;
  const includeControls = flags['no-controls'] !== true;
  const outDir = typeof flags.out === 'string' ? flags.out : 'artifacts';
  const checkpointPath = `${outDir}/sweep.jsonl`;

  if (!Number.isInteger(repeats) || repeats < 1) fail('--repeats must be a positive integer');
  if (!Number.isInteger(concurrency) || concurrency < 1) fail('--concurrency must be a positive integer');

  if (flags.resume !== true) {
    // A stale checkpoint silently mixed with a new run would produce a report
    // whose numbers came from two different sets of conditions.
    const existing = await readCheckpoint(checkpointPath);
    if (existing.records.length > 0) {
      fail(
        `${checkpointPath} already holds ${existing.records.length} trials. Pass --resume to continue it, or --out <dir> to start a fresh one.`
      );
    }
  }

  const browserBuild = await fetch(`http://127.0.0.1:${port ?? 9333}/json/version`)
    .then((response) => response.json())
    .then((payload) => ({ build: payload.Browser, protocol: payload['Protocol-Version'] }))
    .catch(() => ({ build: 'unknown', protocol: null }));

  const startedAt = Date.now();
  const sweep = await runSweep({
    fixture,
    judge,
    url,
    repeats,
    tools,
    includeControls,
    concurrency,
    port,
    checkpointPath,
    onProgress: ({ completed, total, item, failures }) => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = completed / elapsed;
      const remaining = rate > 0 ? Math.round((total - completed) / rate) : 0;
      process.stderr.write(
        `\r${completed}/${total} trials · ${item.utterance.id} · ${failures} harness failures · ~${remaining}s left    `
      );
    },
  });
  process.stderr.write('\n');

  const report = buildReport({
    fixture,
    sweep,
    judge: { model: judge.id, baseUrl: judge.baseUrl, requested: judge.id },
    browser: browserBuild,
  });

  await mkdir(dirname(`${outDir}/report.json`), { recursive: true });
  await writeFile(`${outDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(`${outDir}/report.md`, toMarkdown(report), 'utf8');

  console.log(toMarkdown(report));
  console.error(
    `report.json and report.md written to ${outDir}/ · checkpoint ${checkpointPath} · ${sweep.plan.attempted} trials attempted, ${sweep.failures.length} harness failures`
  );
  process.exitCode = sweep.failures.length > 0 ? 1 : 0;
}
