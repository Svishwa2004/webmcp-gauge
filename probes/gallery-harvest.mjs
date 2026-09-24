/**
 * Harvest the gallery into a targets file for `cohort-snapshot.mjs` (item 12).
 *
 * Two facts, measured 2026-09-01, shape this whole script:
 *
 *  1. **Devpost answers headless Chrome with HTTP 202 and an empty body** — every
 *     URL, including `/robots.txt`. The same request from a *headed* Chrome
 *     returns 200 and the real page. So this runs headed by default. Nothing here
 *     spoofs anything to get in: the harness still identifies itself in the user
 *     agent, and the 200 was obtained with that suffix attached.
 *  2. **`devpost.com/robots.txt` allows us.** `User-agent: *` carries an empty
 *     `Disallow:`. It bans eleven crawlers by name — CCBot, GPTBot,
 *     ChatGPT-User, anthropic-ai, Google-Extended and others — which is worth
 *     reading as intent: Devpost objects to AI training corpora, not to a named
 *     measurement client. That is a reason to keep the rate low and the identity
 *     honest, not a licence to hurry.
 *
 * The gallery was unpublished when this was written ("The hackathon managers
 * haven't published this gallery yet"), so the card selectors are unverifiable
 * until the day. They are therefore a **cascade with counts**, `--probe` shows
 * what matched without harvesting, and an unpublished or unmatched page exits 2
 * rather than writing an empty targets file — a silent empty harvest on the one
 * day this can run would be the worst possible outcome.
 *
 * Usage:
 *   node probes/gallery-harvest.mjs --probe
 *   node probes/gallery-harvest.mjs
 *   node probes/gallery-harvest.mjs --gallery=https://…/project-gallery --delay=2500
 *   node probes/gallery-harvest.mjs --no-projects      # cards only, skip per-project visits
 *
 * Exit codes follow the harness contract: 0 harvested, 2 cannot harvest.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { launchSession } from '../browser/launch.mjs';
import { openSession } from '../browser/session.mjs';
import { startFixtureServer } from '../browser/serve.mjs';
import { HARNESS_UA_SUFFIX, robotsAllows, localDateStamp } from '../core/cohort.mjs';
import { parseOptions } from '../core/args.mjs';
import { pickTarget, galleryPageUrl, toHarvest } from '../core/gallery.mjs';

// One parser for `bin/` and `probes/` since 2026-09-03, and both syntaxes work.
// This file read `--name=value` only, so `--serve fixtures/gallery` was ignored
// and the run walked the **live** gallery while claiming to walk a fixture.
const { options, error: optionsError } = parseOptions(process.argv.slice(2), {
  values: ['serve', 'delay', 'max-pages', 'gallery', 'out', 'targets-out'],
  switches: ['no-projects', 'probe', 'headless', 'resume'],
  maxPositional: 0,
});
if (optionsError) {
  console.error(`cannot harvest: ${optionsError}`);
  process.exit(2);
}
const flag = (name, fallback) => options[name] ?? fallback;

const serveDir = flag('serve', null);
const delayMs = Number(flag('delay', '2500'));
const maxPages = Number(flag('max-pages', '40'));
const visitProjects = options['no-projects'] !== true;
const probeOnly = options.probe === true;
const headless = options.headless === true;
const today = localDateStamp();
const outDir = resolve(flag('out', `artifacts/gallery-${today}`));
// Checkpoint on every page (append-only JSONL: one {page, strategy, rows} per
// line). A 104-page cards walk at ~2.5 s/page takes ~20 min, and a transient
// null-status page (2026-09-24: attempt 1 died on page 96 with 2,280 links
// collected; attempt 2 on page 83 with 1,968) must cost one page, not the
// whole walk. Resume with --resume: already-checkpointed pages are skipped,
// so the second invocation finishes pages 83..104 instead of restarting 1..82.
const resume = options.resume === true;
const checkpointPath = `${outDir}/pages.jsonl`;

// --serve exists so the page walk can be rehearsed against a local two-page
// fixture instead of paging through a stranger's gallery to prove our own loop.
const server = serveDir ? await startFixtureServer({ root: resolve(serveDir) }) : null;
const galleryUrl = server
  ? new URL(flag('gallery', 'gallery.html'), server.origin).href
  : flag('gallery', 'https://webmcp.devpost.com/project-gallery');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (message) => {
  console.error(`cannot harvest: ${message}`);
  process.exit(2);
};

const browser = await launchSession({
  // A fresh profile per invocation, not a shared one under outDir. A previous
  // run's Chrome that was killed rather than closed leaves a SingletonLock
  // behind, and the next launch then times out after 30 s with "did not expose
  // DevTools" — a message that names the symptom and not the cause. Measured on
  // 2026-09-02: the first gallery check of the day failed exactly that way, and
  // a fresh profile fixed it instantly. On capture day that is not a confusion
  // anyone should have to debug.
  profileDir: `${outDir}/profile-${Date.now()}`,
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

/**
 * Main-frame document statuses only, and all of them.
 *
 * Two measured reasons this cannot be one variable holding "the last status":
 * Devpost's bot challenge answers first with **202** and then serves the real
 * response, so the first status is never the answer; and a project page with a
 * YouTube embed produces further Document responses from the **iframe**, so the
 * last status is not the answer either. Filtering by the main frame and keeping
 * the sequence makes both visible instead of averaged into a wrong number.
 */
