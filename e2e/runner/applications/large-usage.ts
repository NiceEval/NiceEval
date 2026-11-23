import { defineAdapter } from "niceeval";
export const largeUsage = defineAdapter({
  name: "large-usage",
  create(ctx) {
    // The usage schema accepts this string, but Record cannot encode a lone UTF-16 surrogate.
    const malformedModel = process.env.NICEEVAL_MALFORMED_USAGE_MODEL === "1";
    const model = malformedModel ? "fixture-model-\ud800" : "fixture-model-" + "x".repeat(200);
    const calls = malformedModel ? 1 : 3000;
    for (let index = 0; index < calls; index += 1) {
      ctx.recordUsage({
        callId: `request-${index}`,
        provider: "fixture-provider",
        model,
        status: "succeeded",
        inputTokens: 0,
        inputTotalTokens: 0,
        outputTokens: 0,
      });
    }
    ctx.sealUsage({ state: "complete" });
    return { value: () => 42 };
  },
});
