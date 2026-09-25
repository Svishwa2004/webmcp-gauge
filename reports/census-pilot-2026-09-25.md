# Pilot cohort census — first 523 listed (461 usable), 2026-09-25

**The question:** what does WebMCP adoption actually look like across a live cohort of pages this project does not control — and what can an agent call on them that no page surface lists?

**The labels that travel with every number below:** these are the **first 523 submissions listed** in Devpost gallery order (461 with a usable demo link) — a **convenience sample, not a random one**, recency- and curation-biased by how the gallery paginates. This is the **pilot, not the census**: the milestone-4 corpus claim waits on the full 2,474-target walk, which was resumed the same day. Nothing here should be quoted as "n=461 sampled".

## Provenance

- Captured 2026-09-25, 12:03–13:56 local (83 min), one headless Chrome/154.0.8037.57, one page at a time, 2 s between projects, the harness UA on every request, robots.txt honoured (9 paths refused and were recorded as refused).
- The agent view was read at the **browser endpoint** with recursive auto-attach — the item-23 fix, rehearsed that morning against the `spec-227` delegating fixture before this run launched. A host-attached watch, which this runner used until the day before the capture, cannot hear a cross-site embed's registrations; the third-party numbers below are measurements that capture would have structurally missed.
- Attribution follows the 2026-09-02 decision: `usingWebmcp` counts what the page itself registered; the agent-side totals count what an agent can call, including embeds. Per §12, this write-up publishes tool *names* and structural facts only — third-party origins, descriptions and anything quotable from other projects stay in the local snapshot.
- Reconciled: all 13 summary fields re-derived from the 461 records and matched.

## The census

| | |
|---|---|
| Targets / reachable | 461 / **428** (33 not: dead hosts, robots refusals, capture failures — 17 error records total) |
| **Using WebMCP** (page registered ≥1 tool) | **346 of 428 reachable = 80.8%** [76.8, 84.3] (Wilson 95%, n=428) |
| Reachable without tools | 82 |
| Tools registered (page view) | 3,436 total · median 7 · max 50 |
| Pages with an agent view | 426 (2 reachable pages null — navigation timed out mid-capture) |
| Agent-visible tools (browser union) | 5,126 |

Even at pilot size the adoption number is high: four of five reachable pages register tools, and the median page ships seven.

## The item-23 payoff: what an agent can call that no page lists

**319 of 426 agent-view pages (74.9%) carry cross-origin delegated tools** — tools that reach the browser and therefore an agent while appearing in nobody's `getTools()`. The shape of it is the finding: this is not bespoke per-site work, it is **two shared hosted suites**.

- All 319 divergent pages embed the same three-tool auth suite (`auth-get-current-user`, `auth-login`, `auth-signup`); 169 of them embed *exactly* that suite and nothing third-party besides it.
- 150 pages additionally embed a five-tool site-agent suite (`ariag-frontpage`, `ariag-login`, `ariag-navigate`, `ariag-search`, `ariag-summarise`) — every one of those 150 also carries the auth suite.
- Both suites come from two distinct third-party origins (kept local per the §12 fourth-party rule; recorded per-tool in the snapshot's attribution).
- 107 of 426 pages have purely first-party agent-visible tools. Two captured projects registered **zero** tools themselves and ship entirely through an embed.
- 14 pages had live out-of-process iframe sessions during capture — the registration path that motivated the fix, observed in the wild.

The implication runs both ways. For the census: a capture without the browser-endpoint view would have undercounted `agentVisibleToolCount` on ~75% of these pages — in exactly the direction, and on exactly the pages, where the browser's answer differs from the page's. For builders: the dominant way tools become agent-visible on someone else's page is now embedding a hosted widget suite, not registering your own.

## Known residuals, recorded rather than smoothed

- **One mirror-image undercount.** One page (MCPx) reports 21 registered tools whose registrations never arrived at the browser union (the union caught only its embedded suite; 9 OOPIF frames attached). The likely mechanism is the known one: registrations that fire before a session's `WebMCP.enable` lands do not replay. 1 of 426 pages (0.2%); the divergence fields and `browserView` metadata in the record expose it. A union that can miss a page's own tools means agent-side totals are best read as a floor, and the full census should carry this page's record as the worked example.
- 2 reachable pages have null agent views (navigation timeout before the watch saw anything) — nulls, not zeroes.
- Dead/robots/error records are data points, not exclusions: 33 unreached, 9 robots refusals, 5 navigation timeouts, 3 capture errors.
- The convenience-sample label: gallery pages 1–~22 in Devpost order. The full walk (all 104 pages, 2,474 submissions) was resumed from its checkpoints the same afternoon.

## The linter meets manifests nobody here wrote (item 22's measurement)

The shipped linter (all 14 rules, unchanged thresholds) ran against all 346 captured manifests — the first corpus this project did not write. `probes/lint-cohort.mjs`, output in `artifacts/lint-cohort-2026-09-25/`.

| Rule | Manifests affected | Firings |
|---|---|---|
| `schema/required-without-description` (E) | 166 of 346 | 1,448 |
| `schema/undocumented-property` (W) | 129 | 1,422 |
| `schema/over-parameterised` (W) | 109 | 230 |
| `description/thin` (W) | 71 | 202 |
| `schema/missing-type` (W) | 41 | 131 |
| `description/near-duplicate` (W) | 21 | 31 |
| `schema/not-object` (E) | 17 | 65 |
| **`description/indistinguishable-pair` (W)** | **13 of 346 (3.8%)** | **20** |
| `name/invalid-characters` (E) | 9 | 61 |
| `description/duplicate` (E) | 3 | 17 |
| all other rules | 0 | 0 |

Entirely clean manifests: **106 of 346** (30.6%). The schema rules, not the description rules, are what real-world manifests trip over — a finding the home-grown corpus could never have produced, since every fixture here was written to be lintable.

**The fourteenth rule's false-positive question.** It fired on 13 of 346 manifests — 20 distinct pairs. Reading them:

- **One textbook true positive:** one project ships three tools whose descriptions are byte-identical and whose names differ only by a team prefix (`alpha.` / `bravo.` / `charlie.` + the same verb-object). Nothing distinguishes them but the prefix — exactly the shape the rule was built for, found in the wild on day one.
- **The rest are prefix-heavy namespaces:** pairs sharing a long common prefix (`music_get_catalog` beside `music_get_agent_brief`, and kin) whose descriptions genuinely differentiate the tools semantically but never echo their own name's tokens, so the rule fires. Whether a model would actually confuse these is the description-versus-**request** question the ladder proved a static linter cannot see — these are the rule catching the naming pattern, not necessarily a real confusion.

So the honest summary for the promotion decision: **3.8% of real manifests, one clear hit, twelve plausible-noise-or-borderline** — against 100% of firings being on-purpose in the home-grown corpus. Promotion to error would have made a third of the cohort's worst manifests fail a build on mostly prefix noise; keeping it a warning is the reading this measurement supports, and the decision stays the maintainer's.

## What this unblocks

The full 2,474-target walk resumed from its checkpoints the same afternoon; when it lands, this document's structure (census, divergence, residuals, linter rates) is the skeleton the milestone-4 corpus claim and item 17's cohort sections need — re-run, not re-written, with the convenience-sample label retired only if the final numbers are drawn from the complete listing rather than its first slice.
