# webmcp-gauge — How to Start, and How the Project Flows

**Status:** pre-implementation — nothing built yet
**Written:** 2026-08-29
**Companions:** `concept.md` (what and why) · `explainer.md` (plain language) · `../PROJECT-LOG.md` (append-only record)

Verification legend used throughout: ✅ verified on this machine · ⚠️ unverified · ❌ known wrong.

---

## 0. What is already in place

Checked on this machine, re-verified 2026-08-30. Real output quoted.

**Where things actually live** — the parent directory is `D:\Projects\Hackthon-projects\`, holding `WebMCP\` (which contains `airlock\`, `webmcp-challenge\` and `_spike\`) and `webmcp-gauge\` beside it. Paths below are relative to that root; anything in this repo dated before 2026-08-30 that says `D:\Projects\Hackathon\` is stale.

| Thing | State |
|---|---|
| Node | ✅ `v24.18.0` — global `WebSocket` and `node --test` both available, so the zero-dependency CDP path works as-is |
| npm | ✅ `12.0.2` |
| Chrome | ✅ `152.0.7977.65` at `C:\Program Files\Google\Chrome\Application\chrome.exe` — **sees WebMCP** behind the flag (§1) |
| Clean Chrome profile | ✅ `WebMCP\_spike\chrome-baseline\`, with `#enable-webmcp-testing` already enabled in it (`Local State` → `enabled_labs_experiments: ["enable-webmcp-testing@1"]`). Reuse it, don't test against your daily profile |
| `chrome-remote-interface` | ✅ `0.33.3` exact-pinned in `webmcp-gauge\` itself as of step 1, so it now resolves from this repo. Also present in `WebMCP\airlock\node_modules`; still **not** resolvable from `WebMCP\_spike\` |
| Zero-dep CDP runner | ✅ `WebMCP\_spike\cdp-eval.mjs` — raw WebSocket, no imports beyond `node:fs`. Runs from anywhere. ⚠️ On Windows it prints correct JSON and then exits `-1073740791` with a libuv assertion; read the JSON, ignore the exit code, and do not build a CI gate on it |
| CDP command probe | ✅ `WebMCP\_spike\cdp-command.mjs` — needs `chrome-remote-interface`, and **hardcodes port 9222** with no override |
| Known-good subject | ✅ Airlock: 7 registered tools, 27 passing tests, live at `https://airlock-app.netlify.app` |
| Git | ✅ Own repo at `webmcp-gauge\` on `main`, remote `origin` → `https://github.com/Svishwa2004/webmcp-gauge` (private). `WebMCP\airlock` is a separate repo; `D:\Projects\Hackthon-projects` and `D:\Projects\Hackthon-projects\WebMCP` are not repos |

---

## 1. The ground check — ✅ answered 2026-08-30, and worth re-running

**Result: Chrome `152.0.7977.65` does see WebMCP.** With `chrome://flags/#enable-webmcp-testing` enabled, `document.modelContext` is present and `getTools()` returns all seven Airlock tools. Spec issue **#268** (2026-08-28) names this exact build as *not* showing tools, so this is a **counter-example that narrows #268** rather than a reproduction of it. Chrome 152 is therefore the reference client. Full evidence in `../PROJECT-LOG.md`, entry 2026-08-30.

Three things the check turned up that shape everything downstream:

- **`getTools()` returns a `Promise`**, not an array. Await it, always.
- **`navigator.modelContext` no longer exists** on 152 (`'modelContext' in navigator` → `false`). Only `document.modelContext`.
- **Registration is racy.** One run read three of seven tools mid-registration. Wait for the tool set to *stop changing*, not merely to be non-empty.

The procedure below stays because it is not a one-off: re-run it on every Chrome update, on every new client, and any time a number moves for no obvious reason. The reference client is a measured fact with an expiry date, not a setting.

**Do not skip ahead to product code because this is green.** The next step is §2 step 2 — freezing the utterance set.

