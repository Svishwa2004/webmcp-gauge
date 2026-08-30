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
| `not_discovered` | Registered, but absent from the agent's tool list | Client or page — the interesting case |
| `not_selected` | Discovered; the agent answered without calling any tool | **Description quality** |
| `wrong_tool` | Called a different tool | **Naming / description collision** |
| `bad_args` | Right tool, arguments fail schema or expectation | **Schema design** |
| `exec_error` | `execute` threw | Page author |
| `silent_fail` | Call returned, but no observable state change | Page author |
| `ok` | Right tool, valid arguments, observable effect | — |

The taxonomy is the product. A single pass/fail tells a developer nothing; `not_selected` vs `bad_args` vs `not_discovered` tells them exactly which line to edit.

### 5.2 Reporting the number honestly

K is small and outcomes are binomial, so a bare percentage is not defensible. Every reported rate carries:

- a **95% Wilson score interval** (correct for small-*n* proportions, unlike the normal approximation),
- **R repeated runs** with the observed spread, because agent behaviour is non-deterministic,
- the **judge model identifier and version**, because invocation rate is a property of *(page, client, model)* and not of the page alone,
- the **client build string** (browser version, OT token state, flag state).

A report line reads:

```
summarise_spending   Chrome 153 / gemini-3-flash-preview
  invocation 0.35  95% CI [0.19, 0.55]  K=20 R=3 σ=0.04
  not_selected 11  bad_args 2  ok 7
```

Run-to-run variance is the first thing a sceptic will attack, and rightly. Publishing it before anyone asks is the credibility play.

### 5.3 Secondary metrics

- **Control false-positive rate** — of *M* control utterances that **no** registered tool can serve (off-topic, out-of-scope writes and exports, injection-style instructions), the fraction that still caused a tool call. Without it invocation rate is unfalsifiable: an agent that fires something at every input scores 1.0 on a set where every utterance has a right answer. Reported with its own Wilson interval and never pooled with invocation rate, and broken out by control class, because an `injection` false positive is a safety finding while an `out_of_scope` one is an over-eager description. Airlock's set carries M=20 (5 off-topic, 13 out-of-scope, 2 injection).
- **Reachability** — `1 − (not_registered + not_discovered)/K`. Separates page-side registration failures from model-side selection failures. The single most useful diagnostic split.
- **Argument fidelity** — exact and semantic match of extracted arguments against expectations.
- **Budget headroom** — register *N* synthetic tools alongside the real ones and binary-search the *N* at which discovery breaks. Reports `headroom = N_break − N_current`. This turns the 296-tool silent-disable anecdote into a number, per client. Nobody has this.
- **Cross-client divergence** — pairwise disagreement on the `ok` set between clients. Directly feeds spec issue #268.
- **Annotation efficacy** — does setting `readOnlyHint` or `untrustedContentHint` change observable agent behaviour *at all*? An experiment, not an opinion, on whether the spec's safety hints do anything.

### 5.4 Methodological rule that must not be broken

**The model that authors the utterance set must not be the model that is judged on it.** Otherwise the metric measures self-consistency, not usability. Utterances are human-reviewed, committed to the developer's repo as a frozen versioned file, and changed deliberately — never regenerated per run, or the numbers stop being comparable across commits. The authoring model is recorded inside the fixture so the constraint is checkable rather than remembered: Airlock's set (`fixtures/airlock.utterances.json`, frozen at `1.2.0` on 2026-08-30) was authored by `deepseek v4 by agentrouter`, which is therefore disqualified as a judge for those numbers.

---

## 6. What to build

Three layers, shipped in this order. Each is independently useful, which means each is independently abandonable.

### L0 — Static linter (no browser required)

```
npx webmcp-gauge lint ./src          # source-tree mode
npx webmcp-gauge lint https://…      # live-page mode
```

Encodes the documented silent-failure modes and model-ergonomics rules:

