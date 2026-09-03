/**
 * Mode B, sampled: one utterance delivered to the real ChatGPT desktop agent,
 * with the outcome recorded by the browser rather than by a person's impression.
 *
 * The design is in `docs/concept.md` ("Mode B, as designed on 2026-09-01"). This
 * is its first execution, and it is therefore also the test of its own
 * instrument: `WebMCP.toolInvoked` is verified to fire for invocations this
 * project makes itself, and **unverified** for invocations the agent makes. So
 * the probe records two independent signals and reports both:
 *
 *   1. the CDP event stream — `toolInvoked` / `toolResponded`
 *   2. a visible effect on the page, read from the DOM before and after
 *
 * If the page changed and no event arrived, the event stream is not a usable
 * recorder and the design needs rewriting rather than patching. If neither
 * changed, the agent did not invoke, which is a measurement rather than a fault.
 * Reporting one signal alone could not tell those apart.
 *
 * Nothing here is a rate. One utterance is one observation, labelled as such.
 *
 * Usage (the app must already be running with the WebMCP flag):
 *   ChatGPT.exe --remote-debugging-port=9333 --enable-blink-features=WebMCPTesting
 *   node probes/mode-b-session.mjs --utterance="…" --expect=sum_by_category
 *   node probes/mode-b-session.mjs --utterance="…" --expect=… --deliver=manual
 */
import { writeFile, mkdir, appendFile } from 'node:fs/promises';

import { openSession } from '../browser/session.mjs';
import { captureManifest } from '../browser/webmcp.mjs';
import { parseOptions } from '../core/args.mjs';

const { options, error: optionsError } = parseOptions(process.argv.slice(2), {
  values: ['port', 'url', 'utterance', 'expect', 'deliver', 'wait', 'operator', 'out'],
  maxPositional: 0,
});
if (optionsError) {
  console.error(`cannot run a session: ${optionsError}`);
  process.exit(2);
}
const flag = (name, fallback) => options[name] ?? fallback;

const port = flag('port', '9333');
const url = flag('url', 'https://airlock-app.netlify.app');
const utterance = flag('utterance', null);
const expected = flag('expect', null);
const deliver = flag('deliver', 'cdp');
const waitSeconds = Number(flag('wait', '90'));
const operator = flag('operator', 'Sahan Vishwa');
const outDir = flag('out', 'artifacts/mode-b');

if (!utterance || !expected) {
  console.error('usage: node probes/mode-b-session.mjs --utterance="…" --expect=<tool> [--url=…] [--deliver=cdp|manual]');
  process.exit(2);
}

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const appTarget = targets.find((t) => t.url === 'app://-/index.html');
if (!appTarget) {
  console.error('the ChatGPT app UI target was not found — is the app running with --remote-debugging-port?');
  process.exit(2);
}

/** A DOM fingerprint, so a tool that changed the page can be detected without the event. */
const FINGERPRINT = `JSON.stringify({
  highlighted: [...document.querySelectorAll('[class*="highlight"], [data-highlighted], .selected')].length,
  bodyLength: document.body.innerText.length,
  digest: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300)
})`;

const record = {
  mode: 'B-sampled',
  schema: 'webmcp-gauge/mode-b/1',
  observedAt: new Date().toISOString(),
  operator,
  client: { build: version.Browser, userAgent: version['User-Agent'] },
  chatgptModel: null,
  subject: url,
  utterance,
  expectedTool: expected,
  delivery: deliver,
  manifest: null,
  events: [],
  observedTool: null,
  pageChanged: null,
  outcome: null,
  instrument: null,
};

