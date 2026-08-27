import { Effect } from "effect";
import { hostname } from "node:os";
import type { RecordRoot } from "../../record/platform/root.ts";
import {
  acquireCaseLockEffect,
} from "../../runner/lock.ts";
import { RecordCoordination } from "../record-leases.ts";
import type { RecordCoordinationWaitRequest } from "../record-leases.ts";
import type {
  ClaimExecutionRequest,
  CoordinationHostSDK,
  ExecutionClaim,
} from "./types.ts";

/**
 * Compose the existing case-lock primitive into one named Coordination operation.
 * The underlying algorithm remains the single source of truth; this facade only
 * gives its lifecycle a host name.
 */
export function claimExecution(
  request: ClaimExecutionRequest,
): Effect.Effect<ExecutionClaim, unknown> {
  const identity = request.identity ?? Object.freeze({ pid: process.pid, host: hostname() });
  return Effect.uninterruptibleMask((restore) =>
    restore(acquireCaseLockEffect(
      request.localRoot,
      request.experimentId,
      request.evalId,
      identity,
      {
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        ...(request.onCaseWait === undefined ? {} : { onWaitStart: request.onCaseWait }),
      },
    )).pipe(
      Effect.map((caseResult) => Object.freeze({
        caseClaim: caseResult.claim,
        caseTakenOver: caseResult.takenOver,
        release: caseResult.claim.release,
      })),
    ),
  );
}

/**
 * The host facade exposes names, not a generic lock primitive. Each acquired
 * lease is registered in the caller's Scope by the Coordination service.
 */
export const coordinationHost: CoordinationHostSDK = Object.freeze({
  claimExecution,
  enterRecordRead: (root: RecordRoot) =>
    Effect.flatMap(RecordCoordination, (coordination) =>
      coordination.enterRecordRead(root),
    ),
  enterRecordAppend: (root: RecordRoot) =>
    Effect.flatMap(RecordCoordination, (coordination) =>
      coordination.enterRecordAppend(root),
    ),
  enterRecordMaintenance: (root: RecordRoot) =>
    Effect.flatMap(RecordCoordination, (coordination) =>
      coordination.enterRecordMaintenance(root),
    ),
  enterRecordWriteBatch: (request: RecordCoordinationWaitRequest) =>
    Effect.flatMap(RecordCoordination, (coordination) =>
      coordination.enterRecordWriteBatch(request),
    ),
  enterRecordSnapshotBarrier: (request: RecordCoordinationWaitRequest) =>
    Effect.flatMap(RecordCoordination, (coordination) =>
      coordination.enterRecordSnapshotBarrier(request),
    ),
});
