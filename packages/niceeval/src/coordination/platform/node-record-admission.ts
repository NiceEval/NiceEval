import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import {
  RecordIoError,
  RecordPermissionError,
  RecordRootInvalid,
  type RecordFileSystemError,
  type RecordPlatformOperation,
} from "../../record/platform/errors.ts";
import { recordCoordinationIdentity } from "../identity.ts";
import {
  issueRecordSnapshotBarrier,
  issueRecordWriteBatchAdmission,
  recordCoordinationCanceled,
  recordCoordinationDeadlineInvalid,
  recordCoordinationStateInvalid,
  recordCoordinationTimedOut,
  type RecordCoordinationError,
  type RecordCoordinationStateInvalid,
  type RecordCoordinationWaitKind,
  type RecordCoordinationWaitRequest,
  type RecordSnapshotBarrier,
  type RecordWriteBatchAdmission,
} from "../record-leases.ts";

const STATE_VERSION = 1;
const MUTEX_LEASE_MILLISECONDS = 2_000;
const OWNER_LEASE_MILLISECONDS = 2_000;
const POLL_MILLISECONDS = 15;
const MAXIMUM_METADATA_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();

interface AdmissionLayout {
  readonly root: string;
  readonly statePath: string;
  readonly mutexPath: string;
}

interface WaitingTicket {
  readonly id: string;
  readonly sequence: number;
  readonly host: string;
  readonly pid: number;
  readonly deadline: number;
  readonly enqueuedAt: number;
}

interface WriterOwner extends WaitingTicket {
  readonly nonce: string;
  readonly admittedAt: number;
  readonly leaseExpiresAt: number;
}

interface SnapshotBarrierOwner {
  readonly id: string;
  readonly nonce: string;
  readonly host: string;
  readonly pid: number;
  readonly deadline: number;
  readonly requestedAt: number;
  readonly leaseExpiresAt: number;
  readonly status: "requested" | "active";
  readonly activeAt: number | null;
}

interface AdmissionState {
  readonly version: 1;
  revision: number;
  nextWriterSequence: number;
  tickets: Array<WaitingTicket>;
  writerOwner: WriterOwner | null;
  snapshotBarrier: SnapshotBarrierOwner | null;
}

interface MutexOwner {
  readonly version: 1;
  readonly host: string;
  readonly pid: number;
  readonly nonce: string;
  readonly expiresAt: number;
}

interface MutexClaim {
  readonly layout: AdmissionLayout;
  readonly nonce: string;
}

interface WriterClaim {
  readonly layout: AdmissionLayout;
  readonly ticketId: string;
  readonly nonce: string;
}

interface BarrierClaim {
  readonly layout: AdmissionLayout;
  readonly barrierId: string;
  readonly nonce: string;
}

function errorCode(cause: unknown): string | undefined {
  return typeof cause === "object" && cause !== null && "code" in cause &&
      typeof cause.code === "string"
    ? cause.code
    : undefined;
}

function isMissing(cause: unknown): boolean {
  return errorCode(cause) === "ENOENT";
}

function isAlreadyExists(cause: unknown): boolean {
  const code = errorCode(cause);
  return code === "EEXIST" || code === "ENOTEMPTY";
}

function fileSystemError(
  operation: RecordPlatformOperation,
  path: string,
  cause: unknown,
): RecordIoError | RecordPermissionError {
  return errorCode(cause) === "EACCES" || errorCode(cause) === "EPERM"
    ? new RecordPermissionError({
        code: "record-permission-denied",
        operation,
        path,
        cause,
      })
    : new RecordIoError({ code: "record-io-error", operation, path, cause });
}

function nodeIo<A>(input: {
  readonly operation: RecordPlatformOperation;
  readonly path: string;
  readonly run: () => Promise<A>;
}): Effect.Effect<A, RecordIoError | RecordPermissionError> {
  return Effect.tryPromise({
    try: input.run,
    catch: (cause) => fileSystemError(input.operation, input.path, cause),
  });
}

