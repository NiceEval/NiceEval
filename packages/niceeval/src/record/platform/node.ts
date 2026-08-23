import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  opendir,
  rename,
  rmdir,
  rm,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { constants, type Dir } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { Either, Effect, Layer, Stream } from "effect";
import { recordCoordinationIdentity } from "../../coordination/identity.ts";
import { NodeRecordCoordinationLive } from "../../coordination/platform/node.ts";
import { isPortableSegment } from "../model/identifiers.ts";
import {
  RecordGitCommandError,
  RecordIoError,
  RecordPathAlreadyExists,
  RecordPathInvalid,
  RecordPathTypeInvalid,
  RecordPermissionError,
  RecordResourceLimitExceeded,
  RecordResourceLimitInvalid,
  RecordRootInvalid,
  type RecordFileSystemError,
  type RecordGitError,
  type RecordPathKind,
  type RecordPlatformOperation,
  type RecordPlatformResource,
} from "./errors.ts";
import { recordRootPaths } from "./root.ts";
import {
  RecordEntropy,
  RecordFileSystem,
  RecordGit,
  issueRecordRunStaging,
  recordPortablePath,
  recordRunStagingPaths,
  type RecordBackupState,
  type RecordDirectoryEntry,
  type RecordFileSystemService,
  type RecordIncompleteRunDelete,
  type RecordPortablePath,
  type RecordPublishRecoveryCandidate,
  type RecordRunStaging,
  type RecordRunStagingPaths,
  type RecordStagingPath,
  type RecordStagingWriteFileStreamInput,
  type RecordWriteFileStreamInput,
} from "./services.ts";

const DEFAULT_STREAM_CHUNK_BYTES = 64 * 1024;
const GIT_MAX_OUTPUT_BYTES = 1024 * 1024;
const GIT_MAX_STATUS_ENTRIES = 10_000;
const MIGRATION_SENTINEL_MAXIMUM_BYTES = 16 * 1024 * 1024;

function nodeErrorCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) {
    return undefined;
  }

  const code = Reflect.get(cause, "code");
  return typeof code === "string" ? code : undefined;
}

function nodeErrorMessage(cause: unknown): string {
  if (typeof cause !== "object" || cause === null) {
    return "";
  }

  const message = Reflect.get(cause, "message");
  return typeof message === "string" ? message : "";
}

function isPermissionError(cause: unknown): boolean {
  const code = nodeErrorCode(cause);
  return code === "EACCES" || code === "EPERM";
}

function isMissingError(cause: unknown): boolean {
  return nodeErrorCode(cause) === "ENOENT";
}

function isAlreadyExistsError(cause: unknown): boolean {
  return nodeErrorCode(cause) === "EEXIST";
}

function fileSystemError(
  operation: RecordPlatformOperation,
  path: string,
  cause: unknown,
): RecordIoError | RecordPermissionError {
  return isPermissionError(cause)
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

function isFileSystemError(cause: unknown): cause is RecordFileSystemError {
  return (
    cause instanceof RecordRootInvalid ||
    cause instanceof RecordPathInvalid ||
    cause instanceof RecordPathTypeInvalid ||
    cause instanceof RecordPathAlreadyExists ||
    cause instanceof RecordResourceLimitInvalid ||
    cause instanceof RecordResourceLimitExceeded ||
    cause instanceof RecordIoError ||
    cause instanceof RecordPermissionError
  );
}

function isFiniteNonNegativeInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function validateLimit(
  resource: RecordPlatformResource,
  maximum: number,
): Effect.Effect<void, RecordResourceLimitInvalid> {
  return isFiniteNonNegativeInteger(maximum)
    ? Effect.void
    : Effect.fail(
        new RecordResourceLimitInvalid({
          code: "record-resource-limit-invalid",
          resource,
          maximum,
        }),
      );
}

function limitExceeded(
  resource: RecordPlatformResource,
  maximum: number,
  observedAtLeast: number,
  path: string,
): RecordResourceLimitExceeded {
  return new RecordResourceLimitExceeded({
    code: "record-resource-limit-exceeded",
    resource,
    maximum,
    observedAtLeast,
    path,
  });
}

type PathResolutionError = RecordRootInvalid | RecordPathInvalid;

/**
 * `recordPortablePath` is convenience data only. Every live call reaches this
 * function, so a copied or forged JS object cannot skip portable-segment
 * validation or escape the issued root.
 */
function resolvePortablePath(
  path: RecordPortablePath,
  requireFilePath: boolean,
): Effect.Effect<string, PathResolutionError> {
  const candidate: unknown = path;
  if (typeof candidate !== "object" || candidate === null) {
    return Effect.fail(new RecordPathInvalid({
      code: "record-path-invalid",
      reason: "segment-invalid",
      segments: [],
    }));
  }

  const root = Reflect.get(candidate, "root");
  const paths = recordRootPaths(root);
  if (paths === undefined) {
    return Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
  }

  const rawSegments = Reflect.get(candidate, "segments");
  if (!Array.isArray(rawSegments)) {
    return Effect.fail(new RecordPathInvalid({
      code: "record-path-invalid",
      reason: "segment-invalid",
      segments: [],
    }));
  }

  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (typeof segment !== "string" || !isPortableSegment(segment)) {
      return Effect.fail(new RecordPathInvalid({
        code: "record-path-invalid",
        reason: "segment-invalid",
        segments,
      }));
    }
    segments.push(segment);
  }

  if (requireFilePath && segments.length === 0) {
    return Effect.fail(new RecordPathInvalid({
      code: "record-path-invalid",
      reason: "file-path-empty",
      segments,
    }));
  }

  return Effect.succeed(join(paths.portableRoot, ...segments));
}

interface RunStagingLayout extends RecordRunStagingPaths {
  readonly publicationRoot: string;
  readonly sessionRoot: string;
  readonly stagingParent: string;
  readonly destinationParent: string;
}

