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
  normalizeTargets,
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
  switches: ['headed'],
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
for (const [index, target] of targets.entries()) {
  const label = `[${index + 1}/${targets.length}] ${target.project}`;
  let record;

  if (!(await robotsPermits(target.url))) {
    record = toRecord({
      target,
      capturedAt: new Date().toISOString(),
      status: null,
      error: 'refused: robots.txt disallows this path for our user agent',
    });
    console.log(`${label} — skipped, robots.txt`);
  } else {
    const session = await openSession({ port: browser.port });
    try {
      // The browser's tool view has to be watched from before navigation: the set
      // arrives as events and there is no command that lists it. Since item 23
      // (2026-09-05) the watch sits at the browser endpoint and arms auto-attach
      // recursively — a host-attached watch cannot hear a cross-site delegating
      // embed, which is exactly the registration a cohort census must not miss.
      // The client is opened before `openSession` so the tab this target creates
      // is caught at birth, and closed with the target below.
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
      record = toRecord({
        target,
        capturedAt: new Date().toISOString(),
        status: null,
        error: `capture: ${error.message}`,
      });
    } finally {
      await session.close();
    }

    const tools = record.webmcp.toolCount;
    console.log(
      `${label} — ${record.liveness.status ?? 'no status'}${record.liveness.redirected ? ' (redirected)' : ''}, ` +
        `${record.webmcp.registered ? `WebMCP: ${tools} tool${tools === 1 ? '' : 's'}` : 'no tools registered'}` +
        `${record.error ? ` — ${record.error}` : ''}`
    );
  }

  records.push(record);
  // Append per project rather than at the end: a capture that cannot be repeated
  // must not be able to lose everything to a crash on the last target.
  await appendFile(recordsPath, `${JSON.stringify(record)}\n`, 'utf8');

  if (index < targets.length - 1) await new Promise((r) => setTimeout(r, delayMs));
}

await browser.close();

const summary = {
  schema: 'webmcp-gauge/cohort/1',
  startedAt,
  finishedAt: new Date().toISOString(),
  browser: browser.build ?? null,
  userAgentSuffix: HARNESS_UA_SUFFIX,
  targetsGiven: targets.length,
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
