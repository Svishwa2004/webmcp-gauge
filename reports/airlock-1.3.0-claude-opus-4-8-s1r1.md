# The judge re-pinned: claude-opus-4-8 via Just Work, single session

**Run:** `artifacts/airlock-1.3.0-claude-opus-4-8-s1r1/` · utterance set `1.3.0` (frozen) · judge `claude-opus-4-8` at `api.justwoker.icu`, anthropic-messages shape · 1 session × 1 repeat · concurrency 1 · generated 2026-09-26 in 1136 s plus a resume pass; the completed checkpoint exits 0.

## Why this run exists

The judge provider died on publication day: agentrouter's channel group served **no channel for any model** on the account's keys, and a second agentrouter key was quota-exhausted besides. The maintainer ordered the provider changed. The path there is part of this run's record:

- **OpenRouter `z-ai/glm-5.3` proved the coordinate portable, then ran out of money.** Its partial arm (`artifacts/airlock-1.3.0-zai-or-s1r1/`, kept local, badge reading `incomplete (104/160)`) measured 104 of 160 trials before the account's $0.15 of credits ran out — **91 of 93 tool trials `ok`**, statistically indistinguishable from the glm-5.3 baseline. An incomplete run publishes no rate; it is referenced here as the portability check it was.
- Z.ai's standard API key has no balance (billing rejection), and the coding-plan keys are encrypted at rest by the host that owns them.
- **Just Work serves `claude-opus-4-8` over the Anthropic-messages protocol only** — it refuses the OpenAI shape outright (403) — so the harness gained its second judge adapter, `judges/anthropic-messages.mjs`, chosen by an explicit `--judge-shape` flag rather than a hostname guess. Same judge-level contract, no retrying, no repair: the OpenAI adapter's rules, a different wire.

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

Overall **100% (140/140 tool trials ok)**; 160/160 planned trials measured, 0 harness failures at rest. Five trials failed mid-run with transient `fetch failed` (network to the relay, no HTTP rejection) and were closed by `--resume` — the resume loop being, again, load-bearing.

Controls, scored inverted and never pooled: **0/20 false positives** [0.0%, 16.1%] — `off_topic` 0/5, `out_of_scope` 0/13, `injection` 0/2.

One utterance deserves its own sentence: **`sum_by_category-12` — the set's known floor, which failed on every glm-5.3 arm including the 960-trial reference — passed here.** The floor was always labelled a property of the *(set, judge)* pair rather than of the page, and this is the first direct measurement of that claim: a second judge family simply disagrees with the first about a contestable expected tool.

## Against the glm-5.3 corpus — and why these numbers are a new baseline

Every published rate to 2026-09-26 was judged by glm-5.3. These are judged by claude-opus-4-8, and **the absolute numbers are not comparable across that boundary** — invocation rate is a property of *(page, client, judge)*, which is the rule this file has stamped on every run since the first. What this arm buys instead:

- **A paired baseline for the Brave run** ([`airlock-1.3.0-claude-opus-4-8-brave-s1r1.md`](airlock-1.3.0-claude-opus-4-8-brave-s1r1.md)): same page, set, judge and window, only the client coordinate moving.
- **A second judge family at the ceiling.** The reference page reading 100% under a model from a different family is evidence the metric measures the manifest and not one model's tastes — the same argument the Edge run made for browsers, made for judges.

## What this run is not

- **Not a variance measurement.** One session, one repeat: the σ-between-sessions column is vacuous, and every Wilson interval is a single-session interval.
- **Not comparable in the absolute to the glm-5.3 corpus**, for the reason above. The 99–100% band the reference page occupies on both judges is an observation, not a pooled figure.
- **One relay, uncontrolled.** The endpoint is a third-party meter (its usage records carry its own credit accounting), so provider-side state is even less attributable than a first-party endpoint's. The judge, endpoint and shape are stamped in the machine record; the relay's internals are not this project's to know.
