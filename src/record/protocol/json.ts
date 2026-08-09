import { Schema } from "effect";

export type JsonPrimitive = null | boolean | number | string;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue =
  | JsonPrimitive
  | JsonObject
  | readonly JsonValue[];

/** JSON data only. Canonical byte constraints are applied by canonical.ts. */
export const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.Null,
    Schema.Boolean,
    Schema.JsonNumber,
    Schema.String,
    Schema.Array(JsonValueSchema),
    Schema.Record({ key: Schema.String, value: JsonValueSchema }),
  )
);

export const JsonObjectSchema: Schema.Schema<JsonObject> = Schema.Record({
  key: Schema.String,
  value: JsonValueSchema,
});
