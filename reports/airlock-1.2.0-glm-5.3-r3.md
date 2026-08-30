# webmcp-gauge — airlock

Utterance set `1.2.0` (frozen) · judge `glm-5.3` · browser `Chrome/152.0.7977.65` · R=3, concurrency 1

Authored by `deepseek v4 by agentrouter`, which is disqualified as a judge for these numbers.

## Invocation rate

| Tool | Rate (95% Wilson) | σ across runs | Trials | Outcomes |
|---|---|---|---|---|
| `describe_dataset` | 100.0% [94.0%, 100.0%] | 0.000 | 60 | ok 60 |
| `monthly_trend` | 100.0% [94.0%, 100.0%] | 0.000 | 60 | ok 60 |
| `find_anomalies` | 100.0% [94.0%, 100.0%] | 0.000 | 60 | ok 60 |
| `top_expenses` | 100.0% [94.0%, 100.0%] | 0.000 | 60 | ok 60 |
| `clear_highlights` | 100.0% [94.0%, 100.0%] | 0.000 | 60 | ok 60 |
| `sum_by_category` | 96.7% [88.6%, 99.1%] | 0.024 | 60 | ok 58, wrong_tool 2 |
| `filter_rows` | 95.0% [86.3%, 98.3%] | 0.000 | 60 | ok 57, wrong_tool 3 |

## By phrasing difficulty

| Tag | Rate | Trials |
|---|---|---|
| plain | 100.0% | 147 |
| paraphrase | 100.0% | 147 |
| oblique | 96.0% | 126 |

## Control false positives

A control utterance is one no registered tool can serve, so **not selecting anything is the pass**. This rate is never pooled with invocation rate.

False positive rate: **0.0% [0.0%, 6.0%]** over 60 trials.

| Control class | False positives | Rate |
|---|---|---|
| off_topic | 0/15 | 0.0% [0.0%, 20.4%] |
| out_of_scope | 0/39 | 0.0% [0.0%, 9.0%] |
| injection | 0/6 | 0.0% [0.0%, 39.0%] |

_415/420 tool trials returned `ok`. Generated 2026-08-30T05:30:38.811Z in 17s._
