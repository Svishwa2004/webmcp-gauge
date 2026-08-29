---

# ToolProof — Project Log

Append-only record of every change, decision, and verification in this project. Newest entries at the bottom. Times are UTC unless marked PT.

**Location note:** this log sits in `D:\Projects\Hackathon\toolproof\` and covers only the ToolProof measurement layer. The Airlock hackathon entry has its own log at `D:\Projects\Hackathon\PROJECT-LOG.md`; the two projects share a subject (Airlock is ToolProof's reference page) but nothing else. Airlock's log is frozen history as far as this project is concerned.

**Verification legend:** ✅ verified · 🟡 in progress / awaiting user action · ⚠️ unverified · ❌ known wrong.

---

## Current State (updated 2026-08-29)

| Item | Status |
|---|---|
| Direction | ✅ **Chosen** — measurement layer for WebMCP page tools ("does an agent actually call my tool?") |
| Working name | 🟡 **ToolProof** — provisional; package/domain/org availability **⚠️ unchecked** |
| Landscape research | ✅ Verified 2026-08-29 against primary sources (spec repo, chromestatus, standards positions, npm/GitHub APIs, field reports) — recorded in `CONCEPT.md` Appendix A |
| Concept document | ✅ `toolproof\CONCEPT.md` |
| Plain-language explainer | ✅ `toolproof\EXPLAINER.md` |
| Start guide + pipeline flow | ✅ `toolproof\GETTING-STARTED.md` |
| Publishing policy | ✅ **Decided** — private during judging, aggregate after; conflict of interest disclosed |
| Code | ❌ **None written.** Pre-implementation |
| Node / npm | ✅ `v24.18.0` / `12.0.2` |
| Local Chrome | ✅ `152.0.7977.65` — ⚠️ **the exact build named in unresolved spec issue #268** as *not* showing tools |
| Reference subject | ✅ Airlock — 7 tools, 27 passing tests, live at `https://airlock-app.netlify.app` |
| Reusable rig | ✅ `_spike\cdp-eval.mjs` (zero-dep, raw WebSocket) and `_spike\cdp-command.mjs` (needs `chrome-remote-interface`, resolves only from `airlock\`) |
| Clean Chrome profile | ✅ `_spike\chrome-baseline\` exists |
| Ground check (does Chrome 152 see WebMCP?) | 🟡 **Not yet run** — this is the gate on everything else |
| Git | ✅ `D:\Projects\Hackathon` is **not** a repo; `toolproof\` is untracked. No repo to be created without explicit go-ahead |
| Challenge submission | ❌ **Not eligible and not attempted** — see 2026-08-29 entry |

**Immediate next action:** run §1 of `GETTING-STARTED.md` — launch flagged Chrome 152 on the `_spike\chrome-baseline` profile, probe `https://airlock-app.netlify.app` with `cdp-eval.mjs`, and record whether `document.modelContext` exists and `getTools()` returns 7. Both outcomes are useful; the result decides the reference client and may hand over the project's first spec-repo contribution.

---

## 2026-08-29 — Direction chosen, landscape verified, documents written

### Where this came from

Airlock was submitted on 2026-08-28. This entry opens a separate project: rather than another WebMCP *site*, build the instrument that measures whether WebMCP sites work.

Four candidate wedges were put up, and the user chose the first:

1. ✅ **Chosen — conformance harness + cross-client compatibility data.**
2. Gallery-harvest-first (snapshot the cohort, decide the product afterwards).
3. Consent/enforcement library for the propose→approve→audit pattern.
4. Linter-only play.

Rationale recorded at the time: it attacks the two most-reported developer pains (tools register but never get called; silent failure with no debuggability), spec churn makes it *more* valuable rather than less, it reuses the existing `_spike` CDP rig plus Airlock as a known-good fixture, and the core question — *did the agent use what we exposed, and correctly?* — survives WebMCP being renamed or replaced.

Also decided, and not to be re-litigated: **publishing policy = private during judging, aggregate after.** Per-builder scorecards go only to that builder; public output during Sep 4–21 is aggregate-only with no per-project rankings; per-project detail waits until winners are announced ~Sep 23. The author is an entrant, so the conflict of interest is stated in anything published.

### Landscape research — verified, not assumed

Three parallel research passes against primary sources. Full source list in `CONCEPT.md` Appendix A. The load-bearing findings:

- **Spec** ✅ W3C Web Machine Learning **Community Group** draft dated 2026-08-26. Entry point is `document.modelContext`. 108 open issues, 3,520 stars, 13 commits in the last 4 weeks.
- **Recent breaking changes** ✅ `executeTool()` object-not-string (#246, 2026-08-17); `inputSchema` `DOMString`→`object` (#241); `annotations` moved (#225); namespace moved in Chrome 150 (#266).
- **Live repositioning debate** ✅ #236 proposes recasting the feature as generic RPC, with `modelContext`→`toolContext` and `executeTool`→`callTool` on the table. No decision taken. Design accordingly: do not couple product value to the API's spelling.
- **Browser support** ✅ Chrome origin trial 149→156, TAG/privacy/security reviews pending, **no ship milestone**. Edge OT in 150, **expires 2026-11-17**. WebKit **opposed** (2026-06-11). Mozilla **neutral** (2026-08-05).
- **Agents** ✅ ChatGPT desktop in-app browser is the only confirmed consumer, and implements a subset (no declarative API, no iframe tool discovery). ⚠️ Gemini-in-Chrome invocation could not be confirmed from a Google primary source.
- **Adoption** ✅ An independent scan of 111,076 of the top 200,000 sites (2026-05-28) found **zero** implementations. Consequence accepted explicitly: there is no paying market in 2026, so the near-term return is position and credibility, not revenue. No billing to be built.
- **Occupied ground** ✅ `@mcp-b/webmcp-polyfill` 51.3k weekly downloads; `webmcp-types` 17.6k; an official React hook; `GoogleChromeLabs/webmcp-tools` (531★) already ships an inspector, a polyfill and a **free evals CLI**; directories are crowded (webmcp.com at 365 sites plus two rivals and four awesome-lists). Decisions that follow: **wrap and cite Google's evals CLI rather than duplicate it**, and build **no registry, no awesome-list, no React hook**.
- **Nearest neighbour** ✅ WindTunnel (nekuda) — a one-off, self-reported, unaudited benchmark. Differentiation is being continuous, reproducible, per-site and independently re-runnable.
- **Verified gaps** ✅ production runtime analytics, CI regression gating, authenticated pages, model-ergonomics linting, cross-client compatibility data, tool-poisoning scanning, non-React/non-Chrome coverage.

Field pain, in developers' own words (sources in Appendix A): an assistant invoking tools **1 time in 20**, including against Google's own demos; a developer debugging "blind… reading screenshots taken from inside ChatGPT's browser because that was the only ground truth available"; **296 registered tools silently disabling WebMCP for an entire page**, with no error and no warning.

### Metric defined

**Invocation rate** — of K frozen, human-written phrasings for a tool, the fraction that caused the agent to select that tool with valid arguments. Reported only with a 95% Wilson score interval, R repeated runs, observed σ, and stamped judge model, browser build and utterance-set version. Every trial lands in exactly one of nine outcomes (`not_supported`, `not_registered`, `not_discovered`, `not_selected`, `wrong_tool`, `bad_args`, `exec_error`, `silent_fail`, `ok`) — the taxonomy is the product, because it tells a developer *which* thing to fix where today all failures look identical.

Method rule fixed now: **the model that authors the utterances must not be the model judged on them**, and the set is frozen and versioned, or numbers stop being comparable across commits.

Central empirical claim, to be tested rather than assumed: **Mode A (harness acts as the agent — cheap, CI-runnable) predicts Mode B (real shipping clients — expensive, partly manual) well enough to gate a build.** If it does not, the finding itself is the deliverable.

### Environment verified on this machine

Real output, not assumed:

- `node v24.18.0`, `npm 12.0.2`
- Chrome `152.0.7977.65` at `C:\Program Files\Google\Chrome\Application\chrome.exe`
- `_spike\chrome-baseline\` exists and is a directory — reusable throwaway profile
- `chrome-remote-interface@0.33.3` present in `airlock\node_modules` ✅ but **absent** from `Hackathon\node_modules` (`Test-Path` → `False`), so `_spike\cdp-command.mjs` will not resolve it when run from `_spike\`. Run it from `airlock\`, or pin the dep in `toolproof\`. `_spike\cdp-eval.mjs` has no such problem — raw WebSocket, zero dependencies, and Node 24 provides global `WebSocket`.
- `D:\Projects\Hackathon` is **not** a git repository; `airlock` is, on branch `main`.

### The Chrome 152 collision — flagged before it bites

Local Chrome is `152.0.7977.65`. Spec issue **#268** (2026-08-28) reports tools visible in Brave 1.94 but **not** in Chrome `152.0.7977.65` or Edge 151, cause unresolved. That is this exact build. It is therefore the first thing to test rather than a hazard to discover later, and both outcomes are productive: tools visible gives a reference client plus a counter-example that narrows the issue; tools invisible is a clean-profile reproduction against a known-good live page — a field-data contribution available before any product exists.

⚠️ Unverified and deliberately not guessed: the `--enable-features=` token equivalent to `chrome://flags/#enable-webmcp-testing`. Use the flag UI on the throwaway profile until the token is confirmed from a primary source.

### Documents created

- `toolproof\CONCEPT.md` — technical concept: ground truth table, pain evidence, the two-mode insight, metric definition, three build layers, how it feeds six clusters of open spec issues, non-goals, milestones, ethics policy, risk table, open questions, sources.
- `toolproof\EXPLAINER.md` — non-technical version. Shop-counter analogy for WebMCP, mystery-shopper analogy for the harness, crash-test-ratings framing for the positioning, SEO-tools framing for the eventual business. Per standing write-up convention, presented as a standalone project with no mention of the competition — which also meant omitting the early-September cohort snapshot, since it cannot be described without naming the event.
- `toolproof\GETTING-STARTED.md` — the ground check, the first-week step table with done-conditions, the eleven-stage measurement pipeline, repo layout, the two operating loops, four decision gates, a troubleshooting table keyed to documented failure modes, and the project's ground rules.
- `toolproof\PROJECT-LOG.md` — this file.

### Asked and answered: can this be submitted to the challenge?

**No, on two independent grounds.**

1. **The slot is spent.** One submission per entrant, maximum; Airlock went in 2026-08-28.
2. **It would be ineligible anyway.** Submissions require a working live URL testable in a WebMCP-enabled browser plus a public repo containing a `document.modelContext.registerTool({...})` implementation. ToolProof *consumes* WebMCP tools and exposes none, so it fails the Stage One theme/API gate. Additionally, QA/audit tooling is already the second-largest cluster in the gallery, which would cost points on Creativity & Ambition.

Swapping Airlock for it was considered and rejected: 5 days remained, and trading a finished, live, ChatGPT-verified entry for a five-day-old tool that fails the theme gate is strictly negative. The team route (an individual may also enter as part of a team) was noted and rejected — it needs a real collaborator, and manufacturing a second bite is what duplicate-submission discretion exists to catch, putting the Airlock entry at risk.

⚠️ The one-submission and live-URL/`registerTool` requirements above come from `webmcp-challenge\HACKATHON-BRIEF.md` and `PROJECT-LOG.md`, not a fresh read: `webmcp.devpost.com/rules` returns HTTP 202 with a 0-byte body to direct fetches (same bot challenge documented in the Airlock log). Both local sources were verified against primary sources when written and agree with each other.

The constructive version: the challenge is worth more to this project as a distribution event and a dataset than as a prize slot — ~165 live WebMCP implementations published in one window, field data for open spec issues while attention peaks, and a report afterwards. None of that requires an entry or carries rules risk.

### Still open

- 🟡 **Ground check not yet run** (§1 of `GETTING-STARTED.md`) — gates everything.
- ⚠️ Can the ChatGPT desktop in-app browser be driven programmatically at all? Determines whether Mode B is automated or sampled. Highest-priority unknown.
- ⚠️ Does Gemini-in-Chrome actually invoke page tools today?
- ⚠️ Was `navigator.modelContext` formally deprecated in 150 and removed in 152? Only secondary sources and #266 assert it; the local type surface says both names referenced the same object on Chrome 151.
- ⚠️ Actual per-page tool budget, per client — the point of the budget probe.
- ⚠️ Will Edge renew its origin trial after 2026-11-17?
- ⚠️ Is "ToolProof" available as package name, domain and GitHub org? Alternatives if not: *Invoked*, *Callable*, *Handshake*.
- ❔ Does the Mode A ↔ Mode B correlation hold? The load-bearing assumption of the entire product.
- No code, no repo, no dependencies installed. Nothing committed anywhere; awaiting go-ahead before any of that changes.