function runStagingLayout(input: {
  readonly root: unknown;
  readonly sessionId: unknown;
  readonly runId: unknown;
}): Effect.Effect<RunStagingLayout, RecordRootInvalid | RecordPathInvalid> {
  const rootPaths = recordRootPaths(input.root);
  const coordination = recordCoordinationIdentity(input.root);
  if (rootPaths === undefined || coordination === undefined) {
    return Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
  }
  if (
    typeof input.sessionId !== "string" ||
    typeof input.runId !== "string" ||
    !isPortableSegment(input.sessionId) ||
    !isPortableSegment(input.runId)
  ) {
    return Effect.fail(new RecordPathInvalid({
      code: "record-path-invalid",
      reason: "segment-invalid",
      segments: [
        ...(typeof input.sessionId === "string" ? [input.sessionId] : []),
        ...(typeof input.runId === "string" ? [input.runId] : []),
      ],
    }));
  }

  const publicationRoot = join(coordination.localStateRoot, "publication");
  const sessionRoot = join(publicationRoot, input.sessionId);
  const stagingParent = join(sessionRoot, "staging");
  const destinationParent = join(rootPaths.portableRoot, "runs");
  return Effect.succeed(Object.freeze({
    publicationRoot,
    sessionRoot,
    stagingParent,
    destinationParent,
    stagingPath: join(stagingParent, input.runId),
    destinationPath: join(destinationParent, input.runId),
    recoveryFilePath: join(sessionRoot, "publish-recovery.json"),
  }));
}

function makeRunStaging(input: {
  readonly root: RecordRunStaging["root"];
  readonly sessionId: string;
  readonly runId: string;
  readonly layout: RunStagingLayout;
}): RecordRunStaging {
  return issueRecordRunStaging({
    root: input.root,
    sessionId: input.sessionId,
    runId: input.runId,
    paths: {
      stagingPath: input.layout.stagingPath,
      destinationPath: input.layout.destinationPath,
      recoveryFilePath: input.layout.recoveryFilePath,
    },
  });
}

function stagingPathsOf(
  staging: unknown,
): Effect.Effect<RecordRunStagingPaths, RecordRootInvalid> {
  const paths = recordRunStagingPaths(staging);
  return paths === undefined
    ? Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }))
    : Effect.succeed(paths);
}

function resolveStagingPath(
  path: RecordStagingPath,
  requireFilePath: boolean,
): Effect.Effect<string, RecordRootInvalid | RecordPathInvalid> {
  const candidate: unknown = path;
  if (typeof candidate !== "object" || candidate === null) {
    return Effect.fail(new RecordPathInvalid({
      code: "record-path-invalid",
      reason: "segment-invalid",
      segments: [],
    }));
  }
  const staging = Reflect.get(candidate, "staging");
  const stagingPaths = recordRunStagingPaths(staging);
  if (stagingPaths === undefined) {
    return Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
  }
  const rawSegments = Reflect.get(candidate, "segments");
  if (!Array.isArray(rawSegments)) {
    return Effect.fail(new RecordPathInvalid({
      code: "record-path-invalid",
      reason: "segment-invalid",
      segments: [],
    }));
  }
  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (typeof segment !== "string" || !isPortableSegment(segment)) {
      return Effect.fail(new RecordPathInvalid({
        code: "record-path-invalid",
        reason: "segment-invalid",
        segments,
      }));
    }
    segments.push(segment);
  }
  if (requireFilePath && segments.length === 0) {
    return Effect.fail(new RecordPathInvalid({
      code: "record-path-invalid",
      reason: "file-path-empty",
      segments,
    }));
  }
  return Effect.succeed(join(stagingPaths.stagingPath, ...segments));
}

/**
 * Record must classify a symlink as `other` without following it. The platform
 * FileSystem service exposes following `stat` and names-only directory reads,
 * so this intentionally stays the narrow native no-follow adapter.
 */
async function nodePathKind(path: string): Promise<RecordPathKind> {
  try {
    const state = await lstat(path);
    if (state.isFile()) return "file";
    if (state.isDirectory()) return "directory";
    return "other";
  } catch (cause) {
    if (isMissingError(cause)) return "missing";
    throw cause;
  }
}

function pathKindAt(path: string): Effect.Effect<RecordPathKind, RecordIoError | RecordPermissionError> {
  return Effect.tryPromise({
    try: () => nodePathKind(path),
    catch: (cause) => fileSystemError("read-file", path, cause),
  });
}

function ensureDirectoryAt(path: string): Effect.Effect<void, RecordIoError | RecordPermissionError> {
  return Effect.tryPromise({
    try: async () => {
      await mkdir(path, { recursive: true });
    },
    catch: (cause) => fileSystemError("create-directory", path, cause),
  }).pipe(
    Effect.zipRight(syncDirectoryAt(path)),
    Effect.zipRight(
      dirname(path) === path ? Effect.void : syncDirectoryAt(dirname(path)),
    ),
  );
}

function closeHandle(
  handle: FileHandle,
  operation: RecordPlatformOperation,
  path: string,
): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => handle.close(),
    catch: (cause) => fileSystemError(operation, path, cause),
  }).pipe(Effect.orDie);
}

function syncHandle(
  handle: FileHandle,
  operation: RecordPlatformOperation,
  path: string,
): Effect.Effect<void, RecordIoError | RecordPermissionError> {
  return Effect.tryPromise({
    try: () => handle.sync(),
    catch: (cause) => fileSystemError(operation, path, cause),
  });
}

function syncDirectoryAt(path: string): Effect.Effect<void, RecordIoError | RecordPermissionError> {
  // Durable publication requires an explicit directory fsync. High-level
  // platform write helpers do not include this parent-directory commit step.
  const acquire = Effect.tryPromise({
    try: () => open(path, "r"),
    catch: (cause) => fileSystemError("sync-directory", path, cause),
  });

  return Effect.scoped(
    Effect.acquireRelease(acquire, (handle) =>
      closeHandle(handle, "sync-directory", path),
    ).pipe(
      Effect.flatMap((handle) => syncHandle(handle, "sync-directory", path)),
    ),
  );
}

function createDirectoryAt(path: string): Effect.Effect<void, RecordFileSystemError> {
  return Effect.tryPromise({
    try: () => mkdir(path),
    catch: (cause) =>
      isAlreadyExistsError(cause)
        ? new RecordPathAlreadyExists({
            code: "record-path-already-exists",
            path,
          })
        : fileSystemError("create-directory", path, cause),
  }).pipe(Effect.zipRight(syncDirectoryAt(dirname(path))));
}

function writeFileHandle(
  handle: FileHandle,
  bytes: Uint8Array,
  path: string,
): Effect.Effect<void, RecordIoError | RecordPermissionError> {
  return Effect.tryPromise({
    try: () => handle.writeFile(bytes),
    catch: (cause) => fileSystemError("write-file", path, cause),
  });
}

