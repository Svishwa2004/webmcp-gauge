/**
 * Site-scoped tool discovery, measured: localhost against 127.0.0.1.
 *
 * The compatibility matrix's cross-origin rows were measured across a different
 * **port** on 127.0.0.1 — a distinct origin, but the same site, so Chrome keeps
 * the child in the host's process and it never gets a CDP target of its own. The
 * unmeasured question behind them is whether everything holds when the embed is
 * on a different **site**, which normally needs two registrable domains.
 *
 * This probe tests whether `localhost` and `127.0.0.1` are different sites in
 * Chrome's eyes, and — if they are — measures the delegated-embed case across
 * that boundary. The discriminator is the OOPIF signature: a cross-site child is
 * site-isolated, appears in `/json/list` with its own `webSocketDebuggerUrl`,
 * and its execution contexts do not appear in the host session; a same-site
 * child gets no target of its own. The same probe runs both cases so the
 * contrast is in one output.
 *
 * Usage: node probes/site-scope.mjs [--browser=edge]
 */
import { launchSession } from '../browser/launch.mjs';
import { openSession } from '../browser/session.mjs';
import { startFixtureServer } from '../browser/serve.mjs';
import { parseOptions } from '../core/args.mjs';

const { options, error: optionsError } = parseOptions(process.argv.slice(2), {
  values: ['browser'],
  maxPositional: 0,
});
if (optionsError) {
  console.error(`cannot probe: ${optionsError}`);
  process.exit(2);
}

const root = 'fixtures/spec-227';

const safeUrl = (value) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

/** A target's own CDP socket, for reading inside an OOPIF the host session cannot reach. */
const evaluateOnTarget = async (webSocketDebuggerUrl, expression) => {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((open, failed) => {
    socket.addEventListener('open', open, { once: true });
    socket.addEventListener('error', failed, { once: true });
  });
  try {
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('target socket timed out')), 15000);
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id === 1) {
          clearTimeout(timer);
          resolve(message);
        }
      }, { once: true });
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
    if (reply.error) throw new Error(`CDP ${reply.error.code}: ${reply.error.message}`);
    return reply.result?.result?.value ?? null;
  } finally {
    socket.close();
  }
};

const browser = await launchSession({ profileDir: `artifacts/site-scope-${Date.now()}` });
const version = await (await fetch(`http://127.0.0.1:${browser.port}/json/version`)).json();

// Two names on the loopback, plus a second loopback server for the same-site
// control. The control must be genuinely cross-ORIGIN (a different port) to match
// the matrix's existing rows — the first version of this probe passed the same
// origin twice, which silently measured the same-origin fold instead.
const localhostServer = await startFixtureServer({ root, host: 'localhost' });
const loopbackServerA = await startFixtureServer({ root, host: '127.0.0.1' });
const loopbackServerB = await startFixtureServer({ root, host: '127.0.0.1' });

// CDP's frame tree hangs childFrames off the TREE NODE, not the frame object —
// flatten(frameTree.frame) therefore printed only the root, and this probe's
// first two runs reported "no child in the frame tree" as a result of that, not
// as a measurement.
const flatten = (node, depth = 0) => [
  { url: node.frame.url, origin: node.frame.securityOrigin, id: node.frame.id, depth },
  ...(node.childFrames ?? []).flatMap((child) => flatten(child, depth + 1)),
];

