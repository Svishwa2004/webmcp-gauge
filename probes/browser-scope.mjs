/**
 * Can a **browser-level** CDP session see what a host-attached one cannot?
 *
 * `site-scope.mjs` established the cross-site gradient and left one row open in the
 * compatibility matrix's own not-measured list: *whether a browser-level session
 * would accumulate a cross-site child's registrations where the host-target session
 * cannot.* That question matters twice over. It decides how the frame-scope finding
 * contributed to [webmcp#227] should be stated — "no page can enumerate the union"
 * is measured, but "and no client can either" is not — and it decides whether a
 * cohort capture attached to a host page can ever be complete.
 *
 * What is already measured (Chrome 152, 2026-09-02 and 09-03):
 *
 *  - same-origin embed → its tool joins the host's `getTools()`, everyone sees 4
 *  - cross-origin same-site with `allow="tools"` → the host's page sees 3, the embed
 *    sees its 1, and a session attached to the **host target** sees all 4 across 2
 *    frameIds. No script surface returns the union; the browser's does.
 *  - **cross-site** with `allow="tools"` → the child is site-isolated with a target
 *    of its own, and its registration events never arrive at the host session. The
 *    union exists only in the child's own target.
 *
 * So the open question is narrow: attach at the **browser** endpoint instead, turn on
 * flattened auto-attach so every target's session is routed over one socket, and ask
 * whether the child's `WebMCP.toolsAdded` arrives there.
 *
 * **Prediction, written before the first run:** it does. Auto-attach reaches the
 * OOPIF's own target, and the events this probe misses at the host are the events
 * that target owns. If so, the honest statement becomes *"no page can enumerate what
 * an agent can call, and neither can a client attached to the page — but a client
 * attached to the browser can"*, which is a better sentence for the spec thread than
 * the one currently published, because it says where the capability actually lives.
 * Falsified if the browser-level session also sees only the host's 3 — which would be
 * the stronger and more surprising result: the union unreachable from any single
 * session, and a fact the spec thread should hear immediately.
 *
 * Both views are measured in the **same run** against the same navigation, so the
 * contrast cannot be an artefact of two different page loads.
 *
 * Usage: node probes/browser-scope.mjs
 *
 * Aim it at another build the way every other probe does, with the launcher
 * override: `WEBMCP_GAUGE_CHROME=…\msedge.exe node probes/browser-scope.mjs`
 */
import { launchSession } from '../browser/launch.mjs';
import { openSession } from '../browser/session.mjs';
import { startFixtureServer } from '../browser/serve.mjs';
import { parseOptions } from '../core/args.mjs';

const { error: optionsError } = parseOptions(process.argv.slice(2), { maxPositional: 0 });
if (optionsError) {
  console.error(`cannot probe: ${optionsError}`);
  process.exit(2);
}

const root = 'fixtures/spec-227';
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * A browser-level CDP client with flattened auto-attach. Everything arrives on one
 * socket, tagged with the `sessionId` of the target it came from — which is the whole
 * point: one client, every target, no per-target socket to open by hand.
 */
const openBrowserClient = async (webSocketDebuggerUrl) => {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((open, failed) => {
    socket.addEventListener('open', open, { once: true });
    socket.addEventListener('error', failed, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  const attachments = [];

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
      else resolve(message.result ?? {});
      return;
    }
    if (!message.method) return;
    for (const handler of listeners.get(message.method) ?? []) handler(message.params ?? {}, message.sessionId ?? null);
  });

  const send = (method, params = {}, sessionId = undefined) =>
    new Promise((resolve, reject) => {
      const id = nextId += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 15000);
    });

  const on = (method, handler) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(handler);
  };

  return { socket, send, on, attachments, close: () => socket.close() };
};

const browser = await launchSession({ profileDir: `artifacts/browser-scope-${Date.now()}` });

const version = await (await fetch(`http://127.0.0.1:${browser.port}/json/version`)).json();

// Two names on the loopback: different sites in Chrome's eyes, as `site-scope.mjs`
// established, so no real domains are needed to cross a site boundary.
const hostServer = await startFixtureServer({ root, host: 'localhost' });
const widgetServer = await startFixtureServer({ root, host: '127.0.0.1' });

const hostOrigin = hostServer.origin;
const widgetOrigin = widgetServer.origin;

