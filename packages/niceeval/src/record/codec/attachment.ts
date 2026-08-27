import { Exit, Result, Schema } from "effect";

import { RecordExactParseOptions } from "./core.ts";
import { RecordBlobKeySchema, Sha256DigestSchema } from "./identifiers.ts";
import { isRecordAttachmentName } from "../model/identifiers.ts";
import {
  RECORD_ATTACHMENT_FORMAT,
  type DurableRecordAttachmentEnvelope,
} from "../model/attachment.ts";
import { RECORD_ATTACHMENT_OWNERS } from "../model/core.ts";

const NonNegativeSafeInteger = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
);
const PositiveSafeInteger = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0)),
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
  owner: Schema.Literals(RECORD_ATTACHMENT_OWNERS),
  family: Schema.String.pipe(Schema.check(Schema.makeFilter(isRecordAttachmentName))),
});

/** Pre-addressed historical commit header, decoded only by maintenance. */
export interface LegacyRecordAttachmentHeader {
  readonly family: string;
  readonly schemaVersion: number;
}

const LegacyRecordAttachmentHeaderSchema = Schema.Struct({
  family: Schema.String.pipe(Schema.check(Schema.makeFilter(isRecordAttachmentName))),
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
  format: Schema.Literals([RECORD_ATTACHMENT_FORMAT]),
  ownerKind: Schema.Literals(RECORD_ATTACHMENT_OWNERS),
  family: Schema.String.pipe(Schema.check(Schema.makeFilter(isRecordAttachmentName))),
  revision: PositiveSafeInteger,
  payload: Pointer,
  contents: Schema.Array(ContentPointer),
  references: Schema.Array(Reference),
}).pipe(Schema.check(Schema.makeFilter(canonicalCollections)));

export function decodeDurableRecordAttachmentEnvelope(
  input: unknown,
): Result.Result<DurableRecordAttachmentEnvelope, { readonly code: "record-attachment-envelope-invalid" }> {
  const decoded = Schema.decodeUnknownExit(
    DurableRecordAttachmentEnvelopeSchema,
    RecordExactParseOptions,
  )(input);
  return Exit.isFailure(decoded)
    ? Result.fail(Object.freeze({ code: "record-attachment-envelope-invalid" as const }))
    : Result.succeed(decoded.value);
}

export function encodeDurableRecordAttachmentEnvelope(
  input: DurableRecordAttachmentEnvelope,
): Result.Result<unknown, { readonly code: "record-attachment-envelope-invalid" }> {
  const encoded = Schema.encodeUnknownExit(
    DurableRecordAttachmentEnvelopeSchema,
    RecordExactParseOptions,
  )(input);
  return Exit.isFailure(encoded)
    ? Result.fail(Object.freeze({ code: "record-attachment-envelope-invalid" as const }))
    : Result.succeed(encoded.value);
}

export function decodeLegacyRecordAttachmentHeader(
  input: unknown,
): Result.Result<LegacyRecordAttachmentHeader, { readonly code: "record-attachment-envelope-invalid" }> {
  const decoded = Schema.decodeUnknownExit(
    LegacyRecordAttachmentHeaderSchema,
    RecordExactParseOptions,
  )(input);
  return Exit.isFailure(decoded)
    ? Result.fail(Object.freeze({ code: "record-attachment-envelope-invalid" as const }))
    : Result.succeed(decoded.value);
}
