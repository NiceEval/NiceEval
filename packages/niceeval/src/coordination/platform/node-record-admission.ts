import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type * as Scope from "effect/Scope";
import {
  RecordIoError,
  RecordPermissionError,
  RecordRootInvalid,
} from "../../record/platform/errors.ts";
import { recordRootPaths, type RecordRoot } from "../../record/platform/root.ts";
import { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";
import { currentProcessOwnerIdentity } from "./node-process-identity.ts";
import {
  issueRecordWriteFreeze,
  issueRecordWriteBatchAdmission,
  recordCoordinationCanceled,
  recordCoordinationDeadlineInvalid,
  recordCoordinationStateInvalid,
  recordCoordinationTimedOut,
  type RecordCoordinationError,
  type RecordCoordinationWaitKind,
  type RecordCoordinationWaitRequest,
  type RecordWriteFreeze,
  type RecordWriteBatchAdmission,
} from "../record-leases.ts";
import type { AdmissionInput, EnqueueResult } from "./node-record-admission-protocol.ts";

const POLL_MILLISECONDS = 15;
const CLEANUP_MILLISECONDS = 10_000;

function pathFor(root: unknown): string | undefined {
  const paths = recordRootPaths(root as RecordRoot);
  return paths?.portableRoot;
}

function mapError(
  cause: unknown,
  operation: RecordCoordinationWaitKind,
  deadlineEpochMs: number,
): RecordCoordinationError {
  const code = typeof cause === "object" && cause !== null
    ? Reflect.get(cause, "code")
    : undefined;
  if (code === "record-write-busy") {
    return recordCoordinationTimedOut(operation, deadlineEpochMs);
  }
  if (code === "EACCES" || code === "EPERM") {
    return new RecordPermissionError({
      code: "record-permission-denied",
      operation: "read-file",
      path: "record.sqlite",
      cause,
    });
  }
  if (code === "ENOENT") {
    return new RecordIoError({
      code: "record-io-error",
      operation: "read-file",
      path: "record.sqlite",
      cause,
    });
  }
  return recordCoordinationStateInvalid(cause);
}

function validateWait(
  operation: RecordCoordinationWaitKind,
  request: RecordCoordinationWaitRequest,
): Effect.Effect<void, RecordCoordinationError> {
  if (!Number.isSafeInteger(request.deadlineEpochMs) || request.deadlineEpochMs <= 0) {
    return Effect.fail(recordCoordinationDeadlineInvalid(operation, request.deadlineEpochMs));
  }
  if (request.signal?.aborted) return Effect.fail(recordCoordinationCanceled(operation));
  if (Date.now() >= request.deadlineEpochMs) {
    return Effect.fail(recordCoordinationTimedOut(operation, request.deadlineEpochMs));
  }
  return Effect.void;
}

function rpc(
  projectDatabaseRoot: string,
  request: AdmissionInput,
  operation: RecordCoordinationWaitKind,
  deadlineEpochMs: number,
): Effect.Effect<unknown, RecordCoordinationError, ProjectStateDatabase> {
  return Effect.gen(function* () {
    const database = yield* ProjectStateDatabase;
    const facets = yield* database.bind(projectDatabaseRoot).pipe(
      Effect.mapError((cause) => mapError(cause, operation, deadlineEpochMs)),
    );
    return yield* Effect.tryPromise({
      try: () => facets.admission.execute(request),
      catch: (cause) => mapError(cause, operation, deadlineEpochMs),
    });
  });
}

function cleanupDeadline(): number {
  return Date.now() + CLEANUP_MILLISECONDS;
}

function decodeEnqueueResult(value: unknown): EnqueueResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const state = Reflect.get(value, "state");
  if (state === "blocked-by-barrier") return { state };
  const sequence = Reflect.get(value, "sequence");
  return state === "queued" && Number.isSafeInteger(sequence) && Number(sequence) > 0
    ? { state, sequence: Number(sequence) }
    : undefined;
}

function decodeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function enterRecordWriteBatchNode(
  request: RecordCoordinationWaitRequest,
): Effect.Effect<
  RecordWriteBatchAdmission,
  RecordCoordinationError,
  Scope.Scope | ProjectStateDatabase
