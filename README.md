# webmcp-gauge

Measures whether an AI agent actually calls the tools your web page exposes through WebMCP.

**Status: measuring.** The harness runs end to end and has produced real numbers against a live page. It launches its own browser per session — a cold profile seeded with the WebMCP flag, in headless Chrome — captures the settled tool manifest, asks a judge model which tool to call, classifies the choice, executes it, and classifies the result. The utterance set is frozen at `1.3.0` (140 utterances plus 20 negative controls), and two sweeps of 480 trials each are published under [`reports/`](reports/).

What exists: `trial` (one utterance, one outcome), `run` (S isolated sessions × R repeats, Wilson intervals, control false-positive rate, stamped JSON and Markdown reports), JSONL checkpointing with `--resume`. What does not: the static linter, the Mode B adapters for real shipping clients, and the badge emitter.

## The problem

WebMCP lets a page register JavaScript functions as AI-callable tools. Registering them is the easy part. Finding out whether an agent ever *chooses* one, passes it sane arguments, and does so consistently across browsers that each implement the draft differently — that has no answer today. Tools fail silently: no error, no log, no receipt. Developers have reported invocation working 1 time in 20, debugging by reading screenshots taken inside an agent's browser, and a page where registering too many tools switched the whole feature off with no warning.

## The metric

**Invocation rate** — of K frozen, realistic user utterances for a tool, the fraction that caused the agent to select *that* tool with valid arguments.

Reported only with a 95% Wilson score interval, the observed run-to-run spread across repeated runs, and the judge model and browser build that produced it. Agent behaviour is non-deterministic, so a bare percentage with no variance figure is not a measurement.

Every trial lands in exactly one bucket — `not_supported`, `not_registered`, `not_discovered`, `not_selected`, `wrong_tool`, `bad_args`, `exec_error`, `silent_fail`, `ok` — because the useful information is *which* way it failed. "Ignored" means your description is weak; "wrong tool" means two names collide; "bad args" means your schema is off. From the outside today, all three look identical.

## What gets built

- **A static linter** — no browser, no model, no API key. Catches invalid tool names, colliding or ambiguous descriptions, over-parameterised schemas, and tool counts approaching the undocumented per-page budget. *Not built yet.*
- **The harness** — drives real browsers over the Chrome DevTools Protocol, fires the utterance set at the page's registered tools, classifies every outcome, and emits a JSON report plus a CI gate. *Built, minus the gate.*
- **A public dataset** — the cross-client compatibility record and invocation-rate corpus, regenerated as browsers change, published with the code that produced every number. *Two runs so far, in `reports/`.*

## How a number is reported

Never as a bare percentage. Every rate carries a 95% Wilson score interval, the trial count, and two separate spreads:

- **σ between sessions** — sessions are compared across separate OS processes, separate browsers and cold profiles. This is the only figure that speaks to reproducibility.
- **σ within session** — repeats inside one session, which share a warm page and one provider connection. A floor, not a stability claim.

Conflating those two was a real defect in this project's first two sweeps: a tool reported σ 0.000 while failing every repeat of one utterance, because identical failures collapse the spread to zero. Reports also stamp the utterance-set version, the judge model, the browser build, and what a session does *not* isolate — the shared machine, the network path, provider-side state, and the fact that back-to-back sessions are not day-to-day drift.

## Usage

```
webmcp-gauge trial --utterance sum_by_category-05 --judge <model> --base-url <endpoint>
webmcp-gauge run --sessions 3 --repeats 2 --out artifacts/run --judge <model> --base-url <endpoint>
```

The judge must not be the model that wrote the utterances — the frozen set records which one did, and the CLI refuses to run if they match. Credentials come from the environment; see [`.env.example`](.env.example).

## Documentation

- [`docs/concept.md`](docs/concept.md) — the full design: metric definition, two-mode measurement, build layers, verified landscape research with sources
- [`docs/explainer.md`](docs/explainer.md) — the same idea in plain language, no jargon
- [`docs/getting-started.md`](docs/getting-started.md) — environment, first steps, the measurement pipeline, decision gates
- [`PROJECT-LOG.md`](PROJECT-LOG.md) — append-only record of what changed, why, and how it was verified

## Licence

MIT. See [`LICENSE`](LICENSE).
