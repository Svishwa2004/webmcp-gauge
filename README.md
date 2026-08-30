# webmcp-gauge

Measures whether an AI agent actually calls the tools your web page exposes through WebMCP.

**Status: measuring, and the metric discriminates.** The harness runs end to end and has produced real numbers against a live page. It launches its own browser per session — a cold profile seeded with the WebMCP flag, in headless Chrome — captures the settled tool manifest, asks a judge model which tool to call, classifies the choice, executes it, and classifies the result. The utterance set is frozen at `1.3.0` (140 utterances plus 20 negative controls), and eleven runs are published under [`reports/`](reports/) — the best isolated reference run being 960 trials across three separate processes, browsers and cold profiles.

The question that mattered most has an answer. Every early number came from a page chosen for being well described, so the same frozen utterance set was fired at a deliberately mis-described twin of that page: one implementation, one dataset, several manifests, **1,320 trials at three isolated sessions per arm**. Clean manifest **99.3%**; degraded manifest **83.1%** overall, with `sum_by_category` at **60.0%** [47.4, 71.4] and `top_expenses` at **26.7%** [17.1, 39.0] against a clean 95.0% and 100%. Between-session σ is at most **0.094** where the effects are 0.35 and larger, so the gap is not noise.

Four ablations, each the clean manifest plus exactly one defect, then answered *which* defect — and the answer was **none of them alone**. A near-duplicate description costs 5 points; a byte-identical competitor tool costs 3; the two together cost **35**. Manifest defects compound, so a page cannot be triaged one finding at a time. Write-ups: [`ablation-2026-08-31.md`](reports/ablation-2026-08-31.md) and [`discrimination-2026-08-30.md`](reports/discrimination-2026-08-30.md), each scoring the predictions registered before its run, including the ones that were wrong.

What exists: `lint` (static manifest rules, no judge or key), `trial` (one utterance, one outcome), `run` (S isolated sessions × R repeats, Wilson intervals, control false-positive rate, stamped JSON and Markdown reports), JSONL checkpointing with `--resume`, a CI gate with split exit codes, and a served fixture page for measuring pages this repo controls. What does not: the Mode B adapters for real shipping clients, and the badge emitter.

## The problem

WebMCP lets a page register JavaScript functions as AI-callable tools. Registering them is the easy part. Finding out whether an agent ever *chooses* one, passes it sane arguments, and does so consistently across browsers that each implement the draft differently — that has no answer today. Tools fail silently: no error, no log, no receipt. Developers have reported invocation working 1 time in 20, debugging by reading screenshots taken inside an agent's browser, and a page where registering too many tools switched the whole feature off with no warning.

## The metric

**Invocation rate** — of K frozen, realistic user utterances for a tool, the fraction that caused the agent to select *that* tool with valid arguments.

Reported only with a 95% Wilson score interval, the observed run-to-run spread across repeated runs, and the judge model and browser build that produced it. Agent behaviour is non-deterministic, so a bare percentage with no variance figure is not a measurement.

Every trial lands in exactly one bucket — `not_supported`, `not_registered`, `not_discovered`, `not_selected`, `wrong_tool`, `bad_args`, `exec_error`, `silent_fail`, `ok` — because the useful information is *which* way it failed. "Ignored" means your description is weak; "wrong tool" means two names collide; "bad args" means your schema is off. From the outside today, all three look identical.

## What gets built

- **A static linter** — no browser needed to reason, no model, no API key. Thirteen rules across four families: invalid or colliding tool names, missing, thin, duplicate or near-duplicate descriptions, over-parameterised and under-documented schemas, and tool counts approaching the undocumented per-page budget. Thresholds are calibrated so the reference page — the one measured at 100% over 960 trials — lints clean, because a default that flags a manifest known to work is a broken default. *Built.*
- **The harness** — drives real browsers over the Chrome DevTools Protocol, fires the utterance set at the page's registered tools, classifies every outcome, and emits a JSON report plus a CI gate. *Built.*
- **A public dataset** — the cross-client compatibility record and invocation-rate corpus, regenerated as browsers change, published with the code that produced every number. *Three runs so far, in `reports/`.*

## How a number is reported

Never as a bare percentage. Every rate carries a 95% Wilson score interval, the trial count, and two separate spreads:

- **σ between sessions** — sessions are compared across separate OS processes, separate browsers and cold profiles. This is the only figure that speaks to reproducibility.
- **σ within session** — repeats inside one session, which share a warm page and one provider connection. A floor, not a stability claim.

Conflating those two was a real defect in this project's first two sweeps: a tool reported σ 0.000 while failing every repeat of one utterance, because identical failures collapse the spread to zero. Reports also stamp the utterance-set version, the judge model, the browser build, and what a session does *not* isolate — the shared machine, the network path, provider-side state, and the fact that back-to-back sessions are not day-to-day drift.

## Usage

```
webmcp-gauge lint --url https://example.com
webmcp-gauge trial --utterance sum_by_category-05 --judge <model> --base-url <endpoint>
webmcp-gauge run --sessions 3 --repeats 2 --out artifacts/run --judge <model> --base-url <endpoint>
webmcp-gauge run --sessions 1 --fail-under 0.9 --judge <model> --base-url <endpoint>
webmcp-gauge run --serve fixtures/broken --url "twin.html?variant=degraded" --subject "twin" ...
```

`lint` needs no judge and no key — it reads the page's manifest and applies static rules. Everything else calls a judge model, which must not be the model that wrote the utterances: the frozen set records which one did, and the CLI refuses to run if they match. Credentials come from the environment; see [`.env.example`](.env.example).

`--serve <dir>` publishes a directory on 127.0.0.1 and resolves `--url` against it, which is how the deliberately mis-described fixture page in [`fixtures/broken/`](fixtures/broken/) gets measured with the same frozen utterance set as the reference page.

### Exit codes

A gate is only useful if `1` means one thing, so the three cases are separated:

| Code | Meaning |
|---|---|
| `0` | Every planned trial was measured, and no tool's invocation rate fell below `--fail-under` |
| `1` | Every planned trial was measured, and a rate is below `--fail-under` — the page regressed |
| `2` | The run cannot answer: planned trials have no measurement (re-run with `--resume`), or the arguments were unusable |

Incomplete outranks a breach on purpose. Gaps are not random — a judge outage or a page that never loaded can take out one tool's utterances and nothing else — so a rate over a run with holes is a rate over a denominator the run did not choose, and reporting that as a regression would be a lie with a plausible number. Completeness is derived from the plan against the checkpoint, not from the failure log, because a session killed mid-plan logs nothing.

The threshold is compared against the **point rate**, not the Wilson lower bound: 20 of 20 has a lower bound of 83.9%, so gating on the bound would fail a flawless page on sample size alone. The interval is printed beside the rate instead, and the verdict says so when a breach sits inside it.

## Documentation

- [`docs/concept.md`](docs/concept.md) — the full design: metric definition, two-mode measurement, build layers, verified landscape research with sources
- [`docs/explainer.md`](docs/explainer.md) — the same idea in plain language, no jargon
- [`docs/getting-started.md`](docs/getting-started.md) — environment, first steps, the measurement pipeline, decision gates
- [`PROJECT-LOG.md`](PROJECT-LOG.md) — append-only record of what changed, why, and how it was verified

## Licence

MIT. See [`LICENSE`](LICENSE).
