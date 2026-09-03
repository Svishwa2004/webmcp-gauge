# Do agents actually call the tools a page exposes?

**Status: DRAFT — not published.** Every section below is final except [The cohort](#the-cohort-census--not-yet-measured), which is blocked on a capture that can only happen on gallery-publish day (PROJECT-LOG item 12). Publication itself waits on the repository going public at the report launch (item 18). Numbers here are copied from the write-ups that produced them and are linked at each claim; nothing in this file is a fresh calculation.

---

WebMCP lets a page hand an agent a list of tools. Whether the agent then *calls the right one* is a property of the page's own metadata — and until you measure it, a manifest that reads perfectly well to its author is indistinguishable from one that quietly sends every third request to the wrong function.

This is a measurement instrument for that question, plus what it found on **4,200 trials across 13 published runs** and four browser builds.

## What is being measured

**Invocation rate**: given an utterance a specific tool should serve, how often is that tool the one invoked?

The number is only meaningful with its four coordinates attached. Invocation rate is a property of ***(page, client, judge, utterances)***, and every published figure here pins all four: one page, Chrome `152.0.7977.65` with `--headless=new`, judge `glm-5.3` at agentrouter, and the frozen `1.3.0` utterance set. Move any coordinate and the number is a different number. One coordinate has been moved deliberately: the same page, set and judge through Edge `153.0.4234.13` reads 99% (139/140), every tool inside or above its Chrome interval — a point measurement on a second client, with the variance figures remaining Chrome-only.

Three design rules make the rates comparable at all:

- **The utterance set is frozen and was written by a different model than the one being judged.** `1.3.0`: 7 tools × 20 utterances at a plain/paraphrase/oblique mix, plus 20 negative controls. Authored by `deepseek v4`, which is therefore disqualified as a judge for every number here. A set written by the model under test measures self-consistency, not usability.
- **A non-measurement is not an outcome.** A truncated judge, an unreachable provider or a page that never loaded says nothing about the page, so those trials are excluded from every rate and retried by `--resume` rather than counted as failures. The exit codes keep that distinction: `0` complete and above threshold, `1` a rate below `--fail-under`, `2` the run could not measure its own plan.
- **Controls are scored inverted and never pooled.** A control utterance is one no registered tool can serve, so *not* selecting anything is the pass.

Failures are classified rather than lumped: `wrong_tool`, `not_selected`, `exec_error`, `bad_args`, `silent_fail`, `not_discovered`. Which bucket a defect lands in turns out to matter more than the rate it costs.

## The instrument is sound before it is interesting

The reference page — a small expense-analysis app with 7 tools — was measured at **960 trials** (3 sessions × 2 repeats, each session its own process, browser and cold profile): [`airlock-1.3.0-glm-5.3-s3r2.md`](airlock-1.3.0-glm-5.3-s3r2.md).

| | Rate | σ between sessions |
|---|---|---|
| five of seven tools | **100.0%** [96.9%, 100.0%] | 0.000 |
| `filter_rows` | 99.2% [95.4%, 99.9%] | 0.012 |
| `sum_by_category` | 94.2% [88.4%, 97.1%] | 0.012 |
| control false positives | **0.0%** [0.0%, 3.1%] (0/120) | 0.000 |

By phrasing: plain 100.0% (294 trials), paraphrase 100.0% (294), oblique 96.8% (252).

A well-described page sits at the ceiling and stays there across processes. That is the baseline a discriminator needs — and on its own it proves nothing about pages that are *not* well described.

## It discriminates, and the effect is not subtle

One page, one dataset, one implementation, **two manifests**. The clean arm copies the reference page's descriptions verbatim; the degraded arm injects defects that were registered — with their predictions — *before either sweep ran*. Six arms, 3 sessions each, **1,320 trials**: [`ablation-2026-08-31.md`](ablation-2026-08-31.md).

| Arm | Overall | `sum_by_category` | `top_expenses` |
|---|---|---|---|
| clean | **99.3%** (417/420) | 95.0% [86.3, 98.3] | 100.0% |
| degraded (all defects) | **83.1%** (349/420) | **60.0%** [47.4, 71.4] | **26.7%** [17.1, 39.0] |

The intervals do not overlap where the claim is being made. Between-session σ across every arm peaks at **0.094**; the smallest effect claimed is **0.35**.

## The load-bearing finding: defects compound

Each ablation is the clean manifest plus **exactly one** defect family, composed at load time so nothing else can drift.

| `sum_by_category`'s manifest | Rate | Cost against clean's 95.0% |
|---|---|---|
| near-duplicate description alone | 90.0% | −5.0 |
| byte-identical competitor tool alone | 91.7% | −3.3 |
| **both together** | **60.0%** | **−35.0** |

The parts sum to −8.3. Together they cost **four times that**. A vague description survives while nothing else fits the request; an identical competitor survives while the description still says what the tool does. Remove both supports at once and half the trials go elsewhere.

**For anyone triaging a manifest, this is the practical result: you cannot fix findings one at a time and add up the savings.** Two "advisory" warnings worth 3–5 points each were worth 35 together.

`top_expenses` shows the same shape from the other side. An over-parameterised schema — 9 properties, 3 required and undocumented — costs −51.7 points alone (100.0% → 48.3%) and −73.3 inside the degraded manifest. What changes is *where* the failures go: 26 of 31 are `exec_error` when the schema is the only defect, against 23 escapes to another tool when the rest of the manifest is also bad. One defect, three taxonomy buckets, depending on its neighbours.

Two more shapes worth having:

- **A good schema can carry a bad description.** `filter_rows`, whose description shares 86% of its vocabulary with `sum_by_category`'s, held at 98–100%: six documented, typed properties still said what it was for. That is a cheap fix to recommend.
- **One well-described tool becomes a magnet.** The untouched `describe_dataset` collected 30 of the degraded arm's 71 failures, and almost every description-caused misroute in every arm. Fixing one tool's description does not localise the benefit — it relocates where confusion lands.

## A page can be expensive before it is wrong

Mean judge completion tokens per call, same page, same utterances, manifest varied:

| Arm | Mean | Max | Truncated calls |
|---|---|---|---|
| thin descriptions | 122 | 636 | 0 |
| clean | 148 | 1,794 | 0 |
| competitor tool | 208 | 917 | 1 |
| degraded | 364 | 2,977 | 8 |
| near-duplicate | **395** | 2,321 | 0 |
| over-parameterised schema | **1,145** | 2,981 | 7 |

The near-duplicate arm costs **2.7× the clean arm's reasoning** while losing five points of accuracy: the model works harder to reach the same answer. The schema arm costs **7.7×**, and is where truncation concentrates — seven calls that burned the entire 4,096-token budget and returned nothing. Only one of those two costs shows up in an invocation rate.

## Reproducibility, and the caveat that back-to-back runs could not see

Every figure above came from sessions minutes apart, which measures process and browser independence rather than day-to-day drift. One arm was therefore re-measured with its sessions **17.2 h and 9.2 h apart across a 26-hour span**, everything else byte-identical: [`spacing-2026-09-01.md`](spacing-2026-09-01.md), 480 trials.

**σ did not grow with spacing** — worst case 0.085 spaced against 0.062 back-to-back, and the two load-bearing tools swap places. The reproducibility figures stand.

**But the per-session shape is what drift looks like.** Both mid-range tools declined monotonically across the 26 hours (`sum_by_category` 60 → 45 → 40; `top_expenses` 40 → 35 → 30) from a starting point that agreed with the back-to-back arm measured 48 minutes earlier. Three honest limits travel with that reading: n is 20 per session per tool; the late `--resume` refills do not explain it (session 2 reads 44.4% and 37.5% from its at-session trials alone, against 45% and 35% with refills included); and the definitive control — one arm back-to-back and one spread over the *same* window, interleaved — was not run.

**So: a single arm measured at one time is sound; a single arm compared with itself across days inherits the drift question.** Point estimates of mid-range rates moved 8–12 points between 2026-08-30 and 2026-09-01 with all intervals overlapping.

## Where the instrument's own floor is

`sum_by_category-12` — *"I feel like I'm bleeding money somewhere and I can't see where."* — failed **12 of 12 trials across four different manifests**, including the two whose description is the reference one. It is invariant to the thing being varied, so it is not measuring the page: either the expectation is wrong, or it is a genuine tool-set gap. Both belong to the utterance set.

**Nothing was changed to accommodate it.** The set stays frozen, the finding is published, and the cost is carried in every rate above. Some part of every number here is the set's opinion about which tool *should* have been chosen, and this is the first measured case of it.

## What the browser actually does with a manifest

Twenty-two measured behaviours across Chrome `152.0.7977.65`, the ChatGPT desktop app's Chromium at `151.0.7922.174` and `152.0.7977.64`, and Edge `153.0.4234.13`, each cell dated and traceable to a re-runnable probe: [`compatibility-matrix.md`](compatibility-matrix.md).

The ones that change how a page should be written:

- **`registerTool` throws `"Invalid tool name"`** for a name containing a space — it does not silently no-op as reported. The consequence is structural: **a live manifest cannot show you the worst names, because they were never in it.** Linting source is not the same job as linting a live page, and neither is a superset of the other.
- **`getTools()` returns `inputSchema` as a JSON string**, not an object, on all four builds measured. Anything reading `inputSchema.properties` silently gets `undefined`.
- **`getTools()` returns a `Promise`, and registration settles late and in batches** — an early read returned 3 of 7 tools. A reader must wait for the set to stop changing; "non-empty" reports part of a manifest as all of it.
- **The manifest comes back alphabetised**, not in registration order — and manifest order is the order a model reads it in.
- **No per-page tool ceiling was found up to 507 tools**, on three engines. The widely repeated report of ~296 tools silently disabling the feature reproduced on none of them.
- **A same-origin subframe's tools fold into the host's manifest.** An embed can add tools to its host's agent surface.
- **Cross-origin embeds are gated by a Permissions Policy feature named `tools`** — `document.modelContext` exists in the child and every call throws until the framing document sends `allow="tools"`.
- **Once delegated, no script-visible surface returns the union.** The host sees 3 tools, the embed sees its 1, the browser sees all 4 across 2 frames. **A page cannot enumerate what an agent can actually call on it** — and provenance (`frameId`, `backendNodeId`, a stack trace) exists browser-side only. That measurement was contributed to the specification's own design thread on frame scope.
- **At a site boundary, even the browser-side view attached to the host loses the embed.** A cross-site child is site-isolated with its own debugging target; it registers and reads its own tool back through that target, but its registration events never arrive at a client attached to the host page. The union exists only in the child's own target. The gradient, measured: same-origin, everyone sees the embed; cross-origin same-site, only the browser; cross-site, nobody attached to the host. (The measurement needed no real domains — `localhost` and `127.0.0.1` are different sites, proven by the isolation itself.)

The matrix also carries a **Corrections** section, because one of its rows was wrong for two days and the error was ours: a claim that the ChatGPT fork implemented the debugging-protocol domain without advertising it came from a membership test keyed on a field that does not exist in that JSON, which is false for every domain of every build. It is withdrawn there, in public, next to the rows that survived.

## Gate 3 is unanswered, and this report will not pretend otherwise

**Every rate in this report was produced by a judge model reading a manifest, not by a shipping agent driving a browser.** That is the instrument's central limitation and it was not resolved.

The attempt is recorded rather than omitted. The ChatGPT desktop app's *browser* is fully automatable — it exposes the same tool surface and the same invocation path as Chrome. But its *agent* reads pages through a browser-extension bridge into the operator's ordinary browser, which the app states in its own context line, so a tab opened programmatically in the app's browser is invisible to it. Two authorised prompts produced no invocation and no page change, and were classified `unmeasurable` rather than as null results. Instrumenting the correct surface would have meant running a debugging port on a signed-in personal browser; that was declined, and the question closed on the negative.

So the honest claim is narrow: **this measures whether a competent model, given a page's manifest, selects the right tool.** Whether a specific shipping agent does the same on the same page is unmeasured, and the measured reason it is unmeasured is above.

## The linter, and one rule the measurements demoted

Static checks catch what the metric cannot see — including the names that never register. 13 rules in four families (names, descriptions, schemas, budget), calibrated so the live reference page lints **0 errors, 0 warnings** while the degraded twin lints **6 errors, 13 warnings**.

One rule was changed *by* a measurement: `budget/headroom` was an error until 507 registered tools were all accepted, listed and surfaced on two clients. It is a warning now. A linter that fails a build on a threshold nobody has reproduced is a linter people disable.

## The cohort census — not yet measured

**Blocked on PROJECT-LOG item 12**, a one-day capture that can only run when the project gallery publishes. The rules that will govern it are already fixed in code and tests so the capture cannot be shaped after the fact:

- **Adoption means "registered at least one tool"**, never "the API is present".
- **Page-registered and agent-visible counts are reported side by side**, never folded together — the delegated-embed finding above is exactly why they can differ.
- **Aggregate only.** No per-project rankings, no third-party descriptions, no page titles, no markup. Captured manifests stay local; the published artifact carries tool *names*, description *lengths*, schema shape and annotation presence.
- Manners are unconditional: one page at a time, a delay between projects, an identifying user agent, `robots.txt` honoured, and a refusal rather than a guess if the page shape is not what the harness expects.

## Reproducing any of this

Every number above came from a command in this repository, and the raw per-trial records stay local by design — so these are reproducible by **re-running the harness**, not by re-analysing our rows.

```
webmcp-gauge lint <url>                      # the static rules
webmcp-gauge run --sessions 3 --repeats 2    # a full sweep with intervals and σ
node probes/webmcp-domain.mjs 0,507          # the budget result, and both views of the manifest
node probes/frame-scope.mjs                  # the three frame results, including the invisible union
node probes/site-scope.mjs                   # the cross-site rows: the union exists only in the child's target
node probes/remote-visibility.mjs            # (housekeeping) is this repo still private
```

The utterance set, the fixture page, every injected defect and the prediction it was written to test are all committed. **210 tests** cover the rules that decide published numbers — the taxonomy, the intervals, the exit codes, the capture and publication filters — on the principle that anything load-bearing for a number gets tests and anything exploratory stays a probe.

## Licence and data

Code and these derived tables: MIT. Per-trial records: local, unpublished, and deferred *with* their licence — if they are ever released, that release names its own terms.

---

*Draft assembled 2026-09-03. Sections other than the cohort census are complete and their numbers are final; the cohort section is a placeholder with its rules fixed in advance, which is the only order that keeps it honest.*
