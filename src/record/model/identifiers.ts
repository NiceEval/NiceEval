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

export const RECORD_FORMAT_V1 = "niceeval.record/v1" as const;

export type RecordFormatV1 =
  typeof RECORD_FORMAT_V1 & Brand.Brand<typeof RECORD_FORMAT_ID_BRAND>;

const PORTABLE_SEGMENT_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,253}[A-Za-z0-9])?$/;
const WINDOWS_RESERVED_SEGMENT_PATTERN =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const RECORD_ATTACHMENT_LABEL =
  "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const RECORD_ATTACHMENT_NAME_PATTERN = new RegExp(
  `^(?:${RECORD_ATTACHMENT_LABEL}\\.)+${RECORD_ATTACHMENT_LABEL}$`,
);
const RECORD_ATTACHMENT_SCHEMA_ID_PATTERN = new RegExp(
  `^(${RECORD_ATTACHMENT_LABEL}(?:\\.${RECORD_ATTACHMENT_LABEL})*)/v([1-9][0-9]*)$`,
);
const RECORD_FORMAT_ID_PATTERN = /^niceeval\.record\/v[1-9][0-9]*$/;

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

/** Parses the durable `<reverse-domain-name>/vN` identity without minting a brand. */
export function parseRecordAttachmentSchemaId(
  value: string,
): RecordAttachmentSchemaIdParts | undefined {
  const match = RECORD_ATTACHMENT_SCHEMA_ID_PATTERN.exec(value);
  if (match === null) {
    return undefined;
  }
  return { name: match[1], version: match[2] };
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

export function isNiceEvalRecordAttachmentName(
  name: RecordAttachmentName,
): boolean {
  return name.startsWith("niceeval.");
}