function closeHandle(
  handle: FileHandle,
  operation: RecordPlatformOperation,
  path: string,
): Effect.Effect<void> {
  return nodeIo({ operation, path, run: () => handle.close() }).pipe(Effect.orDie);
}

function ensureDirectory(path: string): Effect.Effect<void, RecordFileSystemError> {
  return nodeIo({
    operation: "create-directory",
    path,
    run: () => mkdir(path, { recursive: true, mode: 0o700 }),
  });
}

function syncDirectory(path: string): Effect.Effect<void, RecordFileSystemError> {
  return Effect.scoped(
    Effect.acquireRelease(
      nodeIo({ operation: "sync-directory", path, run: () => open(path, "r") }),
      (handle) => closeHandle(handle, "sync-directory", path),
    ).pipe(
      Effect.flatMap((handle) =>
        nodeIo({ operation: "sync-directory", path, run: () => handle.sync() })
      ),
    ),
  );
}

function removeFileIfPresent(path: string): Effect.Effect<void, RecordFileSystemError> {
  return nodeIo({ operation: "remove-path", path, run: () => unlink(path) }).pipe(
    Effect.catchAll((error) => isMissing(error.cause) ? Effect.void : Effect.fail(error)),
  );
}

function removeDirectoryIfPresent(path: string): Effect.Effect<void, RecordFileSystemError> {
  return nodeIo({
    operation: "remove-path",
    path,
    run: () => rm(path, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 10,
    }),
  });
}

function writeDurableJson(
  path: string,
  value: unknown,
): Effect.Effect<void, RecordFileSystemError> {
  const parent = dirname(path);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const bytes = textEncoder.encode(`${JSON.stringify(value)}\n`);
  return Effect.gen(function* () {
    yield* ensureDirectory(parent);
    yield* Effect.scoped(
      Effect.acquireRelease(
        nodeIo({
          operation: "write-file",
          path: temporaryPath,
          run: () => open(temporaryPath, "wx", 0o600),
        }),
        (handle) => closeHandle(handle, "write-file", temporaryPath),
      ).pipe(
        Effect.flatMap((handle) =>
          nodeIo({
            operation: "write-file",
            path: temporaryPath,
            run: () => handle.writeFile(bytes),
          }).pipe(
            Effect.zipRight(nodeIo({
              operation: "sync-file",
              path: temporaryPath,
              run: () => handle.sync(),
            })),
          )
        ),
      ),
    );
    yield* nodeIo({
      operation: "publish-directory",
      path,
      run: () => rename(temporaryPath, path),
    }).pipe(Effect.onError(() => removeFileIfPresent(temporaryPath).pipe(Effect.orDie)));
    yield* syncDirectory(parent);
  });
}

