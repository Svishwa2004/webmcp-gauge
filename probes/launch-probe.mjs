/**
 * Launches one session's browser, reads the WebMCP surface, and tears it down.
 *
 * Exists to answer "can this harness stand up its own flagged Chrome?" without
 * spending a sweep to find out, and to print Chrome's own stderr when it cannot.
 * Set WEBMCP_GAUGE_CHROME_LOG=1 to see the browser's output.
 *
 * Usage: node probes/launch-probe.mjs [url]
 */
import { launchSession } from '../browser/launch.mjs';
import { openSession } from '../browser/session.mjs';
import { captureManifest } from '../browser/webmcp.mjs';

const url = process.argv[2] ?? 'https://airlock-app.netlify.app';

const browser = await launchSession({ profileDir: 'artifacts/launch-probe-profile' });
console.log(
  JSON.stringify(
    { launched: true, port: browser.port, pid: browser.pid, build: browser.build, headless: browser.headless },
    null,
    2
  )
);

const tab = await openSession({ port: browser.port });
try {
  await tab.navigate(url);
  const manifest = await captureManifest(tab);
  console.log(
    JSON.stringify(
      {
        url,
        present: manifest.present,
        settled: manifest.settled,
        settledAtMs: manifest.settledAtMs,
        toolCount: manifest.tools?.length ?? 0,
        names: manifest.tools?.map((tool) => tool.name) ?? null,
      },
      null,
      2
    )
  );
} finally {
  await tab.close();
  await browser.close();
}
