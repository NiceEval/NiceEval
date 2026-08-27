import { Schema } from "effect";
import {
  ATTEMPT_ID_BRAND,
  ARTIFACT_ID_BRAND,
  CANONICAL_RUN_RELATIVE_PATH_BRAND,
  CANONICAL_PROJECT_RELATIVE_PATH_BRAND,
  EVAL_ID_BRAND,
  EXECUTION_IDENTITY_DIGEST_BRAND,
  EXPERIMENT_ID_BRAND,
  FILE_CHANGE_ID_BRAND,
  isCanonicalRunRelativePath,
  isPortableSegment,
  isCanonicalProjectRelativePath,
  isRecordDomainIdentity,
  isRecordAttachmentName,
  isRecordAttachmentSchemaId,
  isRecordBlobKey,
  isRecordFormatId,
  isSha256Digest,
  isSourceSegmentId,
  isUtcMillis,
  RECORD_ATTACHMENT_NAME_BRAND,
  RECORD_ATTACHMENT_SCHEMA_ID_BRAND,
  RECORD_BLOB_KEY_BRAND,
  RECORD_FORMAT,
  RECORD_FORMAT_ID_BRAND,
  RECORD_ID_BRAND,
  RUN_ID_BRAND,
  SHA256_DIGEST_BRAND,
  SLOT_ID_BRAND,
  SOURCE_ITEM_ID_BRAND,
  SOURCE_SEGMENT_ID_BRAND,
  UTC_MILLIS_BRAND,
  type AttemptId,
  type ArtifactId,
  type CanonicalRunRelativePath,
  type CanonicalProjectRelativePath,
  type EvalId,
  type ExecutionIdentityDigest,
  type ExperimentId,
  type FileChangeId,
  type RecordAttachmentName,
  type RecordAttachmentSchemaId,
  type RecordBlobKey,
  type RecordFormat,
  type RecordFormatId,
  type RecordId,
  type RunId,
  type Sha256Digest,
  type SlotId,
  type SourceItemId,
  type SourceSegmentId,
  type UtcMillis,
} from "../model/identifiers.ts";

const PortableSegmentTextSchema = Schema.String.check(Schema.makeFilter(isPortableSegment, {
    identifier: "RecordPortableSegment",
    description:
      "an ASCII portable file-name segment without path separators or reserved device names",
  }));

export const RecordIdSchema: Schema.Codec<RecordId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(RECORD_ID_BRAND));

export const RunIdSchema: Schema.Codec<RunId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(RUN_ID_BRAND));

export const SlotIdSchema: Schema.Codec<SlotId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(SLOT_ID_BRAND));

export const AttemptIdSchema: Schema.Codec<AttemptId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(ATTEMPT_ID_BRAND));

const RecordDomainIdentitySchema = Schema.String.check(Schema.makeFilter(isRecordDomainIdentity, {
    identifier: "RecordDomainIdentity",
    description: "a bounded durable identity without control characters",
  }));

export const ExperimentIdSchema: Schema.Codec<ExperimentId, string> =
  RecordDomainIdentitySchema.pipe(Schema.brand(EXPERIMENT_ID_BRAND));

export const EvalIdSchema: Schema.Codec<EvalId, string> =
  RecordDomainIdentitySchema.pipe(Schema.brand(EVAL_ID_BRAND));

export const ExecutionIdentityDigestSchema: Schema.Codec<
  ExecutionIdentityDigest,
  string
> = Schema.String.check(Schema.makeFilter(isSha256Digest, {
    identifier: "ExecutionIdentityDigest",
    description: "a lowercase hexadecimal SHA-256 execution identity digest",
  })).pipe(Schema.brand(EXECUTION_IDENTITY_DIGEST_BRAND));

export const Sha256DigestSchema: Schema.Codec<Sha256Digest, string> =
  Schema.String.check(Schema.makeFilter(isSha256Digest, {
      identifier: "Sha256Digest",
      description: "a lowercase hexadecimal SHA-256 digest",
    })).pipe(Schema.brand(SHA256_DIGEST_BRAND));

export const SourceItemIdSchema: Schema.Codec<SourceItemId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(SOURCE_ITEM_ID_BRAND));

export const FileChangeIdSchema: Schema.Codec<FileChangeId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(FILE_CHANGE_ID_BRAND));

export const ArtifactIdSchema: Schema.Codec<ArtifactId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(ARTIFACT_ID_BRAND));

export const RecordBlobKeySchema: Schema.Codec<RecordBlobKey, string> =
  Schema.String.check(Schema.makeFilter(isRecordBlobKey, {
      identifier: "RecordBlobKey",
      description: "an opaque portable Attachment blob key",
    })).pipe(Schema.brand(RECORD_BLOB_KEY_BRAND));

export const SourceSegmentIdSchema: Schema.Codec<SourceSegmentId, string> =
  Schema.String.check(Schema.makeFilter(isSourceSegmentId, {
      identifier: "SourceSegmentId",
      description: "a bounded opaque source receipt segment identity",
    })).pipe(Schema.brand(SOURCE_SEGMENT_ID_BRAND));

export const CanonicalRunRelativePathSchema: Schema.Codec<
  CanonicalRunRelativePath,
  string
> = Schema.String.check(Schema.makeFilter(isCanonicalRunRelativePath, {
    identifier: "CanonicalRunRelativePath",
    description: "a slash-separated portable path inside one sealed Run",
  })).pipe(Schema.brand(CANONICAL_RUN_RELATIVE_PATH_BRAND));

export const CanonicalProjectRelativePathSchema: Schema.Codec<
  CanonicalProjectRelativePath,
  string
> = Schema.String.check(Schema.makeFilter(isCanonicalProjectRelativePath, {
    identifier: "CanonicalProjectRelativePath",
    description: "a slash-separated project-relative path without dot segments",
  })).pipe(Schema.brand(CANONICAL_PROJECT_RELATIVE_PATH_BRAND));

export const UtcMillisSchema: Schema.Codec<UtcMillis, number> =
  Schema.Number.check(Schema.makeFilter(isUtcMillis, {
      identifier: "UtcMillis",
      description: "a non-negative JSON-safe Unix-epoch millisecond value",
    })).pipe(Schema.brand(UTC_MILLIS_BRAND));

export const RecordAttachmentNameSchema: Schema.Codec<
  RecordAttachmentName,
  string
> = Schema.String.check(Schema.makeFilter(isRecordAttachmentName, {
    identifier: "RecordAttachmentName",
    description: "a lowercase reverse-domain portable Attachment name",
  })).pipe(Schema.brand(RECORD_ATTACHMENT_NAME_BRAND));

export const RecordAttachmentSchemaIdSchema: Schema.Codec<
  RecordAttachmentSchemaId,
  string
> = Schema.String.check(Schema.makeFilter(isRecordAttachmentSchemaId, {
    identifier: "RecordAttachmentSchemaId",
    description: "a RecordAttachment name followed by /vN",
  })).pipe(Schema.brand(RECORD_ATTACHMENT_SCHEMA_ID_BRAND));

export const RecordFormatIdSchema: Schema.Codec<RecordFormatId, string> =
  Schema.String.check(Schema.makeFilter(isRecordFormatId, {
      identifier: "RecordFormatId",
      description: "the current generic Attachment Record format identity",
    })).pipe(Schema.brand(RECORD_FORMAT_ID_BRAND));

export const RecordFormatSchema: Schema.Codec<RecordFormat, typeof RECORD_FORMAT> =
  Schema.Literals([RECORD_FORMAT]).pipe(Schema.brand(RECORD_FORMAT_ID_BRAND));