function layoutFor(root: unknown): Effect.Effect<AdmissionLayout, RecordRootInvalid> {
  const identity = recordCoordinationIdentity(root);
  if (identity === undefined) {
    return Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
  }
  const admissionRoot = join(identity.localStateRoot, "writer-admission");
  return Effect.succeed(Object.freeze({
    root: admissionRoot,
    statePath: join(admissionRoot, "state.json"),
    mutexPath: join(admissionRoot, "state.mutex"),
  }));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function decodeProcessOwner(value: Record<string, unknown>): boolean {
  return typeof value.host === "string" && value.host.length > 0 &&
    isFiniteInteger(value.pid) && value.pid > 0;
}

function decodeWaitingTicket(value: unknown): WaitingTicket | undefined {
  if (!isObject(value) || !hasExactKeys(value, [
    "id",
    "sequence",
    "host",
    "pid",
    "deadline",
    "enqueuedAt",
  ])) return undefined;
  if (
    typeof value.id !== "string" || value.id.length === 0 ||
    !isFiniteInteger(value.sequence) || value.sequence <= 0 ||
    !decodeProcessOwner(value) ||
    !isFiniteInteger(value.deadline) || value.deadline <= 0 ||
    !isFiniteInteger(value.enqueuedAt) || value.enqueuedAt <= 0
  ) return undefined;
  return value as unknown as WaitingTicket;
}

function decodeWriterOwner(value: unknown): WriterOwner | undefined {
  if (!isObject(value) || !hasExactKeys(value, [
    "id",
    "sequence",
    "host",
    "pid",
    "deadline",
    "enqueuedAt",
    "nonce",
    "admittedAt",
    "leaseExpiresAt",
  ])) return undefined;
  const ticket = decodeWaitingTicket({
    id: value.id,
    sequence: value.sequence,
    host: value.host,
    pid: value.pid,
    deadline: value.deadline,
    enqueuedAt: value.enqueuedAt,
  });
  if (
    ticket === undefined || typeof value.nonce !== "string" || value.nonce.length === 0 ||
    !isFiniteInteger(value.admittedAt) || value.admittedAt <= 0 ||
    !isFiniteInteger(value.leaseExpiresAt) || value.leaseExpiresAt <= 0
  ) return undefined;
  return value as unknown as WriterOwner;
}

function decodeBarrier(value: unknown): SnapshotBarrierOwner | undefined {
  if (!isObject(value) || !hasExactKeys(value, [
    "id",
    "nonce",
    "host",
    "pid",
    "deadline",
    "requestedAt",
    "leaseExpiresAt",
    "status",
    "activeAt",
  ])) return undefined;
  if (
    typeof value.id !== "string" || value.id.length === 0 ||
    typeof value.nonce !== "string" || value.nonce.length === 0 ||
    !decodeProcessOwner(value) ||
    !isFiniteInteger(value.deadline) || value.deadline <= 0 ||
    !isFiniteInteger(value.requestedAt) || value.requestedAt <= 0 ||
    !isFiniteInteger(value.leaseExpiresAt) || value.leaseExpiresAt <= 0 ||
    (value.status !== "requested" && value.status !== "active") ||
    (value.activeAt !== null && (!isFiniteInteger(value.activeAt) || value.activeAt <= 0)) ||
    (value.status === "requested" && value.activeAt !== null) ||
    (value.status === "active" && value.activeAt === null)
  ) return undefined;
  return value as unknown as SnapshotBarrierOwner;
}

function decodeState(value: unknown): AdmissionState | undefined {
  if (!isObject(value) || !hasExactKeys(value, [
    "version",
    "revision",
    "nextWriterSequence",
    "tickets",
    "writerOwner",
    "snapshotBarrier",
  ])) return undefined;
  if (
    value.version !== STATE_VERSION ||
    !isFiniteInteger(value.revision) || value.revision < 0 ||
    !isFiniteInteger(value.nextWriterSequence) || value.nextWriterSequence <= 0 ||
    !Array.isArray(value.tickets)
  ) return undefined;
  const tickets = value.tickets.map(decodeWaitingTicket);
  if (tickets.some((ticket) => ticket === undefined)) return undefined;
  const writerOwner = value.writerOwner === null ? null : decodeWriterOwner(value.writerOwner);
  const snapshotBarrier = value.snapshotBarrier === null
    ? null
    : decodeBarrier(value.snapshotBarrier);
  if (writerOwner === undefined || snapshotBarrier === undefined) return undefined;
  const decodedTickets = tickets as Array<WaitingTicket>;
  const sequences = new Set(decodedTickets.map((ticket) => ticket.sequence));
  const ids = new Set(decodedTickets.map((ticket) => ticket.id));
  if (sequences.size !== decodedTickets.length || ids.size !== decodedTickets.length) {
    return undefined;
  }
  if (
    writerOwner !== null &&
    (sequences.has(writerOwner.sequence) || ids.has(writerOwner.id))
  ) return undefined;
  const largestSequence = Math.max(
    0,
    ...decodedTickets.map((ticket) => ticket.sequence),
    writerOwner?.sequence ?? 0,
  );
  if (value.nextWriterSequence <= largestSequence) return undefined;
  return {
    version: 1,
    revision: value.revision,
    nextWriterSequence: value.nextWriterSequence,
    tickets: decodedTickets,
    writerOwner,
    snapshotBarrier,
  };
}

function decodeMutexOwner(value: unknown): MutexOwner | undefined {
  if (!isObject(value) || !hasExactKeys(value, [
    "version",
    "host",
    "pid",
    "nonce",
    "expiresAt",
  ])) return undefined;
  if (
    value.version !== STATE_VERSION || !decodeProcessOwner(value) ||
    typeof value.nonce !== "string" || value.nonce.length === 0 ||
    !isFiniteInteger(value.expiresAt) || value.expiresAt <= 0
  ) return undefined;
  return value as unknown as MutexOwner;
}

function readBoundedJson(
  path: string,
): Effect.Effect<
  unknown | undefined,
  RecordFileSystemError | RecordCoordinationStateInvalid
> {
  return Effect.gen(function* () {
    const metadata = yield* nodeIo({ operation: "read-file", path, run: () => lstat(path) }).pipe(
      Effect.catchAll((error) => isMissing(error.cause) ? Effect.succeed(undefined) : Effect.fail(error)),
    );
    if (metadata === undefined) return undefined;
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAXIMUM_METADATA_BYTES) {
      return yield* Effect.fail(recordCoordinationStateInvalid());
    }
    const text = yield* nodeIo({ operation: "read-file", path, run: () => readFile(path, "utf8") }).pipe(
      Effect.catchAll((error) => isMissing(error.cause) ? Effect.succeed(undefined) : Effect.fail(error)),
    );
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return yield* Effect.fail(recordCoordinationStateInvalid());
    }
  });
}

