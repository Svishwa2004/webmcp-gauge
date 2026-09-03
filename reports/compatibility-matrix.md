# WebMCP client compatibility matrix

*Last updated 2026-09-03. Every Chrome row was re-measured that morning, and the ChatGPT desktop build was re-measured the same day on its new Chromium — which settled one row and withdrew another.*

One page for the question this project keeps being asked sideways: **the same page, the same code — why does it behave differently in another client?** Every cell below is something measured on this machine, and carries the date it was measured and the probe that produced it. Nothing here is read off the specification, a release note or an issue thread; where a measurement disagrees with one of those, the row says so.

This file is deliberately **not** dated in its filename, unlike the run write-ups beside it. A run is a measurement taken once and never edited; a matrix accretes columns as clients are measured, so the date lives in the cell rather than in the name. A superseded column is **kept**, not overwritten — see [Corrections](#corrections).

## How to read it

- Dates are 2026, written `MM-DD`. Probe names are files in [`../probes/`](../probes/) — **every row is re-runnable**, and a claim whose measurement cannot be re-run does not belong here. The commands are listed at the bottom.
- ✅ measured, works as a developer would hope · ⚠️ measured, and surprising · ❌ measured absent, refused, or withdrawn · **—** *not measured on that build.* A dash never means "probably the same as the column beside it".
- Behaviour is a property of *(build, flag state, platform)*. Everything here is one machine, Windows, and activated by a flag rather than by an origin trial.

## The builds

| Column | Build | How WebMCP was switched on |
|---|---|---|
| **Chrome 152** | Chrome `152.0.7977.65`, Windows, headed and `--headless=new`, a cold profile per session | `enabled_labs_experiments: ["enable-webmcp-testing@1"]` seeded into the fresh profile's `Local State` — the programmatic equivalent of `chrome://flags/#enable-webmcp-testing`. The `--enable-features=` token for it has never been confirmed from a primary source and was never guessed at |
| **ChatGPT 151** | ChatGPT desktop app on Chromium `151.0.7922.174`, MSIX `OpenAI.Codex 26.825.6671.0`. **Superseded on this machine** — kept because a measurement that was taken does not stop having been taken | `--enable-blink-features=WebMCPTesting` at launch. The profile labs entry that works for Chrome is **inert** here in all three forms tried; the switch was found by dumping the binary's own flag strings |
| **ChatGPT 152** | The same app after its update: Chromium `152.0.7977.64`, MSIX `OpenAI.Codex 26.831.2377.0`, entry point `app\ChatGPT.exe` | The **same switch, still required and still sufficient** — it survived the version bump. CDP answered 12 s after launch, which is a startup delay rather than a refusal |

Nothing announced that update. The 151 column was measured on 2026-09-01 and the build was gone by 2026-09-03, which is the general warning this file carries: **a fork column ages faster than a stable-channel column, and it ages out silently.**

## Finding the API

| Behaviour | Chrome 152 | ChatGPT 151 | ChatGPT 152 |
|---|---|---|---|
| Entry point | ✅ `document.modelContext` **only**; `navigator.modelContext` absent — 08-30, re-verified 09-03, `expr-modelcontext.js` | ⚠️ **both** `document` and `navigator` — 09-01, `chatgpt-browser-probe.mjs` | ✅ `document` **only**, `navigator.modelContext` gone (`inNavigator: false`) — 09-03. **So the 151 reading was a Chromium-version behaviour, not a vendor one**: #266 removed the alias in the 152 line, and the fork followed it there |
| Activation | ✅ profile labs entry `enable-webmcp-testing@1`, seeded into a cold profile with no flag UI — 08-30 → 09-03, `launch-probe.mjs` | ⚠️ labs entry **inert** (`enable-webmcp-testing@1`, `WebMCPTesting@1`, `WebMCP@1` all did nothing); the working lever is `--enable-blink-features=WebMCPTesting`, found by dumping `chrome.dll`'s flag strings — 09-01, `binary-webmcp-strings.mjs` | ✅ same switch, unchanged by the bump; 7 tools read back settled — 09-03, `chatgpt-browser-probe.mjs` |
| Headless | ✅ `--headless=new` exposes the full surface with the flag seeded — every published run in this folder is headless — 08-30 → 09-03 | **—** a desktop shell; not attempted | **—** likewise |

## Reading the manifest

| Behaviour | Chrome 152 | ChatGPT 151 | ChatGPT 152 |
|---|---|---|---|
| `getTools()` return type | ⚠️ a **`Promise`**, resolving to an array. A synchronous read returns no usable count — which is how this project's own first getting-started snippet came to be wrong — 08-30, re-verified 09-03 (`getTools().constructor.name` → `Promise`) | **—** read with an awaited call; a synchronous read was not tried | **—** likewise |
| `inputSchema` on the read-back path | ⚠️ **a JSON string, not an object.** The page registers `{type:'object',…}`; `getTools()` hands back `"{\"type\":\"object\",…}"`, `typeof` → `string` for all 7 reference tools. #241's `DOMString`→`object` move has not landed here, so anything reading `inputSchema.properties` silently gets `undefined`. The harness parses it in-page and records `inputSchemaWire` per tool — 08-30, re-verified 09-03 | ⚠️ **identical — a JSON string** — 09-01 | ⚠️ **identical, still** (`inputSchemaWire: "string"`) — 09-03 |
| Descriptor fields | ✅ `annotations`, `description`, `inputSchema`, `name`, `origin`, `title`, `window`. `origin` and `window` are beyond the draft surface this project recorded — 08-30, re-verified 09-03 | **—** only the first descriptor's schema wire type was recorded | **—** likewise |
| Manifest order | ⚠️ **alphabetical, not registration order.** The twin registers `describe_dataset, sum_by_category, filter_rows, …, top.expenses.v2` and `getTools()` returns them alphabetised. It matters because manifest order is the order a model reads the tools in — 08-30, re-verified 09-03, `fixture-manifest.mjs` | **—** the 7 names came back alphabetically, and a Chrome-side partial read (`describe_dataset, filter_rows, sum_by_category`) says the reference page's own order is not alphabetical — suggestive, not tested | **—** the twin *was* served to this build, but the probe used records counts rather than order |
| Registration settles late, in batches | ⚠️ an early read returns a **subset** — 3 of 7 observed. A reader must wait for the set to *stop changing*; "non-empty" silently reports part of a manifest as all of it. Settle 1.02–1.04 s at 7 tools, 1.30 s at 507 — 08-30 / 08-31, re-verified 09-03 (`settledAtMs` 1019 and 1035) | ✅ present and settled when read; settle time not recorded — 09-01 | ✅ settled; **2.83 s on a session's first navigation**, then 1.02–1.07 s — including at 507 tools — 09-03 |

## What the page is allowed to register

| Behaviour | Chrome 152 | ChatGPT 151 | ChatGPT 152 |
|---|---|---|---|
| A tool name containing a space | ⚠️ **`registerTool` throws `"Invalid tool name"`** and the tool never registers. Spec issue #145 reports a silent no-op; on this build it is loud and total. The structural consequence: **a live manifest cannot show the worst names**, because they are never in it — which is why `webmcp-gauge lint --manifest` reads what the source declares — 08-30, re-verified 09-03 (`"Clear Highlights"` rejected, the other 9 registered) | **—** | **—** only the twin's *clean* variant was served here, which registers no invalid name |
| A dotted tool name (`top.expenses.v2`) | ✅ registers and appears in `getTools()` — 08-30, re-verified 09-03, `fixture-manifest.mjs` | **—** | **—** likewise |
| Per-page tool budget | ✅ **no ceiling found up to 507 tools** — every one accepted, listed and surfaced, settle 1.04 s → 1.30 s. The field report of **296 tools silently disabling WebMCP for a whole page does not reproduce**; this project's `budget/headroom` lint rule was demoted from error to warning because of it — 08-31, `webmcp-domain.mjs 0,507` | **—** unmeasured on that build | ✅ **no ceiling here either.** 507 attempted, **507 registered, 507 in `getTools()`, 507 in the browser's view, 0 rejected**, settle 1069 ms — 09-03, `webmcp-domain.mjs 0,500 --port=9333`. The budget question now has two clients and one answer |

## Frames, embeds and delegation

Cross-origin below is a **different port on `127.0.0.1`** — a distinct origin, the same site. Chrome isolates by site, so that child is not an out-of-process iframe and has no CDP target of its own; it is reached through the page session's frame tree. A cross-**site** test needs real hostnames and has not been run.

| Behaviour | Chrome 152 | ChatGPT 151 | ChatGPT 152 |
|---|---|---|---|
| Same-origin subframe's tools | ⚠️ **fold into the host's manifest.** Host registers 3, embed registers `widget_ping`, the **top** frame's `getTools()` returns all 4; the browser's view agrees at 4 across 2 `frameId`s. Also 7 + 1 = 8 on the twin. An embed can add tools to its host's agent surface — 08-31 / 09-02, re-verified 09-03, `frame-scope.mjs` | **—** unmeasured | ⚠️ **folds here too** — the twin's iframe case reads 8 page-side and 8 browser-side across 2 frames — 09-03. Note the vendor's own docs record "no iframe tool discovery" for this client: that is a claim about its **agent**, and this is a measurement of its **engine**. The agent is out of reach (see the log's item 9), so the two statements never meet |
| Cross-origin embed, no `allow` | ⚠️ **gated by a Permissions Policy feature named `tools`.** `document.modelContext` *exists* in the child, and every call throws `Access to the feature "tools" is disallowed by permissions policy.` Host sees its own 3; the browser sees 3 across 1 frame — 09-02, re-verified 09-03, `frame-scope.mjs` | **—** | **—** the `spec-227` fixtures were not served to this build |
| Cross-origin embed with `allow="tools"` | ⚠️ **the embed registers, and no script-visible surface returns the union.** Host `getTools()` → 3, the embed's own → `["widget_ping"]`, the browser → 4 across 2 frames. A host page **cannot enumerate what an agent can actually call on it.** The only page-view/browser-view divergence this project has found, and it reproduces across runs — 09-02, re-verified 09-03, `frame-scope.mjs` | **—** | **—** likewise |

