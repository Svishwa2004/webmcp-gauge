/**
 * Frame-scoped tool discovery, measured: same-origin against cross-origin.
 *
 * Backs the contribution on webmachinelearning/webmcp#227, whose open question is
 * whether `getTools()` should collect beyond one traversable navigable. The
 * comment posted on 2026-09-02 reported the same-origin case and said plainly
 * that cross-origin was untested; this probe tests it.
 *
 * The discriminator matters more than the count. If the host page sees only its
 * own 3 tools, that could mean either
 *   (a) the cross-origin frame never registered anything, or
 *   (b) it registered and the host is not shown it —
 * which are opposite answers to the spec question. The browser's own
 * `WebMCP.toolsAdded` stream separates them: it carries a `frameId` per
 * registration, so a tool that exists in the browser's view but not in the top
 * frame's `getTools()` is case (b), and its absence from both is case (a).
 *
 * Cross-origin here is a different port on 127.0.0.1 — a distinct origin by the
 * same-origin policy, and the cheapest one to stand up honestly. Same-scheme and
 * same-host, so this measures the *origin* boundary rather than a scheme or site
 * boundary; a site-level (eTLD+1) test would need real hostnames.
 *
 * Usage: node probes/frame-scope.mjs
 */
import { resolve } from 'node:path';

import { launchSession } from '../browser/launch.mjs';
import { openSession } from '../browser/session.mjs';
import { startFixtureServer } from '../browser/serve.mjs';

const root = resolve('fixtures/spec-227');
const hostServer = await startFixtureServer({ root });
const widgetServer = await startFixtureServer({ root });

const build = await (async () => {
  const browser = await launchSession({ profileDir: `artifacts/frame-scope-${Date.now()}` });
  const version = await (await fetch(`http://127.0.0.1:${browser.port}/json/version`)).json();
  return { browser, version };
})();

