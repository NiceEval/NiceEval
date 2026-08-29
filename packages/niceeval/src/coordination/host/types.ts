import type { Effect } from "effect";
import type { RecordRoot } from "../../record/platform/root.ts";
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

/** Input is rooted in project-local `.niceeval`, never in the portable Record root. */
export interface ClaimExecutionRequest {
  readonly localRoot: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly identity?: { readonly pid: number; readonly host: string };
  readonly signal?: AbortSignal;
  readonly onCaseWait?: (holder: CaseLockRecord) => void;
}

/** Narrow coordination operations shared by the Record and command hosts. */
export interface CoordinationHostSDK {
  readonly claimExecution: (
    request: ClaimExecutionRequest,
  ) => Effect.Effect<ExecutionClaim, unknown>;

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
