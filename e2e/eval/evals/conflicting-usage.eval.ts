import { equals } from "niceeval/expect";
import { externalUsage } from "../fixtures/external-usage.ts";

export default externalUsage.defineEval({
  description: "Reject contradictory request observations even when caught",
  test(t) {
    const snapshot = {
      callId: "request-1",
      provider: "typesafe-ai",
      model: "typesafe-ai/jev",
      route: { transportProvider: "vercel", endpointId: "vercel-ai-gateway" },
      cost: {
        amount: "0",
        currency: "USD",
        source: { kind: "reported" as const, id: "vercel-ai-gateway.response" },
      },
      status: "failed" as const,
      inputTokens: 1,
      outputTokens: 2,
    };
    t.record(snapshot);
    let rejected = false;
    try {
      t.record({
        ...snapshot,
        cost: { ...snapshot.cost, amount: "0.0001" },
      });
    } catch { rejected = true; }
    t.check(rejected, equals(true)).gate();
  },
});
