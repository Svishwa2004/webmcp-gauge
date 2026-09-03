/**
 * Do the two execution paths agree? The page API against the browser's own domain.
 *
 * Every trial this project has published executed through the page:
 * `document.modelContext.executeTool(...)`. A real client does not do that — it
 * invokes through the browser, `WebMCP.invokeTool` over CDP. Treating the two as
 * equivalent is an assumption, and this probe is the smallest thing that can
 * falsify it: same page, same tool, same arguments, both paths, results compared.
 *
 * Usage:
 *   node probes/invoke-paths.mjs [url] [--port=9333] [--tool=sum_by_category]
 *   node probes/invoke-paths.mjs --launch          # stand up our own Chrome instead
 *
 * Runs against whatever debuggable browser is on the port, so it doubles as a
 * cross-client comparison: `--launch` for the harness's own Chrome, or the
 * ChatGPT desktop build started as
 *   ChatGPT.exe --remote-debugging-port=9333 --enable-blink-features=WebMCPTesting
 *
 * The domain's parameter shape is not documented anywhere this project can cite,
 * so it was walked out of the CDP deserializer's own error messages: each missing
 * mandatory field names itself, one call at a time.
 */
import { openSession } from '../browser/session.mjs';
import { captureManifest, executeTool } from '../browser/webmcp.mjs';
import { launchSession } from '../browser/launch.mjs';
import { parseOptions } from '../core/args.mjs';

const { options, positional, error: optionsError } = parseOptions(process.argv.slice(2), {
  values: ['tool', 'args', 'port'],
  switches: ['launch'],
  maxPositional: 1,
});
if (optionsError) {
  console.error(`cannot probe: ${optionsError}`);
  process.exit(2);
}
const flag = (name, fallback) => options[name] ?? fallback;
const url = positional[0] ?? 'https://airlock-app.netlify.app';
const toolName = flag('tool', 'sum_by_category');
const toolArgs = JSON.parse(flag('args', '{"highlight":"Groceries"}'));

const browser = options.launch === true
  ? await launchSession({ profileDir: 'artifacts/invoke-paths-profile' })
  : null;
const port = browser ? browser.port : flag('port', process.env.CDP_PORT ?? '9333');

const report = { url, port: String(port), tool: toolName, arguments: toolArgs, browser: null, pagePath: null, domainPath: null, agree: null };

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
report.browser = version.Browser;

const session = await openSession({ port });
try {
  await session.navigate(url);
  const manifest = await captureManifest(session);
  if (!manifest.present || !manifest.tools?.some((t) => t.name === toolName)) {
    report.domainPath = { skipped: `${toolName} is not registered on this page` };
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  // Path A — the page API, exactly as every published trial executes.
  const viaPage = await executeTool(session, toolName, toolArgs);
  report.pagePath = { ok: viaPage.ok, callShape: viaPage.callShape, result: viaPage.result ?? null, error: viaPage.error ?? null };

  // Reset between paths: a tool that highlights rows would otherwise let path B
  // inherit path A's page state, and "nothing changed" is how silent_fail is
  // detected. Best-effort — a page without the reset tool is still measurable.
  if (manifest.tools.some((t) => t.name === 'clear_highlights')) {
    await executeTool(session, 'clear_highlights', {});
  }

  // Path B — the browser's own domain. Measured shape on Chromium 151/152:
  //   WebMCP.invokeTool({ frameId, toolName, input: <object> }) -> { invocationId }
  // It is ASYNCHRONOUS. The command returns an id, not a result; the result
  // arrives later as WebMCP.toolResponded carrying the same invocationId. That
  // asymmetry with the page API's awaitable call is the finding, so the probe
  // subscribes before invoking rather than polling after.
  const domain = await session.enableWebMcpDomain();
  if (!domain.available) {
    report.domainPath = { ok: false, error: `WebMCP domain unavailable: ${domain.reason}` };
  } else {
    const responses = [];
    const invocations = [];
    const offResponded = session.subscribe('WebMCP.toolResponded', (params) => responses.push(params));
    const offInvoked = session.subscribe('WebMCP.toolInvoked', (params) => invocations.push(params));

    try {
      // The root frame id, read rather than re-navigated for it: navigating again
      // would tear down the registration this probe is about to invoke.
      const { frameTree } = await session.send('Page.getFrameTree');
      const frameId = frameTree.frame.id;
      const invoked = await session.send('WebMCP.invokeTool', { frameId, toolName, input: toolArgs });

      const deadline = Date.now() + 15000;
      let responded = null;
      while (Date.now() < deadline && !responded) {
        responded = responses.find((r) => r.invocationId === invoked.invocationId) ?? null;
        if (!responded) await new Promise((resolve) => setTimeout(resolve, 200));
      }

      report.domainPath = {
        ok: Boolean(responded),
        callShape: 'frameId+toolName+input-object',
        synchronous: false,
        invocationId: invoked.invocationId,
        responded,
        sawToolInvokedEcho: invocations.some((i) => i.invocationId === invoked.invocationId),
        error: responded ? null : `no WebMCP.toolResponded for ${invoked.invocationId} within 15s`,
      };
    } catch (error) {
      report.domainPath = { ok: false, callShape: null, error: String(error.message ?? error) };
    } finally {
      offResponded();
      offInvoked();
    }
  }

  report.agree =
    report.pagePath.ok === report.domainPath.ok
      ? report.pagePath.ok
        ? 'both paths executed the tool — but note the call shapes differ (page: tool object + JSON string; domain: frameId + toolName + input object) and the domain path is asynchronous'
        : 'both paths failed'
      : `paths DISAGREE: page=${report.pagePath.ok} domain=${report.domainPath.ok} — a rate measured through the page does not describe what a client doing the invoking would see`;
} catch (error) {
  report.agree = `probe failed: ${error.message}`;
} finally {
  await session.close();
  if (browser) await browser.close();
}

console.log(JSON.stringify(report, null, 2));
