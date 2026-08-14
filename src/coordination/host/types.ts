import type { Effect } from "effect";
import type { RecordRoot } from "../../record/platform/root.ts";
import type {
  CaseLockEffectClaim,
  CaseLockRecord,
} from "../../runner/lock.ts";
import type {
  GateLeaseEffectClaim,
  GateLeaseRecord,
} from "../../runner/gate-lease.ts";
import type {
  RecordCoordination,
  RecordCoordinationError,
  RecordLease,
} from "../record-leases.ts";

/**
 * One short-lived execution claim. It owns only local scheduling state and
 * never grants access to a portable Record writer.
 */
export interface ExecutionClaim {
  readonly caseClaim: CaseLockEffectClaim;
  readonly gateClaim?: GateLeaseEffectClaim;
  readonly caseTakenOver: boolean;
  readonly gateTakenOver?: boolean;
  readonly release: Effect.Effect<void, unknown>;
}

/** Input is rooted in project-local `.niceeval`, never in the portable Record root. */
export interface ClaimExecutionRequest {
  readonly localRoot: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly maxConcurrency?: number;
  readonly identity?: { readonly pid: number; readonly host: string };
  readonly signal?: AbortSignal;
  readonly onCaseWait?: (holder: CaseLockRecord) => void;
  readonly onGateWait?: (holders: readonly GateLeaseRecord[]) => void;
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
}