function openForWrite(
  path: string,
  mode: "exclusive" | "replace" | "replace-no-follow",
  portableRoot: string,
): Effect.Effect<FileHandle, RecordFileSystemError> {
  // `wx` + 0600 + fsync is Record's create-exclusive publication primitive;
  // do not replace it with a high-level write that weakens those guarantees.
  return Effect.tryPromise({
    try: async () => {
      if (mode !== "replace-no-follow") {
        return open(path, mode === "exclusive" ? "wx" : "w", 0o600);
      }

      const relativePath = relative(portableRoot, path);
      const segments = relativePath.split(sep);
      let current = portableRoot;
      const rootState = await lstat(current);
      if (!rootState.isDirectory()) {
        throw new RecordPathTypeInvalid({
          code: "record-path-type-invalid",
          path: current,
          expected: "directory",
          actual: rootState.isFile() ? "file" : "other",
        });
      }
      for (const segment of segments.slice(0, -1)) {
        current = join(current, segment);
        const state = await lstat(current);
        if (!state.isDirectory()) {
          throw new RecordPathTypeInvalid({
            code: "record-path-type-invalid",
            path: current,
            expected: "directory",
            actual: state.isFile() ? "file" : "other",
          });
        }
      }

      const expected = await lstat(path);
      if (!expected.isFile() || expected.nlink !== 1) {
        throw new RecordPathTypeInvalid({
          code: "record-path-type-invalid",
          path,
          expected: "file",
          actual: expected.isDirectory() ? "directory" : "other",
        });
      }
      const handle = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try {
        const actual = await handle.stat();
        if (
          !actual.isFile() || actual.nlink !== 1 ||
          actual.dev !== expected.dev || actual.ino !== expected.ino
        ) {
          throw new Error("record replace target identity changed before write");
        }
        await handle.truncate(0);
        return handle;
      } catch (cause) {
        await handle.close().catch(() => {});
        throw cause;
      }
    },
    catch: (cause) =>
      isFileSystemError(cause)
        ? cause
        : mode === "exclusive" && isAlreadyExistsError(cause)
        ? new RecordPathAlreadyExists({
            code: "record-path-already-exists",
            path,
          })
        : fileSystemError("write-file", path, cause),
  });
}

function writeBytesAt(input: {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly maximumBytes: number;
  readonly mode: "exclusive" | "replace" | "replace-no-follow";
  readonly portableRoot: string;
}): Effect.Effect<void, RecordFileSystemError> {
  return Effect.gen(function* () {
    yield* validateLimit("file-bytes", input.maximumBytes);
    if (input.bytes.byteLength > input.maximumBytes) {
      return yield* Effect.fail(
        limitExceeded(
          "file-bytes",
          input.maximumBytes,
          input.bytes.byteLength,
          input.path,
        ),
      );
    }

    const parent = dirname(input.path);
    yield* ensureDirectoryAt(parent);
    yield* Effect.scoped(
      Effect.acquireRelease(
        openForWrite(input.path, input.mode, input.portableRoot),
        (handle) => closeHandle(handle, "write-file", input.path),
      ).pipe(
        Effect.flatMap((handle) =>
          writeFileHandle(handle, input.bytes, input.path).pipe(
            Effect.zipRight(syncHandle(handle, "sync-file", input.path)),
          ),
        ),
      ),
    );
    yield* syncDirectoryAt(parent);
  });
}

function writeChunk(
  handle: FileHandle,
  bytes: Uint8Array,
  path: string,
): Effect.Effect<void, RecordIoError | RecordPermissionError> {
  return Effect.tryPromise({
    try: async () => {
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = await handle.write(bytes, offset, bytes.byteLength - offset);
        if (written.bytesWritten === 0) {
          throw new Error("Node wrote zero bytes before the chunk was complete");
        }
        offset += written.bytesWritten;
      }
    },
    catch: (cause) => fileSystemError("write-file", path, cause),
  });
}

async function* readChunks(
  handle: FileHandle,
  path: string,
  maximumBytes: number,
  chunkBytes: number,
): AsyncGenerator<Uint8Array, void, undefined> {
  let observed = 0;

  for (;;) {
    // A one-byte probe after the cap distinguishes exact-size data from an
    // over-limit file without materializing its remainder.
    const capacity = observed < maximumBytes
      ? Math.min(chunkBytes, maximumBytes - observed + 1)
      : 1;
    const chunk = new Uint8Array(capacity);
    const result = await handle.read(chunk, 0, chunk.byteLength, null);
    if (result.bytesRead === 0) return;

    observed += result.bytesRead;
    if (observed > maximumBytes) {
      throw limitExceeded("file-bytes", maximumBytes, observed, path);
    }
    yield chunk.slice(0, result.bytesRead);
  }
}

function readStreamAt(
  path: string,
  maximumBytes: number,
  chunkBytes: number,
): Stream.Stream<Uint8Array, RecordFileSystemError> {
  const acquire = Effect.tryPromise({
    try: () => open(path, "r"),
    catch: (cause) => fileSystemError("read-file", path, cause),
  });

  return Stream.unwrapScoped(
    Effect.map(
      Effect.acquireRelease(acquire, (handle) =>
        closeHandle(handle, "read-file", path),
      ),
      (handle) =>
        Stream.fromAsyncIterable(
          readChunks(handle, path, maximumBytes, chunkBytes),
          (cause) =>
            isFileSystemError(cause)
              ? cause
              : fileSystemError("read-file", path, cause),
        ),
    ),
  );
}

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) {
    length += chunk.byteLength;
  }

  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function closeDirectory(directory: Dir, path: string): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => directory.close(),
    catch: (cause) => fileSystemError("list-directory", path, cause),
  }).pipe(Effect.orDie);
}

async function readDirectoryBounded(
  directory: Dir,
  maximumEntries: number,
  path: string,
): Promise<readonly RecordDirectoryEntry[]> {
  // Dirent classification preserves the same no-follow policy as lstat above;
  // the platform names-only directory API cannot supply these entry kinds.
  const entries: RecordDirectoryEntry[] = [];
  for (;;) {
    const entry = await directory.read();
    if (entry === null) break;
    if (entries.length === maximumEntries) {
      throw limitExceeded(
        "directory-entries",
        maximumEntries,
        maximumEntries + 1,
        path,
      );
    }
    entries.push({
      name: entry.name,
      kind: entry.isFile()
        ? "file"
        : entry.isDirectory()
          ? "directory"
          : "other",
    });
  }
  entries.sort((left, right) =>
    left.name === right.name ? 0 : left.name < right.name ? -1 : 1,
  );
  return Object.freeze(entries);
}

