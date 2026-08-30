# Published runs

Every file here is a measurement that was actually taken, with the code that took it in the same commit. Nothing is edited after the fact: a superseded number stays published, with a pointer to what superseded it.

Each run is `<subject>-<utterance set>-<judge>-<shape>`, where shape is `sNrM` for N sessions × M repeats (`r3` alone is the pre-isolation form, all repeats in one browser). `.md` is for reading, `.json` is the machine record — same numbers, plus the per-tool outcome counts, the coverage diff and the gate verdict.

## Write-ups — start here

| File | Question it answers |
|---|---|
| [`discrimination-2026-08-30.md`](discrimination-2026-08-30.md) | Does invocation rate tell a well-described page from a badly described one? Yes. |
| [`ablation-2026-08-31.md`](ablation-2026-08-31.md) | *Which* defect did it? None alone — they compound. Also scores the predictions that were wrong. |

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

3,560 trials across 11 runs. The raw per-trial JSONL stays local in `artifacts/` — see next step 2.

## Next steps that land here

1. **The time-spaced run** (PROJECT-LOG item 6, in flight). Three sessions six hours apart on 2026-08-31, reconciling at 17:15 local into `artifacts/spaced-degraded/`. When it lands: compare its between-session σ against `twin-degraded-…-s3r1` (0.041 on `sum_by_category`, 0.062 on `top_expenses`) — same shape, same judge, so the only difference is the hours between sessions. Publish as `twin-degraded-1.3.0-glm-5.3-s3r1-spaced.*` with a short write-up either way; a null result here is worth as much as a positive one.
2. 🚦 **Where the raw dataset lives** (item 8). Every number here is backed by per-trial JSONL that is currently local only. Decide: in-repo, separate dataset repo, or aggregate-only — and name the licence. Code is MIT; data meant to be cited usually wants CC BY 4.0.
3. **Mode B** (item 9). Every run here used a judge model as a stand-in for a real assistant. Whether the stand-in predicts a shipping client is the assumption the whole project rests on, and no file in this folder tests it yet.

Comparing runs: `node probes/compare-arms.mjs artifacts/s3-clean artifacts/s3-degraded …` prints per-tool rates, σ, failure mix and the phrasing gradient side by side.
