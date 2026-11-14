// cases: docs/engineering/testing/architecture/unit/assertions.md
import { expect, test } from "vitest";
import { builtinContextWindow, lookupBuiltinModel } from "./builtin-models.ts";
import { pricingEstimate } from "./cost.ts";

// @feature docs/feature/judge/README.md
test("model metadata prefers exact names, then bare names, then undated names", () => {
  const prices = { "gateway/model": { in: 1 }, model: { in: 2 }, "model-20300101": { in: 3 } };
  const contexts = { "gateway/model": 100, model: 200, "model-20300101": 300 };
  for (const [name, selector] of [
    ["gateway/model", "gateway/model"],
    ["other/model", "model"],
    ["other/model-20300101", "model-20300101"],
    ["other/model-20300202", "model"],
    ["other/model-2030-02-02", "model"],
  ] as const) {
    expect(lookupBuiltinModel(prices, name)).toEqual({ value: prices[selector], selector });
    expect(lookupBuiltinModel(contexts, name)).toEqual({ value: contexts[selector], selector });
  }
});

// @feature docs/feature/judge/README.md
test("known model context limits share pricing normalization without changing estimates", () => {
  for (const [model, limit, amountUSD] of [
    ["gpt-5", 400_000, 11.25],
    ["claude-sonnet-4-5", 200_000, 18],
  ] as const) {
    for (const name of [model, `gateway/${model}`, `gateway/${model}-20990101`, `gateway/${model}-2099-01-01`]) {
      expect(builtinContextWindow(name)).toBe(limit);
      expect(pricingEstimate(name, { inputTokens: 1_000_000, outputTokens: 1_000_000 }))
        .toMatchObject({ state: "available", receipt: { amountUSD, priceSource: { kind: "builtin", selector: model } } });
    }
  }
});

// @feature docs/feature/judge/README.md
test("unknown model context limits stay unknown", () => {
  for (const model of ["unknown-model", "gateway/unknown-model-20990101", "toString", "__proto__"]) {
    expect(builtinContextWindow(model)).toBeUndefined();
    expect(pricingEstimate(model, { inputTokens: 1 })).toEqual({ state: "unavailable", reason: "price-source-not-found" });
  }
});
