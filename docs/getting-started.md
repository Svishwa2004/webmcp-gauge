# webmcp-gauge — How to Start, and How the Project Flows

**Status:** pre-implementation — nothing built yet
**Written:** 2026-08-29
**Companions:** `concept.md` (what and why) · `explainer.md` (plain language) · `../PROJECT-LOG.md` (append-only record)

Verification legend used throughout: ✅ verified on this machine · ⚠️ unverified · ❌ known wrong.

---

## 0. What is already in place

Checked on this machine, 2026-08-29. Real output quoted.

| Thing | State |
|---|---|
| Node | ✅ `v24.18.0` — global `WebSocket` and `node --test` both available, so the zero-dependency CDP path works as-is |
| npm | ✅ `12.0.2` |
| Chrome | ✅ `152.0.7977.65` at `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Clean Chrome profile | ✅ `_spike\chrome-baseline\` exists (directory) — reuse it, don't test against your daily profile |
| `chrome-remote-interface` | ✅ `0.33.3`, but **only** inside `airlock\node_modules` — it does **not** resolve from `_spike\` (`Hackathon\node_modules\chrome-remote-interface` → `False`) |
| Zero-dep CDP runner | ✅ `_spike\cdp-eval.mjs` — raw WebSocket, no imports beyond `node:fs`. Runs from anywhere |
| CDP command probe | ✅ `_spike\cdp-command.mjs` — needs `chrome-remote-interface`, so run it from `airlock\` or install the dep in `webmcp-gauge\` |
| Known-good subject | ✅ Airlock: 7 registered tools, 27 passing tests, live at `https://airlock-app.netlify.app` |
| Git | ✅ Own repo at `webmcp-gauge\` on `main`, remote `origin` → `https://github.com/Svishwa2004/webmcp-gauge`. `airlock` is a separate repo; `D:\Projects\Hackathon` is not a repo at all |

---

## 1. Start here — the one thing to do first

**Do not write product code yet.** There is a cheap question that determines the shape of everything after it.

Local Chrome is `152.0.7977.65`. Spec issue **#268** (2026-08-28) reports WebMCP tools being visible in Brave 1.94 but **not** in Chrome `152.0.7977.65` or Edge 151 — the exact build sitting on this machine, and the report is still unresolved. So before designing anything, find out whether this browser can see WebMCP at all.

Both outcomes are useful, which is why this is the first step rather than a risk:

- **Tools visible** → Chrome 152 is your reference client, and you have a counter-example that narrows #268 for the spec repo.
- **Tools invisible** → you have reproduced #268 first-hand on a clean profile against a known-good live page. That is your first field-data contribution, filed before you have written a product, and you switch the reference client (Brave, or the `@mcp-b` polyfill) before building on sand.

### 1.1 Launch a flagged Chrome on the throwaway profile

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="D:\Projects\Hackathon\_spike\chrome-baseline" --no-first-run --no-default-browser-check about:blank
```

Then, once, in that window: open `chrome://flags/#enable-webmcp-testing`, set it to **Enabled**, and relaunch. The setting persists in the profile, so this is a one-time cost.

⚠️ There is probably an `--enable-features=` token that does the same thing without touching the UI, but the exact string is unverified — do not guess it into a script. Use the flag UI until the token is confirmed from a primary source.

### 1.2 Write the probe expression

Create `webmcp-gauge\probes\expr-modelcontext.js`:

```js
(() => {
  const mc = document.modelContext ?? navigator.modelContext ?? null;
  if (!mc) {
    return { present: false, hasDocument: 'modelContext' in document, hasNavigator: 'modelContext' in navigator };
  }
  const tools = typeof mc.getTools === 'function' ? mc.getTools() : null;
  return {
    present: true,
    aliasIsSameObject: document.modelContext === navigator.modelContext,
    surface: Object.getOwnPropertyNames(Object.getPrototypeOf(mc)),
    count: Array.isArray(tools) ? tools.length : null,
    names: Array.isArray(tools) ? tools.map((t) => t.name) : null,
  };
})()
```

