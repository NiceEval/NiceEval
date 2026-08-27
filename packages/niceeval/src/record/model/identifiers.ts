import type { Brand } from "effect";

/**
 * Brand identifiers are deliberately package-local names. Their runtime values
 * remain portable strings; construction belongs to the exact codecs.
 */
export const RECORD_ID_BRAND = "@niceeval/record/RecordId" as const;
export const RUN_ID_BRAND = "@niceeval/record/RunId" as const;
export const SLOT_ID_BRAND = "@niceeval/record/SlotId" as const;
export const ATTEMPT_ID_BRAND = "@niceeval/record/AttemptId" as const;
export const UTC_MILLIS_BRAND = "@niceeval/record/UtcMillis" as const;
export const RECORD_ATTACHMENT_NAME_BRAND =
  "@niceeval/record/RecordAttachmentName" as const;
export const RECORD_ATTACHMENT_SCHEMA_ID_BRAND =
  "@niceeval/record/RecordAttachmentSchemaId" as const;
export const RECORD_FORMAT_ID_BRAND = "@niceeval/record/RecordFormatId" as const;
export const EXPERIMENT_ID_BRAND = "@niceeval/record/ExperimentId" as const;
export const EVAL_ID_BRAND = "@niceeval/record/EvalId" as const;
export const EXECUTION_IDENTITY_DIGEST_BRAND =
  "@niceeval/record/ExecutionIdentityDigest" as const;
export const SHA256_DIGEST_BRAND = "@niceeval/record/Sha256Digest" as const;
export const SOURCE_ITEM_ID_BRAND = "@niceeval/record/SourceItemId" as const;
export const FILE_CHANGE_ID_BRAND = "@niceeval/record/FileChangeId" as const;
export const ARTIFACT_ID_BRAND = "@niceeval/record/ArtifactId" as const;
export const RECORD_BLOB_KEY_BRAND =
  "@niceeval/record/RecordBlobKey" as const;
export const SOURCE_SEGMENT_ID_BRAND =
  "@niceeval/record/SourceSegmentId" as const;
export const CANONICAL_RUN_RELATIVE_PATH_BRAND =
  "@niceeval/record/CanonicalRunRelativePath" as const;
export const CANONICAL_PROJECT_RELATIVE_PATH_BRAND =
  "@niceeval/record/CanonicalProjectRelativePath" as const;

export type RecordId = string & Brand.Brand<typeof RECORD_ID_BRAND>;
export type RunId = string & Brand.Brand<typeof RUN_ID_BRAND>;
export type SlotId = string & Brand.Brand<typeof SLOT_ID_BRAND>;
export type AttemptId = string & Brand.Brand<typeof ATTEMPT_ID_BRAND>;
export type UtcMillis = number & Brand.Brand<typeof UTC_MILLIS_BRAND>;
export type RecordAttachmentName =
  string & Brand.Brand<typeof RECORD_ATTACHMENT_NAME_BRAND>;
export type RecordAttachmentSchemaId =
  string & Brand.Brand<typeof RECORD_ATTACHMENT_SCHEMA_ID_BRAND>;
export type RecordFormatId = string & Brand.Brand<typeof RECORD_FORMAT_ID_BRAND>;
/** A durable Experiment identity. It is not a host path or a display label. */
export type ExperimentId = string & Brand.Brand<typeof EXPERIMENT_ID_BRAND>;
/** A durable Eval identity. It is not reconstructed from the current worktree. */
export type EvalId = string & Brand.Brand<typeof EVAL_ID_BRAND>;
/** SHA-256 identity of the exact execution inputs/configuration for a Slot. */
export type ExecutionIdentityDigest = string & Brand.Brand<
  typeof EXECUTION_IDENTITY_DIGEST_BRAND
>;
/** A lowercase hexadecimal SHA-256 digest for recorded bytes. */
export type Sha256Digest = string & Brand.Brand<typeof SHA256_DIGEST_BRAND>;
/** An opaque identity inside one origin Run's Sources manifest. */
export type SourceItemId = string & Brand.Brand<typeof SOURCE_ITEM_ID_BRAND>;
/** An opaque identity inside one FileChanges payload. */
export type FileChangeId = string & Brand.Brand<typeof FILE_CHANGE_ID_BRAND>;
/** An opaque identity inside one Artifacts payload. */
export type ArtifactId = string & Brand.Brand<typeof ARTIFACT_ID_BRAND>;
/** Opaque portable file name for one Attachment-owned blob. */
export type RecordBlobKey = string & Brand.Brand<typeof RECORD_BLOB_KEY_BRAND>;
/** Opaque identity minted when one source receipt segment starts. */
export type SourceSegmentId = string & Brand.Brand<typeof SOURCE_SEGMENT_ID_BRAND>;
/** Slash-separated path inside one published Run directory. */
export type CanonicalRunRelativePath = string & Brand.Brand<
  typeof CANONICAL_RUN_RELATIVE_PATH_BRAND
