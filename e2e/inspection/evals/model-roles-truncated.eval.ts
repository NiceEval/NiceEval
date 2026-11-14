import { roles } from "../adapters/model-roles.ts";

export default roles.defineEval({
  description: "C9: 129 a groups hide z in both previews without changing counts or cost",
  test(t) {
    t.selectedModel("a");
    for (let index = 0; index < 129; index += 1) {
      t.record({
        callId: `a-${String(index).padStart(3, "0")}`,
        modelRole: "a",
        provider: "fixture-provider",
        model: `fixture/a-${String(index).padStart(3, "0")}`,
        status: "succeeded",
        inputTokens: 1,
        inputTotalTokens: 1,
        outputTokens: 1,
        cost: { amount: "0", currency: "USD", source: { kind: "reported", id: "offline.response" } },
      });
    }
    t.record({
      callId: "z-000",
      modelRole: "z",
      provider: "fixture-provider",
      model: t.selectedModel("z"),
      status: "succeeded",
      inputTokens: 7,
      inputTotalTokens: 7,
      outputTokens: 3,
      cost: { amount: "0.5", currency: "USD", source: { kind: "reported", id: "offline.response" } },
    });
    t.finishUsage();
  },
});
