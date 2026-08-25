import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, unlink, type FileHandle } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Layer } from "effect";
import type { RecordId } from "../../record/model/identifiers.ts";
import {
  RecordIoError,
  RecordMaintenanceBusy,
  RecordPathAlreadyExists,
  RecordPermissionError,
  RecordRootInvalid,
  type RecordFileSystemError,
  type RecordPlatformOperation,
} from "../../record/platform/errors.ts";
import type { RecordRoot } from "../../record/platform/root.ts";
import { recordCoordinationIdentity } from "../identity.ts";
import {
  enterRecordSnapshotBarrierNode,
  enterRecordWriteBatchNode,
} from "./node-record-admission.ts";
import {
  RecordCoordination,
  issueRecordLease,
  recordCoordinationIdentityMismatch,
  type RecordCoordinationError,
  type RecordCoordinationService,
  type RecordLease,
  type RecordLeaseKind,
} from "../record-leases.ts";

interface LeaseLayout {
  readonly localStateRoot: string;
  readonly recordKey: string;
  readonly readDirectory: string;
  readonly appendDirectory: string;
  readonly maintenanceFile: string;
  readonly identityFile: string;
}

interface IdentityFile {
  readonly version: 1;
  readonly recordKey: string;
  readonly recordId: string;
}

const textEncoder = new TextEncoder();
const leases = new WeakMap<RecordLease, string>();
const MAXIMUM_LEASE_PAYLOAD_BYTES = 4_096;

interface LeasePayload {
  readonly version: 1;
  readonly kind: RecordLeaseKind;
  readonly host: string;
  readonly pid: number;
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
  return errorCode(cause) === "EEXIST";
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
    : new RecordIoError({
        code: "record-io-error",
        operation,
        path,
        cause,
      });
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

function layoutFor(root: unknown): Effect.Effect<LeaseLayout, RecordRootInvalid> {
  const identity = recordCoordinationIdentity(root);
  return identity === undefined
    ? Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }))
    : Effect.succeed(
        Object.freeze({
          localStateRoot: identity.localStateRoot,
          recordKey: identity.recordKey,
          readDirectory: join(identity.localStateRoot, "leases", "read"),
          appendDirectory: join(identity.localStateRoot, "leases", "append"),
          maintenanceFile: join(identity.localStateRoot, "leases", "maintenance.lock"),
          identityFile: join(identity.localStateRoot, "identity.json"),
        }),
      );
}

function ensureDirectory(path: string): Effect.Effect<void, RecordFileSystemError> {
  return nodeIo({
    operation: "create-directory",
    path,
    run: () => mkdir(path, { recursive: true }),
  });
}

function closeHandle(
  handle: FileHandle,
  operation: RecordPlatformOperation,
  path: string,
): Effect.Effect<void> {
  return nodeIo({ operation, path, run: () => handle.close() }).pipe(Effect.orDie);
}

function syncDirectory(path: string): Effect.Effect<void, RecordFileSystemError> {
  return Effect.scoped(
    Effect.acquireRelease(
      nodeIo({ operation: "sync-directory", path, run: () => open(path, "r") }),
      (handle) => closeHandle(handle, "sync-directory", path),
    ).pipe(
      Effect.flatMap((handle) =>
        nodeIo({ operation: "sync-directory", path, run: () => handle.sync() }),
      ),
    ),
  );
}

function writeExclusiveFile(
  path: string,
  bytes: Uint8Array,
): Effect.Effect<void, RecordFileSystemError> {
  const parent = dirname(path);
  const acquire = Effect.tryPromise({
    try: () => open(path, "wx", 0o600),
    catch: (cause) =>
      isAlreadyExists(cause)
        ? new RecordPathAlreadyExists({
            code: "record-path-already-exists",
            path,
          })
        : fileSystemError("write-file", path, cause),
  });
  return Effect.gen(function* () {
    yield* ensureDirectory(parent);
    yield* Effect.scoped(
      Effect.acquireRelease(
        acquire,
        (handle) => closeHandle(handle, "write-file", path),
      ).pipe(
        Effect.flatMap((handle) =>
          nodeIo({ operation: "write-file", path, run: () => handle.writeFile(bytes) }).pipe(
            Effect.zipRight(
              nodeIo({ operation: "sync-file", path, run: () => handle.sync() }),
            ),
          ),
        ),
      ),
    );
    yield* syncDirectory(parent);
  });
}

