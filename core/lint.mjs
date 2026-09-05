/**
 * L0 - the static linter. No browser needed to reason, no model, no API key.
 *
 * It reads one thing: the manifest a page exposes (names, descriptions, input
 * schemas, annotations). Everything it reports is a property of that manifest, so
 * the same function lints a live page's `getTools()` and a hand-written manifest in
 * a JSON file, and its answers are deterministic - which is the point. The harness
 * needs a judge, a browser and minutes; the linter needs a manifest and no
 * network, so it is the free on-ramp and the fast half of the same question.
 *
 * Thresholds are calibrated against the one page in this project with a measured
 * invocation rate. The reference page reads 100% [96.9%, 100.0%] on five tools and
 * 99.2% on the sixth over 960 trials, its longest schema has exactly six
 * properties, its thinnest description is 76 characters, and every property it
 * declares carries a description. Defaults are therefore set so that page lints
 * clean: a default that flags a manifest known to work is a broken default, not a
 * strict one. Every threshold is an option, because they are heuristics with a
 * measurement behind them rather than constants from a spec.
 *
 * What it deliberately does not do: guess. It never rewrites a description, never
 * scores "quality" on a scale, and never claims a flagged manifest will invoke
 * badly - that claim belongs to the harness, which measures it.
 */

export const DEFAULT_OPTIONS = Object.freeze({
  /** Below this, a description is too thin to separate a tool from its neighbour. */
  minDescriptionChars: 60,
  /** The reference page's largest schema has six properties and invokes at 99.2%. */
  maxProperties: 6,
  /**
   * There is no published per-page tool budget. The only field figure is a report of
   * 296 registered tools silently disabling WebMCP for an entire page — and that
   * figure **does not reproduce on Chrome 152.0.7977.65**: measured 2026-08-31, a
   * page registering 507 tools had all 507 accepted, listed by `getTools()` and
   * surfaced by the browser's own WebMCP domain. So this rule warns rather than
   * asserts, and both levels are warnings: an error on something measured to work
   * would be the false positive the calibration principle above exists to prevent.
   */
  budgetWarnAt: 64,
  budgetBreakAt: 296,
  /** Token-set overlap above which two descriptions are hard to tell apart. */
  nearDuplicateThreshold: 0.7,
  /**
   * Token-set overlap above which two tool *names* are close enough that a model
   * with no useful description to go on may pick between them on the name.
   * `sum_by_category` against `summarise_by_category` scores 0.500.
   */
  nameSimilarityThreshold: 0.4,
});

/**
 * Names that survive registration are not the same set as names that are safe.
 * Measured on Chrome 152.0.7977.65 (2026-08-30): `registerTool` throws
 * "Invalid tool name" for a name containing a space - so spec issue #145's
 * "silently does nothing" is not what this build does - while a dotted name like
 * `top.expenses.v2` is accepted and appears in getTools(). A live manifest
 * therefore cannot show the worst names at all; they show up as a tool that is
 * missing, which the harness scores as not_registered. This rule earns its keep on
 * the names a build does accept, and on static manifests read from source.
 */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const MAX_NAME_CHARS = 64;

