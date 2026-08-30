/**
 * Confirms a judge endpoint answers before a sweep depends on it.
 *
 * Presence in a provider's model list proves nothing about quota or entitlement,
 * so this sends a real chat completion and prints the reply plus usage.
 *
 * Usage: node probes/judge-ping.mjs [model] [baseUrl]
 */
import { createJudge } from '../judges/openai-compatible.mjs';

const [modelArg, baseUrlArg] = process.argv.slice(2);
const model = modelArg ?? process.env.WEBMCP_GAUGE_JUDGE_MODEL ?? 'glm-5.3';
const baseUrl = baseUrlArg ?? process.env.WEBMCP_GAUGE_JUDGE_BASE_URL ?? 'https://agentrouter.org/v1';

const judge = createJudge({ baseUrl, model });

try {
  const answer = await judge.complete({
    user: 'Reply with the single word READY and nothing else.',
    maxTokens: 32,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        requested: model,
        reported: answer.model,
        baseUrl,
        keySource: judge.keySource,
        content: answer.content,
        finishReason: answer.finishReason,
        usage: answer.usage,
        elapsedMs: answer.elapsedMs,
      },
      null,
      2
    )
  );
} catch (error) {
  console.log(JSON.stringify({ ok: false, requested: model, baseUrl, error: String(error.message ?? error) }, null, 2));
  process.exitCode = 1;
}
