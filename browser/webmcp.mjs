/**
 * The WebMCP surface of a page, read through a CDP session.
 *
 * Every read here is deliberately defensive about build differences, because the
 * differences are the data: on Chrome 152 `getTools()` resolves a Promise and
 * `navigator.modelContext` no longer exists, while the draft and older builds
 * disagree on both, and `executeTool` takes an object in the draft but a JSON
 * string in the type surface verified against Chrome 151.
 */

/**
 * Waits for the tool set to stop changing rather than to be non-empty. A
 * mid-registration read of the reference page returned 3, then 4, of its 7 tools
 * with no error at all - a partial set reported as the whole one.
 */
const MANIFEST_EXPRESSION = `(async () => {
  const mc = document.modelContext ?? navigator.modelContext ?? null;
  if (!mc) {
    return { present: false, inNavigator: 'modelContext' in navigator };
  }

  const readTools = async () => {
    if (typeof mc.getTools !== 'function') return null;
    const raw = mc.getTools();
    return raw != null && typeof raw.then === 'function' ? await raw : raw;
  };

  const deadline = Date.now() + 8000;
  const stableReadsRequired = 4;
  const startedAt = Date.now();
  let tools = null;
  let lastKey = null;
  let stableReads = 0;
  let settledAtMs = null;

  while (Date.now() < deadline) {
    tools = await readTools();
    const key = Array.isArray(tools) ? JSON.stringify(tools.map((t) => t?.name ?? null)) : null;
    if (key !== null && key === lastKey) {
      stableReads += 1;
      if (Array.isArray(tools) && tools.length > 0 && stableReads >= stableReadsRequired) {
        settledAtMs = Date.now() - startedAt;
        break;
      }
    } else {
      stableReads = 0;
      lastKey = key;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return {
    present: true,
    inNavigator: 'modelContext' in navigator,
    surface: Object.getOwnPropertyNames(Object.getPrototypeOf(mc)),
    frozen: Object.isFrozen(mc),
    settled: settledAtMs !== null,
    settledAtMs,
    tools: Array.isArray(tools)
      ? tools.map((tool) => {
          // Measured on Chrome 152.0.7977.65 (2026-08-30): getTools() hands
          // inputSchema back as a JSON *string*, even for a tool registered with a
          // real object - the #241 DOMString-to-object move has not landed in this
          // build's read-back path. Parse it here so every consumer sees a schema,
          // and record which wire form the build used, because that is a
          // compatibility-matrix row rather than a detail to paper over. Leaving it
          // unparsed silently disabled the harness's own unknown-argument check and
          // showed the judge an escaped blob where a schema should be.
          const raw = tool?.inputSchema ?? null;
          let inputSchema = raw;
          let wire = raw === null || raw === undefined ? 'absent' : typeof raw;
          if (typeof raw === 'string') {
            try {
              inputSchema = JSON.parse(raw);
            } catch {
              wire = 'unparseable-string';
            }
          }
          return {
            name: tool?.name ?? null,
            title: tool?.title ?? null,
            description: tool?.description ?? null,
            inputSchema,
            inputSchemaWire: wire,
            annotations: tool?.annotations ?? null,
          };
        })
      : null,
  };
})()`;

/**
 * Airlock renders highlighting as a class on the row body plus a note element.
 * Both are read-only DOM facts, which is what separates a real effect from a
 * tool that returned cheerfully and changed nothing (`silent_fail`).
 */
const OBSERVATION_EXPRESSION = `(() => {
  const body = document.querySelector('tbody');
  const note = document.querySelector('#highlight-note');
  return {
    highlightClass: body ? body.className : null,
    highlightNote: note ? note.textContent : null,
    dimmedRows: document.querySelectorAll('tbody.has-highlight tr:not(.hit)').length,
    title: document.title,
  };
})()`;

export const captureManifest = (session) => session.evaluate(MANIFEST_EXPRESSION);

export const observe = (session) => session.evaluate(OBSERVATION_EXPRESSION);

/**
 * The browser's own view of a page's tools, accumulated from CDP events.
 *
 * This is the second, independent view the `not_discovered` outcome has always
 * needed: the page's `getTools()` says what the page believes it registered, this
 * says what the browser is prepared to offer an agent, and a disagreement between
 * them is invisible from inside the page - exactly the silent failure this project
 * exists to catch.
 *
 * Measured on Chrome 152.0.7977.65 (2026-08-31): the `WebMCP` domain is experimental
 * and has **no command that lists tools** — only `enable`, `disable`, `invokeTool`
 * and `cancelInvocation`. The set arrives as `toolsAdded` events, so it can only be
 * accumulated, and the watch must start *before* navigation or the events are already
 * gone. On a build without the domain this returns `available: false` and `names()`
 * returns null rather than an empty array: a view you do not have is not evidence of
 * absence, and the classifier must not read it as one.
 *
 * Two entry points share one accumulator:
 *
 * - `watchBrowserTools(session)` attaches to one page target. Enough when the page
 *   and its embeds are same-site: every registration arrives at that session. This
 *   is what trials use, and what a same-site capture should use.
 * - `watchBrowserToolsAtBrowser(webSocketDebuggerUrl)` attaches at the browser
 *   endpoint instead, which is what a capture over an unknown cohort must use,
 *   because a cross-site delegating embed is invisible to the host-attached view.
 */