let verdict = 2;
try {
  console.log(`browser ${version['Browser'] ?? browser.build ?? '(unknown)'}`);
  console.log(`host   ${hostOrigin}`);
  console.log(`widget ${widgetOrigin}  (different site, delegated with allow="tools")\n`);

  // The browser-level client first, so auto-attach is armed before the navigation
  // that creates the child target.
  const client = await openBrowserClient(version.webSocketDebuggerUrl);
  const browserSeen = [];
  const attached = [];

  client.on('Target.attachedToTarget', async (params) => {
    attached.push({ sessionId: params.sessionId, type: params.targetInfo?.type, url: params.targetInfo?.url });
    try {
      // Auto-attach is recursive only if every new session arms it in turn, which is
      // why the first version of this probe saw nothing: it armed the browser session
      // and stopped, and a browser-level auto-attach does not reach an out-of-process
      // iframe. Arming it again on each attached session is what walks down to the
      // OOPIF. That first null result is kept in the log rather than published as an
      // answer, because it measured the plumbing.
      await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, params.sessionId);
    } catch {
      // Some target types refuse; their absence from the session list is the record.
    }
    try {
      // Every attached target gets the domain enabled on its own session. A target
      // that does not implement it simply refuses, which is itself a row.
      await client.send('WebMCP.enable', {}, params.sessionId);
    } catch {
      // Recorded by absence: if enable fails, no events can arrive from this target.
    }
  });
  client.on('WebMCP.toolsAdded', (params, sessionId) => {
    for (const tool of params.tools ?? []) {
      browserSeen.push({ name: tool.name, frameId: params.frameId ?? tool.frameId ?? null, sessionId });
    }
  });

  await client.send('Target.setDiscoverTargets', { discover: true });
  await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

  // The host-attached control, in the same run and against the same navigation.
  const hostSession = await openSession({ port: browser.port });
  const hostSeen = [];
  await hostSession.enableWebMcpDomain();
  hostSession.subscribe('WebMCP.toolsAdded', (params) => {
    for (const tool of params.tools ?? []) {
      hostSeen.push({ name: tool.name, frameId: params.frameId ?? tool.frameId ?? null });
    }
  });

  const widgetUrl = new URL('widget.html', widgetOrigin).href;
  const url = `${new URL('host-cross.html', hostOrigin).href}?widget=${encodeURIComponent(widgetUrl)}&allow=1`;
  await hostSession.navigate(url);
  await wait(9000);

  const pageTools = JSON.parse(
    await hostSession.evaluate(
      'document.modelContext.getTools().then((t) => JSON.stringify(t.map((x) => x.name)))'
    )
  );

  const unique = (rows) => [...new Set(rows.map((row) => row.name))].sort();
  const hostNames = unique(hostSeen);
  const browserNames = unique(browserSeen);
  const sessions = [...new Set(browserSeen.map((row) => row.sessionId))].filter(Boolean);
  const iframeTargets = attached.filter((entry) => entry.type === 'iframe');

  console.log(`attached targets:        ${attached.length} — ${attached.map((a) => a.type).join(', ') || '(none)'}`);
  console.log(`  of which OOPIF:        ${iframeTargets.length}${iframeTargets.length > 0 ? ` — ${iframeTargets.map((t) => t.url).join(', ')}` : ''}`);
  console.log(`page getTools():         ${pageTools.length} — ${pageTools.join(', ')}`);
  console.log(`host-attached session:   ${hostNames.length} — ${hostNames.join(', ') || '(nothing)'}`);
  console.log(`browser-level session:   ${browserNames.length} — ${browserNames.join(', ') || '(nothing)'}`);
  console.log(`                         across ${sessions.length} target session(s)\n`);

  const widgetTool = 'widget_ping';
  const hostHasWidget = hostNames.includes(widgetTool);
  const browserHasWidget = browserNames.includes(widgetTool);

  if (browserHasWidget && !hostHasWidget) {
    console.log('RESULT: the union is reachable browser-side but not page-side.');
    console.log('A client attached to the BROWSER, arming auto-attach recursively so it reaches the OOPIF,');
    console.log("sees the cross-site embed's tool; a client attached to the host page does not, and no page");
    console.log('surface returns it. So "no page can enumerate what an agent can call on it" stands, and');
    console.log('"no client can" does not — the capability lives at the browser endpoint.');
    verdict = 0;
  } else if (!browserHasWidget && iframeTargets.length === 0) {
    console.log('cannot answer: no OOPIF session ever attached, so this measured auto-attach rather than the');
    console.log("browser's view of WebMCP. The child target does exist — site-scope.mjs reads it straight from");
    console.log('/json/list — so a null result here is about what auto-attach reaches, and nothing more.');
    verdict = 2;
  } else if (!browserHasWidget) {
    console.log("RESULT: an OOPIF session attached and still no tool arrived — the prediction is FALSIFIED.");
    console.log("A cross-site embed's registration reaches no client attached to the browser or to the host");
    console.log('page even with the child\'s own session attached, which means the event fired before that');
    console.log('attachment or does not replay for a late subscriber. Both readings are worth the spec');
    console.log('thread, and separating them needs the domain enabled before the navigation.');
    verdict = 1;
  } else {
    console.log('RESULT: the host-attached session saw the embed, which contradicts the 2026-09-03');
    console.log('cross-site rows. Do not publish either reading until the disagreement is explained.');
    verdict = 2;
  }

  client.close();
  await hostSession.close();
} finally {
  await hostServer.close();
  await widgetServer.close();
  await browser.close();
}

process.exit(verdict);
