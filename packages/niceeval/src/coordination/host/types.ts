import type { Effect } from "effect";
import type { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";
import type { RecordRoot } from "../../record/platform/root.ts";
import type { ProcessOwnerIdentity } from "../platform/sqlite-coordination.ts";
import type {
  CaseLockEffectClaim,
  CaseLockRecord,
} from "../../runner/lock.ts";
import type {
  RecordCoordination,
  RecordCoordinationError,
  RecordCoordinationWaitRequest,
  RecordLease,
  RecordWriteFreeze,
  RecordWriteBatchAdmission,
} from "../record-leases.ts";

/**
 * One short-lived execution claim. It owns only local scheduling state and
 * never grants access to a portable Record writer.
 */
export interface ExecutionClaim {
  readonly caseClaim: CaseLockEffectClaim;
  readonly caseTakenOver: boolean;
  readonly release: Effect.Effect<void, unknown>;
}

/** Execution claims live in the project's one canonical ProjectDatabase. */
export interface ClaimExecutionRequest {
  readonly projectDatabaseRoot: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly identity?: ProcessOwnerIdentity;
  readonly signal?: AbortSignal;
  readonly onCaseWait?: (holder: CaseLockRecord) => void;
}

/** Narrow coordination operations shared by the Record and command hosts. */
export interface CoordinationHostSDK {
  readonly claimExecution: (
    request: ClaimExecutionRequest,
  ) => Effect.Effect<ExecutionClaim, unknown, ProjectStateDatabase>;

  readonly enterRecordRead: (
    root: RecordRoot,
  ) => Effect.Effect<
    RecordLease,
    RecordCoordinationError,
    import("effect").Scope.Scope | RecordCoordination
  >;

  readonly enterRecordAppend: (
    root: RecordRoot,
  ) => Effect.Effect<
    RecordLease,
    RecordCoordinationError,
    import("effect").Scope.Scope | RecordCoordination
  >;

  readonly enterRecordMaintenance: (
    root: RecordRoot,
  ) => Effect.Effect<
    RecordLease,
    RecordCoordinationError,
    import("effect").Scope.Scope | RecordCoordination
  >;

  /** One FIFO ticket authorizes one bounded SQLite write transaction or batch. */
  readonly enterRecordWriteBatch: (
    request: RecordCoordinationWaitRequest,
  ) => Effect.Effect<
    RecordWriteBatchAdmission,
    RecordCoordinationError,
    import("effect").Scope.Scope | RecordCoordination
  >;

  /** Blocks new writes while a stable SQLite read point is captured. */
  readonly enterRecordWriteFreeze: (
    request: RecordCoordinationWaitRequest,
  ) => Effect.Effect<
    RecordWriteFreeze,
    RecordCoordinationError,
    import("effect").Scope.Scope | RecordCoordination
  >;
}
