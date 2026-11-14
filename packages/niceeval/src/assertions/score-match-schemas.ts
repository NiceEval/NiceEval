import * as Schema from "effect/Schema";

export const text = Schema.String.check(Schema.isPattern(/\S/u));
export const scoreSchema = Schema.Struct({
  measurement: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  rationale: text,
});
export const classifySchema = Schema.Struct({ choice: text, rationale: text });
export const extractSchema = Schema.Struct({ items: Schema.Array(text), rationale: text, complete: Schema.Boolean });
export const batchSchema = Schema.Struct({ items: Schema.Array(Schema.Struct({ id: text, choice: text, rationale: text })) });