The `surface` field matters more than it looks: one field report describes ChatGPT's `modelContext` as a frozen object exposing only `registerTool`. Recording the actual method list per client, rather than assuming the spec's, is the first row of the compatibility matrix.

### 1.3 Run it against the live page

```
node D:\Projects\Hackathon\_spike\cdp-eval.mjs "https://airlock-app.netlify.app" "D:\Projects\Hackathon\webmcp-gauge\probes\expr-modelcontext.js" 30000
```

`cdp-eval.mjs` opens a fresh tab, navigates, waits for `Page.loadEventFired`, evaluates with `awaitPromise`, prints JSON, closes the tab. Override the port with `CDP_PORT` if 9222 is taken.

**Expected on success:** `count: 7` and the seven Airlock tool names.

One caveat the script's own header already warns about: tools frequently register *after* the load event. If you get `count: 0` but `present: true`, the page is fine and your probe is early — wrap the read in a short poll before concluding anything.

### 1.4 Confirm the browser's own view, not just the page's

`getTools()` is the page telling you what it registered. The browser's discovery is a separate thing, and the gap between them is precisely where "registered but never called" lives. Ask Chrome directly, using the `WebMCP` CDP domain:

```
cd /d D:\Projects\Hackathon\airlock && node ..\_spike\cdp-command.mjs "airlock" "[{\"method\":\"WebMCP.enable\"}]"
```

