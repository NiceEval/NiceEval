import { Schema } from "effect";

/** Attachment-local data and closure failures for the closed fixed catalog. */
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
  "record-attachment-blob-budget-exceeded",
  "record-attachment-materialized-invalid",
  "record-attachment-family-invalid",
);

export type RecordAttachmentIssueCode = Schema.Schema.Type<typeof RecordAttachmentIssueCodeSchema>;

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
  return first === undefined ? undefined : Object.freeze([first, ...rest]);
}

function nonEmptyOrInvariant(issues: readonly RecordAttachmentIssue[]): NonEmptyRecordAttachmentIssues {
  const result = nonEmptyRecordAttachmentIssues(issues);
  if (result === undefined) throw new Error("RecordAttachment error requires at least one issue");
  return result;
}

export type RecordAttachmentDefinitionError =
  | { readonly code: "record-attachment-name-invalid"; readonly name: string }
  | { readonly code: "record-attachment-schema-id-invalid"; readonly schemaId: string }
  | { readonly code: "record-attachment-definition-invalid"; readonly issues: NonEmptyRecordAttachmentIssues };

export interface RecordAttachmentPayloadInvalid {
  readonly code: "record-attachment-payload-invalid";
  readonly issues: NonEmptyRecordAttachmentIssues;
}

export interface RecordAttachmentClosureInvalid {
  readonly code: "record-attachment-closure-invalid";
  readonly issues: NonEmptyRecordAttachmentIssues;
}

/**
 * Stable failures of the registry-free Attachment SPI. Callback causes stay on
 * the in-memory failure and must not be serialized into a Record envelope.
 */
export type RecordAttachmentSpiFailure =
  | {
      readonly code: "invalid-family-definition";
      readonly cause?: unknown;
    }
  | {
      readonly code: "duplicate-family";
      readonly owner: "run" | "attempt";
      readonly family: string;
    }
  | {
      readonly code: "owner-mismatch";
      readonly expected: "run" | "attempt";
      readonly actual: "run" | "attempt";
    }
  | {
      readonly code: "exact-decode-failed";
      readonly cause?: unknown;
    }
  | {
      readonly code: "invariant-failed";
      readonly issues: NonEmptyRecordAttachmentIssues;
      readonly cause?: unknown;
    }
  | {
      readonly code: "content-closure-failed";
      readonly issues?: NonEmptyRecordAttachmentIssues;
      readonly cause?: unknown;
    }
  | {
      readonly code: "reference-closure-failed";
      readonly cause?: unknown;
    }
  | {
      readonly code: "resource-budget-exceeded";
      readonly resource: "value" | "content" | "reference";
      readonly cause?: unknown;
    }
  | {
      readonly code: "migration-chain-invalid";
      readonly cause?: unknown;
    }
  | {
      readonly code: "migration-step-failed";
      readonly from: number;
      readonly to: number;
      readonly cause: unknown;
    };

/** Synchronous declaration factories fail before a catalog can gain authority. */
export class RecordAttachmentSpiDefinitionError extends Error {
  constructor(
    readonly code: "invalid-family-definition" | "migration-chain-invalid" =
      "invalid-family-definition",
    readonly cause?: unknown,
  ) {
    super(
      code === "migration-chain-invalid"
        ? "Invalid Record Attachment migration chain"
        : "Invalid Record Attachment family definition",
      { cause },
    );
    this.name = "RecordAttachmentSpiDefinitionError";
  }
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
