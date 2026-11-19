import { defineAdapter } from "niceeval";
import { atMost, atLeast, lessThan, greaterThan, between, measured, quantile, ms, seconds, ratio, type NumericMaterial } from "niceeval/expect";
const adapter = defineAdapter({ name: "unit-types", create: () => ({}) });
adapter.defineEval({ test(t) {
  const latency = measured(ms(40), { unavailable: "missing" });
  t.check(latency, atMost(ms(500)));
  t.check(latency, between(ms(1), ms(500)));
  t.check(ms(40), lessThan(ms(500)));
  t.check(measured(null, { unavailable: "missing" }), atMost(5));
  t.check(quantile([], 0.5), atMost(5));
  // @ts-expect-error Inclusive bounds must use the same unit.
  between(ms(1), seconds(2));
  // @ts-expect-error Inclusive bounds cannot mix unitful and unitless values.
  between(ms(1), 2);
  // @ts-expect-error Range matches retain their unit.
  t.check(latency, between(seconds(1), seconds(2)));
  // @ts-expect-error Strict comparisons also require the same unit.
  t.check(latency, greaterThan(seconds(1)));
  // @ts-expect-error Time units must agree.
  t.check(latency, atMost(seconds(1)));
  // @ts-expect-error Unit-bearing observations require wrapped thresholds.
  t.check(latency, atMost(500));
  t.check(1, atMost(2));
  // @ts-expect-error Unitless observations reject unit thresholds.
  t.check(1, atMost(ms(2)));
  // @ts-expect-error Unitless measured observations reject unit thresholds.
  t.check(measured(1, { unavailable: "missing" }), atMost(ms(2)));
  const rates: NumericMaterial<"ratio"> = t.usage.cacheRead.rate();
  t.check(rates, atLeast(ratio(0.6)));
  // @ts-expect-error Ratios need ratio thresholds.
  t.check(rates, atLeast(0.6));
  t.check(quantile([ms(1), ms(3)], 0.9), atMost(ms(4)));
  // @ts-expect-error Quantiles retain their units.
  t.check(quantile([ms(1), ms(3)], 0.9), atMost(seconds(4)));
  // @ts-expect-error Quantities are immutable.
  ms(1).value = 3;
  // @ts-expect-error Quantities do not participate in arithmetic.
  const sum = ms(1) + 2;
  void sum;
}});