function processIsKnownDead(owner: { readonly host: string; readonly pid: number }): boolean {
  if (owner.host !== hostname()) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (cause) {
    return errorCode(cause) === "ESRCH";
  }
}

function checkWait(
  operation: RecordCoordinationWaitKind,
  deadline: number,
  signal?: AbortSignal,
): Effect.Effect<void, RecordCoordinationError> {
  if (signal?.aborted === true) {
    return Effect.fail(recordCoordinationCanceled(operation));
  }
  if (Date.now() >= deadline) {
    return Effect.fail(recordCoordinationTimedOut(operation, deadline));
  }
  return Effect.void;
}

function validateRequest(
  operation: RecordCoordinationWaitKind,
  request: RecordCoordinationWaitRequest,
): Effect.Effect<void, RecordCoordinationError> {
  if (!Number.isSafeInteger(request.deadlineEpochMs) || request.deadlineEpochMs <= 0) {
    return Effect.fail(recordCoordinationDeadlineInvalid(operation, request.deadlineEpochMs));
  }
  return checkWait(operation, request.deadlineEpochMs, request.signal);
}

function mutexOwnerPath(layout: AdmissionLayout): string {
  return join(layout.mutexPath, "owner.json");
}

function inspectMutexOwner(
  layout: AdmissionLayout,
): Effect.Effect<MutexOwner | undefined, RecordCoordinationError> {
  return readBoundedJson(mutexOwnerPath(layout)).pipe(
    Effect.flatMap((value) => {
      if (value === undefined) return Effect.succeed(undefined);
      const owner = decodeMutexOwner(value);
      return owner === undefined
        ? Effect.fail(recordCoordinationStateInvalid())
        : Effect.succeed(owner);
    }),
  );
}

function directoryPresentFailClosed(
  path: string,
): Effect.Effect<boolean, RecordCoordinationError> {
  return nodeIo({ operation: "read-file", path, run: () => lstat(path) }).pipe(
    Effect.catchAll((error) => isMissing(error.cause) ? Effect.succeed(undefined) : Effect.fail(error)),
    Effect.flatMap((metadata) => {
      if (metadata === undefined) return Effect.succeed(false);
      return metadata.isDirectory() && !metadata.isSymbolicLink()
        ? Effect.succeed(true)
        : Effect.fail(recordCoordinationStateInvalid());
    }),
  );
}

