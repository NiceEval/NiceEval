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

const PortableSegmentTextSchema = Schema.String.pipe(
  Schema.filter(isPortableSegment, {
    identifier: "RecordPortableSegment",
    description:
      "an ASCII portable file-name segment without path separators or reserved device names",
  }),
);

export const RecordIdSchema: Schema.Schema<RecordId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(RECORD_ID_BRAND));

export const RunIdSchema: Schema.Schema<RunId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(RUN_ID_BRAND));

export const SlotIdSchema: Schema.Schema<SlotId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(SLOT_ID_BRAND));

export const AttemptIdSchema: Schema.Schema<AttemptId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(ATTEMPT_ID_BRAND));

const RecordDomainIdentitySchema = Schema.String.pipe(
  Schema.filter(isRecordDomainIdentity, {
    identifier: "RecordDomainIdentity",
    description: "a bounded durable identity without control characters",
  }),
);

export const ExperimentIdSchema: Schema.Schema<ExperimentId, string> =
  RecordDomainIdentitySchema.pipe(Schema.brand(EXPERIMENT_ID_BRAND));

export const EvalIdSchema: Schema.Schema<EvalId, string> =
  RecordDomainIdentitySchema.pipe(Schema.brand(EVAL_ID_BRAND));

export const ExecutionIdentityDigestSchema: Schema.Schema<
  ExecutionIdentityDigest,
  string
> = Schema.String.pipe(
  Schema.filter(isSha256Digest, {
    identifier: "ExecutionIdentityDigest",
    description: "a lowercase hexadecimal SHA-256 execution identity digest",
  }),
  Schema.brand(EXECUTION_IDENTITY_DIGEST_BRAND),
);

export const Sha256DigestSchema: Schema.Schema<Sha256Digest, string> =
  Schema.String.pipe(
    Schema.filter(isSha256Digest, {
      identifier: "Sha256Digest",
      description: "a lowercase hexadecimal SHA-256 digest",
    }),
    Schema.brand(SHA256_DIGEST_BRAND),
  );

export const SourceItemIdSchema: Schema.Schema<SourceItemId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(SOURCE_ITEM_ID_BRAND));

export const FileChangeIdSchema: Schema.Schema<FileChangeId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(FILE_CHANGE_ID_BRAND));

export const ArtifactIdSchema: Schema.Schema<ArtifactId, string> =
  PortableSegmentTextSchema.pipe(Schema.brand(ARTIFACT_ID_BRAND));

export const RecordBlobKeySchema: Schema.Schema<RecordBlobKey, string> =
  Schema.String.pipe(
    Schema.filter(isRecordBlobKey, {
      identifier: "RecordBlobKey",
      description: "an opaque portable Attachment blob key",
    }),
    Schema.brand(RECORD_BLOB_KEY_BRAND),
  );

export const SourceSegmentIdSchema: Schema.Schema<SourceSegmentId, string> =
  Schema.String.pipe(
    Schema.filter(isSourceSegmentId, {
      identifier: "SourceSegmentId",
      description: "a bounded opaque source receipt segment identity",
    }),
    Schema.brand(SOURCE_SEGMENT_ID_BRAND),
  );

export const CanonicalRunRelativePathSchema: Schema.Schema<
  CanonicalRunRelativePath,
  string
> = Schema.String.pipe(
  Schema.filter(isCanonicalRunRelativePath, {
    identifier: "CanonicalRunRelativePath",
    description: "a slash-separated portable path inside one sealed Run",
  }),
  Schema.brand(CANONICAL_RUN_RELATIVE_PATH_BRAND),
);

export const CanonicalProjectRelativePathSchema: Schema.Schema<
  CanonicalProjectRelativePath,
  string
> = Schema.String.pipe(
  Schema.filter(isCanonicalProjectRelativePath, {
    identifier: "CanonicalProjectRelativePath",
    description: "a slash-separated project-relative path without dot segments",
  }),
  Schema.brand(CANONICAL_PROJECT_RELATIVE_PATH_BRAND),
);

export const UtcMillisSchema: Schema.Schema<UtcMillis, number> =
  Schema.Number.pipe(
    Schema.filter(isUtcMillis, {
      identifier: "UtcMillis",
      description: "a non-negative JSON-safe Unix-epoch millisecond value",
    }),
    Schema.brand(UTC_MILLIS_BRAND),
  );

export const RecordAttachmentNameSchema: Schema.Schema<
  RecordAttachmentName,
  string
> = Schema.String.pipe(
  Schema.filter(isRecordAttachmentName, {
    identifier: "RecordAttachmentName",
    description: "a lowercase reverse-domain portable Attachment name",
  }),
  Schema.brand(RECORD_ATTACHMENT_NAME_BRAND),
);

export const RecordAttachmentSchemaIdSchema: Schema.Schema<
  RecordAttachmentSchemaId,
  string
> = Schema.String.pipe(
  Schema.filter(isRecordAttachmentSchemaId, {
    identifier: "RecordAttachmentSchemaId",
    description: "a RecordAttachment name followed by /vN",
  }),
  Schema.brand(RECORD_ATTACHMENT_SCHEMA_ID_BRAND),
);

export const RecordFormatIdSchema: Schema.Schema<RecordFormatId, string> =
  Schema.String.pipe(
    Schema.filter(isRecordFormatId, {
      identifier: "RecordFormatId",
      description: "the current generic Attachment Record format identity",
    }),
    Schema.brand(RECORD_FORMAT_ID_BRAND),
  );

export const RecordFormatSchema: Schema.Schema<RecordFormat, typeof RECORD_FORMAT> =
  Schema.Literal(RECORD_FORMAT).pipe(Schema.brand(RECORD_FORMAT_ID_BRAND));
