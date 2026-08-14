import { Either, Schema } from "effect";
import {
  RecordDefinitionParseOptions,
  type RecordJsonObject,
  type RecordPropertyMap,
  type RecordValueDefinition,
  type RecordValueFailure,
  type RecordValueLeaf,
  type RecordValueOf,
} from "../definition/index.ts";
import {
  nonEmptyRecordIssues,
  recordCodecError,
  recordIssue,
  type RecordCodecDocument,
  type RecordCodecError,
  type RecordIssue,
  RecordIssueCodeSchema,
} from "../errors/record-errors.ts";
import {
  AttemptDocumentDefinition,
  AttemptDocumentSchema as CurrentAttemptDocumentSchema,
  MemberDocumentDefinition,
  MemberDocumentSchema as CurrentMemberDocumentSchema,
  RecordAttemptRefSchema as CurrentRecordAttemptRefSchema,
  RecordCoreDefinition,
  RecordCoreSchema as CurrentRecordCoreSchema,
  RecordDocumentDefinition,
  RecordDocumentSchema as CurrentRecordDocumentSchema,
  RecordSlotIdentitySchema as CurrentRecordSlotIdentitySchema,
  RunCoreSchema as CurrentRunCoreSchema,
  RunDocumentDefinition,
  RunDocumentSchema as CurrentRunDocumentSchema,
} from "../model/definition.ts";
import type {
  AttemptDocument,
  AttemptOutcome,
  MemberDocument,
  MembershipAction,
  RecordAttachmentEnvelope,
  RecordAttemptRef,
  RecordCore,
  RecordDocument,
  RecordSlotIdentity,
  RunCore,
  RunDocument,
} from "../model/core.ts";
import { RunContextSchema } from "../model/run-context.ts";

/** Kept as the one exact Schema options object for nearby non-Core codecs. */
export const RecordExactParseOptions = RecordDefinitionParseOptions;

export type RecordDocumentEncoded = RecordJsonObject;
export type RunDocumentEncoded = RecordJsonObject;
export type RecordSlotIdentityEncoded = RecordJsonObject;
export type RecordAttemptRefEncoded = RecordJsonObject;
export type MemberDocumentEncoded = RecordJsonObject;
export type AttemptDocumentEncoded = RecordJsonObject;
export type RunCoreEncoded = RecordJsonObject;
export type RecordCoreEncoded = RecordJsonObject;

export interface RecordAttachmentEnvelopeEncoded {
  readonly family: string;
  readonly schemaVersion: number;
}

export const RecordAttemptRefSchema: Schema.Schema<RecordAttemptRef> =
  CurrentRecordAttemptRefSchema;
export const RecordDocumentSchema: Schema.Schema<RecordDocument> = CurrentRecordDocumentSchema;
export const RecordSlotIdentitySchema: Schema.Schema<RecordSlotIdentity> =
  CurrentRecordSlotIdentitySchema;
export const RunDocumentSchema: Schema.Schema<RunDocument> = CurrentRunDocumentSchema;
export const MemberDocumentSchema: Schema.Schema<MemberDocument> = CurrentMemberDocumentSchema;
export const AttemptDocumentSchema: Schema.Schema<AttemptDocument> = CurrentAttemptDocumentSchema;
export const RunCoreSchema: Schema.Schema<RunCore> = CurrentRunCoreSchema;
export const RecordCoreSchema: Schema.Schema<RecordCore> = CurrentRecordCoreSchema;
export const RunContextCurrentSchema = RunContextSchema;

/** These small domain literals are composition helpers, not durable codec truth sources. */
export const AttemptOutcomeSchema: Schema.Schema<AttemptOutcome> = Schema.Literal(
  "completed",
  "errored",
  "cancelled",
  "interrupted",
);
export const MembershipActionSchema: Schema.Schema<MembershipAction> = Schema.Literal(
  "executed",
  "carried",
  "accepted",
  "not-dispatched",
  "interrupted",
);

export const RecordAttachmentEnvelopeSchema: Schema.Schema<
  RecordAttachmentEnvelope,
  RecordAttachmentEnvelopeEncoded
> = Schema.Struct({
  family: Schema.String.pipe(Schema.minLength(1)),
  schemaVersion: Schema.Int.pipe(Schema.positive()),
});

