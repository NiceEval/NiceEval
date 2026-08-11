import { Schema } from "effect";

/**
 * These issue codes are Attachment-local on purpose. Foundation Record errors
 * describe Core and envelope documents; definitions, closure capability, and
 * migration graph mistakes must not grow that public union.
 */
export const RecordAttachmentIssueCodeSchema = Schema.Literal(
  "record-attachment-owner-invalid",
  "record-attachment-schema-id-mismatch",
  "record-attachment-schema-invalid",
  "record-attachment-payload-invalid",
  "record-attachment-json-invalid",
  "record-attachment-blob-refs-invalid",
  "record-attachment-blob-ref-illegal",
  "record-attachment-blob-ref-missing",
  "record-attachment-blob-ref-extra",
  "record-attachment-blob-ref-duplicate",
  "record-attachment-closure-mismatch",
  "record-attachment-snapshot-bytes-invalid",
  "record-attachment-family-invalid",
  "record-attachment-migration-edge-invalid",
  "record-attachment-migration-edge-duplicate",
  "record-attachment-migration-edge-missing",
  "record-attachment-migration-edge-fork",
  "record-attachment-registry-family-duplicate",
);

export type RecordAttachmentIssueCode = Schema.Schema.Type<
  typeof RecordAttachmentIssueCodeSchema
>;

export interface RecordAttachmentIssue {
  readonly code: RecordAttachmentIssueCode;
  readonly path: readonly string[];
}

export type NonEmptyRecordAttachmentIssues = readonly [
  RecordAttachmentIssue,
  ...RecordAttachmentIssue[],
];

export function recordAttachmentIssue(
  code: RecordAttachmentIssueCode,
  path: readonly string[] = [],
): RecordAttachmentIssue {
  return Object.freeze({ code, path: Object.freeze([...path]) });
}

export function nonEmptyRecordAttachmentIssues(
  issues: readonly RecordAttachmentIssue[],
): NonEmptyRecordAttachmentIssues | undefined {
  const [first, ...rest] = issues;
  return first === undefined
    ? undefined
    : Object.freeze([first, ...rest]);
}

function nonEmptyOrInvariant(
  issues: readonly RecordAttachmentIssue[],
): NonEmptyRecordAttachmentIssues {
  const nonEmpty = nonEmptyRecordAttachmentIssues(issues);
  if (nonEmpty === undefined) {
    throw new Error("RecordAttachment error requires at least one issue");
  }
  return nonEmpty;
}

export type RecordAttachmentDefinitionError =
  | { readonly code: "record-attachment-name-invalid"; readonly name: string }
  | {
      readonly code: "record-attachment-schema-id-invalid";
      readonly schemaId: string;
    }
  | { readonly code: "niceeval-namespace-reserved"; readonly name: string }
  | {
      readonly code: "record-attachment-definition-invalid";
      readonly issues: NonEmptyRecordAttachmentIssues;
    };

export interface RecordAttachmentPayloadInvalid {
  readonly code: "record-attachment-payload-invalid";
  readonly issues: NonEmptyRecordAttachmentIssues;
}

export interface RecordAttachmentClosureInvalid {
  readonly code: "record-attachment-closure-invalid";
  readonly issues: NonEmptyRecordAttachmentIssues;
}

export interface RecordAttachmentMigrationDefinitionError {
  readonly code: "record-attachment-migration-definition-invalid";
  readonly issues: NonEmptyRecordAttachmentIssues;
}

export interface RecordAttachmentFamilyError {
  readonly code: "record-attachment-family-invalid";
  readonly issues: NonEmptyRecordAttachmentIssues;
}

export interface RecordAttachmentRegistryError {
  readonly code: "record-attachment-registry-invalid";
  readonly issues: NonEmptyRecordAttachmentIssues;
}

export function recordAttachmentDefinitionInvalid(
  issues: readonly RecordAttachmentIssue[],
): RecordAttachmentDefinitionError {
  return Object.freeze({
    code: "record-attachment-definition-invalid",
    issues: nonEmptyOrInvariant(issues),
  });
}

export function recordAttachmentPayloadInvalid(
  issues: readonly RecordAttachmentIssue[],
): RecordAttachmentPayloadInvalid {
  return Object.freeze({
    code: "record-attachment-payload-invalid",
    issues: nonEmptyOrInvariant(issues),
  });
}

export function recordAttachmentClosureInvalid(
  issues: readonly RecordAttachmentIssue[],
): RecordAttachmentClosureInvalid {
  return Object.freeze({
    code: "record-attachment-closure-invalid",
    issues: nonEmptyOrInvariant(issues),
  });
}

export function recordAttachmentMigrationDefinitionInvalid(
  issues: readonly RecordAttachmentIssue[],
): RecordAttachmentMigrationDefinitionError {
  return Object.freeze({
    code: "record-attachment-migration-definition-invalid",
    issues: nonEmptyOrInvariant(issues),
  });
}

export function recordAttachmentFamilyInvalid(
  issues: readonly RecordAttachmentIssue[],
): RecordAttachmentFamilyError {
  return Object.freeze({
    code: "record-attachment-family-invalid",
    issues: nonEmptyOrInvariant(issues),
  });
}

export function recordAttachmentRegistryInvalid(
  issues: readonly RecordAttachmentIssue[],
): RecordAttachmentRegistryError {
  return Object.freeze({
    code: "record-attachment-registry-invalid",
    issues: nonEmptyOrInvariant(issues),
  });
}
