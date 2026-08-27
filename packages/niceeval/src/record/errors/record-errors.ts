import { Schema } from "effect";

export const RecordIssueCodeSchema = Schema.Literals([
  "record-schema-invalid",
  "record-run-time-order-invalid",
  "record-run-context-invalid",
  "record-run-context-size-exceeded",
  "record-run-context-experiment-mismatch",
  "record-run-order-invalid",
  "record-expected-slot-order-invalid",
  "record-expected-slot-duplicate",
  "record-run-duplicate",
  "record-member-slot-order-invalid",
  "record-member-slot-duplicate",
  "record-member-slot-unexpected",
  "record-member-slot-missing",
  "record-member-action-invalid",
  "record-attempt-order-invalid",
  "record-attempt-duplicate",
  "record-attempt-owner-invalid",
  "record-attempt-slot-unexpected",
  "record-attempt-slot-mismatch",
  "record-attempt-eval-mismatch",
  "record-attempt-digest-mismatch",
  "record-attempt-reference-missing",
  "record-origin-member-missing",
  "record-origin-member-duplicate",
  "record-attachment-schema-id-mismatch",
  "record-fixed-family-owner-invalid",
]);

export type RecordIssueCode = Schema.Schema.Type<typeof RecordIssueCodeSchema>;

/** A portable, bounded explanation of a malformed Core or Attachment envelope. */
export interface RecordIssue {
  readonly code: RecordIssueCode;
  readonly path: readonly string[];
}

export const RecordIssueSchema: Schema.Codec<RecordIssue> = Schema.Struct({
  code: RecordIssueCodeSchema,
  path: Schema.Array(Schema.String),
});

export type NonEmptyRecordIssues = readonly [
  RecordIssue,
  ...RecordIssue[],
];

export const NonEmptyRecordIssuesSchema: Schema.Codec<NonEmptyRecordIssues> =
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
  if (first === undefined) {
    return undefined;
  }
  const tuple: [RecordIssue, ...RecordIssue[]] = [first, ...rest];
  return Object.freeze(tuple);
}

export const RecordCodecDocumentSchema = Schema.Literals([
  "record",
  "run",
  "member",
  "attempt",
  "attachment-envelope",
  "record-core",
]);

export type RecordCodecDocument = Schema.Schema.Type<
  typeof RecordCodecDocumentSchema
>;

export const RecordCodecErrorCodeSchema = Schema.Literals([
  "record-schema-invalid",
  "record-invariant-invalid",
]);

export type RecordCodecErrorCode = Schema.Schema.Type<
  typeof RecordCodecErrorCodeSchema
>;

/** Stable failure returned by exact Schema codecs before filesystem access. */
export class RecordCodecError extends Schema.TaggedError<RecordCodecError>()("RecordCodecError", {
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
export class RecordCoreInvalid extends Schema.TaggedError<RecordCoreInvalid>()("RecordCoreInvalid", {
  code: Schema.Literal("record-core-invalid"),
  issues: NonEmptyRecordIssuesSchema,
}) {}

/** Stable typed error used when a reference is not from the frozen view. */
export class RecordReferenceInvalid extends Schema.TaggedError<RecordReferenceInvalid>()("RecordReferenceInvalid", {
  code: Schema.Literal("record-reference-invalid"),
}) {}

/** Stable typed error used when a writer receives an invalid Attachment envelope. */
export class RecordAttachmentEnvelopeInvalid extends Schema.TaggedError<RecordAttachmentEnvelopeInvalid>()("RecordAttachmentEnvelopeInvalid", {
  code: Schema.Literal("record-attachment-envelope-invalid"),
  issues: NonEmptyRecordIssuesSchema,
}) {}

export type RecordPureError =
  | RecordCodecError
  | RecordCoreInvalid
  | RecordReferenceInvalid
  | RecordAttachmentEnvelopeInvalid;
