import { Effect, Exit } from "effect";
import { hostname } from "node:os";
import type { RecordRoot } from "../../record/platform/root.ts";
import {
  acquireCaseLockEffect,
} from "../../runner/lock.ts";
import {
  acquireGateSlotEffect,
} from "../../runner/gate-lease.ts";
import { RecordCoordination } from "../record-leases.ts";
import type {
  ClaimExecutionRequest,
  CoordinationHostSDK,
  ExecutionClaim,
} from "./types.ts";

/**
 * Compose the existing case and experiment-gate primitives into one named
 * Coordination operation. The underlying algorithms remain their single
 * source of truth; this facade only gives their joint lifecycle a host name.
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
      Effect.flatMap((caseResult) => {
        const base = {
          caseClaim: caseResult.claim,
          caseTakenOver: caseResult.takenOver,
        } as const;
        if (request.maxConcurrency === undefined) {
          return Effect.succeed(Object.freeze({
            ...base,
            release: caseResult.claim.release,
          }));
        }
        return restore(acquireGateSlotEffect(
          request.localRoot,
          request.experimentId,
          request.maxConcurrency,
          identity,
          {
            ...(request.signal === undefined ? {} : { signal: request.signal }),
            ...(request.onGateWait === undefined ? {} : { onWaitStart: request.onGateWait }),
          },
        )).pipe(
          // A typed failure, defect, or interruption while waiting for the
          // gate must not strand the case claim acquired immediately before it.
          Effect.onExit((exit) => Exit.isSuccess(exit)
            ? Effect.void
            : caseResult.claim.release.pipe(Effect.ignore)),
          Effect.map((gateResult) => Object.freeze({
            ...base,
            gateClaim: gateResult.claim,
            ...(gateResult.takenOver ? { gateTakenOver: true } : {}),
            release: gateResult.claim.release.pipe(
              Effect.ensuring(caseResult.claim.release.pipe(Effect.ignore)),
            ),
          })),
        );
      }),
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
});
