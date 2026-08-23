import { Either, Schema } from "effect";
import {
  type RecordJson,
  type RecordJsonObject,
} from "../definition/canonical.ts";
import {
  RecordSchemaParseOptions,
  type RecordSchemaCodec,
  type RecordSchemaFailure,
} from "../definition/schema-codec.ts";
import {
  nonEmptyRecordIssues,
  RecordIssueCodeSchema,
  recordCodecError,
  recordIssue,
  type RecordCodecDocument,
  type RecordCodecError,
  type RecordIssue,
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
import { RECORD_ATTACHMENT_ENVELOPE_FORMAT } from "../model/core.ts";
import { RunContextSchema } from "../model/run-context.ts";
import { isRecordAttachmentName } from "../model/identifiers.ts";
import {
  RecordBlobKeySchema,
  Sha256DigestSchema,
} from "./identifiers.ts";

/** Kept as the one exact Schema options object for nearby non-Core codecs. */
export const RecordExactParseOptions = RecordSchemaParseOptions;

export type RecordDocumentEncoded = RecordJsonObject;
export type RunDocumentEncoded = RecordJsonObject;
export type RecordSlotIdentityEncoded = RecordJsonObject;
export type RecordAttemptRefEncoded = RecordJsonObject;
export type MemberDocumentEncoded = RecordJsonObject;
export type AttemptDocumentEncoded = RecordJsonObject;
export type RunCoreEncoded = RecordJsonObject;
export type RecordCoreEncoded = RecordJsonObject;

export interface RecordAttachmentEnvelopeEncoded {
  readonly format: typeof RECORD_ATTACHMENT_ENVELOPE_FORMAT;
  readonly ownerKind: "run" | "attempt";
  readonly family: string;
  readonly schemaVersion: number;
  readonly payload: { readonly sha256: string; readonly byteLength: number };
  readonly contents: readonly {
    readonly key: string;
    readonly sha256: string;
    readonly byteLength: number;
  }[];
  readonly references: readonly { readonly owner: "run" | "attempt"; readonly family: string }[];
}

/** Keep each source Schema's exact encoded side (notably branded IDs -> string). */
export const RecordAttemptRefSchema = CurrentRecordAttemptRefSchema;
export const RecordDocumentSchema = CurrentRecordDocumentSchema;
export const RecordSlotIdentitySchema = CurrentRecordSlotIdentitySchema;
export const RunDocumentSchema = CurrentRunDocumentSchema;
export const MemberDocumentSchema = CurrentMemberDocumentSchema;
export const AttemptDocumentSchema = CurrentAttemptDocumentSchema;
export const RunCoreSchema = CurrentRunCoreSchema;
export const RecordCoreSchema = CurrentRecordCoreSchema;
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

const NonNegativeSafeIntegerSchema = Schema.JsonNumber.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value >= 0),
);

const PositiveSafeIntegerSchema = Schema.JsonNumber.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value > 0),
);

const RecordAttachmentBytePointerSchema = Schema.Struct({
  sha256: Sha256DigestSchema,
  byteLength: NonNegativeSafeIntegerSchema,
});

const RecordAttachmentContentPointerSchema = Schema.Struct({
  key: RecordBlobKeySchema,
  sha256: Sha256DigestSchema,
  byteLength: NonNegativeSafeIntegerSchema,
});

const RecordAttachmentReferenceSchema = Schema.Struct({
  owner: Schema.Literal("run", "attempt"),
  family: Schema.String.pipe(Schema.filter(isRecordAttachmentName)),
});

function canonicalEnvelopeCollections(value: RecordAttachmentEnvelope): boolean {
  let previousContent: string | undefined;
  for (const content of value.contents) {
    if (previousContent !== undefined && previousContent >= content.key) return false;
    previousContent = content.key;
  }
  let previousReference: string | undefined;
  for (const reference of value.references) {
    const key = `${reference.owner}\u0000${reference.family}`;
    if (previousReference !== undefined && previousReference >= key) return false;
    previousReference = key;
  }
  return true;
}

export const RecordAttachmentEnvelopeSchema: Schema.Schema<
  RecordAttachmentEnvelope,
  RecordAttachmentEnvelopeEncoded
> = Schema.Struct({
  format: Schema.Literal(RECORD_ATTACHMENT_ENVELOPE_FORMAT),
  ownerKind: Schema.Literal("run", "attempt"),
  family: Schema.String.pipe(Schema.filter(isRecordAttachmentName)),
  schemaVersion: PositiveSafeIntegerSchema,
  payload: RecordAttachmentBytePointerSchema,
  contents: Schema.Array(RecordAttachmentContentPointerSchema),
  references: Schema.Array(RecordAttachmentReferenceSchema),
}).pipe(Schema.filter(canonicalEnvelopeCollections));

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

function failureFromSchemaCodec(
  document: RecordCodecDocument,
  failure: RecordSchemaFailure,
): RecordCodecError {
  if (failure.kind === "schema") {
    const isIssueCode = Schema.is(RecordIssueCodeSchema);
    const issues = failure.issues.flatMap((issue): readonly RecordIssue[] => {
      if (
        issue.message === "record-schema-invalid" ||
        !isIssueCode(issue.message) ||
        issue.path.some((segment) => typeof segment === "symbol")
      ) {
        return [];
      }
      return [recordIssue(issue.message, issue.path.map(String))];
    });
    if (issues.length > 0) return invariantFailure(document, issues);
  }
  return schemaFailure(document);
}

function decodeDefinition<Value>(
  document: RecordCodecDocument,
  definition: Pick<RecordSchemaCodec<Value>, "decode">,
  input: unknown,
): Either.Either<Value, RecordCodecError> {
  const decoded = definition.decode(input);
  return Either.isLeft(decoded)
    ? Either.left(failureFromSchemaCodec(document, decoded.left))
    : Either.right(decoded.right);
}

function isRecordJsonObject(value: RecordJson): value is RecordJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeDefinition<Value>(
  document: RecordCodecDocument,
  definition: Pick<RecordSchemaCodec<Value>, "encode">,
  value: Value,
): Either.Either<RecordJsonObject, RecordCodecError> {
  const encoded = definition.encode(value);
  if (Either.isLeft(encoded)) return Either.left(failureFromSchemaCodec(document, encoded.left));
  return isRecordJsonObject(encoded.right)
    ? Either.right(encoded.right)
    : Either.left(schemaFailure(document));
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
