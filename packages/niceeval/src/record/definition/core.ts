import type { Schema } from "effect";
import {
  compileRecordSchemaCodec,
  type RecordSchemaCodec,
  type RecordSchemaLimits,
} from "./schema-codec.ts";

export type RecordCoreDefinition<
  Value,
  SourceSchema extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
> = RecordSchemaCodec<Value, never, SourceSchema> & { readonly kind: "core" };

/** Core can contain only canonical JSON. Blob refs are exclusive to fixed Attachments. */
export function defineRecordCore<const SourceSchema extends Schema.Schema.AnyNoContext>(input: {
  readonly schema: SourceSchema;
  readonly limits: RecordSchemaLimits;
}): RecordCoreDefinition<Schema.Schema.Type<SourceSchema>, SourceSchema> {
  const codec = compileRecordSchemaCodec({
    schema: input.schema,
    limits: input.limits,
  });
  return Object.freeze({ ...codec, kind: "core" as const });
}
