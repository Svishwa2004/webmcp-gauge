/**
 * Is the gallery published yet, and what does the host's own schedule say?
 *
 * This exists because PROJECT-LOG item 12 was date-locked to a **guess**. The log
 * reasoned from the submission deadline — "the gallery opens on the 4th" — and on
 * 2026-09-05 that guess was falsified: submissions had been closed for ~23 h and
 * the gallery still answered *"The hackathon managers haven't published this
 * gallery yet"*. The trigger is an event, not a date, and the only party who knows
 * the date is the host.
 *
 * The host does publish it. `\/details\/dates` carries the schedule as a table, and
 * reading it on 2026-09-05 corrected two things at once: the submission deadline
 * was **1:30 PM** GMT+5:30 on Sep 04, which the log had recorded as 01:30 (a PM
 * read as AM, and twelve hours is enough to matter when a capture is date-locked),
 * and judging runs to **Sep 22** with winners announced **Sep 24** — so the gallery
 * most plausibly opens at the far end of judging rather than at submissions close.
 *
 * Which makes waiting the actual task, and waiting needs to be cheap:
 *
 *  - **One command, and it never harvests.** `gallery-harvest.mjs --probe` also
 *    answers "is it published" — it is what caught the falsification — but it is
 *    the capture-day script, and the capture-day script should not be the thing
 *    someone runs idly for three weeks. This one reads two pages and stops.
 *  - **The answer is dated and includes the schedule**, so the next check date
 *    comes out of the host's page rather than out of someone's memory.
 *  - **Three verdicts**, like `remote-visibility.mjs`: a check whose failure path
 *    cannot tell *no answer* from *the answer I expected* is not a check.
 *      0 — published: go and run the capture, today
 *      1 — definitively not published: the page says so in as many words
 *      2 — cannot answer: robots, a status that is not 200, headless's 202,
 *          or markup that no longer carries the sentence either way
 *
 * Manners are the harvester's, unchanged: headed (Devpost answers headless Chrome
 * with 202 and an empty body), our identity in the user agent, robots.txt read
 * first and obeyed, one page at a time with a delay between them.
 *
 * Usage:
 *   node probes/gallery-status.mjs
 *   node probes/gallery-status.mjs --gallery=https://…/project-gallery
 *   node probes/gallery-status.mjs --schedule=https://…/details/dates
 */
import { launchSession } from '../browser/launch.mjs';
import { openSession } from '../browser/session.mjs';
import { HARNESS_UA_SUFFIX, robotsAllows } from '../core/cohort.mjs';
import { parseOptions } from '../core/args.mjs';

const { options, error: optionsError } = parseOptions(process.argv.slice(2), {
  values: ['gallery', 'schedule', 'delay'],
  switches: ['headless'],
  maxPositional: 0,
});
if (optionsError) {
  console.error(`cannot answer: ${optionsError}`);
  process.exit(2);
}
const flag = (name, fallback) => options[name] ?? fallback;

const galleryUrl = flag('gallery', 'https://webmcp.devpost.com/project-gallery');
const scheduleUrl = flag('schedule', new URL('/details/dates', galleryUrl).href);
const delayMs = Number(flag('delay', '2500'));
const headless = options.headless === true;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => {
  const now = new Date();
  return `${now.toISOString()} / ${now.toLocaleString()} local`;
};

const browser = await launchSession({
  // Fresh profile per invocation: a Chrome that was killed rather than closed
  // leaves a SingletonLock, and the next launch then fails with a message that
  // names the symptom and not the cause. This probe is meant to be run daily, so
  // it is the one most likely to meet that.
  profileDir: `artifacts/gallery-status/profile-${Date.now()}`,
  headless,
  extraArgs: [
    `--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 ${HARNESS_UA_SUFFIX}`,
  ],
});
if (headless) {
  console.warn('warning: --headless was measured to receive HTTP 202 with an empty body from Devpost');
}

const session = await openSession({ port: browser.port });
await session.send('Network.enable');

// Main-frame document statuses, all of them, for the harvester's two measured
// reasons: Devpost's challenge answers 202 first, so the first status is never the
// answer, and an embed can produce further Document responses, so the last is not
// either.
const documentStatuses = [];
let mainFrameId = null;
session.subscribe('Network.responseReceived', (params) => {
  if (params.type !== 'Document') return;
  if (mainFrameId && params.frameId !== mainFrameId) return;
  documentStatuses.push(params.response?.status ?? null);
});
mainFrameId = (await session.send('Page.getFrameTree')).frameTree.frame.id;

