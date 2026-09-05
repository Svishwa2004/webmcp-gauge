# The pair decomposed: neither defect costs anything alone — 2026-09-05

**A vague description costs nothing. A vaguely-described competitor costs nothing. Together they cost 46.7 points.** Both halves measured on the same tool entries as the pair, so this is the first decomposition in this project where the parts are actually subsets of the whole.

Runs: [`twin-ablate-desc-degraded-1.3.0-glm-5.3-s3r1.md`](twin-ablate-desc-degraded-1.3.0-glm-5.3-s3r1.md) (120 trials) and [`twin-ablate-competitor-vague-1.3.0-glm-5.3-s3r1.md`](twin-ablate-competitor-vague-1.3.0-glm-5.3-s3r1.md) (60 trials) · 3 sessions × 1 repeat each · judge `glm-5.3` · utterance set `1.3.0` frozen · fixture `1.3.0`. Both gates **pass**; the descriptions arm needed one `--resume` for 2 `judge_unavailable` trials.

## The 2×2

`sum_by_category`, against the clean arm's 95.0% [86.3, 98.3]:

| `sum_by_category`'s manifest | Rate | Cost | Real failures |
|---|---|---|---|
| clean | 95.0% [86.3, 98.3] | — | 3, all `sum_by_category-12` |
| **its description degraded, no competitor** | **93.3%** [84.1, 97.4] | **−1.7** | 4 — 3 the same floor utterance, plus one `sum_by_category-07` |
| **a vague competitor added, description intact** | **95.0%** [86.3, 98.3] | **0.0** | 3, **all** `sum_by_category-12` |
| **both** | **48.3%** [36.2, 60.7] | **−46.7** | 31, of which 24 chose the competitor across 11 different utterances |

The parts sum to **−1.7**. Together they cost **−46.7**. Almost the entire effect is interaction.

**The competitor arm is indistinguishable from clean, failure for failure.** 57/60, σ between sessions 0.000, and all three misses are `sum_by_category-12` — the utterance this project has already published as invariant to the manifest, failing 12 of 13 times on reference-quality pages. So a page that adds a second tool vaguely describing the same job loses **nothing**, as long as the original still says what it does.

**The descriptions arm is within noise of clean too.** 56/60, and 3 of its 4 misses are the same floor utterance. The one genuine loss (`sum_by_category-07` → `describe_dataset`) is a single trial in 60, against a between-session σ of 0.024. By phrasing, plain and paraphrase were **perfect** (42/42 each) and every real loss sat in the oblique tail (31/36).

## What the mechanism is, then

The damage needs **two indistinguishable options**. Alone, a vague description still leaves `sum_by_category` the best available match, because nothing else on the page claims to total by category. Alone, a vague competitor loses to the well-described original. Put both together and the model faces two tools whose descriptions are byte-identical — and it decides on the **name**, which is what the pair arm's smoke trial caught it doing: *"`summarise_by_category` seems designed for summarizing by category (its name suggests it summarizes across categories)"*. The name it preferred belonged to the wrong tool, and 24 of 31 failures followed it there.

## This vindicates the linter's severities, which was not the expected outcome

> **⚠️ Narrowed the same day — read [`paraphrase-2026-09-05.md`](paraphrase-2026-09-05.md) with this section.** Replacing the competitor's copied description with a plain *paraphrase* (similarity 0.529 against a 0.70 threshold, so the linter reports **nothing** about it) leaves the collapse unchanged at **50.0%**. So the claim below holds only for the byte-identical case the error rule can see, and that is the minority of the harm. What survives: the *relative* grading of the two description rules is correct. What does not: any implication that a clean description-family lint means a page is safe from this failure.

Pre-registered as a suspected rule gap: the competitor arm trips **nothing in the description family** — the linter reports only an undocumented, untyped property on the new tool. That silence turned out to be **correct**: the arm cost zero accuracy. And the reverse holds too. `description/near-duplicate`, which fired on the descriptions arm, is a **warning**, and alone it was worth 1.7 points — a warning's worth of damage. `description/duplicate`, which fires only when two tools actually share one description, is an **error**, and that is precisely the configuration that costs 46.7.

So the rule that fires on the *combination* is the one graded as an error, and the rule that fires on half of it is graded as advisory. That mapping was set on 2026-08-30 from judgement, before any of these three arms existed, and this is the first measurement that tests it. It holds.

## The predictions, scored

Both registered in `fixtures/broken/tools.json` and committed in `8f28aa2` before either arm measured a trial.

| Claim | Outcome |
|---|---|
| descriptions arm: "near 90.0, call it 82 to 95" | ✅ 93.3, inside the band |
| descriptions arm: "falsified below 70 — an argument description should not move selection" | ✅ Not triggered; the thinned argument description did not move selection |
| descriptions arm: "`filter_rows` near its 95.0%" | 🟡 98.3 — three points above the band's anchor, and equal to its degraded-arm and pair-arm rate |
| competitor arm: "at or near the ceiling, 90 to 100" | ✅ 95.0, and identical to clean failure-for-failure |
| competitor arm: "falsified below 85, which would mean the name is doing the damage" | ✅ Not triggered — the name does damage only when the descriptions stop distinguishing the tools |
| competitor arm: "if it costs real accuracy while tripping no description rule, the linter has a gap" | ✅ No cost, so no gap. The linter's silence was right |
| the decomposition: "the parts sum to far less than −46.7; interaction above 20 points" | ✅ Parts sum to −1.7; interaction ≈ 45 points |

Six of seven called. The one that missed was `filter_rows`, predicted at its near-duplicate-arm value and landing at its degraded-arm value instead — which is the more interesting of the two, because it means the extra thing the degraded manifest does to `filter_rows`' *neighbourhood* is worth those three points, not the description change itself.

## What this does and does not settle

- **It replaces the published compounding arithmetic.** [`ablation-2026-08-31.md`](ablation-2026-08-31.md)'s −5.0 / −3.3 / −35.0 stays published, and it was measuring three manifests that do not nest. The nesting version is −1.7 / 0.0 / −46.7, and it says something stronger: this is not "defects add up faster than you expect", it is "**neither defect is a defect until the other one is there**".
- **It does not generalise past this pair.** One tool, one page, one judge, three sessions, n = 20 per session. The claim is that a pure interaction of this size exists and is reproducible, not that manifest defects are generally non-additive.
- **The floor utterance is now doing visible work.** Three of the three failures in the competitor arm and three of four in the descriptions arm are `sum_by_category-12`. Any future arm on this tool should be read as "out of 19 utterances that can pass, plus one that cannot" — the cost the frozen set records about itself.
- **Untested: whether the interaction needs the descriptions to be *byte-identical*** or merely close. The pair arm makes them identical because the degraded manifest does. A near-miss variant would separate "indistinguishable" from "similar", and would tell a page author whether paraphrasing a competitor's description is enough to recover 46 points.
