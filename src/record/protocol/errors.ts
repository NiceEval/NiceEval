import { Schema } from "effect";

export const RecordProtocolErrorCodeSchema = Schema.Literal(
  "canonical-json-invalid",
  "canonical-json-cycle",
  "canonical-json-unsupported",
  "canonical-json-nonfinite",
  "canonical-json-unicode-invalid",
  "canonical-json-bytes-invalid",
  "canonical-json-not-canonical",
  "schema-invalid",
  "media-type-invalid",
  "unsupported-digest",
  "object-too-large",
  "descriptor-invalid",
  "descriptor-digest-mismatch",
  "descriptor-size-mismatch",
  "strong-edge-invalid",
  "strong-edge-duplicate",
  "strong-edge-order-invalid",
  "edge-contract-invalid",
  "payload-codec-duplicate",
  "payload-invariant-invalid",
  "base64-invalid",
  "archive-invalid",
  "receipt-invalid",
);

export type RecordProtocolErrorCode = Schema.Schema.Type<
  typeof RecordProtocolErrorCodeSchema
>;

/** Stable typed failure surface for deterministic protocol construction and decoding. */
export class RecordProtocolError extends Schema.TaggedError<RecordProtocolError>(
  "RecordProtocolError",
)("RecordProtocolError", {
  code: RecordProtocolErrorCodeSchema,
  operation: Schema.String,
  path: Schema.Array(Schema.String),
  message: Schema.String,
  expected: Schema.optionalWith(Schema.String, { exact: true }),
  actual: Schema.optionalWith(Schema.String, { exact: true }),
}) {}

export interface RecordProtocolErrorInput {
  readonly code: RecordProtocolErrorCode;
  readonly operation: string;
  readonly path?: readonly string[];
  readonly message: string;
  readonly expected?: string;
  readonly actual?: string;
}

export function recordProtocolError(
  input: RecordProtocolErrorInput,
): RecordProtocolError {
  return RecordProtocolError.make({
    code: input.code,
    operation: input.operation,
    path: input.path ?? [],
    message: input.message,
    ...(input.expected === undefined ? {} : { expected: input.expected }),
    ...(input.actual === undefined ? {} : { actual: input.actual }),
  });
}
