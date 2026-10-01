import { defineAdapter } from "niceeval";

// Offline application receipts enter the real public usage collector.
export const experimentCost = defineAdapter({
  name: "experiment-cost",
  behaviorRevision: "1",
  create(ctx) {
    return {
      recordCost(amount: string | undefined, status: "succeeded" | "failed" = "succeeded") {
        ctx.recordUsage({
          callId: "application-request",
          modelSlot: "default",
          provider: "offline-application",
          model: "fixture/experiment-cost",
          status,
          inputTokens: 1,
          inputTotalTokens: 1,
          outputTokens: 0,
          ...(amount === undefined ? {} : {
            cost: { amount, currency: "USD", source: { kind: "reported", id: "offline.receipt" } },
          }),
        });
        ctx.sealUsage({ state: "complete" });
      },
    };
  },
});