function schemaFailure(document: RecordCodecDocument): RecordCodecError {
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

function failureFromDefinition(
  document: RecordCodecDocument,
  failure: RecordValueFailure,
): RecordCodecError {
  if (failure.kind === "refine") {
    const issues = failure.issues.map((issue) => {
      const code = Schema.decodeUnknownEither(RecordIssueCodeSchema)(issue.code);
      return Either.isLeft(code)
        ? recordIssue("record-schema-invalid", issue.path)
        : recordIssue(code.right, issue.path);
    });
    return invariantFailure(document, issues);
  }
  return schemaFailure(document);
}

function decodeDefinition<
  Properties extends RecordPropertyMap,
  Leaf extends RecordValueLeaf,
  Blob extends object,
>(
  document: RecordCodecDocument,
  definition: Pick<RecordValueDefinition<Properties, Leaf, Blob>, "decode">,
  input: unknown,
): Either.Either<RecordValueOf<Properties>, RecordCodecError> {
  const decoded = definition.decode(input);
  return Either.isLeft(decoded)
    ? Either.left(failureFromDefinition(document, decoded.left))
    : Either.right(decoded.right);
}

function encodeDefinition<
  Properties extends RecordPropertyMap,
  Leaf extends RecordValueLeaf,
  Blob extends object,
>(
  document: RecordCodecDocument,
  definition: Pick<RecordValueDefinition<Properties, Leaf, Blob>, "encode">,
  value: RecordValueOf<Properties>,
): Either.Either<RecordJsonObject, RecordCodecError> {
  const encoded = definition.encode(value);
  return Either.isLeft(encoded)
    ? Either.left(failureFromDefinition(document, encoded.left))
    : Either.right(encoded.right as RecordJsonObject);
}

function decodeExact<A, I>(
  document: RecordCodecDocument,
  schema: Schema.Schema<A, I>,
  input: unknown,
  validate: (value: A) => readonly RecordIssue[],
): Either.Either<A, RecordCodecError> {
  const decoded = Schema.decodeUnknownEither(schema, RecordExactParseOptions)(input);
  if (Either.isLeft(decoded)) return Either.left(schemaFailure(document));
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
  if (issues.length > 0) return Either.left(invariantFailure(document, issues));
  const encoded = Schema.encodeUnknownEither(schema, RecordExactParseOptions)(value);
  return Either.isLeft(encoded) ? Either.left(schemaFailure(document)) : Either.right(encoded.right);
}

/** Current Core codecs are thin adapters over the current definition declarations. */
export function decodeRecordDocument(input: unknown): Either.Either<RecordDocument, RecordCodecError> {
  return decodeDefinition("record", RecordDocumentDefinition, input);
}

export function encodeRecordDocument(
  value: RecordDocument,
): Either.Either<RecordDocumentEncoded, RecordCodecError> {
  return encodeDefinition("record", RecordDocumentDefinition, value);
}

export function decodeRunDocument(input: unknown): Either.Either<RunDocument, RecordCodecError> {
  return decodeDefinition("run", RunDocumentDefinition, input);
}

export function encodeRunDocument(
  value: RunDocument,
): Either.Either<RunDocumentEncoded, RecordCodecError> {
  return encodeDefinition("run", RunDocumentDefinition, value);
}

export function decodeMemberDocument(input: unknown): Either.Either<MemberDocument, RecordCodecError> {
  return Either.map(
    decodeDefinition("member", MemberDocumentDefinition, input),
    (value) => value as MemberDocument,
  );
}

export function encodeMemberDocument(
  value: MemberDocument,
): Either.Either<MemberDocumentEncoded, RecordCodecError> {
  return encodeDefinition("member", MemberDocumentDefinition, value);
}

export function decodeAttemptDocument(input: unknown): Either.Either<AttemptDocument, RecordCodecError> {
  return decodeDefinition("attempt", AttemptDocumentDefinition, input);
}

export function encodeAttemptDocument(
  value: AttemptDocument,
): Either.Either<AttemptDocumentEncoded, RecordCodecError> {
  return encodeDefinition("attempt", AttemptDocumentDefinition, value);
}

export function decodeRecordCore(input: unknown): Either.Either<RecordCore, RecordCodecError> {
  return decodeDefinition("record-core", RecordCoreDefinition, input);
}

export function encodeRecordCore(value: RecordCore): Either.Either<RecordCoreEncoded, RecordCodecError> {
  return encodeDefinition("record-core", RecordCoreDefinition, value);
}

/** Fixed-family migration is intentionally outside this current-Core implementation turn. */
export function decodeRecordAttachmentEnvelope(
  input: unknown,
): Either.Either<RecordAttachmentEnvelope, RecordCodecError> {
  const decoded = Schema.decodeUnknownEither(
    RecordAttachmentEnvelopeSchema,
    RecordExactParseOptions,
  )(input);
  return Either.isLeft(decoded)
    ? Either.left(schemaFailure("attachment-envelope"))
    : Either.right(decoded.right);
}

export function encodeRecordAttachmentEnvelope(
  value: RecordAttachmentEnvelope,
): Either.Either<RecordAttachmentEnvelopeEncoded, RecordCodecError> {
  const encoded = Schema.encodeUnknownEither(
    RecordAttachmentEnvelopeSchema,
    RecordExactParseOptions,
  )(value);
  return Either.isLeft(encoded)
    ? Either.left(schemaFailure("attachment-envelope"))
    : Either.right(encoded.right);
}
