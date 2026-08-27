import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Worker } from "node:worker_threads";
import { Effect } from "effect";
import {
  RecordIoError,
  RecordPermissionError,
  RecordRootInvalid,
} from "../../record/platform/errors.ts";
import { recordRootPaths, type RecordRoot } from "../../record/platform/root.ts";
import { recordSqlitePath } from "../../record/sqlite/database.ts";
import {
  issueRecordSnapshotBarrier,
  issueRecordWriteBatchAdmission,
  recordCoordinationCanceled,
  recordCoordinationDeadlineInvalid,
  recordCoordinationStateInvalid,
  recordCoordinationTimedOut,
  type RecordCoordinationError,
  type RecordCoordinationWaitKind,
  type RecordCoordinationWaitRequest,
  type RecordSnapshotBarrier,
  type RecordWriteBatchAdmission,
} from "../record-leases.ts";
import {
  isAdmissionResponse,
  type AdmissionInput,
  type EnqueueResult,
} from "./node-record-admission-protocol.ts";

const POLL_MILLISECONDS = 15;
const WORKER_IDLE_MILLISECONDS = 50;
const WORKER_CLOSE_MILLISECONDS = 1_000;
const CLEANUP_MILLISECONDS = 10_000;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (cause: unknown) => void;
}

interface AdmissionWorkerClient {
  readonly worker: Worker;
  readonly pending: Map<number, PendingRequest>;
  state: "open" | "closing" | "closed";
  closeRequestId?: number;
  idleTimer?: NodeJS.Timeout;
  closeTimer?: NodeJS.Timeout;
}

let activeClient: AdmissionWorkerClient | undefined;
let nextRequestId = 1;

function workerExecArgv(): string[] {
  const retained: string[] = [];
  for (let index = 0; index < process.execArgv.length; index += 1) {
    const argument = process.execArgv[index]!;
    if (argument === "--import" || argument === "--loader") {
      const value = process.execArgv[index + 1];
      if (value !== undefined) {
        retained.push(argument, value);
        index += 1;
      }
    } else if (argument.startsWith("--import=") || argument.startsWith("--loader=")) {
      retained.push(argument);
    }
  }
  return retained;
}

function clearClientTimers(client: AdmissionWorkerClient): void {
  if (client.idleTimer !== undefined) clearTimeout(client.idleTimer);
  if (client.closeTimer !== undefined) clearTimeout(client.closeTimer);
  client.idleTimer = undefined;
  client.closeTimer = undefined;
}

function detachClient(client: AdmissionWorkerClient): void {
  if (activeClient === client) activeClient = undefined;
}

function rejectPending(client: AdmissionWorkerClient, cause: unknown): void {
  for (const request of client.pending.values()) request.reject(cause);
  client.pending.clear();
}

function failClient(client: AdmissionWorkerClient, cause: unknown): void {
  if (client.state === "closed") return;
  client.state = "closed";
  clearClientTimers(client);
  detachClient(client);
  rejectPending(client, cause);
  client.worker.unref();
}

function beginIdleClose(client: AdmissionWorkerClient): void {
  if (client.state !== "open" || client.pending.size !== 0 || activeClient !== client) return;
  client.state = "closing";
  detachClient(client);
  const closeRequestId = nextRequestId++;
  client.closeRequestId = closeRequestId;
  client.worker.ref();
  try {
    client.worker.postMessage({ id: closeRequestId, operation: "close" });
  } catch (cause) {
    failClient(client, cause);
    void client.worker.terminate();
    return;
  }
  client.closeTimer = setTimeout(() => {
    if (client.state === "closed") return;
    client.state = "closed";
    client.worker.unref();
    void client.worker.terminate();
  }, WORKER_CLOSE_MILLISECONDS);
  client.closeTimer.unref();
}

function scheduleIdleClose(client: AdmissionWorkerClient): void {
  if (client.state !== "open" || client.pending.size !== 0) return;
  client.worker.unref();
  if (client.idleTimer !== undefined) clearTimeout(client.idleTimer);
  client.idleTimer = setTimeout(() => beginIdleClose(client), WORKER_IDLE_MILLISECONDS);
  client.idleTimer.unref();
}

function createClient(): AdmissionWorkerClient {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const worker = new Worker(
    new URL(`./node-record-admission-worker.${extension}`, import.meta.url),
    {
      // Worker rejects several valid parent-process V8 flags (for example
      // --max-old-space-size). Preserve only the loader/import hook needed by
      // source-mode TypeScript execution; packaged workers need no flags.
      execArgv: workerExecArgv(),
    },
  );
  const client: AdmissionWorkerClient = {
    worker,
    pending: new Map(),
    state: "open",
  };

  worker.on("message", (value: unknown) => {
    if (!isAdmissionResponse(value)) {
      const cause = new Error("coordination worker returned an invalid response");
      failClient(client, cause);
      void worker.terminate();
      return;
    }
    if (value.id === client.closeRequestId) {
      client.state = "closed";
      clearClientTimers(client);
      worker.unref();
      return;
    }
    const request = client.pending.get(value.id);
    if (request === undefined) return;
    client.pending.delete(value.id);
    if (value.state === "success") {
      request.resolve(value.result);
    } else {
      request.reject(Object.assign(new Error(value.error.message), value.error));
    }
    scheduleIdleClose(client);
  });
  worker.on("error", (cause) => failClient(client, cause));
  worker.on("exit", (code) => {
    if (client.state === "open") {
      failClient(client, new Error(`coordination worker exited unexpectedly with code ${code}`));
      return;
    }
    client.state = "closed";
    clearClientTimers(client);
    detachClient(client);
    rejectPending(client, new Error(`coordination worker exited with code ${code}`));
  });
  // Adding a message listener refs the underlying port. No idle coordination
  // worker or cached SQLite connection may keep the application alive.
  worker.unref();
  return client;
}

