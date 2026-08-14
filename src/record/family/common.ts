import { Either, Schema } from "effect";
import { RecordExactParseOptions } from "../codec/core.ts";
import type { RecordBlobRef } from "../attachment/types.ts";

/** The only durable business-fact families accepted by Record v1. */
export const NICE_EVAL_FAMILIES = Object.freeze([
  "niceeval.assertions",
  "niceeval.observability",
  "niceeval.file-changes",
  "niceeval.sources",
  "niceeval.artifacts",
] as const);

export type NiceEvalFamily = (typeof NICE_EVAL_FAMILIES)[number];

export const NiceEvalFamilySchema: Schema.Schema<NiceEvalFamily> = Schema.Literal(
  "niceeval.assertions",
  "niceeval.observability",
  "niceeval.file-changes",
  "niceeval.sources",
  "niceeval.artifacts",
);

export type FixedRecordAttachmentOwner = "run" | "attempt";

/**
 * Blob handles are minted by Record's fixed collectors. This schema describes
 * the in-memory seam only; storage replaces it with its own owner-local key.
 */
export const RecordBlobRefPositionSchema: Schema.Schema<
  RecordBlobRef,
  RecordBlobRef
> = Schema.declare<RecordBlobRef>(
  (value): value is RecordBlobRef => typeof value === "object" && value !== null,
);

export const NonNegativeSafeIntegerSchema = Schema.JsonNumber.pipe(
  Schema.filter(
    (value) => Number.isSafeInteger(value) && value >= 0,
    {
      identifier: "RecordNonNegativeSafeInteger",
      description: "a non-negative JSON-safe integer",
    },
  ),
);

export const PositiveSafeIntegerSchema = Schema.JsonNumber.pipe(
  Schema.filter(
    (value) => Number.isSafeInteger(value) && value > 0,
    {
      identifier: "RecordPositiveSafeInteger",
      description: "a positive JSON-safe integer",
    },
  ),
);

export const FiniteNonNegativeNumberSchema = Schema.JsonNumber.pipe(
  Schema.filter(
    (value) => Number.isFinite(value) && value >= 0,
    {
      identifier: "RecordFiniteNonNegativeNumber",
      description: "a finite non-negative JSON number",
    },
  ),
);

export const SafeTextSchema = Schema.String.pipe(
  Schema.filter(
    (value) =>
      new TextEncoder().encode(value).byteLength <= 16_384 &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    {
      identifier: "RecordSafeText",
      description: "bounded text without NUL or unsafe control characters",
    },
  ),
);

export const SafeIdentifierSchema = Schema.String.pipe(
  Schema.filter(
    (value) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value),
    {
      identifier: "RecordSafeIdentifier",
      description: "a bounded ASCII identifier",
    },
  ),
);

export const MediaTypeSchema = Schema.String.pipe(
  Schema.filter(
    (value) =>
      value.length > 0 &&
      value.length <= 255 &&
      /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:;[!#$%&'*+.^_`|~0-9A-Za-z-]+=[!#$%&'*+.^_`|~0-9A-Za-z-]+)*$/.test(
        value,
      ),
    {
      identifier: "RecordMediaType",
      description: "a bounded MIME media type without free-form parameters",
    },
  ),
);

export const CollectionLimitationSchema = Schema.Union(
  Schema.Struct({
    code: Schema.Literal("capture-failed", "capture-interrupted"),
    stage: SafeIdentifierSchema,
  }),
  Schema.Struct({
    code: Schema.Literal("collection-cap-reached", "unsupported-input"),
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
);

export const EmptyArraySchema = Schema.Array(Schema.Unknown).pipe(
  Schema.filter(
    (values): values is readonly [] => values.length === 0,
    {
      identifier: "RecordEmptyArray",
      description: "an exact empty array",
    },
  ),
);

export const CollectionStateSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyArraySchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(CollectionLimitationSchema),
  }),
);

export type CollectionState = Schema.Schema.Type<typeof CollectionStateSchema>;

export function isCanonicalIdentitySequence(
  values: readonly string[],
): boolean {
  let previous: string | undefined;
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value) || (previous !== undefined && previous >= value)) return false;
    seen.add(value);
    previous = value;
  }
  return true;
}

export function decodeFixedFamilyPayload<A, I>(
  schema: Schema.Schema<A, I>,
  input: unknown,
): Either.Either<A, { readonly code: "record-family-payload-invalid" }> {
  const decoded = Schema.decodeUnknownEither(schema, RecordExactParseOptions)(input);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({ code: "record-family-payload-invalid" as const }))
    : Either.right(decoded.right);
}
