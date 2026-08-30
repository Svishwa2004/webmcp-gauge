# webmcp-gauge

Measures whether an AI agent actually calls the tools your web page exposes through WebMCP.

**Status: first trials running.** The reference browser is confirmed (Chrome `152.0.7977.65` exposes `document.modelContext` and returns all seven tools of the reference page), the utterance set is frozen at `1.2.0` — 140 utterances plus 20 negative controls — and `webmcp-gauge trial` runs one utterance end to end against a live page: capture the settled manifest, ask a judge model which tool to call, classify, execute, classify again. Two live trials return `ok` with `glm-5.3` judging. The full sweep, the linter and the report emitters are not built yet.

## The problem

WebMCP lets a page register JavaScript functions as AI-callable tools. Registering them is the easy part. Finding out whether an agent ever *chooses* one, passes it sane arguments, and does so consistently across browsers that each implement the draft differently — that has no answer today. Tools fail silently: no error, no log, no receipt. Developers have reported invocation working 1 time in 20, debugging by reading screenshots taken inside an agent's browser, and a page where registering too many tools switched the whole feature off with no warning.

## The metric

**Invocation rate** — of K frozen, realistic user utterances for a tool, the fraction that caused the agent to select *that* tool with valid arguments.

Reported only with a 95% Wilson score interval, the observed run-to-run spread across repeated runs, and the judge model and browser build that produced it. Agent behaviour is non-deterministic, so a bare percentage with no variance figure is not a measurement.

Every trial lands in exactly one bucket — `not_supported`, `not_registered`, `not_discovered`, `not_selected`, `wrong_tool`, `bad_args`, `exec_error`, `silent_fail`, `ok` — because the useful information is *which* way it failed. "Ignored" means your description is weak; "wrong tool" means two names collide; "bad args" means your schema is off. From the outside today, all three look identical.

## What gets built

- **A static linter** — no browser, no model, no API key. Catches invalid tool names, colliding or ambiguous descriptions, over-parameterised schemas, and tool counts approaching the undocumented per-page budget.
- **The harness** — drives real browsers over the Chrome DevTools Protocol, fires the utterance set at the page's registered tools, classifies every outcome, and emits a JSON report plus a CI gate.
- **A public dataset** — the cross-client compatibility record and invocation-rate corpus, regenerated as browsers change, published with the code that produced every number.

## Documentation

- [`docs/concept.md`](docs/concept.md) — the full design: metric definition, two-mode measurement, build layers, verified landscape research with sources
- [`docs/explainer.md`](docs/explainer.md) — the same idea in plain language, no jargon
- [`docs/getting-started.md`](docs/getting-started.md) — environment, first steps, the measurement pipeline, decision gates
- [`PROJECT-LOG.md`](PROJECT-LOG.md) — append-only record of what changed, why, and how it was verified

## Licence

MIT. See [`LICENSE`](LICENSE).
