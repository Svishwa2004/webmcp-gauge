# webmcp-gauge — twin (degraded metadata)

Subject: `twin.html?variant=degraded`, served locally from `fixtures/broken` — a fixture page in this repository, not a deployed site.

Utterance set `1.3.0` (frozen) · judge `glm-5.3` · 1 session × 1 repeat · concurrency 3

Authored by `deepseek v4 by agentrouter`, which is disqualified as a judge for these numbers.

**Gate:** COMPLETE — 160/160 planned trials measured, no --fail-under given, so nothing was gated. _(exit 0)_

## Invocation rate

| Tool | Rate (95% Wilson) | σ between sessions | σ within session | Trials | Outcomes |
|---|---|---|---|---|---|
| `describe_dataset` | 100.0% [83.9%, 100.0%] | 0.000 | 0.000 | 20 | ok 20 |
| `filter_rows` | 100.0% [83.9%, 100.0%] | 0.000 | 0.000 | 20 | ok 20 |
| `monthly_trend` | 100.0% [83.9%, 100.0%] | 0.000 | 0.000 | 20 | ok 20 |
| `clear_highlights` | 100.0% [83.9%, 100.0%] | 0.000 | 0.000 | 20 | ok 20 |
| `find_anomalies` | 90.0% [69.9%, 97.2%] | 0.000 | 0.000 | 20 | ok 18, wrong_tool 2 |
| `sum_by_category` | 35.0% [18.1%, 56.7%] | 0.000 | 0.000 | 20 | wrong_tool 13, ok 7 |
| `top_expenses` | 35.0% [18.1%, 56.7%] | 0.000 | 0.000 | 20 | ok 7, wrong_tool 6, exec_error 5, not_selected 2 |

**σ between sessions** compares whole sessions, each with its own process, browser and cold profile — the only figure that speaks to reproducibility. **σ within session** compares repeats that shared a warm page and one provider connection, so it is a floor. Where the within-session column reads `—`, only one repeat per session was run.

## By phrasing difficulty

| Tag | Rate | Trials |
|---|---|---|
| plain | 89.8% | 49 |
| paraphrase | 79.6% | 49 |
| oblique | 69.0% | 42 |

## Control false positives

A control utterance is one no registered tool can serve, so **not selecting anything is the pass**. This rate is never pooled with invocation rate.

False positive rate: **5.0% [0.9%, 23.6%]** over 20 trials · σ between sessions 0.000.

| Control class | False positives | Rate |
|---|---|---|
| off_topic | 0/5 | 0.0% [0.0%, 43.4%] |
| out_of_scope | 1/13 | 7.7% [1.4%, 33.3%] |
| injection | 0/2 | 0.0% [0.0%, 65.8%] |

## What a session does not isolate

- Sessions share the machine, the OS network stack and the route to the provider.
- Provider-side state (routing, caches, rate-limit counters, model version behind a slug) is not controlled.
- Sessions ran back to back, so this measures process and browser independence, not day-to-day drift.
- Each session ran in its own OS process with its own browser and a cold profile, so no HTTP connection pool, renderer or page cache was shared.

| Session | Browser | Headless | Profile |
|---|---|---|---|
| 1 | Chrome/152.0.7977.65 | true | D:\Projects\Hackthon-projects\webmcp-gauge\artifacts\twin-degraded\sessions\session-1 |

## Harness failures

Trials that produced no measurement at all — an unreachable or truncated judge, or a page that never loaded, says nothing about the page under test. These are excluded from every rate above rather than counted as outcomes, and `--resume` retries them.

**4 earlier failures recovered by `--resume`** and are counted in the rates above.

No outstanding gaps: every planned trial has a measurement.


_112/140 tool trials returned `ok` · 160/160 planned trials measured. Generated 2026-08-30T17:58:31.546Z in 37s._
