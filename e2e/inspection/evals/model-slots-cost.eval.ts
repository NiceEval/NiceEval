import { modelSlots } from "../adapters/model-slots.ts";

export default modelSlots.defineEval({
  description: "C3: 375 calls, 356 reported costs, 19 unpriced calls",
  test(t) {
    for (let index = 0; index < 375; index += 1) {
      const modelSlot = index < 356 ? "planner" : "reviewer";
      t.record({
        callId: `cost-${String(index).padStart(3, "0")}`, modelSlot,
        provider: "fixture-provider", model: t.selectedModel(modelSlot), status: "succeeded",
        inputTokens: 1, inputTotalTokens: 1, outputTokens: 1,
        ...(index < 356 ? { cost: {
          amount: index === 0 ? "0.071083152" : "0", currency: "USD",
          source: { kind: "reported" as const, id: "offline.response" },
        } } : {}),
      });
    }
    t.finishUsage();
  },
});
