/**
 * Launches and tears down one flagged Chrome per measurement session.
 *
 * This exists because of what the two 1.2.0/1.3.0 sweeps showed: repeats that
 * share a browser process, a warm page cache and one provider session are
 * correlated by construction, so the sigma computed across them describes session
 * stability rather than run-to-run stability. A session needs its own browser and
 * its own cold cache before its variance means anything.
 *
 * Measured 2026-08-30: a brand-new user-data-dir containing nothing but
 * {"browser":{"enabled_labs_experiments":["enable-webmcp-testing@1"]}} in
 * `Local State` is enough for Chrome 152 to expose document.modelContext, and it
 * works in --headless=new. No copied profile, no flag UI, and a genuinely cold
 * cache per session.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const DEFAULT_CHROME =
  process.env.WEBMCP_GAUGE_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const WEBMCP_FLAG_PROFILE = JSON.stringify({
  browser: { enabled_labs_experiments: ['enable-webmcp-testing@1'] },
});

export const findFreePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const waitForDevTools = async (port, { timeoutMs = 30000, pollTimeoutMs = 2000 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'never answered';

  while (Date.now() < deadline) {
    try {
      // Each poll is bounded on its own. A deadline around an unbounded fetch is
      // not a deadline: one request that never answers holds the loop open past it
      // forever, which is how a launch turns into a silent hang instead of an error.
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(Math.min(pollTimeoutMs, Math.max(250, deadline - Date.now()))),
      });
      if (response.ok) {
        const payload = await response.json();
        return { build: payload.Browser, protocol: payload['Protocol-Version'] };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error.message ?? error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Chrome did not expose DevTools on ${port} within ${timeoutMs}ms (${lastError})`);
};

/**
 * Windows leaves Chrome's renderer and GPU children alive when only the parent is
 * killed, and those children keep the profile directory locked, which then fails
 * the cleanup and silently reuses a warm profile next session.
 *
 * Exported because the orchestrator needs the same thing for a session process:
 * killing the node child alone would orphan the Chrome it launched.
 */
export const killTree = (pid, { timeoutMs = 10000 } = {}) =>
  new Promise((resolve) => {
    if (process.platform !== 'win32') {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
      resolve();
      return;
    }
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    // Even the killer gets a deadline: cleanup that can hang is one more way for a
    // sweep to stop without saying anything.
    const timer = setTimeout(() => resolve(), timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    killer.on('close', done);
    killer.on('error', done);
  });

export const launchSession = async ({
  profileDir,
  port,
  headless = true,
  chromePath = DEFAULT_CHROME,
  extraArgs = [],
  keepProfile = false,
} = {}) => {
  const chosenPort = port ?? (await findFreePort());
  // Chrome must be given an absolute --user-data-dir: with a relative one it can
  // start against a different directory than the one seeded with the flag, or fail
  // to start at all, and the only symptom is a DevTools port that never answers.
  const dir = resolve(profileDir ?? `artifacts/sessions/session-${chosenPort}`);

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/Local State`, WEBMCP_FLAG_PROFILE, 'utf8');

  const args = [
    `--remote-debugging-port=${chosenPort}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    ...(headless ? ['--headless=new'] : []),
    ...extraArgs,
    'about:blank',
  ];

  const child = spawn(chromePath, args, {
    // Chrome's own stderr is the only place a launch failure explains itself, and
    // swallowing it turns any startup problem into an unhelpful timeout.
    stdio: process.env.WEBMCP_GAUGE_CHROME_LOG ? 'inherit' : 'ignore',
    detached: process.platform !== 'win32',
  });

  let exited = null;
  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });

  try {
    const version = await waitForDevTools(chosenPort);
    return {
      port: String(chosenPort),
      pid: child.pid,
      profileDir: dir,
      headless,
      build: version.build,
      protocol: version.protocol,
      startedAt: new Date().toISOString(),
      exitInfo: () => exited,
      async close() {
        if (child.pid) await killTree(child.pid);
        if (!keepProfile) {
          // Chrome releases the profile lock asynchronously; one retry is enough
          // in practice and a failure here is not worth aborting a sweep over.
          await new Promise((resolve) => setTimeout(resolve, 300));
          await rm(dir, { recursive: true, force: true }).catch(async () => {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            await rm(dir, { recursive: true, force: true }).catch(() => {});
          });
        }
      },
    };
  } catch (error) {
    if (child.pid) await killTree(child.pid);
    throw error;
  }
};