function directoryEntriesAt(
  path: string,
  maximumEntries: number,
): Effect.Effect<readonly RecordDirectoryEntry[], RecordFileSystemError> {
  const acquire = Effect.tryPromise({
    try: () => opendir(path),
    catch: (cause) => fileSystemError("list-directory", path, cause),
  });

  return Effect.scoped(
    Effect.acquireRelease(acquire, (directory) => closeDirectory(directory, path)).pipe(
      Effect.flatMap((directory) =>
        Effect.tryPromise({
          try: () => readDirectoryBounded(directory, maximumEntries, path),
          catch: (cause) =>
            isFileSystemError(cause)
              ? cause
              : fileSystemError("list-directory", path, cause),
        }),
      ),
    ),
  );
}

function removeFileIfPresentAt(
  path: string,
  operation: "remove-path",
): Effect.Effect<void, RecordIoError | RecordPermissionError> {
  return Effect.tryPromise({
    try: async () => {
      try {
        await unlink(path);
      } catch (cause) {
        if (!isMissingError(cause)) throw cause;
      }
    },
    catch: (cause) => fileSystemError(operation, path, cause),
  }).pipe(Effect.zipRight(syncDirectoryAt(dirname(path))));
}

function removeEmptyDirectoryIfPresentAt(
  path: string,
): Effect.Effect<void, RecordIoError | RecordPermissionError> {
  return Effect.tryPromise({
    try: async () => {
      try {
        await rmdir(path);
      } catch (cause) {
        if (!isMissingError(cause)) throw cause;
      }
    },
    catch: (cause) => fileSystemError("remove-path", path, cause),
  }).pipe(Effect.zipRight(syncDirectoryAt(dirname(path))));
}

function readBytesIfFileAt(
  path: string,
  maximumBytes: number,
): Effect.Effect<Uint8Array | undefined, RecordFileSystemError> {
  return Effect.gen(function* () {
    yield* validateLimit("file-bytes", maximumBytes);
    const kind = yield* pathKindAt(path);
    if (kind === "missing") return undefined;
    if (kind !== "file") {
      return yield* Effect.fail(new RecordPathTypeInvalid({
        code: "record-path-type-invalid",
        path,
        expected: "file",
        actual: kind,
      }));
    }
    const chunks = yield* Stream.runFold(
      readStreamAt(path, maximumBytes, DEFAULT_STREAM_CHUNK_BYTES),
      [] as readonly Uint8Array[],
      (all, chunk) => [...all, chunk],
    );
    return concatChunks(chunks);
  });
}

function writeStreamAt<E, R>(input: {
  readonly path: string;
  readonly rootPath: string;
  readonly stream: Stream.Stream<Uint8Array, E, R>;
  readonly maximumBytes: number;
  readonly mode: "exclusive" | "replace" | "replace-no-follow";
}): Effect.Effect<void, RecordFileSystemError | E, R> {
  return Effect.gen(function* () {
    yield* validateLimit("file-bytes", input.maximumBytes);
    const parent = dirname(input.path);
    yield* ensureDirectoryAt(parent);
    let written = 0;

    yield* Effect.scoped(
      Effect.acquireRelease(
        openForWrite(input.path, input.mode, input.rootPath),
        (handle) => closeHandle(handle, "write-file", input.path),
      ).pipe(
        Effect.flatMap((handle) => {
          const writeOne = (
            chunk: Uint8Array,
          ): Effect.Effect<void, RecordFileSystemError> => {
            const observedAtLeast = written + chunk.byteLength;
            if (observedAtLeast > input.maximumBytes) {
              return Effect.fail(limitExceeded(
                "file-bytes",
                input.maximumBytes,
                observedAtLeast,
                input.path,
              ));
            }
            return writeChunk(handle, chunk, input.path).pipe(
              Effect.tap(() => Effect.sync(() => {
                written = observedAtLeast;
              })),
            );
          };

          return Stream.runForEach(input.stream, writeOne).pipe(
            Effect.zipRight(syncHandle(handle, "sync-file", input.path)),
          );
        }),
      ),
    );
    yield* syncDirectoryAt(parent);
  });
}

function verifySameFileSystem(
  stagingPath: string,
  destinationParent: string,
): Effect.Effect<void, RecordIoError | RecordPermissionError> {
  return Effect.tryPromise({
    try: async () => {
      const [staging, destination] = await Promise.all([
        lstat(stagingPath),
        lstat(destinationParent),
      ]);
      if (staging.dev !== destination.dev) {
        throw new Error("Record staging and destination are not on the same filesystem");
      }
    },
    catch: (cause) => fileSystemError("publish-directory", stagingPath, cause),
  });
}

function executeMoveNoClobber(
  source: string,
  destination: string,
  signal: AbortSignal,
): Promise<void> {
  if (process.platform === "win32") {
    return rename(source, destination);
  }
  if (process.platform !== "linux") {
    return Promise.reject(
      new Error("no-replace directory publication is unavailable on this Node platform"),
    );
  }
  return new Promise((resolve, reject) => {
    execFile(
      "mv",
      ["--no-clobber", "--no-target-directory", "--", source, destination],
      { signal },
      (error) => error === null ? resolve() : reject(error),
    );
  });
}