function workerClient(): AdmissionWorkerClient {
  if (activeClient?.state === "open") return activeClient;
  const client = createClient();
  activeClient = client;
  return client;
}

function call(request: AdmissionInput): Promise<unknown> {
  const client = workerClient();
  const id = nextRequestId++;
  if (client.idleTimer !== undefined) {
    clearTimeout(client.idleTimer);
    client.idleTimer = undefined;
  }
  client.worker.ref();
  return new Promise((resolve, reject) => {
    client.pending.set(id, { resolve, reject });
    try {
      client.worker.postMessage({ ...request, id });
    } catch (cause) {
      client.pending.delete(id);
      reject(cause);
      scheduleIdleClose(client);
    }
  });
}

function pathFor(root: unknown): string | undefined {
  const paths = recordRootPaths(root as RecordRoot);
  return paths === undefined ? undefined : recordSqlitePath(paths.portableRoot);
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
  request: AdmissionInput,
  operation: RecordCoordinationWaitKind,
  deadlineEpochMs: number,
): Effect.Effect<unknown, RecordCoordinationError> {
  return Effect.tryPromise({
    try: () => call(request),
    catch: (cause) => mapError(cause, operation, deadlineEpochMs),
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
  import("effect").Scope.Scope
> {
  return Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    yield* validateWait("write-batch", request);
    const path = pathFor(request.root);
    if (path === undefined) {
      return yield* Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
    }

    const owner = { host: hostname(), pid: process.pid } as const;
    const ticketId = randomUUID();
    let sequence: number | undefined;
    const wait = Effect.gen(function* () {
      while (sequence === undefined) {
        yield* validateWait("write-batch", request);
        const result = decodeEnqueueResult(yield* rpc({
          operation: "enqueue",
          path,
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
        const admitted = decodeBoolean(yield* rpc({
          operation: "try-admit",
          path,
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
      return rpc({
        operation: "cancel-writer",
        path,
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
      return rpc({
        operation: "release-writer",
        path,
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

export function enterRecordSnapshotBarrierNode(
  request: RecordCoordinationWaitRequest,
): Effect.Effect<
  RecordSnapshotBarrier,
  RecordCoordinationError,
  import("effect").Scope.Scope
> {
  return Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    yield* validateWait("snapshot-barrier", request);
    const path = pathFor(request.root);
    if (path === undefined) {
      return yield* Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
    }

    const owner = { host: hostname(), pid: process.pid } as const;
    const barrierId = randomUUID();
    const nonce = randomUUID();
    let requested = false;
    const wait = Effect.gen(function* () {
      while (!requested) {
        yield* validateWait("snapshot-barrier", request);
        const acquired = decodeBoolean(yield* rpc({
          operation: "request-barrier",
          path,
          barrierId,
          nonce,
          ...owner,
          deadline: request.deadlineEpochMs,
          requestedAt: Date.now(),
        }, "snapshot-barrier", request.deadlineEpochMs));
        if (acquired === undefined) return yield* Effect.fail(recordCoordinationStateInvalid());
        requested = acquired;
        if (!requested) yield* Effect.sleep(POLL_MILLISECONDS);
      }

      while (true) {
        yield* validateWait("snapshot-barrier", request);
        const active = decodeBoolean(yield* rpc({
          operation: "try-activate-barrier",
          path,
          barrierId,
          nonce,
          ...owner,
          deadline: request.deadlineEpochMs,
          now: Date.now(),
        }, "snapshot-barrier", request.deadlineEpochMs));
        if (active === undefined) return yield* Effect.fail(recordCoordinationStateInvalid());
        if (active) return;
        yield* Effect.sleep(POLL_MILLISECONDS);
      }
    });

    const cancel = (): Effect.Effect<void> => {
      if (!requested) return Effect.void;
      const deadline = cleanupDeadline();
      return rpc({
        operation: "cancel-barrier",
        path,
        barrierId,
        nonce,
        ...owner,
        deadline,
        now: Date.now(),
      }, "snapshot-barrier", deadline).pipe(Effect.orDie, Effect.asVoid);
    };
    yield* restore(wait).pipe(Effect.onError(cancel));
    yield* Effect.addFinalizer(cancel);
    return issueRecordSnapshotBarrier();
  }));
}
