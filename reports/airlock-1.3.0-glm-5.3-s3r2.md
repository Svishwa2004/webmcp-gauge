# webmcp-gauge — airlock

Utterance set `1.3.0` (frozen) · judge `glm-5.3` · 3 sessions × 2 repeats · concurrency 1

Authored by `deepseek v4 by agentrouter`, which is disqualified as a judge for these numbers.

## Invocation rate

| Tool | Rate (95% Wilson) | σ between sessions | σ within session | Trials | Outcomes |
|---|---|---|---|---|---|
| `describe_dataset` | 100.0% [96.9%, 100.0%] | 0.000 | 0.000 | 120 | ok 120 |
| `monthly_trend` | 100.0% [96.9%, 100.0%] | 0.000 | 0.000 | 120 | ok 120 |
| `find_anomalies` | 100.0% [96.9%, 100.0%] | 0.000 | 0.000 | 120 | ok 120 |
| `top_expenses` | 100.0% [96.9%, 100.0%] | 0.000 | 0.000 | 120 | ok 120 |
| `clear_highlights` | 100.0% [96.9%, 100.0%] | 0.000 | 0.000 | 120 | ok 120 |
| `filter_rows` | 99.2% [95.4%, 99.9%] | 0.012 | 0.008 | 120 | ok 119, wrong_tool 1 |
| `sum_by_category` | 94.2% [88.4%, 97.1%] | 0.012 | 0.008 | 120 | ok 113, wrong_tool 7 |

**σ between sessions** compares whole sessions, each with its own process, browser and cold profile — the only figure that speaks to reproducibility. **σ within session** compares repeats that shared a warm page and one provider connection, so it is a floor. Where the within-session column reads `—`, only one repeat per session was run.

## By phrasing difficulty

| Tag | Rate | Trials |
|---|---|---|
| plain | 100.0% | 294 |
| paraphrase | 100.0% | 294 |
| oblique | 96.8% | 252 |

## Control false positives

A control utterance is one no registered tool can serve, so **not selecting anything is the pass**. This rate is never pooled with invocation rate.

False positive rate: **0.0% [0.0%, 3.1%]** over 120 trials · σ between sessions 0.000.

| Control class | False positives | Rate |
|---|---|---|
| off_topic | 0/30 | 0.0% [0.0%, 11.4%] |
| out_of_scope | 0/78 | 0.0% [0.0%, 4.7%] |
| injection | 0/12 | 0.0% [0.0%, 24.2%] |

## What a session does not isolate

- Sessions share the machine, the OS network stack and the route to the provider.
- Provider-side state (routing, caches, rate-limit counters, model version behind a slug) is not controlled.
- Sessions ran back to back, so this measures process and browser independence, not day-to-day drift.
- Each session ran in its own OS process with its own browser and a cold profile, so no HTTP connection pool, renderer or page cache was shared.

| Session | Browser | Headless | Profile |
|---|---|---|---|
| 1 | Chrome/152.0.7977.65 | true | D:\Projects\Hackthon-projects\webmcp-gauge\artifacts\sweep-sessions\sessions\session-1 |
| 2 | Chrome/152.0.7977.65 | true | D:\Projects\Hackthon-projects\webmcp-gauge\artifacts\sweep-sessions\sessions\session-2 |
| 3 | Chrome/152.0.7977.65 | true | D:\Projects\Hackthon-projects\webmcp-gauge\artifacts\sweep-sessions\sessions\session-3 |

## Harness failures

Trials that produced no measurement at all — an unreachable or truncated judge, or a page that never loaded, says nothing about the page under test. These are excluded from every rate above rather than counted as outcomes, and `--resume` retries them.

**10 earlier failures recovered by `--resume`** and are counted in the rates above.

No outstanding gaps: every planned trial has a measurement.


_832/840 tool trials returned `ok`. Generated 2026-08-30T06:43:59.534Z in 5s._