const measure = async (label, hostOrigin, widgetOrigin, allow) => {
  const session = await openSession({ port: browser.port });
  const added = [];
  const contexts = [];
  try {
    await session.send('Runtime.enable');
    session.subscribe('Runtime.executionContextCreated', (params) => {
      contexts.push({ origin: params.context?.origin, frameId: params.context?.auxData?.frameId });
    });
    await session.enableWebMcpDomain();
    session.subscribe('WebMCP.toolsAdded', (params) => {
      for (const tool of params.tools ?? []) {
        added.push({ name: tool.name, frameId: params.frameId ?? tool.frameId ?? null });
      }
    });

    const widgetUrl = new URL('widget.html', widgetOrigin).href;
    const url = `${new URL('host-cross.html', hostOrigin).href}?widget=${encodeURIComponent(widgetUrl)}${allow ? '&allow=1' : ''}`;
    await session.navigate(url);
    await new Promise((done) => setTimeout(done, 8000));

    const top = JSON.parse(
      await session.evaluate('document.modelContext.getTools().then((t) => JSON.stringify(t.map((x) => x.name)))')
    );
    const { frameTree } = await session.send('Page.getFrameTree');
    const allFrames = flatten(frameTree);

    // The OOPIF signature, read correctly this time. The host page's own URL
    // carries the widget URL in its QUERY STRING, so `url.includes('widget.html')`
    // matches the host — a false positive the frame-scope probe already
    // documented and this probe's first version reproduced. Match the parsed
    // pathname and origin instead.
    const targets = await (await fetch(`http://127.0.0.1:${browser.port}/json/list`)).json();
    const widgetTargets = targets
      .map((t) => ({ type: t.type, socket: t.webSocketDebuggerUrl, parsed: safeUrl(t.url ?? '') }))
      .filter((t) => t.parsed && t.parsed.origin === widgetOrigin && t.parsed.pathname === '/widget.html');
    const oopif = widgetTargets[0] ?? null;

    let inside = null;
    if (oopif) {
      const raw = await evaluateOnTarget(
        oopif.socket,
        `(async () => {
          const has = 'modelContext' in document && !!document.modelContext;
          if (!has) return JSON.stringify({ modelContext: false, href: location.href });
          let names = null, error = null;
          try { names = (await document.modelContext.getTools()).map((t) => t.name); }
          catch (e) { error = String((e && e.message) || e); }
          return JSON.stringify({ modelContext: true, ownGetTools: names, error, href: location.href });
        })()`
      );
      inside = raw ? JSON.parse(raw) : null;
    }

    return {
      label,
      hostOrigin,
      widgetOrigin,
      allowAttribute: allow,
      topFrameGetTools: top,
      browserView: added.map((a) => a.name),
      distinctFrameIds: new Set(added.map((a) => a.frameId)).size,
      frameTree: allFrames.map((f) => `${'  '.repeat(f.depth)}${f.origin} ${f.url.replace(/\?.*$/, '')}`),
      embedContextsInHostSession: contexts.filter((c) => c.origin === widgetOrigin).length,
      oopifTarget: oopif ? { type: oopif.type, url: `${oopif.parsed.origin}${oopif.parsed.pathname}` } : null,
      insideTheEmbed: inside,
    };
  } finally {
    await session.close();
  }
};

const cases = [
  await measure('same-site control: different ports, both 127.0.0.1, allow="tools"', loopbackServerA.origin, loopbackServerB.origin, true),
  await measure('cross-site candidate: localhost hosts, 127.0.0.1 embeds, allow="tools"', localhostServer.origin, loopbackServerB.origin, true),
  await measure('cross-site candidate: localhost hosts, 127.0.0.1 embeds, no allow', localhostServer.origin, loopbackServerB.origin, false),
];

console.log(`build: ${version.Browser}`);
console.log(`localhost server: ${localhostServer.origin}`);
console.log(`loopback A:       ${loopbackServerA.origin}`);
console.log(`loopback B:       ${loopbackServerB.origin}\n`);
for (const result of cases) {
  console.log(`--- ${result.label}`);
  console.log(`  top frame getTools():  ${JSON.stringify(result.topFrameGetTools)}`);
  console.log(`  browser view:          ${JSON.stringify(result.browserView)} across ${result.distinctFrameIds} frameId(s)`);
  console.log(`  frame tree:`);
  for (const line of result.frameTree) console.log(`    ${line}`);
  console.log(`  embed contexts in host session: ${result.embedContextsInHostSession}`);
  console.log(`  widget's own target:    ${JSON.stringify(result.oopifTarget)}`);
  console.log(`  inside the embed:      ${JSON.stringify(result.insideTheEmbed)}`);
  console.log('');
}

const control = cases[0];
const delegated = cases[1];
const isolated =
  delegated.oopifTarget !== null && control.oopifTarget === null;
console.log(
  isolated
    ? `VERDICT: localhost and 127.0.0.1 ARE different sites here — the cross-site embed got its own ${delegated.oopifTarget.type} target while the same-site control got none. The delegated and no-allow rows above are therefore genuine cross-SITE measurements.`
    : `VERDICT: no OOPIF separation detected — Chrome does not treat localhost and 127.0.0.1 as different sites on this build, so these rows stay cross-origin-but-same-site and the matrix's cross-site row remains unmeasured.`
);

await browser.close();
await localhostServer.close();
await loopbackServerA.close();
await loopbackServerB.close();
