(async () => {
  const doc = document.modelContext ?? null;
  const nav = navigator.modelContext ?? null;

  const describe = (v) => ({
    type: typeof v,
    ctor: v == null ? null : v.constructor?.name ?? null,
    isArray: Array.isArray(v),
    thenable: v != null && typeof v.then === 'function',
    keys: v == null || typeof v !== 'object' ? null : Object.keys(v).slice(0, 20),
  });

  const out = {
    document: { present: doc != null, ...(doc ? { surface: Object.getOwnPropertyNames(Object.getPrototypeOf(doc)) } : {}) },
    navigator: {
      inNavigator: 'modelContext' in navigator,
      present: nav != null,
      sameAsDocument: doc != null && doc === nav,
    },
  };

  if (!doc) return out;

  let raw;
  try {
    raw = doc.getTools();
  } catch (error) {
    out.getTools = { threw: String(error) };
    return out;
  }

  out.getTools = { returned: describe(raw) };

  let tools = raw;
  if (raw != null && typeof raw.then === 'function') {
    try {
      tools = await raw;
      out.getTools.awaited = describe(tools);
    } catch (error) {
      out.getTools.awaitRejected = String(error);
      return out;
    }
  }

  // Registration can land after load, so re-read on a deadline before concluding a count.
  const deadline = Date.now() + 5000;
  while ((!Array.isArray(tools) || tools.length === 0) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const next = doc.getTools();
    tools = next != null && typeof next.then === 'function' ? await next : next;
  }

  out.tools = {
    count: Array.isArray(tools) ? tools.length : null,
    names: Array.isArray(tools) ? tools.map((t) => t?.name ?? null) : null,
    firstToolKeys: Array.isArray(tools) && tools[0] ? Object.keys(tools[0]) : null,
  };

  return out;
})()