const measure = async (label, url, embedOrigin = null) => {
  const session = await openSession({ port: build.browser.port });
  const added = [];
  // Execution contexts, collected as they are announced, so the embed's frame can
  // be evaluated in directly.
  //
  // A correction worth keeping: a different **port** on 127.0.0.1 is cross-origin
  // but the **same site**, and Chrome isolates by site — so this child is not an
  // out-of-process iframe, gets no CDP target of its own (verified: absent from
  // `/json/list`, from `Target.getTargets`, and from `getTargets` after
  // `setDiscoverTargets`), and lives in this session's frame tree. Reaching it
  // means matching a `Runtime.executionContextCreated` by origin, not attaching
  // to a target.
  const contexts = [];
  try {
    await session.send('Runtime.enable');
    session.subscribe('Runtime.executionContextCreated', (params) => {
      contexts.push({
        id: params.context?.id,
        origin: params.context?.origin,
        frameId: params.context?.auxData?.frameId,
        isDefault: params.context?.auxData?.isDefault,
      });
    });
    await session.enableWebMcpDomain();
    session.subscribe('WebMCP.toolsAdded', (params) => {
      for (const tool of params.tools ?? []) {
        added.push({ name: tool.name, frameId: params.frameId ?? tool.frameId ?? null });
      }
    });

    await session.navigate(url);
    // Registration is async in both frames, and a cross-origin child loads on its
    // own schedule; 8 s is the same settle budget the harness gives a manifest.
    await new Promise((r) => setTimeout(r, 8000));

    const top = JSON.parse(
      await session.evaluate('document.modelContext.getTools().then((t) => JSON.stringify(t.map((x) => x.name)))')
    );
    const { frameTree } = await session.send('Page.getFrameTree');
    const frames = [frameTree.frame, ...(frameTree.childFrames ?? []).map((c) => c.frame)];

    const browserNames = added.map((a) => a.name);
    const onlyInBrowser = browserNames.filter((n) => !top.includes(n));

    // Looking inside the embed, because "the host cannot see it" and "the embed
    // never registered" are opposite answers to #227's question and produce the
    // same silence in the two views above. A cross-origin child is an
    // out-of-process iframe: it does not appear in `/json/list` and is not a
    // context in this session, so it has to be found through `Target.getTargets`
    // at browser level and attached to. That also means the absence of
    // `toolsAdded` above may be a scope artefact of where `WebMCP.enable` was
    // called rather than a fact about the embed, which is exactly why this check
    // exists.
    //
    // Match by **origin**, not by a URL substring: the host's own URL carries the
    // widget URL in its query string, and matching on "widget.html" attached to
    // the host page and read the host's own tools back — a false negative that
    // looked like a real answer.
    let embed = null;
    // Match the context by the **child** frame's id rather than by origin: in the
    // same-origin case both frames share an origin, and matching on origin picked
    // the top frame and reported the host's own tools as the embed's.
    const childFrameId = (frameTree.childFrames ?? [])[0]?.frame?.id ?? null;
    if (childFrameId) {
      const context = contexts.find((c) => c.frameId === childFrameId && c.isDefault !== false);
      if (!context) {
        embed = {
          found: false,
          note: 'no execution context announced for the child frame',
          sawOrigins: [...new Set(contexts.map((c) => c.origin))],
        };
      } else {
        const { result } = await session.send('Runtime.evaluate', {
          contextId: context.id,
          expression: `(async () => {
            const has = 'modelContext' in document && !!document.modelContext;
            if (!has) return JSON.stringify({ modelContext: false, href: location.href });
            let names = null, error = null;
            try { names = (await document.modelContext.getTools()).map((t) => t.name); }
            catch (e) { error = String((e && e.message) || e); }
            return JSON.stringify({ modelContext: true, ownGetTools: names, error, href: location.href });
          })()`,
          awaitPromise: true,
          returnByValue: true,
        });
        embed = { found: true, ...JSON.parse(result.value) };
      }
    }

    return {
      label,
      topFrameGetTools: top,
      browserView: browserNames,
      distinctFrameIds: new Set(added.map((a) => a.frameId)).size,
      frames: frames.map((f) => ({ url: f.url.replace(/\?.*$/, ''), origin: f.securityOrigin })),
      registeredButNotVisibleToHost: onlyInBrowser,
      embed,
      verdict:
        onlyInBrowser.length > 0
          ? `the embed registered ${onlyInBrowser.join(', ')} and the host page cannot see it`
          : browserNames.includes('widget_ping')
            ? "the embed's tool is in the host page's manifest"
            : embed?.modelContext === false
              ? 'the embed has no modelContext at all, so it could not register'
              : embed?.ownGetTools?.includes('widget_ping')
                ? 'the embed registered its tool and sees it itself, but the host page does not'
                : 'the embed registered nothing observable from either side',
    };
  } finally {
    await session.close();
  }
};

const widgetUrl = new URL('widget.html', widgetServer.origin).href;
const crossHost = `${new URL('host-cross.html', hostServer.origin).href}?widget=${encodeURIComponent(widgetUrl)}`;
const results = [
  await measure('same-origin', new URL('host.html', hostServer.origin).href, hostServer.origin),
  await measure('cross-origin, no allow attribute', crossHost, widgetServer.origin),
  await measure('cross-origin, allow="tools"', `${crossHost}&allow=1`, widgetServer.origin),
];

console.log(`build: ${build.version.Browser}`);
console.log(`host origin:   ${hostServer.origin}`);
console.log(`widget origin: ${widgetServer.origin}\n`);
for (const result of results) {
  console.log(`--- ${result.label}`);
  console.log(`  top frame getTools(): ${JSON.stringify(result.topFrameGetTools)}`);
  console.log(`  browser view:         ${JSON.stringify(result.browserView)} across ${result.distinctFrameIds} frame(s)`);
  console.log(`  frames:               ${result.frames.map((f) => f.origin).join(' | ')}`);
  console.log(`  inside the embed:     ${result.embed ? JSON.stringify(result.embed) : '(no separate target — same process as the host)'}`);
  console.log(`  verdict:              ${result.verdict}`);
}

await build.browser.close();
await hostServer.close();
await widgetServer.close();
