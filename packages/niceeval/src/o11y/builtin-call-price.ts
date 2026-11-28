import { canonicalDecimalFromNumber } from "../record/family/adapter-usage/pricing.ts";
import { builtinModelCatalog, lookupBuiltinModel } from "./builtin-models.ts";
import type { BuiltinCallPriceProfile } from "./judge-call-price.ts";

export function builtinCallPrice(model: string): BuiltinCallPriceProfile | undefined {
  const { prices, sourceId, asOf } = builtinModelCatalog;
  if (sourceId === undefined || asOf === undefined || !Number.isSafeInteger(asOf) || asOf <= 0) return undefined;
  const selected = lookupBuiltinModel(prices, model);
  if (selected === undefined) return undefined;
  const { in: input, out: output, cacheRead, cacheWrite } = selected.value;
  const inputRate = canonicalDecimalFromNumber(input);
  const outputRate = canonicalDecimalFromNumber(output);
  if (inputRate === undefined || outputRate === undefined) return undefined;
  return {
    basis: "catalog-reference",
    currency: "USD",
    source: { kind: "builtin-catalog", id: sourceId, asOf },
    requestModel: model,
    selector: selected.selector,
    match: "builtin-catalog",
    ratesPerMTok: {
      input: inputRate,
      output: outputRate,
      cacheRead: cacheRead === undefined ? null : (canonicalDecimalFromNumber(cacheRead) ?? null),
      cacheWrite: cacheWrite === undefined ? null : (canonicalDecimalFromNumber(cacheWrite) ?? null),
    },
  };
}
