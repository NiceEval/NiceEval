import { Either, Schema } from "effect";
import {
  nonEmptyRecordIssues,
  recordCodecError,
  recordIssue,
  type RecordCodecDocument,
  type RecordCodecError,
  type RecordIssue,
} from "../errors/record-errors.ts";
import type {
  AttemptDocumentV1,
  MemberDocumentV1,
  RecordAttachmentEnvelopeV1,
  RecordAttemptRef,
  RecordCoreV1,
  RecordDocumentV1,
  RunCoreV1,
  RunDocumentV1,
} from "../model/core.ts";
import {
  validateRecordAttachmentEnvelopeV1,
  validateRecordCoreV1,
  validateRunDocumentV1,
} from "../model/validation.ts";
import {
  AttemptIdSchema,
  RecordAttachmentNameSchema,
  RecordAttachmentSchemaIdSchema,
  RecordFormatV1Schema,
  RecordIdSchema,
  RunIdSchema,
  SlotIdSchema,
  UtcMillisSchema,
} from "./identifiers.ts";

/** All durable Record document codecs must aggregate failures and reject extras. */
export const RecordExactParseOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

export interface RecordDocumentV1Encoded {
  readonly format: "niceeval.record/v1";
  readonly recordId: string;
}

export interface RunDocumentV1Encoded {
  readonly runId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly expectedSlots: readonly string[];
}

export interface RecordAttemptRefEncoded {
  readonly originRunId: string;
  readonly attemptId: string;
}

export interface MemberDocumentV1Encoded {
  readonly slotId: string;
  readonly attempt: RecordAttemptRefEncoded;
}

export interface AttemptDocumentV1Encoded {
  readonly attemptId: string;
  readonly originRunId: string;
}

export interface RecordAttachmentEnvelopeV1Encoded {
  readonly name: string;
  readonly schemaId: string;
}

export interface RunCoreV1Encoded {
  readonly run: RunDocumentV1Encoded;
  readonly members: readonly MemberDocumentV1Encoded[];
  readonly attempts: readonly AttemptDocumentV1Encoded[];
}

export interface RecordCoreV1Encoded {
  readonly record: RecordDocumentV1Encoded;
  readonly runs: readonly RunCoreV1Encoded[];
}

export const RecordAttemptRefSchema: Schema.Schema<
  RecordAttemptRef,
  RecordAttemptRefEncoded
> = Schema.Struct({
  originRunId: RunIdSchema,
  attemptId: AttemptIdSchema,
});

export const RecordDocumentV1Schema: Schema.Schema<
  RecordDocumentV1,
  RecordDocumentV1Encoded
> = Schema.Struct({
  format: RecordFormatV1Schema,
  recordId: RecordIdSchema,
});

export const RunDocumentV1Schema: Schema.Schema<
  RunDocumentV1,
  RunDocumentV1Encoded
> = Schema.Struct({
  runId: RunIdSchema,
  startedAt: UtcMillisSchema,
  completedAt: UtcMillisSchema,
  expectedSlots: Schema.Array(SlotIdSchema),
});

export const MemberDocumentV1Schema: Schema.Schema<
  MemberDocumentV1,
  MemberDocumentV1Encoded
> = Schema.Struct({
  slotId: SlotIdSchema,
  attempt: RecordAttemptRefSchema,
});

export const AttemptDocumentV1Schema: Schema.Schema<
  AttemptDocumentV1,
  AttemptDocumentV1Encoded
> = Schema.Struct({
  attemptId: AttemptIdSchema,
  originRunId: RunIdSchema,
});

export const RecordAttachmentEnvelopeV1Schema: Schema.Schema<
  RecordAttachmentEnvelopeV1,
  RecordAttachmentEnvelopeV1Encoded
> = Schema.Struct({
  name: RecordAttachmentNameSchema,
  schemaId: RecordAttachmentSchemaIdSchema,
});

export const RunCoreV1Schema: Schema.Schema<RunCoreV1, RunCoreV1Encoded> =
  Schema.Struct({
    run: RunDocumentV1Schema,
    members: Schema.Array(MemberDocumentV1Schema),
    attempts: Schema.Array(AttemptDocumentV1Schema),
  });

export const RecordCoreV1Schema: Schema.Schema<
  RecordCoreV1,
  RecordCoreV1Encoded
> = Schema.Struct({
  record: RecordDocumentV1Schema,
  runs: Schema.Array(RunCoreV1Schema),
});

function schemaFailure(
  document: RecordCodecDocument,
): RecordCodecError {
  return recordCodecError({
    code: "record-schema-invalid",
    document,
    issues: [recordIssue("record-schema-invalid")],
  });
}

