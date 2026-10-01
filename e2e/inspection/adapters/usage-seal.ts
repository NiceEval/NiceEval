import { defineAdapter } from "niceeval";

export const usageSealAdapter = defineAdapter({
  name: "usage-seal",
  behaviorRevision: "1",
  create(ctx) {
    return {
      recordKnownCost() {
        ctx.recordUsage({
          callId: "accepted", provider: "offline-application", model: "application-model", status: "succeeded",
          inputTokens: 4, inputTotalTokens: 4, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
          cost: { amount: "0.125", currency: "USD", source: { kind: "reported", id: "offline.response" } },
        });
      },
      finishComplete() { ctx.sealUsage({ state: "complete" }); },
      finishPartial() { ctx.sealUsage({ state: "partial", reason: "journal-not-sealed" }); },
      catchWriteAfterSeal() {
        try {
          ctx.recordUsage({
            callId: "after-seal", provider: "offline-application", model: "application-model", status: "succeeded",
            inputTokens: 8, inputTotalTokens: 8, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0,
            cost: { amount: "0.875", currency: "USD", source: { kind: "reported", id: "offline.response" } },
          });
          return false;
        } catch {
          return true;
        }
      },
    };
  },
});
