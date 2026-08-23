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

const recordRunStagingTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordRunStaging",
);

/** Package-private capability for one owner-private sidecar staging Run. */
export interface RecordRunStaging {
  readonly root: RecordRoot;
  readonly sessionId: string;
  readonly runId: string;
  readonly [recordRunStagingTypeId]: typeof recordRunStagingTypeId;
}

export interface RecordRunStagingPaths {
  readonly stagingPath: string;
  readonly destinationPath: string;
  readonly recoveryFilePath: string;
}

const stagingPaths = new WeakMap<object, RecordRunStagingPaths>();

/** @internal Only a platform implementation may issue a staging capability. */
export function issueRecordRunStaging(input: {
  readonly root: RecordRoot;
  readonly sessionId: string;
  readonly runId: string;
  readonly paths: RecordRunStagingPaths;
}): RecordRunStaging {
  const issued: RecordRunStaging = {
    root: input.root,
    sessionId: input.sessionId,
    runId: input.runId,
    [recordRunStagingTypeId]: recordRunStagingTypeId,
  };
  const staging = Object.freeze(issued);
  stagingPaths.set(staging, Object.freeze({ ...input.paths }));
  return staging;
}

/** @internal Rejects copied or forged staging handles. */
export function recordRunStagingPaths(
  staging: unknown,
): RecordRunStagingPaths | undefined {
  return typeof staging === "object" && staging !== null
    ? stagingPaths.get(staging)
    : undefined;
}

export interface RecordStagingPath {
  readonly staging: RecordRunStaging;
  readonly segments: readonly string[];
}

export function recordStagingPath(
  staging: RecordRunStaging,
  ...segments: readonly string[]
): RecordStagingPath {
  return Object.freeze({ staging, segments: Object.freeze([...segments]) });
}

export interface RecordPublishRecoveryCandidate {
  readonly sessionId: string;
  readonly manifestBytes: Uint8Array;
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

export interface RecordStagingReadFileInput {
  readonly file: RecordStagingPath;
  readonly maximumBytes: number;
}

export interface RecordStagingWriteFileInput {
  readonly file: RecordStagingPath;
  readonly bytes: Uint8Array;
  readonly maximumBytes: number;
  readonly mode: RecordFileWriteMode;
}

export interface RecordStagingWriteFileStreamInput<E, R> {
  readonly file: RecordStagingPath;
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

  /** Exclusively creates a Git-excluded Run staging directory in the local sidecar. */
  readonly createRunStaging: (input: {
    readonly root: RecordRoot;
    readonly sessionId: string;
    readonly runId: string;
  }) => Effect.Effect<RecordRunStaging, RecordFileSystemError>;
  /** Reissues the exact local paths used by persisted recovery state. */
  readonly openRunStaging: (input: {
    readonly root: RecordRoot;
    readonly sessionId: string;
    readonly runId: string;
  }) => Effect.Effect<RecordRunStaging, RecordFileSystemError>;
  readonly describeRunStaging: (
    staging: RecordRunStaging,
  ) => Effect.Effect<RecordRunStagingPaths, RecordFileSystemError>;
  readonly stagingPathKind: (
    path: RecordStagingPath,
  ) => Effect.Effect<RecordPathKind, RecordFileSystemError>;
  readonly ensureStagingDirectory: (
    directory: RecordStagingPath,
  ) => Effect.Effect<void, RecordFileSystemError>;
  readonly createStagingDirectory: (
    directory: RecordStagingPath,
  ) => Effect.Effect<void, RecordFileSystemError>;
  readonly listStagingDirectory: (input: {
    readonly directory: RecordStagingPath;
    readonly maximumEntries: number;
  }) => Effect.Effect<readonly RecordDirectoryEntry[], RecordFileSystemError>;
  readonly readStagingFile: (
    input: RecordStagingReadFileInput,
  ) => Effect.Effect<Uint8Array | undefined, RecordFileSystemError>;
  readonly writeStagingFile: (
    input: RecordStagingWriteFileInput,
  ) => Effect.Effect<void, RecordFileSystemError>;
  readonly writeStagingFileStream: <E, R>(
    input: RecordStagingWriteFileStreamInput<E, R>,
  ) => Effect.Effect<void, RecordFileSystemError | E, R>;
  readonly syncStagingDirectory: (
    directory: RecordStagingPath,
  ) => Effect.Effect<void, RecordFileSystemError>;
  /** The only operation that creates the staged zero-byte `complete` marker. */
  readonly createStagingCompleteMarker: (
    staging: RecordRunStaging,
  ) => Effect.Effect<void, RecordFileSystemError>;
  readonly isStagingCompleteMarker: (
    staging: RecordRunStaging,
  ) => Effect.Effect<boolean, RecordFileSystemError>;
  /** Persists the already-encoded recovery document beside, never inside, staging. */
  readonly writeRunPublishRecovery: (input: {
    readonly staging: RecordRunStaging;
    readonly bytes: Uint8Array;
    readonly maximumBytes: number;
  }) => Effect.Effect<void, RecordFileSystemError>;
  readonly listRunPublishRecoveries: (input: {
    readonly root: RecordRoot;
    readonly maximumEntries: number;
    readonly maximumManifestBytes: number;
  }) => Effect.Effect<readonly RecordPublishRecoveryCandidate[], RecordFileSystemError>;
  readonly removeRunPublishRecovery: (
    staging: RecordRunStaging,
  ) => Effect.Effect<void, RecordFileSystemError>;
  /** Same-filesystem atomic publication that never replaces an existing destination. */
  readonly publishRunStaging: (
    staging: RecordRunStaging,
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
