import { Schema } from "effect";

export const RecordIssueCodeSchema = Schema.Literal(
  "record-schema-invalid",
  "record-run-time-order-invalid",
  "record-expected-slot-order-invalid",
  "record-expected-slot-duplicate",
  "record-run-duplicate",
  "record-member-slot-duplicate",
  "record-member-slot-unexpected",
  "record-attempt-duplicate",
  "record-attempt-owner-invalid",
  "record-attempt-reference-missing",
  "record-origin-member-missing",
  "record-origin-member-duplicate",
  "record-attachment-schema-id-mismatch",
);

export type RecordIssueCode = Schema.Schema.Type<typeof RecordIssueCodeSchema>;

/** A portable, bounded explanation of a malformed Core or Attachment envelope. */
export interface RecordIssue {
  readonly code: RecordIssueCode;
  readonly path: readonly string[];
}

export const RecordIssueSchema: Schema.Schema<RecordIssue> = Schema.Struct({
  code: RecordIssueCodeSchema,
  path: Schema.Array(Schema.String),
});

export type NonEmptyRecordIssues = readonly [
  RecordIssue,
  ...RecordIssue[],
];

export const NonEmptyRecordIssuesSchema: Schema.Schema<NonEmptyRecordIssues> =
  Schema.NonEmptyArray(RecordIssueSchema);

export function recordIssue(
  code: RecordIssueCode,
  path: readonly string[] = [],
): RecordIssue {
  return Object.freeze({ code, path: Object.freeze([...path]) });
}

export function nonEmptyRecordIssues(
  issues: readonly RecordIssue[],
): NonEmptyRecordIssues | undefined {
  const [first, ...rest] = issues;
  return first === undefined ? undefined : [first, ...rest];
}

export const RecordCodecDocumentSchema = Schema.Literal(
  "record",
  "run",
  "member",
  "attempt",
  "attachment-envelope",
  "record-core",
);

export type RecordCodecDocument = Schema.Schema.Type<
  typeof RecordCodecDocumentSchema
>;

export const RecordCodecErrorCodeSchema = Schema.Literal(
  "record-schema-invalid",
  "record-invariant-invalid",
);

export type RecordCodecErrorCode = Schema.Schema.Type<
  typeof RecordCodecErrorCodeSchema
>;

/** Stable failure returned by exact Schema codecs before any filesystem access. */
export class RecordCodecError extends Schema.TaggedError<RecordCodecError>(
  "@niceeval/record/RecordCodecError",
)("RecordCodecError", {
  code: RecordCodecErrorCodeSchema,
  document: RecordCodecDocumentSchema,
  issues: NonEmptyRecordIssuesSchema,
}) {}

export interface RecordCodecErrorInput {
  readonly code: RecordCodecErrorCode;
  readonly document: RecordCodecDocument;
  readonly issues: NonEmptyRecordIssues;
}

export function recordCodecError(
  input: RecordCodecErrorInput,
): RecordCodecError {
  return RecordCodecError.make(input);
}

/** Stable typed error used when a writer cannot publish malformed Core. */
export class RecordCoreInvalid extends Schema.TaggedError<RecordCoreInvalid>(
  "@niceeval/record/RecordCoreInvalid",
)("RecordCoreInvalid", {
  code: Schema.Literal("record-core-invalid"),
  issues: NonEmptyRecordIssuesSchema,
}) {}

/** Stable typed error used when a reference is not from the frozen view. */
export class RecordReferenceInvalid extends Schema.TaggedError<RecordReferenceInvalid>(
  "@niceeval/record/RecordReferenceInvalid",
)("RecordReferenceInvalid", {
  code: Schema.Literal("record-reference-invalid"),
}) {}

/** Stable typed error used when a writer receives an invalid Attachment envelope. */
export class RecordAttachmentEnvelopeInvalid extends Schema.TaggedError<RecordAttachmentEnvelopeInvalid>(
  "@niceeval/record/RecordAttachmentEnvelopeInvalid",
)("RecordAttachmentEnvelopeInvalid", {
  code: Schema.Literal("record-attachment-envelope-invalid"),
  issues: NonEmptyRecordIssuesSchema,
}) {}

export type RecordPureError =
  | RecordCodecError
  | RecordCoreInvalid
  | RecordReferenceInvalid
  | RecordAttachmentEnvelopeInvalid;