Run it from `airlock\` — that is where `chrome-remote-interface` resolves. If `WebMCP.enable` errors as an unknown method on this build, that is itself the answer to §1.

**Record the result in `PROJECT-LOG.md` before moving on**, whichever way it goes.

---

## 2. The first week, in order

Each step has a done-condition. Do not start the next one until the current one is provably met.

| # | Step | Command / artifact | Done when |
|---|---|---|---|
| 0 | Ground check (§1) | `cdp-eval.mjs` probe | You know whether Chrome 152 sees WebMCP, and it is logged |
| 1 | Scaffold the package | `webmcp-gauge\package.json`, `npm i -E chrome-remote-interface@0.33.3` | Exact-pinned dep (same version already proven in airlock), `node bin/webmcp-gauge.mjs --help` runs |
| 2 | Freeze the utterance set | `webmcp-gauge\fixtures\airlock.utterances.json` | 7 tools × 20 human-written phrasings, committed, reviewed by you — not generated by the judge model |
| 3 | One trial, end to end | `core/trial.mjs` | A single (tool, utterance) trial returns exactly one outcome from the taxonomy, with the judge's raw response attached |
| 4 | Full sweep | `webmcp-gauge run` | 7 × 20 × 3 trials produce a per-tool invocation rate with a Wilson interval |
| 5 | **Variance gate** | same command, three sessions | σ is small enough that the number carries signal — **or the project stops here** |
| 6 | L0 linter | `webmcp-gauge lint` | Flags every documented failure mode on a deliberately broken fixture page |
| 7 | Mode B adapters | `--clients` | At least one real client measured; the ChatGPT column is honestly marked automated or sampled |

Step 2 has one rule that cannot be bent: **the model that writes the utterances must not be the model being judged on them**, or the metric measures self-consistency instead of usability. Write them yourself, or generate with one model and judge with another, and freeze the file so numbers stay comparable across commits.

---

## 3. The flow of a single measurement

This is the pipeline the whole product is built around. Every stage maps to something that already exists or is a thin wrapper on it.

```
launch → attach → load → wait → capture manifest → select → classify → execute → classify → reset → aggregate
```

1. **Launch** — flagged Chrome, throwaway profile, `--remote-debugging-port=9222`.
2. **Attach** — fresh tab via `PUT /json/new`, then `Page.enable`, `Runtime.enable`, `WebMCP.enable`. *(Pattern: `cdp-eval.mjs`.)*
3. **Load** — navigate, wait for `Page.loadEventFired`.
4. **Wait for registration** — poll `getTools()` or listen for `WebMCP.toolsAdded` with a deadline. Registration after load is normal, and treating "not yet" as "not registered" is the easiest way to produce a wrong number.
5. **Capture the manifest** — names, descriptions, input schemas, annotations, and the client's actual method surface. This single artifact feeds the linter, the judge and the compatibility matrix.
6. **Select** — hand *(manifest + one utterance)* to the judge model behind a provider-agnostic adapter. It returns a chosen tool (or none) plus arguments. **Fresh context per utterance** — any conversational carry-over means trial N contaminates trial N+1.
7. **Classify, pre-execution** — `not_registered` · `not_discovered` · `not_selected` · `wrong_tool` · `bad_args` (validated against the captured schema).
8. **Execute** — only if the choice is right and the arguments validate. Call through the page and capture the result plus any observable state change. This is where the compatibility layer earns its place: the draft moved `executeTool` to an object argument on 2026-08-17, while the type surface verified against Chrome 151 still takes a JSON string, so the call shape is per-build, not per-spec.
9. **Classify, post-execution** — `exec_error` · `silent_fail` (returned, but nothing observably changed) · `ok`.
10. **Reset** — close the tab and discard all state. Every trial starts from a clean page, or you are measuring the order of your utterances.
11. **Aggregate** — R repeats, Wilson score interval, per-tool and per-client rollup, emit JSON + Markdown + a badge, stamped with judge model, judge version, browser build and utterance-set version.

Two modes reuse this pipeline with one change each:

- **Budget probe** — inject synthetic tools alongside the real ones and binary-search the count at which discovery breaks. Only ever against your own fixture page, never someone else's site.
- **Annotation efficacy** — run the identical sweep twice, once with `readOnlyHint` / `untrustedContentHint` set and once without, and compare. That is the experiment that turns "hints are not enforcement" from an opinion into a measurement.

---

## 4. Repo layout

```
webmcp-gauge/
  README.md               entry point — what it is, status, links
  LICENSE                 MIT
  PROJECT-LOG.md          append-only record, newest at bottom
  docs/
    concept.md            what and why (technical)
    explainer.md          plain language, non-technical
    getting-started.md    this file
  bin/webmcp-gauge.mjs    CLI entry
  core/                   outcome taxonomy, Wilson intervals, aggregation, report schema
  browser/                Chrome launch + CDP session (grown from _spike/cdp-eval.mjs)
  clients/                chrome-ot | chatgpt | edge | brave adapters
  judges/                 model adapters behind one interface
  report/                 JSON + Markdown + badge emitters
  probes/                 one-off evaluation expressions
  fixtures/               frozen utterance sets + a deliberately broken page for linter tests
  action/                 GitHub Action wrapper
