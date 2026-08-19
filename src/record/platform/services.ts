import { Context, Effect, Stream } from "effect";
import type {
  RecordFileSystemError,
  RecordGitError,
  RecordPathKind,
} from "./errors.ts";
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

export type RecordFileWriteMode = "exclusive" | "replace";

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

export type RecordIncompleteRunDelete =
  | { readonly state: "deleted" }
  | { readonly state: "missing" }
  | { readonly state: "skipped-complete" };

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
  readonly writeFileStream: <E, R>(
    input: RecordWriteFileStreamInput<E, R>,
  ) => Effect.Effect<void, RecordFileSystemError | E, R>;
  readonly syncDirectory: (
    directory: RecordPortablePath,
  ) => Effect.Effect<void, RecordFileSystemError>;

  /** Creates `runs/<RunId>` without publishing it. */
  readonly createRunDirectory: (
    input: { readonly root: RecordRoot; readonly runId: string },
  ) => Effect.Effect<void, RecordFileSystemError>;
  /** The only platform operation that creates `runs/<RunId>/complete`. */
  readonly createCompleteMarker: (
    input: { readonly root: RecordRoot; readonly runId: string },
  ) => Effect.Effect<void, RecordFileSystemError>;
  /** True only for the zero-byte regular file created by `createCompleteMarker`. */
  readonly isCompleteMarker: (
    input: { readonly root: RecordRoot; readonly runId: string },
  ) => Effect.Effect<boolean, RecordFileSystemError>;

  readonly migrationSentinelPresent: (
    root: RecordRoot,
  ) => Effect.Effect<boolean, RecordFileSystemError>;
  readonly createMigrationSentinel: (
    root: RecordRoot,
    restoreCommit: string,
  ) => Effect.Effect<void, RecordFileSystemError>;
  /** Returns the bounded restore commit recorded by a current migration sentinel. */
  readonly readMigrationSentinelRestoreCommit: (
    root: RecordRoot,
  ) => Effect.Effect<string | undefined, RecordFileSystemError>;
  readonly removeMigrationSentinel: (
    root: RecordRoot,
  ) => Effect.Effect<void, RecordFileSystemError>;

  /** The caller already owns the exclusive maintenance lease before deletion. */
  readonly deleteIncompleteRun: (
    input: { readonly root: RecordRoot; readonly runId: string },
  ) => Effect.Effect<RecordIncompleteRunDelete, RecordFileSystemError>;
}

export class RecordFileSystem extends Context.Tag(
  "@niceeval/record/RecordFileSystem",
)<RecordFileSystem, RecordFileSystemService>() {}

/** Entropy is a writer-only capability, not a reader requirement. */
export interface RecordEntropyService {
  readonly uuid: Effect.Effect<string>;
}

export class RecordEntropy extends Context.Tag(
  "@niceeval/record/RecordEntropy",
)<RecordEntropy, RecordEntropyService>() {}

/**
 * A migration asks whether local Git can restore the current portable root;
 * absence of proof is data for the CLI confirmation flow, not an implicit OK.
 */
export type RecordBackupState =
  | { readonly state: "git-restore-point"; readonly commit: string }
  | { readonly state: "not-git-worktree" }
  | { readonly state: "root-outside-worktree" }
  | {
      readonly state: "portable-root-dirty";
      readonly entries: readonly string[];
    };

export interface RecordGitService {
  readonly inspectBackupState: (
    root: RecordRoot,
  ) => Effect.Effect<RecordBackupState, RecordGitError>;
  /** Proves HEAD is unchanged and every dirty path is an expected migration write. */
  readonly recoveryChangesAreExpected: (input: {
    readonly root: RecordRoot;
    readonly restoreCommit: string;
    readonly expectedPaths: readonly RecordPortablePath[];
  }) => Effect.Effect<boolean, RecordGitError | RecordFileSystemError>;
}

export class RecordGit extends Context.Tag("@niceeval/record/RecordGit")<
  RecordGit,
  RecordGitService
>() {}