function retireMutexToOwnedTombstone(
  layout: AdmissionLayout,
  expectedNonce: string,
  tombstone: string,
): Effect.Effect<boolean, RecordCoordinationError> {
  return nodeIo({
    operation: "publish-directory",
    path: layout.mutexPath,
    run: () => rename(layout.mutexPath, tombstone),
  }).pipe(
    Effect.as(true),
    Effect.catchAll((error) => isMissing(error.cause) ? Effect.succeed(false) : Effect.fail(error)),
    Effect.flatMap((retired) => {
      if (!retired) return Effect.succeed(false);
      return Effect.gen(function* () {
        // The shared name is released atomically. Verify the directory that was
        // actually moved before deleting it, so a verify -> rename ABA can
        // never make this finalizer recursively delete a later claimant.
        const value = yield* readBoundedJson(join(tombstone, "owner.json"));
        if (value === undefined) {
          return yield* Effect.fail(recordCoordinationStateInvalid());
        }
        const owner = decodeMutexOwner(value);
        if (owner === undefined || owner.nonce !== expectedNonce) {
          return yield* Effect.fail(recordCoordinationStateInvalid());
        }
        yield* syncDirectory(layout.root);
        yield* removeDirectoryIfPresent(tombstone);
        yield* syncDirectory(layout.root);
        return true;
      });
    }),
  );
}

function removeClaimTombstoneIfPresent(
  layout: AdmissionLayout,
  nonce: string,
  tombstone: string,
): Effect.Effect<void, RecordCoordinationError> {
  return Effect.gen(function* () {
    const value = yield* readBoundedJson(join(tombstone, "owner.json"));
    if (value === undefined) {
      if (yield* directoryPresentFailClosed(tombstone)) {
        return yield* Effect.fail(recordCoordinationStateInvalid());
      }
      return;
    }
    const owner = decodeMutexOwner(value);
    if (owner === undefined || owner.nonce !== nonce) {
      return yield* Effect.fail(recordCoordinationStateInvalid());
    }
    yield* removeDirectoryIfPresent(tombstone);
    yield* syncDirectory(layout.root);
  });
}

function tryPublishMutexCandidate(
  layout: AdmissionLayout,
  candidatePath: string,
): Effect.Effect<boolean, RecordFileSystemError> {
  return nodeIo({
    operation: "publish-directory",
    path: layout.mutexPath,
    run: () => rename(candidatePath, layout.mutexPath),
  }).pipe(
    Effect.as(true),
    Effect.catchAll((error) =>
      isAlreadyExists(error.cause) ? Effect.succeed(false) : Effect.fail(error)
    ),
  );
}

function reclaimKnownStaleMutex(
  layout: AdmissionLayout,
  owner: MutexOwner,
): Effect.Effect<boolean, RecordCoordinationError> {
  if (owner.expiresAt > Date.now() || !processIsKnownDead(owner)) {
    return Effect.succeed(false);
  }
  const tombstone = join(
    layout.root,
    `state.mutex.stale.${owner.nonce}.${process.pid}.${randomUUID()}`,
  );
  return retireMutexToOwnedTombstone(layout, owner.nonce, tombstone);
}

function acquireMutex(
  layout: AdmissionLayout,
  operation: RecordCoordinationWaitKind,
  deadline: number,
  signal?: AbortSignal,
): Effect.Effect<MutexClaim, RecordCoordinationError> {
  return Effect.gen(function* () {
    yield* ensureDirectory(layout.root);
    while (true) {
      yield* checkWait(operation, deadline, signal);
      const nonce = randomUUID();
      const candidatePath = join(
        layout.root,
        `state.mutex.candidate.${process.pid}.${randomUUID()}`,
      );
      yield* nodeIo({
        operation: "create-directory",
        path: candidatePath,
        run: () => mkdir(candidatePath, { mode: 0o700 }),
      });
      const published = yield* writeDurableJson(join(candidatePath, "owner.json"), {
        version: STATE_VERSION,
        host: hostname(),
        pid: process.pid,
        nonce,
        expiresAt: Date.now() + MUTEX_LEASE_MILLISECONDS,
      }).pipe(
        Effect.zipRight(tryPublishMutexCandidate(layout, candidatePath)),
        Effect.onError(() => removeDirectoryIfPresent(candidatePath).pipe(Effect.orDie)),
      );
      if (published) {
        yield* syncDirectory(layout.root);
        return { layout, nonce };
      }
      yield* removeDirectoryIfPresent(candidatePath);
      const owner = yield* inspectMutexOwner(layout);
      if (owner === undefined) continue;
      if (yield* reclaimKnownStaleMutex(layout, owner)) continue;
      yield* Effect.sleep(POLL_MILLISECONDS);
    }
  });
}