const documentStatuses = [];
let mainFrameId = null;
session.subscribe('Network.responseReceived', (params) => {
  if (params.type !== 'Document') return;
  if (mainFrameId && params.frameId !== mainFrameId) return;
  documentStatuses.push(params.response?.status ?? null);
});
mainFrameId = (await session.send('Page.getFrameTree')).frameTree.frame.id;

/** Navigate, then give the page time to settle; Devpost's shell renders after load. */
const visit = async (url, settleMs = 4000) => {
  documentStatuses.length = 0;
  try {
    await session.navigate(url);
  } catch {
    // A missing load event is not fatal here: the status and the DOM are what matter.
  }
  await wait(settleMs);
  // The challenge's 202 is a waiting room, not a verdict. If a real status
  // followed it, that is the one; if 202 is all there was, the caller must see it.
  const real = documentStatuses.filter((status) => status !== 202);
  return real.at(-1) ?? documentStatuses.at(-1) ?? null;
};

const text = (expression) => session.evaluate(expression).catch(() => null);

try {
  const { origin, pathname } = new URL(galleryUrl);
  // Robots first, through the browser, because a plain fetch cannot read it. The
  // origin comes from the gallery URL rather than being hardcoded, so the same
  // check applies to a local rehearsal and to any other host.
  // Retried like the page walk: Devpost's 202 waiting room answers intermittently
  // once a session has walked ~80+ pages (2026-09-24, attempts 1-3), and a single
  // 202 on robots.txt must not fail a harvest before it has begun.
  let robotsStatus = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    robotsStatus = await visit(`${origin}/robots.txt`, attempt === 1 ? 2500 : 8000);
    if (robotsStatus === 200 || robotsStatus === 404) break;
    if (attempt < 3) {
      console.warn(`robots.txt: status ${robotsStatus} (attempt ${attempt}/3) — waiting and retrying`);
      await wait(delayMs * 4);
    }
  }
  const robotsTxt = (await text('document.body ? document.body.innerText : ""')) ?? '';
  if (robotsStatus === 404 || (robotsStatus === 200 && robotsTxt.trim() === '')) {
    // No robots.txt is permission, and a local fixture has none.
    console.log(`robots.txt: ${robotsStatus}, treated as permission`);
  } else if (robotsStatus !== 200) {
    fail(`robots.txt unreadable (status ${robotsStatus}). Refusing to harvest without checking it.`);
  } else if (!robotsAllows(robotsTxt, pathname)) {
    fail(`robots.txt disallows ${pathname} for our user agent. This is a stop, not an obstacle.`);
  } else {
    console.log(`robots.txt: 200, ${pathname} permitted`);
  }
  await wait(delayMs);

  const seen = new Map();
  let matchedBy = null;
  let lastPage = null;

  // The checkpoint is the difference between "one page failed" and "the walk
  // failed". A fresh run truncates whatever an earlier attempt left; --resume
  // reloads every checkpointed page into `seen` and skips re-visiting it, so a
  // transient null on page 83 costs page 83 instead of pages 1..82.
  await mkdir(outDir, { recursive: true });
  const checkpointed = new Map(); // page number -> checkpoint entry
  if (resume) {
    const lines = (await readFile(checkpointPath, 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // Zero-row entries are never trusted: a waiting-room 200 that carried no
        // cards was checkpointed once (2026-09-24, page 3) and would have made
        // the walk skip a page it never actually read. Such pages are re-walked.
        if (Number.isInteger(entry?.page) && Array.isArray(entry?.rows) && entry.rows.length > 0) {
          checkpointed.set(entry.page, entry);
        }
      } catch {
        // A torn final line from a killed run is expected in an append-only
        // file; every whole line before it still loads.
      }
    }
  } else {
    await writeFile(checkpointPath, '', 'utf8');
  }
  if (checkpointed.size > 0) {
    for (const page of [...checkpointed.keys()].sort((a, b) => a - b)) {
      const entry = checkpointed.get(page);
      for (const row of entry.rows ?? []) {
        const key = new URL(row.href).pathname.replace(/\/$/, '');
        if (!seen.has(key)) seen.set(key, { title: row.title, devpostUrl: row.href });
      }
      matchedBy = matchedBy ?? entry.strategy ?? null;
      if (lastPage === null && Number.isInteger(entry.lastPage)) lastPage = entry.lastPage;
    }
    console.log(`resume: ${checkpointed.size} checkpointed page(s) reloaded, ${seen.size} project(s) recovered`);
  }

  for (let page = 1; page <= maxPages; page += 1) {
    if (checkpointed.has(page)) continue;
    // On resume the pager count is known before the first live visit, so stop
    // at it here as well — otherwise a completed 1..lastPage walk visits one
    // page past the end just to learn it is past the end (rehearsal 2026-09-24:
    // a --resume run over a finished 2-page fixture still fetched page 3).
    if (lastPage !== null && page > lastPage) break;
    const url = galleryPageUrl(galleryUrl, page);
    // One retry loop for the card walk, keyed on the thing that actually matters:
    // cards on the page. A non-200 status and a 200 whose body carries no cards
    // are both failures — Devpost's waiting room has produced both shapes
    // (2026-09-24: null status on pages 3 and 96; a 200 with zero gallery items
    // on page 3), and checkpointing an empty page would make a truncated cohort
    // look complete. Bounded: at most 3 attempts per page, then fail loudly
    // rather than harvest a truncated cohort.
    let status = null;
    let found = { strategy: null, rows: [] };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      status = await visit(url, attempt === 1 ? 5000 : 10000);
      if (status === 200) {
        const body = (await text('document.body.innerText')) ?? '';
        if (/haven'?t published this gallery yet/i.test(body)) {
          fail('the gallery is not published yet. Nothing to harvest — re-run on gallery-publish day.');
        }

        // Devpost's pager names the last page, which is a far better stopping rule
        // than "this page added nothing new". Verified 2026-09-01 against a published
        // gallery whose pager listed ?page=26 while showing 24 cards per page: with
        // only the no-new-links rule, one slow-rendering page in the middle would end
        // the walk early and the harvest would look complete.
        if (page === 1) {
          const pager = JSON.parse(
            (await text(`JSON.stringify([...document.querySelectorAll('a[href*="page="]')]
              .map((a) => Number(new URL(a.href, location.href).searchParams.get('page')))
              .filter((n) => Number.isInteger(n) && n > 0))`)) ?? '[]'
          );
          lastPage = pager.length > 0 ? Math.max(...pager) : 1;
          console.log(`pager reports ${lastPage} page(s)`);
          if (lastPage > maxPages) {
            fail(`the gallery has ${lastPage} pages but --max-pages is ${maxPages}. Raise it rather than harvest a truncated cohort.`);
          }
        }

        // Selector cascade. Devpost's markup cannot be verified before publication, so
        // every candidate is tried and the one that matched is recorded in the output.
        found = JSON.parse(
          (await text(`(() => {
            const strategies = [
              ['gallery-item', 'a.link-to-software'],
              ['software-entry', '.software-entry a[href*="/software/"]'],
              ['gallery-anchor', '.gallery-item a[href*="/software/"]'],
              ['any-software-link', 'a[href*="devpost.com/software/"]'],
              ['relative-software-link', 'a[href^="/software/"]'],
            ];
            for (const [name, selector] of strategies) {
              const nodes = [...document.querySelectorAll(selector)];
              if (nodes.length === 0) continue;
              const rows = nodes.map((a) => ({
                href: a.href,
                title: (a.querySelector('h5, .software-entry-name, .title')?.innerText ?? a.innerText ?? '').trim().split('\\n')[0],
              })).filter((r) => /\\/software\\//.test(r.href));
              if (rows.length > 0) return JSON.stringify({ strategy: name, rows });
            }
            return JSON.stringify({ strategy: null, rows: [] });
          })()`)) ?? '{"strategy":null,"rows":[]}'
        );
        if (found.rows.length > 0) break;
      }
      if (attempt < 3) {
        console.warn(`page ${page}: status ${status}, ${found.rows.length} card(s) (attempt ${attempt}/3) — waiting and retrying`);
        await wait(delayMs * 2);
      }
    }
    if (status !== 200) fail(`gallery page ${page} returned ${status} after 3 attempts${status === 202 ? ' — run headed, not headless' : ''}`);

    if (found.rows.length === 0) {
      if (page === 1) {
        const outline =
          (await text(`JSON.stringify(Object.entries([...document.querySelectorAll('*')].reduce((counts, el) => {
            const key = el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/)[0] : '');
            counts[key] = (counts[key] ?? 0) + 1;
            return counts;
          }, {})).sort((a, b) => b[1] - a[1]).slice(0, 25))`)) ?? '[]';
        console.error('no card matched any strategy. Most common elements on the page:');
        console.error(outline);
        fail('every selector strategy found zero project links — the markup changed, and guessing would produce a wrong dataset');
      }
      fail(`gallery page ${page} returned 200 but carried no project cards after 3 attempts — waiting room or markup change, not an empty page; read it before trusting the harvest`);
    }

    matchedBy = matchedBy ?? found.strategy;
    const before = seen.size;
    for (const row of found.rows) {
      const key = new URL(row.href).pathname.replace(/\/$/, '');
      if (!seen.has(key)) seen.set(key, { title: row.title, devpostUrl: row.href });
    }
    console.log(`page ${page}: ${found.rows.length} link(s) via "${found.strategy}", ${seen.size - before} new (total ${seen.size})`);
    // Checkpoint only after the page's rows are in `seen`, so a reload cannot
    // produce a half-page: the line and the in-memory state land together or
    // the line never exists.
    await appendFile(checkpointPath, `${JSON.stringify({ page, strategy: found.strategy, rows: found.rows, lastPage })}\n`, 'utf8');

    // Stop on the pager's own count when there is one; fall back to "nothing new"
    // only for a gallery that shows no pager at all.
    if (lastPage && page >= lastPage) break;
    if (!lastPage && seen.size === before) break;
    if (lastPage && seen.size === before) {
      console.warn(`page ${page} added nothing new although the pager claims ${lastPage} pages — continuing, because stopping here would truncate`);
    }
    await wait(delayMs);
  }

  if (probeOnly) {
    console.log(`\nprobe only. ${seen.size} project page(s) discovered via "${matchedBy}".`);
    console.log([...seen.values()].slice(0, 10).map((v) => `  ${v.title} — ${v.devpostUrl}`).join('\n'));
    process.exitCode = 0;
  } else {
    const picks = [];
    const projects = [...seen.values()];

    // The project-page walk is an hour of visits at 2,496 projects and gets the
    // same checkpoint treatment as the card walk, keyed by devpostUrl: a page
    // that returns null at minute 90 costs that page, not the other 89 minutes.
    const picksPath = `${outDir}/picks.jsonl`;
    const donePicks = new Map(); // devpostUrl -> pick
    if (visitProjects) {
      if (resume) {
        const lines = (await readFile(picksPath, 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          try {
            const pick = JSON.parse(line);
            if (pick?.devpostUrl) donePicks.set(pick.devpostUrl, pick);
          } catch {
            // Torn final line — same tolerance as the card checkpoint.
          }
        }
        if (donePicks.size > 0) console.log(`resume: ${donePicks.size} project page(s) already read — skipping them`);
      } else {
        await writeFile(picksPath, '', 'utf8');
      }
    }

    for (const [index, project] of projects.entries()) {
      const already = donePicks.get(project.devpostUrl) ?? null;
      if (already) {
        picks.push(already);
        if ((index + 1) % 10 === 0) console.log(`  …${index + 1}/${projects.length} project pages read`);
        continue;
      }
      let links = [];
      let scope = null;
      if (visitProjects) {
        const status = await visit(project.devpostUrl, 3500);
        if (status === 200) {
          // Only the submission's own links section. Measured on a real project
          // page (2026-09-01): falling back to `main` or `body` sweeps in
          // Devpost's footer socials and its sponsor rail — devpost.team and
          // worldmacpc.com among them — and "first demo-class link wins" would
          // then capture a sponsor's site as somebody's submission. A recorded
          // gap is worth more than a confident wrong URL, so when the links
          // section is missing this project is skipped and says so.
          const extracted = JSON.parse(
            (await text(`(() => {
              const scopes = ['ul.app-links', '.app-links', '#app-details-link'];
              for (const selector of scopes) {
                const roots = [...document.querySelectorAll(selector)];
                if (roots.length === 0) continue;
                const rows = roots.flatMap((root) => [...root.querySelectorAll('a[href^="http"]')]
                  .map((a) => ({ url: a.href, label: (a.innerText ?? '').trim().slice(0, 60) })));
                if (rows.length > 0) return JSON.stringify({ scope: selector, rows });
              }
              return JSON.stringify({ scope: null, rows: [] });
            })()`)) ?? '{"scope":null,"rows":[]}'
          );
          links = extracted.rows;
          scope = extracted.scope;
        } else {
          console.log(`  ${project.title}: project page returned ${status}`);
        }
        await wait(delayMs);
      }

      const pick = pickTarget({ title: project.title, devpostUrl: project.devpostUrl, links });
      if (!pick.url && scope === null && visitProjects) {
        pick.skipReason = 'no submission links section on the project page';
      }
      picks.push(pick);
      if (visitProjects) await appendFile(picksPath, `${JSON.stringify(pick)}\n`, 'utf8');
      if ((index + 1) % 10 === 0) console.log(`  …${index + 1}/${projects.length} project pages read`);
    }

    const harvest = { ...toHarvest(picks, { source: galleryUrl, harvestedAt: new Date().toISOString() }), matchedBy };

    await mkdir(outDir, { recursive: true });
    const targetsPath = resolve(flag('targets-out', `fixtures/cohort/gallery-${today}.json`));
    await mkdir(resolve(targetsPath, '..'), { recursive: true });
    await writeFile(`${outDir}/harvest.json`, `${JSON.stringify(harvest, null, 2)}\n`, 'utf8');
    await writeFile(targetsPath, `${JSON.stringify(harvest.targets, null, 2)}\n`, 'utf8');

    console.log(`\n${JSON.stringify(harvest.counts, null, 2)}`);
    console.log(`targets  → ${targetsPath}`);
    console.log(`audit    → ${outDir}/harvest.json  (skipped + ambiguous rows, with reasons)`);
    console.log(`\nnext: node probes/cohort-snapshot.mjs --targets=${targetsPath.replace(/\\/g, '/')}`);

    if (harvest.counts.usable === 0) fail('harvested zero usable targets — do not run the snapshot against an empty list');
  }
} finally {
  await session.close();
  await browser.close();
  if (server) await server.close();
}
