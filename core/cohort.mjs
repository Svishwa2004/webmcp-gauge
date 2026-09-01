/**
 * The cohort snapshot: what gets captured, what gets published, and what is
 * refused. Deliberately browser-free so it can be tested without one — the
 * runner in probes/ owns the CDP work, this owns the rules.
 *
 * This module exists because the capture is a one-day, non-repeatable event
 * (docs/concept.md milestone 4). A bug found on the day is a bug that costs the
 * whole dataset, so the parts that can be decided in advance are decided here,
 * under test, before the gallery opens.
 *
 * Publishing policy is enforced in code rather than remembered, per concept §12:
 * derived metrics and links only, never another project's source or assets.
 */

/** The UA suffix every request in a cohort capture must carry, per §12. */
export const HARNESS_UA_SUFFIX = 'webmcp-gauge/0.1 (+https://github.com/Svishwa2004/webmcp-gauge; measurement, contact via repo issues)';

/**
 * The date a capture is filed under, in the operator's own timezone.
 *
 * `toISOString().slice(0, 10)` is UTC, and this machine runs at UTC+5:30: a
 * capture started at 00:30 local on gallery-publish day would be filed under the
 * *previous* date. For the one artifact whose entire claim is "taken on the day
 * those URLs were simultaneously live", a date off by one is not cosmetic.
 */
export const localDateStamp = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Accepts the messy shapes a URL list arrives in and returns one canonical row
 * per project, or throws with the offending entry. A list assembled by hand on
 * the day will contain duplicates and bare hostnames; both are cheaper to handle
 * here than at 2 a.m.
 */
