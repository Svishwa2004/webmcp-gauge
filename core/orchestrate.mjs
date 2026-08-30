/**
 * Runs S measurement sessions, each in its own OS process.
 *
 * The child process is not ceremony. Node pools HTTP connections per process, so
 * sessions sharing a process share the judge's keep-alive connections, and a
 * "session" that reuses the same socket to the same provider is not independent in
 * the way a reproducibility claim needs. One process per session also means one
 * browser, one cold profile, and crash isolation: a session that dies takes only
 * its own trials with it, and the checkpoint keeps the rest.
 *
 * What this still does not isolate, and the report says so: the machine, the
 * network path, the provider's own server-side state, and time - three sessions
 * minutes apart are not three sessions on three days.
 *
 * A session is watched rather than merely awaited. A child that stops making
 * progress and never exits stalled a whole run silently once, and the layer that
 * notices has to be the one that can kill it. The watchdog is measured in *progress*
 * rather than elapsed time: an honest session duration depends on how many trials it
 * was given, while "wrote nothing for ten minutes" means the same thing for a
 * 20-trial session and a 480-trial one.
 */
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { killTree } from '../browser/launch.mjs';

/** Newest mtime across the files a session appends to as it works. */
const lastProgressAt = async (paths) => {
  let newest = 0;
  for (const path of paths) {
    try {
      const info = await stat(path);
      newest = Math.max(newest, info.mtimeMs);
    } catch {
      // A file that does not exist yet is not progress, and not an error either.
    }
  }
  return newest;
};

export const runSessions = async ({
  sessions = 3,
  binPath,
  args,
  gapSeconds = 0,
  /** Files a working session appends to: the checkpoint and the failure log. */
  progressPaths = [],
  /**
   * How long a session may write nothing before it counts as stalled. The per-trial
   * deadline inside a session is 180s, so ten minutes of silence means the stall is
   * somewhere a trial deadline cannot see - launching a browser, or the process.
   */
  stallTimeoutMs = 600000,
  pollIntervalMs = 15000,
  onSessionStart = () => {},
  onSessionEnd = () => {},
}) => {
  const results = [];

  for (let session = 1; session <= sessions; session += 1) {
    if (session > 1 && gapSeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, gapSeconds * 1000));
    }

    onSessionStart({ session, sessions });
    const startedMs = Date.now();

    const result = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [binPath, 'session', '--session', String(session), ...args],
        { stdio: ['ignore', 'inherit', 'inherit'] }
      );

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        resolve(value);
      };

      let lastSeenAt = Date.now();
      let lastProgress = 0;
      // Set before the kill, because killing the child makes 'close' fire while the
      // watchdog is still awaiting taskkill, and the first finish() wins. Without
      // this flag a session we killed reports as an ordinary non-zero exit, which is
      // the one distinction the watchdog exists to make.
      let stallReason = null;

      const watchdog = setInterval(async () => {
        if (settled || stallReason) return;

        const progressAt = await lastProgressAt(progressPaths);
        if (progressAt > lastProgress) {
          lastProgress = progressAt;
          lastSeenAt = Date.now();
          return;
        }
        if (Date.now() - lastSeenAt < stallTimeoutMs) return;

        // Killed rather than waited on, and reported as a stall rather than as a
        // crash: the parent recomputes coverage from the plan, so whatever this
        // session did not reach comes back as missing and --resume retries it.
        stallReason = `wrote nothing for ${Math.round((Date.now() - lastSeenAt) / 1000)}s and was killed`;
        if (child.pid) await killTree(child.pid);
        finish({ session, code: null, stalled: true, error: stallReason });
      }, pollIntervalMs);
      watchdog.unref?.();

      child.on('error', (error) =>
        finish({ session, code: null, stalled: false, error: String(error.message ?? error) })
      );
      child.on('close', (code) =>
        finish(
          stallReason
            ? // The exit code of a process we killed describes the kill, not the run.
              { session, code: null, stalled: true, error: stallReason }
            : { session, code, stalled: false, error: null }
        )
      );
    });

    results.push({ ...result, elapsedMs: Date.now() - startedMs });
    onSessionEnd({ session, sessions, ...result });
  }

  return results;
};
