import { defineAdapter, type AdapterUsageInput } from "niceeval";

export const externalUsage = defineAdapter({
  name: "external-usage",
  behaviorRevision: "1",
  create(ctx) {
    return { record: (usage: AdapterUsageInput) => ctx.recordUsage(usage) };
  },
});
