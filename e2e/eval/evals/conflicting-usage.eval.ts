import { equals } from "niceeval/expect";
import { externalUsage } from "../fixtures/external-usage.ts";

export default externalUsage.defineEval({
  description: "Reject contradictory request observations even when caught",
  test(t) {
    const snapshot = { callId: "request-1", provider: null, model: null, status: "failed" as const, inputTokens: 1, outputTokens: 2 };
    t.record(snapshot);
    let rejected = false;
    try { t.record({ ...snapshot, outputTokens: 3 }); } catch { rejected = true; }
    t.check(rejected, equals(true)).gate();
  },
});
