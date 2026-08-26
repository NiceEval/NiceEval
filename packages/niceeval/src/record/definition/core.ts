import type { Schema } from "effect";
import {
  compileRecordSchemaCodec,
  type RecordSchemaCodec,
  type RecordSchemaLimits,
} from "./schema-codec.ts";

export type RecordCoreDefinition<
  Value,
  SourceSchema extends Schema.ConstraintDecoder<unknown, never> & Schema.ConstraintEncoder<unknown, never> = Schema.ConstraintDecoder<unknown, never> & Schema.ConstraintEncoder<unknown, never>,
> = RecordSchemaCodec<Value, never, SourceSchema> & { readonly kind: "core" };

/** Core can contain only canonical JSON. Blob refs are exclusive to fixed Attachments. */
export function defineRecordCore<const SourceSchema extends Schema.ConstraintDecoder<unknown, never> & Schema.ConstraintEncoder<unknown, never>>(input: {
  readonly schema: SourceSchema;
  readonly limits: RecordSchemaLimits;
}): RecordCoreDefinition<SourceSchema["Type"], SourceSchema> {
  const codec = compileRecordSchemaCodec({
    schema: input.schema,
    limits: input.limits,
  });
  return Object.freeze({ ...codec, kind: "core" as const });
}
