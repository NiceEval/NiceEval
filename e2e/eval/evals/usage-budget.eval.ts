import { defineValueMatch } from "niceeval/expect";
import { externalUsage } from "../fixtures/external-usage.ts";
export default externalUsage.defineEval({
  description: "Sealed single-currency budgets preserve exact decimals and prior snapshots",
  test(t) {
    const empty = t.usage;
    t.check(empty, defineValueMatch({ name: "empty-is-unknown", evaluate: (value: typeof empty) => value.source === "adapter" && value.totalTokens.state === "unavailable" && value.costs.state === "unavailable" })).gate();
    const call = { provider: "provider", model: "provider/model", status: "failed" as const, inputTokens: 10, inputTotalTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    t.record({ ...call, callId: "precise", cost: { amount: "1.0000000000000001", currency: "USD", source: { kind: "reported", id: "actual" } } });
    const first = t.usage;
    t.record({ ...call, callId: "zero", inputTokens: 0, inputTotalTokens: 0, cost: { amount: "0", currency: "USD", source: { kind: "reported", id: "actual" } } });
    t.check(first, defineValueMatch({ name: "snapshot-isolated", evaluate: (value: typeof first) => value.source === "adapter" && value.totalTokens.state === "lower-bound" && value.costs.totalContributions === 1 && value.costs.values[0]?.value === "1.0000000000000001" })).gate().label("Prior usage snapshot unchanged");
    t.finishUsage();
    t.maxCost(1).label("Exact decimal exceeded");
    t.maxCost(1.01).gate().label("Exact decimal within");
    t.maxTokens(10).gate().label("Complete tokens");
  },
});
