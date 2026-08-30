(async () => {
  const read = () => document.modelContext ?? navigator.modelContext ?? null;

  // Tools commonly register after the load event, so a single read cannot
  // distinguish "not registered" from "not registered yet" (getting-started §1.3).
  const deadline = Date.now() + 3000;
  let mc = read();
  let tools = null;

  while (Date.now() < deadline) {
    mc = read();
    if (mc && typeof mc.getTools === 'function') {
      tools = mc.getTools();
      if (Array.isArray(tools) && tools.length > 0) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!mc) {
    return {
      present: false,
      hasDocument: 'modelContext' in document,
      hasNavigator: 'modelContext' in navigator,
      userAgent: navigator.userAgent,
    };
  }

  return {
    present: true,
    aliasIsSameObject: document.modelContext === navigator.modelContext,
    surface: Object.getOwnPropertyNames(Object.getPrototypeOf(mc)),
    ownKeys: Object.getOwnPropertyNames(mc),
    frozen: Object.isFrozen(mc),
    count: Array.isArray(tools) ? tools.length : null,
    names: Array.isArray(tools) ? tools.map((t) => t.name) : null,
    userAgent: navigator.userAgent,
  };
})()