function publishDirectoryNoReplace(input: {
  readonly source: string;
  readonly destination: string;
}): Effect.Effect<void, RecordFileSystemError> {
  const destinationParent = dirname(input.destination);
  const sourceParent = dirname(input.source);
  return Effect.uninterruptible(Effect.gen(function* () {
    const sourceKind = yield* pathKindAt(input.source);
    if (sourceKind !== "directory") {
      return yield* Effect.fail(new RecordPathTypeInvalid({
        code: "record-path-type-invalid",
        path: input.source,
        expected: "directory",
        actual: sourceKind,
      }));
    }
    yield* ensureDirectoryAt(destinationParent);
    const destinationKind = yield* pathKindAt(input.destination);
    if (destinationKind !== "missing") {
      return yield* Effect.fail(new RecordPathAlreadyExists({
        code: "record-path-already-exists",
        path: input.destination,
      }));
    }
    yield* verifySameFileSystem(input.source, destinationParent);
    yield* Effect.tryPromise({
      try: (signal) => executeMoveNoClobber(input.source, input.destination, signal),
      catch: (cause) => fileSystemError("publish-directory", input.destination, cause),
    });

    const [remainingSource, publishedDestination] = yield* Effect.all([
      pathKindAt(input.source),
      pathKindAt(input.destination),
    ]);
    if (remainingSource === "directory" && publishedDestination !== "missing") {
      return yield* Effect.fail(new RecordPathAlreadyExists({
        code: "record-path-already-exists",
        path: input.destination,
      }));
    }
    if (remainingSource !== "missing" || publishedDestination !== "directory") {
      return yield* Effect.fail(new RecordIoError({
        code: "record-io-error",
        operation: "publish-directory",
        path: input.destination,
        cause: new Error("no-replace publication did not produce exactly one destination"),
      }));
    }
    yield* syncDirectoryAt(destinationParent);
    yield* syncDirectoryAt(sourceParent);
  }));
}

