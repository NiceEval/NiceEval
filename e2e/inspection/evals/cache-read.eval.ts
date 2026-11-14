import { atLeast, ratio, includes, type NumericMaterial } from "niceeval/expect";
import { deepStrictEqual, throws } from "node:assert";
import { cacheRead } from "../adapters/cache-read.ts";
export default cacheRead.defineEval({
  description: "Cache read rate uses complete token-weighted physical calls",
  test(t) {
    const scenario = String(t.flags.scenario);
    const before = t.usage;
    if (scenario === "exact") {
      t.record({
        callId: "first",
        modelRole: "planner",
        provider: "offline",
        model: "primary",
        status: "failed",
        inputTokens: 0,
        cacheReadTokens: 900,
        cacheWriteTokens: 100,
      });
      t.record({
        callId: "retry",
        retryOf: "first",
        modelRole: "planner",
        provider: null,
        model: "fallback",
        status: "succeeded",
        inputTotalTokens: 100,
        cacheReadTokens: 10,
      });
    } else if (scenario === "missing") {
      t.record({ callId: "missing-cache", modelRole: "planner", status: "succeeded", inputTotalTokens: 100 });
      t.record({
        callId: "missing-total",
        modelRole: "planner",
        status: "succeeded",
        cacheReadTokens: 10,
        inputTokens: 20,
      });
      t.record({
        callId: "unknown",
        modelRole: "reviewer",
        status: "unknown",
        cacheReadTokens: 10,
        inputTotalTokens: 20,
      });
    } else if (scenario === "zero") {
      t.record({ callId: "zero", modelRole: "planner", status: "succeeded", cacheReadTokens: 0, inputTotalTokens: 0 });
    } else if (scenario === "uncached") {
      t.record({
        callId: "uncached",
        modelRole: "planner",
        status: "succeeded",
        cacheReadTokens: 0,
        inputTotalTokens: 100,
      });
    } else if (scenario === "unsafe") {
      for (let i = 0; i < 2; i++)
        t.record({
          callId: `unsafe-${i}`,
          modelRole: "planner",
          status: "succeeded",
          cacheReadTokens: 1,
          inputTotalTokens: Number.MAX_SAFE_INTEGER,
        });
    } else if (scenario === "empty") {
      // A complete empty ledger proves no samples, not a zero cache rate.
    } else if (scenario === "capacity") {
      for (let i = 0; i < 2000; i++)
        t.record({
          callId: `call-${i}`,
          modelRole: "planner",
          provider: i === 0 ? '"'.repeat(256) : "offline",
          model: i === 0 ? '"'.repeat(250) + String(i).padStart(6, "0") : `model-${i}`,
          status: "succeeded",
          cacheReadTokens: 1,
          inputTotalTokens: 1,
        });
    } else {
      t.record({
        callId: "partial",
        modelRole: "planner",
        status: "succeeded",
        cacheReadTokens: 60,
        inputTotalTokens: 100,
      });
    }
    if (scenario !== "unsealed") t.finish(scenario === "partial");
    const { rate } = t.usage.cacheRead;
    const planner: NumericMaterial<"ratio"> = rate("planner");
    if (scenario === "exact" || scenario === "capacity") t.check(planner, atLeast(ratio(0.8))).gate();
    const expected =
      scenario === "exact"
        ? { state: "exact", value: 910 / 1100 }
        : scenario === "capacity"
          ? { state: "exact", value: 1 }
          : scenario === "uncached"
            ? { state: "exact", value: 0 }
            : {
                state: "unavailable",
                reason:
                  (
                    {
                      missing: "cache-read-missing",
                      zero: "zero-input-total",
                      unsafe: "unsafe-token-total",
                      empty: "role-has-no-calls",
                    } as Record<string, string>
                  )[scenario] ?? "collection-incomplete",
              };
    deepStrictEqual(planner, { ...expected, unit: "ratio" });
    throws(() => rate("absent-slot"), /Undeclared model role.*absent-slot.*planner/);
    throws(() => rate("toString"), /Undeclared model role/);
    deepStrictEqual(rate(), { ...t.usage.cacheRead.total.rate, unit: "ratio" });
    deepStrictEqual(before.cacheRead.rate("planner"), {
      unit: "ratio",
      state: "unavailable",
      reason: "collection-incomplete",
    });
    deepStrictEqual(rate("unused"), {
      unit: "ratio",
      state: "unavailable",
      reason: scenario === "partial" || scenario === "unsealed" ? "collection-incomplete" : "role-has-no-calls",
    });
    t.check(JSON.stringify(before.cacheRead.total.rate), includes("collection-incomplete"));
    t.check(Object.isFrozen(t.usage.cacheRead.roles) ? "frozen" : "mutable", includes("frozen"));
  },
});
