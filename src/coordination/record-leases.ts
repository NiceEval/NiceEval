import { Context, Effect } from "effect";
import type { RecordId } from "../record/model/identifiers.ts";
import type {
  RecordFileSystemError,
  RecordMaintenanceBusy,
} from "../record/platform/errors.ts";
import type { RecordRoot } from "../record/platform/root.ts";

export type RecordLeaseKind = "read" | "append" | "maintenance";

const recordLeaseTypeId: unique symbol = Symbol(
  "@niceeval/coordination/RecordLease",
);

/** A local, Scope-owned proof that one named Record operation remains active. */
export interface RecordLease {
  readonly kind: RecordLeaseKind;
  readonly [recordLeaseTypeId]: typeof recordLeaseTypeId;
}

/**
 * A stale or copied local state directory must not coordinate a different
 * portable Record that happens to use the same host root.
 */
export interface RecordCoordinationIdentityMismatch {
  readonly code: "record-coordination-identity-mismatch";
}

export type RecordCoordinationError =
  | RecordFileSystemError
  | RecordMaintenanceBusy
  | RecordCoordinationIdentityMismatch;

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

export function recordCoordinationIdentityMismatch(): RecordCoordinationIdentityMismatch {
  return Object.freeze({ code: "record-coordination-identity-mismatch" });
}
