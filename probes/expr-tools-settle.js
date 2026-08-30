(async () => {
  const mc = document.modelContext ?? null;
  if (!mc) return { present: false };

  const read = async () => {
    const raw = mc.getTools();
    const tools = raw != null && typeof raw.then === 'function' ? await raw : raw;
    return Array.isArray(tools) ? tools.map((t) => t?.name ?? null) : null;
  };

  // Registration can arrive in batches after load, so record a time series
  // instead of stopping at the first non-empty read.
  const t0 = Date.now();
  const series = [];
  let lastKey = '';

  while (Date.now() - t0 < 10000) {
    const names = await read();
    const key = JSON.stringify(names);
    if (key !== lastKey) {
      series.push({ atMs: Date.now() - t0, count: names ? names.length : null, names });
      lastKey = key;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const final = await read();
  return { present: true, changes: series, finalCount: final ? final.length : null, finalNames: final };
})()
