import { defineAdapter } from "niceeval";
export const largeUsage = defineAdapter({
  name: "large-usage",
  create(ctx) {
    for (let index = 0; index < 3000; index += 1) {
      ctx.recordUsage({
        callId: `request-${index}`,
        provider: "fixture-provider",
        model: "fixture-model-" + "x".repeat(200),
        status: "succeeded",
        inputTokens: 0,
        outputTokens: 0,
      });
    }
    ctx.sealUsage({ state: "complete" });
    return { value: () => 42 };
  },
});
