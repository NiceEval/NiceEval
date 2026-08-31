import { Context, Effect, Stream } from "effect";
import type { RecordFileSystemError, RecordPathKind } from "./errors.ts";
import type { RecordRoot } from "./root.ts";

/**
 * A portable root-relative path request. It is not a capability: every live
 * platform operation validates these data again, including forged JS objects.
 */
export interface RecordPortablePath {
  readonly root: RecordRoot;
  readonly segments: readonly string[];
}

export function recordPortablePath(
  root: RecordRoot,
  ...segments: readonly string[]
): RecordPortablePath {
  return Object.freeze({ root, segments: Object.freeze([...segments]) });
}

export interface RecordDirectoryEntry {
  readonly name: string;
  readonly kind: Exclude<RecordPathKind, "missing">;
}

export interface RecordListDirectoryInput {
  readonly directory: RecordPortablePath;
  readonly maximumEntries: number;
}

export interface RecordReadFileInput {
  readonly file: RecordPortablePath;
  readonly maximumBytes: number;
}

export interface RecordReadFileStreamInput extends RecordReadFileInput {
  readonly chunkBytes?: number;
}

export type RecordFileWriteMode = "exclusive" | "replace" | "replace-no-follow";

export interface RecordWriteFileInput {
  readonly file: RecordPortablePath;
  readonly bytes: Uint8Array;
  readonly maximumBytes: number;
  readonly mode: RecordFileWriteMode;
}

export interface RecordWriteFileStreamInput<E, R> {
  readonly file: RecordPortablePath;
  readonly stream: Stream.Stream<Uint8Array, E, R>;
  readonly maximumBytes: number;
  readonly mode: RecordFileWriteMode;
}

/**
 * Portable Record file operations only. Lock files and other live operation
 * state are intentionally owned by the separate lease services below.
 */
export interface RecordFileSystemService {
  readonly pathKind: (
    path: RecordPortablePath,
  ) => Effect.Effect<RecordPathKind, RecordFileSystemError>;
  readonly ensureDirectory: (
    directory: RecordPortablePath,
  ) => Effect.Effect<void, RecordFileSystemError>;
  readonly createDirectory: (
    directory: RecordPortablePath,
  ) => Effect.Effect<void, RecordFileSystemError>;
  readonly listDirectory: (
    input: RecordListDirectoryInput,
  ) => Effect.Effect<readonly RecordDirectoryEntry[], RecordFileSystemError>;
  readonly readFile: (
    input: RecordReadFileInput,
  ) => Effect.Effect<Uint8Array | undefined, RecordFileSystemError>;
  readonly readFileStream: (
    input: RecordReadFileStreamInput,
  ) => Stream.Stream<Uint8Array, RecordFileSystemError>;
  readonly writeFile: (
    input: RecordWriteFileInput,
  ) => Effect.Effect<void, RecordFileSystemError>;
  /** Same-directory fsync + rename commit for an existing portable file. */
  readonly replaceFileAtomic: (
    input: Omit<RecordWriteFileInput, "mode">,
  ) => Effect.Effect<void, RecordFileSystemError>;
  readonly writeFileStream: <E, R>(
    input: RecordWriteFileStreamInput<E, R>,
  ) => Effect.Effect<void, RecordFileSystemError | E, R>;
  readonly syncDirectory: (
    directory: RecordPortablePath,
  ) => Effect.Effect<void, RecordFileSystemError>;
  /** Maintenance-only exact portable file removal; missing is idempotent success. */
  readonly removeFile: (
    file: RecordPortablePath,
  ) => Effect.Effect<void, RecordFileSystemError>;
  /** Maintenance-only empty directory removal; missing is idempotent success. */
  readonly removeEmptyDirectory: (
    directory: RecordPortablePath,
  ) => Effect.Effect<void, RecordFileSystemError>;

}

export class RecordFileSystem extends Context.Service<RecordFileSystem, RecordFileSystemService>()(
  "@niceeval/record/RecordFileSystem",
) {}

/** Entropy is a writer-only capability, not a reader requirement. */
export interface RecordEntropyService {
  readonly uuid: Effect.Effect<string>;
}

export class RecordEntropy extends Context.Service<RecordEntropy, RecordEntropyService>()(
  "@niceeval/record/RecordEntropy",
) {}
