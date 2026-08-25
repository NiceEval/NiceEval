import { Context, Effect } from "effect";
import type { RecordId } from "../record/model/identifiers.ts";
import type {
  RecordFileSystemError,
  RecordMaintenanceBusy,
} from "../record/platform/errors.ts";
import type { RecordRoot } from "../record/platform/root.ts";

export type RecordLeaseKind = "read" | "append" | "maintenance";

export type RecordCoordinationWaitKind = "write-batch" | "snapshot-barrier";

/** Absolute wall-clock deadline shared by admission and the caller's SQLite work. */
export interface RecordCoordinationWaitRequest {
  readonly root: RecordRoot;
  readonly deadlineEpochMs: number;
  readonly signal?: AbortSignal;
}

const recordLeaseTypeId: unique symbol = Symbol(
  "@niceeval/coordination/RecordLease",
);

/** A local, Scope-owned proof that one named Record operation remains active. */
export interface RecordLease {
  readonly kind: RecordLeaseKind;
  readonly [recordLeaseTypeId]: typeof recordLeaseTypeId;
}

const recordWriteBatchAdmissionTypeId: unique symbol = Symbol(
  "@niceeval/coordination/RecordWriteBatchAdmission",
);

/** Scope-owned permission for exactly one bounded SQLite write transaction. */
export interface RecordWriteBatchAdmission {
  readonly kind: "write-batch";
  readonly [recordWriteBatchAdmissionTypeId]: typeof recordWriteBatchAdmissionTypeId;
}

const recordSnapshotBarrierTypeId: unique symbol = Symbol(
  "@niceeval/coordination/RecordSnapshotBarrier",
);

/** Scope-owned barrier held only while SQLite backup reads the source database. */
export interface RecordSnapshotBarrier {
  readonly kind: "snapshot-barrier";
  readonly [recordSnapshotBarrierTypeId]: typeof recordSnapshotBarrierTypeId;
}

/**
 * A stale or copied local state directory must not coordinate a different
 * portable Record that happens to use the same host root.
 */
export interface RecordCoordinationIdentityMismatch {
  readonly code: "record-coordination-identity-mismatch";
}

export interface RecordCoordinationDeadlineInvalid {
  readonly code: "record-coordination-deadline-invalid";
  readonly operation: RecordCoordinationWaitKind;
  readonly deadlineEpochMs: number;
}

export interface RecordCoordinationTimedOut {
  readonly code: "record-coordination-timed-out";
  readonly operation: RecordCoordinationWaitKind;
  readonly deadlineEpochMs: number;
}

export interface RecordCoordinationCanceled {
  readonly code: "record-coordination-canceled";
  readonly operation: RecordCoordinationWaitKind;
}

/** Malformed local authority is never guessed at or overwritten. */
export interface RecordCoordinationStateInvalid {
  readonly code: "record-coordination-state-invalid";
}

export type RecordCoordinationError =
  | RecordFileSystemError
  | RecordMaintenanceBusy
  | RecordCoordinationIdentityMismatch
  | RecordCoordinationDeadlineInvalid
  | RecordCoordinationTimedOut
  | RecordCoordinationCanceled
  | RecordCoordinationStateInvalid;

export interface RecordCoordinationService {
  /** Shared lease; readers coexist with append writers. */
  readonly enterRecordRead: (
    root: RecordRoot,
  ) => Effect.Effect<RecordLease, RecordCoordinationError, import("effect").Scope.Scope>;

  /** Shared lease; append writers never serialize with one another. */
  readonly enterRecordAppend: (
    root: RecordRoot,
  ) => Effect.Effect<RecordLease, RecordCoordinationError, import("effect").Scope.Scope>;

  /** Exclusive lease for clean and migration. It never waits while half-open. */
  readonly enterRecordMaintenance: (
    root: RecordRoot,
  ) => Effect.Effect<RecordLease, RecordCoordinationError, import("effect").Scope.Scope>;

  /** Rechecks the portable immutable identity against the local sidecar. */
  readonly verifyRecordIdentity: (
    input: { readonly root: RecordRoot; readonly recordId: RecordId },
  ) => Effect.Effect<void, RecordCoordinationError>;

  /** FIFO admission for one bounded BEGIN IMMEDIATE transaction or batch. */
  readonly enterRecordWriteBatch: (
    request: RecordCoordinationWaitRequest,
  ) => Effect.Effect<
    RecordWriteBatchAdmission,
    RecordCoordinationError,
    import("effect").Scope.Scope
  >;

  /** Blocks new write admission and drains the already admitted transaction. */
  readonly enterRecordSnapshotBarrier: (
    request: RecordCoordinationWaitRequest,
  ) => Effect.Effect<
    RecordSnapshotBarrier,
    RecordCoordinationError,
    import("effect").Scope.Scope
  >;

}

export class RecordCoordination extends Context.Tag(
  "@niceeval/coordination/RecordCoordination",
)<RecordCoordination, RecordCoordinationService>() {}

/** @internal The Node platform is the only issuer of concrete lease handles. */
export function issueRecordLease(kind: RecordLeaseKind): RecordLease {
  const lease: RecordLease = {
    kind,
    [recordLeaseTypeId]: recordLeaseTypeId,
  };
  return Object.freeze(lease);
}

/** @internal The Node platform is the only issuer of concrete admission handles. */
export function issueRecordWriteBatchAdmission(): RecordWriteBatchAdmission {
  const admission: RecordWriteBatchAdmission = {
    kind: "write-batch",
    [recordWriteBatchAdmissionTypeId]: recordWriteBatchAdmissionTypeId,
  };
  return Object.freeze(admission);
}

/** @internal The Node platform is the only issuer of concrete barrier handles. */
export function issueRecordSnapshotBarrier(): RecordSnapshotBarrier {
  const barrier: RecordSnapshotBarrier = {
    kind: "snapshot-barrier",
    [recordSnapshotBarrierTypeId]: recordSnapshotBarrierTypeId,
  };
  return Object.freeze(barrier);
}

export function recordCoordinationIdentityMismatch(): RecordCoordinationIdentityMismatch {
  return Object.freeze({ code: "record-coordination-identity-mismatch" });
}

export function recordCoordinationDeadlineInvalid(
  operation: RecordCoordinationWaitKind,
  deadlineEpochMs: number,
): RecordCoordinationDeadlineInvalid {
  return Object.freeze({
    code: "record-coordination-deadline-invalid",
    operation,
    deadlineEpochMs,
  });
}

export function recordCoordinationTimedOut(
  operation: RecordCoordinationWaitKind,
  deadlineEpochMs: number,
): RecordCoordinationTimedOut {
  return Object.freeze({ code: "record-coordination-timed-out", operation, deadlineEpochMs });
}

export function recordCoordinationCanceled(
  operation: RecordCoordinationWaitKind,
): RecordCoordinationCanceled {
  return Object.freeze({ code: "record-coordination-canceled", operation });
}

export function recordCoordinationStateInvalid(): RecordCoordinationStateInvalid {
  return Object.freeze({ code: "record-coordination-state-invalid" });
}
