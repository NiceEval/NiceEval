import { defineAdapter, type AdapterUsageInput } from "niceeval";

export const usageCost = defineAdapter({
  name: "usage-cost",
  behaviorRevision: "1",
  create(ctx) {
    return { record: (usage: AdapterUsageInput) => ctx.recordUsage(usage) };
  },
});
