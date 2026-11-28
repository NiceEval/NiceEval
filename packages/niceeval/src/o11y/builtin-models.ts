import { readFileSync } from "node:fs";
import * as Schema from "effect/Schema";
import { builtinModelKeys } from "./builtin-model-key.ts";

// Third-party JSON input boundary: the bundled catalog omits prices for unreported token buckets.
export interface BuiltinPrice {
  readonly in: number;
  readonly out: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

interface BuiltinModelCatalog {
  readonly sourceId?: string;
  readonly asOf?: number;
  readonly prices: Readonly<Record<string, BuiltinPrice>>;
  readonly contextWindows: Readonly<Record<string, number>>;
}

const CatalogInputSchema = Schema.Struct({
  $source: Schema.optionalKey(Schema.String),
  $asOf: Schema.optionalKey(Schema.Number),
  prices: Schema.optionalKey(
    Schema.NullOr(
      Schema.Record(
        Schema.String,
        Schema.Struct({
          in: Schema.Number,
          out: Schema.Number,
          cacheRead: Schema.optionalKey(Schema.Number),
          cacheWrite: Schema.optionalKey(Schema.Number),
        }),
      ),
    ),
  ),
  contextWindows: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Number))),
});
const decodeCatalog = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.declare<typeof CatalogInputSchema.Type>(Schema.is(CatalogInputSchema))),
);

export const builtinModelCatalog: BuiltinModelCatalog = (() => {
  try {
    const value = decodeCatalog(readFileSync(new URL("./prices.json", import.meta.url), "utf8"));
    return {
      ...(value.$source === undefined ? {} : { sourceId: value.$source }),
      ...(value.$asOf === undefined ? {} : { asOf: value.$asOf }),
      prices: value.prices ?? {},
      contextWindows: value.contextWindows ?? {},
    };
  } catch {
    return { prices: {}, contextWindows: {} };
  }
})();

/** Exact model, bare model, then the bare model without a date suffix. Shared
 * by price and context metadata so gateway prefixes have the same meaning. */
export function lookupBuiltinModel<T>(
  table: Readonly<Record<string, T>>,
  model: string,
): { readonly value: T; readonly selector: string } | undefined {
  for (const selector of builtinModelKeys(model)) {
    if (Object.hasOwn(table, selector)) return { value: table[selector]!, selector };
  }
  return undefined;
}

export function builtinContextWindow(model: string): number | undefined {
  return lookupBuiltinModel(builtinModelCatalog.contextWindows, model)?.value;
}
