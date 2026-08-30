/**
 * One CDP session against one fresh tab of an already-running flagged Chrome.
 *
 * Grown from _spike/cdp-eval.mjs, with the parts a trial needs that the spike
 * lacked: a clean close path (the spike prints valid JSON and then dies with a
 * libuv assertion on Windows, which is fine for a manual probe and unacceptable
 * for anything a CI gate depends on), and no process.exit anywhere.
 *
 * Every wait in here is bounded. Nothing was, until a sweep hung for 90 minutes on
 * trial 160 of 160 with no error and no progress: a CDP command that never gets a
 * reply used to leave its promise pending forever, and `fetch` against the browser's
 * own HTTP endpoint had no timeout either. A hang is indistinguishable from work in
 * progress, which makes it the worst failure mode a long run can have - so a
 * silent stall is now an error, and the sweep records it as a non-measurement.
 */

const DEFAULT_PORT = '9333';

export const openSession = async ({
  port = process.env.CDP_PORT ?? DEFAULT_PORT,
  timeoutMs = 30000,
} = {}) => {
  const base = `http://127.0.0.1:${port}`;

  const target = await fetch(`${base}/json/new?about:blank`, {
    method: 'PUT',
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then((response) => {
      if (!response.ok) throw new Error(`CDP ${response.status} from ${base}/json/new`);
      return response.json();
    })
    .catch((error) => {
      throw new Error(
        `No debuggable Chrome on ${base} (${error.message}). Launch it per docs/getting-started.md 1.1, and check /json/version answers.`
      );
    });

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const eventWaiters = [];
  let nextId = 1;
  let closed = false;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.method) {
      for (const waiter of eventWaiters.splice(0)) {
        if (waiter.method === message.method) waiter.resolve(message.params ?? {});
        else eventWaiters.push(waiter);
      }
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`));
    else entry.resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`CDP websocket did not open within ${timeoutMs}ms`)),
      timeoutMs
    );
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('CDP websocket failed to open'));
      },
      { once: true }
    );
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error(`session closed, cannot send ${method}`));
        return;
      }
      const id = nextId++;
      // A command with no reply is a dead session, not a slow one. Without this the
      // promise stays pending and the caller waits forever.
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} did not answer within ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const waitForEvent = (method, waitMs = timeoutMs) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), waitMs);
      eventWaiters.push({
        method,
        resolve: (params) => {
          clearTimeout(timer);
          resolve(params);
        },
      });
    });

  /** Returns the evaluated value, or throws with the page-side exception text. */
  const evaluate = async (expression, { awaitPromise = true } = {}) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(
        `page threw: ${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ''}`.trim()
      );
    }
    return result.value ?? null;
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('session closed'));
    }
    pending.clear();
    try {
      socket.close();
    } catch {
      // A socket that is already gone is the state we wanted.
    }
    // Bounded, because closing the tab is cleanup: a browser that will not answer
    // must not be able to hold a whole sweep open.
    await fetch(`${base}/json/close/${target.id}`, { signal: AbortSignal.timeout(timeoutMs) }).catch(
      () => {}
    );
  };

  await send('Page.enable');
  await send('Runtime.enable');

  return {
    targetId: target.id,
    port: String(port),
    send,
    evaluate,
    waitForEvent,
    close,

    /** Navigates and waits for the load event. Registration lands later; see captureManifest. */
    async navigate(url) {
      const loaded = waitForEvent('Page.loadEventFired');
      // If the navigate command itself fails, nothing will ever fire the waiter,
      // and its timeout would surface later as an unhandled rejection that kills
      // the process instead of the caller's error.
      loaded.catch(() => {});
      await send('Page.navigate', { url });
      await loaded;
    },

    /**
     * Enables the browser-side WebMCP domain when the build has one. Chrome 152
     * does; a build that does not is a compatibility-matrix row, not a failure,
     * so the caller gets a flag rather than an exception.
     */
    async enableWebMcpDomain() {
      try {
        await send('WebMCP.enable');
        return { available: true };
      } catch (error) {
        return { available: false, reason: String(error.message ?? error) };
      }
    },
  };
};
