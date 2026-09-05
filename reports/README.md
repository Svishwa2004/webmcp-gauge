# Published runs

Every file here is a measurement that was actually taken, with the code that took it in the same commit. Nothing is edited after the fact: a superseded number stays published, with a pointer to what superseded it.

Each run is `<subject>-<utterance set>-<judge>-<shape>`, where shape is `sNrM` for N sessions × M repeats (`r3` alone is the pre-isolation form, all repeats in one browser). `.md` is for reading, `.json` is the machine record — same numbers, plus the per-tool outcome counts, the coverage diff and the gate verdict.

## Write-ups — start here

| File | Question it answers |
|---|---|
| [`public-report-draft.md`](public-report-draft.md) | 🟡 **DRAFT, unpublished** — the whole story in one place: what invocation rate is and its four coordinates, that it discriminates, that defects compound, the drift caveat, the instrument's own floor, the nine browser behaviours that change how a page should be written, and the agent gate stated as unanswered. Every section is final except the cohort census, a marked placeholder whose rules are fixed in advance. **Reviewed 2026-09-05** — read cold by a reviewer given nothing but the file, and fact-checked line by line against the machine records in this folder; every number and claim that did not survive is corrected, and the ones that trace back to this folder's own write-ups are recorded in [`ablation-2026-08-31.md`](ablation-2026-08-31.md)'s Corrections section. Publication is gated on the repo going public (PROJECT-LOG item 18). |
| [`compatibility-matrix.md`](compatibility-matrix.md) | Same page, same code — why does it behave differently in another client? 22 measured behaviours across four builds, each cell dated and traced to its probe, with a Corrections section for the one finding that turned out to be ours. Undated filename on purpose: it accretes columns, so the date lives in the cell. |
| [`airlock-1.3.0-glm-5.3-edge-s1r1.md`](airlock-1.3.0-glm-5.3-edge-s1r1.md) | Does the rate survive a second client? Yes — Edge 153, single session, 99% (139/140) with every tool inside or above its Chrome interval. A point measurement, not a variance one, and both clients are Chromium. |
| [`discrimination-2026-08-30.md`](discrimination-2026-08-30.md) | Does invocation rate tell a well-described page from a badly described one? Yes. |
| [`ablation-2026-08-31.md`](ablation-2026-08-31.md) | *Which* defect did it? None alone — they compound. Also scores the predictions that were wrong. |
| [`spacing-2026-09-01.md`](spacing-2026-09-01.md) | Do hours-between-sessions change the answer? σ doesn't care (0.085 vs 0.062 worst-case) — but both mid-range tools declined monotonically across 26 h, the shape drift looks like. |

## The reference page (Airlock, live)

| Run | Trials | Note |
|---|---|---|
| `airlock-1.2.0-glm-5.3-r3` | 480 | First full sweep. Utterance set `1.2.0`, superseded by the `1.3.0` revision |
| `airlock-1.3.0-glm-5.3-r3` | 480 | Same shape on the frozen `1.3.0` set |
| `airlock-1.3.0-glm-5.3-s3r2` | 960 | **The reference figure.** Three isolated sessions × two repeats; the first run whose between-session σ is real |

## The fixture twin (local, deliberately mis-described)

| Run | Trials | Note |
|---|---|---|
| `twin-clean-1.3.0-glm-5.3-s1r1` | 160 | Single session. **Superseded** by the `s3r1` arm below — small-*n* optimism in both directions |
| `twin-degraded-1.3.0-glm-5.3-s1r1` | 160 | Single session. **Superseded** likewise |
| `twin-clean-1.3.0-glm-5.3-s3r1` | 480 | Control arm: reference metadata over the twin's own implementation |
| `twin-degraded-1.3.0-glm-5.3-s3r1` | 480 | All defects at once |
| `twin-ablate-near-duplicate-…-s3r1` | 120 | One defect: near-duplicate descriptions |
| `twin-ablate-duplicate-tool-…-s3r1` | 60 | One defect: a byte-identical competitor tool |
| `twin-ablate-thin-…-s3r1` | 120 | One defect: descriptions carrying no information |
| `twin-ablate-schema-…-s3r1` | 60 | One defect: an over-parameterised schema |
| `twin-degraded-1.3.0-glm-5.3-s3r1-spaced` | 480 | Same arm as `twin-degraded-…-s3r1` with sessions 17.2 h and 9.2 h apart across a day boundary |
| `airlock-1.3.0-glm-5.3-edge-s1r1` | 160 | **Second client** — Edge `153.0.4234.13`, single session: 99% (139/140), every tool inside or above its Chrome interval. A point measurement, not a variance one |

