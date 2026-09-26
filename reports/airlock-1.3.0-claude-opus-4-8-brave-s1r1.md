# The rate on a third client: Brave 154, single session — and a second judge family

**Run:** `artifacts/airlock-1.3.0-claude-opus-4-8-brave-s1r1/` · utterance set `1.3.0` (frozen) · judge `claude-opus-4-8` at `api.justwoker.icu`, anthropic-messages shape · 1 session × 1 repeat · concurrency 1 · generated 2026-09-26 in 1464 s plus a resume pass; the completed checkpoint exits 0.

**Why this run exists.** Issue [#268](https://github.com/webmachinelearning/webmcp/issues/268) names Brave as the client where tools stopped working, and until this morning Brave was the one client no column of the compatibility matrix covered. Its **surface** was measured earlier the same day — the matrix's fifth column, 18 of 22 behaviour rows, the Chrome labs recipe working unchanged. This run adds the **rate**, paired against the Chrome baseline taken in the same window with the same judge ([`airlock-1.3.0-claude-opus-4-8-s1r1.md`](airlock-1.3.0-claude-opus-4-8-s1r1.md)): same page, set, judge and day, only the client coordinate moving. Brave `154.1.96.59` (Chromium `154.0.8037.58`), aimed at through the launcher's existing `WEBMCP_GAUGE_CHROME` override — no code changed to measure it.

## The rate

| Tool | Rate (95% Wilson) | Trials | Outcomes |
|---|---|---|---|
| `describe_dataset` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |
| `filter_rows` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |
| `monthly_trend` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |
| `find_anomalies` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |
| `top_expenses` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |
| `clear_highlights` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |
| `sum_by_category` | 100.0% [83.9%, 100.0%] | 20 | ok 20 |

Overall **100% (140/140 tool trials ok)**; 160/160 planned trials measured, 0 harness failures at rest. Five trials failed mid-run with transient `fetch failed` and were closed by `--resume`.

Controls, scored inverted and never pooled: **0/20 false positives** [0.0%, 16.1%] — `off_topic` 0/5, `out_of_scope` 0/13, `injection` 0/2.

Every trial read the tool set twice — the page's `getTools()` and the browser's `toolsAdded` stream — and the two views agreed on all of them: no `not_discovered` fired, so nothing the page registered was dropped on the way to the agent's surface.

## Against the Chrome baseline

**100% vs 100%: swapping the browser for Brave did not move the invocation rate.** Every Brave rate sits exactly at its Chrome pair's, and the phrasing mix, the failure-free outcome columns and the 0/20 control arms are identical. A **second, independently-launched Brave session** — this run's own first attempt, laid aside mid-day and finished for the cost of one `--resume` — reads the same answer: 100% (140/140), controls 0/20 ([`brave-1.3.0-claude-opus-4-8-s1r1.md`](brave-1.3.0-claude-opus-4-8-s1r1.md)). Two sessions, same finding twice. That is the expected result on a well-described page — the manifest the judge reads is the same bytes — and it is now measured on a **third client**, after Edge `153` read 99.3% (139/140) under glm-5.3. It is also, incidentally, the strongest answer yet to #268's Brave half: with the WebMCP flag enabled on `154.1.96.59`, nothing failed — though the report's build remains a bound, since #268 names Brave 1.94, which is not installed here.

This run also carries a second first: **the judge is from a different family than every published rate before it** (claude-opus-4-8, after a day in which the glm-5.3 provider died and the maintainer ordered the provider changed — the story is in the Chrome baseline's write-up). One page, two clients, one judge: the comparison above holds that coordinate fixed, which is exactly what a client comparison needs.

## What this run is not

- **Not a variance measurement.** One session, one repeat — a point measurement, exactly like the Edge run was. A 3×2 Brave sweep is a follow-up, not an omission already closed.
- **Not comparable in the absolute to the glm-5.3 corpus.** The cross-judge observation — both families read the reference page at its ceiling — is an observation, not a pooled figure.
- **Not a measurement of any agent.** The judge stand-in selects and the harness executes; whether a shipping agent's choices track it remains Gate 3's unanswered question, unchanged by this run.
