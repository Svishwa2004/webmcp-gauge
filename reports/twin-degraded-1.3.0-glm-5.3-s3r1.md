# webmcp-gauge — twin (degraded metadata)

Subject: `twin.html?variant=degraded`, served locally from `fixtures/broken` — a fixture page in this repository, not a deployed site.

Utterance set `1.3.0` (frozen) · judge `glm-5.3` · 3 sessions × 1 repeat · concurrency 3

Authored by `deepseek v4 by agentrouter`, which is disqualified as a judge for these numbers.

**Gate:** COMPLETE — 480/480 planned trials measured, no --fail-under given, so nothing was gated. _(exit 0)_

## Invocation rate

| Tool | Rate (95% Wilson) | σ between sessions | σ within session | Trials | Outcomes |
|---|---|---|---|---|---|
| `describe_dataset` | 100.0% [94.0%, 100.0%] | 0.000 | 0.000 | 60 | ok 60 |
| `monthly_trend` | 100.0% [94.0%, 100.0%] | 0.000 | 0.000 | 60 | ok 60 |
| `clear_highlights` | 100.0% [94.0%, 100.0%] | 0.000 | 0.000 | 60 | ok 60 |
| `filter_rows` | 98.3% [91.1%, 99.7%] | 0.024 | 0.000 | 60 | ok 59, wrong_tool 1 |
| `find_anomalies` | 96.7% [88.6%, 99.1%] | 0.024 | 0.000 | 60 | ok 58, wrong_tool 2 |
| `sum_by_category` | 60.0% [47.4%, 71.4%] | 0.041 | 0.000 | 60 | ok 36, wrong_tool 24 |
| `top_expenses` | 26.7% [17.1%, 39.0%] | 0.062 | 0.000 | 60 | wrong_tool 23, exec_error 18, ok 16, not_selected 3 |

**σ between sessions** compares whole sessions, each with its own process, browser and cold profile — the only figure that speaks to reproducibility. **σ within session** compares repeats that shared a warm page and one provider connection, so it is a floor. Where the within-session column reads `—`, only one repeat per session was run.

## By phrasing difficulty

| Tag | Rate | Trials |
|---|---|---|
| plain | 88.4% | 147 |
| paraphrase | 84.4% | 147 |
| oblique | 75.4% | 126 |

## Control false positives

A control utterance is one no registered tool can serve, so **not selecting anything is the pass**. This rate is never pooled with invocation rate.

False positive rate: **3.3% [0.9%, 11.4%]** over 60 trials · σ between sessions 0.024.

| Control class | False positives | Rate |
|---|---|---|
| off_topic | 0/15 | 0.0% [0.0%, 20.4%] |
| out_of_scope | 2/39 | 5.1% [1.4%, 16.9%] |
| injection | 0/6 | 0.0% [0.0%, 39.0%] |

## What a session does not isolate

- Sessions share the machine, the OS network stack and the route to the provider.
- Provider-side state (routing, caches, rate-limit counters, model version behind a slug) is not controlled.
- Sessions ran back to back, so this measures process and browser independence, not day-to-day drift.
- Each session ran in its own OS process with its own browser and a cold profile, so no HTTP connection pool, renderer or page cache was shared.

| Session | Browser | Headless | Profile |
|---|---|---|---|
| 1 | Chrome/152.0.7977.65 | true | D:\Projects\Hackthon-projects\webmcp-gauge\artifacts\s3-degraded\sessions\session-1 |
| 2 | Chrome/152.0.7977.65 | true | D:\Projects\Hackthon-projects\webmcp-gauge\artifacts\s3-degraded\sessions\session-2 |
| 3 | Chrome/152.0.7977.65 | true | D:\Projects\Hackthon-projects\webmcp-gauge\artifacts\s3-degraded\sessions\session-3 |

## Harness failures

Trials that produced no measurement at all — an unreachable or truncated judge, or a page that never loaded, says nothing about the page under test. These are excluded from every rate above rather than counted as outcomes, and `--resume` retries them.

**36 earlier failures recovered by `--resume`** and are counted in the rates above.

No outstanding gaps: every planned trial has a measurement.


_349/420 tool trials returned `ok` · 480/480 planned trials measured. Generated 2026-08-30T22:00:32.373Z in 66s._
