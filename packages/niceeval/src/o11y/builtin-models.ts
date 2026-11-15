import { readFileSync } from "node:fs";
import * as Schema from "effect/Schema";

// Third-party JSON input boundary: the bundled catalog omits prices for unreported token buckets.
export interface BuiltinPrice {
  readonly in: number;
  readonly out: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

interface BuiltinModelCatalog {
  readonly prices: Readonly<Record<string, BuiltinPrice>>;
  readonly contextWindows: Readonly<Record<string, number>>;
}

const CatalogInputSchema = Schema.Struct({
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
    return { prices: value.prices ?? {}, contextWindows: value.contextWindows ?? {} };
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
  const bare = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  const undated = bare.replace(/-\d{8}$/u, "").replace(/-\d{4}-\d{2}-\d{2}$/u, "");
  for (const selector of [model, bare, undated]) {
    if (Object.hasOwn(table, selector)) return { value: table[selector]!, selector };
  }
  return undefined;
}

export function builtinContextWindow(model: string): number | undefined {
  return lookupBuiltinModel(builtinModelCatalog.contextWindows, model)?.value;
}