### 1.1 Launch a flagged Chrome on the throwaway profile

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9333 --user-data-dir="D:\Projects\Hackthon-projects\WebMCP\_spike\chrome-baseline" --no-first-run --no-default-browser-check about:blank
```

Port **9333**, not 9222: on this machine an unrelated Chrome listens on 9222 and answers `404` on `/json/version`, so it looks alive to a port check and is useless as a debug target. Confirm whichever port you pick actually answers before blaming the page:

```
powershell -NoProfile -Command "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9333/json/version').Content"
```

The flag is already enabled in this profile (`Local State` → `enabled_labs_experiments: ["enable-webmcp-testing@1"]`). On a *fresh* profile you must enable `chrome://flags/#enable-webmcp-testing` in the UI and relaunch — and note that closing the window is not the same as clicking **Relaunch**: the setting is only written on a clean shutdown, so verify it landed by reading `Local State` rather than trusting the click.

⚠️ There is probably an `--enable-features=` token that does the same thing without touching the UI, but the exact string is still unverified — do not guess it into a script.

### 1.2 The probe expressions

Three are committed in `webmcp-gauge\probes\`, so results stay reproducible instead of depending on a snippet pasted from prose:

| File | Answers |
|---|---|
| `expr-modelcontext.js` | Is `modelContext` present, on which object, what is its method surface, is it frozen — and the **settled** tool set: it waits for four consecutive identical reads (800 ms of stability) inside an 8 s deadline, and reports `settled` plus `settledAtMs` so a partial read is visible instead of silent |
| `expr-modelcontext-shape.js` | What `getTools()` actually returns (type, constructor, thenable), and whether `navigator.modelContext` exists |
| `expr-tools-settle.js` | The registration time series — every change to the tool set over 10 s, when you need to see *how* it filled rather than just the final state |

The shape of a correct read, for reference — note the `await`, which the original version of this document got wrong:

```js
(async () => {
  const mc = document.modelContext ?? null;
  if (!mc) return { present: false, inNavigator: 'modelContext' in navigator };
  const raw = mc.getTools();                    // Promise on Chrome 152
  const tools = typeof raw?.then === 'function' ? await raw : raw;
  return { present: true, count: tools?.length ?? null, names: tools?.map((t) => t.name) ?? null };
})()
```

Record the method surface, not just the count: one field report describes ChatGPT's `modelContext` as a frozen object exposing only `registerTool`. On Chrome 152 the surface is `["ontoolchange","executeTool","getTools","registerTool","constructor"]` and the object is not frozen. Descriptors also carry more than the draft's fields — `annotations, description, inputSchema, name, origin, title, window` — and `origin` and `window` belong in the captured manifest.

### 1.3 Run it against the live page

```
set "CDP_PORT=9333" && node "D:\Projects\Hackthon-projects\WebMCP\_spike\cdp-eval.mjs" "https://airlock-app.netlify.app" "D:\Projects\Hackthon-projects\webmcp-gauge\probes\expr-modelcontext.js" 30000
```

Quote the assignment as `set "CDP_PORT=9333"`. Written bare, `cmd` includes the trailing space in the value and the runner builds `http://127.0.0.1:9333 /json/new` — an invalid URL, and a confusing failure that has nothing to do with WebMCP.

`cdp-eval.mjs` opens a fresh tab, navigates, waits for `Page.loadEventFired`, evaluates with `awaitPromise`, prints JSON, closes the tab. It then exits `-1073740791` with a libuv assertion on Windows; the JSON printed before that is valid.

**Expected on success:** `settled: true`, `count: 7`, and the seven Airlock tool names — `clear_highlights`, `describe_dataset`, `filter_rows`, `find_anomalies`, `monthly_trend`, `sum_by_category`, `top_expenses`. Measured `settledAtMs` on this machine: **2544** and **4023** across two runs, i.e. registration finishes roughly 1.7–3.2 s after the probe starts, and varies by seconds between runs on the same page.

`settled: false` means the set never held still inside the deadline — treat the count as unusable rather than as a result. A *partial* count from a naive probe is the same failure wearing a plausible number: an earlier version of `expr-modelcontext.js` stopped at the first non-empty read and reported 3, then 4, of Airlock's 7 tools with no error at all. Airlock issues seven sequential `await registerTool` calls, and the load event can fire mid-sequence. Run `expr-tools-settle.js` when you want to watch the set fill.

