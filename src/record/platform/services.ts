import { Context, Effect, Stream } from "effect";
import type {
  RecordFileSystemError,
  RecordGitError,
  RecordMaintenanceLockError,
  RecordPathKind,
  RecordWriterLockError,
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

  readonly migrationSentinelPresent: (
    root: RecordRoot,
  ) => Effect.Effect<boolean, RecordFileSystemError>;
  readonly createMigrationSentinel: (
    root: RecordRoot,
  ) => Effect.Effect<void, RecordFileSystemError>;
  readonly removeMigrationSentinel: (
    root: RecordRoot,
  ) => Effect.Effect<void, RecordFileSystemError>;

  /**
   * Clean calls this while it owns RecordWriterLock. The final marker check is
   * deliberately adjacent to removal so a completed Run is never selected as
   * incomplete by stale discovery output.
   */
  readonly deleteIncompleteRun: (
    input: { readonly root: RecordRoot; readonly runId: string },
  ) => Effect.Effect<RecordIncompleteRunDelete, RecordFileSystemError>;
}

export class RecordFileSystem extends Context.Tag(
  "@niceeval/record/RecordFileSystem",
)<RecordFileSystem, RecordFileSystemService>() {}

export type RecordMaintenanceLockMode = "shared" | "exclusive";

/** Opaque, Scope-owned proof that the maintenance lock remains held. */
export interface RecordMaintenanceLockHandle {
  readonly mode: RecordMaintenanceLockMode;
}

/** Shared readers/writers versus exclusive migration coordination. */
export interface RecordMaintenanceLockService {
  readonly acquireShared: (
    root: RecordRoot,
  ) => Effect.Effect<
    RecordMaintenanceLockHandle,
    RecordMaintenanceLockError,
    import("effect").Scope.Scope
  >;
  readonly acquireExclusive: (
    root: RecordRoot,
  ) => Effect.Effect<
    RecordMaintenanceLockHandle,
    RecordMaintenanceLockError,
    import("effect").Scope.Scope
  >;
}

export class RecordMaintenanceLock extends Context.Tag(
  "@niceeval/record/RecordMaintenanceLock",
)<RecordMaintenanceLock, RecordMaintenanceLockService>() {}

/** Opaque, Scope-owned proof that this process is the sole Run publisher/cleaner. */
export interface RecordWriterLease {
  readonly _tag: "RecordWriterLease";
}

export interface RecordWriterLockService {
  readonly acquire: (
    root: RecordRoot,
  ) => Effect.Effect<
    RecordWriterLease,
    RecordWriterLockError,
    import("effect").Scope.Scope
  >;
}

export class RecordWriterLock extends Context.Tag(
  "@niceeval/record/RecordWriterLock",
)<RecordWriterLock, RecordWriterLockService>() {}

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
}

export class RecordGit extends Context.Tag("@niceeval/record/RecordGit")<
  RecordGit,
  RecordGitService
>() {}
