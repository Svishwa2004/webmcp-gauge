# webmcp-gauge — How to Start, and How the Project Flows

**Status:** measuring — steps 0–7 done, the cohort capture waits on the gallery (expected 2026-09-04); 4,040 trials published in `../reports/`, 175 tests pass
**Written:** 2026-08-29 · **Updated:** 2026-09-02
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
| ChatGPT desktop app | ✅ Verified 2026-09-01 — ships as the `OpenAI.Codex` MSIX (`Get-AppxPackage`; display name **ChatGPT**, entry point `app\ChatGPT.exe`), a **Chromium 151.0.7922.174** fork. CDP-drivable with `--remote-debugging-port`, and WebMCP appears only with `--enable-blink-features=WebMCPTesting`. Its browser profile lives under `…\Packages\OpenAI.Codex_…\LocalCache\Roaming\Codex\web\Codex\` (MSIX virtualization — `%APPDATA%\Codex` does not exist) |
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

**As of 2026-08-30 you no longer have to do this by hand for a sweep.** `webmcp-gauge run` launches its own browser per session: a brand-new profile whose `Local State` contains nothing but

```json
{"browser":{"enabled_labs_experiments":["enable-webmcp-testing@1"]}}
```

which is enough for Chrome 152 to expose `document.modelContext`, and it works in `--headless=new` — measured, not assumed. That gives every session a genuinely cold cache, and it means a CI gate is possible. Set `WEBMCP_GAUGE_CHROME_LOG=1` to see Chrome's own stderr when a launch fails; without it a bad launch looks like nothing but a DevTools timeout.

The manual route below is still what you want for interactive probing, and `--port` attaches the harness to a browser you started yourself — at the cost of sessions sharing a process and a page cache, which the report then flags.

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9333 --user-data-dir="D:\Projects\Hackthon-projects\WebMCP\_spike\chrome-baseline" --no-first-run --no-default-browser-check about:blank
```

