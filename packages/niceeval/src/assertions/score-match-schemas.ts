import * as Schema from "effect/Schema";
import * as Option from "effect/Option";

export const text = Schema.String.check(Schema.isPattern(/\S/u));
export const unitSchema = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

function primitiveSchemas(text: Schema.Codec<string>) {
  return {
    score: Schema.Struct({ measurement: unitSchema, rationale: text }),
    classify: Schema.Struct({ choice: text, rationale: text }),
    extract: Schema.Struct({ items: Schema.Array(text), rationale: text, complete: Schema.Boolean }),
    batch: Schema.Struct({ items: Schema.Array(Schema.Struct({ id: text, choice: text, rationale: text })) }),
    citedClassify: Schema.Struct({ choice: text, rationale: text, citations: Schema.Array(Schema.String) }),
  };
}

const gatewaySchemas = primitiveSchemas(text);
export const scoreSchema = gatewaySchemas.score;
export const classifySchema = gatewaySchemas.classify;
export const extractSchema = gatewaySchemas.extract;
export const batchSchema = gatewaySchemas.batch;
// The citation branch historically accepts any string before checking labels/IDs.
export const citedClassifySchema = primitiveSchemas(Schema.String).citedClassify;
// Audit text accepts non-empty original text, including whitespace. Keep its
// existing read boundary separate from the gateway's model-output boundary.
export const auditPrimitiveSchemas = primitiveSchemas(Schema.NonEmptyString);

function strictResult<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const decode = Schema.decodeUnknownOption(schema, { onExcessProperty: "error" });
  return (value: unknown): value is S["Type"] => Option.isSome(decode(value));
}

export const isAuditPrimitive = {
  score: strictResult(auditPrimitiveSchemas.score),
  classify: strictResult(auditPrimitiveSchemas.classify),
  extract: strictResult(auditPrimitiveSchemas.extract),
  batch: strictResult(auditPrimitiveSchemas.batch),
  citedClassify: strictResult(auditPrimitiveSchemas.citedClassify),
};