- invalid tool names (the space-in-name silent failure, #145), naming collisions, near-duplicate names
- descriptions that are empty, truncated, ambiguous between tools, or written for humans rather than models
- over-parameterised schemas, missing `required`, unconstrained free-text where an `enum` belongs
- registered tool count against the measured per-client budget, with a warning band
- `execute` handlers that close over stale snapshots instead of reading live state — a real bug class already documented in `airlock/src/webmcp.ts`
- missing `annotations` on obviously mutating tools

Ships in a day, needs no browser, no model, no API key. This is the free on-ramp and the SEO surface.

### L1 — The harness

```
npx webmcp-gauge run https://example.com --utterances ./webmcp-gauge.utterances.json \
    --clients chrome-ot,chatgpt,edge,brave --k 20 --repeat 3
npx webmcp-gauge budget https://example.com          # headroom probe
npx webmcp-gauge compare base.json head.json         # regression diff
```

**Architecture** — Node ESM, no framework, provider-agnostic by design:

```
webmcp-gauge/
  bin/            CLI entry
  core/           outcome taxonomy, Wilson intervals, report schema
  browser/        Chrome launch + CDP session management
  clients/        chrome-ot | chatgpt | edge | brave adapters
  judges/         model adapters (OpenAI | Gemini | local) behind one interface
  report/         JSON + Markdown + badge SVG emitters
  action/         GitHub Action wrapper
```

**Mechanics, grounded in what already works locally** (see [Appendix B](#appendix-b-local-assets-already-in-hand)):

1. Launch Chrome with a dedicated profile and `--remote-debugging-port`, WebMCP enabled by flag or OT token. A clean baseline profile already exists at `_spike/chrome-baseline`.
2. `WebMCP.enable` and the `toolsAdded` event give discovery ground truth straight from the browser, independent of any page instrumentation.
3. `Runtime.evaluate` drives `document.modelContext.getTools()` and `executeTool()` — **note the live signature divergence**: `getTools()` resolves a `Promise` on Chrome 152 (measured 2026-08-30, so every read must be awaited), and the draft moved `executeTool` to an object argument (#246, 2026-08-17) while the local type surface verified against Chrome 151 on 2026-08-26 still takes a JSON string. This is compatibility-matrix row one, available on day one.
4. The judge adapter receives the manifest plus one utterance and returns a tool choice with arguments. Swapping judges must be a flag, never a rewrite — the metric is model-relative, so pinning and reporting the judge is mandatory.
5. Execute the selection, observe page state, classify into the taxonomy, emit.

**Client-mode caveat.** Chrome, Edge and Brave are CDP-drivable. The ChatGPT desktop in-app browser very likely is not, in which case that column is sampled through guided manual runs against an instrumented recorder page rather than automated. This is [Open question 1](#14-open-questions) and it must be spiked before L1 scope is locked.

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
| 1 | Aug 29–31 | Harness v0, Mode A only, against Airlock's 7 tools plus the Chrome Labs demos | An invocation-rate number **with a measured run-to-run variance**. If σ swamps the signal, stop and rethink — this is the go/no-go gate. |
| 2 | Sep 1 | L0 linter, standalone | Flags all documented silent-failure modes on a deliberately broken fixture page |
| 3 | Sep 1–3 | Mode B adapters + Mode A↔B correlation study + GitHub Action | Correlation quantified either way; #268 reproduced or refuted; a build fails on regression |
| 4 | by Sep 3, runs Sep 4 | Cohort snapshot script, staged and ready | Captures tool manifests, schemas, descriptions and URL liveness across the published Challenge gallery the day it appears |
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
| ChatGPT in-app browser may not be automatable | Medium | Spike before locking L1 scope. Fall back to sampled manual runs against an instrumented recorder page; report that column as sampled, never as automated. |
| Model-call cost across clients × K × R × cohort size | Medium | Hard budget ceiling per sweep; cheap judge for CI mode, stronger judge for calibration runs only. |
| No revenue in 2026 | Accepted | This is a positioning investment. Stated plainly rather than dressed up as a business. |
| Name collision — "Airlock" already collides with three unrelated products | Low | ✅ Resolved for this project: `webmcp-gauge` was checked against npm and GitHub before the repo existed, and no ecosystem project or hackathon entry uses the name. |
| Measuring other people's entries reads as competitive | Medium | Section 12, applied literally. |

---

## 14. Open questions

Unresolved, and each is answerable with a small spike:

1. **Can the ChatGPT desktop in-app browser be driven programmatically at all?** Determines whether Mode B is automated or sampled. Highest-priority unknown.
2. **Does Gemini-in-Chrome actually invoke page tools today?** Google-sourced coverage says "will soon"; Chrome docs distinguish the Inspector from the Gemini feature. Not confirmable from a primary source.
3. ~~**Was `navigator.modelContext` formally deprecated in 150 and removed in 152?**~~ **Resolved 2026-08-30 by direct measurement:** on Chrome `152.0.7977.65` with `#enable-webmcp-testing` enabled, `'modelContext' in navigator` → `false`. The name is gone; only `document.modelContext` exists. Two related facts came out of the same probe and are load-bearing for the harness: **`getTools()` returns a `Promise`**, not an array, and the browser exposes a **`WebMCP` CDP domain** (`enable`, `disable`, `invokeTool`, `cancelInvocation`; `toolsAdded`, `toolsRemoved`, `toolInvoked`, `toolResponded`) — note `invokeTool` where the page API says `executeTool`.
4. **What is the actual per-page tool budget**, per client? The whole point of the `budget` probe.
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
