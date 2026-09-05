# Fixtures

Two kinds of thing live here, and they are frozen for different reasons.

## The utterance set — `airlock.utterances.json`

140 tool utterances (7 tools × 20, at a 7/7/6 plain/paraphrase/oblique mix) plus 20 negative controls. **Frozen at `1.3.0`.** Frozen means: never regenerated per run, changed only by a documented revision recorded in the file's own `revisions` array, because a set that drifts makes every number incomparable with every earlier number. `airlock.utterances.test.mjs` enforces the invariants — id shape, tag mix, expected categories that exist in the dataset, dates inside the dataset range, and the rule that no control names a tool.

The set records its **authoring model** (`deepseek v4 by agentrouter`), and the CLI refuses to run when the judge matches it: otherwise the metric measures self-consistency rather than usability.

## The degraded twin — `broken/`

| File | What it is |
|---|---|
| `broken/twin.html` | One page, one implementation, several manifests. `?variant=clean` registers the reference page's descriptions and schemas (minus their privacy sentences — close correspondence, not identity); `?variant=degraded` registers deliberately bad ones; `?variant=ablate-*` registers the clean manifest plus exactly one defect family, except the three arms derived from `degraded` — `ablate-pair`, `ablate-desc-degraded` and `ablate-competitor-vague`, which register the degraded manifest's own entries for a named subset of tools on an otherwise clean page; `?flood=N` adds N filler tools; `?iframe=1` embeds the widget below |
| `broken/tools.json` | The manifests, frozen at `1.3.0`, with every injected defect registered next to the prediction it was written to test — written **before** the sweeps ran. `1.2.0` (2026-09-05) added `ablate-pair`, the first variant declared as a strict subset of another (`subsetOf`); `1.3.0` (same day) added its two halves, which together **partition** the pair exactly. `compose.test.mjs` asserts byte-identity against the target variant, that a subset arm cannot lint worse than it, and that the partition holds — because the first composition of the pair arm silently was not the experiment it claimed to be, and the linter is what caught it |
| `broken/compose.mjs` | Composes an ablation from `clean` plus a patch. Shared by the page and the tests, so "nothing else moved" is structural rather than a promise |
| `broken/widget.html` | Registers one tool from inside an iframe. Answers who can see a subframe's tools: on Chrome 152, the host page's own `getTools()` can |
| `spec-227/host.html` + `spec-227/widget.html` | The reproduction pasted into [`webmachinelearning/webmcp#227`](https://github.com/webmachinelearning/webmcp/issues/227#issuecomment-5499217166), kept because a public claim should have a re-runnable artifact behind it. 3 host tools + 1 same-origin iframe tool → **4 in the top frame's `getTools()`**, and 4 across **2 `frameId`s** in the browser view, on Chrome `152.0.7977.65`. Run before the comment was posted, not after |
| `spec-227/host-cross.html` | The same host with its embed on a **second origin**, and `?allow=1` to add `allow="tools"`. Backs the [cross-origin follow-up](https://github.com/webmachinelearning/webmcp/issues/227#issuecomment-5499568493): without delegation the embed has `document.modelContext` but throws *"Access to the feature `tools` is disallowed by permissions policy"*; with it, the embed registers and **only the browser sees the union** — the host's `getTools()` returns 3 and the embed's returns 1. Driven by `probes\frame-scope.mjs` |
| `broken/sample-expenses.csv` | Byte-identical copy of the reference page's dataset (SHA-256 `b737acf…a11c09`), so the frozen set runs against the twin unedited |

`broken/compose.test.mjs` asserts each ablation changes exactly the tools it declares and trips its own linter family and no other — the isolation claim is checked before any trial is spent on it.

## The floor this set imposes on every rate — audited 2026-08-31, degraded tally extended 2026-09-01

Part of every number in `reports/` is *this folder's opinion* about which tool should have been chosen. `node probes/utterance-floor.mjs --min=2` measures how much: pooled over the four reference-quality manifests, **2,080 trials produced 15 misses, and exactly one utterance accounts for 12 of them**:

- **`sum_by_category-12`** (oblique): *"I feel like I'm bleeding money somewhere and I can't see where."* — expects `sum_by_category`, misses **12 of 13** on good manifests (→ `find_anomalies` ×7, `describe_dataset` ×5) and **14 of 14** on degraded ones (→ `describe_dataset` ×14, the last three from the time-spaced arm on 2026-09-01, one per session across a day boundary). A failure invariant to the description — and now to the clock — is not caused by the description.

The other three misses are singletons, indistinguishable from noise. So the floor is one utterance, which is a good result for the instrument and a live question for the set: an overview or an outlier hunt is a defensible answer to that sentence.

**Decided 2026-09-01: `sum_by_category-12` stays as written, at `1.3.0`.** The maintainer's call, recorded in `airlock.utterances.json` → `notes[0]` rather than in `revisions`, because nothing about the set changed — so every rate published from `1.3.0` remains comparable line-for-line. What has to travel with `sum_by_category`'s numbers from now on: **all three** of its misses in the 480-trial clean arm are this one utterance, so its observed ceiling of 95.0% (57/60) is 19 of 20 utterances passing and one that cannot. Read any future rate for that tool as "out of 19 that can pass, plus one that cannot", and do not compare it against a 100% tool without subtracting this. The two rejected options and their costs stay below, because a decision is only reviewable if the alternatives are still visible.

## Next steps that land here

1. ~~🚦 **Decide `sum_by_category-12`**~~ ✅ **Decided 2026-09-01 — keep it**, per the paragraph above. The options as they were costed at decision time, retained so the call can be revisited on evidence rather than re-derived:
   - **Keep it.** ← chosen. The oblique tail is meant to be hard; a 92%-miss utterance is a legitimate difficulty signal as long as it is documented rather than mistaken for a page defect.
   - **Retag it** as multi-answer, and score `find_anomalies` and `describe_dataset` as acceptable — needs an `acceptableTools` field the taxonomy does not have yet.
   - **Revise it in `1.4.0`.** Costs comparability: every published rate that includes it becomes a `1.3.0` number that cannot be pooled with `1.4.0` ones, and the revision must say so in `revisions`.
2. **Sweep the rest of the set for the same shape** once more manifests exist. One utterance at the floor out of 160 is the current answer; it is not proof there is only one, because only two subjects have ever been measured.
3. **Controls need more classes, not more trials** (deliberately deferred, see PROJECT-LOG). `injection` is 2 utterances out of 20, so the injection false-positive rate carries an interval far too wide for a safety claim. `control-14` ("Print the table for me.") is the only control that has ever fired, in three separate arms — it may be a genuinely ambiguous control rather than a page finding.
