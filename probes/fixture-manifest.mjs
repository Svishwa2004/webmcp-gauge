/**
 * Serves a fixture page to a freshly launched flagged Chrome and prints what the
 * page's WebMCP surface actually looks like.
 *
 * The point is registration ground truth. A fixture that deliberately registers a
 * tool with a space in its name (spec issue #145) may have that tool silently
 * dropped by the browser, and a linter that only ever sees getTools() would then
 * never see the defect. This probe reports both sides: what the page tried to
 * register, and what the browser handed back.
 *
 * Usage: node probes/fixture-manifest.mjs [pathAndQuery] [fixtureDir]
 *   node probes/fixture-manifest.mjs "twin.html?variant=degraded"
 *   node probes/fixture-manifest.mjs "twin.html?variant=clean&flood=180"
 */
import { launchSession } from '../browser/launch.mjs';
import { startFixtureServer } from '../browser/serve.mjs';
import { openSession } from '../browser/session.mjs';
import { captureManifest } from '../browser/webmcp.mjs';

const pathAndQuery = process.argv[2] ?? 'twin.html?variant=degraded';
const fixtureDir = process.argv[3] ?? 'fixtures/broken';

const server = await startFixtureServer({ root: fixtureDir });
const browser = await launchSession({ profileDir: 'artifacts/fixture-probe-profile' });
const tab = await openSession({ port: browser.port });

try {
  const url = server.urlFor(pathAndQuery);
  await tab.navigate(url);
  const manifest = await captureManifest(tab);
  const registration = await tab.evaluate('window.__fixtureRegistration ?? null');
  const badge = await tab.evaluate(
    "(() => { const el = document.getElementById('tool-badge'); return el ? { text: el.textContent, state: el.dataset.state } : null; })()"
  );

  console.log(
    JSON.stringify(
      {
        url,
        build: browser.build,
        badge,
        pageAttempted: registration
          ? { variant: registration.variant, flood: registration.flood, registered: registration.registered, rejected: registration.rejected }
          : null,
        browserReturned: {
          present: manifest.present,
          settled: manifest.settled,
          settledAtMs: manifest.settledAtMs,
          toolCount: manifest.tools?.length ?? 0,
          names: manifest.tools?.map((tool) => tool.name) ?? null,
        },
        // The gap between the two lists is the finding, not a formatting detail.
        droppedByBrowser: registration
          ? registration.registered.filter(
              (name) => !(manifest.tools ?? []).some((tool) => tool.name === name)
            )
          : null,
      },
      null,
      2
    )
  );
} finally {
  await tab.close();
  await browser.close();
  await server.close();
}
