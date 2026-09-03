/**
 * Mode B spike: can the ChatGPT desktop app's built-in browser be driven at all?
 *
 * The ChatGPT desktop app ships as the OpenAI.Codex MSIX (Chromium 151,
 * "CodexBrowser" user-agent prefix, entry point ChatGPT.exe). This probe attaches
 * to an already-running instance over CDP — it never launches the app — opens the
 * reference page in its own tab, and reads the same manifest surface the Mode A
 * harness reads: document.modelContext presence, getTools(), and the WebMCP CDP
 * domain if the build has one.
 *
 * Start the app first, with a debugging port (path carries the package version):
 *   Start-Process 'C:\Program Files\WindowsApps\OpenAI.Codex_26.825.6671.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe' `
 *     -ArgumentList '--remote-debugging-port=9333'
 * Then: node probes/chatgpt-browser-probe.mjs [url] [--port=9333]
 *
 * Answers PROJECT-LOG item 9. What this probe does NOT establish, stated plainly
 * because it is the difference between "driven" and "automatable for Mode B":
 * attaching to the shell and opening our own tab is not the same as driving the
 * in-app agent's own browsing session, and the in-app agent (ChatGPT Work / Codex
 * per learn.chatgpt.com/docs/webmcp) is the thing that actually selects tools.
 */
import { openSession } from '../browser/session.mjs';
import { captureManifest } from '../browser/webmcp.mjs';

const args = process.argv.slice(2);
const urlFlag = args.find((a) => !a.startsWith('--'));
const portFlag = args.find((a) => a.startsWith('--port='));
const port = portFlag ? portFlag.split('=')[1] : process.env.CDP_PORT ?? '9333';
const url = urlFlag ?? 'https://airlock-app.netlify.app';

const report = { attached: false, browser: null, webmcpDomain: null, page: null, conclusion: null };

let version;
try {
  version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
} catch (error) {
  report.conclusion = `no CDP endpoint on port ${port} (${error.message}) — start the app with --remote-debugging-port=${port} first`;
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}

report.attached = true;
report.browser = { browser: version.Browser, userAgent: version['User-Agent'] };
console.log(`attached: ${version.Browser}`);

try {
  const protocol = await (await fetch(`http://127.0.0.1:${port}/json/protocol`)).json();
  // Entries in /json/protocol are keyed `domain`, never `name`. This read tested
  // `d.name` until 2026-09-03, which is structurally always false, and it cost a
  // published finding: "the fork implements WebMCP but does not advertise it" was
  // our own bug, not a fork behaviour. The count travels with the answer now, so
  // a false reads as a claim about a list of known length.
  report.protocolDomains = protocol.domains?.length ?? null;
  report.webmcpDomain = protocol.domains?.some((d) => d.domain === 'WebMCP') ?? null;
} catch {
  report.webmcpDomain = null;
}

// openSession opens its own tab, negotiates Page/Runtime, and closes cleanly.
const session = await openSession({ port });
try {
  await session.navigate(url);
  const manifest = await captureManifest(session);
  const domain = await session.enableWebMcpDomain();
  const page = await session.evaluate('JSON.stringify({ href: location.href, ua: navigator.userAgent })');
  const parsed = JSON.parse(page);

  report.page = {
    url: parsed.href,
    userAgent: parsed.ua,
    modelContextPresent: manifest.present,
    inNavigator: manifest.inNavigator ?? null,
    settled: manifest.settled ?? null,
    toolCount: manifest.tools?.length ?? 0,
    names: manifest.tools?.map((t) => t.name) ?? null,
    inputSchemaWire: manifest.tools?.[0]?.inputSchemaWire ?? null,
    webmcpDomain: domain.available ? 'enabled' : `unavailable (${domain.reason})`,
  };

  if (manifest.present && manifest.tools?.length > 0) {
    report.conclusion = `DRIVEN: opened ${url} in the ChatGPT desktop browser via CDP and read ${manifest.tools.length} tools through the page's own modelContext (${manifest.tools.map((t) => t.name).join(', ')}) — the browser surface of Mode B is automatable from this machine`;
  } else if (manifest.present) {
    report.conclusion = 'driven, and document.modelContext exists, but getTools() returned no tools — the subset may be narrower than the page API suggests';
  } else {
    report.conclusion = `driven, but ${manifest.inNavigator ? 'navigator.modelContext' : 'document.modelContext'} is absent on this page in this build — WebMCP may need a flag, or this build predates/excludes the surface`;
  }
} catch (error) {
  report.conclusion = `attach worked, driving failed: ${error.message}`;
} finally {
  await session.close();
}

console.log(JSON.stringify(report, null, 2));
