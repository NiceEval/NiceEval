import { equals } from "niceeval/expect";
import { externalUsage } from "../fixtures/external-usage.ts";

export default externalUsage.defineEval({
  description: "Record external request snapshots without a conversation",
  test(t) {
    const failed = { callId: "request-1", provider: null, model: null, status: "failed" as const, inputTokens: null, inputTotalTokens: 100, outputTokens: 2 };
    t.record(failed);
    t.record({ ...failed });
    t.record({ outputTokens: 2, inputTotalTokens: 100, inputTokens: null, status: "failed", model: null, provider: null, callId: "request-1" });
    t.record({ callId: "request-2", retryOf: "request-1", provider: "example", model: "test-model", status: "succeeded", inputTokens: 60, inputTotalTokens: 100, cacheReadTokens: 30, cacheWriteTokens: 10, outputTokens: 8 });
    t.record({ callId: "request-3", provider: null, model: null, status: "unknown", inputTokens: null, outputTokens: null });
    t.record({ callId: "request-4", provider: null, model: null, status: "succeeded", inputTokens: 0, inputTotalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
    t.record({ callId: "request-5", provider: null, model: null, status: "succeeded", inputTokens: 60, cacheReadTokens: 30, cacheWriteTokens: 10, outputTokens: 20 });
    for (let index = 6; index <= 131; index += 1) {
      t.record({ callId: `request-${index}`, provider: null, model: null, status: "succeeded", inputTokens: 1, inputTotalTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 });
    }
    t.check(true, equals(true)).gate();
  },
});
