/**
 * Composes a manifest variant for the fixture twin.
 *
 * An ablation is the clean manifest plus exactly one defect family, and the whole
 * point is that nothing else moves. Writing each ablation out in full would make
 * that a promise enforced by a test; composing it from the clean variant plus a
 * patch makes accidental divergence impossible instead, which is the stronger of
 * the two. One implementation, imported by the page in the browser and by the
 * tests in Node, so the manifest the page registers is the manifest the tests lint.
 */

export const composeVariant = (toolsFile, name) => {
  const declared = toolsFile?.variants?.[name];
  if (Array.isArray(declared)) return declared;

  const ablation = toolsFile?.ablations?.[name];
  if (!ablation || !Array.isArray(ablation.tools)) return null;

  const base = toolsFile?.variants?.[ablation.basedOn ?? 'clean'];
  if (!Array.isArray(base)) return null;

  const patched = base.map(
    (tool) => ablation.tools.find((candidate) => candidate.name === tool.name) ?? tool
  );
  const added = ablation.tools.filter(
    (candidate) => !base.some((tool) => tool.name === candidate.name)
  );

  return [...patched, ...added];
};

export const variantNames = (toolsFile) => [
  ...Object.keys(toolsFile?.variants ?? {}),
  ...Object.keys(toolsFile?.ablations ?? {}).filter(
    (key) => Array.isArray(toolsFile.ablations[key]?.tools)
  ),
];

/** What a composed variant actually changed against its base, for the tests to check. */
export const diffVariant = (base, composed) => {
  const key = (tool) => JSON.stringify([tool.description, tool.inputSchema, tool.throwWhenMissing ?? null]);
  const baseByName = new Map(base.map((tool) => [tool.name, tool]));
  const composedByName = new Map(composed.map((tool) => [tool.name, tool]));

  return {
    changed: [...composedByName.keys()].filter(
      (name) => baseByName.has(name) && key(baseByName.get(name)) !== key(composedByName.get(name))
    ),
    added: [...composedByName.keys()].filter((name) => !baseByName.has(name)),
    removed: [...baseByName.keys()].filter((name) => !composedByName.has(name)),
  };
};
