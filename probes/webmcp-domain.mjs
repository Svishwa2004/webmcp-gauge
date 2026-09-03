/**
 * What the browser's own WebMCP domain exposes, and whether it agrees with the page.
 *
 * The taxonomy has always had a `not_discovered` outcome - the page registered a
 * tool, the client never surfaced it - and has never been able to reach it, because
 * the harness only ever read the page's own `getTools()`. Distinguishing "the page
 * did not register it" from "the browser dropped it" needs a second, independent
 * view, and the only candidate is the CDP `WebMCP` domain.
 *
 * This probe answers three questions before anything is built on it:
 *   1. What commands and events does the WebMCP domain actually have in this build?
 *      Read from /json/protocol, which is the browser describing itself.
 *   2. Does a browser-side tool list exist, and does it match the page's?
 *   3. At what tool count does the browser stop agreeing? The field report of 296
 *      tools silently disabling WebMCP predicts a divergence somewhere, and a
 *      divergence is exactly what `not_discovered` is for.
 *
 * Usage: node probes/webmcp-domain.mjs [floodCounts] [--port=9333]
 *   node probes/webmcp-domain.mjs            # protocol dump + 0, 64, 180, 300
 *   node probes/webmcp-domain.mjs 0,500
 *   node probes/webmcp-domain.mjs 0,500 --port=9333   # attach to a browser we cannot launch
 */
import { launchSession } from '../browser/launch.mjs';
import { startFixtureServer } from '../browser/serve.mjs';
import { openSession } from '../browser/session.mjs';
import { captureManifest, watchBrowserTools } from '../browser/webmcp.mjs';

const argv = process.argv.slice(2);
const portFlag = argv.find((arg) => arg.startsWith('--port='));
const floods = (argv.find((arg) => !arg.startsWith('--')) ?? '0,64,180,300')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isInteger(value) && value >= 0);

const server = await startFixtureServer({ root: 'fixtures/broken' });

// --port attaches to a browser somebody else started. It is the only way to ask
// this question of a client the harness cannot launch: the ChatGPT desktop app
// needs its own entry point and its own switch
// (`--enable-blink-features=WebMCPTesting`). The default stays "launch our own
// cold Chrome", so every published number keeps the profile it was measured on.
const browser = portFlag
  ? await (async (port) => {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(15000),
      }).then((response) => response.json());
      return { port, build: version.Browser, close: async () => {} };
    })(portFlag.split('=')[1])
  : await launchSession({ profileDir: 'artifacts/webmcp-domain-probe' });

try {
  const protocol = await fetch(`http://127.0.0.1:${browser.port}/json/protocol`, {
    signal: AbortSignal.timeout(15000),
  }).then((response) => response.json());

  const domain = protocol.domains?.find((entry) => entry.domain === 'WebMCP') ?? null;
  console.log(`# build ${browser.build}\n`);
  console.log('## WebMCP domain, as the browser describes it\n');
  if (!domain) {
    console.log('No WebMCP domain in /json/protocol. Everything below is page-side only.');
  } else {
    console.log(
      JSON.stringify(
        {
          experimental: domain.experimental ?? false,
          commands: (domain.commands ?? []).map((command) => ({
            name: command.name,
            parameters: (command.parameters ?? []).map((parameter) => parameter.name),
            returns: (command.returns ?? []).map((value) => `${value.name}: ${value.type ?? value.$ref}`),
          })),
          events: (domain.events ?? []).map((event) => ({
            name: event.name,
            parameters: (event.parameters ?? []).map((parameter) => parameter.name),
          })),
          types: (domain.types ?? []).map((type) => ({
            id: type.id,
            properties: (type.properties ?? []).map((property) => property.name),
          })),
        },
        null,
        2
      )
    );
  }

  console.log('\n## page view against browser view\n');
  const scenarios = [
    ...floods.map((flood) => ({ label: `flood=${flood}`, query: `variant=clean&flood=${flood}` })),
    // A subframe registration: the harness has only ever read the top frame's own
    // getTools(), and the browser reports a frameId per tool. If they disagree here,
    // a page whose tools live in an embed is measurable only from the browser side.
    { label: 'iframe widget', query: 'variant=clean&iframe=1' },
  ];

  for (const scenario of scenarios) {
    const tab = await openSession({ port: browser.port });
    try {
      // Started before navigation on purpose: the browser announces tools through
      // events, so a watch attached afterwards sees nothing and would read as "the
      // browser surfaced none of them".
      const watch = await watchBrowserTools(tab);

      await tab.navigate(server.urlFor(`twin.html?${scenario.query}`));
      const manifest = await captureManifest(tab);
      const registration = await tab.evaluate('window.__fixtureRegistration ?? null');

      // Events can land after getTools() has settled; give the browser the same
      // grace the page gets before declaring a disagreement.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const pageNames = (manifest.tools ?? []).map((tool) => tool.name);
      const browserNames = watch.names() ?? [];
      const onlyInPage = pageNames.filter((name) => !browserNames.includes(name));
      const onlyInBrowser = browserNames.filter((name) => !pageNames.includes(name));
      const frames = new Set((watch.tools() ?? []).map((tool) => tool.frameId));
      const sample = watch.tools()?.[0] ?? null;
      watch.stop();

      console.log(
        JSON.stringify(
          {
            scenario: scenario.label,
            domainAvailable: watch.available,
            pageAttemptedRegistrations: registration?.registered?.length ?? null,
            pageRejected: registration?.rejected?.length ?? null,
            pageGetToolsCount: pageNames.length,
            browserToolCount: browserNames.length,
            browserFrames: frames.size,
            settled: manifest.settled,
            settledAtMs: manifest.settledAtMs,
            registeredButNotSurfaced: onlyInPage,
            surfacedButNotInPage: onlyInBrowser,
            removedByBrowser: watch.removedNames(),
            // What the browser knows that the page does not: where the tool came from.
            browserExtraFields: sample
              ? Object.keys(sample).filter((key) => !['name', 'description', 'inputSchema', 'annotations'].includes(key))
              : null,
          },
          null,
          2
        )
      );
    } finally {
      await tab.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
