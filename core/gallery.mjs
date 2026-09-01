/**
 * Turning a gallery page into a targets file: the parts that can be decided
 * without a browser, and therefore tested before the one day they have to work.
 *
 * The gallery was still unpublished when this was written (2026-09-01: the page
 * says "The hackathon managers haven't published this gallery yet"), so the DOM
 * selectors cannot be verified yet and live in the runner behind a cascade. What
 * *can* be settled now is the reasoning applied to whatever links come back:
 * which link is the demo, which is the repo, and which are neither.
 *
 * Getting that wrong on the day is expensive in a specific way — a project whose
 * GitHub URL is mistaken for its demo produces a "no tools registered" row, which
 * is indistinguishable in the census from a project that genuinely shipped none.
 */

/** Hosts whose links are never the thing we want to measure. */
const REPO_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);
const VIDEO_HOSTS = new Set(['youtube.com', 'youtu.be', 'vimeo.com', 'loom.com']);
const SOCIAL_HOSTS = new Set([
  'twitter.com',
  'x.com',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'discord.com',
  'discord.gg',
  'reddit.com',
  't.me',
]);
/** Package and doc hosts that appear on submissions but host no page to measure. */
const ARTEFACT_HOSTS = new Set([
  'npmjs.com',
  'pypi.org',
  'crates.io',
  'chromewebstore.google.com',
  'chrome.google.com',
  'addons.mozilla.org',
  'docs.google.com',
  'drive.google.com',
  'notion.so',
  'devpost.com',
  // Devpost's own chrome and asset hosts. Measured on a real project page
  // (2026-09-01): its footer and sponsor rail offer devpost.team and a
  // cloudfront asset URL, both of which classify as "demo" unless named here,
  // and one of them would then be captured as somebody's submission.
  'devpost.team',
  'cloudfront.net',
  'amazonaws.com',
  'devpost-file-uploads.s3.amazonaws.com',
]);

const hostOf = (url) => {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
};

/**
 * What kind of link this is. Deliberately coarse: the only decision downstream is
 * "is this a page a browser can be pointed at to read a WebMCP manifest".
 */
export const classifyLink = (url) => {
  const host = hostOf(url);
  if (!host) return 'unusable';

  const base = host.split('.').slice(-2).join('.');
  if (REPO_HOSTS.has(base)) return 'repo';
  if (VIDEO_HOSTS.has(base)) return 'video';
  if (SOCIAL_HOSTS.has(base)) return 'social';
  if (ARTEFACT_HOSTS.has(base) || ARTEFACT_HOSTS.has(host)) return 'artefact';
  return 'demo';
};

/**
 * One project's links reduced to one row for the snapshot, or a refusal.
 *
 * Ordering rule, stated because it decides the dataset: the **first** demo-class
 * link wins. Devpost renders submission links in the order the entrant chose, and
 * an entrant who lists their live site first meant it. Ties are not broken by
 * cleverness — guessing which of two candidate URLs is "more live" would be an
 * invented preference, and the runner records every candidate so a human can
 * override one row rather than distrust all of them.
 */
export const pickTarget = ({ title, devpostUrl, links = [] }) => {
  const classified = links
    .map((link) => (typeof link === 'string' ? { url: link } : link))
    .filter((link) => link && typeof link.url === 'string' && link.url.trim() !== '')
    .map((link) => ({ url: link.url.trim(), label: link.label ?? null, kind: classifyLink(link.url.trim()) }));

  const demos = classified.filter((l) => l.kind === 'demo');
  const repos = classified.filter((l) => l.kind === 'repo');

  return {
    project: title?.trim() || hostOf(devpostUrl) || 'untitled',
    devpostUrl: devpostUrl ?? null,
    url: demos[0]?.url ?? null,
    repo: repos[0]?.url ?? null,
    otherDemoCandidates: demos.slice(1).map((l) => l.url),
    rejected: classified.filter((l) => l.kind !== 'demo' && l.kind !== 'repo'),
    // A submission with no page to visit is not an error and not a target: it is a
    // row in the census that says so, and the reason has to survive to the report.
    skipReason: demos.length === 0 ? 'no demo-class link on the submission' : null,
  };
};

/**
 * Devpost paginates its galleries with ?page=N, 1-indexed. Kept here so the page
 * walk is a pure function of the base URL and can be tested without fetching.
 */
export const galleryPageUrl = (base, page) => {
  const url = new URL(base);
  if (page > 1) url.searchParams.set('page', String(page));
  else url.searchParams.delete('page');
  return url.href;
};

/**
 * The harvest as it will be handed to `cohort-snapshot.mjs`, plus the audit trail
 * of what was dropped. Both halves are written to disk: a targets file that is
 * only the measurable rows, and a manifest of every decision made to get there.
 */
export const toHarvest = (picks, { source, harvestedAt }) => {
  const usable = picks.filter((p) => !p.skipReason && p.url);
  const skipped = picks.filter((p) => p.skipReason || !p.url);

  return {
    schema: 'webmcp-gauge/gallery-harvest/1',
    source,
    harvestedAt,
    counts: {
      projects: picks.length,
      usable: usable.length,
      skipped: skipped.length,
      ambiguous: usable.filter((p) => p.otherDemoCandidates.length > 0).length,
      withRepo: usable.filter((p) => p.repo).length,
    },
    targets: usable.map((p) => ({ project: p.project, url: p.url, repo: p.repo })),
    skipped: skipped.map((p) => ({ project: p.project, devpostUrl: p.devpostUrl, reason: p.skipReason ?? 'no url' })),
    ambiguous: usable
      .filter((p) => p.otherDemoCandidates.length > 0)
      .map((p) => ({ project: p.project, chosen: p.url, alsoOffered: p.otherDemoCandidates })),
  };
};