export const RULES = Object.freeze([
  { id: 'name/invalid-characters', family: 'names', severity: 'error' },
  { id: 'name/too-long', family: 'names', severity: 'warning' },
  { id: 'name/duplicate', family: 'names', severity: 'error' },
  { id: 'description/missing', family: 'descriptions', severity: 'error' },
  { id: 'description/thin', family: 'descriptions', severity: 'warning' },
  { id: 'description/duplicate', family: 'descriptions', severity: 'error' },
  { id: 'description/near-duplicate', family: 'descriptions', severity: 'warning' },
  /**
   * Adopted 2026-09-05 on measurement, and it is the only rule here aimed at a
   * mechanism rather than at a property of the text.
   *
   * Five arms took `sum_by_category` from 95.0% to between 48.3% and 58.3% while the
   * overlap between its description and its competitor's fell from 1.000 to 0.130 —
   * so *similarity* is not what does the damage, and no threshold on
   * `nearDuplicateThreshold` can catch it (`reports/ladder-2026-09-05.md`). What the
   * judge actually did, in its own recorded words, was pick on the **name**:
   * "summarise_by_category seems designed for summarizing by category". It does that
   * when neither description tells it which tool is which.
   *
   * So this rule asks the two questions that mechanism needs, both model-free:
   * are the names close, and does *neither* description say what its own tool is
   * for. The second half is absolute rather than relative on purpose — the failed
   * option was the relative one.
   *
   * **Warning, not error**, and the reason is this project's own precedent:
   * `budget/headroom` was demoted because a linter that fails a build on a
   * threshold nobody has reproduced is a linter people disable. This rule
   * reproduces every arm across 13 manifests (`probes/name-proxy-rule.mjs`), but all
   * 13 were written here. Its false-positive rate on manifests this project did not
   * write is unmeasured, and the cohort capture is the corpus that would settle it.
   * Promote to error when that measurement exists.
   */
  { id: 'description/indistinguishable-pair', family: 'descriptions', severity: 'warning' },
  { id: 'schema/not-object', family: 'schemas', severity: 'error' },
  { id: 'schema/required-without-description', family: 'schemas', severity: 'error' },
  { id: 'schema/over-parameterised', family: 'schemas', severity: 'warning' },
  { id: 'schema/undocumented-property', family: 'schemas', severity: 'warning' },
  { id: 'schema/missing-type', family: 'schemas', severity: 'warning' },
  { id: 'budget/headroom', family: 'budget', severity: 'warning' },
]);

const severityOf = (ruleId) => RULES.find((rule) => rule.id === ruleId)?.severity ?? 'warning';

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normaliseDescription = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const tokenise = (text) =>
  new Set(
    normaliseDescription(text)
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 0)
  );

