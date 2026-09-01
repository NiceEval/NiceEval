import { Exit, Result, Schema } from "effect";
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
  AttemptOutcomeSchema as CurrentAttemptOutcomeSchema,
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
import {
  MEMBERSHIP_ACTIONS,
  RECORD_ATTACHMENT_ENVELOPE_FORMAT,
  RECORD_ATTACHMENT_OWNERS,
} from "../model/core.ts";
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
  readonly ownerKind: RecordAttachmentEnvelope["ownerKind"];
  readonly family: string;
  readonly schemaVersion: number;
  readonly payload: { readonly sha256: string; readonly byteLength: number };
  readonly contents: readonly {
    readonly key: string;
    readonly sha256: string;
    readonly byteLength: number;
  }[];
  readonly references: readonly { readonly owner: RecordAttachmentEnvelope["ownerKind"]; readonly family: string }[];
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

export const ATTEMPT_PUBLICATION_CLOSURE_FORMAT = "niceeval.attempt-publication-closure/v1" as const;
const CurrentAttemptPublicationClosureSchema = Schema.Struct({
  format: Schema.Literal(ATTEMPT_PUBLICATION_CLOSURE_FORMAT),
  originRun: RunDocumentSchema,
});
const LegacyAttemptPublicationClosureSchema = Schema.Struct({ originRun: RunDocumentSchema });
export const AttemptPublicationClosureSchema = Schema.Union([
  CurrentAttemptPublicationClosureSchema,
  LegacyAttemptPublicationClosureSchema,
]);
export type AttemptPublicationClosure = Schema.Schema.Type<typeof AttemptPublicationClosureSchema>;
type EncodedRunDocument = Schema.Codec.Encoded<typeof RunDocumentSchema>;
const decodeClosure = Schema.decodeUnknownResult(AttemptPublicationClosureSchema, {
  errors: "all",
  onExcessProperty: "error",
});

export function attemptPublicationClosure(originRun: EncodedRunDocument): {
  readonly format: typeof ATTEMPT_PUBLICATION_CLOSURE_FORMAT;
  readonly originRun: EncodedRunDocument;
} {
  return Object.freeze({ format: ATTEMPT_PUBLICATION_CLOSURE_FORMAT, originRun });
}

export function decodeAttemptPublicationClosure(input: unknown): Result.Result<AttemptPublicationClosure, unknown> {
  return decodeClosure(input);
}

/** These small domain literals are composition helpers, not durable codec truth sources. */
export const AttemptOutcomeSchema = CurrentAttemptOutcomeSchema;
export const MembershipActionSchema: Schema.Schema<MembershipAction> = Schema.Literals(MEMBERSHIP_ACTIONS);

const NonNegativeSafeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
);

const PositiveSafeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0)),
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
  owner: Schema.Literals(RECORD_ATTACHMENT_OWNERS),
  family: Schema.String.pipe(Schema.check(Schema.makeFilter(isRecordAttachmentName))),
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

export const RecordAttachmentEnvelopeSchema: Schema.Codec<
  RecordAttachmentEnvelope,
  RecordAttachmentEnvelopeEncoded
> = Schema.Struct({
  format: Schema.Literals([RECORD_ATTACHMENT_ENVELOPE_FORMAT]),
  ownerKind: Schema.Literals(RECORD_ATTACHMENT_OWNERS),
  family: Schema.String.pipe(Schema.check(Schema.makeFilter(isRecordAttachmentName))),
  schemaVersion: PositiveSafeIntegerSchema,
  payload: RecordAttachmentBytePointerSchema,
  contents: Schema.Array(RecordAttachmentContentPointerSchema),
  references: Schema.Array(RecordAttachmentReferenceSchema),
}).pipe(Schema.check(Schema.makeFilter(canonicalEnvelopeCollections)));

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
): Result.Result<Value, RecordCodecError> {
  const decoded = definition.decode(input);
  return Result.isFailure(decoded)
    ? Result.fail(failureFromSchemaCodec(document, decoded.failure))
    : Result.succeed(decoded.success);
}

function isRecordJsonObject(value: RecordJson): value is RecordJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeDefinition<Value>(
  document: RecordCodecDocument,
  definition: Pick<RecordSchemaCodec<Value>, "encode">,
  value: Value,
): Result.Result<RecordJsonObject, RecordCodecError> {
  const encoded = definition.encode(value);
  if (Result.isFailure(encoded)) return Result.fail(failureFromSchemaCodec(document, encoded.failure));
  return isRecordJsonObject(encoded.success)
    ? Result.succeed(encoded.success)
    : Result.fail(schemaFailure(document));
}

/** Current Core codecs are thin adapters over the current definition declarations. */
export function decodeRecordDocument(input: unknown): Result.Result<RecordDocument, RecordCodecError> {
  return decodeDefinition("record", RecordDocumentDefinition, input);
}

export function encodeRecordDocument(
  value: RecordDocument,
): Result.Result<RecordDocumentEncoded, RecordCodecError> {
  return encodeDefinition("record", RecordDocumentDefinition, value);
}

export function decodeRunDocument(input: unknown): Result.Result<RunDocument, RecordCodecError> {
  return decodeDefinition("run", RunDocumentDefinition, input);
}

export function encodeRunDocument(
  value: RunDocument,
): Result.Result<RunDocumentEncoded, RecordCodecError> {
  return encodeDefinition("run", RunDocumentDefinition, value);
}

export function decodeMemberDocument(input: unknown): Result.Result<MemberDocument, RecordCodecError> {
  return Result.map(
    decodeDefinition("member", MemberDocumentDefinition, input),
    (value) => value as MemberDocument,
  );
}

export function encodeMemberDocument(
  value: MemberDocument,
): Result.Result<MemberDocumentEncoded, RecordCodecError> {
  return encodeDefinition("member", MemberDocumentDefinition, value);
}

export function decodeAttemptDocument(input: unknown): Result.Result<AttemptDocument, RecordCodecError> {
  return decodeDefinition("attempt", AttemptDocumentDefinition, input);
}

export function encodeAttemptDocument(
  value: AttemptDocument,
): Result.Result<AttemptDocumentEncoded, RecordCodecError> {
  return encodeDefinition("attempt", AttemptDocumentDefinition, value);
}

export function decodeRecordCore(input: unknown): Result.Result<RecordCore, RecordCodecError> {
  return decodeDefinition("record-core", RecordCoreDefinition, input);
}

export function encodeRecordCore(value: RecordCore): Result.Result<RecordCoreEncoded, RecordCodecError> {
  return encodeDefinition("record-core", RecordCoreDefinition, value);
}

/** Fixed-family migration is intentionally outside this current-Core implementation turn. */
export function decodeRecordAttachmentEnvelope(
  input: unknown,
): Result.Result<RecordAttachmentEnvelope, RecordCodecError> {
  const decoded = Schema.decodeUnknownExit(
    RecordAttachmentEnvelopeSchema,
    RecordExactParseOptions,
  )(input);
  return Exit.isFailure(decoded)
    ? Result.fail(schemaFailure("attachment-envelope"))
    : Result.succeed(decoded.value);
}

export function encodeRecordAttachmentEnvelope(
  value: RecordAttachmentEnvelope,
): Result.Result<RecordAttachmentEnvelopeEncoded, RecordCodecError> {
  const encoded = Schema.encodeUnknownExit(
    RecordAttachmentEnvelopeSchema,
    RecordExactParseOptions,
  )(value);
  return Exit.isFailure(encoded)
    ? Result.fail(schemaFailure("attachment-envelope"))
    : Result.succeed(encoded.value);
}
