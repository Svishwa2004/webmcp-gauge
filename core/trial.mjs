/**
 * One trial: one utterance, one expected tool, one outcome.
 *
 * Fresh context per utterance is not a detail - conversational carry-over means
 * trial N contaminates trial N+1 - so the judge is called with a single message
 * pair and nothing else, and the tab is the caller's to discard afterwards.
 */
import { captureManifest, executeTool, observe } from '../browser/webmcp.mjs';
import { classifyAfterExecution, classifyBeforeExecution } from './taxonomy.mjs';

const SYSTEM_PROMPT = `You are the tool-using layer of a web browser. The page below exposes tools you may call.

Answer with a single JSON object and nothing else - no prose, no code fence:
{"tool": "<tool name or null>", "arguments": {<arguments object>}}

Rules:
- Choose the one tool that best serves the user's request, or null if none of them does.
- Pass only arguments that appear in the chosen tool's inputSchema, and only those the user's words justify.
- Never invent argument values the user did not imply.`;

const buildUserPrompt = ({ tools, utterance }) =>
  [
    'Tools available on this page:',
    JSON.stringify(
      tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      })),
      null,
      2
    ),
    '',
    'The user says:',
    utterance,
  ].join('\n');

/**
 * Parses the judge's reply without repairing it. A judge that cannot follow the
 * contract is a measurement, so a parse failure is reported as an unparseable
 * selection (which classifies as not_selected) rather than retried into shape.
 */
export const parseSelection = (content) => {
  const text = (content ?? '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();

  try {
    const parsed = JSON.parse(candidate);
    return {
      tool: typeof parsed.tool === 'string' && parsed.tool.length > 0 ? parsed.tool : null,
      arguments: parsed.arguments ?? {},
      parsed: true,
      usedFence: Boolean(fenced),
    };
  } catch (error) {
    return { tool: null, arguments: {}, parsed: false, parseError: String(error.message ?? error) };
  }
};

export const runTrial = async ({
  session,
  judge,
  url,
  toolName,
  utterance,
  expectation = {},
  setup = null,
  browserToolNames = null,
  fixtureVersion = null,
}) => {
  const startedAt = new Date().toISOString();

  await session.navigate(url);
  const manifest = await captureManifest(session);

  // Utterances like "clear that" have no referent on a clean page, so the fixture
  // declares the state they presuppose. The seed call is setup, never scored.
  let seed = null;
  if (setup?.seedCall && manifest.present) {
    const seedResult = await executeTool(session, setup.seedCall.tool, setup.seedCall.args ?? {});
    seed = { call: setup.seedCall, ok: seedResult.ok, error: seedResult.error ?? null };
  }

  const before = manifest.present ? await observe(session) : null;

  let selection = null;
  let judgeAnswer = null;
  let judgeError = null;

  if (manifest.present && (manifest.tools?.length ?? 0) > 0) {
    try {
      judgeAnswer = await judge.complete({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({ tools: manifest.tools, utterance: utterance.text }),
      });
      selection = parseSelection(judgeAnswer.content);
    } catch (error) {
      judgeError = String(error.message ?? error);
    }
  }

  const preVerdict = classifyBeforeExecution({
    manifest,
    expectedTool: toolName,
    selection,
    expectation,
    browserToolNames,
  });

  const record = {
    trial: {
      utteranceId: utterance.id,
      utterance: utterance.text,
      tag: utterance.tag ?? null,
      expectedTool: toolName,
      fixtureVersion,
      startedAt,
      url,
    },
    client: {
      cdpPort: session.port,
      modelContextPresent: Boolean(manifest.present),
      surface: manifest.surface ?? null,
      settled: manifest.settled ?? null,
      settledAtMs: manifest.settledAtMs ?? null,
      toolCount: manifest.tools?.length ?? 0,
    },
    judge: {
      model: judgeAnswer?.model ?? judge.id,
      requested: judge.id,
      baseUrl: judge.baseUrl,
      keySource: judge.keySource,
      elapsedMs: judgeAnswer?.elapsedMs ?? null,
      usage: judgeAnswer?.usage ?? null,
      finishReason: judgeAnswer?.finishReason ?? null,
      // The raw response travels with every trial: a number nobody can audit
      // back to what the model actually said is not evidence.
      rawResponse: judgeAnswer?.raw ?? null,
      error: judgeError,
    },
    selection,
    seed,
  };

  if (judgeError) {
    return { ...record, outcome: 'not_selected', reason: `judge call failed: ${judgeError}` };
  }

  if (preVerdict) {
    return { ...record, outcome: preVerdict.outcome, reason: preVerdict.reason, violations: preVerdict.violations ?? null };
  }

  const execution = await executeTool(session, selection.tool, selection.arguments);
  const after = await observe(session);
  const postVerdict = classifyAfterExecution({ execution, before, after });

  return {
    ...record,
    execution: {
      ok: execution.ok,
      callShape: execution.callShape ?? null,
      // The rejected signatures are the compatibility data: which shapes a build
      // refuses, and with what message, is the row worth publishing.
      attempts: execution.attempts ?? null,
      error: execution.error ?? null,
      result: execution.result ?? null,
    },
    observation: { before, after, changed: JSON.stringify(before) !== JSON.stringify(after) },
    outcome: postVerdict.outcome,
    reason: postVerdict.reason,
  };
};
