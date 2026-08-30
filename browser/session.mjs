/**
 * One CDP session against one fresh tab of an already-running flagged Chrome.
 *
 * Grown from _spike/cdp-eval.mjs, with the parts a trial needs that the spike
 * lacked: a clean close path (the spike prints valid JSON and then dies with a
 * libuv assertion on Windows, which is fine for a manual probe and unacceptable
 * for anything a CI gate depends on), and no process.exit anywhere.
 */

const DEFAULT_PORT = '9333';

export const openSession = async ({
  port = process.env.CDP_PORT ?? DEFAULT_PORT,
  timeoutMs = 30000,
} = {}) => {
  const base = `http://127.0.0.1:${port}`;

  const target = await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })
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
    if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`));
    else entry.resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP websocket failed to open')), {
      once: true,
    });
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error(`session closed, cannot send ${method}`));
        return;
      }
      const id = nextId++;
      pending.set(id, { resolve, reject });
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
    for (const entry of pending.values()) entry.reject(new Error('session closed'));
    pending.clear();
    try {
      socket.close();
    } catch {
      // A socket that is already gone is the state we wanted.
    }
    await fetch(`${base}/json/close/${target.id}`).catch(() => {});
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
