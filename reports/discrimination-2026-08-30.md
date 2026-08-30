# Does invocation rate tell a good page from a badly described one?

**Answer: yes, where a defect has somewhere to go — and the taxonomy names which defect it was.** Measured 2026-08-30.

Every number in this project so far came from a page chosen for being well described, so the instrument was known to be *sound* and unproven as a *discriminator*. This is the experiment that tests it, and its design is one page, two manifests.

## The design

| Held identical | Varied |
|---|---|
| Handlers, DOM markers, and the 965-row dataset (`sample-expenses.csv`, SHA-256 `b737acf…a11c09`, a byte-identical copy of the reference page's) | Tool descriptions and input schemas |
| Utterance set `1.3.0`, frozen, unedited — 140 tool utterances plus 20 negative controls | Three extra tools in the degraded arm: an identically-described twin of `sum_by_category`, a dotted-name deprecated leftover, and a space-named tool the browser refuses |
| Judge `glm-5.3` at agentrouter, Chrome `152.0.7977.65`, `--headless=new`, one session, concurrency 3 | |

Both arms are the same fixture page — [`fixtures/broken/twin.html`](../fixtures/broken/twin.html) — under `?variant=clean` and `?variant=degraded`. The clean arm copies the reference page's descriptions and schemas verbatim; it exists so that a drop in the degraded arm cannot be blamed on the twin's implementation, the local server or the dataset copy. Every injected defect, and the prediction it was written to test, was registered in [`fixtures/broken/tools.json`](../fixtures/broken/tools.json) **before either sweep ran**.

## Result

160 trials per arm, 320 in total. Reports: [`twin-clean`](twin-clean-1.3.0-glm-5.3-s1r1.md) · [`twin-degraded`](twin-degraded-1.3.0-glm-5.3-s1r1.md).

| Tool | Injected defect | Clean | Degraded | Failure mix on the degraded arm |
|---|---|---|---|---|
| `describe_dataset` | none — in-page control | **100.0%** [83.9%, 100.0%] | **100.0%** [83.9%, 100.0%] | — |
| `monthly_trend` | none — in-page control | **100.0%** | **100.0%** | — |
| `filter_rows` | description degraded to an 86%-overlap near-duplicate | **100.0%** | **100.0%** | — |
| `clear_highlights` | description replaced with the single word "Utility." | **100.0%** | **100.0%** | — |
| `find_anomalies` | description replaced with a generic 43-character one | **100.0%** | **90.0%** [69.9%, 97.2%] | 2 × `wrong_tool` → `describe_dataset` |
| `sum_by_category` | near-duplicate description **and** an identically-described twin tool | **100.0%** | **35.0%** [18.1%, 56.7%] | 10 × → `summarise_by_category`, 3 × → `describe_dataset` |
| `top_expenses` | schema over-parameterised to 9 properties, 3 required and undocumented; handler throws when they are missing | **100.0%** | **35.0%** [18.1%, 56.7%] | 6 × `wrong_tool` → `describe_dataset`, 5 × `exec_error`, 2 × `not_selected` |
| **All tools** | | **100.0%** (140/140) | **80.0%** (112/140) | |
| Control false positives | | 0/20 | 1/20 (`control-14` → `filter_rows`) | |

By phrasing: clean 100% / 100% / 100% for plain / paraphrase / oblique; degraded **89.8% / 79.6% / 69.0%**. The tag gradient the fixture was built to expose is invisible on a good page and obvious on a bad one.

**The intervals separate.** `sum_by_category` and `top_expenses` at [18.1%, 56.7%] against a clean arm at [83.9%, 100.0%] do not overlap, at 20 trials per tool. The metric discriminates.

## What the shape of the result says, which is more useful than the headline

**A weak description only costs you if something else can absorb the request.** `sum_by_category` lost half its trials to `summarise_by_category`, a tool whose description is byte-identical — a collision needs a competitor. `filter_rows`, whose description shares 86% of its vocabulary with `sum_by_category`'s, held at 100%: its six documented, typed properties (`from`, `to`, `category`, `min_amount`, `max_amount`, `limit`) still said what it was for. **A good schema can carry a bad description**, and that is a cheap fix to recommend.

**A high rate does not exonerate a description.** `clear_highlights` scored 100% on the word "Utility.", because every other tool on the page *adds* highlighting and its utterances ask for the opposite: selection by elimination. The linter still flags it, and rightly — the next tool added to that page could break it. This is the clearest argument for running L0 and L1 together rather than treating a green rate as proof.

**One well-described tool becomes a magnet for everything the page confuses.** 11 of the 28 failures selected `describe_dataset`, the tool left untouched. Fixing one tool's description does not localise the benefit; it changes where misrouted intent lands.

**An over-parameterised schema fails in every direction at once.** `top_expenses` was avoided (6), called and thrown out of (5), and declined (2) — three taxonomy buckets from one defect, plus the cost below. No trial produced `bad_args`: the judge never invented values for the three undocumented required properties, so the blind spot that would have hidden this defect did not materialise.

**Bad metadata is measurably expensive even when it works.** Mean judge completion tokens rose from **133 to 426** per call (3.2×) and max from 767 to 3,147 — and that mean *excludes* the four degraded-arm calls that burned the entire 4,096-token budget on reasoning and returned nothing, since those trials produced no measurement at all. Three of the four were `top_expenses`. They were logged as `judge_truncated`, excluded from every rate, and recovered by `--resume`. The clean arm's 160 measured calls include no truncation; its first attempt was killed by an external 10-minute timeout after 63 trials with three harness failures whose kinds were never written to disk, so "zero truncations on the clean arm" is a statement about what was recorded, not about those three.

**Names bad enough to be flagged were simply ignored.** `top.expenses.v2` (dotted name, "Old version. Do not use.") was selected zero times in 160 trials, and the space-named tool never registered at all — Chrome `152.0.7977.65` throws `"Invalid tool name"`, which is *not* the silent failure spec issue #145 describes. So the two layers see different defects: L0 catches what the metric cannot, and the metric catches what L0 cannot.

## Predictions versus results

Registered before the run, scored after:

| Prediction | Outcome |
|---|---|
| Untouched tools stay at the ceiling | ✅ both at 100% |
| `sum_by_category` drops, loss in `wrong_tool` split between `filter_rows` and the twin | ✅ dropped to 35%, but the loss went to the twin (10) and `describe_dataset` (3), never to `filter_rows` |
| `filter_rows` drops, loss towards `sum_by_category` | ❌ **wrong** — held at 100%; its schema carried it |
| `find_anomalies` lower, mostly `wrong_tool`, worst on oblique | ✅ 90%, both failures `wrong_tool` |
| `clear_highlights` hurt badly by a one-word description | ❌ **wrong** — 100%, protected by having no competitor |
| `top_expenses` selected but executed wrongly | ✅ 5 `exec_error`, and also avoided outright |
| Blind spot: the judge invents the required values and scores `ok` | ✅ did not happen — no `bad_args` at all |

Two of seven predictions were wrong, both in the same direction: I over-estimated how much a thin description hurts on its own. That is the finding worth keeping.

## What this does not establish

- **One session, one repeat per arm.** No between-session σ for either arm, so these rates carry interval uncertainty but no reproducibility figure. The reference page's 960-trial run puts σ between sessions at 0.012 where anything varies, which is far smaller than the 65-point gaps above, but that is an argument by analogy rather than a measurement of this page.
- **Defects are bundled per tool.** `sum_by_category` carries both a near-duplicate description and a twin tool; the twin absorbed the selections, so the near-duplicate's own contribution is unmeasured. The ablation — each defect alone — is a separate run.
- **Not comparable line-for-line with the published Airlock runs.** Those were measured before `getTools()`'s JSON-string `inputSchema` was parsed, so the judge saw an escaped blob where these arms saw a real schema object. The clean arm exists precisely so the comparison does not need them.
- **20 trials per tool.** Enough to separate 35% from 100%; not enough to resolve 90% from 100%.
- **One judge, one browser build, one page.** Invocation rate is a property of *(page, client, judge, utterances)* and every one of those is pinned here.