## The browser's own view (CDP)

| Behaviour | Chrome 152 | ChatGPT 151 | ChatGPT 152 |
|---|---|---|---|
| `WebMCP` CDP domain | ✅ present and **advertised** in `/json/protocol`, marked experimental. Commands `enable`, `disable`, `invokeTool`, `cancelInvocation`; events `toolsAdded`, `toolsRemoved`, `toolInvoked`, `toolResponded` — 08-30 / 08-31, re-verified 09-03, `webmcp-domain.mjs` | ❌ **withdrawn 09-03.** This cell read *"works but is absent from `/json/protocol`"* from 09-01 until 09-03. It was **our own bug**, not a fork behaviour — see [Corrections](#corrections) | ✅ present **and advertised**: 58 domains listed, `WebMCP` among them, `experimental: true`, and the surface is identical to Chrome 152 down to the parameter names — 09-03, `webmcp-domain.mjs --port=9333` and the corrected `chatgpt-browser-probe.mjs` |
| Listing tools browser-side | ⚠️ **no command does it.** The browser's view can only be *accumulated* from `toolsAdded` / `toolsRemoved`, one event per registration — so the subscription must be attached **before navigation**, or the events are already gone and a reader concludes the browser surfaced nothing — 08-31, re-verified 09-03 | **—** the four command names are in the fork's `chrome.dll` string table, which is not a protocol read — 09-01 | ⚠️ **confirmed from the protocol itself**: the same four commands, none of which lists tools — 09-03 |
| Browser-side tool metadata | ✅ richer than the page's: the `Tool` type carries `name`, `description`, `inputSchema`, `annotations`, `frameId`, `backendNodeId`, `stackTrace`. So **provenance exists browser-side and not page-side** — `getTools()` returns no frame or origin attribution, and a host page cannot tell its own tools from an embed's — 09-03 protocol read, 09-02 in use for the #227 contribution | **—** | ✅ **identical type**, and per-tool `frameId` + `stackTrace` observed in the event stream — 09-03 |
| `invokeTool` parameter shape | ⚠️ documented nowhere citable; walked out of the CDP deserializer's own `-32602` errors, one mandatory field per call. `invokeTool({frameId, toolName, input: <object>})` → `{invocationId}`, **not** the result; the result arrives asynchronously as `toolResponded {invocationId, status:"Completed", output}`, `output` a parsed **object** — 09-01, re-verified 09-03, `invoke-paths.mjs` | ⚠️ **identical** — 09-01 | ⚠️ **identical after the bump** — one `invocationId`, `status: "Completed"`, `output` an object, same tool result as the page path — 09-03, `invoke-paths.mjs --port=9333` |
| Page path vs browser path | ⚠️ same answer, incompatible ergonomics. Page: `executeTool(toolObject, jsonString)`, awaitable, payload a **string**. Domain: subscribe-then-correlate, payload an **object**. An adapter cannot treat them as interchangeable, and the argument encoding is inverted between them — 09-01, `invoke-paths.mjs` | ⚠️ identical — 09-01 | ⚠️ identical — 09-03 |
| `toolInvoked` | ✅ carries `{toolName, frameId, invocationId, input}`, which is what makes a CDP client a passive recorder of tool selection rather than a driver of it. ⚠️ Verified only for invocations **this project** makes; whether it fires when a real agent invokes is **unobserved** — 09-01, parameter names re-verified 09-03 | ⚠️ event present, same caveat — 09-01 | ✅ echo observed on our own invocation; ⚠️ agent-side firing **still unobserved**, and on this client the agent cannot be reached at all — 09-03 |

## What this contradicts, confirms and bounds

| Issue or report | Status here |
|---|---|
| **#145** — a tool name with a space "silently does nothing" | ❌ **contradicted** on Chrome 152: `registerTool` throws `"Invalid tool name"` — 08-30, re-verified 09-03 |
| **#241** — `inputSchema` moving `DOMString` → `object` | ⚠️ **not landed in the read-back path** on any of the three builds — 08-30 / 09-01 / 09-03 |
| **#266** — the namespace moving off `navigator` | ✅ **confirmed, and dated**: absent on Chrome 152, absent on the fork's 152, **present on the fork's 151**. The removal tracks the Chromium version, not the vendor — 08-30 / 09-01 / 09-03 |
| **#268** — tools visible in Brave 1.94 but not in Chrome `152.0.7977.65` or Edge 151 | ❌ **not reproduced** on that exact Chrome build: with the flag enabled, all 7 reference tools are read on a cold profile — 08-30, re-verified 09-03. This **bounds** the report rather than explaining it; Brave and Edge are unmeasured here |
| **#227** — should discovery reach beyond one traversable navigable? | A measured baseline was contributed to the thread: same-origin folds into the host, cross-origin needs `allow="tools"`, and once delegated nobody can list the union — 09-02. The fold reproduces on a second engine — 09-03 |
| Field report: **296 registered tools silently disable WebMCP** | ❌ **not reproduced** to 507 tools, now on **two** clients — 08-31 / 09-03 |
| Vendor docs: the ChatGPT client implements a subset with **no iframe tool discovery** | ⚠️ Its *engine* folds a same-origin subframe's tool into the host manifest — 09-03. Unresolved rather than contradicted: the claim is about the agent, and the agent has no automation surface |

## Corrections

Kept in the file rather than quietly edited away, because a matrix that hides its own errors is worth less than one that does not.

**"The ChatGPT fork implements the `WebMCP` domain without advertising it" was our own bug.** From 2026-09-01 to 2026-09-03 this project published that the domain worked on the app while being absent from `/json/protocol`, and drew a lesson from it about forks hiding capabilities. The membership test was `protocol.domains.some(d => d.name === 'WebMCP')`. CDP keys those entries **`domain`**, never `name`, so that expression is `false` for every domain of every build — it could never have found anything. The same repo's `webmcp-domain.mjs` used `entry.domain` and the getting-started guide used `$_.domain -eq 'WebMCP'`, so the correct key was already written down twice in two other languages.

Cross-checking the two probes against the same browser is what exposed it: one reported the domain missing while the other printed its full surface, ten minutes apart, on the same port. The falsification habit recorded at the time — call the domain, and call a bogus domain, before believing either answer — is what kept the wrong reading from blocking any work. It was sound, and it was aimed at the wrong suspect. `chatgpt-browser-probe.mjs` now tests the right key and reports the domain **count** beside the verdict, so a `false` is a claim about a list of known length rather than an unexamined boolean.

What survives unchanged: the domain **is** reachable on the app, `WebMCP.enable` is accepted, and a made-up domain is rejected with `-32601`.

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

The ChatGPT columns need the app launched with two switches, then probes attached to it. The MSIX path carries the package version, so read it rather than pasting it:

```
$exe = Join-Path (Get-AppxPackage -Name OpenAI.Codex).InstallLocation 'app\ChatGPT.exe'
Start-Process $exe -ArgumentList '--remote-debugging-port=9333','--enable-blink-features=WebMCPTesting'
# CDP answers about 12 s later, not instantly

node probes/chatgpt-browser-probe.mjs                     # entry point, schema wire, domain advertised
node probes/webmcp-domain.mjs 0,500 --port=9333            # budget, both views, iframe fold
node probes/invoke-paths.mjs --port=9333                   # both execution paths
node probes/binary-webmcp-strings.mjs "$(Split-Path $exe)\chrome.dll"   # which flag names the build compiled in
```

Nothing above writes to the app's profile: the launch switch is sufficient, and the `Local State` labs entries tried on 2026-09-01 were inert and were removed.

## Not measured, and not guessed

Brave and Edge — the two clients #268 names beside Chrome — are unmeasured, as are Firefox and Safari (neither has an implementation to measure) and Gemini-in-Chrome. Also open: the invalid-name and dotted-name rows on the ChatGPT build (its clean fixture registers neither), cross-**site** frames and `Permissions-Policy` as a response header rather than an `allow` attribute, the delegated-embed case on any engine but Chrome 152, whether `toolInvoked` fires when a real agent invokes, and whether any of this differs under an origin trial rather than a flag.

Everything above is browser behaviour measured against this project's own pages — the live reference page (`airlock-app.netlify.app`, authored by this project's maintainer) and the local fixtures in [`../fixtures/`](../fixtures/). **No third-party site's data appears in this file**, which is why it is publishable while the cohort work is not. The long form of every row, including the wrong turns that preceded it, is in [`../PROJECT-LOG.md`](../PROJECT-LOG.md).