export const watchBrowserTools = async (session) => {
  const present = new Map();
  const removed = [];

  const stopAdded = session.subscribe('WebMCP.toolsAdded', (params) => {
    for (const tool of params.tools ?? []) {
      if (tool?.name) present.set(tool.name, tool);
    }
  });
  const stopRemoved = session.subscribe('WebMCP.toolsRemoved', (params) => {
    for (const tool of params.tools ?? []) {
      if (!tool?.name) continue;
      present.delete(tool.name);
      removed.push(tool.name);
    }
  });

  const enabled = await session.enableWebMcpDomain();
  if (!enabled.available) {
    stopAdded();
    stopRemoved();
  }

  return {
    available: enabled.available,
    reason: enabled.reason ?? null,
    names: () => (enabled.available ? [...present.keys()] : null),
    tools: () => (enabled.available ? [...present.values()] : null),
    removedNames: () => (enabled.available ? [...removed] : null),
    stop: () => {
      stopAdded();
      stopRemoved();
    },
  };
};

/**
 * The same accumulation, done at the browser endpoint.
 *
 * `webSocketDebuggerUrl` is the browser's own endpoint (`/json/version`), not a
 * page target's. Everything arrives on one socket, tagged with the `sessionId` of
 * the target each event came from — the pattern `probes/browser-scope.mjs`
 * measured on 2026-09-05 against the `spec-227` cross-site fixture: the host
 * page's `getTools()` sees 3 tools and a watch attached to the host target sees
 * the same 3, while a browser-endpoint watch sees 4 across 2 target sessions,
 * including the cross-site embed's `widget_ping`. A capture that can meet an
 * unknown cohort must read this view, or every page that delegates tools to a
 * different-site embed publishes an `agentVisibleToolCount` that undercounts it —
 * in precisely the case the report cites as the reason for publishing that number
 * beside the page-registered one (PROJECT-LOG item 23).
 *
 * Recursion is the whole game, and it is not automatic. Browser-level auto-attach
 * armed **once** attached six targets with no iframe among them and saw 3 tools —
 * the near-miss that run caught in itself. Every attached session arms
 * `Target.setAutoAttach` again as it attaches; that is what walks down to the
 * out-of-process iframe. Each new session also gets `WebMCP.enable`, tolerated
 * when a target type refuses it: enabling is best-effort per target, and the
 * verdict is about the union, not about any one target's cooperation.
 *
 * Availability cannot be decided at setup the way the host-attached watch decides
 * it, because the browser endpoint itself has no WebMCP domain to enable — the
 * question answers itself one target at a time. So `available` and `reason` are
 * read-time getters, and they keep the classifier-safe rule: a build whose every
 * enable refused reports `available: false` with `names()` null (no view is not
 * evidence of absence), never an empty union.
 *
 * Returns the same view shape as `watchBrowserTools`, plus three read-time
 * counters so a caller can tell "auto-attach reached nothing" apart from "the
 * browser cannot see it" — only one of those is about WebMCP:
 *
 * - `oopiFrames` — attached `iframe` targets. An out-of-process iframe's tool can
 *   only arrive through one, so a run where this is 0 has measured its own
 *   plumbing rather than the browser's view, and the number must travel with any
 *   verdict drawn from the union (the exit-2 guard browser-scope.mjs added after
 *   its own first run would have published the opposite answer).
 * - `sessionCount` — targets attached; `toolSessions` — sessions that produced
 *   tool events, which is how wide the union actually is.
 *
 * The optional `WebSocket` override exists for the same reason the host-attached
 * tests fake the session: the accumulation contract is this repo's logic, and it
 * must be testable without a browser.
 */
