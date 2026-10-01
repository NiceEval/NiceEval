import { defineAdapter, type AdapterUsageInput } from "niceeval";

// This is an offline application boundary, not an implementation of the ledger.
export const modelSlots = defineAdapter({
  name: "model-slots",
  behaviorRevision: "1",
  create(ctx) {
    return {
      selectedModel(slot: string) {
        const selection = ctx.models[slot];
        if (selection?.model == null) throw new Error(`Missing model for ${slot}`);
        return selection.model;
      },
      record(usage: AdapterUsageInput) { ctx.recordUsage(usage); },
      finishUsage() { ctx.sealUsage({ state: "complete" }); },
    };
  },
});
