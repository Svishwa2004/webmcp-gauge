# Do agents call the tools a page exposes?

**What was measured, in one sentence:** whether a language model, handed a page's live tool list, picks the right tool and calls it with valid arguments — measured 4,200 times. **What was not measured: any shipping agent product.** No commercial agent invoked anything in this report; [the limit section](#the-limit-no-shipping-agent-was-measured) says why, and it is the first thing to read before citing a number from here.

**Status: DRAFT — not published.** Two things are outstanding: the cohort census has not been captured — it can only be captured on the day a gallery of WebMCP pages goes public — and publication waits on this repository being made public. Every other section is final. Numbers are carried from the run write-ups linked at each claim.

**Author and conflict of interest.** webmcp-gauge is written by **[@Svishwa2004](https://github.com/Svishwa2004)**, who also entered the event whose submissions the cohort census will measure — so the author is inside the population being counted. Consequences, fixed in advance: no per-project detail is published while judging runs, any per-project scorecard goes to that builder before it goes anywhere else, the published census is aggregate, and the author's own entry is captured and counted by exactly the rules below, with no exemption and no special case in the code. State this next to any number taken from here.

---

WebMCP lets a page hand an agent a list of tools. Whether the agent then *calls the right one* is a property of the page's own metadata — and until you measure it, a tool list that reads perfectly well to its author is indistinguishable from one that routes requests to the wrong function.

**Manifest**, throughout: the live set of tools a page has registered, with the name, description, and JSON-Schema-shaped `inputSchema` of each, as a client reads them back. Not a file — a runtime object.

**webmcp-gauge** is the instrument for that question. So far it has produced **4,500 measured trials across 16 published runs**, on two browser builds (4,340 on Chrome `152.0.7977.65`, 160 on Edge `153.0.4234.13`) and two pages — a live 7-tool reference app, and a local fixture twin built to be measurably worse. Separately, **22 API behaviours** are measured across four builds. Six runs are analysed below; **all sixteen are indexed, with their trial counts and what supersedes what, in [`reports/README.md`](README.md)**, and each has a machine record beside its write-up. Run files are named `<page>-<utterance set>-<judge>-<shape>`, where `s3r2` means three sessions of two repeats — so `airlock-1.3.0-glm-5.3-s3r2` is the reference app, frozen set `1.3.0`, judge `glm-5.3`, three sessions × two repeats.

**Is WebMCP worth your attention yet?** Honestly: it is early, and this report is about method rather than momentum. As of this measurement the API is behind a flag or an origin trial in Chromium — no ship milestone — Edge's trial has an expiry, WebKit's published standards position is opposition and Mozilla's is neutral, and an independent scan of 111,076 of the top 200,000 sites in mid-2026 found **zero** implementations. The reason to measure now is that the failure mode this report is about — a page whose tools are never called, silently — is the one thing that does not get cheaper to discover later.

### What follows

The instrument first (is it sound, does it discriminate), then the findings (defects compound, tokens, drift, the instrument's own floor), then what the browser does that changes how you write a page, then the limit, the linter, and the census that has not run.

## What is being measured

**Invocation rate**: given an utterance a specific tool should serve, how often is that tool the one invoked?

**How a trial runs, exactly.** The harness loads the page in a flagged browser, reads back the manifest, and hands the manifest plus one utterance to a **judge model** — a language model standing in for the agent, because no shipping agent could be instrumented (see [the limit](#the-limit-no-shipping-agent-was-measured)). The judge picks a tool and arguments; **the harness then executes that call against the real page** and inspects the result and the page. So "invocation" here means *selected by a model and executed by the harness* — which is why `exec_error` is a real outcome even though no agent product is involved. One utterance, one trial. A **repeat** is one pass over the whole utterance set; a **session** is a repeat set run in its own process, its own browser and its own cold profile; an **arm** is one manifest variant measured that way.

Every rate is reported with a **95% Wilson score interval** — written `[low, high]` throughout — never as a bare percentage.

The number is only meaningful with its four coordinates attached. Invocation rate is a property of ***(page, client, judge, utterances)***, and every published figure pins all four. Chrome `152.0.7977.65` with `--headless=new`, judge `glm-5.3` (a general-purpose model, served by agentrouter, unrelated to the one that wrote the utterances), and the frozen `1.3.0` utterance set are held fixed; the page is either the live reference app or the twin fixture, and which one is always named. Move any coordinate and the number is a different number. One coordinate has been moved deliberately: the same page, set and judge through **Edge `153.0.4234.13`** reads 99.3% (139/140), every tool inside or above its Chrome interval — a single-session point measurement, so the variance figures below stay Chrome-only.

Three design rules make the rates comparable at all:

- **The utterance set is frozen and was written by a different model than the one being judged.** `1.3.0`: 7 tools × 20 utterances, plus 20 negative controls. Each tool's 20 are 7 **plain** (says what it wants in the tool's own vocabulary), 7 **paraphrase** (same request, different words), and 6 **oblique** (states a goal and leaves the tool implicit) — the same mix for every tool, or per-tool rates would not be comparable. Authored by `deepseek v4`, which is therefore disqualified as a judge for every number here: a set written by the model under test measures self-consistency, not usability.
- **A non-measurement is not an outcome.** A judge whose answer was cut off, an unreachable provider or a page that never loaded says nothing about the page, so those trials are excluded from every rate and retried by `--resume` rather than counted as failures. The exit codes keep that distinction: `0` complete and above threshold, `1` a measured rate below `--fail-under`, `2` **the run has holes** — trials it planned and never measured, or arguments it would not accept. A run with holes cannot certify a regression, so incomplete outranks a breach.
- **Controls are scored inverted and never pooled.** A control utterance is one no registered tool can serve, so *not* selecting anything is the pass.

Outcomes are classified rather than lumped. Nine buckets, exactly one per trial: `ok`, and eight ways to fail — `not_supported` (no WebMCP in this client), `not_registered` (the page registered nothing, or not this tool), `not_discovered` (the page lists it, the browser does not), `not_selected`, `wrong_tool`, `bad_args`, `exec_error`, `silent_fail`. The bucket is what tells a developer *where* to look, and the same defect lands in different buckets depending on the rest of the manifest — shown below.

## The instrument is sound before it is interesting

The reference page — a small expense-analysis app with 7 tools, live on the public web — was measured at **960 trials**: 3 sessions × 2 repeats × (7 tools × 20 utterances + 20 controls). Report: [`airlock-1.3.0-glm-5.3-s3r2.md`](airlock-1.3.0-glm-5.3-s3r2.md).

| Tool | Rate (n = 120 each) | σ between sessions |
|---|---|---|
| five of seven tools | **100.0%** [96.9%, 100.0%] | 0.000 |
| `filter_rows` | 99.2% [95.4%, 99.9%] | 0.012 |
| `sum_by_category` | 94.2% [88.4%, 97.1%] | 0.012 |
| control false positives | **0.0%** [0.0%, 3.1%] (0/120) | 0.000 |

Every row is one tool's own rate over its own 120 trials, not a pooled figure. **σ between sessions** is the population standard deviation of the three per-session rates; within-session σ is computed separately from repeats inside one browser, and is reported separately because pooling the two hides which kind of instability you have.

By phrasing: plain 100.0% (294 trials), paraphrase 100.0% (294), oblique 96.8% (252). The gradient is the point of the tag mix — the further an utterance sits from the tool's own vocabulary, the more the description has to carry.

A well-described page sits at the ceiling and stays there across processes. That is the baseline a discriminator needs — and on its own it proves nothing about pages that are *not* well described.

## It discriminates, and the effect is not subtle

One page, one dataset, one implementation, **two manifests**. The clean arm carries the reference page's own descriptions minus their privacy sentences — close correspondence rather than identity, and the sentence to keep in mind before reading the clean arm as a copy of the live page. The degraded arm injects defects that were registered, with their predictions, *before any of these sweeps ran* — a pre-registration claim, and the kind that is worth only as much as its timestamp: the defect register and every prediction are committed files, so the ordering is checkable in this repository's history rather than on trust, once the repository is public. Six arms, 3 sessions each, **1,320 trials**: [`ablation-2026-08-31.md`](ablation-2026-08-31.md).

| Arm | Overall | `sum_by_category` | `top_expenses` |
|---|---|---|---|
| clean | **99.3%** (417/420) | 95.0% [86.3, 98.3] | 100.0% |
| degraded (all defects) | **83.1%** (349/420) | **60.0%** [47.4, 71.4] | **26.7%** [17.1, 39.0] |

Where the 1,320 goes, because the denominators differ by arm: the clean and degraded arms each run the whole set over 3 sessions — 420 tool trials plus 60 controls, 480 each. The four single-defect arms below measure only the tools whose manifest they change (120, 60, 120 and 60), because measuring untouched tools a fifth time buys nothing. Overall percentages are over tool trials; controls are counted and reported separately, never pooled in.

The intervals do not overlap where the headline claim is made: clean 99.3% against degraded 83.1%, and 95.0% against 60.0% on the tool that carries the defects. Between-session σ across every arm peaks at **0.094** (`top_expenses`, schema arm), against effects of **0.35** and larger.

**And the honest converse, which turns out to be the finding rather than a caveat: both of the single-defect costs in the next section are smaller than that σ.** Measured on the same entries as the combination, one defect costs −1.7 points and the other costs 0.0 — both inside the between-session spread, so neither is established as a nonzero effect at all at 3 sessions × 20 utterances. Their combination is outside it by a margin of **0.467**, five times the worst σ measured. The claim is the combination; the parts are, as far as this instrument can see, nothing.

## The load-bearing finding: two harmless defects are not harmless together

Four manifests, one tool, and — for once — every one of them a strict subset of the next, composed at load time from the same entries so nothing else can drift:

| `sum_by_category`'s manifest | Rate | Cost against clean's 95.0% |
|---|---|---|
| its description degraded, no competitor | 93.3% [84.1, 97.4] | **−1.7** |
| a vaguely-described competitor added, description intact | 95.0% [86.3, 98.3] | **0.0** |
| **both** | **48.3%** [36.2, 60.7] | **−46.7** |
| the whole degraded manifest, for reference | 60.0% [47.4, 71.4] | −35.0 |

**Neither defect costs anything on its own. Together they cost 46.7 points.** The parts sum to −1.7. This is not "defects add up faster than you expect" — it is *neither defect is a defect until the other one is there*, which is a different and more awkward thing to act on. Details and per-failure breakdowns: [`pair-2026-09-05.md`](pair-2026-09-05.md), [`decomposition-2026-09-05.md`](decomposition-2026-09-05.md).

**The two "harmless" arms are harmless in the strict sense.** The competitor arm is indistinguishable from the clean arm failure for failure: 57 of 60, σ between sessions 0.000, and all three misses are `sum_by_category-12`, the one utterance this report already publishes as failing on every manifest. The descriptions arm loses exactly one further trial in 60. Plain and paraphrase utterances were perfect in both; every real loss sat in the oblique tail.

**Why the pair is different.** Alone, a vague description still leaves the tool the best available match, because nothing else on the page claims to total by category. Alone, a vague competitor loses to the well-described original. Put both together and the model faces two tools whose descriptions are byte-identical — and then it decides on the **name**. The judge's own recorded reasoning: *"`summarise_by_category` seems designed for summarizing by category (its name suggests it summarizes across categories)"*. The name it preferred belonged to the wrong tool, and 24 of the 31 failures followed it there, spread across 11 different utterances. A tool name is documentation whether or not it was written as any.

**For anyone triaging a manifest, this is the practical result: you cannot fix findings one at a time and add up the savings, and you cannot dismiss them one at a time either.** Bounds, stated rather than left for a reader to notice: one tool pair, one page, one judge, three sessions, n = 20 per session. It demonstrates that a large pure interaction exists and reproduces; it does not measure how often that happens in the wild.

**How this table got here is worth one paragraph, because the first version of it was wrong.** Until 2026-09-05 the "both" row was the *whole degraded manifest* — every other tool defective too — so it bundled the pair's interaction with whatever the rest of the page contributed. Correcting that exposed something worse: the two single-defect rows it had been read against were **not subsets** of it either. The published "competitor alone" arm gives the competitor the tool's *good* description, so the two tools shared a good one; the degraded manifest gives it the *vague* description, so they shared a bad one; and the degraded manifest additionally thinned an argument description that no ablation touched. Three manifests, none nested inside another, with differences taken between them. The project's own linter is what caught it, by refusing to fire `description/duplicate` on a composition that should have carried it. All four rows above are now measured on the same tool entries, and a test asserts it.


`top_expenses` shows the same shape from the other side. An over-parameterised schema — 9 properties, 3 required and undocumented — costs −51.7 points alone (100.0% → 48.3%) and −73.3 inside the degraded manifest. What changes is *where* the failures go. Schema alone, of 31 failures: **26 `exec_error`**, 3 `not_selected`, 2 `wrong_tool` — the model reaches for the right tool and cannot fill the form. In the degraded manifest, of 44: **23 `wrong_tool`**, 18 `exec_error`, 3 `not_selected` — the same tool, the same defect, and now the model mostly goes somewhere else instead. One defect, three buckets, and the mix is set by its neighbours.

Two more shapes worth having:

- **A schema helps, but it does not immunise.** `filter_rows` has six documented, typed properties and a description sharing 86% of its tokens with `sum_by_category`'s by the linter's own similarity measure — the thing `description/near-duplicate` fires on. In the *degraded* manifest it held **98.3%** while `sum_by_category` collapsed to 60.0%, which is the contrast worth having. But in the near-duplicate arm — the arm that actually degrades its description — it read **95.0%** [86.3, 98.3], down 5.0 points from clean, the same drop `sum_by_category` took. A good schema bought it the degraded-manifest case and not that one.
- **One well-described tool becomes a magnet.** The untouched `describe_dataset` collected 30 of the degraded arm's 71 failures, and almost every description-caused misroute in every arm. Fixing one tool's description does not localise the benefit — it relocates where confusion lands.

**One defect family cost nothing at all, against a prediction written before the run.** Two tools had their descriptions replaced with uninformative ones — `find_anomalies` became *"Processes the table and gives numbers back."*, `clear_highlights` became *"Utility."* The registered prediction was split: `find_anomalies` should drop, because it competes with `describe_dataset` for "what stands out", while `clear_highlights` should hold, because nothing else clears a highlight. Result: **both at 100.0%** (120/120). The half that predicted a drop was falsified, and the rule that flags thin descriptions is therefore a rule about *competition*, not about description length — which is the strongest single argument here for measuring a manifest as a system rather than rule by rule.

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

The near-duplicate arm costs **2.7× the clean arm's reasoning** while losing five points of accuracy: the model works harder to reach the same answer. The schema arm costs **7.7×**, and is where truncation concentrates — seven calls that hit the judge's entire 4,096-token ceiling and returned nothing usable.

Two things to read the table with. The **Mean and Max columns cover only measured calls**, so the truncated ones — which by definition spent the whole 4,096 — are counted in the last column and nowhere else; that is why no Max reaches 4,096. And the arms do not have equal numbers of trials (120, 480, 60, 480, 120 and 60, in table order), nor the same tools, so these are per-arm means over each arm's own tools rather than a like-for-like ranking. Only one of the two costs — accuracy and tokens — shows up in an invocation rate at all.

## Reproducibility, and the caveat that back-to-back runs could not see

Every figure above came from sessions minutes apart, which measures process and browser independence rather than day-to-day drift. **The degraded twin arm** was therefore re-measured with its sessions **17.2 h and 9.2 h apart across a 26-hour span**, everything else byte-identical: [`spacing-2026-09-01.md`](spacing-2026-09-01.md), 480 trials.

**σ did not grow with spacing** — worst case 0.085 spaced against 0.062 back-to-back, and the two mid-range tools swap places (`sum_by_category` is the worse one spaced, `top_expenses` the worse one back-to-back). The reproducibility figures stand.

**But the per-session shape is what drift looks like.** Both mid-range tools declined monotonically across the 26 hours (`sum_by_category` 60 → 45 → 40; `top_expenses` 40 → 35 → 30), where the back-to-back sessions wandered around their mean instead (60 → 55 → 65 and 35 → 20 → 25). The spaced arm starts where the back-to-back arm sat 48 minutes earlier on `sum_by_category` — 60 in both — and four points above it on `top_expenses`. Three honest limits travel with that reading: n is 20 per session per tool, so a three-session monotone ordering is a 1-in-6 event under a stable mean and both tools showing it is 1-in-36 — a description, not a p-value; the late `--resume` refills do not explain it (session 2 reads 44.4% and 37.5% from its at-session trials alone, against 45% and 35% with refills included); and the definitive control — one arm back-to-back and one spread over the *same* window, interleaved — was not run.

**So: a single arm measured at one time is sound; a single arm compared with itself across days inherits the drift question.** Across the two days, mid-range point estimates moved 8–12 points with all intervals overlapping — and they moved in **opposite directions**: comparing the back-to-back arm (finished 2026-08-30 UTC, published in [`ablation-2026-08-31.md`](ablation-2026-08-31.md)) with the spaced arm a day later, `sum_by_category` fell 60.0 → 48.3 while `top_expenses` rose 26.7 → 35.0. Whatever moved is not a single trend with a sign.

## Where the instrument's own floor is

`sum_by_category-12` — *"I feel like I'm bleeding money somewhere and I can't see where."* — fails almost everywhere. A 2,080-trial audit of the whole set over the four reference-quality manifests found 15 misses in total, and **12 of them are this one line**: it failed **12 of 13** attempts on reference-quality manifests, including the ones whose description is the reference text, and **14 of 14** on degraded ones. The judge answers it with `describe_dataset` or `find_anomalies` — a defensible reading of a request that never names a category to sum. Because it misses whatever the page says and whatever the clock says, it is not measuring the page: either the expected tool is wrong, or the tool set genuinely has no answer for that request. Both possibilities are properties of the utterance set, not of the page under test.

**Nothing was changed to accommodate it**, and the decision is recorded in the set itself with its cost: keep the line, no version bump, because rewording it would split `1.3.0` from `1.4.0` and forfeit comparability across every rate already published for the sake of one utterance. The cost is quantified rather than waved at: on a reference-quality manifest, **all three** of `sum_by_category`'s misses in the 480-trial clean arm are this utterance, so its observed 95.0% (57/60) is 19 of 20 utterances passing with one that always fails. Read any future rate for that tool as *"out of 19 that can pass, plus one that cannot"*, and subtract it before comparing the tool against one sitting at 100%.

## What the browser actually does with a manifest

Twenty-two measured behaviours across four builds — Chrome `152.0.7977.65`, the ChatGPT desktop app's own Chromium at `151.0.7922.174` and then at `152.0.7977.64` (the app updated mid-project with nothing announcing it, so both are kept as separate columns; and yes, `…64` against Chrome's `…65` is one build apart rather than a typo), and Edge `153.0.4234.13`. Each cell is dated and traceable to a re-runnable probe: [`compatibility-matrix.md`](compatibility-matrix.md). All four are Blink builds; nothing here says anything about a non-Chromium engine, and WebKit's published standards position on the feature was opposition (2026-06-11).

The ones that change how a page should be written:

- **`registerTool` throws `"Invalid tool name"`** for a name containing a space — it does not silently no-op, as [webmcp#145](https://github.com/webmachinelearning/webmcp/issues/145) describes. The consequence is structural: **a live manifest cannot show you the worst names, because they were never in it.** Linting source is not the same job as linting a live page, and neither is a superset of the other.
- **`getTools()` returns `inputSchema` as a JSON string**, not an object, on all four builds measured. Anything reading `inputSchema.properties` silently gets `undefined`.
- **`getTools()` returns a `Promise`, and registration settles late and in batches** — an early read returned 3 of 7 tools. A reader must wait for the set to stop changing; "non-empty" reports part of a manifest as all of it.
- **The manifest comes back alphabetised**, not in registration order — and manifest order is the order a model reads it in.
- **No per-page tool ceiling was found up to 507 tools**, on all three builds tried (Chrome, Edge, and the app's Chromium — all Blink): 507 attempted, 507 registered, 507 listed, 0 rejected, settling inside 1.1 s. The widely repeated field report that ~296 registered tools silently disable the feature for a whole page (sourced in `docs/concept.md`, Appendix A) reproduced on none of them. Brave is not measured.
- **A same-origin subframe's tools fold into the host's manifest.** An embed can add tools to its host's agent surface without the host listing them itself.
- **Cross-origin embeds are gated by a Permissions Policy feature named `tools`** — `document.modelContext` exists in the child and every call throws *"Access to the feature `tools` is disallowed by permissions policy"* until the framing document sends `allow="tools"`.
- **Once delegated, no script-visible surface returns the union.** Measured on a purpose-built fixture: a host page registering 3 tools, embedding one page that registers 1. The host's `getTools()` returns 3, the embed's returns its 1, and the browser — watched over Chrome's DevTools Protocol, which streams `toolsAdded` events — reports all 4 across 2 frames. **A page cannot enumerate what an agent can actually call on it**, and provenance (`frameId`, `backendNodeId`, a stack trace) exists only on the protocol side, never in `getTools()`. That measurement was contributed to the specification's own design thread on frame scope: [webmcp#227](https://github.com/webmachinelearning/webmcp/issues/227#issuecomment-5499217166), extended [here](https://github.com/webmachinelearning/webmcp/issues/227#issuecomment-5499568493).
- **At a site boundary, even the browser-side view attached to the host loses the embed.** *Cross-origin* means a different origin; *cross-site* means a different site, the coarser boundary Chrome uses to decide process isolation — and a cross-site child is handed a protocol target of its own. It registers and reads its own tool back through that target, but its registration events never arrive at a client attached to the host page. The gradient, measured end to end: same-origin, everyone sees the embed; cross-origin same-site, only the browser does; cross-site, nobody attached to the host does. (This needed no real domains: `localhost` and `127.0.0.1` are already different sites in Chrome 152, which the isolation itself demonstrates — the cross-site child gets its own out-of-process target while a merely different-port child does not.)

The matrix also carries a **Corrections** section, because one of its rows was wrong for two days and the error was ours. The withdrawn claim was that the ChatGPT app's Chromium implemented the WebMCP DevTools-Protocol domain without advertising it in the protocol listing. The cause was our own probe: it tested each listed entry's `name` field, where that JSON names the field `domain` — a test that returns false for every domain of every build, so it could only ever have produced that answer. The domain is advertised, on that build as on Chrome. It is withdrawn in public, next to the rows that survived.

## The limit: no shipping agent was measured

**Every rate in this report was produced by a judge model reading a manifest, not by a shipping agent product driving a browser.** That is the instrument's central limitation. The project set itself three gates before starting — does a current browser expose WebMCP at all, is the metric reproducible, and does this cheap harness predict what a real agent does — and it is the third that is **unanswered, not passed**.

The attempt is recorded rather than omitted. The ChatGPT desktop app's *browser* is fully automatable: it is drivable over the DevTools Protocol with one Blink feature flag, reads a page's 7 tools back, and executes them through the same protocol path with the same payloads as Chrome — all of it in the [compatibility matrix](compatibility-matrix.md) as dated rows on two of its builds. Its *agent* is the part that could not be reached. The agent reads pages through a browser-extension bridge into the operator's own everyday browser — the app says so itself, in the context it prints for its model (*"Chrome tabs: The user has the Chrome extension side panel open. Current URL: …"*) — so a tab this harness opens inside the app's browser is invisible to it.

Two prompts were sent to the signed-in agent, and what happened to them matters more than the count. The first came back a clean "not invoked", and that reading was **deleted**: an Enter key that fails to submit looks exactly like an agent declining, so a null result whose cause is unknown is not evidence. Two checks were added — was the utterance actually delivered into a chat, and does the app report a Chrome-tabs context — and only then was the second run recorded, as `unmeasurable`, with the bridge quoted in the record. One machine record exists, and it says *could not measure*, not *did not invoke*.

Instrumenting the correct surface would have meant running a debugging port on the maintainer's signed-in personal browser. **The maintainer declined**, and the question closed on the negative rather than on a compromise nobody would want repeated.

So the honest claim is narrow: **this measures whether one judge model — `glm-5.3` — given a page's manifest, selects the right tool and calls it correctly.** Whether any particular shipping agent does the same on the same page is unmeasured, and the measured reason it is unmeasured is above. One thing a future attempt starts from: whether the protocol's `toolInvoked` event fires for an agent's own invocation is still unknown.

## The linter, and one rule the measurements demoted

Static checks catch what the metric cannot see — including the names that never register. 13 rules in four families (names, descriptions, schemas, budget), with thresholds set so that the live reference page lints **0 errors, 0 warnings** while the degraded twin's live manifest lints **6 errors, 13 warnings**.

Two honest notes on those two numbers. The 0/0 is a **calibration choice, not a discovery** — the thresholds were tuned until a page this project already considered well-written came out clean, so the number carrying information is the twin's, not the reference page's. And the twin has *two* lint results: its **declared source** trips more errors than its **live manifest** does, because the browser refuses the worst names before any live reader can see them. That gap is the section's own point restated — `--manifest` lints what a page's source declares, live mode lints what the browser hands back, and neither contains the other.

One rule was changed *by* a measurement: `budget/headroom` was an error until 507 registered tools were all accepted, listed and surfaced. When it was demoted (2026-08-31) that result stood on Chrome alone; it now stands on three builds. It is a warning today. A linter that fails a build on a threshold nobody has reproduced is a linter people disable.

**And one severity pair was vindicated by a measurement, which was not the expected outcome.** `description/near-duplicate` is graded a *warning* and `description/duplicate` an *error*, assigned from judgement on 2026-08-30. The decomposition above is the first test of that grading: the manifest that trips only the warning costs **−1.7** points, and the manifest that trips the error costs **−46.7**. The rule that fires only when two tools genuinely share one description is the one graded as a build-breaker, and it earns it. The same measurement also closed a suspected gap in the other direction: a page that adds a vaguely-described competitor beside a well-described tool trips **nothing** in the description family — and costs nothing, so the silence is correct rather than a hole.

## The cohort census — not yet measured

The one number nobody has published for WebMCP is how many pages in the wild actually register a tool. This report will carry it for one cohort: the submissions to the WebMCP Challenge, a hackathon whose project gallery becomes public at the end of judging. **It has not been captured.** As of **2026-09-05** the gallery is still unpublished; the host's own schedule closed submissions on 2026-09-04, runs judging to 2026-09-22 and announces winners on 2026-09-24, so the capture waits on that. It is a one-day measurement by nature — free hosting tiers outlive a hackathon by months, not years — which is why the rules below were fixed in code, with tests, before the data existed:

- **Adoption means "registered at least one tool"**, never "the API is present". A page where `document.modelContext` exists and no tool is registered counts as not adopted.
- **Page-registered and agent-visible counts are reported side by side**, never folded together — the delegated-embed finding above is exactly why they can differ, and a third party's tools are never credited to the page that framed them.
- **Published output is aggregate; the per-project record is not published.** The census, the distribution of lint findings and the counts are what go out. The captured manifests stay local. The intermediate per-project rows that the aggregate is computed from carry tool *names*, description *lengths*, schema shape and annotation presence — never a description, never a page title, never markup — and no ranking is published at all.
- **Any per-project detail goes to that project's builder first**, and nothing identifying anyone is published while judging is running.
- Manners are unconditional: one page at a time, a delay between projects, an identifying user agent, `robots.txt` honoured, and a refusal rather than a guess if the page shape is not what the harness expects.

## Reproducing any of this

Every number above came from a command in this repository. The raw per-trial records stay local by design, so these numbers are reproducible by **re-running the harness**, not by re-analysing our rows — and the drift section above is the honest caveat on that: a re-run of a mid-range arm on another day should be expected to land within an interval, not on the same point estimate. Ceiling and floor results reproduce exactly; mid-range ones reproduce as intervals.

```
webmcp-gauge lint --url <url>                     # the static rules; no judge, no key
webmcp-gauge run --url <url> --sessions 3 --repeats 2   # a full sweep with intervals and σ
node probes/webmcp-domain.mjs 0,507               # the budget result, and both views of the manifest
node probes/frame-scope.mjs                       # the three frame results, including the invisible union
node probes/site-scope.mjs                        # the cross-site rows: the union exists only in the child's target
```

`lint` needs nothing but Node and a URL. `run` needs three things: a Chromium build with WebMCP enabled (the harness launches its own cold-profile Chrome per session, so this is a flag, not a setup), a judge endpoint and model, and an API key for it — `WEBMCP_GAUGE_JUDGE_BASE_URL`, `WEBMCP_GAUGE_JUDGE_MODEL`, `WEBMCP_GAUGE_JUDGE_API_KEY`, documented in `.env.example`. Nothing loads `.env` implicitly. The CLI refuses to run with the utterance set's authoring model as the judge, so that particular way of inflating a rate is closed in code rather than in a convention.

One thing `run` does **not** do: work on an arbitrary page out of the box. A rate needs an utterance set naming that page's tools and what a correct call to each looks like, and the set shipped here describes the reference app only. Pointing `run` at your own page means writing your own set — which is the real cost of the method, and the reason `lint` exists as a one-command starting point.

The utterance set, the fixture page, every injected defect and the prediction it was written to test are all committed. **214 tests** cover the rules that decide published numbers — the taxonomy, the intervals, the exit codes, the capture and publication filters — on the principle that anything load-bearing for a number gets tests and anything exploratory stays a probe. Four of them check this folder and its fixtures: every run write-up has to have its machine record beside it, every machine record has to stamp its judge and its utterance-set version, an arm declared as a subset of another variant has to be byte-identical to it, and the two halves of the compounding result have to partition it exactly.

## Licence and data

Code and these derived tables: MIT. Per-trial records: local, unpublished, and deferred *with* their licence — if they are ever released, that release names its own terms.

---

*Draft assembled 2026-09-03. Reviewed 2026-09-05 two ways: read cold by a reviewer handed nothing but this file, and fact-checked line by line against the machine records that produced it. Every number and claim that did not survive is corrected above; the vocabulary a stranger cannot infer is now defined; the conflict-of-interest statement the publishing policy requires is at the top; and the corrections that trace back to a published write-up are recorded in that write-up's own Corrections section rather than only here. Sections other than the cohort census are complete. The cohort section is a placeholder whose rules were fixed before the data existed, which is the only order in which they cannot be shaped to the result.*
