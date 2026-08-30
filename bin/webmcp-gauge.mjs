#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchSession } from '../browser/launch.mjs';
import { openSession } from '../browser/session.mjs';
import { runSessions } from '../core/orchestrate.mjs';
import { readCheckpoint, runSessionSweep } from '../core/sweep.mjs';
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
  run            run S isolated sessions and emit a stamped report
  session        run one session (used by run; each session gets its own process)
  lint <url>     static checks on the manifest, no model      (not implemented)

Shared options:
  --fixture <path>     utterance set (default fixtures/airlock.utterances.json)
  --url <url>          subject page (default the fixture's subject url)
  --judge <model>      judge model id (env WEBMCP_GAUGE_JUDGE_MODEL)
  --base-url <url>     judge endpoint (env WEBMCP_GAUGE_JUDGE_BASE_URL)
  --port <n>           attach to an existing Chrome instead of launching one

trial options:
  --tool <name>        expected tool
  --utterance <id>     utterance id, e.g. sum_by_category-05

run / session options:
  --sessions <n>       isolated sessions, each its own process, browser and cold
                       profile (default 3). Between-session sigma needs >= 2
  --repeats <n>        repeats inside one session (default 1). Within-session
                       sigma needs >= 2, and it is a floor, not a stability claim
  --concurrency <n>    parallel tabs inside a session (default 1)
  --gap <seconds>      wait between sessions (default 0)
  --tools <a,b>        restrict to these tools
  --no-controls        skip the negative controls
  --headful            show the browser instead of --headless=new
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

const command = process.argv[2];

if (command === undefined || command === '--help' || command === '-h') {
  console.log(usage);
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  console.log(version);
  process.exit(0);
}

if (!['trial', 'run', 'session'].includes(command)) {
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
const url = (typeof flags.url === 'string' && flags.url) || positional[0] || fixture.subject?.url;
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

const explicitPort = typeof flags.port === 'string' ? flags.port : process.env.CDP_PORT;
const outDir = typeof flags.out === 'string' ? flags.out : 'artifacts';
const checkpointPath = `${outDir}/sweep.jsonl`;
const tools =
  typeof flags.tools === 'string' ? flags.tools.split(',').map((part) => part.trim()) : null;
const includeControls = flags['no-controls'] !== true;
const repeatsPerSession = Number(flags.repeats ?? 1);
const concurrency = Number(flags.concurrency ?? 1);

if (command === 'trial') {
  const judge = createJudge({ baseUrl: judgeBaseUrl, model: judgeModel });
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

  const browser = explicitPort ? null : await launchSession({ headless: flags.headful !== true });
  const tab = await openSession({ port: explicitPort ?? browser.port });
  try {
    const record = await runTrial({
      session: tab,
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
    await tab.close();
    if (browser) await browser.close();
  }
} else if (command === 'session') {
  const session = Number(flags.session ?? 1);
  const judge = createJudge({ baseUrl: judgeBaseUrl, model: judgeModel });

  // Each session owns its browser: a cold profile, its own port, its own process
  // tree. Attaching to a shared instance is still allowed with --port, and the
  // report records which of the two it was.
  const browser = explicitPort
    ? null
    : await launchSession({
        headless: flags.headful !== true,
        profileDir: `${outDir}/sessions/session-${session}`,
      });

  const sessionMeta = browser
    ? {
        isolated: true,
        browserPid: browser.pid,
        port: browser.port,
        build: browser.build,
        headless: browser.headless,
        profileDir: browser.profileDir,
        startedAt: browser.startedAt,
      }
    : { isolated: false, port: String(explicitPort), note: 'attached to a pre-existing Chrome' };

  try {
    const result = await runSessionSweep({
      fixture,
      judge,
      url,
      session,
      sessionMeta,
      repeatsPerSession,
      tools,
      includeControls,
      concurrency,
      port: explicitPort ?? browser.port,
      checkpointPath,
      onProgress: ({ completed, total, item, failures }) => {
        process.stderr.write(
          `\rsession ${session}: ${completed}/${total} · ${item.utterance.id} · ${failures} harness failures    `
        );
      },
    });
    process.stderr.write('\n');
    console.error(
      `session ${session}: ${result.written.length} trials recorded, ${result.failures.length} harness failures, ${(result.elapsedMs / 1000).toFixed(0)}s`
    );
    if (result.failures.length > 0) {
      await appendFailures(`${outDir}/harness-failures.jsonl`, result.failures);
    }
    process.exitCode = 0;
  } finally {
    if (browser) await browser.close();
  }
} else {
  const sessions = Number(flags.sessions ?? 3);
  if (!Number.isInteger(sessions) || sessions < 1) fail('--sessions must be a positive integer');
  if (!Number.isInteger(repeatsPerSession) || repeatsPerSession < 1) {
    fail('--repeats must be a positive integer');
  }

  if (flags.resume !== true) {
    const existing = await readCheckpoint(checkpointPath);
    if (existing.records.length > 0) {
      fail(
        `${checkpointPath} already holds ${existing.records.length} trials. Pass --resume to continue it, or --out <dir> to start a fresh one.`
      );
    }
  }

  const childArgs = [
    '--fixture',
    typeof flags.fixture === 'string' ? flags.fixture : '../fixtures/airlock.utterances.json',
    '--url',
    url,
    '--judge',
    judgeModel,
    '--base-url',
    judgeBaseUrl,
    '--out',
    outDir,
    '--repeats',
    String(repeatsPerSession),
    '--concurrency',
    String(concurrency),
    '--resume',
    ...(tools ? ['--tools', tools.join(',')] : []),
    ...(includeControls ? [] : ['--no-controls']),
    ...(flags.headful === true ? ['--headful'] : []),
    ...(explicitPort ? ['--port', String(explicitPort)] : []),
  ];

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const sessionResults = await runSessions({
    sessions,
    binPath: fileURLToPath(import.meta.url),
    args: childArgs,
    gapSeconds: Number(flags.gap ?? 0),
    onSessionStart: ({ session }) => console.error(`\n=== session ${session} of ${sessions} ===`),
  });

  const { records } = await readCheckpoint(checkpointPath);
  const loggedFailures = await readFailures(`${outDir}/harness-failures.jsonl`);

  // A failure whose trial later succeeded on --resume is history, not a hole. The
  // report must not list it as a gap in the current measurement, or a resumed run
  // looks permanently incomplete; it is counted as recovered instead.
  const measured = new Set(
    records.map((record) => `${record.session ?? 1}:${record.repeat}:${record.utteranceId}`)
  );
  const harnessFailures = loggedFailures.filter(
    (failure) => !measured.has(`${failure.session ?? 1}:${failure.repeat}:${failure.utteranceId}`)
  );
  const recoveredFailures = loggedFailures.length - harnessFailures.length;

  const report = buildReport({
    fixture,
    records,
    harnessFailures,
    recoveredFailures,
    judge: { model: judgeModel, baseUrl: judgeBaseUrl, requested: judgeModel },
    settings: {
      url,
      sessions,
      repeatsPerSession,
      concurrency,
      tools,
      includeControls,
      gapSeconds: Number(flags.gap ?? 0),
      isolatedSessions: !explicitPort,
    },
    sessionResults,
    timing: { startedAt, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - startedMs },
  });

  await mkdir(dirname(`${outDir}/report.json`), { recursive: true });
  await writeFile(`${outDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(`${outDir}/report.md`, toMarkdown(report), 'utf8');

  console.log(toMarkdown(report));
  console.error(`report.json and report.md written to ${outDir}/ · checkpoint ${checkpointPath}`);
  process.exitCode = harnessFailures.length > 0 ? 1 : 0;
}

async function appendFailures(path, failures) {
  await mkdir(dirname(path), { recursive: true });
  const lines = failures.map((failure) => JSON.stringify(failure)).join('\n');
  await appendFile(path, `${lines}\n`, 'utf8');
}

async function readFailures(path) {
  try {
    const text = await readFile(path, 'utf8');
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
