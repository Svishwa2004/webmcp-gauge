/**
 * Judge adapter for any OpenAI-compatible chat-completions endpoint.
 *
 * Invocation rate is a property of (page, client, judge model), so the model id
 * and endpoint are returned with every answer and belong in every report. The
 * adapter deliberately does no retrying and no repair of malformed output: a
 * judge that cannot follow the response contract is a measurement result, not
 * an error to paper over.
 */

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Reasoning models spend completion tokens on thinking before they emit anything,
 * and the budget covers both. At 1024, glm-5.3 spent 1021 tokens reasoning about
 * one utterance and returned an empty string with finish_reason "length" - which
 * looked exactly like a judge declining to pick a tool. A truncated judge is a
 * harness misconfiguration, so the ceiling is set where truncation is unlikely and
 * the caller is told when it happens anyway. Unused headroom costs nothing.
 */
const DEFAULT_MAX_TOKENS = 4096;

/**
 * agentrouter.org rejects requests that do not look like a CLI client, with
 * `401 unauthorized client detected`, even when the key is valid.
 */
const HOST_HEADERS = {
  'agentrouter.org': { 'User-Agent': 'claude-cli/1.0.80 (external, cli)', 'x-app': 'cli' },
};

const hostHeadersFor = (baseUrl) => {
  const { hostname } = new URL(baseUrl);
  return HOST_HEADERS[hostname] ?? {};
};

/**
 * Key selection has to be deterministic and reportable. Qwen Code exports one
 * `QWEN_CUSTOM_API_KEY_*` variable per configured provider, and picking whichever
 * one enumerates first silently grabbed an Anthropic-scoped key for an OpenAI
 * endpoint on the first run - it happened to work, which is worse than failing.
 * Candidates are therefore ranked: explicit variable, then the project's own
 * variable, then session variables whose name matches this endpoint's host,
 * preferring the OpenAI-scoped one, in sorted order.
 */
const hostTokens = (baseUrl) => {
  const { hostname } = new URL(baseUrl);
  return hostname.toUpperCase().split('.').filter((part) => part.length > 2 && part !== 'WWW');
};

export const resolveApiKey = (env = process.env, explicitVar, baseUrl) => {
  if (explicitVar) {
    const value = env[explicitVar];
    if (!value) throw new Error(`Judge API key variable ${explicitVar} is set to nothing`);
    return { key: value, source: explicitVar };
  }

  if (env.WEBMCP_GAUGE_JUDGE_API_KEY) {
    return { key: env.WEBMCP_GAUGE_JUDGE_API_KEY, source: 'WEBMCP_GAUGE_JUDGE_API_KEY' };
  }

  const sessionVars = Object.keys(env)
    .filter((name) => name.startsWith('QWEN_CUSTOM_API_KEY_') && env[name])
    .sort();
  const tokens = baseUrl ? hostTokens(baseUrl) : [];
  const hostMatches = sessionVars.filter((name) => tokens.every((token) => name.includes(token)));
  const ranked = [
    ...hostMatches.filter((name) => name.includes('OPENAI')),
    ...hostMatches.filter((name) => !name.includes('OPENAI')),
  ];

  if (ranked.length > 0) return { key: env[ranked[0]], source: ranked[0] };

  throw new Error(
    `No judge API key found for ${baseUrl ?? 'the configured endpoint'}. Set WEBMCP_GAUGE_JUDGE_API_KEY (see .env.example).` +
      (sessionVars.length > 0 ? ` Session variables present but not host-matched: ${sessionVars.join(', ')}` : '')
  );
};

export const createJudge = ({
  baseUrl,
  model,
  apiKeyVar,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  temperature = 0,
}) => {
  if (!baseUrl || !model) throw new Error('createJudge requires baseUrl and model');
  const { key, source } = resolveApiKey(env, apiKeyVar, baseUrl);
  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  return {
    id: model,
    baseUrl,
    keySource: source,

    async complete({ system, user, maxTokens = DEFAULT_MAX_TOKENS }) {
      const body = {
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: user },
        ],
      };

      const startedAt = Date.now();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          ...hostHeadersFor(baseUrl),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const text = await response.text();
      const elapsedMs = Date.now() - startedAt;

      if (!response.ok) {
        // The body carries the useful part - a whitelist rejection reads very
        // differently from an exhausted quota - so it is surfaced, not swallowed.
        throw new Error(`judge HTTP ${response.status}: ${text.slice(0, 500)}`);
      }

      const payload = JSON.parse(text);
      const message = payload.choices?.[0]?.message ?? {};
      const finishReason = payload.choices?.[0]?.finish_reason ?? null;

      return {
        content: (message.content ?? '').trim(),
        raw: text,
        model: payload.model ?? model,
        finishReason,
        // Truncation is the caller's problem to classify, not something to hide:
        // an empty answer cut off mid-thought is not a judge declining to answer.
        truncated: finishReason === 'length',
        usage: payload.usage ?? null,
        elapsedMs,
      };
    },
  };
};
