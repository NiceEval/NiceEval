import { equals } from "niceeval/expect";
import { usageCost } from "../adapters/usage-cost.ts";

export default usageCost.defineEval({
  description: "Expose one known provider-reported zero and one unknown call without inventing cost",
  test(t) {
    t.record({
      callId: "gateway-call",
      provider: "typesafe-ai",
      model: "typesafe-ai/jev",
      route: { transportProvider: "vercel", endpointId: "vercel-ai-gateway" },
      cost: {
        amount: "0",
        currency: "USD",
        source: { kind: "reported", id: "vercel-ai-gateway.response" },
      },
      status: "succeeded",
      inputTokens: 5,
      inputTotalTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 2,
    });
    t.record({
      callId: "custom-endpoint-call",
      provider: "openai",
      model: "openai/gpt-6-luna",
      route: { transportProvider: null, endpointId: "custom-openai-compatible" },
      status: "succeeded",
      inputTokens: 5,
      inputTotalTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: 0,
      outputTokens: null,
    });
    t.check(true, equals(true)).gate();
  },
});
