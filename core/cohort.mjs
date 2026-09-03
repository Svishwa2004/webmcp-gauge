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
 * Every option the capture probes take is `--name=value`, or a bare `--switch`.
 * A space-separated `--gallery https://…` therefore parses as **nothing**, and the
 * probe quietly uses its default instead.
 *
 * Found 2026-09-03, the day before the capture: `--serve fixtures/gallery` was
 * meant to walk a local fixture and walked the **live gallery** instead, because
 * the value never reached the parser. The same slip on capture day aims a run at
 * the wrong target while its operator believes otherwise — and the CLI in `bin/`
 * *does* accept the space form, which is exactly how the habit forms.
 *
 * Returns an error string, or null when the argv is well formed.
 */
export const flagFormError = (argv = []) => {
  const list = Array.isArray(argv) ? argv : [];
  const strayIndex = list.findIndex((arg) => typeof arg !== 'string' || !arg.startsWith('--'));
  if (strayIndex === -1) return null;

  const stray = String(list[strayIndex]);
  const previous = strayIndex > 0 ? String(list[strayIndex - 1]) : null;
  const hint =
    previous && previous.startsWith('--') && !previous.includes('=')
      ? ` — write ${previous}=${stray}, not ${previous} ${stray}`
      : '';
  return `unexpected argument '${stray}'${hint}. Every option here is --name=value or a bare --switch, so an option written with a space is silently ignored rather than applied.`;
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
 * Attribute each browser-visible tool to the document that registered it.
 *
 * Decided 2026-09-02, before the capture, because the alternative is unrecoverable.
 * A cross-origin embed with `allow="tools"` registers tools that reach the
 * **browser** — and therefore an agent — while appearing in **nobody's**
 * `getTools()`: not the host's, not the union of any script-visible surface. Two
 * different claims then need two different denominators:
 *
 *   - "this project shipped tools" is an **attribution** claim, and counting an
 *     embedded third party's tools would credit a builder with someone else's
 *     work. It uses the page's own view, restricted to the page's origin.
 *   - "an agent can call these tools here" is a **reality** claim, and the
 *     browser's view is the only one that answers it.
 *
 * So both are captured and each published number says which it used. Capturing
 * one view is a permanent loss on a one-day capture; capturing both is not.
 *
 * `frameId` on each browser-view tool maps to a frame's origin; the top call frame
 * of its `stackTrace` names the registering script, which is the fallback when a
 * frame has gone by the time the tree is read.
 */
export const attributeTools = (browserTools, frames = [], pageOrigin = null) => {
  if (!Array.isArray(browserTools)) return null;

  const originByFrame = new Map((frames ?? []).map((f) => [f.id, f.origin]));
  const originOf = (url) => {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  };

  return browserTools.map((tool) => {
    const scriptUrl = tool?.stackTrace?.callFrames?.[0]?.url ?? null;
    const origin = originByFrame.get(tool?.frameId) ?? originOf(scriptUrl) ?? null;
    return {
      name: tool?.name ?? null,
      frameId: tool?.frameId ?? null,
      origin,
      scriptUrl,
      // Unknown provenance is not "same origin". A tool whose origin could not be
      // established must not be silently credited to the page.
      sameOrigin: origin && pageOrigin ? origin === pageOrigin : null,
    };
  });
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
export const toRecord = ({
  target,
  capturedAt,
  status,
  finalUrl,
  title,
  manifest,
  browserTools = null,
  frames = [],
  error = null,
}) => {
  const reachable = typeof status === 'number' && status < 400;
  const tools =
    manifest?.tools?.map((tool) => ({
      name: tool.name ?? null,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema ?? null,
      inputSchemaWire: tool.inputSchemaWire ?? null,
      annotations: tool.annotations ?? null,
    })) ?? [];

  const pageOrigin = (() => {
    try {
      return new URL(finalUrl ?? target.url).origin;
    } catch {
      return null;
    }
  })();

  const attributed = reachable ? attributeTools(browserTools, frames, pageOrigin) : null;
  const pageNames = tools.map((t) => t.name);
  const agentNames = attributed ? attributed.map((t) => t.name) : null;

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
      // The agent's own view. `null`, never `[]`, when the browser domain was
      // unavailable — a view you do not have is not evidence of absence.
      agentTools: agentNames,
      agentToolCount: agentNames?.length ?? null,
      attribution: attributed,
      thirdPartyToolCount: attributed ? attributed.filter((t) => t.sameOrigin === false).length : null,
      unattributedToolCount: attributed ? attributed.filter((t) => t.sameOrigin === null).length : null,
      // Divergence in both directions, which is what makes the two views worth
      // keeping separately. `onlyInBrowser` is the delegated-embed case measured
      // on 2026-09-02; `onlyInPage` would mean the browser dropped a tool.
      divergence: agentNames
        ? {
            onlyInBrowser: agentNames.filter((n) => !pageNames.includes(n)),
            onlyInPage: pageNames.filter((n) => !agentNames.includes(n)),
          }
        : null,
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
  // The agent-visible count travels with the page-visible one, because they can
  // differ and the difference is the interesting part. Third-party *origins* stay
  // local: publishing "this project embeds tools from x.example" would put a
  // fourth party's identity into somebody else's row, so only the count and a
  // per-tool boolean go out.
  agentVisibleToolCount: record.webmcp.agentToolCount,
  thirdPartyToolCount: record.webmcp.thirdPartyToolCount,
  viewsDiverge: record.webmcp.divergence
    ? record.webmcp.divergence.onlyInBrowser.length > 0 || record.webmcp.divergence.onlyInPage.length > 0
    : null,
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
 *
 * The agent-side totals are reported separately rather than folded in: they
 * answer "what could an agent call across this cohort", which is a different
 * question from "how many builders shipped tools", and 2026-09-02's measurement
 * showed the two can disagree on a single page.
 */
export const summarize = (records) => {
  const reachable = records.filter((r) => r.liveness.reachable);
  const using = reachable.filter((r) => r.webmcp.registered);
  const toolCounts = using.map((r) => r.webmcp.toolCount).sort((a, b) => a - b);
  const withAgentView = reachable.filter((r) => Array.isArray(r.webmcp.agentTools));

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
    // Agent-side, and null-safe: a cohort captured without the browser domain
    // reports nulls rather than zeroes.
    pagesWithAgentView: withAgentView.length,
    totalAgentVisibleTools: withAgentView.length
      ? withAgentView.reduce((sum, r) => sum + (r.webmcp.agentToolCount ?? 0), 0)
      : null,
    pagesWithThirdPartyTools: withAgentView.length
      ? withAgentView.filter((r) => (r.webmcp.thirdPartyToolCount ?? 0) > 0).length
      : null,
    pagesWhereViewsDiverge: withAgentView.length
      ? withAgentView.filter(
          (r) =>
            (r.webmcp.divergence?.onlyInBrowser.length ?? 0) > 0 ||
            (r.webmcp.divergence?.onlyInPage.length ?? 0) > 0
        ).length
      : null,
    errors: records.filter((r) => r.error).length,
  };
};