function releaseMutex(claim: MutexClaim): Effect.Effect<void, RecordCoordinationError> {
  return Effect.gen(function* () {
    const tombstone = join(
      claim.layout.root,
      `state.mutex.released.${claim.nonce}`,
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const value = yield* readBoundedJson(mutexOwnerPath(claim.layout));
      if (value === undefined) {
        if (yield* directoryPresentFailClosed(claim.layout.mutexPath)) {
          return yield* Effect.fail(recordCoordinationStateInvalid());
        }
        yield* removeClaimTombstoneIfPresent(claim.layout, claim.nonce, tombstone);
        return;
      }
      const owner = decodeMutexOwner(value);
      if (owner === undefined || owner.nonce !== claim.nonce) {
        return yield* Effect.fail(recordCoordinationStateInvalid());
      }
      if (yield* retireMutexToOwnedTombstone(claim.layout, claim.nonce, tombstone)) {
        return;
      }
      // The shared name disappeared after verification. Re-read once to
      // distinguish an idempotently completed release from a later owner.
    }
    return yield* Effect.fail(recordCoordinationStateInvalid());
  });
}

function initialState(): AdmissionState {
  return {
    version: 1,
    revision: 0,
    nextWriterSequence: 1,
    tickets: [],
    writerOwner: null,
    snapshotBarrier: null,
  };
}

function readState(layout: AdmissionLayout): Effect.Effect<AdmissionState | undefined, RecordCoordinationError> {
  return readBoundedJson(layout.statePath).pipe(
    Effect.flatMap((value) => {
      if (value === undefined) return Effect.succeed(undefined);
      const state = decodeState(value);
      return state === undefined
        ? Effect.fail(recordCoordinationStateInvalid())
        : Effect.succeed(state);
    }),
  );
}

function recoverKnownStaleOwners(state: AdmissionState, now: number): void {
  state.tickets = state.tickets.filter((ticket) => ticket.deadline > now && !processIsKnownDead(ticket));
  if (
    state.writerOwner !== null &&
    (state.writerOwner.deadline <= now || processIsKnownDead(state.writerOwner))
  ) {
    state.writerOwner = null;
  }
  if (
    state.snapshotBarrier !== null &&
    (state.snapshotBarrier.deadline <= now || processIsKnownDead(state.snapshotBarrier))
  ) {
    state.snapshotBarrier = null;
  }
}

function mutateState<A>(
  layout: AdmissionLayout,
  operation: RecordCoordinationWaitKind,
  deadline: number,
  signal: AbortSignal | undefined,
  mutate: (state: AdmissionState) => A,
): Effect.Effect<A, RecordCoordinationError> {
  return Effect.acquireUseRelease(
    acquireMutex(layout, operation, deadline, signal),
    () => Effect.gen(function* () {
      const state = (yield* readState(layout)) ?? initialState();
      recoverKnownStaleOwners(state, Date.now());
      const result = mutate(state);
      state.revision += 1;
      yield* writeDurableJson(layout.statePath, state);
      return result;
    }),
    (claim) => releaseMutex(claim).pipe(Effect.orDie),
  );
}

