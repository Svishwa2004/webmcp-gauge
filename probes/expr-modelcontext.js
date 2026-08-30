(async () => {
  const read = () => document.modelContext ?? navigator.modelContext ?? null;

  const readTools = async (mc) => {
    if (typeof mc.getTools !== 'function') return null;
    const raw = mc.getTools();
    // getTools() resolves a Promise on Chrome 152; older surfaces returned an array.
    return raw != null && typeof raw.then === 'function' ? await raw : raw;
  };

  // Registration lands after the load event and arrives in batches, so a read is
  // only trustworthy once the tool set stops changing. Waiting for "non-empty"
  // reports a partial set as the whole one (observed: 3 and 4 of Airlock's 7).
  const deadline = Date.now() + 8000;
  const stableReadsRequired = 4;
  const intervalMs = 200;

  const t0 = Date.now();
  let mc = read();
  let tools = null;
  let lastKey = null;
  let stableReads = 0;
  let settledAtMs = null;

  while (Date.now() < deadline) {
    mc = read();
    if (mc) {
      tools = await readTools(mc);
      const key = Array.isArray(tools) ? JSON.stringify(tools.map((t) => t?.name ?? null)) : null;
      if (key !== null && key === lastKey) {
        stableReads += 1;
        if (Array.isArray(tools) && tools.length > 0 && stableReads >= stableReadsRequired) {
          settledAtMs = Date.now() - t0;
          break;
        }
      } else {
        stableReads = 0;
        lastKey = key;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
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
    inNavigator: 'modelContext' in navigator,
    surface: Object.getOwnPropertyNames(Object.getPrototypeOf(mc)),
    ownKeys: Object.getOwnPropertyNames(mc),
    frozen: Object.isFrozen(mc),
    settled: settledAtMs !== null,
    settledAtMs,
    count: Array.isArray(tools) ? tools.length : null,
    names: Array.isArray(tools) ? tools.map((t) => t.name) : null,
    userAgent: navigator.userAgent,
  };
})()