function invariantFailure(
  document: RecordCodecDocument,
  issues: readonly RecordIssue[],
): RecordCodecError {
  const nonEmpty = nonEmptyRecordIssues(issues);
  if (nonEmpty === undefined) {
    throw new Error("Record codec invariant failure requires at least one issue");
  }
  return recordCodecError({
    code: "record-invariant-invalid",
    document,
    issues: nonEmpty,
  });
}

function decodeExact<A, I>(
  document: RecordCodecDocument,
  schema: Schema.Schema<A, I>,
  input: unknown,
  validate: (value: A) => readonly RecordIssue[],
): Either.Either<A, RecordCodecError> {
  const decoded = Schema.decodeUnknownEither(schema, RecordExactParseOptions)(input);
  if (Either.isLeft(decoded)) {
    return Either.left(schemaFailure(document));
  }
  const issues = validate(decoded.right);
  return issues.length === 0
    ? Either.right(decoded.right)
    : Either.left(invariantFailure(document, issues));
}

function encodeExact<A, I>(
  document: RecordCodecDocument,
  schema: Schema.Schema<A, I>,
  value: A,
  validate: (value: A) => readonly RecordIssue[],
): Either.Either<I, RecordCodecError> {
  const issues = validate(value);
  if (issues.length > 0) {
    return Either.left(invariantFailure(document, issues));
  }
  const encoded = Schema.encodeUnknownEither(schema, RecordExactParseOptions)(value);
  return Either.isLeft(encoded)
    ? Either.left(schemaFailure(document))
    : Either.right(encoded.right);
}

export function decodeRecordDocumentV1(
  input: unknown,
): Either.Either<RecordDocumentV1, RecordCodecError> {
  return decodeExact("record", RecordDocumentV1Schema, input, () => []);
}

export function encodeRecordDocumentV1(
  value: RecordDocumentV1,
): Either.Either<RecordDocumentV1Encoded, RecordCodecError> {
  return encodeExact("record", RecordDocumentV1Schema, value, () => []);
}

export function decodeRunDocumentV1(
  input: unknown,
): Either.Either<RunDocumentV1, RecordCodecError> {
  return decodeExact("run", RunDocumentV1Schema, input, validateRunDocumentV1);
}

export function encodeRunDocumentV1(
  value: RunDocumentV1,
): Either.Either<RunDocumentV1Encoded, RecordCodecError> {
  return encodeExact("run", RunDocumentV1Schema, value, validateRunDocumentV1);
}

export function decodeMemberDocumentV1(
  input: unknown,
): Either.Either<MemberDocumentV1, RecordCodecError> {
  return decodeExact("member", MemberDocumentV1Schema, input, () => []);
}

export function encodeMemberDocumentV1(
  value: MemberDocumentV1,
): Either.Either<MemberDocumentV1Encoded, RecordCodecError> {
  return encodeExact("member", MemberDocumentV1Schema, value, () => []);
}

export function decodeAttemptDocumentV1(
  input: unknown,
): Either.Either<AttemptDocumentV1, RecordCodecError> {
  return decodeExact("attempt", AttemptDocumentV1Schema, input, () => []);
}

export function encodeAttemptDocumentV1(
  value: AttemptDocumentV1,
): Either.Either<AttemptDocumentV1Encoded, RecordCodecError> {
  return encodeExact("attempt", AttemptDocumentV1Schema, value, () => []);
}

export function decodeRecordAttachmentEnvelopeV1(
  input: unknown,
): Either.Either<RecordAttachmentEnvelopeV1, RecordCodecError> {
  return decodeExact(
    "attachment-envelope",
    RecordAttachmentEnvelopeV1Schema,
    input,
    validateRecordAttachmentEnvelopeV1,
  );
}

export function encodeRecordAttachmentEnvelopeV1(
  value: RecordAttachmentEnvelopeV1,
): Either.Either<RecordAttachmentEnvelopeV1Encoded, RecordCodecError> {
  return encodeExact(
    "attachment-envelope",
    RecordAttachmentEnvelopeV1Schema,
    value,
    validateRecordAttachmentEnvelopeV1,
  );
}

export function decodeRecordCoreV1(
  input: unknown,
): Either.Either<RecordCoreV1, RecordCodecError> {
  return decodeExact("record-core", RecordCoreV1Schema, input, validateRecordCoreV1);
}

export function encodeRecordCoreV1(
  value: RecordCoreV1,
): Either.Either<RecordCoreV1Encoded, RecordCodecError> {
  return encodeExact("record-core", RecordCoreV1Schema, value, validateRecordCoreV1);
}
