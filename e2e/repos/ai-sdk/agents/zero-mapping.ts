// Entry point 3/3: fromAiSdk(result) — the zero-mapping transform used directly, not
// through the aiSdkAgent factory. Deliberately the simplest possible integration (no
// session, no approval resume) so the Eval on top of it tests the transform itself:
// step content, tool-call/result pairing by call id, and aggregated usage.
import { completeCoverage, defineAgent, fromAiSdk } from "niceeval/adapter";
import { generateText, stepCountIs } from "ai";
import { buildTools, SYSTEM_PROMPT } from "../src/backend/tool-defs.ts";
import { DEFAULT_MODEL, resolveModel } from "../src/backend/models.ts";

export default defineAgent({
  name: "ai-sdk-zero-mapping",
  // Same evidence quality as the official aiSdkAgent factory (full AI SDK result shape,
  // no hand-rolled event synthesis) — truthfully complete, not a guess.
  coverage: completeCoverage,
  async send(input, ctx) {
    const result = await generateText({
      model: resolveModel(ctx.model ?? DEFAULT_MODEL),
      system: SYSTEM_PROMPT,
      prompt: input.text,
      tools: buildTools(),
      stopWhen: stepCountIs(5),
      abortSignal: ctx.signal,
    });
    return { ...fromAiSdk(result), data: result.text };
  },
});