export const watchBrowserToolsAtBrowser = async (
  webSocketDebuggerUrl,
  { WebSocket: makeSocket = globalThis.WebSocket } = {}
) => {
  const present = new Map();
  const removed = [];
  const toolSessions = new Set();
  const attached = new Map(); // sessionId -> { targetId, type, url }
  const enableResults = new Map(); // sessionId -> true | refusal message

  const socket = new makeSocket(webSocketDebuggerUrl);
  await new Promise((open, failed) => {
    socket.addEventListener('open', open, { once: true });
    socket.addEventListener(
      'error',
      () => failed(new Error(`could not connect to ${webSocketDebuggerUrl}`)),
      { once: true }
    );
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`));
      else entry.resolve(message.result ?? {});
      return;
    }
    if (!message.method) return;
    for (const handler of listeners.get(message.method) ?? []) {
      handler(message.params ?? {}, message.sessionId ?? null);
    }
  });

  const send = (method, params = {}, sessionId = undefined) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      // A command with no reply is a dead endpoint, not a slow one — the same
      // bound every wait in browser/session.mjs carries, for the same reason: a
      // silent stall is indistinguishable from work in progress.
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} did not answer within 15000ms`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const on = (method, handler) => {
    const list = listeners.get(method) ?? [];
    list.push(handler);
    listeners.set(method, list);
  };

  on('Target.attachedToTarget', (params) => {
    const { sessionId } = params;
    const info = params.targetInfo ?? {};
    attached.set(sessionId, {
      targetId: info.targetId ?? null,
      type: info.type ?? null,
      url: info.url ?? null,
    });
    // Arming auto-attach again on each attached session is what makes the walk
    // recursive; a target type that refuses either command is recorded by
    // absence, and an enable refusal decides `available` — a build without the
    // domain must look unavailable, not empty.
    send(
      'Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      sessionId
    ).catch(() => {});
    send('WebMCP.enable', {}, sessionId)
      .then(() => enableResults.set(sessionId, true))
      .catch((error) => enableResults.set(sessionId, String(error.message ?? error)));
  });

  on('WebMCP.toolsAdded', (params, sessionId) => {
    for (const tool of params.tools ?? []) {
      if (!tool?.name) continue;
      present.set(tool.name, tool);
      if (sessionId) toolSessions.add(sessionId);
    }
  });

  on('WebMCP.toolsRemoved', (params, sessionId) => {
    for (const tool of params.tools ?? []) {
      if (!tool?.name) continue;
      present.delete(tool.name);
      removed.push(tool.name);
      if (sessionId) toolSessions.add(sessionId);
    }
  });

  await send('Target.setDiscoverTargets', { discover: true });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

  const anySessionEnabled = () => {
    for (const succeeded of enableResults.values()) if (succeeded === true) return true;
    return false;
  };
  const lastRefusal = () => {
    let reason = null;
    for (const value of enableResults.values()) if (value !== true) reason = value;
    return reason;
  };

  return {
    get available() {
      return anySessionEnabled();
    },
    get reason() {
      if (attached.size === 0) return 'no target session attached to the browser endpoint';
      return anySessionEnabled() ? null : (lastRefusal() ?? 'no session enabled the WebMCP domain');
    },
    names: () => (anySessionEnabled() ? [...present.keys()] : null),
    tools: () => (anySessionEnabled() ? [...present.values()] : null),
    removedNames: () => (anySessionEnabled() ? [...removed] : null),
    get oopiFrames() {
      let count = 0;
      for (const target of attached.values()) if (target.type === 'iframe') count += 1;
      return count;
    },
    get sessionCount() {
      return attached.size;
    },
    get toolSessionCount() {
      return toolSessions.size;
    },
    stop: () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('watch stopped'));
      }
      pending.clear();
      listeners.clear();
      try {
        socket.close();
      } catch {
        // A socket that is already gone is the state we wanted.
      }
    },
  };
};

/**
 * Calls a tool through the page API, trying every signature this ecosystem is
 * known to use and reporting which one the build accepted - that is a
 * compatibility-matrix row, not an implementation detail.
 *
 * Measured on Chrome 152.0.7977.65 (2026-08-30): the accepted form is
 * `executeTool(registeredTool, args)`, where the first argument is the object
 * handed back by `getTools()`. Passing the draft's `{name, arguments}` fails with
 * "2 arguments required, but only 1 present", and passing the name as a string
 * fails with "The provided value is not of type 'RegisteredTool'". Neither the
 * draft (#246) nor the type surface verified against Chrome 151 describes this,
 * so the cascade stays until more builds are measured.
 */
export const executeTool = async (session, name, args = {}) => {
  const expression = `(async () => {
    const mc = document.modelContext ?? navigator.modelContext ?? null;
    if (!mc || typeof mc.executeTool !== 'function') {
      return { ok: false, callShape: null, error: 'executeTool is not available on this build' };
    }

    const name = ${JSON.stringify(name)};
    const args = ${JSON.stringify(args)};
    const attempts = [];

    const raw = mc.getTools();
    const tools = raw != null && typeof raw.then === 'function' ? await raw : raw;
    const registered = Array.isArray(tools) ? tools.find((tool) => tool && tool.name === name) : null;

    const shapes = [
      ['tool-object+object', () => registered && mc.executeTool(registered, args)],
      ['tool-object+string', () => registered && mc.executeTool(registered, JSON.stringify(args))],
      ['draft-object', () => mc.executeTool({ name, arguments: args })],
      ['name+string', () => mc.executeTool(name, JSON.stringify(args))],
    ];

    for (const [callShape, invoke] of shapes) {
      if (callShape.startsWith('tool-object') && !registered) {
        attempts.push({ callShape, error: 'tool not present in getTools()' });
        continue;
      }
      try {
        const result = await invoke();
        return { ok: true, callShape, result, attempts };
      } catch (error) {
        attempts.push({ callShape, error: String(error && error.message ? error.message : error) });
      }
    }

    return {
      ok: false,
      callShape: null,
      error: attempts.map((attempt) => attempt.callShape + ': ' + attempt.error).join(' | '),
      attempts,
    };
  })()`;

  return session.evaluate(expression);
};
