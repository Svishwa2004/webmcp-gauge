/**
 * The cohort snapshot runner (PROJECT-LOG item 11 / concept.md milestone 4).
 *
 * Captures, for each project URL: liveness and redirects, the page title, and the
 * WebMCP manifest as the browser hands it back — names, descriptions, schemas,
 * annotations. One dated directory per capture, and two files in it: everything
 * (local) and only what may be published (§12).
 *
 * This exists because the capture cannot be repeated. The gallery's demo URLs are
 * all simultaneously live for about one day, on hosting tiers that will 404 within
 * months, so the rules that decide what is captured live in `core/cohort.mjs`
 * under test, and this file is the part that talks to browsers and other people's
 * servers.
 *
 * Usage:
 *   node probes/cohort-snapshot.mjs --targets=fixtures/cohort/dry-run.json
 *   node probes/cohort-snapshot.mjs --url=https://example.com --out=artifacts/cohort-test
 *   node probes/cohort-snapshot.mjs --targets=... --delay=3000 --headed
 *
 * Manners are not optional and not configurable (concept §12): one page at a
 * time, a delay between projects, our user agent on every request, robots.txt
 * honoured, and nothing stored but the manifest and the metadata above — never a
 * copy of anyone's page.
 */
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { launchSession } from '../browser/launch.mjs';
import { openSession } from '../browser/session.mjs';
import { captureManifest, watchBrowserToolsAtBrowser } from '../browser/webmcp.mjs';
import {
  capturedUrlsFrom,
  normalizeTargets,
  remainingTargets,
  robotsAllows,
  toRecord,
  toPublishable,
  summarize,
  HARNESS_UA_SUFFIX,
  localDateStamp,
} from '../core/cohort.mjs';
import { parseOptions } from '../core/args.mjs';

// Shared with `bin/` since 2026-09-03: both `--name=value` and `--name value`
// work, and an unknown or valueless option is refused rather than leaving a
// default silently in place. On a capture that cannot be repeated, a refused run
// is cheap and a run into the wrong directory is not.
const { options, error: optionsError } = parseOptions(process.argv.slice(2), {
  values: ['targets', 'url', 'delay', 'settle', 'out'],
  switches: ['headed', 'resume'],
  maxPositional: 0,
});
if (optionsError) {
  console.error(`cannot capture: ${optionsError}`);
  process.exit(2);
}
const flag = (name, fallback) => options[name] ?? fallback;

const targetsPath = flag('targets', null);
const singleUrl = flag('url', null);
const delayMs = Number(flag('delay', '2000'));
const settleMs = Number(flag('settle', '10000'));
const today = localDateStamp();
const outDir = resolve(flag('out', `artifacts/cohort-${today}`));
const headless = options.headed !== true;
const resume = options.resume === true;

if (!targetsPath && !singleUrl) {
  console.error('usage: node probes/cohort-snapshot.mjs --targets=<file.json> | --url=<url>');
  process.exit(2);
}

const rawTargets = singleUrl
  ? [singleUrl]
  : JSON.parse(await readFile(resolve(targetsPath), 'utf8'));
const targets = normalizeTargets(Array.isArray(rawTargets) ? rawTargets : rawTargets.targets);

await mkdir(outDir, { recursive: true });
const recordsPath = `${outDir}/snapshot.jsonl`;
const startedAt = new Date().toISOString();

// The snapshot file is append-only, so a fresh run into a directory that
// already holds one would silently double every captured row — a mistake to
// refuse, not repair. --resume continues an existing file instead: the URLs
// already in it are subtracted from the targets and only the remainder is
// visited. Built the night of 2026-09-25/26, when a browser death and a
// machine sleep each stopped a full-corpus run and the subtraction ran twice
// by hand.
const existingSnapshot = await readFile(recordsPath, 'utf8').catch(() => null);
if (existingSnapshot !== null && !resume) {
  console.error(
    `cannot capture: ${recordsPath} already exists — pass --resume to continue it, or a fresh --out to start over`
  );
  process.exit(2);
}
const capturedUrls = existingSnapshot !== null ? capturedUrlsFrom(existingSnapshot) : new Set();
const pendingTargets = remainingTargets(targets, capturedUrls);
if (resume && capturedUrls.size > 0) {
  console.log(`resume: ${capturedUrls.size} already captured — ${pendingTargets.length} to go`);
}