⚠️ If you pass a **relative** `--user-data-dir`, Chrome may start against a different directory than the one you seeded and never open the debugging port. The only symptom is a timeout; the harness resolves the path to an absolute one for exactly this reason.

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
| 2 | ✅ **Done 2026-08-30** — Utterance set frozen at `1.3.0` | `webmcp-gauge\fixtures\airlock.utterances.json` + `airlock.utterances.test.mjs` | 7 tools × 20 phrasings at 7 plain / 7 paraphrase / 6 oblique, plus 20 negative controls, 24 tests green, reviewed line by line, `revisions` records the `1.2.0` → `1.3.0` bump and its reason, authoring model recorded as **`deepseek v4 by agentrouter`** — which is therefore disqualified as a judge for these numbers. `notes` records the 2026-09-01 decision to keep `sum_by_category-12` unchanged despite it missing on every manifest, so the set's own floor is documented rather than silently priced in |
| 3 | ✅ **Done 2026-08-30** — One trial, end to end | `core\trial.mjs`, `core\taxonomy.mjs`, `browser\session.mjs`, `browser\webmcp.mjs`, `judges\openai-compatible.mjs`, `webmcp-gauge trial` | Two live trials returned `ok` against Airlock with `glm-5.3` judging: `sum_by_category-05` (correct tool, `highlight: "Groceries"`, 95 rows highlighted) and `clear_highlights-09` via the seed protocol. Judge raw response attached to every record; 34 tests green |
| 4 | ✅ **Done 2026-08-30** — Full sweep, three times | `webmcp-gauge run --sessions 3 --repeats 2`, `reports\airlock-1.3.0-glm-5.3-s3r2.md` | Latest and best-isolated run: **960 trials** across three separate processes, browsers and cold profiles. Five tools at 100% [96.9%, 100.0%], `filter_rows` 99.2%, `sum_by_category` 94.2%; controls 0 false positives in 120; 10 outage trials excluded then recovered by `--resume`. Earlier `1.2.0` and `1.3.0` R=3 runs kept as superseded history |
| 5 | ✅ **Passed 2026-08-30 on between-session σ** — Variance gate | same command | σ between sessions **0.012** where anything varies, **0.000** at the ceiling, against a 5.8-point spread between best and worst tool. Confirmed larger than within-session σ (0.008), which is exactly why the earlier marking on within-session σ was optimistic |
| 6 | ✅ **Done 2026-08-30** — L0 linter + a deliberately broken fixture page | `webmcp-gauge lint`, `core\lint.mjs`, `fixtures\broken\` | 13 rules in four families, calibrated so the live reference page lints **0 errors, 0 warnings** while the degraded twin lints **6 errors, 13 warnings**. And the metric discriminates: same fixture page, same frozen utterance set, two manifests — **100.0% clean against 80.0% degraded**, with two tools at **35.0% [18.1%, 56.7%]** against a clean **[83.9%, 100.0%]**. Write-up: `reports\discrimination-2026-08-30.md` |
| 7 | ✅ **Closed 2026-09-02 on a recorded negative** — Mode B adapters | `probes\chatgpt-browser-probe.mjs`, `probes\invoke-paths.mjs`, `probes\mode-b-session.mjs` | The ChatGPT desktop app's own browser is CDP-drivable: launch `ChatGPT.exe --remote-debugging-port=<p> --enable-blink-features=WebMCPTesting` and the reference page's 7 tools read back through `modelContext` (on `document` and also `navigator` on the Chromium 151 build, `document` only on 152; the `WebMCP` CDP domain is present **and advertised** in `/json/protocol` — the 2026-09-01 claim that it was hidden was our own key-name bug, withdrawn 2026-09-03; `invokeTool` takes `{frameId, toolName, input:<object>}` and answers asynchronously). **But the agent does not look at that browser** — its page view is a Chrome extension bridge into the operator's ordinary Chrome, proven by two authorised prompts that produced no invocation and by the app's own context line. The column therefore ships **browser-automated, agent-unreached**; the corrected surface (a debugging port on a personal signed-in browser) was declined |

Step 2 has one rule that cannot be bent: **the model that writes the utterances must not be the model being judged on them**, or the metric measures self-consistency instead of usability. Write them yourself, or generate with one model and judge with another, and freeze the file so numbers stay comparable across commits.

---

## 3. The flow of a single measurement

This is the pipeline the whole product is built around. Every stage maps to something that already exists or is a thin wrapper on it.

```
session → launch → attach → load → wait → capture manifest → select → classify → execute → classify → reset → aggregate
```

0. **Session** — the outer loop, and the one that took two sweeps to get right. A session is one OS process, one browser, one cold profile: `webmcp-gauge run --sessions 3` spawns three `session` children, each launching its own Chrome from a fresh `user-data-dir`. Repeats *inside* a session share a warm page, a renderer and one judge connection pool, so their σ describes session stability; only σ **between** sessions speaks to reproducibility. The report prints both and never merges them.

1. **Launch** — the harness seeds a cold profile with the WebMCP flag and starts `--headless=new` Chrome on a free port, per session. `--port` attaches to a browser you started instead, and the report then records that sessions were not isolated.
2. **Attach** — fresh tab via `PUT /json/new`, then `Page.enable`, `Runtime.enable`, `WebMCP.enable`. *(Pattern: `cdp-eval.mjs`.)*
3. **Load** — navigate, wait for `Page.loadEventFired`.
4. **Wait for registration** — `getTools()` returns a **Promise** on Chrome 152, so await it, and wait for the returned set to *stop changing* rather than to be non-empty: a mid-registration read against Airlock returned 3 of 7 tools with no error. Prefer the `WebMCP.toolsAdded` / `toolsRemoved` events over polling. Treating "not yet" as "not registered" is the easiest way to produce a wrong number.
5. **Capture the manifest** — names, descriptions, input schemas, annotations, and the client's actual method surface. This single artifact feeds the linter, the judge and the compatibility matrix.
6. **Select** — hand *(manifest + one utterance)* to the judge model behind a provider-agnostic adapter. It returns a chosen tool (or none) plus arguments. **Fresh context per utterance** — any conversational carry-over means trial N contaminates trial N+1.
7. **Classify, pre-execution** — `not_registered` · `not_discovered` · `not_selected` · `wrong_tool` · `bad_args` (validated against the captured schema). `not_discovered` needs a second, independent view of the tool set, so every trial also accumulates the browser's own via `WebMCP.toolsAdded` / `toolsRemoved` — started **before** navigation, because the browser announces tools through events and has no command that lists them. On Chrome 152 the two views have never disagreed; when they do, the page-side read alone would have called it `not_registered`.
8. **Execute** — only if the choice is right and the arguments validate. Two paths exist and they are not equivalent: the page API (`document.modelContext.executeTool`) and the browser's own `WebMCP.invokeTool` over CDP, which is closer to what a real client does. Capture the result plus any observable state change. This is where the compatibility layer earns its place: the draft moved `executeTool` to an object argument on 2026-08-17, while the type surface verified against Chrome 151 still takes a JSON string, so the call shape is per-build, not per-spec.
9. **Classify, post-execution** — `exec_error` · `silent_fail` (returned, but nothing observably changed) · `ok`.
10. **Reset** — close the tab and discard all state. Every trial starts from a clean page, or you are measuring the order of your utterances. The exception is declared, not improvised: a tool whose utterances presuppose state (`clear_highlights` — "clear that", "the table's hard to read now") carries a `setup.seedCall` in the fixture. Apply it before the trial, never score it, and keep it out of the manifest offered for the trial's own selection decision. Without the seed those utterances have no referent and a competent agent may reasonably decline — which would land as `not_selected` and read as a description failure that is really a harness bug.
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
  .env.example            judge credentials; copy to .env for scheduled runs
  docs/
    concept.md            what and why (technical)
    explainer.md          plain language, non-technical
    getting-started.md    this file
  bin/webmcp-gauge.mjs    CLI entry — trial | run | session | lint
  core/                   taxonomy, Wilson intervals, sweep, orchestrator, CI gate, L0 linter,
                          cohort.mjs + gallery.mjs (capture rules, under test because the capture cannot repeat)
  browser/                Chrome launch, CDP session, WebMCP page + browser views, fixture server
  judges/                 model adapters behind one interface (one so far: OpenAI-compatible)
  report/                 JSON + Markdown emitters, badge.mjs, scorecard.mjs (private per-project feedback)
  probes/                 one-off measurements: launch, fixture manifest, WebMCP domain, arm comparison,
                          invoke paths, frame scope, cohort snapshot, gallery harvest, scorecard rendering
  fixtures/               frozen utterance sets; broken/ (the degraded twin and its widget);
                          spec-227/ (the frame-scope repro behind the spec contribution); cohort/ (target lists);
                          gallery/ (a two-page stand-in for rehearsing the gallery walk)
  scripts/                scheduled-run glue (spaced-session.cmd, wait-for-session.ps1)
  reports/                published runs: report.md + report.json per run, plus the write-ups and badges
  artifacts/              git-ignored working output: checkpoints, logs, session profiles, captures
  clients/                chrome-ot | chatgpt | edge | brave adapters        (not built — but the chatgpt browser layer is proven: probes\chatgpt-browser-probe.mjs)
  action.yml              GitHub Action wrapping lint + run                 (built 2026-09-01)
  .github/workflows/      the workflow that self-tests the linter on this repo's own twin
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

### L0 in practice — lint before you measure

```
webmcp-gauge lint --url https://your-page.example            # live manifest
webmcp-gauge lint --manifest ./tools.json                    # what the source declares
webmcp-gauge lint --serve fixtures/broken --url "twin.html?variant=degraded"
```

No judge, no API key, seconds rather than minutes: it reads the manifest and applies thirteen rules across names, descriptions, schemas and tool-count budget. Exit `0` clean, `1` findings at or above `--fail-on` (default `error`), `2` nothing to lint — no WebMCP surface, a tool set that never settled, or zero tools.

Run both modes, because they answer different questions. Chrome `152.0.7977.65` **throws `"Invalid tool name"`** when a page registers a name containing a space, so the worst names never reach `getTools()` and a live lint cannot see them; `--manifest` reads what the source declares. Conversely only the live mode catches what the browser actually did with what the page tried to register.

Thresholds are calibrated on the reference page rather than invented, and all of them are flags (`--min-description`, `--max-properties`, `--budget-warn`). Verified 2026-08-30: the live reference page lints **0 errors, 0 warnings**, and the deliberately mis-described fixture twin lints **6 errors, 13 warnings**.

A clean lint is not a measured invocation rate. L0 says the manifest is well formed; only `run` says an agent picks these tools.

### The CI gate, and what each exit code is allowed to mean

```
webmcp-gauge run --sessions 1 --repeats 1 --fail-under 0.9 --out artifacts/ci
```

| Code | Meaning | What CI should do |
|---|---|---|
| `0` | Every planned trial measured, nothing below the threshold | Continue |
| `1` | Every planned trial measured, a tool's rate is below `--fail-under` | Fail the build: this is the page |
| `2` | The run cannot answer — planned trials have no measurement, or the arguments were unusable | Re-run with `--resume`; do not report a regression |

Three decisions inside that table are load-bearing, and each one was a way to get a wrong answer:

- **Incomplete outranks a breach.** Before this split, any harness failure exited 1, so "two trials need a `--resume`" and "the invocation rate fell off a cliff" were the same signal. Gaps are not random — the 960-trial sweep lost ten trials to one network blip, all inside a single session-repeat window — so a rate over a run with holes is a rate over a denominator the run did not choose.
- **Completeness comes from the plan, not the failure log.** A log only knows about trials that failed loudly; a session killed mid-plan leaves no entry at all. The report therefore carries `coverage` — planned, measured, missing, and the first ten missing keys as `session:repeat:utterance`.
- **The threshold gates the point rate, not the Wilson lower bound.** 20 of 20 has a lower bound of 83.9%, so gating on the bound would fail a page that never missed once, purely on sample size. The interval is printed beside the rate, and the verdict says when a breach sits inside it.

The verdict is written into `report.json` as `gate` and into the Markdown as a `**Gate:**` line, so the artifact carries the same claim the exit code made. Control false positives are **not** gated yet: a false-positive ceiling is a separate flag and a separate decision, and pretending `--fail-under` covers safety would be worse than leaving it out.

---

## 6. Decision gates

Explicit stop-and-think points, so momentum doesn't carry a broken premise forward:

**Gate 1 — §1 ground check.** ✅ **Cleared 2026-08-30**: Chrome 152 sees WebMCP, so it is the reference client. The gate does not retire, it recurs — re-run §1 after any browser update or when adding a client, and do not build against a browser you have not confirmed.

**Gate 2 — the variance gate (step 5).** ✅ **Passed 2026-08-30 on between-session σ**, which is the figure that was missing when this gate was first marked. Across 960 trials in three isolated sessions — separate OS processes, separate browsers, cold profiles — σ between sessions is **0.012** for the two tools that fail at all and **0.000** for the five that never do, against a 5.8-point spread between the best and worst tool. Signal exceeds noise by roughly five to one.

Three caveats stay on the record. Where σ reads 0.000 the tool never failed in 120 trials, so that is a ceiling effect and the interval `[96.9%, 100.0%]` carries the real uncertainty. Sessions ran back to back on one machine, so drift across hours or days is unmeasured — and `sum_by_category-12`'s wrong answer moved from `describe_dataset` in two earlier sweeps to `find_anomalies` in all six trials of this one. The third caveat — that discrimination was unproven because the numbers came from a page chosen for being well described — was **closed on 2026-08-30 and explained on 2026-08-31**: 1,320 trials over a clean and a degraded twin of the same page, plus four single-defect ablations, read **99.3% against 83.1%** overall, with `sum_by_category` 95.0% → **60.0%** and `top_expenses` 100% → **26.7%**, against a between-session σ of at most **0.094**. See `reports\ablation-2026-08-31.md`, which adds two things this gate should carry: defects **compound** rather than add (−5.0 and −3.3 alone, **−35.0** together), and `sum_by_category-12` fails 12 of 12 even with the reference description — so that one is a question about the utterance set, not about the page.

Between-session σ was also confirmed **larger than within-session σ** (0.012 against 0.008), which is why the earlier gate marking was optimistic rather than wrong. The axis that was open when this gate was first written — every published run had sessions **minutes** apart — was closed on 2026-09-01: the degraded twin was re-measured at 3 sessions spread **17.2 h and 9.2 h apart** across a day boundary, 480/480 trials, same shape as the back-to-back arm whose σ was 0.041 and 0.062. **σ did not grow with spacing** (0.085 worst case against 0.062, and the two load-bearing tools swap places), so the reproducibility figures above hold at day scale. What did move is the point estimates: both mid-range tools declined **monotonically** across the 26-hour span — `sum_by_category` 60 → 45 → 40, `top_expenses` 40 → 35 → 30 — from a starting point that matched the back-to-back arm measured 48 minutes earlier. At n=20 per session per tool that is suggestive, not established, and the refilled trials do not explain it. Consequence for this gate: **a single arm measured at one time is sound; a page compared against itself across days inherits a drift question.** See `reports\spacing-2026-09-01.md`.

If a later run shows σ swamping the difference between a good and a bad description, the options are unchanged: raise K, pin the judge harder, redesign the trial, or publish the negative result. What is not an option is shipping a number you do not believe.

**Gate 3 — Mode A ↔ Mode B correlation.** If the cheap loop does not predict the real clients, the CI product is dead and the finding becomes the deliverable. Both branches are publishable; only pretending is not.

❌ **Unanswered, and closed as such on 2026-09-02.** Not passed, not failed — unreached. The blocker that stood in front of it is gone (the ChatGPT desktop browser is CDP-drivable, step 7), but the *agent* does not look at that browser: its page view is a Chrome extension bridge into the operator's ordinary Chrome. Reaching it would mean running a debugging port on a signed-in personal browser, and the maintainer declined. So **no correlation number exists, and none may be implied** — every published rate in `../reports/` is a Mode A number, and the assumption that Mode A predicts a real client remains an assumption.

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
| `present: false` in the ChatGPT desktop app's browser | That build ships WebMCP behind a runtime feature, and its `Local State` labs entries are inert | Launch it as `ChatGPT.exe --remote-debugging-port=<p> --enable-blink-features=WebMCPTesting`, and wait — CDP answers about 12 s later. Measured 2026-09-01 and again 2026-09-03 after the app updated: with the switch, all 7 reference tools read back on both builds. `modelContext` sat on **both** `document` and `navigator` on Chromium `151.0.7922.174`, and on `document` only on `152.0.7977.64` — that difference tracks the Chromium version, not the vendor. `probes\chatgpt-browser-probe.mjs` |
| A CDP domain is missing from `/json/protocol` but you expect it | **Check your own read first** — entries are keyed `domain`, not `name`, and a test against `name` is silently false for every domain of every build. That exact bug cost this project a published finding on 2026-09-01, withdrawn 2026-09-03 | Read it with `$_.domain -eq '<Domain>'`, print the domain **count** beside the verdict, and then call the domain and call a made-up one: on the ChatGPT build `WebMCP.enable` is accepted while a bogus domain returns `-32601`. Falsify against a bogus domain before concluding either way |
| Tool with a space in its name silently does nothing | Invalid name, no error surfaced (#145) | This is exactly what L0 exists to catch — add the rule |
| Whole feature silently off on a tool-heavy page | Per-page tool budget exceeded (296 tools reported disabling it entirely) | ⚠️ Does **not** reproduce on either client measured: 507 registered tools were all accepted, listed and surfaced on Chrome 152 (2026-08-31) and on the ChatGPT app's Chromium 152 (2026-09-03). If you see this, record the client and build — that is a new data point, not a known one |
| `executeTool` rejects your arguments | Signature drift. **Measured on Chrome 152**: the accepted form is `executeTool(registeredTool, jsonString)` — the first argument must be the object from `getTools()`, and the second a JSON *string*. `{name, arguments}` fails with "2 arguments required, but only 1 present", and a name string fails with "not of type 'RegisteredTool'" | `browser\webmcp.mjs` tries four shapes and reports which one worked; add a row rather than hard-coding one |
| Judge picks nothing, repeatedly | Weak or ambiguous descriptions — the actual finding | Classify `not_selected` and report it; do not "fix" it by hinting the model |
| `run` exits 2 saying planned trials have no measurement | A judge outage, a page that never loaded, or a session that died mid-plan. The rates printed are over an incomplete denominator | `run --resume --out <same dir>` fills exactly the missing trials; the report then counts them as recovered. Never read exit 2 as a threshold breach |
| `run --fail-under 90` exits 2 immediately | The threshold is a rate, not a percentage — `90` would fail every build forever | Pass `0.9`. The CLI refuses the ambiguous form rather than gating on it |
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
