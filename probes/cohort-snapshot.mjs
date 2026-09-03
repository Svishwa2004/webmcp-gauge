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
import { captureManifest, watchBrowserTools } from '../browser/webmcp.mjs';
import {
  normalizeTargets,
  robotsAllows,
  toRecord,
  toPublishable,
  summarize,
  HARNESS_UA_SUFFIX,
  localDateStamp,
  flagFormError,
} from '../core/cohort.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

// `--delay 5000` and `--out artifacts/x` parse as nothing here and leave the
// defaults in place silently. On a capture that cannot be repeated, a refused run
// is cheap and a run against the wrong target or into the wrong directory is not.
const formError = flagFormError(argv);
if (formError) {
  console.error(`cannot capture: ${formError}`);
  process.exit(2);
}

const targetsPath = flag('targets', null);
const singleUrl = flag('url', null);
const delayMs = Number(flag('delay', '2000'));
const settleMs = Number(flag('settle', '10000'));
const today = localDateStamp();
const outDir = resolve(flag('out', `artifacts/cohort-${today}`));
const headless = !argv.includes('--headed');

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
      // arrives as events and there is no command that lists it.
      const browserView = await watchBrowserTools(session);

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