### 1.4 Confirm the browser's own view, not just the page's

`getTools()` is the page telling you what it registered. The browser's discovery is a separate thing, and the gap between them is precisely where "registered but never called" lives.

The cheapest read-only check is the protocol list itself, which needs no dependency and no tab:

```
powershell -NoProfile -Command "$p = Invoke-RestMethod 'http://127.0.0.1:9333/json/protocol'; $p.domains | Where-Object { $_.domain -eq 'WebMCP' } | ForEach-Object { ($_.commands | ForEach-Object { $_.name }) -join ', '; ($_.events | ForEach-Object { $_.name }) -join ', ' }"
```

✅ Confirmed on Chrome 152: domain **`WebMCP`** exists, commands `enable`, `disable`, `invokeTool`, `cancelInvocation`; events `toolsAdded`, `toolsRemoved`, `toolInvoked`, `toolResponded`. Two consequences worth carrying into the design: the protocol says **`invokeTool`** where the page API says `executeTool` — two vocabularies for one operation, which is what the compat layer is for — and `toolsAdded`/`toolsRemoved` give an event-driven answer to the registration race instead of polling.

To send actual commands, `cdp-command.mjs` works but **hardcodes port 9222**, so either run the flagged Chrome on 9222 or use your own session:

```
cd /d D:\Projects\Hackthon-projects\WebMCP\airlock && node ..\_spike\cdp-command.mjs "airlock" "[{\"method\":\"WebMCP.enable\"}]"
```

**Record the result in `../PROJECT-LOG.md` before moving on**, whichever way it goes.

---

## 2. The first week, in order

Each step has a done-condition. Do not start the next one until the current one is provably met.