function removeFileIfPresent(
  path: string,
): Effect.Effect<void, RecordFileSystemError> {
  return nodeIo({ operation: "release-record-lease", path, run: () => unlink(path) }).pipe(
    Effect.catchAll((error) =>
      isMissing(error.cause) ? Effect.void : Effect.fail(error),
    ),
    Effect.zipRight(syncDirectory(dirname(path))),
  );
}

function pathPresent(path: string): Effect.Effect<boolean, RecordFileSystemError> {
  return nodeIo({ operation: "read-file", path, run: async () => {
    try {
      await readFile(path);
      return true;
    } catch (cause) {
      if (isMissing(cause)) return false;
      throw cause;
    }
  } });
}

function leasePayload(kind: RecordLeaseKind): Uint8Array {
  return textEncoder.encode(
    JSON.stringify({
      version: 1,
      kind,
      host: hostname(),
      pid: process.pid,
      nonce: randomUUID(),
    }),
  );
}

function decodeLeasePayload(value: unknown): LeasePayload | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (
    Object.keys(value).length !== 5 ||
    Reflect.get(value, "version") !== 1 ||
    (Reflect.get(value, "kind") !== "read" &&
      Reflect.get(value, "kind") !== "append" &&
      Reflect.get(value, "kind") !== "maintenance") ||
    typeof Reflect.get(value, "host") !== "string" ||
    typeof Reflect.get(value, "pid") !== "number" ||
    !Number.isSafeInteger(Reflect.get(value, "pid")) ||
    Reflect.get(value, "pid") <= 0 ||
    typeof Reflect.get(value, "nonce") !== "string" ||
    Reflect.get(value, "nonce").length === 0
  ) return undefined;
  return value as LeasePayload;
}

/** Only ESRCH proves that a same-host lease owner no longer exists. */
function ownerIsKnownDead(payload: LeasePayload): boolean {
  if (payload.host !== hostname()) return false;
  try {
    process.kill(payload.pid, 0);
    return false;
  } catch (cause) {
    return errorCode(cause) === "ESRCH";
  }
}

function leaseFileIsKnownStale(
  path: string,
  expectedKind: RecordLeaseKind,
): Effect.Effect<boolean, RecordFileSystemError> {
  return Effect.gen(function* () {
    const metadata = yield* nodeIo({
      operation: "read-file",
      path,
      run: () => lstat(path),
    }).pipe(
      Effect.catchAll((error) => isMissing(error.cause) ? Effect.succeed(undefined) : Effect.fail(error)),
    );
    if (metadata === undefined) return true;
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAXIMUM_LEASE_PAYLOAD_BYTES) {
      return false;
    }
    const bytes = yield* nodeIo({
      operation: "read-file",
      path,
      run: () => readFile(path),
    }).pipe(
      Effect.catchAll((error) => isMissing(error.cause) ? Effect.succeed(undefined) : Effect.fail(error)),
    );
    if (bytes === undefined) return true;
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      return false;
    }
    const payload = decodeLeasePayload(value);
    return payload !== undefined && payload.kind === expectedKind && ownerIsKnownDead(payload);
  });
}

function liveMaintenanceLeasePresent(
  layout: LeaseLayout,
): Effect.Effect<boolean, RecordFileSystemError> {
  return Effect.gen(function* () {
    if (!(yield* pathPresent(layout.maintenanceFile))) return false;
    if (!(yield* leaseFileIsKnownStale(layout.maintenanceFile, "maintenance"))) {
      return true;
    }
    yield* removeFileIfPresent(layout.maintenanceFile);
    return false;
  });
}

