import { Either, Schema } from "effect";
import type { ProcessReceipt } from "./process.js";

export const ShowExactParseOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

export const NonEmptyStringSchema = Schema.String.pipe(
  Schema.filter((value) => value.length > 0, {
    identifier: "ShowNonEmptyString",
    description: "a non-empty string",
  }),
);

export const CanonicalAttemptLocatorSchema = Schema.String.pipe(
  Schema.filter((value) => /^@1[0-9A-HJKMNP-TV-Z]{12}$/.test(value), {
    identifier: "CanonicalAttemptLocator",
    description: "a canonical NiceEval Attempt locator",
  }),
);

const LocalizedTextSchema = Schema.Union(
  Schema.String,
  Schema.Record({ key: NonEmptyStringSchema, value: Schema.String }).pipe(
    Schema.filter((value) => Object.keys(value).length > 0, {
      identifier: "ShowLocalizedText",
      description: "a non-empty localized text map",
    }),
  ),
);

const ShowProblemSchema = Schema.Struct({
  code: NonEmptyStringSchema,
  path: Schema.Array(NonEmptyStringSchema),
  refs: Schema.Array(NonEmptyStringSchema),
  summary: Schema.optional(NonEmptyStringSchema),
});

export const ShowAttemptEnvelopeFields = Object.freeze({
  format: Schema.Literal("niceeval.show"),
  locale: Schema.Literal("en"),
  selection: Schema.Struct({
    kind: Schema.Literal("attempt-locator"),
    sampleIdentity: NonEmptyStringSchema,
    locator: CanonicalAttemptLocatorSchema,
  }),
  report: Schema.Struct({
    token: NonEmptyStringSchema,
    identity: NonEmptyStringSchema,
  }),
  page: Schema.Struct({
    route: NonEmptyStringSchema,
    pageId: NonEmptyStringSchema,
    title: LocalizedTextSchema,
  }),
  projections: Schema.Struct({
    format: Schema.Literal("niceeval.report-projections/v1"),
    pricingProfile: Schema.Unknown,
    costs: Schema.Array(Schema.Unknown),
  }),
  problems: Schema.Array(ShowProblemSchema),
});

export function decodeShowSchema<A, I>(
  schema: Schema.Schema<A, I>,
  receipt: ProcessReceipt,
  label: string,
): A {
  const decoded = Schema.decodeUnknownEither(schema, ShowExactParseOptions)(receipt.json<unknown>());
  if (Either.isRight(decoded)) return decoded.right;
  throw new Error(`${label}: invalid niceeval.show document\n${String(decoded.left)}\n\n${receipt.diagnostic()}`);
}
