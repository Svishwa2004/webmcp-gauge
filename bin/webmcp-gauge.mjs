#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { openSession } from '../browser/session.mjs';
import { runTrial } from '../core/trial.mjs';
import { createJudge } from '../judges/openai-compatible.mjs';

const { name, version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
);

const usage = `${name} ${version}

Usage: webmcp-gauge <command> [options]

Commands:
  trial <url>    run one trial: one utterance, one expected tool, one outcome
  probe <url>    read the page's registered tool manifest     (not implemented)
  lint <url>     static checks on the manifest, no model      (not implemented)
  run <url>      fire the whole utterance set, score outcomes (not implemented)

trial options:
  --fixture <path>     utterance set (default fixtures/airlock.utterances.json)
  --tool <name>        expected tool
  --utterance <id>     utterance id, e.g. sum_by_category-05
  --judge <model>      judge model id (env WEBMCP_GAUGE_JUDGE_MODEL)
  --base-url <url>     judge endpoint (env WEBMCP_GAUGE_JUDGE_BASE_URL)
  --port <n>           Chrome debugging port (env CDP_PORT, default 9333)

Options:
  -h, --help     print this message
  -v, --version  print the version

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

const command = process.argv[2];

if (command === undefined || command === '--help' || command === '-h') {
  console.log(usage);
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  console.log(version);
  process.exit(0);
}

if (command !== 'trial') {
  console.error(`webmcp-gauge: no such command '${command}'\n`);
  console.error(usage);
  process.exit(2);
}

const { flags, positional } = parseArgs(process.argv.slice(3));

const fixturePath = new URL(
  typeof flags.fixture === 'string' ? flags.fixture : '../fixtures/airlock.utterances.json',
  import.meta.url
);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const url = positional[0] ?? fixture.subject?.url;
if (!url) fail('no url given and the fixture names no subject url');

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

const judge = createJudge({ baseUrl: judgeBaseUrl, model: judgeModel });
const session = await openSession({ port: flags.port ?? process.env.CDP_PORT });

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