function makeLease(kind: RecordLeaseKind, path: string): RecordLease {
  const lease = issueRecordLease(kind);
  leases.set(lease, path);
  return lease;
}

function sharedDirectory(layout: LeaseLayout, kind: "read" | "append"): string {
  return kind === "read" ? layout.readDirectory : layout.appendDirectory;
}

function liveSharedEntriesPresent(
  layout: LeaseLayout,
): Effect.Effect<boolean, RecordFileSystemError> {
  const directories = [
    { path: layout.readDirectory, kind: "read" as const },
    { path: layout.appendDirectory, kind: "append" as const },
  ] as const;
  return Effect.gen(function* () {
    let occupied = false;
    for (const directory of directories) {
      yield* ensureDirectory(directory.path);
      const entries = yield* nodeIo({
        operation: "list-directory",
        path: directory.path,
        run: () => readdir(directory.path),
      });
      for (const entry of entries) {
        const path = join(directory.path, entry);
        if (yield* leaseFileIsKnownStale(path, directory.kind)) {
          yield* removeFileIfPresent(path);
        } else {
          occupied = true;
        }
      }
    }
    return occupied;
  });
}

function maintenanceBusy(
  requested: "shared" | "exclusive",
): RecordMaintenanceBusy {
  return new RecordMaintenanceBusy({ code: "record-maintenance-busy", requested });
}

function enterSharedLease(
  root: RecordRoot,
  kind: "read" | "append",
): Effect.Effect<RecordLease, RecordCoordinationError> {
  return Effect.gen(function* () {
    const layout = yield* layoutFor(root);
    const directory = sharedDirectory(layout, kind);
    yield* ensureDirectory(directory);
    if (yield* liveMaintenanceLeasePresent(layout)) {
      return yield* Effect.fail(maintenanceBusy("shared"));
    }

    const path = join(directory, `${process.pid}-${randomUUID()}.lease`);
    const created = yield* writeExclusiveFile(path, leasePayload(kind)).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          error instanceof RecordPathAlreadyExists
            ? Effect.succeed(false)
            : Effect.fail(error),
        onSuccess: () => Effect.succeed(true),
      }),
    );
    if (!created) {
      return yield* Effect.fail(maintenanceBusy("shared"));
    }

    const maintenancePresent = yield* liveMaintenanceLeasePresent(layout).pipe(
      Effect.tapError(() => removeFileIfPresent(path).pipe(Effect.orDie)),
    );
    if (maintenancePresent) {
      yield* removeFileIfPresent(path);
      return yield* Effect.fail(maintenanceBusy("shared"));
    }
    return makeLease(kind, path);
  });
}

function enterMaintenanceLease(
  root: RecordRoot,
): Effect.Effect<RecordLease, RecordCoordinationError> {
  return Effect.gen(function* () {
    const layout = yield* layoutFor(root);
    yield* ensureDirectory(dirname(layout.maintenanceFile));
    const tryCreate = () => writeExclusiveFile(
      layout.maintenanceFile,
      leasePayload("maintenance"),
    ).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          error instanceof RecordPathAlreadyExists
            ? Effect.succeed(false)
            : Effect.fail(error),
        onSuccess: () => Effect.succeed(true),
      }),
    );
    let created = yield* tryCreate();
    if (!created && !(yield* liveMaintenanceLeasePresent(layout))) {
      created = yield* tryCreate();
    }
    if (!created) {
      return yield* Effect.fail(maintenanceBusy("exclusive"));
    }

    const sharedPresent = yield* liveSharedEntriesPresent(layout).pipe(
      Effect.tapError(() => removeFileIfPresent(layout.maintenanceFile).pipe(Effect.orDie)),
    );
    if (sharedPresent) {
      yield* removeFileIfPresent(layout.maintenanceFile);
      return yield* Effect.fail(maintenanceBusy("exclusive"));
    }
    return makeLease("maintenance", layout.maintenanceFile);
  });
}

