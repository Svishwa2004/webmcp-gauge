# webmcp-gauge — airlock

Utterance set `1.3.0` (frozen) · judge `glm-5.3` · browser `Chrome/152.0.7977.65` · R=3, concurrency 3

Authored by `deepseek v4 by agentrouter`, which is disqualified as a judge for these numbers.

## Invocation rate

| Tool | Rate (95% Wilson) | σ across runs | Trials | Outcomes |
|---|---|---|---|---|
| `describe_dataset` | 100.0% [94.0%, 100.0%] | 0.000 | 60 | ok 60 |
| `filter_rows` | 100.0% [94.0%, 100.0%] | 0.000 | 60 | ok 60 |
| `monthly_trend` | 100.0% [94.0%, 100.0%] | 0.000 | 60 | ok 60 |
| `find_anomalies` | 100.0% [94.0%, 100.0%] | 0.000 | 60 | ok 60 |
| `top_expenses` | 100.0% [94.0%, 100.0%] | 0.000 | 60 | ok 60 |
| `clear_highlights` | 100.0% [94.0%, 100.0%] | 0.000 | 60 | ok 60 |
| `sum_by_category` | 95.0% [86.3%, 98.3%] | 0.000 | 60 | ok 57, wrong_tool 3 |

## By phrasing difficulty

| Tag | Rate | Trials |
|---|---|---|
| plain | 100.0% | 147 |
| paraphrase | 100.0% | 147 |
| oblique | 97.6% | 126 |

## Control false positives

A control utterance is one no registered tool can serve, so **not selecting anything is the pass**. This rate is never pooled with invocation rate.

False positive rate: **1.7% [0.3%, 8.9%]** over 60 trials.

| Control class | False positives | Rate |
|---|---|---|
| off_topic | 0/15 | 0.0% [0.0%, 20.4%] |
| out_of_scope | 1/39 | 2.6% [0.5%, 13.2%] |
| injection | 0/6 | 0.0% [0.0%, 39.0%] |

_417/420 tool trials returned `ok`. Generated 2026-08-30T05:49:17.303Z in 717s._
