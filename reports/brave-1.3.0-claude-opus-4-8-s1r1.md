# Brave, second session: the 100% holds

**Run:** `artifacts/` (subject `brave`, checkpoint `artifacts/sweep.jsonl`) · utterance set `1.3.0` (frozen) · judge `claude-opus-4-8` at `api.justwoker.icu`, anthropic-messages shape · 1 session × 1 repeat · concurrency 1 · completed 2026-09-26; exit 0.

## Why this run exists

It was not planned as a run. It began as the first attempt to measure Brave's rate on the day the judge providers kept dying — started, interrupted by a transient relay-refusal window, resumed, and set aside when the paired Chrome/Brave arms ([`airlock-1.3.0-claude-opus-4-8-brave-s1r1.md`](airlock-1.3.0-claude-opus-4-8-brave-s1r1.md)) took over the question with a cleaner design. Completing it cost one `--resume`, and what it bought is the thing a single session cannot give: **a second, independently-launched Brave session that reads exactly the same answer.**

## The rate

**100% (140/140 tool trials ok)** — every tool 20/20, identical to the paired arm. Controls: **0/20 false positives** [0.0%, 16.1%] — `off_topic` 0/5, `out_of_scope` 0/13, `injection` 0/2. 160/160 planned trials measured; the run's own badge reads `100% (n=140)`.

## What two agreeing sessions buy

Not a variance figure — one session each, no σ column, and this file will not pretend otherwise. What they buy is robustness of the headline itself: **Brave `154.1.96.59` read 100% under `claude-opus-4-8` in two separate sessions, each with its own process, browser instance and cold profile, launched independently hours apart.** A single-session 100% can be a lucky draw; two of them, in runs that knew nothing of each other, is the same finding twice. The Edge precedent stands: a variance measurement for Brave is a follow-up, not an omission already closed.

The judge coordinate is unchanged from the paired arms — claude-opus-4-8, not comparable in the absolute to the glm-5.3 corpus — and the browser build is the same `154.1.96.59` (Chromium `154.0.8037.58`) the surface column of the compatibility matrix stamps.