const page = await openSession({ port });
let app = null;
try {
  await page.navigate(url);
  const manifest = await captureManifest(page);
  record.manifest = { present: manifest.present, settled: manifest.settled, toolCount: manifest.tools?.length ?? 0 };
  if (!manifest.present || !(manifest.tools?.length > 0)) {
    record.outcome = 'unmeasurable';
    record.instrument = 'the subject page registered no tools in this browser — nothing could be invoked';
    throw new Error(record.instrument);
  }

  const domain = await page.enableWebMcpDomain();
  if (!domain.available) {
    record.outcome = 'unmeasurable';
    record.instrument = `the WebMCP CDP domain is unavailable (${domain.reason}), so nothing can be recorded`;
    throw new Error(record.instrument);
  }
  page.subscribe('WebMCP.toolInvoked', (p) => record.events.push({ event: 'toolInvoked', toolName: p.toolName, input: p.input, invocationId: p.invocationId }));
  page.subscribe('WebMCP.toolResponded', (p) => record.events.push({ event: 'toolResponded', invocationId: p.invocationId, status: p.status }));

  const before = JSON.parse(await page.evaluate(FINGERPRINT));

  // `openSession` always opens a fresh tab, which is right for the subject and
  // wrong for the app's own UI: that target already exists and must be attached
  // to, not created. So the app half uses a raw CDP client.
  const { default: CDP } = await import('chrome-remote-interface');
  app = await CDP({ port: Number(port), target: appTarget.webSocketDebuggerUrl });
  await app.Runtime.enable();
  const appEval = async (expression) => {
    const { result } = await app.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true });
    return result?.value ?? null;
  };

  record.chatgptModel = await appEval(
    `(() => { const m = document.body.innerText.match(/GPT-[\\w.\\-]+/); return m ? m[0] : null; })()`
  ).catch(() => null);

  console.log(`subject: ${url} — ${record.manifest.toolCount} tools registered`);
  console.log(`client: ${version.Browser}`);
  console.log(`utterance: ${utterance}`);
  console.log(`expecting: ${expected}\n`);

  if (deliver === 'cdp') {
    // Typing into the composer is the only automated part of delivery, and it is
    // the part the design calls manual. It is done here because the operator
    // authorised it explicitly; the record says `delivery: "cdp"` so a reader can
    // discount it if that matters to them.
    const typed = await appEval(`(() => {
      const box = document.querySelector('textarea, [contenteditable="true"]');
      if (!box) return 'no composer found';
      box.focus();
      if (box.tagName === 'TEXTAREA') {
        box.value = ${JSON.stringify(utterance)};
        box.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        box.textContent = ${JSON.stringify(utterance)};
        box.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(utterance)} }));
      }
      return 'typed';
    })()`);
    console.log(`composer: ${typed}`);
    if (typed !== 'typed') throw new Error(`could not deliver the utterance: ${typed}`);

    await app.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await app.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    console.log('sent. watching for tool invocations…');
  } else {
    console.log(`>>> type the utterance above into a NEW chat now. Watching for ${waitSeconds}s…`);
  }

  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline && record.events.length === 0) {
    await new Promise((r) => setTimeout(r, 1000));
  }

  const after = JSON.parse(await page.evaluate(FINGERPRINT));
  record.pageChanged = before.digest !== after.digest || before.highlighted !== after.highlighted;
  record.observedTool = record.events.find((e) => e.event === 'toolInvoked')?.toolName ?? null;

  // Two checks before any verdict, because the first run of this probe produced a
  // clean "not_invoked" that meant nothing at all until they were added.
  //
  // 1. Was the utterance actually delivered? An Enter key that did not submit
  //    looks exactly like an agent that chose not to invoke.
  // 2. Could the agent see this page? The app annotates its own context with a
  //    line like "Chrome tabs: The user has the Chrome extension side panel open.
  //    Current URL: …" — the agent's page view comes from a **Chrome extension
  //    bridge into the user's real Chrome**, not from tabs opened in the app's own
  //    browser over CDP. A subject the agent never saw cannot produce a
  //    measurement of tool choice, and must not be recorded as one.
  record.delivered = await appEval(
    `document.body.innerText.includes(${JSON.stringify(utterance.slice(0, 60))})`
  ).catch(() => null);
  record.agentPageContext = await appEval(
    `(() => { const m = document.body.innerText.match(/Chrome tabs:[^\\n]*/); return m ? m[0] : null; })()`
  ).catch(() => null);

  if (record.observedTool) {
    record.outcome = record.observedTool === expected ? 'ok' : 'wrong_tool';
    record.instrument = 'toolInvoked fired for an agent-initiated invocation — the event stream is a usable recorder';
  } else if (record.pageChanged) {
    record.outcome = 'unmeasurable';
    record.instrument = 'the page changed but no toolInvoked arrived — the event stream MISSES agent invocations and the design must change';
  } else if (record.delivered === false) {
    record.outcome = 'unmeasurable';
    record.instrument = 'the utterance never reached a chat — delivery failed, so nothing was observed';
  } else if (record.agentPageContext) {
    record.outcome = 'unmeasurable';
    record.instrument = `the agent's page context is a Chrome extension bridge (${record.agentPageContext}) — it never saw the tab this probe opened, so no tool choice was possible`;
  } else {
    record.outcome = 'not_invoked';
    record.instrument = 'delivered, agent had page context, and still no tool fired';
  }
} catch (error) {
  record.outcome = record.outcome ?? 'unmeasurable';
  record.instrument = record.instrument ?? `probe failed: ${error.message}`;
} finally {
  await page.close().catch(() => {});
  if (app) await app.close().catch(() => {});
}

await mkdir(outDir, { recursive: true });
await appendFile(`${outDir}/observations.jsonl`, `${JSON.stringify(record)}\n`, 'utf8');
await writeFile(`${outDir}/last.json`, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

console.log(`\noutcome: ${record.outcome}`);
console.log(`observed: ${record.observedTool ?? '(none)'} | expected: ${expected} | page changed: ${record.pageChanged}`);
console.log(`instrument: ${record.instrument}`);
console.log(`recorded → ${outDir}/observations.jsonl`);
process.exitCode = record.outcome === 'unmeasurable' ? 2 : 0;
