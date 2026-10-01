import { externalUsage } from "../fixtures/external-usage.ts";

export default externalUsage.defineEval({
  description: "Sealed mixed-currency budgets preserve an unknown ceiling and a known excess",
  test(t) {
    t.record({
      callId: "precise", provider: "provider", model: "provider/model", status: "failed",
      inputTokens: 10, inputTotalTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      cost: { amount: "1.0000000000000001", currency: "USD", source: { kind: "reported", id: "actual" } },
    });
    t.record({
      callId: "foreign", provider: "provider", model: "provider/model", status: "failed",
      inputTokens: 0, inputTotalTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      cost: { amount: "0", currency: "EUR", source: { kind: "reported", id: "actual" } },
    });
    t.finishUsage();
    t.maxCost(2).label("Mixed currency unknown");
    t.maxCost(0.5).label("Mixed currency exceeded");
  },
});
