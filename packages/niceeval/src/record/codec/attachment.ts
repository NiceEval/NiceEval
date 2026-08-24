import { Either, Schema } from "effect";

import { RecordExactParseOptions } from "./core.ts";
import { RecordBlobKeySchema, Sha256DigestSchema } from "./identifiers.ts";
import { isRecordAttachmentName } from "../model/identifiers.ts";
import {
  RECORD_ATTACHMENT_FORMAT,
  type DurableRecordAttachmentEnvelope,
} from "../model/attachment.ts";

const NonNegativeSafeInteger = Schema.JsonNumber.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value >= 0),
);
const PositiveSafeInteger = Schema.JsonNumber.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value > 0),
);
const Pointer = Schema.Struct({
  sha256: Sha256DigestSchema,
  byteLength: NonNegativeSafeInteger,
});
const ContentPointer = Schema.Struct({
  key: RecordBlobKeySchema,
  sha256: Sha256DigestSchema,
  byteLength: NonNegativeSafeInteger,
});
const Reference = Schema.Struct({
  owner: Schema.Literal("run", "attempt"),
  family: Schema.String.pipe(Schema.filter(isRecordAttachmentName)),
});

/** Pre-addressed historical commit header, decoded only by maintenance. */
export interface LegacyRecordAttachmentHeader {
  readonly family: string;
  readonly schemaVersion: number;
}

const LegacyRecordAttachmentHeaderSchema = Schema.Struct({
  family: Schema.String.pipe(Schema.filter(isRecordAttachmentName)),
  schemaVersion: PositiveSafeInteger,
});

function canonicalCollections(value: DurableRecordAttachmentEnvelope): boolean {
  let content: string | undefined;
  for (const pointer of value.contents) {
    if (content !== undefined && content >= pointer.key) return false;
    content = pointer.key;
  }
  let reference: string | undefined;
  for (const target of value.references) {
    const identity = `${target.owner}\u0000${target.family}`;
    if (reference !== undefined && reference >= identity) return false;
    reference = identity;
  }
  return true;
}

export const DurableRecordAttachmentEnvelopeSchema = Schema.Struct({
  format: Schema.Literal(RECORD_ATTACHMENT_FORMAT),
  ownerKind: Schema.Literal("run", "attempt"),
  family: Schema.String.pipe(Schema.filter(isRecordAttachmentName)),
  revision: PositiveSafeInteger,
  payload: Pointer,
  contents: Schema.Array(ContentPointer),
  references: Schema.Array(Reference),
}).pipe(Schema.filter(canonicalCollections)) as Schema.Schema<
  DurableRecordAttachmentEnvelope,
  unknown
>;

export function decodeDurableRecordAttachmentEnvelope(
  input: unknown,
): Either.Either<DurableRecordAttachmentEnvelope, { readonly code: "record-attachment-envelope-invalid" }> {
  const decoded = Schema.decodeUnknownEither(
    DurableRecordAttachmentEnvelopeSchema,
    RecordExactParseOptions,
  )(input);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({ code: "record-attachment-envelope-invalid" as const }))
    : Either.right(decoded.right);
}

export function encodeDurableRecordAttachmentEnvelope(
  input: DurableRecordAttachmentEnvelope,
): Either.Either<unknown, { readonly code: "record-attachment-envelope-invalid" }> {
  const encoded = Schema.encodeUnknownEither(
    DurableRecordAttachmentEnvelopeSchema,
    RecordExactParseOptions,
  )(input);
  return Either.isLeft(encoded)
    ? Either.left(Object.freeze({ code: "record-attachment-envelope-invalid" as const }))
    : Either.right(encoded.right);
}

export function decodeLegacyRecordAttachmentHeader(
  input: unknown,
): Either.Either<LegacyRecordAttachmentHeader, { readonly code: "record-attachment-envelope-invalid" }> {
  const decoded = Schema.decodeUnknownEither(
    LegacyRecordAttachmentHeaderSchema,
    RecordExactParseOptions,
  )(input);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({ code: "record-attachment-envelope-invalid" as const }))
    : Either.right(decoded.right);
}
