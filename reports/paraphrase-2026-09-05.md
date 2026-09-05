# A paraphrase does the same damage, and the linter never sees it — 2026-09-05

**Retraction first, because it is this project's own claim that broke.** Forty minutes earlier [`decomposition-2026-09-05.md`](decomposition-2026-09-05.md) reported that the linter's warning-versus-error grading had been vindicated by measurement. **That statement was too strong and is narrowed here.** It holds only for the byte-identical case the error rule can actually see. Replace the copied competitor description with a plain paraphrase — same meaning, ordinary wording — and the collapse is unchanged while the linter falls completely silent.

| `sum_by_category`'s manifest | Competitor's description | Linter on the competitor | Rate |
|---|---|---|---|
| clean | — | — | 95.0% [86.3, 98.3] |
| pair | **byte-identical** to `sum_by_category`'s | `description/duplicate` — an **error** | 48.3% [36.2, 60.7] |
| **pair, paraphrased** | **a paraphrase**, similarity **0.529** | **nothing at all** | **50.0%** [37.7, 62.3] |

Run: [`twin-ablate-pair-paraphrased-1.3.0-glm-5.3-s3r1.md`](twin-ablate-pair-paraphrased-1.3.0-glm-5.3-s3r1.md) · 60 trials, 3 sessions × 1 repeat, judge `glm-5.3`, utterance set `1.3.0`, fixture `1.4.0`. Gate **pass**, 60/60 after one `--resume` recovered a single `judge_unavailable` trial.

## What changed between the two arms: one string

The paraphrase arm is `ablate-pair` with exactly one field different, and a test enforces that (`variantOf` + `differsBy` in the fixture, asserted field by field):

- identical: *"Works with the rows in the table and returns totals for what it finds."*
- paraphrase: *"Handles the rows in the table and gives back totals for what it discovers."*

By the linter's own `similarity()` that pair scores **0.529**, against a `description/near-duplicate` threshold of **0.70**. So the manifest trips no `description/duplicate` and no `description/near-duplicate` against `sum_by_category`. The one description finding that remains is the pre-existing `sum_by_category`↔`filter_rows` pair, which the parent arm has too. **On the competitor — the tool that takes 25 of the 30 failures — the linter says nothing.**

## The result

**50.0%** [37.7, 62.3], σ between sessions **0.000** — 30 of 60 in every one of the three sessions, which is as stable as this harness gets. Against the identical-description arm's 48.3% [36.2, 60.7] the two are indistinguishable; against clean's 95.0% it is **−45.0**.

Where the 30 failures went: **25 to `summarise_by_category`**, 3 to `find_anomalies`, 2 to `describe_dataset`. The parent arm's split was 24 of 31 to the competitor. Same mechanism, same magnitude, same destination.

By phrasing, and this is the sharpest gradient the project has recorded: plain **85.7%**, paraphrase **38.1%**, oblique **22.2%**. When the request states the job in the tool's own words the right tool still wins most of the time; the moment the wording moves away from it, the two indistinguishable candidates are decided by something else.

## What this means for the linter

The mechanism was never about copied text. The judge does not compare the two descriptions to each other — it reads both, finds neither one tells it which tool to use, and falls back on the **name**. A paraphrase of an uninformative description is still uninformative, so the fallback fires exactly as before.

That has three consequences, and none of them is comfortable:

1. **`description/duplicate` as an error is aimed at a special case.** Byte-identity is the one version of this problem a string comparison can catch with confidence. It is not the version that matters most, and a page can fail this way while linting clean of it.
2. **A 0.70 similarity threshold does not catch a paraphrase.** 0.529 is not a near-miss of the threshold — it is comfortably below it, on a pair of sentences any reader would call the same statement. Lowering the threshold to catch it would fire on unrelated tools that share ordinary vocabulary; the two descriptions here share only *"the rows in table and totals for what it"*.
3. **The rule that would catch it is semantic, and this linter is deliberately not.** `lint` runs with no model, no key and no network, which is most of why it is usable in CI. A rule that asks "do these two descriptions mean the same thing?" needs the thing the linter refuses to depend on.

So the honest statement, replacing the vindication: **the linter's grading is right about the case it can see, and the case it can see is the minority of the harm.** What survives from the earlier claim is narrower and still worth having — `description/near-duplicate` fires on the arm worth −1.7 and `description/duplicate` on an arm worth −46.7, so the *relative* grading of those two rules is correct. What does not survive is the implication that a clean description-family lint means a page is safe from this failure. It does not.

**What is not being done here:** no threshold was changed and no rule was added. Both are design decisions with a false-positive cost that a single 60-trial arm does not license, and the options belong in the project log with their costs stated rather than in a quiet commit. The measurement's job was to find out whether the rule was aimed correctly; it was not.

## The prediction, scored

Registered in `fixtures/broken/tools.json` → `ablations["ablate-pair-paraphrased"]`, committed in `2bc803b` before the arm measured a trial.

| Claim | Outcome |
|---|---|
| "It still collapses — near the pair's 48.3%, call it 45 to 70" | ✅ 50.0% |
| "Falsified above 85%, which would mean the harm is about copied text" | ✅ Not triggered |
| "Byte-identity is NOT the trigger" | ✅ Confirmed |
| "The name tiebreaker should dominate exactly as before" | ✅ 25 of 30 failures chose the competitor |
| Pre-registered consequence: "if it collapses while the linter is silent, the vindication claim must be narrowed" | ✅ **Paid.** Narrowed above, in the write-up that made it, and in the report draft |

Four for four, and the fifth line was the one that mattered: the prediction was written with the cost of being right attached, so the retraction is a promise being kept rather than a discovery being managed.

## Bounds

One tool pair, one page, one judge, three sessions, n = 20 per session. One paraphrase, chosen to be a natural rewording rather than to sit near a threshold — a *different* paraphrase might score differently, and the boundary between "distinguishable" and "not" is unmeasured. What is measured is that at least one ordinary paraphrase costs 45 points while the linter reports nothing.
