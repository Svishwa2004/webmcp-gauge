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