const nodeFileSystem: RecordFileSystemService = {
  pathKind: (path) =>
    Effect.flatMap(resolvePortablePath(path, false), (resolved) => pathKindAt(resolved)),

  ensureDirectory: (directory) =>
    Effect.flatMap(resolvePortablePath(directory, false), (resolved) =>
      ensureDirectoryAt(resolved),
    ),

  createDirectory: (directory) =>
    Effect.flatMap(resolvePortablePath(directory, true), (resolved) =>
      createDirectoryAt(resolved),
    ),

  listDirectory: (input) =>
    Effect.gen(function* () {
      const path = yield* resolvePortablePath(input.directory, false);
      yield* validateLimit("directory-entries", input.maximumEntries);
      const kind = yield* pathKindAt(path);
      if (kind === "missing") return Object.freeze([]) as readonly RecordDirectoryEntry[];
      if (kind !== "directory") {
        return yield* Effect.fail(
          new RecordPathTypeInvalid({
            code: "record-path-type-invalid",
            path,
            expected: "directory",
            actual: kind,
          }),
        );
      }
      return yield* directoryEntriesAt(path, input.maximumEntries);
    }),

  readFile: (input) =>
    Effect.gen(function* () {
      const path = yield* resolvePortablePath(input.file, true);
      yield* validateLimit("file-bytes", input.maximumBytes);
      const kind = yield* pathKindAt(path);
      if (kind === "missing") return undefined;
      if (kind !== "file") {
        return yield* Effect.fail(
          new RecordPathTypeInvalid({
            code: "record-path-type-invalid",
            path,
            expected: "file",
            actual: kind,
          }),
        );
      }

      const chunks = yield* Stream.runFold(
        readStreamAt(path, input.maximumBytes, DEFAULT_STREAM_CHUNK_BYTES),
        [] as readonly Uint8Array[],
        (all, chunk) => [...all, chunk],
      );
      return concatChunks(chunks);
    }),

  readFileStream: (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const path = yield* resolvePortablePath(input.file, true);
        yield* validateLimit("file-bytes", input.maximumBytes);
        const chunkBytes = input.chunkBytes ?? DEFAULT_STREAM_CHUNK_BYTES;
        yield* validateLimit("file-bytes", chunkBytes);
        if (chunkBytes === 0) {
          return yield* Effect.fail(
            new RecordResourceLimitInvalid({
              code: "record-resource-limit-invalid",
              resource: "file-bytes",
              maximum: chunkBytes,
            }),
          );
        }

        const kind = yield* pathKindAt(path);
        if (kind !== "file") {
          return yield* Effect.fail(
            new RecordPathTypeInvalid({
              code: "record-path-type-invalid",
              path,
              expected: "file",
              actual: kind,
            }),
          );
        }

        return readStreamAt(path, input.maximumBytes, chunkBytes);
      }),
    ),

  writeFile: (input) =>
    Effect.flatMap(resolvePortablePath(input.file, true), (path) => {
      const paths = recordRootPaths(input.file.root);
      if (paths === undefined) {
        return Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
      }
      return writeBytesAt({
        path,
        portableRoot: paths.portableRoot,
        bytes: input.bytes,
        maximumBytes: input.maximumBytes,
        mode: input.mode,
      });
    }),

  writeFileStream: <E, R>(
    input: RecordWriteFileStreamInput<E, R>,
  ): Effect.Effect<void, RecordFileSystemError | E, R> =>
    Effect.flatMap(resolvePortablePath(input.file, true), (path) =>
      Effect.gen(function* () {
        const paths = recordRootPaths(input.file.root);
        if (paths === undefined) {
          return yield* Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
        }
        yield* validateLimit("file-bytes", input.maximumBytes);
        const parent = dirname(path);
        yield* ensureDirectoryAt(parent);
        let written = 0;

        yield* Effect.scoped(
          Effect.acquireRelease(
            openForWrite(path, input.mode, paths.portableRoot),
            (handle) => closeHandle(handle, "write-file", path),
          ).pipe(
            Effect.flatMap((handle) => {
              const writeOne = (
                chunk: Uint8Array,
              ): Effect.Effect<void, RecordFileSystemError> => {
                const observedAtLeast = written + chunk.byteLength;
                if (observedAtLeast > input.maximumBytes) {
                  return Effect.fail(
                    limitExceeded(
                      "file-bytes",
                      input.maximumBytes,
                      observedAtLeast,
                      path,
                    ),
                  );
                }
                return writeChunk(handle, chunk, path).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      written = observedAtLeast;
                    }),
                  ),
                );
              };

              return Stream.runForEach(input.stream, writeOne).pipe(
                Effect.zipRight(syncHandle(handle, "sync-file", path)),
              );
            }),
          ),
        );
        yield* syncDirectoryAt(parent);
      }),
    ),

  syncDirectory: (directory) =>
    Effect.flatMap(resolvePortablePath(directory, false), (path) =>
      syncDirectoryAt(path),
    ),

  removeFile: (file) =>
    Effect.flatMap(resolvePortablePath(file, true), (path) =>
      removeFileIfPresentAt(path, "remove-path"),
    ),

  removeEmptyDirectory: (directory) =>
    Effect.flatMap(resolvePortablePath(directory, true), removeEmptyDirectoryIfPresentAt),

  createRunStaging: ({ root, sessionId, runId }) =>
    Effect.gen(function* () {
      const layout = yield* runStagingLayout({ root, sessionId, runId });
      yield* ensureDirectoryAt(layout.publicationRoot);
      yield* ensureDirectoryAt(layout.destinationParent);
      yield* verifySameFileSystem(layout.publicationRoot, layout.destinationParent);
      yield* createDirectoryAt(layout.sessionRoot);
      yield* ensureDirectoryAt(layout.stagingParent);
      yield* createDirectoryAt(layout.stagingPath);
      return makeRunStaging({ root, sessionId, runId, layout });
    }),

  openRunStaging: ({ root, sessionId, runId }) =>
    Effect.map(
      runStagingLayout({ root, sessionId, runId }),
      (layout) => makeRunStaging({ root, sessionId, runId, layout }),
    ),

  describeRunStaging: (staging) => stagingPathsOf(staging),

  stagingPathKind: (path) =>
    Effect.flatMap(resolveStagingPath(path, false), (resolved) => pathKindAt(resolved)),

  ensureStagingDirectory: (directory) =>
    Effect.flatMap(resolveStagingPath(directory, false), (resolved) =>
      ensureDirectoryAt(resolved),
    ),

  createStagingDirectory: (directory) =>
    Effect.flatMap(resolveStagingPath(directory, true), (resolved) =>
      createDirectoryAt(resolved),
    ),

  listStagingDirectory: (input) =>
    Effect.gen(function* () {
      const path = yield* resolveStagingPath(input.directory, false);
      yield* validateLimit("directory-entries", input.maximumEntries);
      const kind = yield* pathKindAt(path);
      if (kind === "missing") return Object.freeze([]) as readonly RecordDirectoryEntry[];
      if (kind !== "directory") {
        return yield* Effect.fail(new RecordPathTypeInvalid({
          code: "record-path-type-invalid",
          path,
          expected: "directory",
          actual: kind,
        }));
      }
      return yield* directoryEntriesAt(path, input.maximumEntries);
    }),

  readStagingFile: (input) =>
    Effect.flatMap(resolveStagingPath(input.file, true), (path) =>
      readBytesIfFileAt(path, input.maximumBytes),
    ),

  writeStagingFile: (input) =>
    Effect.flatMap(resolveStagingPath(input.file, true), (path) =>
      Effect.flatMap(stagingPathsOf(input.file.staging), (paths) =>
        writeBytesAt({
          path,
          portableRoot: paths.stagingPath,
          bytes: input.bytes,
          maximumBytes: input.maximumBytes,
          mode: input.mode,
        }),
      ),
    ),

  writeStagingFileStream: <E, R>(
    input: RecordStagingWriteFileStreamInput<E, R>,
  ): Effect.Effect<void, RecordFileSystemError | E, R> =>
    Effect.flatMap(resolveStagingPath(input.file, true), (path) =>
      Effect.flatMap(stagingPathsOf(input.file.staging), (paths) =>
        writeStreamAt({
          path,
          rootPath: paths.stagingPath,
          stream: input.stream,
          maximumBytes: input.maximumBytes,
          mode: input.mode,
        }),
      ),
    ),

  syncStagingDirectory: (directory) =>
    Effect.flatMap(resolveStagingPath(directory, false), (path) =>
      syncDirectoryAt(path),
    ),

  createStagingCompleteMarker: (staging) =>
    Effect.uninterruptible(
      Effect.flatMap(stagingPathsOf(staging), (paths) =>
        writeBytesAt({
          path: join(paths.stagingPath, "complete"),
          portableRoot: paths.stagingPath,
          bytes: new Uint8Array(),
          maximumBytes: 0,
          mode: "exclusive",
        }),
      ),
    ),

  isStagingCompleteMarker: (staging) =>
    Effect.flatMap(stagingPathsOf(staging), (paths) =>
      readBytesIfFileAt(join(paths.stagingPath, "complete"), 0).pipe(
        Effect.map((bytes) => bytes !== undefined && bytes.byteLength === 0),
        Effect.catchTag("RecordResourceLimitExceeded", () => Effect.succeed(false)),
        Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(false)),
      ),
    ),

  writeRunPublishRecovery: ({ staging, bytes, maximumBytes }) =>
    Effect.uninterruptible(
      Effect.flatMap(stagingPathsOf(staging), (paths) =>
        writeBytesAt({
          path: paths.recoveryFilePath,
          portableRoot: dirname(paths.recoveryFilePath),
          bytes,
          maximumBytes,
          mode: "exclusive",
        }),
      ),
    ),

  listRunPublishRecoveries: ({ root, maximumEntries, maximumManifestBytes }) =>
    Effect.gen(function* () {
      yield* validateLimit("directory-entries", maximumEntries);
      yield* validateLimit("file-bytes", maximumManifestBytes);
      const identity = recordCoordinationIdentity(root);
      if (identity === undefined) {
        return yield* Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
      }
      const publicationRoot = join(identity.localStateRoot, "publication");
      const kind = yield* pathKindAt(publicationRoot);
      if (kind === "missing") {
        return Object.freeze([]) as readonly RecordPublishRecoveryCandidate[];
      }
      if (kind !== "directory") {
        return yield* Effect.fail(new RecordPathTypeInvalid({
          code: "record-path-type-invalid",
          path: publicationRoot,
          expected: "directory",
          actual: kind,
        }));
      }
      const sessions = yield* directoryEntriesAt(publicationRoot, maximumEntries);
      const candidates: RecordPublishRecoveryCandidate[] = [];
      for (const session of sessions) {
        if (session.kind !== "directory" || !isPortableSegment(session.name)) continue;
        const bytes = yield* readBytesIfFileAt(
          join(publicationRoot, session.name, "publish-recovery.json"),
          maximumManifestBytes,
        );
        if (bytes !== undefined) {
          candidates.push(Object.freeze({
            sessionId: session.name,
            manifestBytes: bytes.slice(),
          }));
        }
      }
      return Object.freeze(candidates);
    }),

  removeRunPublishRecovery: (staging) =>
    Effect.flatMap(stagingPathsOf(staging), (paths) =>
      removeFileIfPresentAt(paths.recoveryFilePath, "remove-path"),
    ),

  publishRunStaging: (staging) =>
    Effect.gen(function* () {
      const paths = yield* stagingPathsOf(staging);
      const recoveryKind = yield* pathKindAt(paths.recoveryFilePath);
      if (recoveryKind !== "file") {
        return yield* Effect.fail(new RecordPathTypeInvalid({
          code: "record-path-type-invalid",
          path: paths.recoveryFilePath,
          expected: "file",
          actual: recoveryKind,
        }));
      }
      const manifestKind = yield* pathKindAt(join(paths.stagingPath, "seal-manifest.json"));
      if (manifestKind !== "file") {
        return yield* Effect.fail(new RecordPathTypeInvalid({
          code: "record-path-type-invalid",
          path: join(paths.stagingPath, "seal-manifest.json"),
          expected: "file",
          actual: manifestKind,
        }));
      }
      const complete = yield* nodeFileSystem.isStagingCompleteMarker(staging);
      if (!complete) {
        const actual = yield* pathKindAt(join(paths.stagingPath, "complete"));
        return actual === "missing" || actual === "directory" || actual === "other"
          ? yield* Effect.fail(new RecordPathTypeInvalid({
              code: "record-path-type-invalid",
              path: join(paths.stagingPath, "complete"),
              expected: "file",
              actual,
            }))
          : yield* Effect.fail(new RecordIoError({
              code: "record-io-error",
              operation: "publish-directory",
              path: join(paths.stagingPath, "complete"),
              cause: new Error("staged complete marker is not zero bytes"),
            }));
      }
      yield* publishDirectoryNoReplace({
        source: paths.stagingPath,
        destination: paths.destinationPath,
      });
    }),

  createRunDirectory: ({ root, runId }) =>
    Effect.gen(function* () {
      yield* nodeFileSystem.ensureDirectory(recordPortablePath(root, "runs"));
      yield* nodeFileSystem.createDirectory(recordPortablePath(root, "runs", runId));
    }),

  createCompleteMarker: ({ root, runId }) =>
    Effect.uninterruptible(
      nodeFileSystem.writeFile({
        file: recordPortablePath(root, "runs", runId, "complete"),
        bytes: new Uint8Array(),
        maximumBytes: 0,
        mode: "exclusive",
      }),
    ),

  isCompleteMarker: ({ root, runId }) =>
    nodeFileSystem.readFile({
      file: recordPortablePath(root, "runs", runId, "complete"),
      maximumBytes: 0,
    }).pipe(
      Effect.map((bytes) => bytes !== undefined && bytes.byteLength === 0),
      Effect.catchTag("RecordResourceLimitExceeded", () => Effect.succeed(false)),
      Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(false)),
    ),

  migrationSentinelPresent: (root) =>
    Effect.map(
      nodeFileSystem.pathKind(recordPortablePath(root, "migration.in-progress")),
      (kind) => kind !== "missing",
    ),

  createMigrationSentinel: (root, restoreCommit, expectedRelativePaths) =>
    Effect.uninterruptible(
      nodeFileSystem.writeFile({
        file: recordPortablePath(root, "migration.in-progress"),
        bytes: new TextEncoder().encode(`${JSON.stringify({ restoreCommit, expectedRelativePaths })}\n`),
        maximumBytes: MIGRATION_SENTINEL_MAXIMUM_BYTES,
        mode: "exclusive",
      }),
    ),

  readMigrationSentinel: (root) =>
    Effect.map(
      nodeFileSystem.readFile({
        file: recordPortablePath(root, "migration.in-progress"),
        maximumBytes: MIGRATION_SENTINEL_MAXIMUM_BYTES,
      }),
      (bytes) => {
        if (bytes === undefined) return undefined;
        try {
          const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
          if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
          const keys = Object.keys(value);
          const restoreCommit = Reflect.get(value, "restoreCommit");
          const expectedRelativePaths = Reflect.get(value, "expectedRelativePaths");
          if (
            keys.length !== 2 ||
            typeof restoreCommit !== "string" ||
            !/^[0-9a-f]{40,64}$/.test(restoreCommit) ||
            !Array.isArray(expectedRelativePaths) ||
            expectedRelativePaths.some((path) =>
              typeof path !== "string" || path.length === 0 || path.startsWith("/") ||
              path.includes("\\") || path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === ".."))
          ) return undefined;
          return Object.freeze({
            restoreCommit,
            expectedRelativePaths: Object.freeze([...expectedRelativePaths]),
          });
        } catch {
          return undefined;
        }
      },
    ),

  removeMigrationSentinel: (root) =>
    Effect.flatMap(
      resolvePortablePath(recordPortablePath(root, "migration.in-progress"), true),
      (path) => removeFileIfPresentAt(path, "remove-path"),
    ),

  deleteIncompleteRun: ({ root, runId }) =>
    Effect.gen(function* () {
      const runPath = yield* resolvePortablePath(
        recordPortablePath(root, "runs", runId),
        true,
      );
      const runKind = yield* pathKindAt(runPath);
      if (runKind === "missing") {
        return { state: "missing" } satisfies RecordIncompleteRunDelete;
      }
      if (runKind !== "directory") {
        return yield* Effect.fail(
          new RecordPathTypeInvalid({
            code: "record-path-type-invalid",
            path: runPath,
            expected: "directory",
            actual: runKind,
          }),
        );
      }

      if (yield* nodeFileSystem.isCompleteMarker({ root, runId })) {
        return { state: "skipped-complete" } satisfies RecordIncompleteRunDelete;
      }

      yield* Effect.tryPromise({
        try: () => rm(runPath, { recursive: true, force: true }),
        catch: (cause) => fileSystemError("remove-path", runPath, cause),
      });
      yield* syncDirectoryAt(dirname(runPath));
      return { state: "deleted" } satisfies RecordIncompleteRunDelete;
    }),
};

