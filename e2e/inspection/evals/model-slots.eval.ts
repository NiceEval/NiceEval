import { modelSlots } from "../adapters/model-slots.ts";

export default modelSlots.defineEval({
  description: "Offline shared-model roles, retry fallback, zero, and missing cost",
  test(t) {
    const reported = (amount: string) => ({ amount, currency: "USD", source: { kind: "reported" as const, id: "offline.response" } });
    const route = { transportProvider: "offline-gateway", endpointId: "offline-model-slots" };
    const failed = { callId: "planner-1", modelSlot: "planner", provider: "fixture-provider", model: t.selectedModel("planner"), route, status: "failed" as const, inputTokens: 10, inputTotalTokens: 10, outputTokens: 0, cost: reported("0") };
    t.record(failed);
    t.record({ ...failed });
    t.record({ callId: "planner-2", retryOf: "planner-1", modelSlot: "planner", provider: null, model: "fixture/fallback", route, status: "succeeded", inputTokens: 20, inputTotalTokens: 20, outputTokens: 3, cost: reported("0.125") });
    t.record({ callId: "reviewer-1", modelSlot: "reviewer", provider: "fixture-provider", model: t.selectedModel("reviewer"), route, status: "succeeded", inputTokens: 5, inputTotalTokens: 5, outputTokens: 2, cost: reported("0.25") });
    t.record({ callId: "unattributed-1", provider: null, model: "fixture/unpriced", route, status: "unknown", inputTokens: null, outputTokens: null });
    t.finishUsage();
  },
});