function release(lease: RecordLease): Effect.Effect<void> {
  const path = leases.get(lease);
  return path === undefined
    ? Effect.die("Record coordination lease was not issued by this platform")
    : removeFileIfPresent(path).pipe(Effect.orDie);
}

function readIdentity(
  path: string,
): Effect.Effect<IdentityFile | undefined, RecordFileSystemError> {
  return nodeIo({ operation: "read-file", path, run: () => readFile(path, "utf8") }).pipe(
    Effect.map((text) => {
      try {
        const value: unknown = JSON.parse(text);
        if (
          typeof value !== "object" || value === null || Array.isArray(value) ||
          Reflect.get(value, "version") !== 1 ||
          typeof Reflect.get(value, "recordKey") !== "string" ||
          typeof Reflect.get(value, "recordId") !== "string"
        ) {
          return undefined;
        }
        return Object.freeze({
          version: 1 as const,
          recordKey: Reflect.get(value, "recordKey") as string,
          recordId: Reflect.get(value, "recordId") as string,
        });
      } catch {
        return undefined;
      }
    }),
    Effect.catchAll((error) => isMissing(error.cause) ? Effect.succeed(undefined) : Effect.fail(error)),
  );
}

function identityBytes(input: IdentityFile): Uint8Array {
  return textEncoder.encode(JSON.stringify(input));
}

function identityMatches(
  identity: IdentityFile | undefined,
  layout: LeaseLayout,
  recordId: RecordId,
): boolean {
  return identity !== undefined &&
    identity.recordKey === layout.recordKey &&
    identity.recordId === recordId;
}

function verifyIdentity(input: {
  readonly root: RecordRoot;
  readonly recordId: RecordId;
}): Effect.Effect<void, RecordCoordinationError> {
  return Effect.gen(function* () {
    const layout = yield* layoutFor(input.root);
    yield* ensureDirectory(layout.localStateRoot);
    const existing = yield* readIdentity(layout.identityFile);
    if (existing !== undefined) {
      return identityMatches(existing, layout, input.recordId)
        ? undefined
        : yield* Effect.fail(recordCoordinationIdentityMismatch());
    }

    const expected: IdentityFile = {
      version: 1,
      recordKey: layout.recordKey,
      recordId: input.recordId,
    };
    const created = yield* writeExclusiveFile(
      layout.identityFile,
      identityBytes(expected),
    ).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          error instanceof RecordPathAlreadyExists
            ? Effect.succeed(false)
            : Effect.fail(error),
        onSuccess: () => Effect.succeed(true),
      }),
    );
    if (created) {
      return;
    }

    const raced = yield* readIdentity(layout.identityFile);
    if (!identityMatches(raced, layout, input.recordId)) {
      return yield* Effect.fail(recordCoordinationIdentityMismatch());
    }
  });
}

const nodeRecordCoordination: RecordCoordinationService = {
  enterRecordRead: (root) =>
    Effect.acquireRelease(
      enterSharedLease(root, "read"),
      (lease) => release(lease),
    ),
  enterRecordAppend: (root) =>
    Effect.acquireRelease(
      enterSharedLease(root, "append"),
      (lease) => release(lease),
    ),
  enterRecordMaintenance: (root) =>
    Effect.acquireRelease(enterMaintenanceLease(root), (lease) => release(lease)),
  verifyRecordIdentity: verifyIdentity,
  enterRecordWriteBatch: enterRecordWriteBatchNode,
  enterRecordSnapshotBarrier: enterRecordSnapshotBarrierNode,
};

export const NodeRecordCoordinationLive = Layer.succeed(
  RecordCoordination,
  nodeRecordCoordination,
);
