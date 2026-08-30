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
 */
import { spawn } from 'node:child_process';

export const runSessions = async ({
  sessions = 3,
  binPath,
  args,
  gapSeconds = 0,
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

      child.on('error', (error) =>
        resolve({ session, code: null, error: String(error.message ?? error) })
      );
      child.on('close', (code) => resolve({ session, code, error: null }));
    });

    results.push({ ...result, elapsedMs: Date.now() - startedMs });
    onSessionEnd({ session, sessions, ...result });
  }

  return results;
};
