# webmcp-gauge — Concept Document

**Name:** `webmcp-gauge` — settled 2026-08-29. Repo: https://github.com/Svishwa2004/webmcp-gauge
**Status:** Concept, pre-implementation
**Written:** 2026-08-29
**Scope:** A measurement layer for WebMCP page tools — the answer to "does an agent actually call my tool?"

---

## 1. The idea in one paragraph

WebMCP lets a web page register JavaScript functions as AI-callable tools. The hard part is not registering them — it is finding out whether an agent ever *chooses* them, passes them sane arguments, and does so consistently across browsers that all implement the draft differently. Today nobody can answer that question about their own site. webmcp-gauge answers it: a CLI and harness that fires a frozen set of realistic user utterances at a page's registered tools inside real browsers, classifies every outcome, and reports a single defensible number — **invocation rate**, with a confidence interval and a run-to-run variance figure — per tool, per client. The by-product of running it continuously is the thing nobody currently has: a reproducible, public record of which WebMCP behaviours actually work in which client, at which version.

The product is a diagnostic. The durable asset is the dataset.

---

## 2. Why this, why now

Every fact in this table was verified on 2026-08-29. Sources in [Appendix A](#appendix-a-sources).

| Signal | State | Consequence for this project |
|---|---|---|
| Spec status | W3C Web Machine Learning **Community Group** draft, dated 2026-08-26. Entry point `document.modelContext`. 108 open issues, 3,520 stars, 13 commits in the last 4 weeks. | Unsettled and actively churning. Measurement gets *more* valuable as it churns. |
| Recent breaking changes | `executeTool()` now takes an object, not a JSON string (#246, 2026-08-17). `inputSchema` `DOMString`→`object` (#241, 2026-08-14). `annotations` moved to its own object (#225, 2026-07-21). Namespace moved in Chrome 150 (#266). | Every one of these is a compatibility-matrix row that no one is publishing. |
| Live repositioning debate | Issue #236 (opened 2026-08-05, active 2026-08-27) proposes recasting WebMCP as generic RPC; `modelContext`→`toolContext` and `executeTool`→`callTool` are on the table. No decision taken. | Do not couple the product's core value to the API's spelling. |
| Chrome | Origin trial **149→156**. TAG, privacy and security reviews **pending**. **No ship milestone.** Stable Chrome is 153. | The window is open but provisional. |
| Edge | Origin trial in 150, **expires 2026-11-17**. | A hard date that every WebMCP developer needs to know and no one is tracking. |
| Safari / WebKit | Formally **opposed** (2026-06-11) on privacy, security, duplication and API-design grounds. | Existential risk to the standard. Design for portability. |
| Firefox / Mozilla | **Neutral** (2026-08-05). | No help, no obstruction. |
| Confirmed consumer agents | **ChatGPT desktop's in-app browser only**, and it implements a *subset* — no declarative API, no iframe tool discovery. Gemini-in-Chrome invocation could not be confirmed from a Google primary source. | The "cross-client matrix" is currently a very short matrix, which is exactly why the divergences matter so much. |
| Real-world adoption | An independent scan of 111,076 of the top 200,000 sites (2026-05-28) found **zero** WebMCP implementations. | There is no paying market in 2026. The currency is position and credibility, not revenue. |
| Developer population | ~3,745 people registered for the WebMCP Challenge; ~176 projects visible via Devpost's global search. That is, plausibly, most of the world's WebMCP developers, in one place, at one moment. | A one-time, expiring distribution and dataset opportunity. |

**The strategic read.** Three things are scarce right now: reliable evidence, a maintained compatibility record, and credibility inside a community small enough to have named gatekeepers. Three things are not scarce: registries (webmcp.com has 365 sites, plus two rivals and four competing awesome-lists), React hooks (there is an official one), and opinions. Build for the scarce column.

---

## 3. The problem, in developers' own words

Ranked by how often it is actually said, with primary sources.

**1. Tools register, and the agent never calls them.** This is the dominant complaint.

> "Even after doing everything fine in terms of WebMCP APIs (Declarative and Imperative), I got it to work with Chrome's Ask Gemini agent only 1 / 20 times… the same experience was with the recommended demos from Google as well."
> — r/webmcp, 2026-04-01

Independently corroborated: a developer instrumenting a real deployment concluded "a tool visible in a browser is not necessarily discovered or invoked by the agentic product" (dev.to, 2026-08-22). Spec issue **#268** (2026-08-28) reports tools working in Brave 1.94 but not Chrome 152.0.7977.65 or Edge 151 — **still unresolved**.

**2. Silent failure, zero debuggability.**

> "ChatGPT's `modelContext` turned out to be a frozen object implementing only `registerTool`, so the bridge's batch registration call threw without a trace… I debugged all of this blind, with an on-page diagnostic badge, reading screenshots taken from inside ChatGPT's browser because that was the only ground truth available."
> — Respira engineering write-up, 2026-08-28

Spec issue **#253** ("Add `debugging` member to ToolAnnotations", 2026-08-21) is the standards-side echo of the same complaint. A tool name containing a space fails silently with no feedback (**#145**).

**3. An undocumented per-page tool budget.**

> "Registering the full catalog of 296 tools disabled WebMCP for the page entirely. No error, no warning. Agent browsers have a per-page tool budget."

Open issues **#255** (tool collections with progressive disclosure), **#256**, **#73**, **#88**, **#167** all circle this. Nobody has published what the budget actually is, in any client.

**4. Setup friction and client fragmentation.** Testing requires `chrome://flags/#enable-webmcp-testing`, an origin-trial token, or the ChatGPT desktop app. Behaviour differs per client, and the differences are undocumented.

**5. State desync and spec churn with no versioning story.**

> "It forces developers into manual state-synchronization hell… The API makes no considerations for API versioning, so any WebMCP tools you write are carved in stone."
> — Hacker News, 2026-08-26

**6. Agents free-ride on user identity, and the safety hints are not safety.** `readOnlyHint` and `untrustedContentHint` are annotations, not enforcement. Spec issues **#154** (threat modelling), **#159**, **#257**.

**7. Documentation without an on-ramp.** "There's no code! … It has no on-ramps for developers" (Hacker News, 2026-03-01).

Note that pains 1 and 2 are the same pain wearing two hats: **the developer has no ground truth**. That is the wedge.

---

## 4. The core insight

Measurement splits cleanly into two modes, and conflating them is why nothing credible exists yet.

**Mode A — harness mode (we act as the agent).** Read the page's tool manifest over CDP, hand it plus one user utterance to a model of our choosing, observe which tool the model selects and with what arguments, then execute the selection against the page and observe the effect. Cheap, scriptable, fully reproducible, model-pinned, runnable on every commit. It measures **tool-description and schema quality** — precisely the part the developer controls and can fix.

**Mode B — client mode (the real shipping product acts as the agent).** Drive the actual ChatGPT in-app browser, Chrome's built-in agent, Edge, Brave. Expensive, partly manual, non-deterministic, but it is the only thing that measures **what actually happens to users**.

The product thesis is a falsifiable empirical claim:

> **Mode A predicts Mode B well enough to gate a CI build.**

If that correlation holds, developers get a fast, cheap, deterministic signal they can run on every commit, calibrated weekly against reality. If it does not hold, that is itself a publishable finding about agent browsers — and the honest version of this project reports that instead of hiding it. Either outcome produces something worth reading; that asymmetry is what makes this worth starting.

Establishing the correlation is Milestone 3 and it is the intellectual core of the whole thing.

---

## 5. The metric

### 5.1 Invocation rate

For a page *P*, a registered tool *t*, an agent client *C*, and a **frozen, versioned set of K user utterances** *U(t)* that a reasonable person might type to accomplish *t*:

```
invocation_rate(t, C) = |{ u ∈ U(t) : outcome(u, t, C) = ok }| / K
```

Every trial runs in a fresh page context and lands in exactly one bucket:

| Outcome | Meaning | Who owns the fix |
|---|---|---|
| `not_supported` | No `document.modelContext` in this client | Nobody — record and move on |
| `not_registered` | The page never registered the tool (bug, or budget exceeded) | Page author |
| `not_discovered` | Registered, but absent from the agent's tool list | Client or page — the interesting case. **Reachable since 2026-08-31** and **never observed on Chrome 152**: see the note under the taxonomy |
| `not_selected` | Discovered; the agent answered without calling any tool | **Description quality** |
| `wrong_tool` | Called a different tool | **Naming / description collision** |
| `bad_args` | Right tool, arguments fail schema or expectation | **Schema design** |
| `exec_error` | `execute` threw | Page author |
| `silent_fail` | Call returned, but no observable state change | Page author |
| `ok` | Right tool, valid arguments, observable effect | — |

The taxonomy is the product. A single pass/fail tells a developer nothing; `not_selected` vs `bad_args` vs `not_discovered` tells them exactly which line to edit.

**`not_discovered` needs two views, and now has them.** Built 2026-08-31: the page's own `getTools()` says what the page believes it registered, and the CDP `WebMCP` domain's `toolsAdded` / `toolsRemoved` events say what the browser is prepared to offer an agent. Every trial records both and their difference in either direction. On Chrome `152.0.7977.65` the two **never disagreed** — 7, 71, 187, 307 and 507 registered tools all matched exactly, and a tool registered inside an iframe appeared in both (the top frame's `getTools()` folds subframe tools in, which also means an embed can add tools to its host's agent surface). So the outcome is reachable, the classifier fires it the moment a client drops a tool, and on this build it never has. A view the harness does not have is recorded as `null` rather than as an empty list: absent evidence must never read as `not_discovered`.

### 5.2 Reporting the number honestly

K is small and outcomes are binomial, so a bare percentage is not defensible. Every reported rate carries:

- a **95% Wilson score interval** (correct for small-*n* proportions, unlike the normal approximation),
- **two spreads, never merged** — σ **between sessions**, where each session is a separate OS process with its own browser and cold profile, and σ **within session**, where repeats share a warm page and one provider connection. Only the first speaks to reproducibility; the second is a floor. Conflating them is not a hypothetical: this project's first two sweeps reported the within-session figure, and a tool showed σ 0.000 while failing every repeat of one utterance, because identical failures collapse the spread to zero,
- the **judge model identifier and version**, because invocation rate is a property of *(page, client, model)* and not of the page alone,
- the **client build string** (browser version, OT token state, flag state), and what a session did *not* isolate — shared machine, shared network path, uncontrolled provider-side state, and whether sessions were spaced in time at all.

A report line reads:

```
summarise_spending   Chrome 153 / gemini-3-flash-preview
  invocation 0.35  95% CI [0.19, 0.55]  K=20  sessions=3 x repeats=2
  σ between sessions 0.04   σ within session 0.01
  not_selected 11  bad_args 2  ok 7
```

Run-to-run variance is the first thing a sceptic will attack, and rightly. Publishing it before anyone asks is the credibility play.

### 5.3 Secondary metrics

- **Control false-positive rate** — of *M* control utterances that **no** registered tool can serve (off-topic, out-of-scope writes and exports, injection-style instructions), the fraction that still caused a tool call. Without it invocation rate is unfalsifiable: an agent that fires something at every input scores 1.0 on a set where every utterance has a right answer. Reported with its own Wilson interval and never pooled with invocation rate, and broken out by control class, because an `injection` false positive is a safety finding while an `out_of_scope` one is an over-eager description. Airlock's set carries M=20 (5 off-topic, 13 out-of-scope, 2 injection).
- **Reachability** — `1 − (not_registered + not_discovered)/K`. Separates page-side registration failures from model-side selection failures. The single most useful diagnostic split, and computable since 2026-08-31: `not_discovered` needs the browser's own tool list, which every trial now records.
- **Argument fidelity** — exact and semantic match of extracted arguments against expectations.
- **Budget headroom** — register *N* synthetic tools alongside the real ones and search for the *N* at which discovery breaks. First measurement 2026-08-31 (`probes\webmcp-domain.mjs`, `?flood=N` on the fixture twin): **no break on Chrome 152 up to 507 tools** — all registered, all listed by `getTools()`, all surfaced by the browser, settle time 1.04 s → 1.30 s. So the 296-tool silent-disable anecdote is not this build, and `headroom` is still unknown rather than large: the number that matters is per client, and Edge and the ChatGPT in-app browser are unmeasured.
- **Cross-client divergence** — pairwise disagreement on the `ok` set between clients. Directly feeds spec issue #268.
- **Annotation efficacy** — does setting `readOnlyHint` or `untrustedContentHint` change observable agent behaviour *at all*? An experiment, not an opinion, on whether the spec's safety hints do anything.

### 5.4 Methodological rule that must not be broken

**The model that authors the utterance set must not be the model that is judged on it.** Otherwise the metric measures self-consistency, not usability. Utterances are human-reviewed, committed to the developer's repo as a frozen versioned file, and changed deliberately — never regenerated per run, or the numbers stop being comparable across commits. The authoring model is recorded inside the fixture so the constraint is checkable rather than remembered: Airlock's set (`fixtures/airlock.utterances.json`, frozen at `1.3.0` on 2026-08-30) was authored by `deepseek v4 by agentrouter`, which is therefore disqualified as a judge for those numbers, and the CLI refuses to run when the two match.

Measured consequence of the same rule, 2026-08-31: some part of every rate is the *set's* opinion about which tool should have been chosen. `sum_by_category-12` fails 12 of 12 trials across four different manifests — including two carrying the reference description — because its expected tool is contestable, not because any page is wrong. That is a property of the fixture, and it stays frozen until a revision decides otherwise.

---

## 6. What to build

Three layers, shipped in this order. Each is independently useful, which means each is independently abandonable.

### L0 — Static linter (no browser required)

```
webmcp-gauge lint --url https://…                              # live page
webmcp-gauge lint --manifest ./tools.json                       # declared manifest
webmcp-gauge lint --serve fixtures/broken --url twin.html       # a local fixture
```

**Built 2026-08-30.** Thirteen rules in four families, in `core/lint.mjs`, over one input: the manifest. Exit `0` clean, `1` findings at or above `--fail-on` (default `error`), `2` nothing to lint — no WebMCP surface, an unsettled tool set, or zero tools.

| Family | Rules |
|---|---|
| names | `name/invalid-characters` · `name/too-long` · `name/duplicate` |
| descriptions | `description/missing` · `description/thin` · `description/duplicate` · `description/near-duplicate` |
| schemas | `schema/not-object` · `schema/required-without-description` · `schema/over-parameterised` · `schema/undocumented-property` · `schema/missing-type` |
| budget | `budget/headroom` |

Two design decisions carry the weight:

**Thresholds are calibrated, not invented.** The reference page has a measured invocation rate — 100% [96.9%, 100.0%] on five tools over 960 trials, 99.2% on the sixth — so the defaults are set where that page lints clean: descriptions ≥ 60 characters (its thinnest is 76), ≤ 6 schema properties (its largest tool has exactly 6), near-duplicate at 70% token overlap, budget warning at 64 tools. A default that flags a manifest known to work is a broken default, and every threshold is a flag. The budget rule is the one that had to be corrected by measurement: it fired as an *error* at the reported 296 tools until 2026-08-31, when 507 tools on Chrome 152 were all accepted and surfaced. It is a warning at both levels now, and says which build was measured.

**What the linter cannot tell you, and the ablations proved it.** A rule that costs 5 points alone can cost 35 in company: a near-duplicate description and a duplicate competitor tool are each nearly free on their own and together take `sum_by_category` from 95.0% to 60.0%. So severity is a property of the rule, not a prediction of the cost, and the linter says so rather than ranking findings by an impact it cannot know.

**A live manifest is not what the page declared.** Measured on Chrome `152.0.7977.65` (2026-08-30): `registerTool` **throws `"Invalid tool name"`** for a name containing a space, so #145's "silently does nothing" is not this build's behaviour — and the worst names can never appear in `getTools()`. They show up instead as a tool that is missing, which the harness scores `not_registered`. `--manifest` therefore lints what the source declares, and the live mode lints what the browser returns; both are needed and they answer different questions.

What it deliberately does not do: rewrite descriptions, score "quality" on a scale, or claim a flagged manifest will invoke badly. That last claim belongs to L1, which measures it.

Still not covered: `execute` handlers that close over stale snapshots, and missing `annotations` on obviously mutating tools — both need source analysis rather than a manifest, and the second cannot be decided from the manifest at all.

### L1 — The harness

```
npx webmcp-gauge run https://example.com --utterances ./webmcp-gauge.utterances.json \
    --clients chrome-ot,chatgpt,edge,brave --k 20 --repeat 3
npx webmcp-gauge budget https://example.com          # headroom probe — not built; today it is probes\webmcp-domain.mjs against ?flood=N on an own fixture
npx webmcp-gauge compare base.json head.json         # regression diff — not built; today it is probes\compare-arms.mjs over report.json files
```

**Architecture** — Node ESM, no framework, provider-agnostic by design. What exists today is marked; the rest is the sketch:

```
webmcp-gauge/
  bin/            CLI entry — trial | run | session | lint          [built]
  core/           taxonomy, Wilson intervals, sweep, orchestrator,
                  CI gate, L0 linter                                [built]
  browser/        Chrome launch, CDP session, WebMCP page + browser
                  views, fixture file server                        [built]
  fixtures/       frozen utterance sets + the degraded twin page    [built]
  probes/         one-off measurements: launch, manifest, WebMCP
                  domain, arm comparison                            [built]
  scripts/        scheduled-run glue for time-spaced sessions       [built]
  report/         JSON + Markdown emitters                          [built]
  clients/        chrome-ot | chatgpt | edge | brave adapters       [not built — chatgpt browser layer proven 2026-09-01, see probes/]
  judges/         model adapters behind one interface               [one: OpenAI-compatible]
  action/         GitHub Action wrapper + badge SVG                 [not built]
```

**Mechanics, grounded in what already works locally** (see [Appendix B](#appendix-b-local-assets-already-in-hand)):

1. Launch Chrome with a dedicated profile and `--remote-debugging-port`, WebMCP enabled by flag or OT token. **Measured 2026-08-30:** a brand-new `user-data-dir` whose `Local State` contains only `{"browser":{"enabled_labs_experiments":["enable-webmcp-testing@1"]}}` is sufficient, and it works under `--headless=new` — so the harness launches and tears down its own browser per session, every session gets a cold cache, and a CI gate is possible. A clean baseline profile also exists at `_spike/chrome-baseline` for interactive probing.
2. `WebMCP.enable` and the `toolsAdded` event give discovery ground truth straight from the browser, independent of any page instrumentation.
3. `Runtime.evaluate` drives `document.modelContext.getTools()` and `executeTool()` — **note the live signature divergence, now measured rather than inferred (2026-08-30, Chrome `152.0.7977.65`)**: `getTools()` resolves a `Promise`, so every read must be awaited, and `executeTool` accepts **`executeTool(registeredTool, jsonString)`** — the object handed back by `getTools()` plus a JSON *string*. The draft's `{name, arguments}` object (#246, 2026-08-17) is rejected with "2 arguments required, but only 1 present", and passing the tool's name as a string is rejected with "The provided value is not of type 'RegisteredTool'". Neither the draft nor the type surface verified against Chrome 151 describes this shape. This is compatibility-matrix row one, and it was available on day one.
4. The judge adapter receives the manifest plus one utterance and returns a tool choice with arguments. Swapping judges must be a flag, never a rewrite — the metric is model-relative, so pinning and reporting the judge is mandatory.
5. Execute the selection, observe page state, classify into the taxonomy, emit.
6. Gate: `--fail-under <rate>` compares each tool's point rate against the threshold and exits **1** on a breach, while **2** is reserved for a run that could not measure its whole plan. An outage and a regression must never produce the same signal, and completeness is derived from the plan against the checkpoint rather than from a failure log a dead session never wrote to.

**Client-mode caveat.** Chrome, Edge and Brave are CDP-drivable, and **so is the ChatGPT desktop app's built-in browser** — measured 2026-09-01, correcting the guess that stood here before: the app ships as the `OpenAI.Codex` MSIX (a Chromium 151 fork) and honours `--remote-debugging-port`, with `--enable-blink-features=WebMCPTesting` needed to expose `modelContext`. So the *browser* half of that column is automated rather than sampled. The *agent* half is not: nothing in the app exposes "make ChatGPT choose a tool now", so an end-to-end client trial is either driven through the app's own UI or sampled through guided manual runs, and the report must say which. See [Open question 1](#14-open-questions).

### Mode B, as designed on 2026-09-01: browser-automated, agent-observed

The obvious sampled design — a human runs prompts and writes down what happened — is the one this project should *not* use, because the observation is the weakest part of it. There is a better one, and it exists because of a measured fact: **the browser announces every tool invocation over CDP, with the tool name and the arguments.** `WebMCP.toolInvoked` carries `{toolName, frameId, invocationId, input}` and `WebMCP.toolResponded` carries `{invocationId, status, output}` (verified on both Chromium 151 and Chrome 152, 2026-09-01). A CDP client attached to the ChatGPT desktop browser is therefore a **passive recorder of ground truth** while a human drives the agent.

That splits the column cleanly:

| Layer | How | Status |
|---|---|---|
| Page under test | Opened in the app's own browser over CDP | **automated** |
| Manifest capture | `getTools()` + the browser's `toolsAdded` stream, same as Mode A | **automated** |
| Utterance delivery | A human types it into the ChatGPT composer, verbatim, one per fresh chat | **manual** |
| Outcome capture | `WebMCP.toolInvoked` / `toolResponded` recorded over CDP | **automated** |
| Classification | The same nine-bucket taxonomy `core/taxonomy.mjs` already applies | **automated** |

Only the typing is human, so the failure mode of manual measurement — a person deciding what they think happened — is designed out.

**Sample design: divergence detection, not rate estimation.** A manual arm cannot produce an invocation rate anyone should quote; at K=5 per tool a perfect 5 of 5 still carries a Wilson interval of roughly [56%, 100%]. Gate 3 does not need a rate — it needs to know whether the cheap loop *resembles* the real client. So the sample is **stratified by what Mode A already predicts**: utterances it passes at ≥95% against utterances it fails at ≤35%. If the real client agrees on both strata, the cheap loop is predictive at the coarse level and a fuller arm is justified. If the client passes the ones Mode A fails, the judge stand-in is the problem, and *that* is the deliverable — Gate 3 says so already.

⚠️ **The stratified sample cannot be drawn from a good page**, which was found by trying to build it from real trials on 2026-09-01. On the clean twin, 139 of 160 utterances pass at ≥95% and **exactly one** falls at ≤35% (`sum_by_category-12`, the set's known floor) — there is no failing stratum to sample, because that is what a well-described manifest means. Both strata exist only on the **degraded** twin: 107 pass and 23 fail on the published arm, with 12 of those failing in two independent arms. So a sampled session runs against the degraded twin, where Mode A makes both kinds of prediction about **one page** and only the utterance varies. Running the pass stratum on a clean page and the fail stratum on a degraded one would confound subject with prediction.

**Labelling rules, non-negotiable.** A sampled arm carries `mode: "B-sampled"`, the operator's name, the client build string, the ChatGPT model id shown in the UI at the time, the date, and its `n`. It is never pooled with Mode A trials, never printed as an invocation rate, and never fed to `--fail-under`. A number that cannot be regenerated by someone else is evidence about a client, not a measurement of a page.

⚠️ **The assumption above was tested on 2026-09-01 and it is false.** The design said the first sampled session would also be the test of its own instrument; it was, and the instrument failed in a way no amount of reasoning would have caught. Two utterances were delivered to the real signed-in agent with the subject page open in a tab of the app's **own** browser, opened over CDP. No `toolInvoked` arrived, and the page did not change — because the agent never saw that tab. The app annotates its own context with a line reading:

> `Chrome tabs: The user has the Chrome extension side panel open. Current URL: …`

The agent's page view is a **Chrome extension bridge into the user's ordinary Chrome**, not the Chromium instance the desktop app runs in. A tab opened in the app's browser over CDP is invisible to it, so no tool choice was possible and neither observation is a measurement of anything. Both were recorded as `unmeasurable` with that reason, and the first one — taken before the probe could tell "delivery failed" from "agent declined" — was discarded rather than kept as a null result.

**What the corrected surface has to be:** the subject page open in the *user's* Chrome, with the ChatGPT extension side panel attached to it, and the recorder attached to **that** Chrome rather than to the app. The recording mechanism itself is unaffected — `WebMCP.toolInvoked` still carries `{toolName, input}` — but it must be subscribed on the browser the extension is bridging, which is a signed-in profile this project does not own. That is a setup question for the operator, not a code change, and it is where item 9 now stands.

### L2 — The public dataset

The compatibility matrix and invocation-rate corpus, regenerated on every Chrome/Edge/ChatGPT release, published open with the harness that produced it so anyone can re-run it. Contents: which API shapes work in which build, measured tool budgets, annotation efficacy, divergence pairs, and aggregate invocation rates across a real cohort of sites.

This is the part that gets cited, and being cited is the actual objective.

---

## 7. How this helps WebMCP as a standard

The Web Machine Learning CG is arguing about real questions with almost no field data. Every open issue below is a place where a reproducible measurement is worth more than another opinion, and each is a concrete, low-cost contribution route for an unknown newcomer.

| Open issue | What it needs | What the harness produces |
|---|---|---|
| **#268** — works in Brave, not Chrome/Edge | Reproduction across builds | A scripted, re-runnable divergence report with exact build strings |
| **#253** — `debugging` member on ToolAnnotations | Evidence of what developers cannot see | The outcome taxonomy *is* the list of states currently invisible to page authors |
| **#255 / #256 / #73 / #88 / #167** — tool collections, progressive disclosure, budgets | Actual budget numbers | Measured `headroom` per client, instead of one 296-tool anecdote |
| **#154 / #159 / #257** — threat modelling, safety hints | Whether hints affect behaviour | The annotation-efficacy experiment: does `readOnlyHint` observably change anything? |
| **#236** — reposition as generic RPC? | Whether "tool" framing yields good selection | Selection-rate data on identical functionality with different naming and framing |
| WPT coverage | Executable tests for prose-only behaviours | Harness assertions convert directly into web-platform-tests |

There is a second-order benefit to the standard that matters more than any single issue: **if WebMCP tools statistically do not get called, the standard has a design problem, and it is better for everyone that this surfaces now, in public, with numbers.** A measurement layer is how a young standard finds out whether it works. Nobody currently occupies that role.

---

## 8. How this helps other developers

| Today | With webmcp-gauge |
|---|---|
| Ship tools and hope; discover from a screenshot that nothing fires | A number before shipping, and the specific reason it is low |
| "The agent ignored my tool" — no idea whether it is the name, the description, the schema, or the browser | `not_discovered` vs `not_selected` vs `wrong_tool` vs `bad_args` points at the line to edit |
| Reword a description, re-test manually, cannot tell noise from improvement | `compare base head` with confidence intervals — improvement or not, with a variance floor |
| Silently exceed an undocumented tool budget and disable WebMCP for the whole page | `budget` reports headroom before it breaks |
| Discover a client divergence in production | Matrix says which clients agree, at which builds |
| Debug inside ChatGPT's browser by reading screenshots | An outcome record per trial, including what the model actually sent |
| Guess when the origin trial expires and the ground shifts | A tracked, dated compatibility record (Edge OT ends 2026-11-17; Chrome OT runs to 156) |
| A refactor silently degrades agent usability, forever unnoticed | CI fails the PR |

The framing that matters to a working developer: **WebMCP is currently the only web API with no test story.** You cannot unit-test whether a model likes your description. This supplies the missing half of the loop.

---

## 9. What already exists, and how this differs

Verified 2026-08-29. Building any of the left column again would be waste.

| Existing | What it is | Relationship |
|---|---|---|
| `GoogleChromeLabs/webmcp-tools` (531★) — inspector, polyfill, studio, **evals CLI** | Official, free, local | **Wrap and cite, never duplicate.** Competing head-on with a free first-party tool is a losing frame. The differences are the cross-client matrix, statistical rigour, CI gating and a public dataset — none of which it does. |
| Model Context Tool Inspector extension (107★) | Manual, interactive, one tool at a time | Complement. Manual inspection ≠ repeatable measurement. |
| `@mcp-b/*` runtime — polyfill at 51.3k weekly downloads | The de-facto runtime | Dependency and test target, not a competitor. |
| `webmcp-types` (17.6k weekly) | Types only | Use it. |
| WindTunnel benchmark (nekuda) | One-off WebMCP-vs-alternatives comparison, self-reported, unaudited | Nearest neighbour. Differs by being continuous, reproducible, per-site, and independently re-runnable rather than a single vendor claim. |
| webmcp.com (365 sites), webmcp-registry.dev, webmcp.today, 4 awesome-lists | Directories, all self-submission | Crowded, low moat. **Not building this.** Consume them as a site list. |
| web-mcp.net | The only SaaS claiming lifecycle coverage incl. agent analytics — but waitlisted, dashboards showing sample data, no named operator, references a package that does not exist | The position is claimed rhetorically and unoccupied in practice. |
| OpenAI Apps SDK | Different surface, same integration budget | The genuine substitute. Reason to keep the metric portable beyond WebMCP. |

---

## 10. Non-goals

- **No registry, directory or awesome-list.** Solved four times over.
- **No React hook.** There is an official one.
- **No billing, pricing page or paid tier in 2026.** Adoption is measurably ~zero; there is nobody to charge. Building checkout would be theatre.
- **No hosted dashboard in v1.** CLI plus committed JSON reports first. A dashboard is a distribution decision to make after the metric is proven, not before.
- **No reimplementation of `webmcp-evals`.** Wrap it.
- **No scraping of anything not publicly published**, and no republishing of other people's source. Derived metrics and links only.

---

## 11. Milestones

| # | Window | Deliverable | Done when |
|---|---|---|---|
| ~~1~~ | Aug 29–31 | ✅ **Done, exceeded** — Harness v0, Mode A only | An invocation-rate number **with a measured run-to-run variance**. If σ swamps the signal, stop and rethink — this is the go/no-go gate. Cleared 2026-08-30 on between-session σ; 4,040 trials published since |
| ~~2~~ | Sep 1 | ✅ **Done 2026-08-30, early** — L0 linter, standalone | Flags all documented silent-failure modes on a deliberately broken fixture page |
| 3 | Sep 1–3 | 🟡 **Part done** — Mode B adapters + Mode A↔B correlation study + GitHub Action | Correlation quantified either way; #268 reproduced or refuted; a build fails on regression. **#268 refuted** and the Mode B *browser* layer driven (2026-09-01); the agent layer, the correlation study and the Action remain |
| 4 | by Sep 3, runs Sep 4 | ⚠️ **Not started — date-locked** — Cohort snapshot script, staged and ready | Captures tool manifests, schemas, descriptions and URL liveness across the published Challenge gallery the day it appears |
| 5 | Sep 4–21 | Private per-builder scorecards; aggregate-only public stats; spec-issue data contributions | At least one reproducible data contribution filed on a live spec issue |
| 6 | Sep 23+ | Public report + open dataset + harness release | Published with the code that produced every number |

**Milestone 4 is time-critical and cannot be recovered later.** The Devpost gallery was still unpublished as of 2026-08-29 and opens with judging. Those ~165 live demo URLs sit on free hosting tiers; within a few months a large share will 404. A snapshot of that many real `registerTool` implementations, taken on the one day they are all simultaneously live, is not reconstructible after the fact. It is the largest corpus of real-world WebMCP code that will ever exist for this period, and capturing it costs one day of scripting.

---

## 12. Ethics and publishing policy

Decided, not open for drift:

- **Private during judging, aggregate after.** Each builder receives only their own scorecard. Public output during Sep 4–21 is aggregate-only, with no per-project rankings. Per-project detail waits until after winners are announced on ~Sep 23.
- **Conflict of interest disclosed.** The author submitted an entry (Airlock) to the same Challenge. Any published measurement of the cohort states this plainly, and Airlock's own numbers are reported alongside everyone else's with no special handling.
- **Respect the commons.** Honour `robots.txt`, rate-limit hard, identify the harness in the user agent, honour opt-out on request without argument.
- **Derived metrics and links only.** Never republish another project's source or assets.
- **No implied endorsement.** A scorecard is a diagnostic, not a verdict, and must not be presented in a way that could read as influencing judges.

---

## 13. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| The standard does not ship. WebKit opposed, Mozilla neutral, no Chrome ship milestone, TAG review pending. The AMP comparison is being made in public and is not unfair. | High | Keep the metric client- and API-agnostic. "Did the agent invoke the affordance I exposed, and with what arguments?" applies unchanged to the Apps SDK, Playwright-MCP and browser agents generally. The harness must survive the standard. |
| #236 renames the API out from under everything | Medium | A thin compatibility layer isolates spelling. Renames become dataset rows, not rewrites. |
| Non-determinism makes the numbers meaningless | High | Wilson intervals, R repeated runs, published σ, pinned judge model and build strings, frozen utterance sets. If variance swamps signal at Milestone 1, the project stops there rather than shipping a number that cannot survive scrutiny. |
| Overlap with Google's free official evals CLI | Medium | Wrap and cite it. Differentiate on cross-client matrix, statistics, CI gating and the public dataset. |
| ~~ChatGPT in-app browser may not be automatable~~ | Medium | ✅ **Retired 2026-09-01 — it is automatable.** CDP attach works on the `OpenAI.Codex` MSIX with `--enable-blink-features=WebMCPTesting`. The residual risk moved rather than vanished: the *agent* layer has no automation surface, so that column is browser-automated + agent-sampled, and must be reported as such — never as a fully automated client trial. |
| Model-call cost across clients × K × R × cohort size | Medium | Hard budget ceiling per sweep; cheap judge for CI mode, stronger judge for calibration runs only. |
| No revenue in 2026 | Accepted | This is a positioning investment. Stated plainly rather than dressed up as a business. |
| Name collision — "Airlock" already collides with three unrelated products | Low | ✅ Resolved for this project: `webmcp-gauge` was checked against npm and GitHub before the repo existed, and no ecosystem project or hackathon entry uses the name. |
| Measuring other people's entries reads as competitive | Medium | Section 12, applied literally. |

---

## 14. Open questions

Unresolved, and each is answerable with a small spike:

1. ~~**Can the ChatGPT desktop in-app browser be driven programmatically at all?**~~ **Resolved 2026-09-01 by direct measurement: yes.** The desktop app ships as the `OpenAI.Codex` MSIX (Chromium 151, `CodexBrowser` UA prefix, entry point `ChatGPT.exe`) and honours `--remote-debugging-port` — CDP attach works, full protocol 1.3. Three measured facts: the `WebMCP` CDP domain **exists but is not advertised** in `/json/protocol` (57 domains listed, none model-named; `WebMCP.enable` accepted while a bogus domain was rejected with `-32601`); `document.modelContext` is absent until the app is launched with **`--enable-blink-features=WebMCPTesting`** (Local State labs entries do nothing — `enable-webmcp-testing@1`, `WebMCPTesting@1` and `WebMCP@1` were all tried and were inert), and with that switch the reference page's 7 tools read back settled, `inputSchema` as a JSON string like Chrome 152; and this build exposes modelContext on **both** `document` and `navigator` where Chrome 152 has only `document`. Caveat that bounds the finding: driving the *shell's* tabs over CDP is not driving the *in-app agent's* own browsing session — `learn.chatgpt.com/docs/webmcp` names ChatGPT Work and Codex as the agents that consume site tools — so Mode B's ChatGPT column is automatable at the browser layer, and the agent layer remains sampled or driven through the app's own UI. Probe: `probes/chatgpt-browser-probe.mjs`.
2. **Does Gemini-in-Chrome actually invoke page tools today?** Google-sourced coverage says "will soon"; Chrome docs distinguish the Inspector from the Gemini feature. Not confirmable from a primary source.
3. ~~**Was `navigator.modelContext` formally deprecated in 150 and removed in 152?**~~ **Resolved 2026-08-30 by direct measurement:** on Chrome `152.0.7977.65` with `#enable-webmcp-testing` enabled, `'modelContext' in navigator` → `false`. The name is gone; only `document.modelContext` exists. Two related facts came out of the same probe and are load-bearing for the harness: **`getTools()` returns a `Promise`**, not an array, and the browser exposes a **`WebMCP` CDP domain** (`enable`, `disable`, `invokeTool`, `cancelInvocation`; `toolsAdded`, `toolsRemoved`, `toolInvoked`, `toolResponded`) — note `invokeTool` where the page API says `executeTool`.
4. **What is the actual per-page tool budget**, per client? ⚠️ **Partly answered for Chrome 152, and the anecdote does not reproduce.** Measured 2026-08-31 against a fixture registering synthetic tools: at 71, 187, 307 and **507** tools, every one was accepted, listed by `getTools()` and surfaced by the browser's own `WebMCP` domain — no silent disable, no truncation, and settle time rose only from 1.04 s to 1.30 s. The 296-tool report therefore describes another client or an older build, not this one. Still open for Edge and for the ChatGPT in-app browser, which is where a budget would actually bite — and as of 2026-09-01 that client is **reachable** for the measurement (open question 1's launch recipe), so this is now a run nobody has done rather than a client nobody can touch.
5. **Will Edge renew its origin trial after 2026-11-17?**
6. **Does the Mode A ↔ Mode B correlation hold?** The load-bearing empirical assumption of the entire product.
7. ~~**Is the name available?**~~ **Resolved 2026-08-29**, verified rather than assumed: `webmcp-gauge` returns 404 on the npm registry, GitHub search finds no repo of that name, and both `webmcp-gauge.dev` and `webmcp-gauge.com` are unregistered per RDAP. Repo created at `https://github.com/Svishwa2004/webmcp-gauge`. Bare `webmcp` and `webmcp-evals` are both taken on npm — do not use either.

---

## 15. Success criteria

Ordered, and each independently checkable:

1. A stable, variance-quantified invocation rate for any WebMCP page, in at least three clients.
2. A published compatibility matrix that a developer would actually link to when explaining "why does my tool work in Brave but not Chrome?"
3. At least one reproducible data contribution accepted into a live spec issue.
4. A cohort dataset captured on gallery-publish day and preserved.
5. The linter installed by developers who have never heard of the author.
6. A report that becomes the default citation for "do WebMCP tools actually get called?"

Criterion 3 is the cheapest and the most valuable. The WebMCP community is small enough — a few named Chrome engineers, spec editors and library authors — that two or three good field-data contributions to open issues make an unknown solo developer a known one. That is the actual early advantage on offer here, and it does not require the product to succeed commercially.

---

## Appendix A — Sources

All accessed and verified 2026-08-29.

**Spec and standards**
- Draft CG report (2026-08-26) — `https://webmachinelearning.github.io/webmcp/`
- Spec repo, issues and commit activity — `https://github.com/webmachinelearning/webmcp` (108 open issues, 3,520★, last push 2026-08-26)
- Issues cited: #24, #73, #88, #145, #154, #157, #158, #159, #160, #167, #173/#177, #199, #225, #236, #237, #241, #246, #253, #255, #256, #257, #262, #266, #268
- WebKit standards position — opposed, closed 2026-06-11 — `WebKit/standards-positions#670`
- Mozilla standards position — neutral, closed 2026-08-05 — `mozilla/standards-positions#1412`

**Browser and client support**
- Chrome status entry 5117755740913664 (updated 2026-08-12): OT 149→156, no ship milestone, reviews pending
- Chrome developer docs — `https://developer.chrome.com/docs/ai/webmcp`
- DevTools WebMCP pane — `https://developer.chrome.com/docs/devtools/application/webmcp`
- CDP `WebMCP` domain — `https://chromedevtools.github.io/devtools-protocol/tot/WebMCP/`
- Edge origin trial in 150, expires 2026-11-17 — Microsoft origin-trials portal
- ChatGPT WebMCP support announced 2026-08-25 — OpenAI community post; docs at `learn.chatgpt.com/docs/webmcp` (subset; no declarative API; no iframe tools)
- Brave tracking issue `brave-browser#55232` (updated 2026-08-27)

**Ecosystem**
- `GoogleChromeLabs/webmcp-tools` (531★, pushed 2026-08-28); `GoogleChromeLabs/use-webmcp-tool` (172★)
- `beaufortfrancois/model-context-tool-inspector` (107★)
- `@mcp-b/webmcp-polyfill` 51.3k weekly downloads; `@mcp-b/transports` 19.2k; `@mcp-b/global` 16.4k; `webmcp-types` 17.6k (v0.1.5, 2026-08-20)
- Directories: `webmcp.com` (365 sites), `webmcp-registry.dev`, `webmcp-today`; four competing awesome-lists
- `nekuda-ai/WindTunnel` benchmark (self-reported, unaudited)

**Field evidence**
- r/webmcp, 2026-04-01 — 1/20 invocation report
- dev.to, 2026-08-22 — "visible ≠ discovered or invoked"
- Respira engineering write-up, 2026-08-28 — frozen `modelContext`, blind debugging, 296-tool silent disable
- Hacker News, 2026-08-26 — state-sync and versioning criticism; 2026-06-19 — identity free-riding; 2026-03-01 — no on-ramps, AMP comparison
- freeCodeCamp, 2026-05-28 — 111,076 of top 200,000 sites scanned, zero implementations found

**Cohort**
- WebMCP Challenge: ~3,745 registered participants; gallery unpublished as of 2026-08-29; ~176 projects visible via Devpost global search (search-index proxy, not an official count)

---

## Appendix B — Local assets already in hand

Verified on disk 2026-08-29, paths re-checked 2026-08-30. This is why Milestone 1 is days rather than weeks.

Paths below are relative to `D:\Projects\Hackthon-projects\WebMCP\`, which holds `_spike\`, `airlock\` and `webmcp-challenge\`; this repo sits beside it at `D:\Projects\Hackthon-projects\webmcp-gauge\`.

| Asset | Path | Reuse |
|---|---|---|
| CDP command probe — enumerates tabs, sends arbitrary CDP methods, prints JSON results and errors | `_spike/cdp-command.mjs` | Becomes `browser/session.js`. Already the right shape for `WebMCP.enable` / `toolsAdded`. |
| CDP evaluate runner — opens a target, navigates, waits for load, evaluates with `awaitPromise`, hard timeout, cleans up | `_spike/cdp-eval.mjs` | Becomes the Mode A trial executor. Raw-WebSocket, zero dependencies. |
| Clean Chrome profile | `_spike/chrome-baseline` | Reproducible browser state per run — a prerequisite for comparable numbers. |
| `chrome-remote-interface` 0.33.3 | `airlock` devDependency, and pinned in `webmcp-gauge` itself since 2026-08-30 | Already vendored and working. |
| Verified WebMCP type surface, empirically checked against Chrome 151 on 2026-08-26 | `airlock/src/webmcp.ts` | Ground truth for the compatibility layer, including the `executeTool` string-vs-object divergence against draft #246. |
| Airlock — 7 registered tools, 27 passing unit tests, live at `https://airlock-app.netlify.app` | `airlock/` | The known-good fixture. A harness with no trusted reference page cannot be calibrated. |
| Verified WebMCP research notes | `webmcp-challenge/RESEARCH-FINDINGS.md`, `HACKATHON-BRIEF.md` | Prior primary-source verification, already done. |
