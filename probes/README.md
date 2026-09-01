# Probes

One-off measurements. A probe answers a question about the browser, the fixture or a
finished run; it is not part of the measurement path, and nothing in `core/` imports
from here. They live in the repo rather than in a scratch directory because each one
is the evidence behind a claim in `PROJECT-LOG.md`, and a claim whose measurement
cannot be re-run is an anecdote.

| Probe | Question it answers | Last finding |
|---|---|---|
| `launch-probe.mjs` | Can the harness stand up its own flagged Chrome, and does that browser see WebMCP? | Yes on `152.0.7977.65`, cold profile, `--headless=new` |
| `fixture-manifest.mjs` | What did a fixture page *try* to register, and what did the browser hand back? | `registerTool` throws `"Invalid tool name"` for a name with a space; dotted names register |
| `webmcp-domain.mjs` | What does the CDP `WebMCP` domain expose, and does the browser's tool list agree with the page's? | No command lists tools — only `toolsAdded`/`toolsRemoved` events. The two views agreed at 7, 71, 187, 307 and 507 tools, and across an iframe |
| `chatgpt-browser-probe.mjs` | Can the ChatGPT desktop app's built-in browser be driven over CDP at all? (item 9) | **Yes.** Attach works, `--enable-blink-features=WebMCPTesting` at launch wakes `modelContext` on **both** `document` and `navigator`, and all 7 Airlock tools are readable. The WebMCP CDP domain exists but is not advertised in `/json/protocol` |
| `binary-webmcp-strings.mjs` | Which WebMCP feature/flag strings did a given browser binary compile in? | On the Codex/ChatGPT Chromium 151: `enable-webmcp-testing`, `WebMCPTesting`, `WebMCP`, `devtools-webmcp-support`, the CDP domain methods, and blink's `ModelContext` class — the machinery is all present; discovery needed the string dump to name the right switch |
| `compare-arms.mjs` | How do several finished runs compare per tool? | Prints rates with intervals, between-session σ, failure mix and the phrasing gradient |
| `utterance-floor.mjs` | Which utterances fail even on a well-described page? | One: `sum_by_category-12`, 12 of 13 (see `fixtures/README.md`) |
| `expr-*.js` | Raw evaluation expressions for hand-driven CDP sessions | Kept as the smallest reproductions of each browser fact |

## Next steps that land here

1. **`budget` and `compare` are probes pretending to be commands.** `docs/concept.md` sketches `webmcp-gauge budget <url>` and `webmcp-gauge compare base.json head.json`; today those are `webmcp-domain.mjs --flood` and `compare-arms.mjs`. Promote them only when their shape is settled — what a baseline is, and what counts as a regression, is not decided yet, and a CLI surface is much harder to change than a probe.
2. **The budget question is only answered for one client.** `webmcp-domain.mjs` found no ceiling on Chrome 152 up to 507 tools, which contradicts the 296-tool field report. Edge and the ChatGPT in-app browser are unmeasured, and they are where a budget would actually bite. The ChatGPT browser is now reachable for that measurement — `chatgpt-browser-probe.mjs` documents the launch recipe (MSIX path + `--remote-debugging-port` + `--enable-blink-features=WebMCPTesting`) — but the budget run has not been done.
3. **`WebMCP.invokeTool` is never exercised.** Execution goes through the page API (`document.modelContext.executeTool`), while a real client would invoke through the browser. A probe comparing the two paths on the same tool would turn "probably equivalent" into a compatibility row.
4. **Nothing here is tested**, on purpose — a probe is a measurement, not a component. If a probe's logic ever becomes load-bearing for a published number, it moves into `core/` or `browser/` and gets tests, as the manifest reader and the browser-side tool view both did.
