import { Context, Effect } from "effect";
import type {
  RecordFileSystemError,
  RecordMaintenanceBusy,
} from "../record/platform/errors.ts";
import type { RecordRoot } from "../record/platform/root.ts";

export type RecordLeaseKind = "read" | "append" | "maintenance";

export type RecordCoordinationWaitKind = "write-batch" | "write-freeze";

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

const recordWriteFreezeTypeId: unique symbol = Symbol(
  "@niceeval/coordination/RecordWriteFreeze",
);

/** Scope-owned barrier that blocks new writes while a stable read point is captured. */
export interface RecordWriteFreeze {
  readonly kind: "write-freeze";
  readonly [recordWriteFreezeTypeId]: typeof recordWriteFreezeTypeId;
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
  readonly cause?: unknown;
}

export type RecordCoordinationError =
  | RecordFileSystemError
  | RecordMaintenanceBusy
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

  /** FIFO admission for one bounded BEGIN IMMEDIATE transaction or batch. */
  readonly enterRecordWriteBatch: (
    request: RecordCoordinationWaitRequest,
  ) => Effect.Effect<
    RecordWriteBatchAdmission,
    RecordCoordinationError,
    import("effect").Scope.Scope
  >;

  /** Blocks new write admission and drains the already admitted transaction. */
  readonly enterRecordWriteFreeze: (
    request: RecordCoordinationWaitRequest,
  ) => Effect.Effect<
    RecordWriteFreeze,
    RecordCoordinationError,
    import("effect").Scope.Scope
  >;

}

export class RecordCoordination extends Context.Service<RecordCoordination, RecordCoordinationService>()(
  "@niceeval/coordination/RecordCoordination",
) {}

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
export function issueRecordWriteFreeze(): RecordWriteFreeze {
  const barrier: RecordWriteFreeze = {
    kind: "write-freeze",
    [recordWriteFreezeTypeId]: recordWriteFreezeTypeId,
  };
  return Object.freeze(barrier);
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

export function recordCoordinationStateInvalid(cause?: unknown): RecordCoordinationStateInvalid {
  return Object.freeze({
    code: "record-coordination-state-invalid",
    ...(cause === undefined ? {} : { cause }),
  });
}
