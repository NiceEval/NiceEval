import { defineAdapter } from "niceeval";
import { defineMaterialMatch, defineValueMatch } from "niceeval/expect";

export const judgeUsageApplication = defineAdapter({
  name: "judge-usage-application",
  behaviorRevision: "1",
  create(ctx) {
    return {
      history() { return [{ id: "answer-1", value: "Paris is the capital of France." }]; },
      recordApplicationUsage() {
        ctx.recordUsage({
          callId: "application-1", provider: "offline-application", model: "application-model",
          status: "succeeded", inputTokens: 4, inputTotalTokens: 4, outputTokens: 1,
          cacheReadTokens: 0, cacheWriteTokens: 0,
          cost: { amount: "0.25", currency: "USD", source: { kind: "reported", id: "offline-application.response" } },
        });
        ctx.sealUsage({ state: "complete" });
      },
    };
  },
});

const answer = defineValueMatch<string>({ name: "answer-present", evaluate: (text) => text.length > 0 });
type HistoryContext = { history(): readonly { id: string; value: string }[] };
export const judgeUsageHistory = defineMaterialMatch<HistoryContext, string>({
  name: "answer-history", read: (ctx) => ({ state: "complete", items: ctx.history() }), match: answer,
});
export const judgeUsageEmptyHistory = defineMaterialMatch<HistoryContext, string>({
  name: "empty-answer-history", read: () => ({ state: "complete", items: [] }), match: answer,
});
