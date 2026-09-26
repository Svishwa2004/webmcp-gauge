# webmcp-gauge

Measures whether an AI agent actually calls the tools your web page exposes through WebMCP.

**Status: measuring, and the metric discriminates.** The harness runs end to end and has produced real numbers against a live page. It launches its own browser per session — a cold profile seeded with the WebMCP flag, in headless Chrome — captures the settled tool manifest, asks a judge model which tool to call, classifies the choice, executes it, and classifies the result. The utterance set is frozen at `1.3.0` (140 utterances plus 20 negative controls), and sixteen runs totalling **4,500 trials** are published under [`reports/`](reports/) — the best isolated reference run being 960 trials across three separate processes, browsers and cold profiles, and a second client joining them: the same page, set and judge through Edge `153.0.4234.13` reads **99.3% (139/140)** with every tool inside or above its Chrome interval.

The question that mattered most has an answer. Every early number came from a page chosen for being well described, so the same frozen utterance set was fired at a deliberately mis-described twin of that page: one implementation, one dataset, several manifests, **1,320 trials at three isolated sessions per arm**. Clean manifest **99.3%**; degraded manifest **83.1%** overall, with `sum_by_category` at **60.0%** [47.4, 71.4] and `top_expenses` at **26.7%** [17.1, 39.0] against a clean 95.0% and 100%. Between-session σ is at most **0.094** where the effects are 0.35 and larger, so the gap is not noise.

Four ablations, each the clean manifest plus exactly one defect, then answered *which* defect — and the answer was **none of them alone**. Re-measured on 2026-09-05 with the arms finally nested inside one another: a vague description on its own costs **1.7 points**, an identically-described competitor tool on its own costs **nothing at all**, and the two together cost **46.7**. Both parts sit inside the harness's own between-session noise; only the combination is outside it, by five times. So the finding is not that defects add up faster than you expect — it is that **neither of these is a defect until the other one is present**, which is why a page cannot be triaged one finding at a time. Write-ups: [`decomposition-2026-09-05.md`](reports/decomposition-2026-09-05.md), [`pair-2026-09-05.md`](reports/pair-2026-09-05.md), [`ablation-2026-08-31.md`](reports/ablation-2026-08-31.md) and [`discrimination-2026-08-30.md`](reports/discrimination-2026-08-30.md), each scoring the predictions registered before its run, including the ones that were wrong.

Re-running one arm with its sessions **9 to 17 hours apart instead of minutes** then asked whether any of this survives a clock. The reproducibility figures do: between-session σ came back 0.085 worst-case against 0.062 back-to-back. Point estimates did not sit still — both mid-range tools declined monotonically across the 26-hour span, 8 to 12 points with overlapping intervals — so a single arm measured at one time is sound, while comparing a page against itself across days inherits a drift question. [`spacing-2026-09-01.md`](reports/spacing-2026-09-01.md).

What exists: `lint` (static manifest rules, no judge or key), `trial` (one utterance, one outcome), `run` (S isolated sessions × R repeats, Wilson intervals, control false-positive rate, stamped JSON and Markdown reports, plus a badge that refuses to report a rate it cannot stand behind), JSONL checkpointing with `--resume`, a CI gate with split exit codes where a crash is *"could not measure"* rather than a failing page, a [GitHub Action](action.yml) wrapping both modes, cohort-capture tooling that records what a builder shipped and what an agent can actually call as two separate numbers, private per-project scorecards, a served fixture page, a browser-side tool view so a client that drops a tool can be told from a page that never registered one, and a pre-push visibility gate with its own tested rules. **229 tests.** The findings live in the published report, [`reports/public-report-draft.md`](reports/public-report-draft.md): the invocation-rate result on two builds, the compatibility matrix, and the complete WebMCP Challenge census — **80.8% of reachable submissions register WebMCP tools, and 43.9% of pages carry tools an agent can call that no page surface lists**.

What does not: **a measurement inside a real assistant.** The *browser* in the ChatGPT desktop app is CDP-drivable and its WebMCP surface is documented here — but that assistant reads pages through a Chrome extension bridge into the user's ordinary Chrome, not through the app's own browser, so no agent-side invocation has been observed. Every number below is a judge-model stand-in for a real client, and whether the stand-in predicts it is still an open assumption.

