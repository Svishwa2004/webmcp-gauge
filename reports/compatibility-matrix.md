# WebMCP client compatibility matrix

*Last updated 2026-09-03. Every Chrome-152 row in it was re-measured that day.*

One page for the question this project keeps being asked sideways: **the same page, the same code — why does it behave differently in another client?** Every cell below is something measured on this machine, and carries the date it was measured and the probe that produced it. Nothing here is read off the specification, a release note or an issue thread; where a measurement disagrees with one of those, the row says so.

This file is deliberately **not** dated in its filename, unlike the run write-ups beside it. A run is a measurement taken once and never edited; a matrix accretes columns as clients are measured, so the date lives in the cell rather than in the name.

## How to read it

- Dates are 2026, written `MM-DD`. Probe names are files in [`../probes/`](../probes/) — **every row is re-runnable**, and a claim whose measurement cannot be re-run does not belong here. The commands are listed at the bottom.
- ✅ measured, works as a developer would hope · ⚠️ measured, and surprising · ❌ measured absent or refused · **—** *not measured on that build.* A dash never means "probably the same as the other column".
- Behaviour is a property of *(build, flag state, platform)*. Everything here is one machine, Windows, and activated by a flag rather than by an origin trial.

## The builds

| Column | Build | How WebMCP was switched on |
|---|---|---|
| **Chrome 152** | Chrome `152.0.7977.65`, Windows, headed and `--headless=new`, a cold profile per session | `enabled_labs_experiments: ["enable-webmcp-testing@1"]` seeded into the fresh profile's `Local State` — the programmatic equivalent of `chrome://flags/#enable-webmcp-testing`. The `--enable-features=` token for it has never been confirmed from a primary source and was never guessed at |
| **ChatGPT 151** | ChatGPT desktop app: OpenAI's own Chromium fork `151.0.7922.174`, shipped as MSIX `OpenAI.Codex 26.825.6671.0`, entry point `app\ChatGPT.exe`, renderers carrying `--owl-scoped-user-agent-prefix=CodexBrowser` | `--enable-blink-features=WebMCPTesting` at launch. The profile labs entry that works for Chrome is **inert** here in all three forms tried; the switch was found by dumping the binary's own flag strings |

