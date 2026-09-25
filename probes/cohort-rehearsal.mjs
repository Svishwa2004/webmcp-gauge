/**
 * Rehearsal for PROJECT-LOG item 23: the capture, end to end, against the page
 * shape that breaks a host-attached watch.
 *
 * `probes/browser-scope.mjs` measured the *views* (host-attached 3, browser-
 * endpoint 4) but a fix nobody exercised on the real capture path is not a fix —
 * item 23's own bar. So this drives the actual runner, `cohort-snapshot.mjs`,
 * against the `spec-227` cross-site delegating fixture: two fixture servers on
 * the two loopback names Chrome treats as different sites, the host page
 * embedding the widget with `allow="tools"`, one capture, one record.
 *
 * PASS requires every part of the fix to show up in the record the capture
 * writes: the page view stays at the host's 3 (attribution intact), the agent
 * view is the union of 4, `widget_ping` attributed to its own origin, and the
 * record carries the browser-view metadata with at least one OOPIF session —
 * because a capture where no OOPIF ever attached has measured auto-attach, not
 * the browser's view, and must never publish as one.
 *
 * Usage: node probes/cohort-rehearsal.mjs
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { startFixtureServer } from '../browser/serve.mjs';

const root = 'fixtures/spec-227';

const hostServer = await startFixtureServer({ root, host: 'localhost' });
const widgetServer = await startFixtureServer({ root, host: '127.0.0.1' });

const outDir = resolve(`artifacts/cohort-rehearsal-${Date.now()}`);
const url = `${new URL('host-cross.html', hostServer.origin).href}?widget=${encodeURIComponent(
  new URL('widget.html', widgetServer.origin).href
)}&allow=1`;

let verdict = 1;
try {
  console.log(`host    ${hostServer.origin}`);
  console.log(`widget  ${widgetServer.origin}  (different site, delegated with allow="tools")`);
  console.log(`capture ${url}`);
  console.log(`out     ${outDir}\n`);

  const child = spawn(
    process.execPath,
    ['probes/cohort-snapshot.mjs', `--url=${url}`, `--out=${outDir}`],
    { stdio: 'inherit' }
  );
  const code = await new Promise((done) => child.on('exit', (exitCode) => done(exitCode)));
  if (code !== 0) {
    console.error(`\nrehearsal: the capture itself exited ${code}`);
    process.exit(code);
  }

  const record = JSON.parse(await readFile(`${outDir}/snapshot.jsonl`, 'utf8'));
  const webmcp = record.webmcp;
  const agent = webmcp.agentTools ?? [];
  const attributed = (webmcp.attribution ?? []).find((t) => t.name === 'widget_ping');
  const oopi = webmcp.browserView?.oopiFrames ?? 0;

  console.log('\n--- what the capture recorded');
  console.log(`reachable:          ${record.liveness.reachable}`);
  console.log(`page getTools():    ${webmcp.toolCount} — ${(webmcp.tools ?? []).map((t) => t.name).join(', ')}`);
  console.log(`agent view:         ${webmcp.agentToolCount} — ${agent.join(', ')}`);
  console.log(`browserView:        ${JSON.stringify(webmcp.browserView)}`);
  console.log(`onlyInBrowser:      ${JSON.stringify(webmcp.divergence?.onlyInBrowser ?? null)}`);
  console.log(`widget attribution: origin ${attributed?.origin ?? '(none)'}, sameOrigin ${attributed?.sameOrigin}`);

  const missing = ['host_alpha', 'host_beta', 'host_gamma', 'widget_ping'].filter((name) => !agent.includes(name));

  if (missing.length === 0 && webmcp.toolCount === 3 && webmcp.agentToolCount === 4 && attributed?.sameOrigin === false) {
    console.log('\nREHEARSAL PASS: the real capture sees the cross-site union a host-attached watch cannot.');
    console.log('The record also carries browserView metadata, so a number drawn from a watch that no');
    console.log('OOPIF ever attached to can never masquerade as the browser\'s view.');
    verdict = 0;
  } else if (oopi === 0) {
    console.log('\nREHEARSAL CANNOT ANSWER: no OOPIF session attached, so this run measured auto-attach,');
    console.log('not the browser\'s view of WebMCP. The child target does exist — browser-scope.mjs reads');
    console.log('it straight from /json/list — so a null here is about what auto-attach reached.');
    verdict = 2;
  } else {
    console.log(
      `\nREHEARSAL FAIL: agent view missing [${missing.join(', ') || 'nothing'}], page tools ${webmcp.toolCount}/3,` +
        ` agent tools ${webmcp.agentToolCount}/4, widget sameOrigin ${attributed?.sameOrigin}`
    );
    verdict = 1;
  }
} finally {
  await hostServer.close();
  await widgetServer.close();
}

process.exit(verdict);