interface GitOutput {
  readonly stdout: string;
  readonly stderr: string;
}

function executeGit(
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
): Promise<GitOutput> {
  // Keep the native adapter: Record requires one bounded collection covering
  // stdout and stderr, exact argv execution, and AbortSignal cancellation.
  // CommandExecutor has no single primitive with all of those guarantees.
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd, encoding: "utf8", maxBuffer: GIT_MAX_OUTPUT_BYTES, signal },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function gitError(
  operation: "locate-worktree" | "read-head" | "inspect-status",
  cause: unknown,
): RecordGitError {
  if (nodeErrorCode(cause) === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return limitExceeded("git-output", GIT_MAX_OUTPUT_BYTES, GIT_MAX_OUTPUT_BYTES, "git");
  }
  return new RecordGitCommandError({
    code: "record-git-command-failed",
    operation,
    cause,
  });
}

function runGit(
  operation: "locate-worktree" | "read-head" | "inspect-status",
  args: readonly string[],
  cwd: string,
): Effect.Effect<GitOutput, RecordGitError> {
  return Effect.tryPromise({
    try: (signal) => executeGit(args, cwd, signal),
    catch: (cause) => gitError(operation, cause),
  });
}

function isNotGitWorktree(error: RecordGitCommandError): boolean {
  const code = nodeErrorCode(error.cause);
  return code === "ENOENT" || nodeErrorMessage(error.cause).includes("not a git repository");
}