⚠️ **The fork column is already historical.** As of 2026-09-03 the installed package is `OpenAI.Codex 26.831.2377.0`, carrying Chromium **`152.0.7977.64`** — one patch *below* the Chrome column. Everything in the ChatGPT 151 column was measured on a build that is no longer on this machine. See [What the fork bump makes testable](#what-the-fork-bump-makes-testable).

## Finding the API

| Behaviour | Chrome 152 | ChatGPT 151 |
|---|---|---|
| Entry point | ✅ `document.modelContext` **only**; `navigator.modelContext` is absent — 08-30, re-verified 09-03, `expr-modelcontext.js` | ⚠️ **both** `document.modelContext` and `navigator.modelContext` present — 09-01, `chatgpt-browser-probe.mjs` |
| Activation | ✅ profile labs entry `enable-webmcp-testing@1`, seeded into a cold profile with no flag UI — 08-30 → 09-03, `launch-probe.mjs` | ⚠️ labs entry **inert** (`enable-webmcp-testing@1`, `WebMCPTesting@1`, `WebMCP@1` all did nothing); the working lever is the launch switch `--enable-blink-features=WebMCPTesting`, and `--enable-features=` was never needed — 09-01, `binary-webmcp-strings.mjs` |
| Headless | ✅ `--headless=new` exposes the full surface with the flag seeded — every published run in this folder is headless — 08-30 → 09-03, `launch-probe.mjs` | **—** a desktop shell; not attempted |

## Reading the manifest

| Behaviour | Chrome 152 | ChatGPT 151 |
|---|---|---|
| `getTools()` return type | ⚠️ a **`Promise`**, resolving to an array. A synchronous read returns no usable count — which is exactly how this project's own first getting-started snippet came to be wrong — 08-30, re-verified 09-03 (`getTools().constructor.name` → `Promise`) | **—** tools were read with an awaited call; a synchronous read was not tried |
| `inputSchema` on the read-back path | ⚠️ **a JSON string, not an object.** The page registers `{type:'object',…}`; `getTools()` hands back `"{\"type\":\"object\",…}"`, `typeof` → `string` for all 7 reference tools. #241's `DOMString`→`object` move has not landed here, so anything reading `inputSchema.properties` silently gets `undefined`. The harness parses it in-page and records `inputSchemaWire` (`object` / `string` / `absent` / `unparseable-string`) per tool — 08-30, re-verified 09-03 | ⚠️ **identical — a JSON string** — 09-01, `chatgpt-browser-probe.mjs` |
| Descriptor fields | ✅ `annotations`, `description`, `inputSchema`, `name`, `origin`, `title`, `window`. `origin` and `window` are beyond the draft surface recorded in this project's research, and are worth capturing — 08-30, re-verified 09-03 | **—** the first descriptor's schema wire type was recorded; the full key set was not |
| Manifest order | ⚠️ **alphabetical, not registration order.** The twin fixture registers `describe_dataset, sum_by_category, filter_rows, …, top.expenses.v2` and `getTools()` returns them alphabetised. It matters because manifest order is the order a model reads the tools in — 08-30, re-verified 09-03, `fixture-manifest.mjs` | **—** the 7 names came back alphabetically, and a Chrome-side partial read (`describe_dataset, filter_rows, sum_by_category`, not an alphabetical prefix) says the reference page's registration order is not alphabetical either — so this is suggestive, but no fixture with a known source order was run on this build |
| Registration settles late, in batches | ⚠️ an early read returns a **subset** — 3 of 7 observed on the reference page. A reader must wait for the set to *stop changing*; "non-empty" silently reports part of a manifest as all of it. Settle 1.02–1.04 s at 7 tools, 1.30 s at 507 — 08-30 / 08-31, re-verified 09-03 (`settledAtMs` 1019 and 1035) | ✅ present and settled when read; settle time not recorded — 09-01 |

## What the page is allowed to register

| Behaviour | Chrome 152 | ChatGPT 151 |
|---|---|---|
| A tool name containing a space | ⚠️ **`registerTool` throws `"Invalid tool name"`** and the tool never registers. Spec issue #145 reports that such a tool "silently does nothing"; on this build it is loud and total. The structural consequence: **a live manifest cannot show the worst names**, because they are never in it — which is why `webmcp-gauge lint --manifest` reads what the source declares, and why live mode is not a superset of it — 08-30, re-verified 09-03 (`"Clear Highlights"` rejected, the other 9 registered) | **—** |
| A dotted tool name (`top.expenses.v2`) | ✅ registers and appears in `getTools()` — 08-30, re-verified 09-03, `fixture-manifest.mjs` | **—** |
| Per-page tool budget | ✅ **no ceiling found up to 507 tools** — every one accepted, listed and surfaced, settle rising only 1.04 s → 1.30 s. The field report of **296 tools silently disabling WebMCP for a whole page does not reproduce**; this project's `budget/headroom` lint rule was demoted from error to warning because of it — 08-31, `webmcp-domain.mjs 0,507` | **—** unmeasured, and cheaply reachable: the launch recipe and the flood fixture both exist |

## Frames, embeds and delegation

Cross-origin below is a **different port on `127.0.0.1`** — a distinct origin, the same site. Chrome isolates by site, so that child is not an out-of-process iframe and has no CDP target of its own; it is reached through the page session's frame tree. A cross-**site** test needs real hostnames and has not been run.

| Behaviour | Chrome 152 | ChatGPT 151 |
|---|---|---|
| Same-origin subframe's tools | ⚠️ **fold into the host's manifest.** Host registers 3, embed registers `widget_ping`, the **top** frame's `getTools()` returns all 4; the browser's view agrees at 4 across 2 `frameId`s. Seen again as 7 + 1 = 8 on the twin. An embed can add tools to its host's agent surface — 08-31 / 09-02, re-verified 09-03, `frame-scope.mjs` | **—** the vendor's own documentation claims no iframe tool discovery in this client; unmeasured by us |
| Cross-origin embed, no `allow` | ⚠️ **gated by a Permissions Policy feature named `tools`.** `document.modelContext` *exists* in the child, and every call throws `Access to the feature "tools" is disallowed by permissions policy.` Host sees its own 3; browser sees 3 across 1 frame — 09-02, re-verified 09-03, `frame-scope.mjs` | **—** |
| Cross-origin embed with `allow="tools"` | ⚠️ **the embed registers, and no script-visible surface returns the union.** Host `getTools()` → 3, the embed's own → `["widget_ping"]`, the browser → 4 across 2 frames. A host page **cannot enumerate what an agent can actually call on it.** The only page-view/browser-view divergence this project has found, and it reproduces across runs — 09-02, re-verified 09-03, `frame-scope.mjs` | **—** |

## The browser's own view (CDP)

| Behaviour | Chrome 152 | ChatGPT 151 |
|---|---|---|
| `WebMCP` CDP domain | ✅ present and **advertised** in `/json/protocol`, marked experimental. Commands `enable`, `disable`, `invokeTool`, `cancelInvocation`; events `toolsAdded`, `toolsRemoved`, `toolInvoked`, `toolResponded` — 08-30 / 08-31, re-verified 09-03, `webmcp-domain.mjs` | ⚠️ **works, and is not advertised.** `/json/protocol` lists 57 domains and `WebMCP` is not among them, yet `WebMCP.enable` is accepted while `BogusProbe.enable` is rejected with `-32601`. Presence must be probed, never read off the protocol file — 09-01, `chatgpt-browser-probe.mjs` |
| Listing tools browser-side | ⚠️ **no command does it.** The browser's view can only be *accumulated* from `toolsAdded` / `toolsRemoved`, one event per registration — so the subscription must be attached **before navigation**, or the events are already gone and a reader concludes the browser surfaced nothing — 08-31, re-verified 09-03 | **—** the same four command names are compiled into the fork's `chrome.dll`, which is a string table rather than a protocol read — 09-01, `binary-webmcp-strings.mjs` |
| Browser-side tool metadata | ✅ richer than the page's: the `Tool` type carries `name`, `description`, `inputSchema`, `annotations`, `frameId`, `backendNodeId`, `stackTrace`. So **provenance exists browser-side and not page-side** — `getTools()` returns no frame or origin attribution, and a host page cannot tell its own tools from an embed's — 09-03 protocol read, 09-02 in use for the #227 contribution | **—** |
| `invokeTool` parameter shape | ⚠️ documented nowhere citable; walked out of the CDP deserializer's own `-32602` errors, one mandatory field per call. `invokeTool({frameId, toolName, input: <object>})` → `{invocationId}`, **not** the result; the result arrives asynchronously as `toolResponded {invocationId, status:"Completed", output}`, `output` a parsed **object** — 09-01, parameter names re-verified 09-03, `invoke-paths.mjs` | ⚠️ **identical** — same call, same asynchrony, same payload — 09-01, `invoke-paths.mjs` |
| Page path vs browser path | ⚠️ same answer, incompatible ergonomics. Page: `executeTool(toolObject, jsonString)`, awaitable, payload a **string**. Domain: subscribe-then-correlate, payload an **object**. An adapter cannot treat them as interchangeable, and the argument encoding is inverted between them — 09-01, `invoke-paths.mjs` | ⚠️ identical — 09-01 |
| `toolInvoked` | ✅ carries `{toolName, frameId, invocationId, input}`, which is what makes a CDP client a passive recorder of tool selection rather than a driver of it. ⚠️ Verified only for invocations **this project** makes; whether it fires when a real agent invokes is **unobserved** — 09-01, parameter names re-verified 09-03 | ⚠️ event present, same caveat — 09-01 |

## What this contradicts, confirms and bounds

| Issue or report | Status here |
|---|---|
| **#145** — a tool name with a space "silently does nothing" | ❌ **contradicted** on Chrome 152: `registerTool` throws `"Invalid tool name"` — 08-30, re-verified 09-03 |
| **#241** — `inputSchema` moving `DOMString` → `object` | ⚠️ **not landed in the read-back path** on either build measured — 08-30 / 09-01 |
| **#266** — the namespace moving off `navigator` | ✅ **confirmed** on Chrome 152 (absent), ⚠️ and still present on the Chromium 151 fork — 08-30 / 09-01 |
| **#268** — tools visible in Brave 1.94 but not in Chrome `152.0.7977.65` or Edge 151 | ❌ **not reproduced** on that exact Chrome build: with the flag enabled, all 7 reference tools are read on a cold profile — 08-30, re-verified 09-03. This **bounds** the report rather than explaining it; Brave and Edge are unmeasured here |
| **#227** — should discovery reach beyond one traversable navigable? | A measured baseline was contributed to the thread: same-origin folds into the host, cross-origin needs `allow="tools"`, and once delegated nobody can list the union — 09-02 |
| Field report: **296 registered tools silently disable WebMCP** | ❌ **not reproduced** to 507 tools on Chrome 152 — 08-31 |

## What the fork bump makes testable

The single behavioural divergence between the two columns — `navigator.modelContext` alive in the fork, gone in Chrome — is most simply explained by **Chromium version rather than vendor**: the fork was 151, the alias was removed in 152 per #266, and the fork now ships `152.0.7977.64`. The honest reading today is that this looks like a *151* behaviour, not a *ChatGPT* behaviour. Re-running `chatgpt-browser-probe.mjs` against the updated app would settle it, along with whether the undocumented domain is still unadvertised and whether the activation switch survived the bump. Until that is run, the row stays as measured with the caveat attached rather than resolved.

The general lesson for anyone maintaining a matrix like this: **a fork column ages faster than a stable-channel column**, and it can age out silently, because nothing announces an MSIX update.

## Reproducing any row

```
node probes/launch-probe.mjs                                 # activation, entry point, settle, 7 tools
node probes/fixture-manifest.mjs "twin.html?variant=degraded" # invalid name, dotted name, manifest order
node probes/webmcp-domain.mjs 0                              # domain surface, page view vs browser view
node probes/webmcp-domain.mjs 0,507                          # the budget row (minutes, not seconds)
node probes/frame-scope.mjs                                  # the three frame rows
node probes/invoke-paths.mjs --launch                         # both execution paths on our own Chrome
```

The descriptor-shape rows — `getTools()` returning a `Promise`, `typeof inputSchema`, the key set, `navigator.modelContext` — come from evaluating [`../probes/expr-modelcontext.js`](../probes/expr-modelcontext.js) in a hand-driven session. The exact one-liner behind those cells on 2026-09-03:

```
node --input-type=module -e "const {launchSession}=await import('./browser/launch.mjs');const {openSession}=await import('./browser/session.mjs');const {captureManifest}=await import('./browser/webmcp.mjs');const b=await launchSession({profileDir:'artifacts/wire-check'});const t=await openSession({port:b.port});await t.navigate('https://airlock-app.netlify.app');const m=await captureManifest(t);const raw=await t.evaluate('(async()=>{const ts=await document.modelContext.getTools();return JSON.stringify({keys:Object.getOwnPropertyNames(ts[0]),schemaType:typeof ts[0].inputSchema,navHas:navigator.modelContext!==undefined,getToolsReturns:document.modelContext.getTools().constructor.name})})()');console.log(JSON.stringify({build:b.build,wire:m.tools.map(x=>x.inputSchemaWire),raw:JSON.parse(raw)}));await t.close();await b.close();"
```

The two fork rows need the app started first, then a probe attached to it:

```
Start-Process 'C:\Program Files\WindowsApps\OpenAI.Codex_<version>_x64__2p2nqsd0c76g0\app\ChatGPT.exe' `
  -ArgumentList '--remote-debugging-port=9333','--enable-blink-features=WebMCPTesting'
node probes/chatgpt-browser-probe.mjs                        # entry point, schema wire, domain presence
node probes/binary-webmcp-strings.mjs '<install path>\app\chrome.dll'   # which flag names a build compiled in
```

## Not measured, and not guessed

Brave and Edge — the two clients #268 names beside Chrome — are unmeasured, as are Firefox and Safari (neither has an implementation to measure) and Gemini-in-Chrome. Also open: the ChatGPT app's current Chromium 152 build; the tool budget on anything but Chrome 152; cross-**site** frames and `Permissions-Policy` as a response header rather than an `allow` attribute; whether `toolInvoked` fires when a real agent invokes; and whether any of this differs under an origin trial rather than a flag.

Everything above is browser behaviour measured against this project's own pages — the live reference page (`airlock-app.netlify.app`, authored by this project's maintainer) and the local fixtures in [`../fixtures/`](../fixtures/). **No third-party site's data appears in this file**, which is why it is publishable while the cohort work is not. The long form of every row, including the wrong turns that preceded it, is in [`../PROJECT-LOG.md`](../PROJECT-LOG.md).