const browser = await launchSession({
  // Fresh profile per invocation: a killed Chrome leaves a SingletonLock that
  // makes the next launch time out with a message naming the symptom rather than
  // the cause. Not a confusion worth having on a capture that cannot be repeated.
  profileDir: `${outDir}/profile-${Date.now()}`,
  headless,
  // Identifying the harness is a §12 commitment. Doing it at launch covers every
  // request the browser makes, including the ones a page issues itself.
  extraArgs: [`--user-agent=Mozilla/5.0 (compatible) ${HARNESS_UA_SUFFIX}`],
});

console.log(`cohort snapshot → ${outDir}`);
console.log(`browser ${browser.build ?? '(unknown build)'} on port ${browser.port}, ${targets.length} target(s)`);

// The browser-endpoint socket the agent view is read through (item 23,
// 2026-09-05): a watch attached to a page's own target never hears a cross-site
// delegating embed's registrations, so the union is read where it lives. One
// endpoint fetch for the whole run; a browser that will not answer it is a
// failed launch, not 461 error records to find out with.
const browserEndpoint = await fetch(`http://127.0.0.1:${browser.port}/json/version`, {
  signal: AbortSignal.timeout(10000),
})
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status} from /json/version`);
    return response.json();
  })
  .then((version) => version.webSocketDebuggerUrl)
  .catch((error) => {
    console.error(`cannot capture: browser endpoint unavailable (${error.message})`);
    process.exit(2);
  });

// The difference between "this target failed" and "the whole browser is gone".
// The first is a census row; the second must stop the run loudly — without it,
// every remaining target errors out one by one and the run pretends to work.
const browserAlive = () =>
  fetch(`http://127.0.0.1:${browser.port}/json/version`, { signal: AbortSignal.timeout(3000) })
    .then((response) => response.ok)
    .catch(() => false);

const robotsCache = new Map();
const robotsPermits = async (url) => {
  const { origin, pathname } = new URL(url);
  if (!robotsCache.has(origin)) {
    try {
      const response = await fetch(`${origin}/robots.txt`, {
        headers: { 'user-agent': HARNESS_UA_SUFFIX },
        signal: AbortSignal.timeout(10000),
      });
      robotsCache.set(origin, response.ok ? await response.text() : '');
    } catch {
      // Unreachable robots.txt is permission, per the standard. Recorded as such
      // rather than treated as a refusal, so a flaky host is not silently skipped.
      robotsCache.set(origin, '');
    }
  }
  return robotsAllows(robotsCache.get(origin), pathname);
};

