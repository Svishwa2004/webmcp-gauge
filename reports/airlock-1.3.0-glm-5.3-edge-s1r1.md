# The rate on a second client: Edge 153, single session

**Run:** `artifacts/edge-s1/` · utterance set `1.3.0` (frozen) · judge `glm-5.3` at agentrouter · 1 session × 1 repeat · concurrency 1 · generated 2026-09-03 in 869 s.

**Why this run exists.** Every published invocation rate to 2026-09-03 was measured through Chrome `152.0.7977.65`. Criterion 1 of the concept doc asks for the rate in three clients, and the compatibility matrix had just gained an Edge column — surface and protocol only — using the launcher's existing `WEBMCP_GAUGE_CHROME` override. The same override aims the sweep harness at Edge, so this run holds the page, the utterance set and the judge fixed and moves **only the client coordinate**: Microsoft Edge `153.0.4234.13`, recorded by the harness itself in the session table below.

## The rate

| Tool | Rate (95% Wilson) | Trials | Outcomes |
|---|---|---|---|
| `describe_dataset` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |
| `filter_rows` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |
| `monthly_trend` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |
| `find_anomalies` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |
| `top_expenses` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |
| `clear_highlights` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |
| `sum_by_category` | 95.0% [76.4%, 99.1%] | 20 | ok 19, wrong_tool 1 |

Overall **99% (139/140 tool trials ok)**; 160/160 planned trials measured, 0 harness failures, 1 judge call retried by `--resume` semantics within the run.

Controls, scored inverted and never pooled: **0/20 false positives** [0.0%, 16.1%] — `off_topic` 0/5, `out_of_scope` 0/13, `injection` 0/2.

By phrasing: plain 100.0% (49), paraphrase 100.0% (49), oblique 97.6% (42).

## Against the Chrome baseline

The Chrome baseline ([`airlock-1.3.0-glm-5.3-s3r2.md`](airlock-1.3.0-glm-5.3-s3r2.md), 960 trials): five tools at 100.0%, `filter_rows` 99.2%, `sum_by_category` 94.2%, controls 0/120.

Every Edge rate sits inside or above its Chrome interval. `sum_by_category` — the tool with the weakest rate on both clients — reads 95.0% here against 94.2% there; its single failure was a `wrong_tool`, the same failure mode that dominates its Chrome losses. **On a well-described page, swapping the browser for another Chromium build did not move the invocation rate**, which is the expected result and now a measured one: the manifest the judge reads is the same bytes, and neither build's read-back quirks (the JSON-string `inputSchema` on all four builds measured) changed the outcome.

## What this run is not

- **It is not a variance measurement.** One session, one repeat: the σ-between-sessions column is vacuous here, and every Wilson interval is a single-session interval. The reproducibility figures remain Chrome-only; a 3×2 Edge sweep is a follow-up, not an omission already closed.
- **It is one judge.** The client coordinate moved; the judge coordinate did not. "Rate in three clients" with one judge is a weaker claim than it sounds, and the draft report says so where it matters.
- **Both clients are Chromium.** Chrome 152 and Edge 153 share a rendering stack and, as the matrix now records, agree on every WebMCP surface measured. A genuinely independent engine — Brave, which is Chromium-derived but ships its own defaults, or anything non-Chromium once one exists — is the unmeasured case.

| Session | Browser | Headless | Profile |
|---|---|---|---|
| 1 | `Edg/153.0.4234.13` | true | cold, per-session, flag seeded via `Local State` |

Reproduce with the launcher's path override — no second harness:

```
set WEBMCP_GAUGE_CHROME=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
node --env-file=.env bin/webmcp-gauge.mjs run --sessions 1 --out artifacts/edge-s1
```
