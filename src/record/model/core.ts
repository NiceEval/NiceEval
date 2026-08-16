import type {
  AttemptId,
  EvalId,
  ExecutionIdentityDigest,
  ExperimentId,
  RecordFormat,
  RecordId,
  RunId,
  SlotId,
  UtcMillis,
} from "./identifiers.ts";
import type { RunContext } from "./run-context.ts";

/** The current root header keeps stable identity separate from schema version. */
export interface RecordDocument {
  readonly format: RecordFormat;
  readonly schemaVersion: 1;
  readonly recordId: RecordId;
}

/** An exact reference to an immutable origin Attempt. */
export interface RecordAttemptRef {
  readonly originRunId: RunId;
  readonly attemptId: AttemptId;
}

/** The terminal execution fact required to interpret an origin Attempt. */
export type AttemptOutcome =
  | "completed"
  | "errored"
  | "cancelled"
  | "interrupted";

/** The immutable final action for one planned denominator Slot. */
export type MembershipAction =
  | "executed"
  | "carried"
  | "accepted"
  | "not-dispatched"
  | "interrupted";

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

/** Stable fixed-family identity plus the numeric shape version. */
export interface RecordAttachmentEnvelope<Family extends string = string> {
  readonly family: Family;
  readonly schemaVersion: number;
}

export type RecordAttachmentOwner = "run" | "attempt";

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
