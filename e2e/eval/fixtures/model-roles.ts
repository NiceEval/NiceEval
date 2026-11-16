import { defineAdapter, type AdapterUsageInput } from "niceeval";

export const roles = defineAdapter({
  name: "model-roles",
  behaviorRevision: "1",
  create(ctx) {
    const initialModels = ctx.models;
    return {
      selection() {
        return {
          models: ctx.models,
          model: ctx.model,
          reasoningEffort: ctx.reasoningEffort,
          sameSelection: ctx.models === initialModels,
          frozen: Object.isFrozen(ctx.models) && Object.values(ctx.models).every(Object.isFrozen),
          keys: Object.keys(ctx.models),
          requiredKeys: Object.values(ctx.models).every((value) =>
            Object.hasOwn(value, "model") && Object.hasOwn(value, "reasoningEffort")),
          absentValues: Object.values(ctx.models).every((value) =>
            value.model !== null && value.reasoningEffort !== null),
        };
      },
      record(usage: AdapterUsageInput) { ctx.recordUsage(usage); },
      finishUsage() { ctx.sealUsage({ state: "complete" }); },
      catchInvalidReference() {
        try {
          ctx.recordUsage({
            callId: "invalid-slot", modelRole: "undeclared", provider: null,
            model: "fixture/actual", status: "succeeded", inputTokens: 1, outputTokens: 1,
          });
          return false;
        } catch { return true; }
      },
    };
  },
});