> {
  return Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    yield* validateWait("write-batch", request);
    const path = pathFor(request.root);
    if (path === undefined) {
      return yield* Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
    }

    const identity = currentProcessOwnerIdentity();
    const owner = {
      host: identity.host,
      pid: identity.pid,
      bootId: identity.bootId,
      processStart: identity.processStart,
    } as const;
    const ticketId = randomUUID();
    let sequence: number | undefined;
    const wait = Effect.gen(function* () {
      while (sequence === undefined) {
        yield* validateWait("write-batch", request);
        const result = decodeEnqueueResult(yield* rpc(path, {
          operation: "enqueue",
          ticketId,
          ...owner,
          deadline: request.deadlineEpochMs,
          enqueuedAt: Date.now(),
        }, "write-batch", request.deadlineEpochMs));
        if (result === undefined) return yield* Effect.fail(recordCoordinationStateInvalid());
        if (result.state === "queued") {
          sequence = result.sequence;
        } else {
          yield* Effect.sleep(POLL_MILLISECONDS);
        }
      }

      while (true) {
        yield* validateWait("write-batch", request);
        const admitted = decodeBoolean(yield* rpc(path, {
          operation: "try-admit",
          ticketId,
          sequence,
          ...owner,
          deadline: request.deadlineEpochMs,
          now: Date.now(),
        }, "write-batch", request.deadlineEpochMs));
        if (admitted === undefined) return yield* Effect.fail(recordCoordinationStateInvalid());
        if (admitted) return;
        yield* Effect.sleep(POLL_MILLISECONDS);
      }
    });

    yield* restore(wait).pipe(Effect.onError(() => {
      const deadline = cleanupDeadline();
      return rpc(path, {
        operation: "cancel-writer",
        ticketId,
        ...owner,
        deadline,
        now: Date.now(),
      }, "write-batch", deadline).pipe(Effect.orDie, Effect.asVoid);
    }));
    const admittedSequence = sequence;
    if (admittedSequence === undefined) {
      return yield* Effect.fail(recordCoordinationStateInvalid());
    }
    yield* Effect.addFinalizer(() => {
      const deadline = cleanupDeadline();
      return rpc(path, {
        operation: "release-writer",
        ticketId,
        sequence: admittedSequence,
        ...owner,
        deadline,
        now: Date.now(),
      }, "write-batch", deadline).pipe(Effect.orDie, Effect.asVoid);
    });
    return issueRecordWriteBatchAdmission();
  }));
}

export function enterRecordWriteFreezeNode(
  request: RecordCoordinationWaitRequest,
): Effect.Effect<
  RecordWriteFreeze,
  RecordCoordinationError,
  Scope.Scope | ProjectStateDatabase
> {
  return Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    yield* validateWait("write-freeze", request);
    const path = pathFor(request.root);
    if (path === undefined) {
      return yield* Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
    }

    const identity = currentProcessOwnerIdentity();
    const owner = {
      host: identity.host,
      pid: identity.pid,
      bootId: identity.bootId,
      processStart: identity.processStart,
    } as const;
    const barrierId = randomUUID();
    const nonce = randomUUID();
    let requested = false;
    const wait = Effect.gen(function* () {
      while (!requested) {
        yield* validateWait("write-freeze", request);
        const acquired = decodeBoolean(yield* rpc(path, {
          operation: "request-barrier",
          barrierId,
          nonce,
          ...owner,
          deadline: request.deadlineEpochMs,
          requestedAt: Date.now(),
        }, "write-freeze", request.deadlineEpochMs));
        if (acquired === undefined) return yield* Effect.fail(recordCoordinationStateInvalid());
        requested = acquired;
        if (!requested) yield* Effect.sleep(POLL_MILLISECONDS);
      }

      while (true) {
        yield* validateWait("write-freeze", request);
        const active = decodeBoolean(yield* rpc(path, {
          operation: "try-activate-barrier",
          barrierId,
          nonce,
          ...owner,
          deadline: request.deadlineEpochMs,
          now: Date.now(),
        }, "write-freeze", request.deadlineEpochMs));
        if (active === undefined) return yield* Effect.fail(recordCoordinationStateInvalid());
        if (active) return;
        yield* Effect.sleep(POLL_MILLISECONDS);
      }
    });

    const cancel = (): Effect.Effect<void, never, ProjectStateDatabase> => {
      if (!requested) return Effect.void;
      const deadline = cleanupDeadline();
      return rpc(path, {
        operation: "cancel-barrier",
        barrierId,
        nonce,
        ...owner,
        deadline,
        now: Date.now(),
      }, "write-freeze", deadline).pipe(Effect.orDie, Effect.asVoid);
    };
    yield* restore(wait).pipe(Effect.onError(cancel));
    yield* Effect.addFinalizer(cancel);
    return issueRecordWriteFreeze();
  }));
}
