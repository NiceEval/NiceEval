import { defineAdapter, type AdapterUsageInput } from "niceeval";
export const cacheRead = defineAdapter({
  name: "cache-read",
  behaviorRevision: "1",
  create(ctx) {
    return {
      record(value: Pick<AdapterUsageInput, "callId" | "status"> & Partial<AdapterUsageInput>) {
        ctx.recordUsage({ provider: null, model: null, inputTokens: null, outputTokens: null, ...value });
      },
      finish(partial = false) {
        ctx.sealUsage(partial ? { state: "partial", reason: "ai-event-stream-incomplete" } : { state: "complete" });
      },
    };
  },
});