function enqueueWriter(
  layout: AdmissionLayout,
  request: RecordCoordinationWaitRequest,
): Effect.Effect<WaitingTicket, RecordCoordinationError> {
  const ticket: WaitingTicket = {
    id: randomUUID(),
    sequence: 0,
    host: hostname(),
    pid: process.pid,
    deadline: request.deadlineEpochMs,
    enqueuedAt: Date.now(),
  };
  return mutateState(
    layout,
    "write-batch",
    request.deadlineEpochMs,
    request.signal,
    (state) => {
      const enqueued = { ...ticket, sequence: state.nextWriterSequence };
      state.nextWriterSequence += 1;
      state.tickets.push(enqueued);
      return enqueued;
    },
  );
}

function cancelWriter(
  layout: AdmissionLayout,
  ticketId: string,
): Effect.Effect<void, RecordCoordinationError> {
  const cleanupDeadline = Date.now() + MUTEX_LEASE_MILLISECONDS * 5;
  return mutateState(layout, "write-batch", cleanupDeadline, undefined, (state) => {
    state.tickets = state.tickets.filter((ticket) => ticket.id !== ticketId);
    if (
      state.writerOwner?.id === ticketId &&
      state.writerOwner.host === hostname() &&
      state.writerOwner.pid === process.pid
    ) {
      state.writerOwner = null;
    }
  });
}

function tryAdmitWriter(
  layout: AdmissionLayout,
  request: RecordCoordinationWaitRequest,
  ticket: WaitingTicket,
): Effect.Effect<WriterClaim | null, RecordCoordinationError> {
  return mutateState(
    layout,
    "write-batch",
    request.deadlineEpochMs,
    request.signal,
    (state) => {
      if (state.writerOwner !== null || state.snapshotBarrier !== null) return null;
      const first = state.tickets.reduce<WaitingTicket | undefined>(
        (current, candidate) =>
          current === undefined || candidate.sequence < current.sequence ? candidate : current,
        undefined,
      );
      if (first?.id !== ticket.id) return null;
      const now = Date.now();
      const nonce = randomUUID();
      state.tickets = state.tickets.filter((candidate) => candidate.id !== ticket.id);
      state.writerOwner = {
        ...first,
        nonce,
        admittedAt: now,
        leaseExpiresAt: Math.min(first.deadline, now + OWNER_LEASE_MILLISECONDS),
      };
      return { layout, ticketId: first.id, nonce };
    },
  );
}

function waitForWriter(
  layout: AdmissionLayout,
  request: RecordCoordinationWaitRequest,
  ticket: WaitingTicket,
): Effect.Effect<WriterClaim, RecordCoordinationError> {
  return Effect.gen(function* () {
    while (true) {
      yield* checkWait("write-batch", request.deadlineEpochMs, request.signal);
      const claim = yield* tryAdmitWriter(layout, request, ticket);
      if (claim !== null) return claim;
      yield* Effect.sleep(POLL_MILLISECONDS);
    }
  });
}

function releaseWriter(claim: WriterClaim): Effect.Effect<void, RecordCoordinationError> {
  const cleanupDeadline = Date.now() + MUTEX_LEASE_MILLISECONDS * 5;
  return mutateState(claim.layout, "write-batch", cleanupDeadline, undefined, (state) => {
    const owner = state.writerOwner;
    if (owner === null) return true;
    if (owner.id !== claim.ticketId || owner.nonce !== claim.nonce) {
      return false;
    }
    state.writerOwner = null;
    return true;
  }).pipe(
    Effect.flatMap((released) =>
      released ? Effect.void : Effect.fail(recordCoordinationStateInvalid())
    ),
  );
}

export function enterRecordWriteBatchNode(
  request: RecordCoordinationWaitRequest,
): Effect.Effect<
  RecordWriteBatchAdmission,
  RecordCoordinationError,
  import("effect").Scope.Scope
