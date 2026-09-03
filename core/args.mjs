/**
 * One option parser for the whole repository, because two were one too many.
 *
 * Until 2026-09-03 `bin/` and `probes/` accepted **opposite** syntaxes and neither
 * complained about the other's:
 *
 *   - `bin/webmcp-gauge.mjs` read `--name value` and turned `--fail-under=0.9`
 *     into a *switch* named `fail-under=0.9`, so `flags['fail-under']` was
 *     undefined and the build was **not gated at all**. Latent rather than live —
 *     every documented example and `action.yml` use the space form — but a CI job
 *     written the other way would have passed silently forever.
 *   - the probes read `--name=value` and ignored `--serve fixtures/gallery`
 *     entirely, which walked the *live* gallery while claiming to walk a fixture.
 *
 * Same defect twice, in opposite directions: an option that does not arrive leaves
 * a default in place and says nothing. So both forms are accepted everywhere now,
 * and the three ways of getting it wrong are refused instead of absorbed:
 *
 *   1. an unknown option           — a typo silently kept the default before
 *   2. a value option with no value
 *   3. a value handed to a switch
 *
 * Returns `{ options, positional, error }` and never throws: each caller owns its
 * own exit code, and in this repo those codes carry meaning (`core/gate.mjs`).
 *
 * One older lesson is kept from the CLI's own parser, which this replaces: argv
 * must be walked once, in order. Collecting positionals by filtering on "does not
 * start with `--`" looks equivalent and is not — it swallowed the judge model and
 * the port as positionals, and the first of them became the subject url.
 */

/**
 * @param {string[]} argv
 * @param {{ values?: string[], switches?: string[], maxPositional?: number }} spec
 */
export const parseOptions = (argv, { values = [], switches = [], maxPositional = 0 } = {}) => {
  const list = Array.isArray(argv) ? argv.map((entry) => String(entry)) : [];
  const valueNames = new Set(values);
  const switchNames = new Set(switches);

  const options = {};
  const positional = [];
  const fail = (error) => ({ options, positional, error });

  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];

    if (!token.startsWith('--')) {
      positional.push(token);
      if (positional.length > maxPositional) {
        const previous = index > 0 ? list[index - 1] : null;
        // The most common way to land here is the syntax that used to be ignored,
        // so name the fix rather than only the symptom.
        const hint =
          previous && previous.startsWith('--') && !previous.includes('=')
            ? ` — if it is the value for ${previous}, both ${previous}=${token} and ${previous} ${token} are accepted, but ${previous} takes no value`
            : '';
        return fail(`unexpected argument '${token}'${hint}`);
      }
      continue;
    }

    const equals = token.indexOf('=');
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    const inlineValue = equals === -1 ? null : token.slice(equals + 1);

    if (!valueNames.has(name) && !switchNames.has(name)) {
      return fail(`unknown option '--${name}'. Known options: ${[...valueNames, ...switchNames].sort().map((known) => `--${known}`).join(', ')}`);
    }

    if (switchNames.has(name)) {
      if (inlineValue !== null) return fail(`--${name} is a switch and takes no value, got '--${name}=${inlineValue}'`);
      options[name] = true;
      continue;
    }

    if (inlineValue !== null) {
      options[name] = inlineValue;
      continue;
    }

    const next = list[index + 1];
    // A following `--something` is the next option, not this one's value: the
    // alternative swallows options and produces a plausible wrong run.
    if (next === undefined || next.startsWith('--')) {
      return fail(`--${name} needs a value, e.g. --${name}=<value>`);
    }
    options[name] = next;
    index += 1;
  }

  return { options, positional, error: null };
};
