# webmcp-gauge — twin (pair, competitor description paraphrased not copied)

Subject: `twin.html?variant=ablate-pair-paraphrased`, served locally from `fixtures/broken` — a fixture page in this repository, not a deployed site.

Utterance set `1.3.0` (frozen) · judge `glm-5.3` · 3 sessions × 1 repeat · concurrency 3

Authored by `deepseek v4 by agentrouter`, which is disqualified as a judge for these numbers.

**Gate:** COMPLETE — 60/60 planned trials measured, no --fail-under given, so nothing was gated. _(exit 0)_

## Invocation rate

| Tool | Rate (95% Wilson) | σ between sessions | σ within session | Trials | Outcomes |
|---|---|---|---|---|---|
| `sum_by_category` | 50.0% [37.7%, 62.3%] | 0.000 | 0.000 | 60 | wrong_tool 30, ok 30 |

**σ between sessions** compares whole sessions, each with its own process, browser and cold profile — the only figure that speaks to reproducibility. **σ within session** compares repeats that shared a warm page and one provider connection, so it is a floor. Where the within-session column reads `—`, only one repeat per session was run.

## By phrasing difficulty

| Tag | Rate | Trials |
|---|---|---|
| plain | 85.7% | 21 |
| paraphrase | 38.1% | 21 |
| oblique | 22.2% | 18 |

## What a session does not isolate

- Sessions share the machine, the OS network stack and the route to the provider.
- Provider-side state (routing, caches, rate-limit counters, model version behind a slug) is not controlled.
- Sessions ran back to back, so this measures process and browser independence, not day-to-day drift.
- Each session ran in its own OS process with its own browser and a cold profile, so no HTTP connection pool, renderer or page cache was shared.

| Session | Browser | Headless | Profile |
|---|---|---|---|
| 1 | Chrome/152.0.7977.65 | true | D:\Projects\Hackthon-projects\webmcp-gauge\artifacts\ablate-pair-paraphrased\sessions\session-1 |
| 2 | Chrome/152.0.7977.65 | true | D:\Projects\Hackthon-projects\webmcp-gauge\artifacts\ablate-pair-paraphrased\sessions\session-2 |
| 3 | Chrome/152.0.7977.65 | true | D:\Projects\Hackthon-projects\webmcp-gauge\artifacts\ablate-pair-paraphrased\sessions\session-3 |

## Harness failures

Trials that produced no measurement at all — an unreachable or truncated judge, or a page that never loaded, says nothing about the page under test. These are excluded from every rate above rather than counted as outcomes, and `--resume` retries them.

**1 earlier failure recovered by `--resume`** and are counted in the rates above.

No outstanding gaps: every planned trial has a measurement.


_30/60 tool trials returned `ok` · 60/60 planned trials measured. Generated 2026-09-05T10:36:07.184Z in 12s._