>;
/** Slash-separated path relative to the recorded project root. */
export type CanonicalProjectRelativePath = string & Brand.Brand<
  typeof CANONICAL_PROJECT_RELATIVE_PATH_BRAND
>;

/** Current generic Attachment root identity. */
export const RECORD_FORMAT = "niceeval.record.attachments" as const;

/** Explicit-migration-only predecessor; ordinary readers never open it. */
export const LEGACY_RECORD_FORMAT = "niceeval.record.source-receipts" as const;

export type RecordFormat =
  typeof RECORD_FORMAT & Brand.Brand<typeof RECORD_FORMAT_ID_BRAND>;

const PORTABLE_SEGMENT_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,253}[A-Za-z0-9])?$/;
const WINDOWS_RESERVED_SEGMENT_PATTERN =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const RECORD_ATTACHMENT_LABEL =
  "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const RECORD_ATTACHMENT_NAME_PATTERN = new RegExp(
  `^(?:${RECORD_ATTACHMENT_LABEL}\\.)+${RECORD_ATTACHMENT_LABEL}$`,
);
const RECORD_FORMAT_ID_PATTERN = /^niceeval\.record\.attachments$/;
const SHA256_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

/**
 * A file-name segment that is safe to copy between the supported Record roots.
 * It is ASCII-only, has no platform separator, and excludes DOS device names.
 */
export function isPortableSegment(value: string): boolean {
  return (
    PORTABLE_SEGMENT_PATTERN.test(value) &&
    !WINDOWS_RESERVED_SEGMENT_PATTERN.test(value)
  );
}

/** Canonical identity ordering is ASCII code-unit ordering, never locale order. */
export function compareCanonicalIdentity(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** Unix-epoch milliseconds that can round-trip through a JSON number exactly. */
export function isUtcMillis(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Domain identity is deliberately broader than a directory segment: Eval and
 * Experiment identities may be path-derived, but portable Core never accepts
 * controls, NUL, or an unbounded display value.
 */
export function isRecordDomainIdentity(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 1_024 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function isSha256Digest(value: string): boolean {
  return SHA256_DIGEST_PATTERN.test(value);
}

export function isRecordBlobKey(value: string): boolean {
  return isPortableSegment(value);
}

export function isSourceSegmentId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

/** A portable path relative to a single sealed Run, never a host path. */
export function isCanonicalRunRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 4_096 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.includes("\\") &&
    value.split("/").every(isPortableSegment)
  );
}

/** A project-relative portable path; it is never a host filesystem path. */
export function isCanonicalProjectRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 4_096 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    value.split("/").every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    )
  );
}

/** A RecordAttachment directory name is a lowercase reverse-domain namespace. */
export function isRecordAttachmentName(value: string): boolean {
  return (
    value.length <= 255 &&
    isPortableSegment(value) &&
    RECORD_ATTACHMENT_NAME_PATTERN.test(value)
  );
}

export interface RecordAttachmentSchemaIdParts {
  readonly name: string;
  readonly version: string;
}

/**
 * Legacy internal callers still use this structural helper while the fixed
 * catalog is being materialized. The durable identity is now the stable
 * family name; its numeric version is carried separately in the envelope.
 */
export function parseRecordAttachmentSchemaId(
  value: string,
): RecordAttachmentSchemaIdParts | undefined {
  return isRecordAttachmentName(value)
    ? { name: value, version: "1" }
    : undefined;
}

export function isRecordAttachmentSchemaId(value: string): boolean {
  const parts = parseRecordAttachmentSchemaId(value);
  return parts !== undefined && isRecordAttachmentName(parts.name);
}

export function recordAttachmentNameTextOfSchemaId(
  schemaId: string,
): string | undefined {
  return parseRecordAttachmentSchemaId(schemaId)?.name;
}

export function isRecordFormatId(value: string): boolean {
  return RECORD_FORMAT_ID_PATTERN.test(value);
}

export function isRecordFormat(value: string): value is typeof RECORD_FORMAT {
  return value === RECORD_FORMAT;
}

export function isNiceEvalRecordAttachmentName(
  name: RecordAttachmentName,
): boolean {
  return name.startsWith("niceeval.");
}
