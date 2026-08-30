#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchSession } from '../browser/launch.mjs';
import { startFixtureServer } from '../browser/serve.mjs';
import { openSession } from '../browser/session.mjs';
import { captureManifest } from '../browser/webmcp.mjs';
import { EXIT, gateRun, parseFailUnder } from '../core/gate.mjs';
import { lintManifest, lintToText } from '../core/lint.mjs';
import { runSessions } from '../core/orchestrate.mjs';
import { buildPlan, readCheckpoint, readFailures, runSessionSweep, trialKey } from '../core/sweep.mjs';
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
  lint           static checks on a page's tool manifest: no judge, no API key

Shared options:
  --fixture <path>     utterance set (default fixtures/airlock.utterances.json)
  --url <url>          subject page (default the fixture's subject url). With
                       --serve, a path relative to the served directory
  --serve <dir>        serve <dir> on 127.0.0.1 and resolve --url against it, so a
                       measurement can run against a fixture page in this repo
  --judge <model>      judge model id (env WEBMCP_GAUGE_JUDGE_MODEL)
  --base-url <url>     judge endpoint (env WEBMCP_GAUGE_JUDGE_BASE_URL)
  --port <n>           attach to an existing Chrome instead of launching one

lint options (no judge required):
  --manifest <path>    lint a manifest JSON file instead of a live page. Reads
                       {tools:[...]} or a bare array; the only way to lint a name a
                       browser refuses to register
  --variant <name>     for a multi-variant fixture file, lint variants.<name>
  --json               emit the finding list as JSON
  --fail-on <level>    error (default) or warning
  --min-description <n>  description floor in characters (default 60)
  --max-properties <n>   schema property ceiling (default 6)
  --budget-warn <n>      tool count that warns about budget headroom (default 64)

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
  --subject <name>     name the subject in the report, when it is not the fixture's
                       own subject — a report that mislabels what it measured is
                       worse than one with no label
  --fail-under <rate>  exit 1 when any tool's invocation rate is below this rate,
                       e.g. 0.9. Compared against the point rate; the interval is
                       reported beside it

Exit codes (a gate is only useful if 1 means one thing):
  0  every planned trial was measured, and nothing fell below --fail-under; for
     lint, no finding at or above --fail-on
  1  a tool's invocation rate is below --fail-under — the page regressed; for lint,
     the manifest carries findings at that level
  2  the command cannot answer: planned trials have no measurement (re-run with
     --resume), a manifest never settled, or the arguments were unusable. Never a
     threshold breach

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

/**
 * Usage errors exit 2, the same code as an unmeasurable run: in both cases the
 * command produced no number, which is the distinction a CI job needs. Exit 1 is
 * reserved for a measured rate below the threshold.
 */
const fail = (message) => {
  console.error(`webmcp-gauge: ${message}`);
  process.exit(EXIT.incomplete);
};

const command = process.argv[2];

if (command === undefined || command === '--help' || command === '-h') {
  console.log(usage);
  process.exit(EXIT.pass);
}

if (command === '--version' || command === '-v') {
  console.log(version);
  process.exit(EXIT.pass);
}

if (!['trial', 'run', 'session', 'lint'].includes(command)) {
  console.error(`webmcp-gauge: no such command '${command}'\n`);
  console.error(usage);
  process.exit(EXIT.incomplete);
}

const { flags, positional } = parseArgs(process.argv.slice(3));

const needsJudge = command !== 'lint';
const serveDir = typeof flags.serve === 'string' ? flags.serve : null;

const fixturePath = new URL(
  typeof flags.fixture === 'string' ? flags.fixture : '../fixtures/airlock.utterances.json',
  import.meta.url
);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const url = (typeof flags.url === 'string' && flags.url) || positional[0] || fixture.subject?.url;
if (!url && !(command === 'lint' && typeof flags.manifest === 'string')) {
  fail('no url given and the fixture names no subject url');
}

const judgeModel =
  (typeof flags.judge === 'string' && flags.judge) || process.env.WEBMCP_GAUGE_JUDGE_MODEL;
const judgeBaseUrl =
  (typeof flags['base-url'] === 'string' && flags['base-url']) ||
  process.env.WEBMCP_GAUGE_JUDGE_BASE_URL;
// L0 is the free on-ramp: it reads a manifest and calls no model, so demanding a
// judge for it would put an API key in front of the cheapest useful answer.
if (needsJudge && (!judgeModel || !judgeBaseUrl)) {
  fail('pass --judge and --base-url, or set WEBMCP_GAUGE_JUDGE_MODEL and WEBMCP_GAUGE_JUDGE_BASE_URL');
}

if (needsJudge && fixture.authoring?.modelId && judgeModel === fixture.authoring.modelId) {
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

/**
 * With --serve, --url is a path inside the served directory. The server is started
 * per process, not per run: concurrent sessions must not share one, for the same
 * reason each session starts its own browser.
 */
const openTarget = async () => {
  const server = serveDir ? await startFixtureServer({ root: serveDir }) : null;
  return {
    url: server ? server.urlFor(url) : url,
    close: () => (server ? server.close() : Promise.resolve()),
  };
};

if (command === 'lint') {
  const failOn = flags['fail-on'] === 'warning' ? 'warning' : 'error';
  if (typeof flags['fail-on'] === 'string' && !['error', 'warning'].includes(flags['fail-on'])) {
    fail(`--fail-on takes 'error' or 'warning', not '${flags['fail-on']}'`);
  }

  const numeric = (flag) => {
    if (flags[flag] === undefined) return undefined;
    const value = Number(flags[flag]);
    if (!Number.isFinite(value) || value < 0) fail(`--${flag} takes a non-negative number`);
    return value;
  };
  const options = {
    minDescriptionChars: numeric('min-description'),
    maxProperties: numeric('max-properties'),
    budgetWarnAt: numeric('budget-warn'),
  };
  for (const key of Object.keys(options)) if (options[key] === undefined) delete options[key];

  let manifest;
  let subject;

  if (typeof flags.manifest === 'string') {
    // A name a browser refuses to register cannot appear in a live manifest -
    // Chrome 152 throws "Invalid tool name" for a name with a space - so the static
    // path is the only way to lint what the page actually declares.
    const parsed = JSON.parse(await readFile(flags.manifest, 'utf8'));
    const variant = typeof flags.variant === 'string' ? flags.variant : null;
    const list = Array.isArray(parsed)
      ? parsed
      : variant
        ? parsed.variants?.[variant]
        : parsed.tools;
    if (!Array.isArray(list)) {
      fail(
        variant
          ? `${flags.manifest} has no variants.${variant} array`
          : `${flags.manifest} has no tools array (pass --variant <name> for a multi-variant fixture)`
      );
    }
    manifest = { present: true, settled: true, tools: list };
    subject = `${flags.manifest}${variant ? ` (${variant})` : ''}`;
  } else {
    const target = await openTarget();
    const browser = explicitPort
      ? null
      : await launchSession({ headless: flags.headful !== true, profileDir: `${outDir}/lint-profile` });
    const tab = await openSession({ port: explicitPort ?? browser.port });
    try {
      await tab.navigate(target.url);
      manifest = await captureManifest(tab);
      subject = target.url;
    } finally {
      await tab.close();
      if (browser) await browser.close();
      await target.close();
    }
  }

  const result = lintManifest({ manifest, options });
  console.log(flags.json === true ? JSON.stringify({ subject, ...result }, null, 2) : lintToText(result, { subject }));

  // A manifest that is absent, unsettled or empty is not a clean page: there was
  // nothing to lint, which is exit 2 rather than a pass.
  if (manifest.present !== true) {
    console.error('lint: no WebMCP surface on this page, so nothing was linted');
    process.exitCode = EXIT.incomplete;
  } else if (manifest.settled === false) {
    console.error('lint: the tool set never stopped changing, so this manifest is a partial read');
    process.exitCode = EXIT.incomplete;
  } else if (result.manifest.toolCount === 0) {
    console.error('lint: the page registered no tools, so nothing was linted');
    process.exitCode = EXIT.incomplete;
  } else {
    const blocking =
      failOn === 'warning' ? result.counts.error + result.counts.warning : result.counts.error;
    if (blocking > 0) {
      console.error(
        `lint: ${blocking} finding${blocking === 1 ? '' : 's'} at or above ${failOn}. This is what the manifest says, not a measured invocation rate.`
      );
    }
    process.exitCode = blocking > 0 ? EXIT.breach : EXIT.pass;
  }
} else if (command === 'trial') {
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

  const target = await openTarget();
  const browser = explicitPort ? null : await launchSession({ headless: flags.headful !== true });
  const tab = await openSession({ port: explicitPort ?? browser.port });
  try {
    const record = await runTrial({
      session: tab,
      judge,
      url: target.url,
      toolName,
      utterance,
      expectation: utterance,
      setup: toolBlock.setup ?? null,
      fixtureVersion: fixture.version,
    });
    console.log(JSON.stringify(record, null, 2));
    // Same three-way split as `run`: an outcome of null is a trial that produced no
    // measurement, which is not the page failing and must not read as one.
    if (record.outcome === null) {
      console.error(
        `trial: no measurement — ${record.harnessFailure?.kind ?? 'unknown'}: ${record.harnessFailure?.detail ?? 'no reason given'}`
      );
      process.exitCode = EXIT.incomplete;
    } else {
      process.exitCode = record.outcome === 'ok' ? EXIT.pass : EXIT.breach;
    }
  } catch (error) {
    console.error(`trial: threw before producing a measurement — ${error.message ?? error}`);
    process.exitCode = EXIT.incomplete;
  } finally {
    await tab.close();
    if (browser) await browser.close();
    await target.close();
  }
} else if (command === 'session') {
  const session = Number(flags.session ?? 1);
  const judge = createJudge({ baseUrl: judgeBaseUrl, model: judgeModel });
  const target = await openTarget();

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
        ...(serveDir ? { servedFrom: serveDir, servedUrl: target.url } : {}),
      }
    : { isolated: false, port: String(explicitPort), note: 'attached to a pre-existing Chrome' };

  try {
    const result = await runSessionSweep({
      fixture,
      judge,
      url: target.url,
      session,
      sessionMeta,
      repeatsPerSession,
      tools,
      includeControls,
      concurrency,
      port: explicitPort ?? browser.port,
      checkpointPath,
      failureLogPath: `${outDir}/harness-failures.jsonl`,
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
    // A session that could not measure part of its plan exits 2, so a hand-run
    // session and the orchestrator agree on what an incomplete measurement is.
    // The parent does not depend on this: it recomputes coverage from the plan.
    process.exitCode = result.failures.length > 0 ? EXIT.incomplete : EXIT.pass;
  } finally {
    if (browser) await browser.close();
    await target.close();
  }
} else {
  const sessions = Number(flags.sessions ?? 3);
  if (!Number.isInteger(sessions) || sessions < 1) fail('--sessions must be a positive integer');
  if (!Number.isInteger(repeatsPerSession) || repeatsPerSession < 1) {
    fail('--repeats must be a positive integer');
  }

  let failUnder = null;
  try {
    failUnder = parseFailUnder(flags['fail-under']);
  } catch (error) {
    fail(error.message);
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
    ...(serveDir ? ['--serve', serveDir] : []),
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
    records.map((record) => trialKey(record.session ?? 1, record.repeat, record.utteranceId))
  );
  const harnessFailures = loggedFailures.filter(
    (failure) => !measured.has(trialKey(failure.session ?? 1, failure.repeat, failure.utteranceId))
  );
  const recoveredFailures = loggedFailures.length - harnessFailures.length;

  // Completeness is derived from the plan, not from the failure log: a session
  // killed mid-plan logs nothing, and a run that silently measured 900 of 960
  // trials must not be allowed to exit 0 on a rate over the wrong denominator.
  const plan = buildPlan({ fixture, repeatsPerSession, tools, includeControls });
  const expectedKeys = [];
  for (let session = 1; session <= sessions; session += 1) {
    for (const item of plan) expectedKeys.push(trialKey(session, item.repeat, item.utterance.id));
  }
  const missing = expectedKeys.filter((key) => !measured.has(key));
  const coverage = {
    expectedTrials: expectedKeys.length,
    measuredTrials: records.length,
    missingTrials: missing.length,
    missing: missing.slice(0, 10),
  };

  const report = buildReport({
    fixture,
    records,
    harnessFailures,
    recoveredFailures,
    coverage,
    judge: { model: judgeModel, baseUrl: judgeBaseUrl, requested: judgeModel },
    settings: {
      url,
      subjectName: typeof flags.subject === 'string' ? flags.subject : null,
      servedFrom: serveDir,
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

  const gate = gateRun({ report, failUnder });
  const gated = { ...report, gate };

  await mkdir(dirname(`${outDir}/report.json`), { recursive: true });
  await writeFile(`${outDir}/report.json`, `${JSON.stringify(gated, null, 2)}\n`, 'utf8');
  await writeFile(`${outDir}/report.md`, toMarkdown(gated), 'utf8');

  console.log(toMarkdown(gated));
  console.error(`report.json and report.md written to ${outDir}/ · checkpoint ${checkpointPath}`);
  console.error(`gate: ${gate.summary}`);
  process.exitCode = gate.code;
}
