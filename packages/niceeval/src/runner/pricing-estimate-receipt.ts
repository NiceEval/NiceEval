import type { PricingEstimateReceipt } from "../o11y/cost.ts";

const pricingEstimateReceipt = Symbol("niceeval.runner.pricing-estimate-receipt");

type WithPricingEstimateReceipt = {
  readonly [pricingEstimateReceipt]?: PricingEstimateReceipt;
};

/** Runner-internal handoff: symbols survive evidence spreads but never enter JSON artifacts. */
export function bindPricingEstimateReceipt<Value extends object>(
  value: Value,
  receipt: PricingEstimateReceipt | undefined,
): Value {
  if (receipt !== undefined) Object.assign(value, { [pricingEstimateReceipt]: receipt });
  return value;
}

export function getPricingEstimateReceipt(value: object): PricingEstimateReceipt | undefined {
  return (value as WithPricingEstimateReceipt)[pricingEstimateReceipt];
}
