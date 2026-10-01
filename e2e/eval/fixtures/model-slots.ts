import { defineAdapter, type AdapterUsageInput } from "niceeval";

export const modelSlots = defineAdapter({
  name: "model-slots",
  behaviorRevision: "1",
  create(ctx) {
    const initialModels = ctx.models;
    return {
      selection() {
        return {
          models: ctx.models,
          model: ctx.model ?? null,
          reasoningEffort: ctx.reasoningEffort ?? null,
          sameSelection: ctx.models === initialModels,
          frozen: Object.isFrozen(ctx.models) && Object.values(ctx.models).every(Object.isFrozen),
          keys: Object.keys(ctx.models),
        };
      },
      record(usage: AdapterUsageInput) { ctx.recordUsage(usage); },
      finishUsage() { ctx.sealUsage({ state: "complete" }); },
      catchInvalidReference() {
        try {
          ctx.recordUsage({
            callId: "invalid-slot", modelSlot: "undeclared", provider: null,
            model: "fixture/actual", status: "succeeded", inputTokens: 1, outputTokens: 1,
          });
          return false;
        } catch { return true; }
      },
    };
  },
});