Findings have gone back to the spec: two comments on [`webmcp#227`](https://github.com/webmachinelearning/webmcp/issues/227#issuecomment-5499568493) establish what Chrome 152 actually does across a frame boundary — a same-origin embed's tools join the host's manifest, a cross-origin embed is blocked by a Permissions Policy feature named `tools`, and once that is delegated the browser offers an agent a tool **no page can list**. The full compatibility record, including the cross-site case where even a host-attached browser-side view loses the embed entirely, is [`reports/compatibility-matrix.md`](reports/compatibility-matrix.md): 22 measured behaviours across four builds, each cell dated and traced to a re-runnable probe, with a standing Corrections section for the one finding that turned out to be this project's own bug.

## The problem

WebMCP lets a page register JavaScript functions as AI-callable tools. Registering them is the easy part. Finding out whether an agent ever *chooses* one, passes it sane arguments, and does so consistently across browsers that each implement the draft differently — that has no answer today. Tools fail silently: no error, no log, no receipt. Developers have reported invocation working 1 time in 20, debugging by reading screenshots taken inside an agent's browser, and a page where registering too many tools switched the whole feature off with no warning.

## The metric

**Invocation rate** — of K frozen, realistic user utterances for a tool, the fraction that caused the agent to select *that* tool with valid arguments.

Reported only with a 95% Wilson score interval, the observed run-to-run spread across repeated runs, and the judge model and browser build that produced it. Agent behaviour is non-deterministic, so a bare percentage with no variance figure is not a measurement.

Every trial lands in exactly one bucket — `not_supported`, `not_registered`, `not_discovered`, `not_selected`, `wrong_tool`, `bad_args`, `exec_error`, `silent_fail`, `ok` — because the useful information is *which* way it failed. "Ignored" means your description is weak; "wrong tool" means two names collide; "bad args" means your schema is off. From the outside today, all three look identical.

## What gets built

- **A static linter** — no browser needed to reason, no model, no API key. Fourteen rules across four families: invalid or colliding tool names, missing, thin, duplicate or near-duplicate descriptions, **a pair of close-named tools whose descriptions neither of them distinguishes** (adopted 2026-09-05 on measurement, after five arms showed that pattern costs 45 points while no similarity threshold catches it), over-parameterised and under-documented schemas, and tool counts approaching a per-page budget that is still unmeasured (the reported 296-tool figure does **not** reproduce on Chrome 152, where 507 registered tools were all accepted and surfaced). Thresholds are calibrated so the reference page — the one measured at 100% over 960 trials — lints clean, because a default that flags a manifest known to work is a broken default. *Built.*
- **The harness** — drives real browsers over the Chrome DevTools Protocol, fires the utterance set at the page's registered tools, classifies every outcome, and emits a JSON report plus a CI gate. Every trial reads the tool set **twice** — the page's own `getTools()` and the browser's `WebMCP.toolsAdded` stream — because "the page never registered it" and "the client dropped it" are indistinguishable from inside the page. *Built.*
- **A public dataset** — the cross-client compatibility record and invocation-rate corpus, regenerated as browsers change, published with the code that produced every number. *Thirteen runs so far, in `reports/` — including the four-build compatibility matrix and a second client for the rate.*

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

Install once from npm and every command runs as `webmcp-gauge …`; from a clone, `npm run gauge …` or `node bin/webmcp-gauge.mjs …` runs the same thing.

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

### Badge, and the one thing it refuses to do

Every `run` writes `badge.json` (Shields endpoint schema) and a self-contained `badge.svg` beside its report. Here are two, generated from real published runs of the same page behind two manifests:

![twin, clean manifest](reports/twin-clean-1.3.0-glm-5.3-s3r1.badge.svg) ![twin, degraded manifest](reports/twin-degraded-1.3.0-glm-5.3-s3r1.badge.svg)

A badge is a bare number in a coloured pill — the exact thing this project refuses to publish. That is not resolved by styling it, but by making it unable to overstate:

- **an incomplete run shows `incomplete`, never a rate**, because a rate over a denominator the run did not choose is the wrong number however it is coloured — the same rule that makes exit `2` outrank exit `1`;
- **a report with no `coverage` block shows `coverage unknown`**, since schema 2 predates coverage and its absence means unknown rather than complete. The 960-trial reference run is schema 2, so its badge reads ![airlock, schema 2](reports/airlock-1.3.0-glm-5.3-s3r2.badge.svg) rather than the 99% it would otherwise claim;
- **`n` travels with the rate**, so 100% of twenty cannot pass for 100% of a thousand.

### GitHub Action

[`action.yml`](action.yml) wraps both modes. `lint` needs no browser flag, no judge and no key, so it can run on every push; `run` spends a model call per trial and belongs on a schedule or a manual dispatch.

```yaml
- uses: Svishwa2004/webmcp-gauge@main
  with:
    mode: lint
    url: https://your-page.example
    fail-on: error

- uses: Svishwa2004/webmcp-gauge@main
  with:
    mode: run
    url: https://your-page.example
    fail-under: '0.9'
    judge: ${{ vars.JUDGE_MODEL }}
    base-url: ${{ vars.JUDGE_BASE_URL }}
  env:
    WEBMCP_GAUGE_JUDGE_API_KEY: ${{ secrets.JUDGE_API_KEY }}
```

The action annotates exit `2` as *could not measure* rather than as a regression, because a workflow that treats a provider outage as a failing page will eventually block a merge for the wrong reason. [`.github/workflows/webmcp-gauge.yml`](.github/workflows/webmcp-gauge.yml) runs it against this repo's own deliberately mis-described fixture, and **fails if the degraded twin ever lints clean** — a linter that quietly stops flagging things is the failure mode a self-test has to catch.

## Documentation

- [`docs/concept.md`](docs/concept.md) — the full design: metric definition, two-mode measurement, build layers, verified landscape research with sources
- [`docs/explainer.md`](docs/explainer.md) — the same idea in plain language, no jargon
- [`docs/getting-started.md`](docs/getting-started.md) — environment, first steps, the measurement pipeline, decision gates
- [`PROJECT-LOG.md`](PROJECT-LOG.md) — append-only record of what changed, why, and how it was verified

## Licence

MIT. See [`LICENSE`](LICENSE).