> {
  return Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    yield* validateRequest("write-batch", request);
    const layout = yield* layoutFor(request.root);
    const ticket = yield* enqueueWriter(layout, request);
    const claim = yield* restore(waitForWriter(layout, request, ticket)).pipe(
      Effect.onError(() => cancelWriter(layout, ticket.id).pipe(Effect.orDie)),
    );
    yield* Effect.addFinalizer(() => releaseWriter(claim).pipe(Effect.orDie));
    return issueRecordWriteBatchAdmission();
  }));
}

function tryRequestBarrier(
  layout: AdmissionLayout,
  request: RecordCoordinationWaitRequest,
  barrierId: string,
  nonce: string,
): Effect.Effect<boolean, RecordCoordinationError> {
  return mutateState(
    layout,
    "snapshot-barrier",
    request.deadlineEpochMs,
    request.signal,
    (state) => {
      if (state.snapshotBarrier !== null) return false;
      const now = Date.now();
      state.snapshotBarrier = {
        id: barrierId,
        nonce,
        host: hostname(),
        pid: process.pid,
        deadline: request.deadlineEpochMs,
        requestedAt: now,
        leaseExpiresAt: Math.min(request.deadlineEpochMs, now + OWNER_LEASE_MILLISECONDS),
        status: "requested",
        activeAt: null,
      };
      return true;
    },
  );
}

function tryActivateBarrier(
  layout: AdmissionLayout,
  request: RecordCoordinationWaitRequest,
  barrierId: string,
  nonce: string,
): Effect.Effect<BarrierClaim | null, RecordCoordinationError> {
  return mutateState(
    layout,
    "snapshot-barrier",
    request.deadlineEpochMs,
    request.signal,
    (state) => {
      const barrier = state.snapshotBarrier;
      if (barrier === null || barrier.id !== barrierId || barrier.nonce !== nonce) {
        return null;
      }
      if (state.writerOwner !== null) return null;
      if (barrier.status === "requested") {
        state.snapshotBarrier = { ...barrier, status: "active", activeAt: Date.now() };
      }
      return { layout, barrierId, nonce };
    },
  );
}

function cancelBarrier(
  layout: AdmissionLayout,
  barrierId: string,
  nonce: string,
): Effect.Effect<void, RecordCoordinationError> {
  const cleanupDeadline = Date.now() + MUTEX_LEASE_MILLISECONDS * 5;
  return mutateState(layout, "snapshot-barrier", cleanupDeadline, undefined, (state) => {
    const barrier = state.snapshotBarrier;
    if (barrier?.id === barrierId && barrier.nonce === nonce) {
      state.snapshotBarrier = null;
    }
  });
}

function waitForBarrier(
  layout: AdmissionLayout,
  request: RecordCoordinationWaitRequest,
  barrierId: string,
  nonce: string,
): Effect.Effect<BarrierClaim, RecordCoordinationError> {
  return Effect.gen(function* () {
    let requested = false;
    while (true) {
      yield* checkWait("snapshot-barrier", request.deadlineEpochMs, request.signal);
      if (!requested) {
        requested = yield* tryRequestBarrier(layout, request, barrierId, nonce);
      }
      if (requested) {
        const claim = yield* tryActivateBarrier(layout, request, barrierId, nonce);
        if (claim !== null) return claim;
      }
      yield* Effect.sleep(POLL_MILLISECONDS);
    }
  });
}

export function enterRecordSnapshotBarrierNode(
  request: RecordCoordinationWaitRequest,
): Effect.Effect<
  RecordSnapshotBarrier,
  RecordCoordinationError,
  import("effect").Scope.Scope
> {
  return Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    yield* validateRequest("snapshot-barrier", request);
    const layout = yield* layoutFor(request.root);
    const barrierId = randomUUID();
    const nonce = randomUUID();
    const claim = yield* restore(waitForBarrier(layout, request, barrierId, nonce)).pipe(
      Effect.onError(() => cancelBarrier(layout, barrierId, nonce).pipe(Effect.orDie)),
    );
    yield* Effect.addFinalizer(() =>
      cancelBarrier(claim.layout, claim.barrierId, claim.nonce).pipe(Effect.orDie)
    );
    return issueRecordSnapshotBarrier();
  }));
}
