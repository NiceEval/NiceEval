import type {
  AttemptId,
  EvalId,
  ExecutionIdentityDigest,
  ExperimentId,
  RecordFormat,
  RecordBlobKey,
  RecordId,
  RunId,
  Sha256Digest,
  SlotId,
  UtcMillis,
} from "./identifiers.ts";
import type { RunContext } from "./run-context.ts";

/** The versionless root header; a future incompatible root uses a new format identity. */
export interface RecordDocument {
  readonly format: RecordFormat;
  readonly recordId: RecordId;
}

/** An exact reference to an immutable origin Attempt. */
export interface RecordAttemptRef {
  readonly originRunId: RunId;
  readonly attemptId: AttemptId;
}

/** The terminal execution fact required to interpret an origin Attempt. */
export const ATTEMPT_OUTCOMES = ["completed", "errored", "cancelled", "interrupted"] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/** The immutable final action for one planned denominator Slot. */
export const MEMBERSHIP_ACTIONS = ["executed", "carried", "accepted", "not-dispatched", "interrupted"] as const;
export type MembershipAction = (typeof MEMBERSHIP_ACTIONS)[number];
export const MEMBERSHIP_ACTIONS_WITH_ATTEMPT = ["executed", "carried", "accepted"] as const;
export const MEMBERSHIP_ACTIONS_WITHOUT_ATTEMPT = ["not-dispatched", "interrupted"] as const;

/** Exact planned identity; its existing digest remains the only execution identity. */
export interface RecordSlotIdentity {
  readonly slotId: SlotId;
  readonly evalId: EvalId;
  /** Zero-based planned attempt identity; never inferred from array position. */
  readonly attemptOrdinal: number;
  readonly executionIdentityDigest: ExecutionIdentityDigest;
}

/** The exact durable contents of one sealed `run.json`. */
export interface RunDocument {
  readonly runId: RunId;
  readonly experimentId: ExperimentId;
  /** Mandatory historical Core, sealed once with the Run. */
  readonly context: RunContext;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly RecordSlotIdentity[];
}

/** The exact durable contents of `members/<SlotId>.json`. */
export type MemberDocument =
  | {
      readonly slotId: SlotId;
      readonly action: "executed" | "carried" | "accepted";
      readonly attempt: RecordAttemptRef;
    }
  | {
      readonly slotId: SlotId;
      readonly action: "not-dispatched" | "interrupted";
      readonly attempt: null;
    };

/** The exact durable contents of `attempts/<AttemptId>/attempt.json`. */
export interface AttemptDocument {
  readonly attemptId: AttemptId;
  readonly originRunId: RunId;
  readonly slotId: SlotId;
  readonly evalId: EvalId;
  readonly executionIdentityDigest: ExecutionIdentityDigest;
  readonly outcome: AttemptOutcome;
}

export const RECORD_ATTACHMENT_ENVELOPE_FORMAT = "niceeval.record-attachment" as const;

export interface RecordAttachmentBytePointer {
  readonly sha256: Sha256Digest;
  readonly byteLength: number;
}

export interface RecordAttachmentContentPointer extends RecordAttachmentBytePointer {
  readonly key: RecordBlobKey;
}

/**
 * The sole Attachment commit record. Payload and content objects are immutable
 * digest-addressed bytes written before this envelope is atomically replaced.
 */
export interface RecordAttachmentEnvelope<Family extends string = string> {
  readonly format: typeof RECORD_ATTACHMENT_ENVELOPE_FORMAT;
  readonly ownerKind: RecordAttachmentOwner;
  readonly family: Family;
  readonly schemaVersion: number;
  readonly payload: RecordAttachmentBytePointer;
  readonly contents: readonly RecordAttachmentContentPointer[];
  readonly references: readonly {
    readonly owner: RecordAttachmentOwner;
    readonly family: string;
  }[];
}

export const RECORD_ATTACHMENT_OWNERS = ["run", "attempt"] as const;
export type RecordAttachmentOwner = (typeof RECORD_ATTACHMENT_OWNERS)[number];

/** In-memory aggregate for cross-document Core refine; never a second disk document. */
export interface RunCore {
  readonly run: RunDocument;
  readonly members: readonly MemberDocument[];
  readonly attempts: readonly AttemptDocument[];
}

/** A complete already-published Record Core snapshot. */
export interface RecordCore {
  readonly record: RecordDocument;
  readonly runs: readonly RunCore[];
}

/** NUL cannot appear in a portable segment, so this map key is collision-free. */
export function recordAttemptReferenceKey(ref: RecordAttemptRef): string {
  return `${ref.originRunId}\u0000${ref.attemptId}`;
}