```

Three constraints on this layout:

**Root holds only what a visitor needs first.** `README.md` is the entry point and `PROJECT-LOG.md` stays at root because it is the authoritative record and must be unmissable — the same placement the Airlock project used. Everything explanatory lives in `docs/`.

**The harness never goes into the airlock repo.** Airlock is the subject under test; webmcp-gauge is the instrument. Mixing them contaminates the reference and breaks the separation that has been maintained so far — the existing `_spike\` rig was deliberately kept out of the app repo for the same reason.

**Judges stay behind an adapter.** Any OpenAI-compatible endpoint, any provider, model id recorded in every report. Invocation rate is a property of *(page, client, model)*, so a report that doesn't name its judge is not a measurement. Hard-coding one vendor would also make the tool useless to anyone on a different stack.

---

## 5. The two loops

Once §2 is done, the project runs on two rhythms rather than one:

- **Per-commit (Mode A, cheap, deterministic-ish).** Cheap judge, K=20, R=1. Runs in CI, fails the build when invocation rate drops past a threshold. This is what developers actually adopt.
- **Weekly (Mode B, expensive, calibration).** Real clients, stronger judge, R=3+. Answers "does the cheap loop still resemble reality?" and refreshes the compatibility matrix. Also the loop that catches a browser update silently changing behaviour — which, given an origin trial running to Chrome 156 and Edge's expiring 2026-11-17, will happen.

The correlation between the two is the product's central empirical claim. Track it as a number from the first week, not as an assumption.

---

## 6. Decision gates

Explicit stop-and-think points, so momentum doesn't carry a broken premise forward:

**Gate 1 — §1 ground check.** No WebMCP on Chrome 152 → file the #268 reproduction, switch reference client, then continue. Do not build against a browser you have not confirmed.

**Gate 2 — the variance gate (step 5).** If run-to-run σ swamps the difference between a good and a bad tool description, the metric does not exist yet. Then the honest options are: raise K, pin the judge harder, redesign the trial — or stop and publish the negative result. What is not an option is shipping a number you do not believe.

**Gate 3 — Mode A ↔ Mode B correlation.** If the cheap loop does not predict the real clients, the CI product is dead and the finding becomes the deliverable. Both branches are publishable; only pretending is not.

**Gate 4 — anything public.** Publishing, contacting other developers, opening a repo, pushing, deploying: prepared and shown first, executed only on your explicit go-ahead.

---

## 7. When it breaks

Failure modes already documented in the field, and what each one means:

| Symptom | Most likely cause | Move |
|---|---|---|
| `present: false` | Flag not enabled in *this* profile, or Chrome 152 genuinely lacks it (#268) | Re-check `chrome://flags` in the throwaway profile; if still absent, that is Gate 1 answering |
| `present: true`, `count: 0` | Probe ran before registration | Poll with a deadline instead of reading once |
| Registration throws in one client only | Frozen / partial `modelContext` — reported for ChatGPT's in-app browser | Read the method surface first, register defensively, record the surface as matrix data |
| Tool with a space in its name silently does nothing | Invalid name, no error surfaced (#145) | This is exactly what L0 exists to catch — add the rule |
| Whole feature silently off on a tool-heavy page | Per-page tool budget exceeded (296 tools reported disabling it entirely) | Run the budget probe, report headroom |
| `executeTool` rejects your arguments | String-vs-object signature drift between draft #246 and shipped builds | Handle both in the compat layer, key on build |
| Judge picks nothing, repeatedly | Weak or ambiguous descriptions — the actual finding | Classify `not_selected` and report it; do not "fix" it by hinting the model |
| `cdp-command.mjs` fails on import | `chrome-remote-interface` doesn't resolve from `_spike\` | Run from `airlock\`, or install the pinned dep in `webmcp-gauge\` |
| Devpost or other pages return 202 with an empty body | Bot challenge on plain fetches | Use a real browser for those; do not build a scraper around it |

---

## 8. Ground rules for this project

Carried over deliberately, because they are what made the previous project hold up:

1. **Nothing is done until it is proven against the real target, with the output quoted.** Not "the harness should work" — the actual JSON, from the live URL.
2. **No commits, pushes, repo creation, deploys, or contact with other developers without an explicit go-ahead.** Prepare, show, wait.
3. **Solve the step in front of you.** No extra dependencies, features or abstractions because they might be useful later.
4. **Determinism and reproducibility.** Exact-pinned dependencies, frozen utterance sets, seeded fixtures, and stamped reports. A number that cannot be regenerated is not evidence.
5. **Instrument stays out of the subject.** webmcp-gauge never lands in the airlock repo.
6. **Mark every fact ✅ / ⚠️ / ❌.** Anything unverified is labelled, including in your own reports.
7. **Log it.** Append what changed, why, and how it was verified to `PROJECT-LOG.md`, newest at the bottom. That file is the source of truth, not memory.