/** Token-set Jaccard: shared vocabulary over total vocabulary, symmetric and cheap. */
export const similarity = (a, b) => {
  const left = tokenise(a);
  const right = tokenise(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
};

/**
 * Does this description say which tool it belongs to? Answered without a model, by
 * asking whether it mentions the substantial tokens of its own name — plus any short
 * token that distinguishes it from the sibling it is being compared against, since
 * `sum` against `summarise` is exactly the distinction that matters and `by` is not.
 */
const describesItsOwnName = (name, description, distinguishing = []) => {
  const said = tokenise(description);
  const wanted = [...tokenise(name)].filter((token) => token.length > 2).concat(distinguishing);
  return wanted.some((token) => said.has(token));
};

export const lintManifest = ({ manifest, options = {} }) => {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const tools = Array.isArray(manifest?.tools) ? manifest.tools : [];
  const findings = [];

  const add = (rule, tool, detail, evidence = null) =>
    findings.push({ rule, severity: severityOf(rule), tool, detail, evidence });

  const seenNames = new Map();
  const descriptions = [];

  for (const tool of tools) {
    const name = typeof tool?.name === 'string' ? tool.name : '';

    if (!SAFE_NAME.test(name)) {
      const offenders = [...name].filter((character) => !/[A-Za-z0-9_-]/.test(character));
      add(
        'name/invalid-characters',
        name || '(unnamed)',
        offenders.length > 0
          ? `contains ${offenders.map((character) => (character === ' ' ? 'a space' : `'${character}'`)).join(', ')}; a client may refuse to register it or a model may fail to reference it`
          : 'does not start with a letter, digit or underscore',
        { name }
      );
    }
    if (name.length > MAX_NAME_CHARS) {
      add('name/too-long', name, `${name.length} characters; keep names under ${MAX_NAME_CHARS}`);
    }
    if (seenNames.has(name)) {
      add('name/duplicate', name, 'two tools share this name, so only one of them is reachable');
    }
    seenNames.set(name, true);

    const description = typeof tool?.description === 'string' ? tool.description : '';
    const trimmed = description.trim();
    if (trimmed.length === 0) {
      add(
        'description/missing',
        name,
        'no description at all: selection is the model reading this text, so an empty one is an unreachable tool'
      );
    } else {
      if (trimmed.length < settings.minDescriptionChars) {
        add(
          'description/thin',
          name,
          `${trimmed.length} characters, below the ${settings.minDescriptionChars}-character floor calibrated on the reference page`,
          { description: trimmed }
        );
      }
      descriptions.push({ name, description: trimmed, key: normaliseDescription(trimmed) });
    }

    const schema = tool?.inputSchema;
    if (!isPlainObject(schema) || schema.type !== 'object' || (schema.properties !== undefined && !isPlainObject(schema.properties))) {
      add(
        'schema/not-object',
        name,
        `inputSchema must be an object schema with an object 'properties' map; got ${isPlainObject(schema) ? `type '${schema.type}'` : typeof schema}`,
        { inputSchema: schema ?? null }
      );
      continue;
    }

    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const propertyNames = Object.keys(properties);
    const required = Array.isArray(schema.required) ? schema.required : [];

    if (propertyNames.length > settings.maxProperties) {
      add(
        'schema/over-parameterised',
        name,
        `${propertyNames.length} properties against a ${settings.maxProperties}-property reference maximum; every extra argument is one more thing a model has to invent`
      );
    }

    for (const [property, definition] of Object.entries(properties)) {
      const documented =
        isPlainObject(definition) && typeof definition.description === 'string' && definition.description.trim().length > 0;
      const typed = isPlainObject(definition) && typeof definition.type === 'string' && definition.type.length > 0;

      if (required.includes(property) && !documented) {
        add(
          'schema/required-without-description',
          name,
          `'${property}' is required and undocumented, so a model must guess a value it cannot derive from the request`
        );
      } else if (!documented) {
        add('schema/undocumented-property', name, `'${property}' has no description`);
      }
      if (!typed) add('schema/missing-type', name, `'${property}' declares no type`);
    }

    for (const property of required) {
      if (!propertyNames.includes(property)) {
        add(
          'schema/required-without-description',
          name,
          `'${property}' is listed in required but is not declared in properties`
        );
      }
    }
  }

  for (let i = 0; i < descriptions.length; i += 1) {
    for (let j = i + 1; j < descriptions.length; j += 1) {
      const left = descriptions[i];
      const right = descriptions[j];
      if (left.key === right.key) {
        add(
          'description/duplicate',
          `${left.name} + ${right.name}`,
          'identical descriptions: nothing in the manifest can tell these two tools apart',
          { description: left.description }
        );
        continue;
      }
      const overlap = similarity(left.description, right.description);
      if (overlap >= settings.nearDuplicateThreshold) {
        add(
          'description/near-duplicate',
          `${left.name} + ${right.name}`,
          `descriptions share ${(overlap * 100).toFixed(0)}% of their vocabulary, at or above the ${(settings.nearDuplicateThreshold * 100).toFixed(0)}% threshold`,
          { left: left.description, right: right.description }
        );
      }
    }
  }

  // Close names plus two descriptions that never say which tool is which. Measured
  // as the mechanism behind a 45-point loss that no similarity threshold catches;
  // see the rule's entry in RULES for why it is a warning rather than an error.
  for (let i = 0; i < descriptions.length; i += 1) {
    for (let j = i + 1; j < descriptions.length; j += 1) {
      const left = descriptions[i];
      const right = descriptions[j];
      const nameOverlap = similarity(left.name, right.name);
      if (nameOverlap < settings.nameSimilarityThreshold) continue;

      const leftTokens = tokenise(left.name);
      const rightTokens = tokenise(right.name);
      const leftOnly = [...leftTokens].filter((token) => !rightTokens.has(token));
      const rightOnly = [...rightTokens].filter((token) => !leftTokens.has(token));

      if (describesItsOwnName(left.name, left.description, leftOnly)) continue;
      if (describesItsOwnName(right.name, right.description, rightOnly)) continue;

      add(
        'description/indistinguishable-pair',
        `${left.name} + ${right.name}`,
        `names share ${(nameOverlap * 100).toFixed(0)}% of their tokens and neither description says which tool it is, so a model with nothing to choose on will choose on the name`,
        { nameSimilarity: Number(nameOverlap.toFixed(3)), left: left.description, right: right.description }
      );
    }
  }

  if (tools.length >= settings.budgetBreakAt) {
    add(
      'budget/headroom',
      null,
      `${tools.length} tools, at or past the ${settings.budgetBreakAt} reported to disable WebMCP for a whole page with no error. That report does not reproduce on Chrome 152.0.7977.65, where 507 tools were all registered and surfaced — so this is a warning about an unknown, not a verified ceiling`,
      { toolCount: tools.length }
    );
  } else if (tools.length >= settings.budgetWarnAt) {
    add(
      'budget/headroom',
      null,
      `${tools.length} tools; no per-page budget is published, and ${settings.budgetBreakAt} has been reported to disable the feature silently, so headroom here is unknown rather than fine`,
      { toolCount: tools.length }
    );
  }

  const counts = findings.reduce(
    (totals, finding) => ({ ...totals, [finding.severity]: (totals[finding.severity] ?? 0) + 1 }),
    { error: 0, warning: 0 }
  );

  return {
    schema: 'webmcp-gauge/lint/1',
    generatedAt: new Date().toISOString(),
    thresholds: settings,
    manifest: {
      present: manifest?.present ?? null,
      settled: manifest?.settled ?? null,
      settledAtMs: manifest?.settledAtMs ?? null,
      toolCount: tools.length,
      names: tools.map((tool) => tool?.name ?? null),
    },
    findings,
    counts,
    families: [...new Set(findings.map((finding) => finding.rule.split('/')[0]))],
  };
};

export const lintToText = (result, { subject = null } = {}) => {
  const lines = [];
  const { manifest, counts, findings } = result;

  lines.push(`webmcp-gauge lint — ${subject ?? '(manifest)'}`);
  lines.push(
    `${manifest.toolCount} tools · ${counts.error} error${counts.error === 1 ? '' : 's'} · ${counts.warning} warning${counts.warning === 1 ? '' : 's'}${manifest.settled === false ? ' · MANIFEST NEVER SETTLED' : ''}`
  );
  lines.push('');

  if (findings.length === 0) {
    lines.push('No findings. Every rule in this build passed against this manifest.');
    lines.push('');
    lines.push(
      'A clean lint is not a measured invocation rate: L0 reads the manifest, and whether an agent picks these tools is what `run` measures.'
    );
    return `${lines.join('\n')}\n`;
  }

  const order = { error: 0, warning: 1 };
  for (const finding of [...findings].sort(
    (a, b) => order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule)
  )) {
    lines.push(
      `${finding.severity === 'error' ? 'ERROR  ' : 'WARN   '} ${finding.rule}${finding.tool ? ` · ${finding.tool}` : ''}`
    );
    lines.push(`         ${finding.detail}`);
  }
  lines.push('');
  lines.push(
    'Thresholds: ' +
      `descriptions ≥ ${result.thresholds.minDescriptionChars} chars, ≤ ${result.thresholds.maxProperties} schema properties, ` +
      `near-duplicate at ${(result.thresholds.nearDuplicateThreshold * 100).toFixed(0)}% vocabulary overlap, budget warning at ${result.thresholds.budgetWarnAt} tools. ` +
      'Calibrated on the reference page, not taken from the spec.'
  );

  return `${lines.join('\n')}\n`;
};
