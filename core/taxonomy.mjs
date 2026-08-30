/**
 * The outcome taxonomy, and the argument checks that decide between its buckets.
 *
 * The taxonomy is the product: a pass/fail number tells a developer nothing,
 * while `not_selected` vs `bad_args` vs `not_registered` tells them which line to
 * edit. Every trial lands in exactly one bucket, so these functions return one
 * outcome and never a set.
 */

export const OUTCOMES = Object.freeze([
  'not_supported', // the client has no WebMCP surface at all
  'not_registered', // the page registered nothing, or not this tool
  'not_discovered', // the page has it, the browser never surfaced it
  'not_selected', // the judge chose no tool
  'wrong_tool', // the judge chose a different tool
  'bad_args', // right tool, arguments that do not satisfy the request
  'exec_error', // the call threw
  'silent_fail', // the call returned and nothing observably happened
  'ok',
]);

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sameScalar = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();
  return a === b;
};

const constraintHolds = (value, constraint) =>
  Object.entries(constraint).every(([operator, bound]) => {
    if (typeof value !== 'number') return false;
    if (operator === 'gt') return value > bound;
    if (operator === 'gte') return value >= bound;
    if (operator === 'lt') return value < bound;
    if (operator === 'lte') return value <= bound;
    return false;
  });

/**
 * Checks the judge's arguments against one utterance's expectations and the
 * tool's own schema. Returns every violation rather than the first, because the
 * reason is what a developer acts on; the caller collapses them to `bad_args`.
 */
export const checkArguments = ({ args, expectation = {}, inputSchema }) => {
  const violations = [];
  const supplied = isPlainObject(args) ? args : {};

  if (args !== undefined && args !== null && !isPlainObject(args)) {
    violations.push({ kind: 'not_an_object', detail: typeof args });
  }

  const schemaKeys = isPlainObject(inputSchema?.properties)
    ? Object.keys(inputSchema.properties)
    : null;
  if (schemaKeys) {
    for (const key of Object.keys(supplied)) {
      if (!schemaKeys.includes(key)) violations.push({ kind: 'unknown_key', key });
    }
  }

  for (const [key, expected] of Object.entries(expectation.expectedArgs ?? {})) {
    if (!(key in supplied)) {
      violations.push({ kind: 'missing_expected_key', key, expected });
      continue;
    }
    if (!sameScalar(supplied[key], expected)) {
      violations.push({ kind: 'wrong_value', key, expected, actual: supplied[key] });
    }
  }

  for (const key of expectation.requiredArgKeys ?? []) {
    if (!(key in supplied)) violations.push({ kind: 'missing_required_key', key });
  }

  for (const [key, constraint] of Object.entries(expectation.argConstraints ?? {})) {
    if (!(key in supplied)) continue; // already reported by requiredArgKeys
    if (!constraintHolds(supplied[key], constraint)) {
      violations.push({ kind: 'constraint_violated', key, constraint, actual: supplied[key] });
    }
  }

  for (const key of expectation.forbiddenArgKeys ?? []) {
    if (key in supplied) violations.push({ kind: 'forbidden_key', key, actual: supplied[key] });
  }

  return { valid: violations.length === 0, violations };
};

/**
 * Everything decidable before the tool is called. Returns null when the trial
 * should proceed to execution.
 *
 * `browserToolNames` is optional: without the browser's own view there is no way
 * to separate "the page never registered it" from "the browser never surfaced
 * it", and guessing between them would invent a diagnosis.
 */
export const classifyBeforeExecution = ({
  manifest,
  expectedTool,
  selection,
  expectation,
  browserToolNames = null,
}) => {
  if (!manifest?.present) {
    return { outcome: 'not_supported', reason: 'no modelContext on this client' };
  }

  const pageToolNames = (manifest.tools ?? []).map((tool) => tool.name);

  if (pageToolNames.length === 0) {
    return { outcome: 'not_registered', reason: 'page registered no tools' };
  }

  if (!pageToolNames.includes(expectedTool)) {
    return {
      outcome: 'not_registered',
      reason: `page registered ${pageToolNames.length} tools, none named ${expectedTool}`,
    };
  }

  if (browserToolNames && !browserToolNames.includes(expectedTool)) {
    return {
      outcome: 'not_discovered',
      reason: `page registered ${expectedTool} but the browser never surfaced it`,
    };
  }

  if (!selection?.tool) {
    return { outcome: 'not_selected', reason: 'judge chose no tool' };
  }

  if (selection.tool !== expectedTool) {
    return { outcome: 'wrong_tool', reason: `judge chose ${selection.tool}` };
  }

  const schema = manifest.tools.find((tool) => tool.name === expectedTool)?.inputSchema;
  const argCheck = checkArguments({
    args: selection.arguments,
    expectation,
    inputSchema: schema,
  });

  if (!argCheck.valid) {
    return { outcome: 'bad_args', reason: 'arguments rejected', violations: argCheck.violations };
  }

  return null;
};

/**
 * Everything decidable after the call. `silent_fail` needs care: a read-only tool
 * legitimately changes no DOM, so an empty payload AND an unchanged page is the
 * only honest signal that nothing happened.
 */
export const classifyAfterExecution = ({ execution, before, after }) => {
  if (!execution?.ok) {
    return { outcome: 'exec_error', reason: execution?.error ?? 'call failed' };
  }

  const result = execution.result;
  const emptyResult =
    result === null ||
    result === undefined ||
    (isPlainObject(result) && Object.keys(result).length === 0) ||
    (typeof result === 'string' && result.trim() === '');
  const pageChanged = JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);

  if (emptyResult && !pageChanged) {
    return { outcome: 'silent_fail', reason: 'empty result and no observable page change' };
  }

  return { outcome: 'ok', reason: pageChanged ? 'result returned, page changed' : 'result returned' };
};