| # | Step | Command / artifact | Done when |
|---|---|---|---|
| 0 | ✅ **Done 2026-08-30** — Ground check (§1) | `cdp-eval.mjs` + `probes\` | Chrome 152 sees WebMCP; result and evidence logged |
| 1 | ✅ **Done 2026-08-30** — Scaffold the package | `webmcp-gauge\package.json`, `bin\webmcp-gauge.mjs`, `npm i -E chrome-remote-interface@0.33.3` | `chrome-remote-interface@0.33.3` pinned with no range, `node bin\webmcp-gauge.mjs --help` prints usage and exits 0, unknown command exits 2 |
| 2 | 🟡 **Drafted 2026-08-30, awaiting review** — Freeze the utterance set | `webmcp-gauge\fixtures\airlock.utterances.json` + `airlock.utterances.test.mjs` | 7 tools × 20 phrasings **plus 20 negative controls** that no tool should answer, `npm test` green, **read by you**, authoring model id recorded, `frozen: true` set — the test rejects `frozen` without a named author and reviewer |
| 3 | One trial, end to end | `core/trial.mjs` | A single (tool, utterance) trial returns exactly one outcome from the taxonomy, with the judge's raw response attached |
| 4 | Full sweep | `webmcp-gauge run` | 7 × 20 × 3 trials produce a per-tool invocation rate with a Wilson interval, plus the control false-positive rate reported separately |
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

1. **Launch** — flagged Chrome, throwaway profile, `--remote-debugging-port=<a port you verified answers /json/version>` (9333 here; 9222 is taken on this machine).
2. **Attach** — fresh tab via `PUT /json/new`, then `Page.enable`, `Runtime.enable`, `WebMCP.enable`. *(Pattern: `cdp-eval.mjs`.)*
3. **Load** — navigate, wait for `Page.loadEventFired`.
4. **Wait for registration** — `getTools()` returns a **Promise** on Chrome 152, so await it, and wait for the returned set to *stop changing* rather than to be non-empty: a mid-registration read against Airlock returned 3 of 7 tools with no error. Prefer the `WebMCP.toolsAdded` / `toolsRemoved` events over polling. Treating "not yet" as "not registered" is the easiest way to produce a wrong number.
5. **Capture the manifest** — names, descriptions, input schemas, annotations, and the client's actual method surface. This single artifact feeds the linter, the judge and the compatibility matrix.
6. **Select** — hand *(manifest + one utterance)* to the judge model behind a provider-agnostic adapter. It returns a chosen tool (or none) plus arguments. **Fresh context per utterance** — any conversational carry-over means trial N contaminates trial N+1.
7. **Classify, pre-execution** — `not_registered` · `not_discovered` · `not_selected` · `wrong_tool` · `bad_args` (validated against the captured schema).
8. **Execute** — only if the choice is right and the arguments validate. Two paths exist and they are not equivalent: the page API (`document.modelContext.executeTool`) and the browser's own `WebMCP.invokeTool` over CDP, which is closer to what a real client does. Capture the result plus any observable state change. This is where the compatibility layer earns its place: the draft moved `executeTool` to an object argument on 2026-08-17, while the type surface verified against Chrome 151 still takes a JSON string, so the call shape is per-build, not per-spec.
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

**Gate 1 — §1 ground check.** ✅ **Cleared 2026-08-30**: Chrome 152 sees WebMCP, so it is the reference client. The gate does not retire, it recurs — re-run §1 after any browser update or when adding a client, and do not build against a browser you have not confirmed.

**Gate 2 — the variance gate (step 5).** If run-to-run σ swamps the difference between a good and a bad tool description, the metric does not exist yet. Then the honest options are: raise K, pin the judge harder, redesign the trial — or stop and publish the negative result. What is not an option is shipping a number you do not believe.

**Gate 3 — Mode A ↔ Mode B correlation.** If the cheap loop does not predict the real clients, the CI product is dead and the finding becomes the deliverable. Both branches are publishable; only pretending is not.

**Gate 4 — anything public.** Publishing, contacting other developers, opening a repo, pushing, deploying: prepared and shown first, executed only on your explicit go-ahead.

---

## 7. When it breaks

Failure modes already documented in the field, and what each one means:

| Symptom | Most likely cause | Move |
|---|---|---|
| `present: false` | Flag not enabled in *this* profile (verify by reading `Local State`, not by remembering the click), or the client genuinely lacks it | On Chrome 152 with the flag on, `present: true` is confirmed — so suspect the profile first |
| `count: null` with `present: true` | `getTools()` returned a Promise and your code treated it as an array | Await it. This is the documented Chrome 152 behaviour, not a bug in the page |
| A *partial* tool set, no error, or `settled: false` | Read landed mid-registration; Airlock issues 7 sequential `await registerTool` calls, and settle took 2.5–4.0 s across two runs | Require stability, not non-emptiness: four identical reads, or listen to `WebMCP.toolsAdded` / `toolsRemoved` |
| `present: true`, `count: 0` | Probe ran before registration started | Poll with a deadline instead of reading once |
| `Failed to parse URL from http://127.0.0.1:9333 /json/new` | `cmd` kept the trailing space in a bare `set CDP_PORT=9333` | Quote it: `set "CDP_PORT=9333"` |
| Port answers a TCP check but `404`s on `/json/version` | Something other than a debug target holds the port (an ordinary Chrome does this on 9222 here) | Pick another port and pass it via `CDP_PORT` |
| `cdp-eval.mjs` exits `-1073740791` after printing JSON | libuv assertion in its exit path on Windows | Use the JSON, ignore the exit code, and fix the exit path before any of this becomes a CI gate |
| Registration throws in one client only | Frozen / partial `modelContext` — reported for ChatGPT's in-app browser | Read the method surface first, register defensively, record the surface as matrix data |
| Tool with a space in its name silently does nothing | Invalid name, no error surfaced (#145) | This is exactly what L0 exists to catch — add the rule |
| Whole feature silently off on a tool-heavy page | Per-page tool budget exceeded (296 tools reported disabling it entirely) | Run the budget probe, report headroom |
| `executeTool` rejects your arguments | String-vs-object signature drift between draft #246 and shipped builds | Handle both in the compat layer, key on build |
| Judge picks nothing, repeatedly | Weak or ambiguous descriptions — the actual finding | Classify `not_selected` and report it; do not "fix" it by hinting the model |
| `cdp-command.mjs` fails on import, or ignores your port | `chrome-remote-interface` doesn't resolve from `_spike\`, and the port is hardcoded to 9222 | Run it from `WebMCP\airlock\`, or from `webmcp-gauge\` where the dep is now pinned |
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