function portablePathWithinWorktree(worktree: string, portableRoot: string): string | undefined {
  const rootRelative = relative(worktree, portableRoot);
  if (
    rootRelative === ".." ||
    rootRelative.startsWith(`..${sep}`) ||
    isAbsolute(rootRelative)
  ) {
    return undefined;
  }
  return rootRelative === "" ? "." : rootRelative;
}

interface GitStatusEntry {
  readonly status: string;
  readonly path: string;
}

function statusEntries(stdout: string): readonly GitStatusEntry[] {
  const records = stdout.split("\0").filter((entry) => entry !== "");
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const status = record.slice(0, 2);
    const path = record.length > 3 ? record.slice(3) : "";
    entries.push(Object.freeze({ status, path }));
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return Object.freeze(entries);
}

const nodeGit = {
  inspectBackupState: (root: unknown): Effect.Effect<RecordBackupState, RecordGitError> =>
    Effect.gen(function* () {
      const paths = recordRootPaths(root);
      if (paths === undefined) {
        return yield* Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
      }

      const location = yield* Effect.either(
        runGit("locate-worktree", ["rev-parse", "--show-toplevel"], dirname(paths.portableRoot)),
      );
      if (Either.isLeft(location)) {
        if (
          location.left instanceof RecordGitCommandError &&
          isNotGitWorktree(location.left)
        ) {
          return { state: "not-git-worktree" } satisfies RecordBackupState;
        }
        return yield* Effect.fail(location.left);
      }

      const worktree = location.right.stdout.trim();
      const rootRelative = portablePathWithinWorktree(worktree, paths.portableRoot);
      if (rootRelative === undefined) {
        return { state: "root-outside-worktree" } satisfies RecordBackupState;
      }

      const head = yield* runGit("read-head", ["rev-parse", "--verify", "HEAD"], worktree);
      const commit = head.stdout.trim();
      if (commit === "") {
        return yield* Effect.fail(
          new RecordGitCommandError({
            code: "record-git-command-failed",
            operation: "read-head",
            cause: new Error("git returned an empty HEAD"),
          }),
        );
      }

      const status = yield* runGit(
        "inspect-status",
        [
          "status",
          "--porcelain=v1",
          "-z",
          "--ignored",
          "--untracked-files=all",
          "--",
          rootRelative,
        ],
        worktree,
      );
      const entries = statusEntries(status.stdout);
      if (entries.length > GIT_MAX_STATUS_ENTRIES) {
        return yield* Effect.fail(
          limitExceeded(
            "git-output",
            GIT_MAX_STATUS_ENTRIES,
            GIT_MAX_STATUS_ENTRIES + 1,
            "git status",
          ),
        );
      }
      return entries.length === 0
        ? ({ state: "git-restore-point", commit } satisfies RecordBackupState)
        : ({
            state: "portable-root-dirty",
            entries: Object.freeze(entries.map((entry) => `${entry.status} ${entry.path}`)),
          } satisfies RecordBackupState);
    }),

  recoveryChangesAreExpected: (input: {
    readonly root: unknown;
    readonly restoreCommit: string;
    readonly expectedPaths: readonly RecordPortablePath[];
  }): Effect.Effect<boolean, RecordGitError | RecordFileSystemError> =>
    Effect.gen(function* () {
      const paths = recordRootPaths(input.root);
      if (paths === undefined) {
        return yield* Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
      }
      const location = yield* Effect.either(
        runGit("locate-worktree", ["rev-parse", "--show-toplevel"], dirname(paths.portableRoot)),
      );
      if (Either.isLeft(location)) return false;
      const worktree = location.right.stdout.trim();
      const rootRelative = portablePathWithinWorktree(worktree, paths.portableRoot);
      if (rootRelative === undefined) return false;
      const head = yield* runGit("read-head", ["rev-parse", "--verify", "HEAD"], worktree);
      if (head.stdout.trim() !== input.restoreCommit) return false;

      const expected = new Set<string>();
      for (const path of input.expectedPaths) {
        const resolved = yield* resolvePortablePath(path, true);
        const relativePath = portablePathWithinWorktree(worktree, resolved);
        if (relativePath === undefined) return false;
        expected.add(relativePath.split(sep).join("/"));
      }
      const status = yield* runGit(
        "inspect-status",
        ["status", "--porcelain=v1", "-z", "--ignored", "--untracked-files=all", "--", rootRelative],
        worktree,
      );
      const entries = statusEntries(status.stdout);
      if (entries.length === 0 || entries.length > GIT_MAX_STATUS_ENTRIES) return false;
      return entries.every((entry) => {
        const normalized = entry.path.split(sep).join("/");
        if (!expected.has(normalized)) return false;
        return normalized.endsWith("/migration.in-progress")
          ? entry.status === "??" || entry.status === "!!"
          : entry.status === " M" || entry.status === " D";
      });
    }),
};

export const NodeRecordFileSystemLive = Layer.succeed(
  RecordFileSystem,
  nodeFileSystem,
);

export const NodeRecordEntropyLive = Layer.succeed(RecordEntropy, {
  uuid: Effect.sync(randomUUID),
});

export const NodeRecordGitLive = Layer.succeed(RecordGit, nodeGit);

/**
 * Convenience composition for an application boundary. Consumers still name
 * only the Tags they need in their own Effect requirements.
 */
export const NodeRecordLive = Layer.mergeAll(
  NodeRecordFileSystemLive,
  NodeRecordCoordinationLive,
  NodeRecordEntropyLive,
  NodeRecordGitLive,
);
