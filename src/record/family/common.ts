import { Either, Schema } from "effect";
import { RecordExactParseOptions } from "../codec/core.ts";

/** Shared current payload envelope; individual families tighten it only when their contract requires it. */
export const FixedAttachmentValueLimits = Object.freeze({
  maximumJsonBytes: 16 * 1024 * 1024,
  maximumDepth: 32,
  maximumNodes: 200_000,
  maximumObjectKeys: 50_000,
  maximumArrayItems: 100_000,
  maximumKeyUtf8Bytes: 256,
  maximumStringUtf8Bytes: 1024 * 1024,
});

export type FixedRecordAttachmentOwner = "run" | "attempt";

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

export const EmptyArraySchema = Schema.Tuple().pipe(
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
