/**
 * Judge adapter for Anthropic-messages endpoints (POST {base}/v1/messages).
 *
 * Same judge-level contract as judges/openai-compatible.mjs — { id, baseUrl,
 * keySource, complete({system, user, maxTokens}) } — differing only in the wire
 * shape, so the sweep and trial paths cannot tell the two apart and every
 * report keeps stamping the same judge fields. Chosen explicitly with
 * --judge-shape anthropic, because the shape is a property of the endpoint and
 * guessing it from the hostname would be one more silent default. Just Work
 * (api.justwoker.icu) serves claude models over this protocol and refuses the
 * OpenAI shape outright. No retrying and no repair, same rule as the OpenAI
 * adapter: a judge that cannot follow the response contract is a measurement
 * result, not an error to paper over.
 */
import { resolveApiKey } from './openai-compatible.mjs';

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Reasoning budgets sit higher than a tool-choice answer needs, and Anthropic
 * charges for thinking tokens the same way — the ceiling exists so truncation
 * is unlikely, and `truncated` says so when it happens anyway.
 */
const DEFAULT_MAX_TOKENS = 4096;

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
  const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/messages`;

  return {
    id: model,
    baseUrl,
    keySource: source,

    async complete({ system, user, maxTokens = DEFAULT_MAX_TOKENS }) {
      const body = {
        model,
        temperature,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: user }],
      };

      const startedAt = Date.now();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          Authorization: `Bearer ${key}`,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const text = await response.text();
      const elapsedMs = Date.now() - startedAt;

      if (!response.ok) {
        // The body carries the useful part - a quota rejection reads very
        // differently from a malformed request - so it is surfaced, not swallowed.
        throw new Error(`judge HTTP ${response.status}: ${text.slice(0, 500)}`);
      }

      const payload = JSON.parse(text);
      const content = (payload.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
      const finishReason = payload.stop_reason ?? null;

      return {
        content,
        raw: text,
        model: payload.model ?? model,
        finishReason,
        truncated: finishReason === 'max_tokens',
        // Normalised to the OpenAI field names so a report never carries two
        // usage shapes depending on which adapter served the trials.
        usage: payload.usage
          ? { prompt_tokens: payload.usage.input_tokens, completion_tokens: payload.usage.output_tokens }
          : null,
        elapsedMs,
      };
    },
  };
};