export const normalizeTargets = (raw) => {
  if (!Array.isArray(raw)) throw new TypeError('cohort targets must be an array');

  const seen = new Map();
  const rows = [];

  for (const [index, entry] of raw.entries()) {
    const source = typeof entry === 'string' ? { url: entry } : entry ?? {};
    const rawUrl = String(source.url ?? '').trim();
    if (!rawUrl) throw new TypeError(`target ${index} has no url`);

    // A scheme we do not speak must be refused, not repaired. Prepending https
    // to "ftp://host/x" yields a URL that parses, with host "ftp" — a target
    // that would be captured as dead instead of reported as unusable.
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(rawUrl)?.[1]?.toLowerCase() ?? null;
    if (scheme && scheme !== 'http' && scheme !== 'https') {
      throw new TypeError(`target ${index} is not http(s): ${rawUrl}`);
    }

    const withScheme = scheme ? rawUrl : `https://${rawUrl}`;
    let parsed;
    try {
      parsed = new URL(withScheme);
    } catch {
      throw new TypeError(`target ${index} is not a URL: ${rawUrl}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new TypeError(`target ${index} is not http(s): ${rawUrl}`);
    }

    // Same page reached by two spellings is one capture, not two visits to
    // someone else's free hosting. Fragment and trailing slash are not identity.
    parsed.hash = '';
    const key = `${parsed.host}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`;
    if (seen.has(key)) {
      rows[seen.get(key)].aliases.push(parsed.href);
      continue;
    }

    seen.set(key, rows.length);
    rows.push({
      project: source.project ? String(source.project) : parsed.host,
      url: parsed.href,
      repo: source.repo ? String(source.repo) : null,
      aliases: [],
    });
  }

  return rows;
};

/**
 * Minimal robots.txt evaluation for one path and our own user-agent token.
 *
 * Honouring robots is a §12 commitment, and a snapshot that quietly ignored it
 * would poison the dataset's provenance rather than just its manners. Scope is
 * stated so nobody mistakes it for a full implementation: `User-agent`,
 * `Disallow`, `Allow`, longest-match wins, `*` wildcards and `$` anchors. No
 * crawl-delay (the runner rate-limits unconditionally instead), no sitemaps.
 * An unfetchable or unparseable robots.txt is treated as permission, which is
 * what the standard says and is worth saying out loud.
 */
export const robotsAllows = (robotsTxt, path, agent = 'webmcp-gauge') => {
  if (typeof robotsTxt !== 'string' || robotsTxt.trim() === '') return true;

  const groups = [];
  let current = null;
  for (const line of robotsTxt.split(/\r?\n/)) {
    const text = line.replace(/#.*$/, '').trim();
    if (!text) continue;
    const [rawField, ...rest] = text.split(':');
    const field = rawField.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one rule block.
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((field === 'disallow' || field === 'allow') && current) {
      current.rules.push({ allow: field === 'allow', pattern: value });
    }
  }

  const lower = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && lower.includes(a)));
  const wildcard = groups.filter((g) => g.agents.includes('*'));
  const applicable = specific.length > 0 ? specific : wildcard;
  if (applicable.length === 0) return true;

  const toRegExp = (pattern) => {
    const anchored = pattern.endsWith('$');
    const body = anchored ? pattern.slice(0, -1) : pattern;
    const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
  };

  let verdict = true;
  let strongest = -1;
  for (const group of applicable) {
    for (const rule of group.rules) {
      // An empty Disallow means "allow everything" and matches nothing.
      if (rule.pattern === '' && !rule.allow) continue;
      if (!toRegExp(rule.pattern).test(path)) continue;
      // Longest match wins; Allow beats Disallow at equal length.
      if (rule.pattern.length > strongest || (rule.pattern.length === strongest && rule.allow)) {
        strongest = rule.pattern.length;
        verdict = rule.allow;
      }
    }
  }
  return verdict;
};

/**
 * One captured project as it is stored locally: the full manifest, because the
 * linter and every later analysis need the real text.
 *
 * The distinction between `apiPresent` and `registered` is load-bearing, and the
 * dry run on 2026-09-01 is why it exists. `document.modelContext` is present on
 * **every** page in a WebMCP-enabled browser — it is a browser API, not a page
 * opt-in — so `example.com` and a 404 page both reported "WebMCP present". Had
 * the census counted that, the dataset's headline claim would have been that
 * most of the cohort uses WebMCP, when what was measured was that Chrome does.
 * A project *uses* WebMCP when it registers at least one tool, and nothing else
 * counts.
 */
export const toRecord = ({ target, capturedAt, status, finalUrl, title, manifest, error = null }) => {
  const reachable = typeof status === 'number' && status < 400;
  const tools =
    manifest?.tools?.map((tool) => ({
      name: tool.name ?? null,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema ?? null,
      inputSchemaWire: tool.inputSchemaWire ?? null,
      annotations: tool.annotations ?? null,
    })) ?? [];

  return {
    project: target.project,
    url: target.url,
    repo: target.repo ?? null,
    aliases: target.aliases ?? [],
    capturedAt,
    liveness: {
      status: status ?? null,
      finalUrl: finalUrl ?? null,
      redirected: Boolean(finalUrl && finalUrl !== target.url),
      reachable,
    },
    title: title ?? null,
    webmcp: {
      // A property of the browser this capture ran in, kept for the compatibility
      // record and never counted as adoption.
      apiPresent: Boolean(manifest?.present),
      // A property of the page, and the only adoption signal. A page that could
      // not be reached registered nothing, whatever its error document did.
      registered: reachable && tools.length > 0,
      settled: manifest?.settled ?? null,
      inNavigator: manifest?.inNavigator ?? null,
      toolCount: reachable ? tools.length : 0,
      tools: reachable ? tools : [],
    },
    error,
  };
};

/**
 * What may leave this machine. The local record keeps descriptions verbatim
 * because they are the measured object; the published row keeps only shape.
 *
 * The decision this encodes, recorded 2026-09-01: a tool *name* is published
 * (it is an interface, like a function name in an API doc), a tool
 * *description* is not (it is someone's prose, and §12 forbids republishing
 * another project's source). Descriptions survive as lengths and as whatever
 * the linter derives from them, which is what every aggregate claim needs.
 */
export const toPublishable = (record) => ({
  project: record.project,
  url: record.url,
  repo: record.repo,
  capturedAt: record.capturedAt,
  reachable: record.liveness.reachable,
  status: record.liveness.status,
  redirected: record.liveness.redirected,
  // "Uses WebMCP" means "registered at least one tool". The browser-API flag is
  // published beside it so the two can never be conflated by a later reader.
  usesWebmcp: record.webmcp.registered,
  browserApiPresent: record.webmcp.apiPresent,
  toolCount: record.webmcp.toolCount,
  tools: record.webmcp.tools.map((tool) => ({
    name: tool.name,
    descriptionLength: typeof tool.description === 'string' ? tool.description.length : null,
    propertyCount:
      tool.inputSchema && typeof tool.inputSchema === 'object' && tool.inputSchema.properties
        ? Object.keys(tool.inputSchema.properties).length
        : null,
    requiredCount: Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required.length : null,
    hasAnnotations: Boolean(tool.annotations && Object.keys(tool.annotations).length > 0),
    inputSchemaWire: tool.inputSchemaWire,
  })),
});

/**
 * The one-line-per-project census a snapshot is judged by.
 *
 * `usingWebmcp` counts pages that registered a tool. There is deliberately no
 * count of pages where the API merely existed, because that number describes the
 * browser and would be misread as adoption the moment it appeared in a table.
 */
export const summarize = (records) => {
  const reachable = records.filter((r) => r.liveness.reachable);
  const using = reachable.filter((r) => r.webmcp.registered);
  const toolCounts = using.map((r) => r.webmcp.toolCount).sort((a, b) => a - b);

  return {
    projects: records.length,
    reachable: reachable.length,
    dead: records.length - reachable.length,
    usingWebmcp: using.length,
    reachableWithoutTools: reachable.length - using.length,
    totalTools: toolCounts.reduce((sum, n) => sum + n, 0),
    medianToolCount: toolCounts.length
      ? toolCounts[Math.floor((toolCounts.length - 1) / 2)]
      : null,
    maxToolCount: toolCounts.length ? toolCounts.at(-1) : null,
    errors: records.filter((r) => r.error).length,
  };
};