4,200 trials across 13 runs. The raw per-trial JSONL stays local in `artifacts/` — see next step 4.

## Next steps that land here

1. ~~**The time-spaced run**~~ ✅ **Done 2026-09-01** — `twin-degraded-1.3.0-glm-5.3-s3r1-spaced.*` plus [`spacing-2026-09-01.md`](spacing-2026-09-01.md). σ between sessions 0.085 worst-case against 0.062 back-to-back (the two load-bearing tools swap places), so the back-to-back reproducibility figures stand; both mid-range tools declined monotonically across the 26 h span from a starting point that matched the back-to-back arm measured 48 min earlier — suggestive of drift, not established at n=20/session. One trial needed five attempts (judge near its 60 s ceiling on that prompt), so the resume loop is load-bearing for CI use.
2. ⏳ **The cohort capture** (PROJECT-LOG item 12). **The expected date was wrong and is corrected: not 2026-09-04.** Checked 2026-09-05 — the gallery is still unpublished ~23 h after submissions closed, and the host's own schedule (read the same day, `probes/gallery-status.mjs`) runs judging to **2026-09-22** and announces winners **2026-09-24**, so the gallery most plausibly opens at the far end of judging. Two commands, both built and rehearsed, and two artifacts land here: the census and — separately — the aggregate write-up (item 14). Two rules travel with those numbers: adoption means **registered ≥1 tool**, never "the API exists", and the agent-visible count is reported **beside** the page-registered one rather than folded into it, because a delegated cross-origin embed makes them different.
3. ~~**The compatibility matrix**~~ ✅ **Done 2026-09-03** — [`compatibility-matrix.md`](compatibility-matrix.md), 22 rows across four builds: Chrome `152.0.7977.65`; the ChatGPT desktop app at Chromium `151.0.7922.174` and again at `152.0.7977.64` after it updated mid-project; and Edge `153.0.4234.13`, where the Chrome activation recipe works unchanged. Every Chrome row was re-measured that morning rather than transcribed, the fork was re-measured the same afternoon (item 19), and Edge plus the cross-site rows were measured that evening. Three things came out of the assembly that the log did not have: the app's silent Chromium bump, the fact that the `navigator.modelContext` divergence tracked that version rather than the vendor, and — from cross-checking two probes against one browser — that our published "the fork hides the CDP domain" finding was a key-name bug of ours, now withdrawn and recorded in the file's **Corrections** section. The evening added a fourth: **`localhost` and `127.0.0.1` are different sites**, which is why the cross-site rows needed no real domains. What is still unmeasured is listed rather than implied: Brave above all, since it is the one client #268 names that no column covers.
4. ~~**Where the raw dataset lives**~~ ✅ **Decided 2026-09-01: aggregate-only, for now.** Published output stays the derived tables and write-ups in this folder, under the repo's **MIT** licence; the per-trial JSONL stays local in `artifacts/`. The CC BY 4.0 question is deferred *with* the data — if raw trials are ever released, that release names its own licence. The consequence belongs in the report: every number here is reproducible by **re-running the harness**, not by re-analysing our rows.
5. ~~**Mode B**~~ ❌ **Closed 2026-09-02 on a recorded negative.** Every run in this folder still used a judge model as a stand-in, and that has not changed — but the reason is now measured rather than pending: the ChatGPT desktop app's *browser* is drivable, while the *agent* reads pages through a Chrome extension bridge into the operator's own Chrome, so nothing this harness opens is visible to it. Gate 3 is therefore **unanswered, not passed**, and the report must say so.

Comparing runs: `node probes/compare-arms.mjs artifacts/s3-clean artifacts/s3-degraded …` prints per-tool rates, σ, failure mix and the phrasing gradient side by side.