const visit = async (url, settleMs = 6000) => {
  documentStatuses.length = 0;
  try {
    await session.navigate(url);
  } catch {
    // A missing load event is not the answer; the status and the DOM are.
  }
  await wait(settleMs);
  const real = documentStatuses.filter((status) => status !== 202);
  return real.at(-1) ?? documentStatuses.at(-1) ?? null;
};

const textOf = (expression) => session.evaluate(expression).catch(() => null);

/**
 * The whole check as a function, so a refusal can `return` a verdict instead of
 * calling `process.exit` from inside a `try` whose `finally` closes the browser.
 * `process.exit` does not wait for an async `finally`, which on a probe meant to
 * be run daily would leak a headed Chrome and a locked profile directory each time
 * robots said no.
 */
const answer = async () => {
  console.log(`checked at ${stamp()}`);
  console.log(`browser ${browser.build ?? '(unknown build)'}`);

  const { origin, pathname } = new URL(galleryUrl);
  const robotsStatus = await visit(`${origin}/robots.txt`, 2500);
  const robotsTxt = (await textOf('document.body ? document.body.innerText : ""')) ?? '';
  if (robotsStatus === 404 || (robotsStatus === 200 && robotsTxt.trim() === '')) {
    console.log(`robots.txt: ${robotsStatus}, treated as permission`);
  } else if (robotsStatus !== 200) {
    console.error(`cannot answer: robots.txt unreadable (status ${robotsStatus})`);
    return 2;
  } else if (!robotsAllows(robotsTxt, pathname)) {
    console.error(`cannot answer: robots.txt disallows ${pathname} for our user agent. This is a stop, not an obstacle.`);
    return 2;
  } else {
    console.log(`robots.txt: 200, ${pathname} permitted`);
  }
  await wait(delayMs);

  let verdict = 2;
  const galleryStatus = await visit(galleryUrl);
  const body = (await textOf('document.body ? document.body.innerText : ""')) ?? '';

  if (galleryStatus !== 200) {
    console.error(
      `cannot answer: ${galleryUrl} returned ${galleryStatus}${galleryStatus === 202 ? ' — run headed, not headless' : ''}`
    );
    verdict = 2;
  } else if (/haven'?t published this gallery yet/i.test(body)) {
    console.log('\nNOT PUBLISHED — the page still says the managers have not published it.');
    verdict = 1;
  } else {
    // A published gallery is not this probe's job to read; `gallery-harvest.mjs`
    // owns the selector cascade and refuses rather than guessing. The count here
    // is a hint that the page has cards at all, deliberately using the loosest of
    // the harvester's strategies so a markup change shows up as a low number
    // rather than as a confident zero.
    const cards = Number(
      (await textOf(
        `document.querySelectorAll('a[href*="devpost.com/software/"], a[href^="/software/"]').length`
      )) ?? 0
    );
    if (cards === 0) {
      console.error(
        '\ncannot answer: the page is 200 and carries neither the unpublished sentence nor any project link. ' +
          'The markup changed — read it before trusting either answer.'
      );
      verdict = 2;
    } else {
      console.log(`\nPUBLISHED — ${cards} project link(s) visible on page 1. Run the capture today:`);
      console.log('  node probes/gallery-harvest.mjs --probe');
      console.log('  node probes/gallery-harvest.mjs');
      console.log('  node probes/cohort-snapshot.mjs --targets=fixtures/cohort/gallery-<date>.json');
      verdict = 0;
    }
  }

  await wait(delayMs);

  // The schedule last, and printed whatever the verdict, because a "not yet" is
  // only useful next to the date it is waiting for.
  const scheduleStatus = await visit(scheduleUrl, 5000);
  if (scheduleStatus !== 200) {
    console.warn(`\nschedule unreadable (${scheduleUrl} returned ${scheduleStatus})`);
  } else {
    const table = await textOf(
      `(() => {
        const tables = [...document.querySelectorAll('table')].map((t) => t.innerText.trim()).filter(Boolean);
        if (tables.length > 0) return tables.join('\\n');
        const lines = (document.body ? document.body.innerText : '').split('\\n');
        const start = lines.findIndex((l) => /period|submissions/i.test(l));
        return start === -1 ? '' : lines.slice(start, start + 8).join('\\n');
      })()`
    );
    console.log(`\nhost schedule (${scheduleUrl}):`);
    console.log(table && table.trim() ? table : '  (no schedule table found on the page)');
  }

  return verdict;
};

let verdict = 2;
try {
  verdict = await answer();
} finally {
  await session.close();
  await browser.close();
}

process.exit(verdict);
