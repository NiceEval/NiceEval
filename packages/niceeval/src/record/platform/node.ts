import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  opendir,
  rename,
  rmdir,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { constants, type Dir } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { Effect, Layer, Stream } from "effect";
import { NodeRecordCoordinationLive } from "../../coordination/platform/node.ts";
import { isPortableSegment } from "../model/identifiers.ts";
import {
  RecordIoError,
  RecordPathAlreadyExists,
  RecordPathInvalid,
  RecordPathTypeInvalid,
  RecordPermissionError,
  RecordResourceLimitExceeded,
  RecordResourceLimitInvalid,
  RecordRootInvalid,
  type RecordFileSystemError,
  type RecordPathKind,
  type RecordPlatformOperation,
  type RecordPlatformResource,
} from "./errors.ts";
import { recordRootPaths } from "./root.ts";
import {
  RecordEntropy,
  RecordFileSystem,
  recordPortablePath,
  type RecordDirectoryEntry,
  type RecordFileSystemService,
  type RecordPortablePath,
  type RecordWriteFileStreamInput,
} from "./services.ts";

const DEFAULT_STREAM_CHUNK_BYTES = 64 * 1024;

function nodeErrorCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) {
    return undefined;
  }

  const code = Reflect.get(cause, "code");
  return typeof code === "string" ? code : undefined;
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
    Effect.andThen(syncDirectoryAt(path)),
    Effect.andThen(
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
  }).pipe(Effect.andThen(syncDirectoryAt(dirname(path))));
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
            Effect.andThen(syncHandle(handle, "sync-file", input.path)),
          ),
        ),
      ),
    );
    yield* syncDirectoryAt(parent);
  });
}

function replaceBytesAtomicallyAt(input: {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly maximumBytes: number;
  readonly portableRoot: string;
}): Effect.Effect<void, RecordFileSystemError> {
  const parent = dirname(input.path);
  const temporary = join(parent, `.niceeval-record-${randomUUID()}.tmp`);
  return Effect.uninterruptible(
    Effect.gen(function* () {
      const target = yield* pathKindAt(input.path);
      if (target !== "file") {
        return yield* Effect.fail(new RecordPathTypeInvalid({
          code: "record-path-type-invalid",
          path: input.path,
          expected: "file",
          actual: target,
        }));
      }
      yield* writeBytesAt({
        path: temporary,
        portableRoot: input.portableRoot,
        bytes: input.bytes,
        maximumBytes: input.maximumBytes,
        mode: "exclusive",
      });
      yield* Effect.tryPromise({
        try: () => rename(temporary, input.path),
        catch: (cause) => fileSystemError("write-file", input.path, cause),
      });
      yield* syncDirectoryAt(parent);
    }).pipe(
      Effect.ensuring(removeFileIfPresentAt(temporary, "remove-path").pipe(Effect.orDie)),
    ),
  );
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

  return Stream.unwrap(
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
  }).pipe(Effect.andThen(syncDirectoryAt(dirname(path))));
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
  }).pipe(Effect.andThen(syncDirectoryAt(dirname(path))));
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
      () => [] as readonly Uint8Array[],
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
            Effect.andThen(syncHandle(handle, "sync-file", input.path)),
          );
        }),
      ),
    );
    yield* syncDirectoryAt(parent);
  });
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
        () => [] as readonly Uint8Array[],
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

  replaceFileAtomic: (input) =>
    Effect.flatMap(resolvePortablePath(input.file, true), (path) => {
      const paths = recordRootPaths(input.file.root);
      if (paths === undefined) {
        return Effect.fail(new RecordRootInvalid({ code: "record-root-invalid" }));
      }
      return replaceBytesAtomicallyAt({
        path,
        portableRoot: paths.portableRoot,
        bytes: input.bytes,
        maximumBytes: input.maximumBytes,
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
                Effect.andThen(syncHandle(handle, "sync-file", path)),
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

};

export const NodeRecordFileSystemLive = Layer.succeed(
  RecordFileSystem,
  nodeFileSystem,
);

export const NodeRecordEntropyLive = Layer.succeed(RecordEntropy, {
  uuid: Effect.sync(randomUUID),
});

/**
 * Convenience composition for an application boundary. Consumers still name
 * only the Tags they need in their own Effect requirements.
 */
export const NodeRecordLive = Layer.mergeAll(
  NodeRecordFileSystemLive,
  NodeRecordCoordinationLive,
  NodeRecordEntropyLive,
);