const records = [];
for (const [index, target] of pendingTargets.entries()) {
  const label = `[${index + 1}/${pendingTargets.length}] ${target.project}`;
  let record;
  let browserDied = false;

  if (!(await robotsPermits(target.url))) {
    record = toRecord({
      target,
      capturedAt: new Date().toISOString(),
      status: null,
      error: 'refused: robots.txt disallows this path for our user agent',
    });
    console.log(`${label} — skipped, robots.txt`);
  } else {
    let session = null;
    try {
      session = await openSession({ port: browser.port });
      // The browser's tool view has to be watched from before navigation: the set
      // arrives as events and there is no command that lists it. Since item 23
      // (2026-09-05) the watch sits at the browser endpoint and arms auto-attach
      // recursively — a host-attached watch cannot hear a cross-site delegating
      // embed, which is exactly the registration a cohort census must not miss.
      // The client arms while the tab is still at about:blank and before
      // navigation, so `WebMCP.enable` lands before any page script can
      // register — the ordering the spec-227 rehearsal measured.
      const browserView = await watchBrowserToolsAtBrowser(browserEndpoint);

      // The main document's own status code, taken from the network event rather
      // than a second request: fetching twice to learn a status would double the
      // load this snapshot puts on someone else's free hosting.
      let status = null;
      let finalUrl = null;
      await session.send('Network.enable');
      const off = session.subscribe('Network.responseReceived', (params) => {
        if (params.type === 'Document' && status === null) {
          status = params.response?.status ?? null;
          finalUrl = params.response?.url ?? null;
        }
      });

      try {
        await session.navigate(target.url);
      } catch (error) {
        // A page that never fires load is still a data point: the status may have
        // arrived, and a dead URL is exactly what this snapshot exists to record.
        record = toRecord({
          target,
          capturedAt: new Date().toISOString(),
          status,
          finalUrl,
          error: `navigation: ${error.message}`,
        });
      }

      if (!record) {
        const manifest = await captureManifest(session);
        const title = await session
          .evaluate('document.title')
          .catch(() => null);
        // Both views, per the 2026-09-02 decision: the page's manifest answers
        // "what did this builder ship", the browser's stream answers "what can an
        // agent call here", and a cross-origin embed with `allow="tools"` makes
        // those different answers. Frame origins turn the browser's `frameId`s
        // into attribution, so a third party's tools are never credited to the page.
        const frameTree = await session
          .send('Page.getFrameTree')
          .then(({ frameTree: tree }) =>
            [tree.frame, ...(tree.childFrames ?? []).map((c) => c.frame)].map((f) => ({
              id: f.id,
              origin: f.securityOrigin,
            }))
          )
          .catch(() => []);
        record = toRecord({
          target,
          capturedAt: new Date().toISOString(),
          status,
          finalUrl,
          title,
          manifest,
          browserTools: browserView.tools(),
          frames: frameTree,
          // How the agent view was taken and what it reached. The OOPIF count
          // travels with the number: a record where `agentToolCount` is drawn
          // from a watch no out-of-process iframe ever attached to has measured
          // auto-attach, not the browser's view, and must never read as one.
          browserView: {
            endpoint: 'browser',
            oopiFrames: browserView.oopiFrames,
            attachedSessions: browserView.sessionCount,
            toolSessions: browserView.toolSessionCount,
          },
        });
      }
      off();
      browserView.stop();
    } catch (error) {
      // A target that failed is a census row; a browser that died is a stop
      // sign. Telling them apart is what the night of 2026-09-25/26 earned:
      // before, openSession sat outside this try and a dead browser exited
      // the process instead of saying so.
      if (await browserAlive()) {
        record = toRecord({
          target,
          capturedAt: new Date().toISOString(),
          status: null,
          error: `capture: ${error.message}`,
        });
      } else {
        record = toRecord({
          target,
          capturedAt: new Date().toISOString(),
          status: null,
          error: `browser died mid-capture: ${error.message}`,
        });
        browserDied = true;
      }
    } finally {
      if (session) await session.close();
    }

    const tools = record.webmcp.toolCount;
    console.log(
      `${label} — ${record.liveness.status ?? 'no status'}${record.liveness.redirected ? ' (redirected)' : ''}, ` +
        `${record.webmcp.registered ? `WebMCP: ${tools} tool${tools === 1 ? '' : 's'}` : 'no tools registered'}` +
        `${record.error ? ` — ${record.error}` : ''}`
    );
  }

  // The browser-died record is a stop sign, not a census row: it is printed
  // and never appended, so a resumed run retries this target instead of
  // skipping it as already captured.
  if (browserDied) {
    console.error(`\nbrowser died at target ${index + 1} of ${pendingTargets.length} — nothing after it was attempted`);
    console.error(`${recordsPath} holds every completed capture so far`);
    console.error('rerun with --resume to continue from here');
    await browser.close().catch(() => {});
    process.exit(2);
  }

  records.push(record);
  // Append per project rather than at the end: a capture that cannot be repeated
  // must not be able to lose everything to a crash on the last target.
  await appendFile(recordsPath, `${JSON.stringify(record)}\n`, 'utf8');

  if (index < pendingTargets.length - 1) await new Promise((r) => setTimeout(r, delayMs));
}

await browser.close();

const summary = {
  schema: 'webmcp-gauge/cohort/1',
  startedAt,
  finishedAt: new Date().toISOString(),
  browser: browser.build ?? null,
  userAgentSuffix: HARNESS_UA_SUFFIX,
  targetsGiven: targets.length,
  ...(resume ? { alreadyCaptured: capturedUrls.size } : {}),
  ...summarize(records),
};

await writeFile(`${outDir}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
await writeFile(
  `${outDir}/publishable.json`,
  `${JSON.stringify({ schema: 'webmcp-gauge/cohort-publishable/1', capturedOn: today, projects: records.map(toPublishable) }, null, 2)}\n`,
  'utf8'
);

console.log(JSON.stringify(summary, null, 2));
console.log(`\nlocal (full manifests): ${recordsPath}`);
console.log(`publishable (no descriptions, no titles): ${outDir}/publishable.json`);
