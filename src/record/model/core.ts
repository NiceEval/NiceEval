import type {
  AttemptId,
  RecordAttachmentName,
  RecordAttachmentSchemaId,
  RecordFormatV1,
  RecordId,
  RunId,
  SlotId,
  UtcMillis,
} from "./identifiers.ts";

/** The exact contents of `record.json` for the current Record major. */
export interface RecordDocumentV1 {
  readonly format: RecordFormatV1;
  readonly recordId: RecordId;
}

/** The exact contents of one published Run's `run.json`. */
export interface RunDocumentV1 {
  readonly runId: RunId;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly SlotId[];
}

/** An exact reference to an Attempt at its immutable origin. */
export interface RecordAttemptRef {
  readonly originRunId: RunId;
  readonly attemptId: AttemptId;
}

/** The exact contents of `members/<SlotId>.json`. */
export interface MemberDocumentV1 {
  readonly slotId: SlotId;
  readonly attempt: RecordAttemptRef;
}

/** The exact contents of `attempts/<AttemptId>/attempt.json`. */
export interface AttemptDocumentV1 {
  readonly attemptId: AttemptId;
  readonly originRunId: RunId;
}

/** The exact contents of one Attachment's `attachment.json`. */
export interface RecordAttachmentEnvelopeV1 {
  readonly name: RecordAttachmentName;
  readonly schemaId: RecordAttachmentSchemaId;
}

export type RecordAttachmentOwner = "run" | "attempt";

/**
 * Pure aggregate used to validate cross-document Core invariants. It is not a
 * second durable document; filesystem code supplies it from one frozen view.
 */
export interface RunCoreV1 {
  readonly run: RunDocumentV1;
  readonly members: readonly MemberDocumentV1[];
  readonly attempts: readonly AttemptDocumentV1[];
}

/** A complete, already-published Record Core snapshot. */
export interface RecordCoreV1 {
  readonly record: RecordDocumentV1;
  readonly runs: readonly RunCoreV1[];
}

/**
 * NUL cannot occur in a portable ID segment, so this is an unambiguous private
 * map key for exact Run/Attempt references.
 */
export function recordAttemptReferenceKey(ref: RecordAttemptRef): string {
  return `${ref.originRunId}\u0000${ref.attemptId}`;
}
