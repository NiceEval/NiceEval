import { createHash } from "node:crypto";
import { Deferred, Effect, Either, Exit, Schema } from "effect";
import { RecordCoordination } from "../../coordination/record-leases.ts";
import {
  recordAttachmentWriteContents,
} from "../attachment/internal.ts";
import {
  recordAttachmentClosureInvalid,
  recordAttachmentIssue,
  type RecordAttachmentPayloadInvalid,
} from "../attachment/errors.ts";
import type {
  RecordAttachmentJson,
  RecordAttachmentWrite,
  RecordBlobRef,
} from "../attachment/types.ts";
import {
  AttemptIdSchema,
  CanonicalRunRelativePathSchema,
  RecordBlobKeySchema,
  RecordFormatSchema,
  RecordIdSchema,
  RunIdSchema,
  Sha256DigestSchema,
  SlotIdSchema,
  SourceSegmentIdSchema,
  decodeRecordPublishRecoveryDocument,
  decodeSealManifestPublicationDocument,
  decodeSealManifestDocument,
  decodeSourceReceiptManifestEntry,
  decodeAttemptDocument,
  decodeMemberDocument,
  decodeRunDocument,
  encodeAttemptDocument,
  encodeMemberDocument,
  encodeRecordDocument,
  encodeRecordPublishRecoveryDocument,
  encodeRecordCore,
  encodeRunDocument,
  encodeSealManifestDocument,
  recordPublishRecoveryMatches,
  RecordExactParseOptions,
} from "../codec/index.ts";
import type { SealManifestPublicationDocument } from "../codec/seal-manifest.ts";
import {
  RecordCoreInvalid,
  RecordReferenceInvalid,
  nonEmptyRecordIssues,
  recordIssue,
  type RecordCodecError,
  type NonEmptyRecordIssues,
} from "../errors/record-errors.ts";
import {
  encodeFixedRecordAttachmentEnvelope,
  NiceEvalRecordAttachments,
  NiceEvalRecordFamilyCatalog,
  NiceEvalRecordFamilyDescriptorsByOwner,
  type FixedRecordFamilyDescriptor,
  type NiceEvalFamily,
} from "../family/catalog.ts";
import type { TurnContextsAttachment } from "../family/turn-contexts/definition.ts";
import type {
  AttemptRunnerActivitiesAttachment,
} from "../family/runner-activities/definition.ts";
import {
  runnerDiagnosticsSourceFrameIntegrityIssues,
  type RunnerDiagnosticsAttachment,
} from "../family/runner-diagnostics/definition.ts";
import {
  assertionsSourceSiteIntegrityIssues,
  type AssertionsAttachment,
} from "../family/assertions/definition.ts";
import type { SourceNavigationRelation } from "./source-navigation-relation.ts";
import type { SourcesAttachment } from "../family/sources.ts";
import type {
  AttemptDocument,
  MemberDocument,
  RecordAttachmentOwner,
  RecordAttemptRef,
  RecordDocument,
  RecordCore,
  RecordSlotIdentity,
  RunCore,
  RunDocument,
} from "../model/core.ts";
import {
  canonicalizeRunContext,
  type RunContext,
} from "../model/run-context.ts";
import { RecordSlotIdentityDefinition } from "../model/definition.ts";
import { validateExpectedSlots } from "../model/validation.ts";
import {
  RECORD_FORMAT,
  compareCanonicalIdentity,
  isCanonicalRunRelativePath,
  isPortableSegment,
  type AttemptId,
  type CanonicalRunRelativePath,
  type RecordBlobKey,
  type RecordId,
  type RunId,
  type Sha256Digest,
  type SlotId,
  type SourceSegmentId,
} from "../model/identifiers.ts";
import {
  FIXED_RECORD_FAMILIES,
  OBSERVABILITY_SOURCE_FAMILIES,
  PUBLISH_RECOVERY_FORMAT,
  SEAL_MANIFEST_FORMAT,
  type FixedRecordFamily,
  type ObservabilitySourceFamily,
  type RecordPublishRecoveryDocument,
  type SealManifestDocument,
  type SealManifestEntry,
  type SourceReceiptManifestEntry,
} from "../model/seal-manifest.ts";
import type {
  RecordCoreRead,
  RecordWarning,
} from "../model/read-state.ts";
import {
  RecordPathAlreadyExists,
  RecordIoError,
  RecordMaintenanceBusy,
  RecordPathInvalid,
  RecordPathTypeInvalid,
  type RecordFileSystemError,
} from "../platform/errors.ts";
import { recordRootPaths, type RecordRoot } from "../platform/root.ts";
import {
  RecordEntropy,
  RecordFileSystem,
  RecordGit,
  recordPortablePath,
  recordStagingPath,
  type RecordDirectoryEntry,
  type RecordEntropyService,
  type RecordFileSystemService,
  type RecordGitService,
  type RecordPortablePath,
  type RecordRunStaging,
  type RecordStagingPath,
} from "../platform/services.ts";
import {
  RecordBootstrapInvalid,
  RecordFormatUnsupported,
  RecordHandleInvalid,
  RecordMigrationInvalid,
  RecordMigrationRequired,
  RecordAutoMigrationGitSaveRequired,
  RecordMigrationGitRestoreRequired,
  RecordMigrationInterruptedState,
  RecordMigrationPlanStale,
  RecordMigrationRecoveryRequired,
  RecordReaderClosed,
  type RecordMaintenanceError,
  type RecordMaintenanceOpenError,
  type RecordReaderOpenError,
  type RecordReaderReadError,
} from "../reader/errors.ts";
import {
  RECORD_FORMAT_DOCUMENT_MAXIMUM_BYTES,
  readCurrentRecordFormat,
  readRecordFormatForMaintenance,
} from "../reader/format.ts";
import {
  inspectFixedRecordAttachmentEnvelope,
  readFixedRecordAttachment,
  type FixedRecordAttachmentRead,
  validateFixedRecordAttachmentMigrationSource,
} from "../reader/runtime.ts";
import {
  recordAttachmentEncodeError,
  recordDraftStateError,
  recordWriterClosed,
  type RecordDraftLifecycleState,
} from "../writer/errors.ts";
import {
  attachmentPayloadStrings,
  encodeAttachmentPayloadForStorage,
  encodeRecordAttachmentJsonBytes,
} from "../writer/attachment-payload.ts";
import { RECORD_JSON_MAXIMUM_BYTES, encodeRecordJsonUtf8 } from "../writer/limits.ts";
import type { RecordWriteError } from "../writer/types.ts";
import {
  cleanIncompleteRuns,
  inspectIncompleteRuns,
} from "../maintenance/runtime.ts";
import {
  attemptWriteSessionBrand,
  runWriteSessionBrand,
  selectedAttemptRefBrand,
  selectedOwnerRefBrand,
  selectedRunRefBrand,
  type AttemptWriteSession,
  type AttemptArtifactsWrite,
  type AgentTurnsWrite,
  type TurnContextsWrite,
  type SandboxCommandsWrite,
  type AttemptRunnerActivitiesWrite,
  type AttemptRunnerDiagnosticsWrite,
  type AssertionsWrite,
  type CreateReferenceRunRequest,
  type CreateRunRequest,
  type FileChangesWrite,
  type FixedFamilyRead,
  type ReadableAttempt,
  type ReadableRun,
  type RecordFormatInspection,
  type RecordHostSDK,
  type RecordCleanOperationPlan,
  type RecordMaintenanceOperationFailure,
  type RecordAttachmentMigrationTarget,
  type RecordAutomaticMigrationResult,
  type RecordMigrateOperationPlan,
  type RecordMigrateReadyPlan,
  type RecordMaintenanceSession,
  type RecordMigrationPlan,
  type RecordMigrationReceipt,
  type RecordReadSession,
  type ReferenceRunWriteSession,
  type RecordSelection,
  type RecordSelectionProblem,
  type RecordSelectionRequest,
  type RecordSealReceipt,
  type RunCompletion,
  type RunArtifactsWrite,
  type RunRunnerActivitiesWrite,
  type RunRunnerDiagnosticsWrite,
  type RunWriteSession,
  type SelectedAttemptRef,
  type SelectedOwnerRef,
  type SelectedRunRef,
  type SourcesWrite,
} from "./types.ts";

const MAXIMUM_RUN_ENTRIES = 100_000;
const MAXIMUM_ATTEMPT_ENTRIES = 100_000;
const MAXIMUM_CORE_BYTES = 1024 * 1024;
const ENTROPY_RETRY_LIMIT = 16;
const MAXIMUM_ATTACHMENT_BLOB_BYTES = 64 * 1024 * 1024;
const MAXIMUM_SEAL_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAXIMUM_PUBLISH_RECOVERIES = 100_000;
const MAXIMUM_STAGED_INVENTORY_ENTRIES = 400_000;

function sameFixedAttachmentWrite(
  actual: unknown,
  expected: { readonly write: unknown },
): boolean {
  return actual === expected.write;
}

interface ReaderLifecycle {
  closed: boolean;
}

interface SelectedAttemptRuntime {
  readonly root: RecordRoot;
  readonly lifecycle: ReaderLifecycle;
}

interface SelectedRunRuntime {
  readonly document: RunDocument;
  readonly root: RecordRoot;
  readonly lifecycle: ReaderLifecycle;
}

type SelectedOwnerRuntime =
  | { readonly kind: "run"; readonly runId: RunId }
  | { readonly kind: "attempt"; readonly ref: RecordAttemptRef };

interface ReaderRuntime {
  readonly root: RecordRoot;
  /** Exact root identity retained for the aggregate Core refine. */
  readonly record: RecordDocument;
  readonly lifecycle: ReaderLifecycle;
  readonly runs: WeakMap<SelectedRunRef, SelectedRunRuntime>;
  readonly attempts: WeakMap<SelectedAttemptRef, SelectedAttemptRuntime>;
  readonly owners: WeakMap<SelectedOwnerRef, SelectedOwnerRuntime>;
  readonly runsById: Map<RunId, SelectedRunRef>;
  readonly attemptsByKey: Map<string, SelectedAttemptRef>;
  readonly manifestsByRunId: Map<RunId, SealManifestPublicationDocument>;
  sealedCoreSnapshot: Deferred.Deferred<SealedCoreSnapshot, RecordFileSystemError> | undefined;
}

interface AttemptRuntime {
  readonly draft: RunRuntime;
  readonly attemptId: AttemptId;
  readonly slotId: SlotId;
  readonly mutex: Effect.Semaphore;
  readonly settled: Deferred.Deferred<void>;
  state: "open" | "completing" | "completed" | "failed";
  document: AttemptDocument | undefined;
  readonly attachments: Map<string, FixedAttachmentRuntime>;
  handle: AttemptWriteSession | undefined;
}

interface MembershipRuntime {
  readonly document: MemberDocument;
}

interface RunRuntime {
  readonly root: RecordRoot;
  readonly fileSystem: RecordFileSystemService;
  readonly entropy: RecordEntropyService;
  readonly record: RecordDocument;
  readonly staging: RecordRunStaging;
  readonly runId: RunId;
  readonly experimentId: CreateRunRequest["experimentId"];
  readonly context: RunContext;
  readonly startedAt: CreateRunRequest["startedAt"];
  readonly expectedSlots: readonly RecordSlotIdentity[];
  readonly expectedBySlot: ReadonlyMap<SlotId, RecordSlotIdentity>;
  readonly mutex: Effect.Semaphore;
  readonly attempts: Map<AttemptId, AttemptRuntime>;
  readonly slotReservations: Map<SlotId, "attempt" | "reference" | "terminal">;
  readonly membership: Map<SlotId, MembershipRuntime>;
  readonly attachments: Map<string, FixedAttachmentRuntime>;
  readonly inFlightMutations: Set<Deferred.Deferred<void>>;
  closed: boolean;
  markerCreated: boolean;
  state: RecordDraftLifecycleState;
  handle: object | undefined;
}

interface FixedAttachmentRuntime {
  readonly owner: RecordAttachmentOwner;
  readonly name: string;
  readonly baseSegments: readonly string[];
  readonly descriptor: FixedRecordFamilyDescriptor<
    NiceEvalFamily,
    RecordAttachmentOwner,
    unknown
  >;
  readonly write: RecordAttachmentWrite<RecordAttachmentOwner, unknown, unknown>;
  readonly blobCount: number;
  readonly attemptId: AttemptId | undefined;
}

const selectedAttemptCapabilities = new WeakMap<
  SelectedAttemptRef,
  SelectedAttemptRuntime
>();
const runSessions = new WeakMap<object, RunRuntime>();
const attemptSessions = new WeakMap<AttemptWriteSession, AttemptRuntime>();
const consumedFixedFamilyWrites = new WeakMap<object, object>();

function recordPath(root: RecordRoot, ...segments: readonly string[]) {
  return recordPortablePath(root, ...segments);
}

function runPath(root: RecordRoot, runId: RunId, ...segments: readonly string[]) {
  return recordPath(root, "runs", runId, ...segments);
}

function stagedRunPath(run: RunRuntime, ...segments: readonly string[]): RecordStagingPath {
  return recordStagingPath(run.staging, ...segments);
}

function invalidStagingPath(path: RecordPortablePath): RecordPathInvalid {
  return new RecordPathInvalid({
    code: "record-path-invalid",
    reason: "segment-invalid",
    segments: [...path.segments],
  });
}

function portableToStagingPath(input: {
  readonly root: RecordRoot;
  readonly runId: RunId;
  readonly staging: RecordRunStaging;
  readonly path: RecordPortablePath;
}): Effect.Effect<RecordStagingPath, RecordPathInvalid> {
  if (
    !sameRoot(input.root, input.path.root) ||
    input.path.segments[0] !== "runs" ||
    input.path.segments[1] !== input.runId
  ) {
    return Effect.fail(invalidStagingPath(input.path));
  }
  return Effect.succeed(recordStagingPath(input.staging, ...input.path.segments.slice(2)));
}

/**
 * The fixed Attachment reader remains the single payload/blob truth. This
 * adapter changes only its physical root from a published Run to the
 * capability-backed staging Run; every segment is still revalidated by the
 * platform staging API.
 */
function stagingReadFileSystem(input: {
  readonly root: RecordRoot;
  readonly runId: RunId;
  readonly staging: RecordRunStaging;
  readonly fileSystem: RecordFileSystemService;
}): RecordFileSystemService {
  const translate = (path: RecordPortablePath) => portableToStagingPath({ ...input, path });
  return Object.freeze({
    ...input.fileSystem,
    pathKind: (path: RecordPortablePath) =>
      Effect.flatMap(translate(path), input.fileSystem.stagingPathKind),
    listDirectory: ({ directory, maximumEntries }: {
      readonly directory: RecordPortablePath;
      readonly maximumEntries: number;
    }) =>
      Effect.flatMap(translate(directory), (stagingDirectory) =>
        input.fileSystem.listStagingDirectory({
          directory: stagingDirectory,
          maximumEntries,
        }),
      ),
    readFile: ({ file, maximumBytes }: {
      readonly file: RecordPortablePath;
      readonly maximumBytes: number;
    }) =>
      Effect.flatMap(translate(file), (stagingFile) =>
        input.fileSystem.readStagingFile({ file: stagingFile, maximumBytes }),
      ),
  });
}

function readerClosed(): RecordReaderClosed {
  return new RecordReaderClosed({ code: "record-reader-closed" });
}

function handleInvalid(): RecordHandleInvalid {
  return new RecordHandleInvalid({ code: "record-handle-invalid" });
}

function migrationInterrupted(
  restoreCommit?: string,
  restoreSafe?: boolean,
): RecordMigrationInterruptedState {
  return new RecordMigrationInterruptedState({
    code: "record-migration-interrupted",
    ...(restoreCommit === undefined ? {} : { restoreCommit }),
    ...(restoreSafe === undefined ? {} : { restoreSafe }),
  });
}

function bootstrapInvalid(): RecordBootstrapInvalid {
  return new RecordBootstrapInvalid({
    code: "record-bootstrap-invalid",
    reason: "record-document-invalid",
  });
}

function coreInvalid(): RecordCoreInvalid {
  const issues = nonEmptyRecordIssues([recordIssue("record-schema-invalid")]);
  if (issues === undefined) {
    throw new Error("Record Core invalid state must contain one issue");
  }
  return new RecordCoreInvalid({ code: "record-core-invalid", issues });
}

function coreInvalidFromCodec(error: RecordCodecError): RecordCoreInvalid {
  return new RecordCoreInvalid({
    code: "record-core-invalid",
    issues: error.issues,
  });
}

function referenceInvalid(): RecordReferenceInvalid {
  return new RecordReferenceInvalid({ code: "record-reference-invalid" });
}

function stateError(
  operation: "create-attempt" | "reference" | "publish" | "record",
  state: RecordDraftLifecycleState,
) {
  return recordDraftStateError({
    code: state === "failed" ? "record-draft-write-failed" : "record-draft-state-invalid",
    operation,
    state,
  });
}

function jsonBytes(value: unknown): Uint8Array {
  return encodeRecordJsonUtf8(value);
}

function parseJson(bytes: Uint8Array): unknown | undefined {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

function readJson(
  fileSystem: RecordFileSystemService,
  path: ReturnType<typeof recordPortablePath>,
): Effect.Effect<unknown | undefined, RecordFileSystemError> {
  return fileSystem.readFile({ file: path, maximumBytes: MAXIMUM_CORE_BYTES }).pipe(
    Effect.map((bytes) => bytes === undefined ? undefined : parseJson(bytes)),
    Effect.catchTag("RecordResourceLimitExceeded", () => Effect.succeed(undefined)),
    Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(undefined)),
  );
}

function decodeRunId(value: string): RunId | undefined {
  const decoded = Schema.decodeUnknownEither(RunIdSchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function decodeAttemptId(value: string): AttemptId | undefined {
  const decoded = Schema.decodeUnknownEither(AttemptIdSchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function orderedEntries(entries: readonly RecordDirectoryEntry[]): readonly RecordDirectoryEntry[] {
  return Object.freeze(
    [...entries].sort((left, right) => compareCanonicalIdentity(left.name, right.name)),
  );
}

function sameRoot(left: RecordRoot, right: RecordRoot): boolean {
  const leftPaths = recordRootPaths(left);
  const rightPaths = recordRootPaths(right);
  return leftPaths !== undefined && rightPaths !== undefined &&
    leftPaths.portableRoot === rightPaths.portableRoot;
}

function currentFormatInspection(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
): Effect.Effect<RecordFormatInspection, RecordMaintenanceError> {
  return readRecordFormatForMaintenance(fileSystem, root).pipe(
    Effect.flatMap(() =>
      Effect.map(
        planAttachmentMigration({ fileSystem, root }),
        (attachments): RecordFormatInspection => ({
          state: attachments.targets.length === 0
            ? "already-current"
            : "migration-required",
          format: RECORD_FORMAT,
        }),
      )
    ),
    Effect.catchAll((error) =>
      error instanceof RecordFormatUnsupported
        ? Effect.succeed({
            state: "unsupported-format" as const,
            format: error.format,
          })
        : Effect.fail(error),
    ),
  );
}

interface RunStorageView {
  readonly pathKind: (segments: readonly string[]) => Effect.Effect<
    import("../platform/errors.ts").RecordPathKind,
    RecordFileSystemError
  >;
  readonly listDirectory: (segments: readonly string[]) => Effect.Effect<
    readonly RecordDirectoryEntry[],
    RecordFileSystemError
  >;
  readonly readFile: (
    segments: readonly string[],
    maximumBytes: number,
  ) => Effect.Effect<Uint8Array | undefined, RecordFileSystemError>;
}

interface ValidatedRunPublication {
  readonly manifest: SealManifestPublicationDocument;
  readonly strictManifest: SealManifestDocument | undefined;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: Sha256Digest;
}

interface ValidatedRecoveredPublication extends ValidatedRunPublication {
  readonly strictManifest: SealManifestDocument;
}

function publishedRunStorage(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runId: RunId,
): RunStorageView {
  return Object.freeze({
    pathKind: (segments: readonly string[]) =>
      fileSystem.pathKind(runPath(root, runId, ...segments)),
    listDirectory: (segments: readonly string[]) => fileSystem.listDirectory({
      directory: runPath(root, runId, ...segments),
      maximumEntries: MAXIMUM_STAGED_INVENTORY_ENTRIES,
    }),
    readFile: (segments: readonly string[], maximumBytes: number) => fileSystem.readFile({
      file: runPath(root, runId, ...segments),
      maximumBytes,
    }),
  });
}

function stagedRunStorage(
  fileSystem: RecordFileSystemService,
  staging: RecordRunStaging,
): RunStorageView {
  return Object.freeze({
    pathKind: (segments: readonly string[]) =>
      fileSystem.stagingPathKind(recordStagingPath(staging, ...segments)),
    listDirectory: (segments: readonly string[]) => fileSystem.listStagingDirectory({
      directory: recordStagingPath(staging, ...segments),
      maximumEntries: MAXIMUM_STAGED_INVENTORY_ENTRIES,
    }),
    readFile: (segments: readonly string[], maximumBytes: number) =>
      fileSystem.readStagingFile({
      file: recordStagingPath(staging, ...segments),
      maximumBytes,
    }),
  });
}

function sha256Bytes(bytes: Uint8Array): Sha256Digest {
  const value = createHash("sha256").update(bytes).digest("hex");
  const decoded = Schema.decodeUnknownEither(Sha256DigestSchema)(value);
  if (Either.isLeft(decoded)) throw new Error("Node SHA-256 produced an invalid digest");
  return decoded.right;
}

function maximumManifestEntryBytes(entry: SealManifestEntry): number {
  switch (entry.kind) {
    case "core":
      return MAXIMUM_CORE_BYTES;
    case "attachment-envelope":
    case "payload":
      return RECORD_JSON_MAXIMUM_BYTES;
    case "blob":
      return MAXIMUM_ATTACHMENT_BLOB_BYTES;
  }
}

function readStorageFileForValidation(
  storage: RunStorageView,
  segments: readonly string[],
  maximumBytes: number,
): Effect.Effect<Uint8Array | undefined, RecordFileSystemError> {
  return storage.readFile(segments, maximumBytes).pipe(
    Effect.catchTag("RecordResourceLimitExceeded", () => Effect.succeed(undefined)),
    Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(undefined)),
  );
}

interface RunStorageShape {
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

function scanRunStorageShape(
  storage: RunStorageView,
): Effect.Effect<RunStorageShape | undefined, RecordFileSystemError> {
  return Effect.gen(function* () {
    if ((yield* storage.pathKind([])) !== "directory") return undefined;
    const pending: string[][] = [[]];
    const files: string[] = [];
    const directories: string[] = [];
    let observed = 0;
    while (pending.length > 0) {
      const directory = pending.shift()!;
      const entries = orderedEntries(yield* storage.listDirectory(directory));
      for (const entry of entries) {
        observed += 1;
        if (observed > MAXIMUM_STAGED_INVENTORY_ENTRIES || !isPortableSegment(entry.name)) {
          return undefined;
        }
        const child = [...directory, entry.name];
        const relative = child.join("/");
        if (!isCanonicalRunRelativePath(relative)) return undefined;
        if (entry.kind === "file") {
          files.push(relative);
        } else if (entry.kind === "directory") {
          directories.push(relative);
          pending.push(child);
        } else {
          // A symlink, device, or socket can never be part of portable bytes.
          return undefined;
        }
      }
    }
    files.sort(compareCanonicalIdentity);
    directories.sort(compareCanonicalIdentity);
    return Object.freeze({
      files: Object.freeze(files),
      directories: Object.freeze(directories),
    });
  });
}

function expectedInventoryDirectories(files: readonly string[]): readonly string[] {
  const directories = new Set<string>();
  for (const file of files) {
    const segments = file.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      directories.add(segments.slice(0, length).join("/"));
    }
  }
  return Object.freeze([...directories].sort(compareCanonicalIdentity));
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateOrdinaryRunRootShape(
  storage: RunStorageView,
  manifest: SealManifestPublicationDocument,
): Effect.Effect<boolean, RecordFileSystemError> {
  return Effect.gen(function* () {
    if ((yield* storage.pathKind([])) !== "directory") return false;
    const expected = new Map<string, "file" | "directory">([
      ["complete", "file"],
      ["seal-manifest.json", "file"],
    ]);
    for (const entry of manifest.entries) {
      const [head, ...tail] = entry.path.split("/");
      const kind = tail.length === 0 ? "file" as const : "directory" as const;
      const previous = expected.get(head!);
      if (previous !== undefined && previous !== kind) return false;
      expected.set(head!, kind);
    }
    const entries = orderedEntries(yield* storage.listDirectory([]));
    if (entries.length !== expected.size) return false;
    return entries.every((entry) =>
      expected.get(entry.name) === entry.kind && isPortableSegment(entry.name)
    );
  });
}

function validateRunPublication(input: {
  readonly storage: RunStorageView;
  readonly runId: RunId;
  /** Recovery validates every byte; ordinary selection defers Attachment bytes. */
  readonly fullAttachmentHashes: boolean;
  /** Only self-written staging/recovery requires every source row to close. */
  readonly strictSources: boolean;
}): Effect.Effect<ValidatedRunPublication | undefined, RecordFileSystemError> {
  return Effect.gen(function* () {
    const complete = yield* readStorageFileForValidation(input.storage, ["complete"], 0);
    if (complete === undefined || complete.byteLength !== 0) return undefined;
    const manifestBytes = yield* readStorageFileForValidation(
      input.storage,
      ["seal-manifest.json"],
      MAXIMUM_SEAL_MANIFEST_BYTES,
    );
    if (manifestBytes === undefined) return undefined;
    const json = parseJson(manifestBytes);
    if (json === undefined) return undefined;
    const publicationDecoded = decodeSealManifestPublicationDocument(json);
    if (
      Either.isLeft(publicationDecoded) ||
      publicationDecoded.right.runId !== input.runId
    ) return undefined;
    const manifest = publicationDecoded.right;
    const strictDecoded = input.strictSources
      ? decodeSealManifestDocument(json)
      : undefined;
    if (strictDecoded !== undefined && Either.isLeft(strictDecoded)) return undefined;
    const strictManifest = strictDecoded === undefined ? undefined : strictDecoded.right;

    if (input.fullAttachmentHashes) {
      const shape = yield* scanRunStorageShape(input.storage);
      if (shape === undefined) return undefined;
      const expectedFiles = [
        ...manifest.entries.map((entry) => entry.path),
        "complete",
        "seal-manifest.json",
      ].sort(compareCanonicalIdentity);
      if (
        !sameOrderedStrings(shape.files, expectedFiles) ||
        !sameOrderedStrings(shape.directories, expectedInventoryDirectories(expectedFiles))
      ) return undefined;
    } else if (!(yield* validateOrdinaryRunRootShape(input.storage, manifest))) {
      return undefined;
    }

    for (const entry of manifest.entries) {
      if (!input.fullAttachmentHashes && entry.kind !== "core") continue;
      const maximumBytes = maximumManifestEntryBytes(entry);
      if (entry.byteLength > maximumBytes) return undefined;
      const bytes = yield* readStorageFileForValidation(
        input.storage,
        entry.path.split("/"),
        maximumBytes,
      );
      if (
        bytes === undefined ||
        bytes.byteLength !== entry.byteLength ||
        sha256Bytes(bytes) !== entry.sha256
      ) return undefined;
    }
    return Object.freeze({
      manifest,
      strictManifest,
      manifestBytes: manifestBytes.slice(),
      manifestSha256: sha256Bytes(manifestBytes),
    });
  });
}

function readPublishedRunPublication(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runId: RunId,
  fullAttachmentHashes = false,
  strictSources = false,
): Effect.Effect<ValidatedRunPublication | undefined, RecordFileSystemError> {
  return validateRunPublication({
    storage: publishedRunStorage(fileSystem, root, runId),
    runId,
    fullAttachmentHashes,
    strictSources,
  });
}

function isSealedRun(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runId: RunId,
): Effect.Effect<boolean, RecordFileSystemError> {
  return Effect.map(
    readPublishedRunPublication(fileSystem, root, runId),
    (publication) => publication !== undefined,
  );
}

function readRunDocument(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runId: RunId,
): Effect.Effect<RunDocument | undefined, RecordFileSystemError> {
  return Effect.map(readJson(fileSystem, runPath(root, runId, "run.json")), (json) => {
    if (json === undefined) return undefined;
    const decoded = decodeRunDocument(json);
    return Either.isRight(decoded) && decoded.right.runId === runId
      ? decoded.right
      : undefined;
  });
}

function readAttemptDocument(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  ref: RecordAttemptRef,
): Effect.Effect<AttemptDocument | undefined, RecordFileSystemError> {
  return Effect.map(
    readJson(fileSystem, runPath(root, ref.originRunId, "attempts", ref.attemptId, "attempt.json")),
    (json) => {
      if (json === undefined) return undefined;
      const decoded = decodeAttemptDocument(json);
      return Either.isRight(decoded) &&
          decoded.right.attemptId === ref.attemptId &&
          decoded.right.originRunId === ref.originRunId
        ? decoded.right
        : undefined;
    },
  );
}

function readMemberDocument(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runId: RunId,
  slotId: SlotId,
): Effect.Effect<MemberDocument | undefined, RecordFileSystemError> {
  return Effect.map(
    readJson(fileSystem, runPath(root, runId, "members", `${slotId}.json`)),
    (json) => {
      if (json === undefined) return undefined;
      const decoded = decodeMemberDocument(json);
      return Either.isRight(decoded) && decoded.right.slotId === slotId
        ? decoded.right
        : undefined;
    },
  );
}

function decodeSlotId(value: string): SlotId | undefined {
  const decoded = Schema.decodeUnknownEither(SlotIdSchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function readRunMembers(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runId: RunId,
): Effect.Effect<readonly MemberDocument[] | undefined, RecordFileSystemError> {
  return Effect.gen(function* () {
    const directory = runPath(root, runId, "members");
    if ((yield* fileSystem.pathKind(directory)) !== "directory") return undefined;
    const entries = orderedEntries(yield* fileSystem.listDirectory({
      directory,
      maximumEntries: MAXIMUM_ATTEMPT_ENTRIES,
    }));
    const members: MemberDocument[] = [];
    for (const entry of entries) {
      if (entry.kind !== "file" || !entry.name.endsWith(".json")) return undefined;
      const slotId = decodeSlotId(entry.name.slice(0, -".json".length));
      if (slotId === undefined) return undefined;
      const member = yield* readMemberDocument(fileSystem, root, runId, slotId);
      if (member === undefined || members.some((current) => current.slotId === member.slotId)) {
        return undefined;
      }
      members.push(member);
    }
    return Object.freeze(members);
  });
}

/**
 * Reads every exact Attempt document owned by a sealed Run. An absent attempts
 * directory is legitimate for an all-reference / terminal Run; every other
 * non-directory shape is a Core failure.
 */
function readRunAttempts(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runId: RunId,
): Effect.Effect<readonly AttemptDocument[] | undefined, RecordFileSystemError> {
  return Effect.gen(function* () {
    const directory = runPath(root, runId, "attempts");
    const kind = yield* fileSystem.pathKind(directory);
    if (kind === "missing") return Object.freeze([]);
    if (kind !== "directory") return undefined;
    const entries = orderedEntries(yield* fileSystem.listDirectory({
      directory,
      maximumEntries: MAXIMUM_ATTEMPT_ENTRIES,
    }));
    const attempts: AttemptDocument[] = [];
    for (const entry of entries) {
      if (entry.kind !== "directory") return undefined;
      const attemptId = decodeAttemptId(entry.name);
      if (attemptId === undefined) return undefined;
      const attemptEntries = orderedEntries(yield* fileSystem.listDirectory({
        directory: runPath(root, runId, "attempts", attemptId),
        maximumEntries: 3,
      }));
      const attemptEntriesByName = new Map(
        attemptEntries.map((attemptEntry) => [attemptEntry.name, attemptEntry] as const),
      );
      if (
        attemptEntriesByName.size !== attemptEntries.length ||
        attemptEntriesByName.get("attempt.json")?.kind !== "file" ||
        (attemptEntriesByName.size === 2 &&
          attemptEntriesByName.get("attachments")?.kind !== "directory") ||
        (attemptEntriesByName.size !== 1 && attemptEntriesByName.size !== 2)
      ) return undefined;
      const document = yield* readAttemptDocument(fileSystem, root, {
        originRunId: runId,
        attemptId,
      });
      if (document === undefined) return undefined;
      attempts.push(document);
    }
    return Object.freeze(attempts);
  });
}

type SealedCoreSnapshot =
  | { readonly state: "available"; readonly byRunId: ReadonlyMap<RunId, RunCore> }
  | { readonly state: "core-invalid"; readonly issues: NonEmptyRecordIssues };

function maintenanceReaderRuntime(root: RecordRoot, record: RecordDocument): ReaderRuntime {
  return {
    root,
    record,
    lifecycle: { closed: false },
    runs: new WeakMap(),
    attempts: new WeakMap(),
    owners: new WeakMap(),
    runsById: new Map(),
    attemptsByKey: new Map(),
    manifestsByRunId: new Map(),
    sealedCoreSnapshot: undefined,
  };
}

/**
 * The reader deliberately reconstructs the complete published aggregate only
 * at the point where it is about to sign a Run/Attempt as available. This is
 * the same `RecordCoreDefinition` refine used by the writer's seal boundary,
 * so a marker cannot promote a partial Member denominator to availability.
 */
function loadSealedCoreSnapshot(
  runtime: ReaderRuntime,
  fileSystem: RecordFileSystemService,
  options: {
    readonly fullAttachmentHashes?: boolean;
    readonly strictSources?: boolean;
  } = {},
): Effect.Effect<SealedCoreSnapshot, RecordFileSystemError> {
  return Effect.gen(function* () {
    const entries = orderedEntries(yield* fileSystem.listDirectory({
      directory: recordPath(runtime.root, "runs"),
      maximumEntries: MAXIMUM_RUN_ENTRIES,
    }));
    const cores: RunCore[] = [];
    runtime.manifestsByRunId.clear();
    for (const entry of entries) {
      if (entry.kind !== "directory") continue;
      const runId = decodeRunId(entry.name);
      if (runId === undefined) continue;
      const complete = yield* fileSystem.isCompleteMarker({
        root: runtime.root,
        runId,
      });
      if (!complete) continue;
      const publication = yield* readPublishedRunPublication(
        fileSystem,
        runtime.root,
        runId,
        options.fullAttachmentHashes ?? false,
        options.strictSources ?? false,
      );
      // A valid zero-byte completion marker declares this Run published. Once
      // declared, malformed Core/manifest/inventory cannot be reinterpreted as
      // an absent or merely incomplete Run.
      if (publication === undefined) {
        return Object.freeze({ state: "core-invalid" as const, issues: coreInvalid().issues });
      }
      const run = yield* readRunDocument(fileSystem, runtime.root, runId);
      const members = run === undefined
        ? undefined
        : yield* readRunMembers(fileSystem, runtime.root, runId);
      const attempts = members === undefined
        ? undefined
        : yield* readRunAttempts(fileSystem, runtime.root, runId);
      if (run === undefined || members === undefined || attempts === undefined) {
        return Object.freeze({ state: "core-invalid" as const, issues: coreInvalid().issues });
      }
      const corePaths = publication.manifest.entries
        .filter((entry) => entry.kind === "core")
        .map((entry) => entry.path);
      const expectedCorePaths = [
        "run.json",
        ...members.map((member) => `members/${member.slotId}.json`),
        ...attempts.map((attempt) => `attempts/${attempt.attemptId}/attempt.json`),
      ].sort(compareCanonicalIdentity);
      if (!sameOrderedStrings(corePaths, expectedCorePaths)) {
        return Object.freeze({ state: "core-invalid" as const, issues: coreInvalid().issues });
      }
      runtime.manifestsByRunId.set(runId, publication.manifest);
      cores.push(Object.freeze({ run, members, attempts }));
    }
    const ordered = Object.freeze(
      cores.sort((left, right) => compareCanonicalIdentity(left.run.runId, right.run.runId)),
    );
    const aggregate: RecordCore = Object.freeze({ record: runtime.record, runs: ordered });
    const encoded = encodeRecordCore(aggregate);
    if (Either.isLeft(encoded)) {
      return Object.freeze({ state: "core-invalid" as const, issues: encoded.left.issues });
    }
    return Object.freeze({
      state: "available" as const,
      byRunId: new Map(ordered.map((core) => [core.run.runId, core] as const)),
    });
  });
}

/**
 * A read session holds the Record read lease, so its published Core cannot
 * change underneath it. Share one exact snapshot across selection and all
 * subsequent Run / Attempt reads instead of rebuilding the whole aggregate
 * for every capability lookup.
 */
function readSealedCoreSnapshot(
  runtime: ReaderRuntime,
  fileSystem: RecordFileSystemService,
): Effect.Effect<SealedCoreSnapshot, RecordFileSystemError> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const fresh = yield* Deferred.make<SealedCoreSnapshot, RecordFileSystemError>();
      const flight = yield* Effect.sync(() => {
        if (runtime.sealedCoreSnapshot !== undefined) {
          return { _tag: "Follower" as const, deferred: runtime.sealedCoreSnapshot };
        }
        runtime.sealedCoreSnapshot = fresh;
        return { _tag: "Leader" as const, deferred: fresh };
      });
      if (flight._tag === "Follower") return yield* restore(Deferred.await(flight.deferred));

      const completed = yield* Effect.exit(restore(loadSealedCoreSnapshot(runtime, fileSystem)));
      yield* Deferred.done(flight.deferred, completed);
      return yield* Deferred.await(flight.deferred);
    })
  );
}

function makeRunRef(runtime: ReaderRuntime, document: RunDocument): SelectedRunRef {
  const existing = runtime.runsById.get(document.runId);
  if (existing !== undefined) return existing;
  const ref: SelectedRunRef = Object.freeze({
    runId: document.runId,
    [selectedRunRefBrand]: () => undefined,
  });
  runtime.runs.set(ref, Object.freeze({
    document,
    root: runtime.root,
    lifecycle: runtime.lifecycle,
  }));
  runtime.runsById.set(document.runId, ref);
  return ref;
}

function attemptKey(ref: RecordAttemptRef): string {
  return `${ref.originRunId}\u0000${ref.attemptId}`;
}

function makeAttemptRef(runtime: ReaderRuntime, input: RecordAttemptRef): SelectedAttemptRef {
  const key = attemptKey(input);
  const existing = runtime.attemptsByKey.get(key);
  if (existing !== undefined) return existing;
  const ref: SelectedAttemptRef = Object.freeze({
    originRunId: input.originRunId,
    attemptId: input.attemptId,
    [selectedAttemptRefBrand]: () => undefined,
  });
  const contents = Object.freeze({ root: runtime.root, lifecycle: runtime.lifecycle });
  runtime.attempts.set(ref, contents);
  selectedAttemptCapabilities.set(ref, contents);
  runtime.attemptsByKey.set(key, ref);
  return ref;
}

function makeOwner(
  runtime: ReaderRuntime,
  contents: SelectedOwnerRuntime,
): SelectedOwnerRef {
  const owner: SelectedOwnerRef = Object.freeze({
    [selectedOwnerRefBrand]: () => undefined,
  });
  runtime.owners.set(owner, Object.freeze(contents));
  return owner;
}

function assertReaderLive(
  runtime: ReaderRuntime,
): Effect.Effect<void, RecordReaderReadError> {
  return runtime.lifecycle.closed ? Effect.fail(readerClosed()) : Effect.void;
}

function scanSelection(
  runtime: ReaderRuntime,
  fileSystem: RecordFileSystemService,
  request: RecordSelectionRequest | undefined,
): Effect.Effect<RecordSelection, RecordReaderReadError> {
  return Effect.gen(function* () {
    yield* assertReaderLive(runtime);
    const wanted = request?.runIds === undefined
      ? undefined
      : new Set(request.runIds);
    const snapshot = yield* readSealedCoreSnapshot(runtime, fileSystem);
    const warnings: RecordWarning[] = [];
    const problems: RecordSelectionProblem[] = [];
    const documents: RunDocument[] = [];
    if (snapshot.state === "core-invalid") {
      for (const runId of wanted ?? []) {
        problems.push(Object.freeze({ code: "record-core-invalid" as const, runId }));
      }
    } else if (wanted === undefined) {
      documents.push(...[...snapshot.byRunId.values()].map((core) => core.run));
    } else {
      for (const runId of wanted) {
        const core = snapshot.byRunId.get(runId);
        if (core === undefined) problems.push(Object.freeze({ code: "selection-run-missing" as const, runId }));
        else documents.push(core.run);
      }
    }

    const orderedDocuments = documents.sort((left, right) =>
      compareCanonicalIdentity(left.runId, right.runId)
    );
    const runFacts = orderedDocuments.map((document) => Object.freeze({
      run: makeRunRef(runtime, document),
      experimentId: document.experimentId,
      startedAt: document.startedAt,
      completedAt: document.completedAt,
      expectedSlots: Object.freeze([...document.expectedSlots]),
    }));
    const refs = runFacts.map((facts) => facts.run);
    const expectedSlots = runFacts.flatMap((facts) => {
      return facts.expectedSlots.map((slot) => Object.freeze({
        run: facts.run,
        experimentId: facts.experimentId,
        slot,
      }));
    });
    return Object.freeze({
      runRefs: Object.freeze(refs),
      runFacts: Object.freeze(runFacts),
      expectedSlots: Object.freeze(expectedSlots),
      problems: Object.freeze(problems),
      warnings: Object.freeze(warnings),
    });
  });
}

function sourceFamily(value: string): value is ObservabilitySourceFamily {
  return (OBSERVABILITY_SOURCE_FAMILIES as readonly string[]).includes(value);
}

function selectedOwnerText(owner: SelectedOwnerRuntime): "run" | AttemptId {
  return owner.kind === "run" ? "run" : owner.ref.attemptId;
}

function selectedOwnerRunId(owner: SelectedOwnerRuntime): RunId {
  return owner.kind === "run" ? owner.runId : owner.ref.originRunId;
}

function attachmentManifestEntries(
  manifest: SealManifestPublicationDocument,
  owner: SelectedOwnerRuntime,
  family: string,
): readonly SealManifestEntry[] {
  const ownerText = selectedOwnerText(owner);
  return manifest.entries.filter((entry) => entry.owner === ownerText && entry.family === family);
}

function validateManifestEntryBytes(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runId: RunId;
  readonly entries: readonly SealManifestEntry[];
}): Effect.Effect<boolean, RecordFileSystemError> {
  return Effect.gen(function* () {
    for (const entry of input.entries) {
      const maximumBytes = maximumManifestEntryBytes(entry);
      if (entry.byteLength > maximumBytes) return false;
      const bytes = yield* input.fileSystem.readFile({
        file: runPath(input.root, input.runId, ...entry.path.split("/")),
        maximumBytes,
      }).pipe(
        Effect.catchTag("RecordResourceLimitExceeded", () => Effect.succeed(undefined)),
        Effect.catchTag("RecordPathTypeInvalid", () => Effect.succeed(undefined)),
      );
      if (
        bytes === undefined ||
        bytes.byteLength !== entry.byteLength ||
        sha256Bytes(bytes) !== entry.sha256
      ) return false;
    }
    return true;
  });
}

function sourceManifestOwnerMatches(
  source: SourceReceiptManifestEntry,
  owner: SelectedOwnerRuntime,
): boolean {
  return owner.kind === "run"
    ? source.owner.kind === "run"
    : source.owner.kind === "attempt" && source.owner.attemptId === owner.ref.attemptId;
}

function rawSourceManifestIdentityMatches(
  value: unknown,
  owner: SelectedOwnerRuntime,
  family: ObservabilitySourceFamily,
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (Reflect.get(value, "family") !== family) return false;
  const candidateOwner = Reflect.get(value, "owner");
  if (
    typeof candidateOwner !== "object" || candidateOwner === null ||
    Array.isArray(candidateOwner)
  ) return false;
  return owner.kind === "run"
    ? Reflect.get(candidateOwner, "kind") === "run"
    : Reflect.get(candidateOwner, "kind") === "attempt" &&
      Reflect.get(candidateOwner, "attemptId") === owner.ref.attemptId;
}

function sourceSegmentIdentities(
  payload: unknown,
): readonly { readonly sequence: number; readonly segmentId: SourceSegmentId }[] | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const segments = Reflect.get(payload, "segments");
  if (!Array.isArray(segments)) return undefined;
  const identities: { readonly sequence: number; readonly segmentId: SourceSegmentId }[] = [];
  for (const segment of segments) {
    if (typeof segment !== "object" || segment === null || Array.isArray(segment)) return undefined;
    const sequence = Reflect.get(segment, "sequence");
    const segmentId = Reflect.get(segment, "segmentId");
    if (!Number.isSafeInteger(sequence) || sequence <= 0 || typeof segmentId !== "string") {
      return undefined;
    }
    const decoded = Schema.decodeUnknownEither(SourceSegmentIdSchema)(segmentId);
    if (Either.isLeft(decoded)) return undefined;
    identities.push(Object.freeze({ sequence, segmentId: decoded.right }));
  }
  return Object.freeze(identities);
}

function sourceManifestMatchesPayload(input: {
  readonly manifest: SealManifestPublicationDocument;
  readonly owner: SelectedOwnerRuntime;
  readonly family: ObservabilitySourceFamily;
  readonly schemaVersion: number;
  readonly payload: unknown;
}): boolean {
  const rawCandidates = input.manifest.sources.filter((candidate) =>
    rawSourceManifestIdentityMatches(candidate, input.owner, input.family)
  );
  if (rawCandidates.length !== 1) return false;
  const decoded = decodeSourceReceiptManifestEntry(rawCandidates[0]);
  if (Either.isLeft(decoded)) return false;
  const source = decoded.right;
  if (!sourceManifestOwnerMatches(source, input.owner)) return false;
  const segments = sourceSegmentIdentities(input.payload);
  if (
    source.schemaVersion !== input.schemaVersion || segments === undefined ||
    source.segments.length !== segments.length ||
    !source.segments.every((identity, index) => {
      const actual = segments[index];
      return actual !== undefined &&
        identity.sequence === actual.sequence &&
        identity.segmentId === actual.segmentId;
    })
  ) return false;

  const entries = attachmentManifestEntries(input.manifest, input.owner, input.family);
  const payloadEntries = entries.filter((entry) => entry.kind === "payload");
  const payloadEntry = payloadEntries[0];
  if (
    payloadEntries.length !== 1 || payloadEntry === undefined ||
    payloadEntry.byteLength !== source.payload.byteLength ||
    payloadEntry.sha256 !== source.payload.sha256
  ) return false;
  if (input.family !== "niceeval.sandbox-commands" && source.blobs.length > 0) return false;
  const blobEntries = entries.filter((entry) => entry.kind === "blob");
  if (blobEntries.length !== source.blobs.length) return false;
  let previousBlobKey: string | undefined;
  return source.blobs.every((blob, index) => {
    if (previousBlobKey !== undefined && compareCanonicalIdentity(previousBlobKey, blob.key) >= 0) {
      return false;
    }
    previousBlobKey = blob.key;
    const entry = blobEntries[index];
    return entry !== undefined && entry.path.endsWith(`/blobs/${blob.key}`) &&
      entry.byteLength === blob.byteLength && entry.sha256 === blob.sha256;
  });
}

type AttachmentManifestGate =
  | { readonly state: "not-recorded" }
  | {
      readonly state: "valid";
      readonly manifest: SealManifestPublicationDocument;
      readonly entries: readonly SealManifestEntry[];
    }
  | { readonly state: "invalid" };

function validateAttachmentManifestGate(input: {
  readonly runtime: ReaderRuntime;
  readonly fileSystem: RecordFileSystemService;
  readonly owner: SelectedOwnerRuntime;
  readonly family: string;
}): Effect.Effect<AttachmentManifestGate, RecordFileSystemError> {
  const runId = selectedOwnerRunId(input.owner);
  const manifest = input.runtime.manifestsByRunId.get(runId);
  if (manifest === undefined) return Effect.succeed(Object.freeze({ state: "invalid" as const }));
  const entries = attachmentManifestEntries(manifest, input.owner, input.family);
  if (entries.length === 0) {
    const attachment = input.owner.kind === "run"
      ? runPath(input.runtime.root, runId, "attachments", input.family)
      : runPath(
          input.runtime.root,
          runId,
          "attempts",
          input.owner.ref.attemptId,
          "attachments",
          input.family,
        );
    return Effect.map(
      input.fileSystem.pathKind(attachment),
      (kind): AttachmentManifestGate => kind === "missing"
        ? Object.freeze({ state: "not-recorded" as const })
        : Object.freeze({ state: "invalid" as const }),
    );
  }
  return Effect.map(
    validateManifestEntryBytes({
      fileSystem: input.fileSystem,
      root: input.runtime.root,
      runId,
      entries,
    }),
    (valid): AttachmentManifestGate => valid
      ? Object.freeze({ state: "valid" as const, manifest, entries })
      : Object.freeze({ state: "invalid" as const }),
  );
}

function invalidFixedFamilyRead<Payload>(): FixedFamilyRead<Payload> {
  return Object.freeze({ state: "invalid" as const, issues: coreInvalid().issues });
}

function invalidFixedAttachmentRead<Payload>(): FixedRecordAttachmentRead<Payload> {
  return Object.freeze({ state: "invalid" as const, issues: coreInvalid().issues });
}

function readFixedFamily<
  Family extends NiceEvalFamily,
  Owner extends RecordAttachmentOwner,
  Payload,
>(input: {
  readonly runtime: ReaderRuntime;
  readonly fileSystem: RecordFileSystemService;
  readonly owner: SelectedOwnerRef;
  readonly descriptor: FixedRecordFamilyDescriptor<Family, Owner, Payload>;
}): Effect.Effect<FixedFamilyRead<Payload>, RecordReaderReadError> {
  return Effect.suspend((): Effect.Effect<FixedFamilyRead<Payload>, RecordReaderReadError> => {
    if (input.runtime.lifecycle.closed) return Effect.fail(readerClosed());
    const owner = input.runtime.owners.get(input.owner);
    if (owner === undefined || owner.kind !== input.descriptor.owner) {
      return Effect.fail(handleInvalid());
    }
    return Effect.flatMap(validateAttachmentManifestGate({
      runtime: input.runtime,
      fileSystem: input.fileSystem,
      owner,
      family: input.descriptor.family,
    }), (gate): Effect.Effect<FixedFamilyRead<Payload>, RecordReaderReadError> => {
      if (gate.state === "not-recorded") {
        return Effect.succeed(Object.freeze({ state: "not-recorded" as const }));
      }
      if (gate.state === "invalid") return Effect.succeed(invalidFixedFamilyRead());

      const read = owner.kind === "run"
        ? readFixedRecordAttachment({
            fileSystem: input.fileSystem,
            root: input.runtime.root,
            location: Object.freeze({ owner: "run" as const, runId: owner.runId }),
            descriptor: input.descriptor as FixedRecordFamilyDescriptor<Family, "run", Payload>,
            expectedManifestEntries: gate.entries,
          })
        : readFixedRecordAttachment({
            fileSystem: input.fileSystem,
            root: input.runtime.root,
            location: Object.freeze({
              owner: "attempt" as const,
              runId: owner.ref.originRunId,
              attemptId: owner.ref.attemptId,
            }),
            descriptor: input.descriptor as FixedRecordFamilyDescriptor<Family, "attempt", Payload>,
            expectedManifestEntries: gate.entries,
          });

      return read.pipe(Effect.flatMap((value): Effect.Effect<FixedFamilyRead<Payload>, RecordFileSystemError> => {
        if (value.state !== "available") {
          return Effect.succeed(value.state === "unavailable"
            ? invalidFixedFamilyRead()
            : value);
        }
        if (
          sourceFamily(input.descriptor.family) &&
          !sourceManifestMatchesPayload({
            manifest: gate.manifest,
            owner,
            family: input.descriptor.family,
            schemaVersion: input.descriptor.schemaVersion,
            payload: value.value,
          })
        ) return Effect.succeed(invalidFixedFamilyRead());

        return validateFixedCrossFamilyJoin({
          fileSystem: input.fileSystem,
          root: input.runtime.root,
          runId: selectedOwnerRunId(owner),
          ...(owner.kind === "attempt" ? { attemptId: owner.ref.attemptId } : {}),
          descriptor: input.descriptor as FixedRecordFamilyDescriptor<NiceEvalFamily, RecordAttachmentOwner, unknown>,
          payload: value.value,
          manifest: gate.manifest,
        }).pipe(Effect.map((join): FixedFamilyRead<Payload> =>
          join.state === "joined"
            ? value
            : join.state === "migration-required" || join.state === "unsupported"
              ? join
              : invalidFixedFamilyRead()),
        );
      }));
    });
  });
}

function isRunnerDiagnosticsDescriptor(
  descriptor: FixedRecordFamilyDescriptor<
    NiceEvalFamily,
    RecordAttachmentOwner,
    unknown
  >,
): boolean {
  return descriptor === NiceEvalRecordFamilyCatalog.runnerDiagnostics.attempt ||
    descriptor === NiceEvalRecordFamilyCatalog.runnerDiagnostics.run;
}

function isAssertionsDescriptor(
  descriptor: FixedRecordFamilyDescriptor<NiceEvalFamily, RecordAttachmentOwner, unknown>,
): boolean {
  return descriptor === NiceEvalRecordFamilyCatalog.assertions;
}

function hasSourceFrames(payload: RunnerDiagnosticsAttachment): boolean {
  return payload.segments.some((diagnostic) => diagnostic.sourceFrame !== null);
}

type FixedCrossFamilyJoin =
  | { readonly state: "joined" }
  | { readonly state: "invalid" }
  | Extract<FixedFamilyRead<unknown>, { readonly state: "migration-required" | "unsupported" }>;

const joinedCrossFamily = Object.freeze({ state: "joined" as const });
const invalidCrossFamily = Object.freeze({ state: "invalid" as const });

function dependentFamilyJoin(read: FixedRecordAttachmentRead<unknown>): FixedCrossFamilyJoin {
  if (read.state === "available") return joinedCrossFamily;
  if (read.state === "migration-required" || read.state === "unsupported") return read;
  return invalidCrossFamily;
}

function readSourcesForCrossFamilyJoin(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runId: RunId;
  readonly manifest?: SealManifestPublicationDocument;
}): Effect.Effect<FixedRecordAttachmentRead<SourcesAttachment>, RecordFileSystemError> {
  const location = Object.freeze({ owner: "run" as const, runId: input.runId });
  if (input.manifest === undefined) {
    return readFixedRecordAttachment({
      fileSystem: input.fileSystem,
      root: input.root,
      location,
      descriptor: NiceEvalRecordFamilyCatalog.sources,
    });
  }
  const owner = Object.freeze({ kind: "run" as const, runId: input.runId });
  const entries = attachmentManifestEntries(
    input.manifest,
    owner,
    NiceEvalRecordFamilyCatalog.sources.family,
  );
  if (entries.length === 0) {
    return Effect.succeed(invalidFixedAttachmentRead<SourcesAttachment>());
  }
  return Effect.flatMap(validateManifestEntryBytes({
    fileSystem: input.fileSystem,
    root: input.root,
    runId: input.runId,
    entries,
  }), (valid) => valid
    ? readFixedRecordAttachment({
        fileSystem: input.fileSystem,
        root: input.root,
        location,
        descriptor: NiceEvalRecordFamilyCatalog.sources,
        expectedManifestEntries: entries,
      })
    : Effect.succeed(invalidFixedAttachmentRead<SourcesAttachment>()));
}

/** Common cross-family closure boundary used by both reader and writer seal. */
function validateRunnerDiagnosticsSourceFrameJoin(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runId: RunId;
  readonly payload: RunnerDiagnosticsAttachment;
  readonly manifest?: SealManifestPublicationDocument;
}): Effect.Effect<FixedCrossFamilyJoin, RecordFileSystemError> {
  return Effect.gen(function* () {
    if (!hasSourceFrames(input.payload)) return joinedCrossFamily;
    const sources = yield* readSourcesForCrossFamilyJoin(input);
    if (sources.state !== "available") return dependentFamilyJoin(sources);
    return runnerDiagnosticsSourceFrameIntegrityIssues(
      input.payload,
      sources.value as SourcesAttachment,
    ).length === 0 ? joinedCrossFamily : invalidCrossFamily;
  });
}

/**
 * The fixed catalog's only cross-family boundary.  All joins use explicit
 * durable IDs and digests; absent siblings fail closed instead of falling
 * back to path lookup or array order.
 */
function validateFixedCrossFamilyJoin(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runId: RunId;
  readonly attemptId?: AttemptId;
  readonly descriptor: FixedRecordFamilyDescriptor<NiceEvalFamily, RecordAttachmentOwner, unknown>;
  readonly payload: unknown;
  readonly manifest?: SealManifestPublicationDocument;
}): Effect.Effect<FixedCrossFamilyJoin, RecordFileSystemError> {
  if (isRunnerDiagnosticsDescriptor(input.descriptor)) {
    return validateRunnerDiagnosticsSourceFrameJoin({
      fileSystem: input.fileSystem,
      root: input.root,
      runId: input.runId,
      payload: input.payload as RunnerDiagnosticsAttachment,
      ...(input.manifest === undefined ? {} : { manifest: input.manifest }),
    });
  }
  if (isAssertionsDescriptor(input.descriptor)) {
    const payload = input.payload as AssertionsAttachment;
    if (payload.sourceSites.length === 0) return Effect.succeed(joinedCrossFamily);
    return Effect.gen(function* () {
      const sources = yield* readSourcesForCrossFamilyJoin(input);
      if (sources.state !== "available") return dependentFamilyJoin(sources);
      return assertionsSourceSiteIntegrityIssues(payload, sources.value as SourcesAttachment).length === 0
        ? joinedCrossFamily
        : invalidCrossFamily;
    });
  }
  return Effect.succeed(joinedCrossFamily);
}

function assembleSourceNavigationRelation(input: {
  readonly runtime: ReaderRuntime;
  readonly fileSystem: RecordFileSystemService;
  readonly owner: SelectedOwnerRef;
}): Effect.Effect<FixedFamilyRead<SourceNavigationRelation>, RecordReaderReadError> {
  return Effect.gen(function* () {
    const contexts = yield* readFixedFamily({
      ...input,
      descriptor: NiceEvalRecordFamilyCatalog.turnContexts,
    });
    if (contexts.state !== "available") return contexts as FixedFamilyRead<SourceNavigationRelation>;
    const activities = yield* readFixedFamily({
      ...input,
      descriptor: NiceEvalRecordFamilyCatalog.runnerActivities.attempt,
    });
    const activityByTurn = activities.state === "available"
      ? new Map((activities.value as AttemptRunnerActivitiesAttachment).segments.flatMap((activity) =>
          activity.phase !== "agent.send" || activity.turnId === null
            ? []
            : [[activity.turnId, activity.activityId] as const]
        ))
      : new Map<string, string>();
    const contextValue = contexts.value as TurnContextsAttachment;
    const missingTiming = contextValue.segments.filter((context) => !activityByTurn.has(context.turnId)).length;
    const limitations = [
      ...(contextValue.collection.state === "partial"
        ? [{ code: "collection-cap-reached" as const, target: "navigation-row" as const, omittedAtLeast: 1 }]
        : []),
      ...(missingTiming > 0
        ? [{ code: "capture-unrecoverable" as const, target: "timing-link" as const, omittedAtLeast: missingTiming }]
        : []),
    ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const value = Object.freeze({
      collection: limitations.length === 0
        ? Object.freeze({ state: "complete" as const, limitations: Object.freeze([]) })
        : Object.freeze({ state: "partial" as const, limitations: Object.freeze(limitations) }),
      rows: Object.freeze(contextValue.segments.map((context) => {
        const intervalId = activityByTurn.get(context.turnId);
        return Object.freeze({
          turnId: context.turnId,
          sourceOrder: context.sourceOrder,
          source: context.source,
          timing: intervalId === undefined
            ? Object.freeze({ state: "unavailable" as const, reason: "timing-not-recorded" as const })
            : Object.freeze({ state: "linked" as const, intervalId }),
        });
      })),
    }) as SourceNavigationRelation;
    return Object.freeze({ state: "available" as const, value, blobs: contexts.blobs });
  });
}

function makeReadSession(runtime: ReaderRuntime, fileSystem: RecordFileSystemService): RecordReadSession {
  const session: RecordReadSession = Object.freeze({
    selectRuns: (request?: RecordSelectionRequest) => scanSelection(runtime, fileSystem, request),
    readRun: (ref: SelectedRunRef): Effect.Effect<RecordCoreRead<ReadableRun>, RecordReaderReadError> => Effect.suspend((): Effect.Effect<RecordCoreRead<ReadableRun>, RecordReaderReadError> => {
      const contents = runtime.runs.get(ref);
      if (runtime.lifecycle.closed) return Effect.fail(readerClosed());
      if (contents === undefined) return Effect.fail(handleInvalid());
      return Effect.map(readSealedCoreSnapshot(runtime, fileSystem), (snapshot) => {
        const core = snapshot.state === "available" ? snapshot.byRunId.get(ref.runId) : undefined;
        if (core === undefined) {
          return Object.freeze({
            state: "core-invalid" as const,
            issues: snapshot.state === "core-invalid" ? snapshot.issues : coreInvalid().issues,
          });
        }
        return Object.freeze({
          state: "available" as const,
          value: Object.freeze({
            ref,
            owner: makeOwner(runtime, Object.freeze({ kind: "run" as const, runId: ref.runId })),
            document: core.run,
            members: Object.freeze(core.members.map((document) => Object.freeze({
              document,
              attempt: document.attempt === null ? null : makeAttemptRef(runtime, document.attempt),
            }))),
          }),
        });
      });
    }),
    readAttempt: (ref: SelectedAttemptRef): Effect.Effect<RecordCoreRead<ReadableAttempt>, RecordReaderReadError> => Effect.suspend((): Effect.Effect<RecordCoreRead<ReadableAttempt>, RecordReaderReadError> => {
      const contents = runtime.attempts.get(ref);
      if (runtime.lifecycle.closed) return Effect.fail(readerClosed());
      if (contents === undefined) return Effect.fail(handleInvalid());
      const exact: RecordAttemptRef = {
        originRunId: ref.originRunId,
        attemptId: ref.attemptId,
      };
      return Effect.gen(function* () {
        const snapshot = yield* readSealedCoreSnapshot(runtime, fileSystem);
        const core = snapshot.state === "available"
          ? snapshot.byRunId.get(exact.originRunId)
          : undefined;
        if (core === undefined) {
          return Object.freeze({
            state: "core-invalid" as const,
            issues: snapshot.state === "core-invalid" ? snapshot.issues : coreInvalid().issues,
          }) satisfies RecordCoreRead<ReadableAttempt>;
        }
        const originRun = core.run;
        const document = core.attempts.find((attempt) => attempt.attemptId === exact.attemptId);
        if (document === undefined) {
          return Object.freeze({ state: "core-invalid" as const, issues: coreInvalid().issues }) satisfies RecordCoreRead<ReadableAttempt>;
        }
        const expected = originRun.expectedSlots.find((slot) => slot.slotId === document.slotId);
        if (
          expected === undefined
          || expected.evalId !== document.evalId
          || expected.executionIdentityDigest !== document.executionIdentityDigest
        ) {
          return Object.freeze({ state: "core-invalid" as const, issues: coreInvalid().issues }) satisfies RecordCoreRead<ReadableAttempt>;
        }
        return Object.freeze({
          state: "available" as const,
          value: Object.freeze({
            ref,
            owner: makeOwner(runtime, Object.freeze({ kind: "attempt" as const, ref: exact })),
            document,
            origin: Object.freeze({
              owner: makeOwner(runtime, Object.freeze({
                kind: "run" as const,
                runId: originRun.runId,
              })),
              runId: originRun.runId,
              experimentId: originRun.experimentId,
              startedAt: originRun.startedAt,
              context: originRun.context,
            }),
          }),
        }) satisfies RecordCoreRead<ReadableAttempt>;
      });
    }),
    readAssertions: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.assertions,
      }),
    readAgentTurns: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.agentTurns,
      }),
    readTurnContexts: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.turnContexts,
      }),
    readSandboxCommands: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.sandboxCommands,
      }),
    readAttemptRunnerActivities: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.runnerActivities.attempt,
      }),
    readAttemptRunnerDiagnostics: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.runnerDiagnostics.attempt,
      }),
    readFileChanges: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.fileChanges,
      }),
    readSourceNavigationRelation: (owner: SelectedOwnerRef) =>
      assembleSourceNavigationRelation({ runtime, fileSystem, owner }),
    readAttemptArtifacts: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.artifacts.attempt,
      }),
    readSources: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.sources,
      }),
    readRunRunnerActivities: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.runnerActivities.run,
      }),
    readRunRunnerDiagnostics: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.runnerDiagnostics.run,
      }),
    readRunArtifacts: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.artifacts.run,
      }),
  });
  return session;
}

function mintRecordDocument(
  entropy: RecordEntropyService,
): Effect.Effect<RecordDocument, RecordCoreInvalid> {
  const format = Schema.decodeUnknownEither(RecordFormatSchema, RecordExactParseOptions)(
    RECORD_FORMAT,
  );
  if (Either.isLeft(format)) return Effect.fail(coreInvalid());
  return Effect.flatMap(entropy.uuid, (raw) => {
    const id = Schema.decodeUnknownEither(RecordIdSchema, RecordExactParseOptions)(raw);
    return Either.isLeft(id)
      ? Effect.fail(coreInvalid())
      : Effect.succeed(Object.freeze({
          format: format.right,
          recordId: id.right,
        }));
  });
}

function createDirectoryIfMissing(
  fileSystem: RecordFileSystemService,
  path: ReturnType<typeof recordPortablePath>,
): Effect.Effect<void, RecordFileSystemError> {
  return fileSystem.createDirectory(path).pipe(
    Effect.catchAll((error) =>
      error instanceof RecordPathAlreadyExists ? Effect.void : Effect.fail(error),
    ),
  );
}

function initializeRecord(
  input: {
    readonly root: RecordRoot;
    readonly fileSystem: RecordFileSystemService;
    readonly entropy: RecordEntropyService;
  },
): Effect.Effect<void, RecordFileSystemError | RecordBootstrapInvalid | RecordCoreInvalid> {
  return Effect.gen(function* () {
    const documentPath = recordPath(input.root, "record.json");
    if ((yield* input.fileSystem.pathKind(documentPath)) !== "missing") return;
    yield* input.fileSystem.ensureDirectory(recordPath(input.root));
    yield* createDirectoryIfMissing(input.fileSystem, recordPath(input.root, "runs"));

    // If another append writer won the bootstrap race, do not inspect or alter
    // its durable identity. Re-read the election file and let exact format
    // validation decide the next step.
    if ((yield* input.fileSystem.pathKind(documentPath)) !== "missing") return;
    const entries = yield* input.fileSystem.listDirectory({
      directory: recordPath(input.root),
      maximumEntries: 2,
    });
    if (entries.some((entry) => entry.name !== "runs" || entry.kind !== "directory")) {
      if ((yield* input.fileSystem.pathKind(documentPath)) !== "missing") return;
      return yield* Effect.fail(bootstrapInvalid());
    }

    const document = yield* mintRecordDocument(input.entropy);
    const encoded = encodeRecordDocument(document);
    if (Either.isLeft(encoded)) return yield* Effect.fail(coreInvalidFromCodec(encoded.left));
    yield* input.fileSystem.writeFile({
      file: documentPath,
      bytes: jsonBytes(encoded.right),
      maximumBytes: RECORD_FORMAT_DOCUMENT_MAXIMUM_BYTES,
      mode: "exclusive",
    }).pipe(
      Effect.catchAll((error) =>
        error instanceof RecordPathAlreadyExists ? Effect.void : Effect.fail(error),
      ),
    );
    yield* input.fileSystem.syncDirectory(recordPath(input.root));
  });
}

function recoveryInvalid(path: string, message: string): RecordIoError {
  return new RecordIoError({
    code: "record-io-error",
    operation: "publish-directory",
    path,
    cause: new Error(message),
  });
}

function descriptorForRecoveredAttachment(
  owner: RecordAttachmentOwner,
  family: string,
): FixedRecordFamilyDescriptor<NiceEvalFamily, RecordAttachmentOwner, unknown> | undefined {
  const descriptors = owner === "run"
    ? NiceEvalRecordFamilyDescriptorsByOwner.run
    : NiceEvalRecordFamilyDescriptorsByOwner.attempt;
  return descriptors.find((descriptor) => descriptor.family === family) as
    | FixedRecordFamilyDescriptor<NiceEvalFamily, RecordAttachmentOwner, unknown>
    | undefined;
}

function validateRecoveredAttachmentClosures(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runId: RunId;
  readonly manifest: SealManifestDocument;
}): Effect.Effect<boolean, RecordFileSystemError> {
  return Effect.gen(function* () {
    const envelopes = input.manifest.entries.filter((entry) => entry.kind === "attachment-envelope");
    for (const envelope of envelopes) {
      if (envelope.family === null) return false;
      const ownerKind: RecordAttachmentOwner = envelope.owner === "run" ? "run" : "attempt";
      const descriptor = descriptorForRecoveredAttachment(ownerKind, envelope.family);
      if (descriptor === undefined) return false;
      const ownerRuntime: SelectedOwnerRuntime = envelope.owner === "run"
        ? Object.freeze({ kind: "run" as const, runId: input.runId })
        : Object.freeze({
            kind: "attempt" as const,
            ref: Object.freeze({ originRunId: input.runId, attemptId: envelope.owner }),
          });
      const read = envelope.owner === "run"
        ? yield* readFixedRecordAttachment({
            fileSystem: input.fileSystem,
            root: input.root,
            location: Object.freeze({ owner: "run" as const, runId: input.runId }),
            descriptor: descriptor as FixedRecordFamilyDescriptor<NiceEvalFamily, "run", unknown>,
          })
        : yield* readFixedRecordAttachment({
            fileSystem: input.fileSystem,
            root: input.root,
            location: Object.freeze({
              owner: "attempt" as const,
              runId: input.runId,
              attemptId: envelope.owner,
            }),
            descriptor: descriptor as FixedRecordFamilyDescriptor<NiceEvalFamily, "attempt", unknown>,
          });
      if (read.state !== "available") return false;
      if (
        sourceFamily(envelope.family) &&
        !sourceManifestMatchesPayload({
          manifest: input.manifest,
          owner: ownerRuntime,
          family: envelope.family,
          schemaVersion: descriptor.schemaVersion,
          payload: read.value,
        })
      ) return false;
      const joined = yield* validateFixedCrossFamilyJoin({
        fileSystem: input.fileSystem,
        root: input.root,
        runId: input.runId,
        ...(envelope.owner === "run" ? {} : { attemptId: envelope.owner }),
        descriptor,
        payload: read.value,
      });
      if (joined.state !== "joined") return false;
    }
    return true;
  });
}

function validateRecoveredPublication(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly record: RecordDocument;
  readonly runId: RunId;
  readonly staging?: RecordRunStaging;
}): Effect.Effect<ValidatedRecoveredPublication | undefined, RecordFileSystemError> {
  const storage = input.staging === undefined
    ? publishedRunStorage(input.fileSystem, input.root, input.runId)
    : stagedRunStorage(input.fileSystem, input.staging);
  const attachmentFileSystem = input.staging === undefined
    ? input.fileSystem
    : stagingReadFileSystem({
        root: input.root,
        runId: input.runId,
        staging: input.staging,
        fileSystem: input.fileSystem,
      });
  return Effect.flatMap(validateRunPublication({
    storage,
    runId: input.runId,
    fullAttachmentHashes: true,
    strictSources: true,
  }), (publication) => {
    if (publication === undefined || publication.strictManifest === undefined) {
      return Effect.succeed(undefined);
    }
    const strictManifest = publication.strictManifest;
    return Effect.gen(function* () {
      const run = yield* readRunDocument(attachmentFileSystem, input.root, input.runId);
      const members = run === undefined
        ? undefined
        : yield* readRunMembers(attachmentFileSystem, input.root, input.runId);
      const attempts = members === undefined
        ? undefined
        : yield* readRunAttempts(attachmentFileSystem, input.root, input.runId);
      if (run === undefined || members === undefined || attempts === undefined) return undefined;
      const snapshot = yield* loadSealedCoreSnapshot(
        maintenanceReaderRuntime(input.root, input.record),
        input.fileSystem,
        { fullAttachmentHashes: true, strictSources: true },
      );
      if (snapshot.state !== "available") return undefined;
      const existing = [...snapshot.byRunId.values()]
        .filter((core) => core.run.runId !== input.runId);
      const aggregate = encodeRecordCore(Object.freeze({
        record: input.record,
        runs: Object.freeze([...existing, Object.freeze({ run, members, attempts })]
          .sort((left, right) => compareCanonicalIdentity(left.run.runId, right.run.runId))),
      }));
      if (Either.isLeft(aggregate)) return undefined;
      const attachmentsValid = yield* validateRecoveredAttachmentClosures({
        fileSystem: attachmentFileSystem,
        root: input.root,
        runId: input.runId,
        manifest: strictManifest,
      });
      return attachmentsValid
        ? Object.freeze({ ...publication, strictManifest })
        : undefined;
    });
  });
}

function recoverRunPublications(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly record: RecordDocument;
}): Effect.Effect<void, RecordFileSystemError> {
  return Effect.gen(function* () {
    const candidates = yield* input.fileSystem.listRunPublishRecoveries({
      root: input.root,
      maximumEntries: MAXIMUM_PUBLISH_RECOVERIES,
      maximumManifestBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
    });
    for (const candidate of candidates) {
      const json = parseJson(candidate.manifestBytes);
      const decoded = json === undefined
        ? undefined
        : decodeRecordPublishRecoveryDocument(json);
      if (decoded === undefined || Either.isLeft(decoded)) {
        return yield* Effect.fail(recoveryInvalid(
          candidate.sessionId,
          "Record publish recovery document is invalid",
        ));
      }
      const recovery = decoded.right;
      if (recovery.recordId !== input.record.recordId) {
        return yield* Effect.fail(recoveryInvalid(
          recovery.destinationPath,
          "Record publish recovery identity does not match this Record",
        ));
      }
      const staging = yield* input.fileSystem.openRunStaging({
        root: input.root,
        sessionId: candidate.sessionId,
        runId: recovery.runId,
      });
      const paths = yield* input.fileSystem.describeRunStaging(staging);
      const stagingKind = yield* input.fileSystem.stagingPathKind(recordStagingPath(staging));
      const destinationKind = yield* input.fileSystem.pathKind(runPath(
        input.root,
        recovery.runId,
      ));
      if (stagingKind === "directory" && destinationKind === "missing") {
        // Append leases are shared. A live writer may have persisted recovery
        // before creating `complete`; only a completed staging is eligible for
        // takeover, and incomplete local residue remains outside portable data.
        if (!(yield* input.fileSystem.isStagingCompleteMarker(staging))) continue;
        const stagedValidation = yield* Effect.either(validateRecoveredPublication({
          fileSystem: input.fileSystem,
          root: input.root,
          record: input.record,
          runId: recovery.runId,
          staging,
        }));
        if (
          Either.isLeft(stagedValidation) ||
          stagedValidation.right === undefined ||
          !recordPublishRecoveryMatches({
            recovery,
            recordId: input.record.recordId,
            sealManifest: stagedValidation.right.strictManifest,
            sealManifestSha256: stagedValidation.right.manifestSha256,
            stagingPath: paths.stagingPath,
            destinationPath: paths.destinationPath,
          })
        ) {
          // A live append writer can rename a complete staging directory while
          // this recovery actor is validating it. In that case the staging
          // reads legitimately become unavailable; finish validation against
          // the published destination below instead of reporting corruption.
          const [remainingStaging, publishedDestination] = yield* Effect.all([
            input.fileSystem.stagingPathKind(recordStagingPath(staging)),
            input.fileSystem.pathKind(runPath(input.root, recovery.runId)),
          ]);
          if (remainingStaging !== "missing" || publishedDestination !== "directory") {
            if (Either.isLeft(stagedValidation)) {
              return yield* Effect.fail(stagedValidation.left);
            }
            return yield* Effect.fail(recoveryInvalid(
              paths.stagingPath,
              "Staged Run does not match its publish recovery inventory",
            ));
          }
        } else {
          yield* input.fileSystem.publishRunStaging(staging).pipe(
            Effect.catchTag("RecordPathAlreadyExists", () => Effect.void),
          );
        }
        const [remainingStaging, publishedDestination] = yield* Effect.all([
          input.fileSystem.stagingPathKind(recordStagingPath(staging)),
          input.fileSystem.pathKind(runPath(input.root, recovery.runId)),
        ]);
        if (remainingStaging !== "missing" || publishedDestination !== "directory") {
          return yield* Effect.fail(recoveryInvalid(
            paths.destinationPath,
            "No-clobber recovery did not produce exactly one published destination",
          ));
        }
      } else if (stagingKind === "directory" || destinationKind !== "directory") {
        return yield* Effect.fail(recoveryInvalid(
          paths.destinationPath,
          "Publish recovery found conflicting or missing staging/destination state",
        ));
      }

      const published = yield* validateRecoveredPublication({
        fileSystem: input.fileSystem,
        root: input.root,
        record: input.record,
        runId: recovery.runId,
      });
      if (
        published === undefined ||
        !recordPublishRecoveryMatches({
          recovery,
          recordId: input.record.recordId,
          sealManifest: published.strictManifest,
          sealManifestSha256: published.manifestSha256,
          stagingPath: paths.stagingPath,
          destinationPath: paths.destinationPath,
        })
      ) {
        return yield* Effect.fail(recoveryInvalid(
          paths.destinationPath,
          "Published Run does not match its publish recovery inventory",
        ));
      }
      yield* input.fileSystem.removeRunPublishRecovery(staging);
    }
  });
}

function openCurrentRead(input: {
  readonly root: RecordRoot;
}): Effect.Effect<
  RecordReadSession,
  RecordReaderOpenError,
  import("effect").Scope.Scope | RecordFileSystem | RecordCoordination
> {
  return Effect.gen(function* () {
    const coordination = yield* RecordCoordination;
    const fileSystem = yield* RecordFileSystem;
    yield* coordination.enterRecordRead(input.root);
    if (yield* fileSystem.migrationSentinelPresent(input.root)) {
      return yield* Effect.fail(migrationInterrupted());
    }
    const current = yield* readCurrentRecordFormat(fileSystem, input.root);
    const lifecycle: ReaderLifecycle = { closed: false };
    const runtime: ReaderRuntime = {
      root: input.root,
      record: current.document,
      lifecycle,
      runs: new WeakMap(),
      attempts: new WeakMap(),
      owners: new WeakMap(),
      runsById: new Map(),
      attemptsByKey: new Map(),
      manifestsByRunId: new Map(),
      sealedCoreSnapshot: undefined,
    };
    // Compatibility is decided before Core reconstruction. A structurally
    // closed Run from a future writer may contain a family this package does
    // not know; that is unsupported format, not corrupt or absent Core.
    const pendingMigration = yield* inspectOrdinaryCurrentAttachments({
      fileSystem,
      root: input.root,
    });
    const snapshot = yield* readSealedCoreSnapshot(runtime, fileSystem);
    if (snapshot.state === "core-invalid") return yield* Effect.fail(bootstrapInvalid());
    if (pendingMigration !== undefined) return yield* Effect.fail(pendingMigration);
    yield* coordination.verifyRecordIdentity({ root: input.root, recordId: current.document.recordId });
    yield* Effect.addFinalizer(() => Effect.sync(() => { lifecycle.closed = true; }));
    return makeReadSession(runtime, fileSystem);
  });
}

function mintRunId(
  entropy: RecordEntropyService,
): Effect.Effect<RunId, RecordCoreInvalid> {
  return Effect.flatMap(entropy.uuid, (raw) => {
    const decoded = Schema.decodeUnknownEither(RunIdSchema, RecordExactParseOptions)(raw);
    return Either.isLeft(decoded) ? Effect.fail(coreInvalid()) : Effect.succeed(decoded.right);
  });
}

function mintAttemptId(
  entropy: RecordEntropyService,
): Effect.Effect<AttemptId, RecordCoreInvalid> {
  return Effect.flatMap(entropy.uuid, (raw) => {
    const decoded = Schema.decodeUnknownEither(AttemptIdSchema, RecordExactParseOptions)(raw);
    return Either.isLeft(decoded) ? Effect.fail(coreInvalid()) : Effect.succeed(decoded.right);
  });
}

function createFreshRunStaging(
  root: RecordRoot,
  fileSystem: RecordFileSystemService,
  entropy: RecordEntropyService,
  remaining = ENTROPY_RETRY_LIMIT,
): Effect.Effect<{
  readonly runId: RunId;
  readonly staging: RecordRunStaging;
}, RecordWriteError> {
  return Effect.gen(function* () {
    const runId = yield* mintRunId(entropy);
    if ((yield* fileSystem.pathKind(runPath(root, runId))) !== "missing") {
      return remaining > 0
        ? yield* createFreshRunStaging(root, fileSystem, entropy, remaining - 1)
        : yield* Effect.fail(coreInvalid());
    }
    const sessionId = yield* mintRunId(entropy);
    const staging = yield* fileSystem.createRunStaging({ root, sessionId, runId }).pipe(
      Effect.catchAll((error) =>
        error instanceof RecordPathAlreadyExists && remaining > 0
          ? createFreshRunStaging(root, fileSystem, entropy, remaining - 1).pipe(
              Effect.map((fresh) => fresh.staging),
            )
          : Effect.fail(error),
      ),
    );
    // A recursive retry above returns a handle for a different RunId, so keep
    // the identity attached to the unforgeable handle rather than the stale
    // local candidate.
    const actualRunId = decodeRunId(staging.runId);
    if (actualRunId === undefined) return yield* Effect.fail(coreInvalid());
    return Object.freeze({ runId: actualRunId, staging });
  });
}

function assertRunLive(run: RunRuntime): Effect.Effect<void, ReturnType<typeof recordWriterClosed>> {
  return run.closed ? Effect.fail(recordWriterClosed()) : Effect.void;
}

/**
 * `CreateRunRequest` is public-facing TypeScript but may still receive forged
 * JavaScript values. Normalize every Slot through the exact definition before
 * allocating a Run directory so both normal and reference Runs freeze the
 * same denominator facts.
 */
function canonicalizeExpectedSlots(
  input: readonly RecordSlotIdentity[],
): Either.Either<readonly RecordSlotIdentity[], NonEmptyRecordIssues> {
  const slots: RecordSlotIdentity[] = [];
  for (const [index, slot] of input.entries()) {
    const encoded = RecordSlotIdentityDefinition.encode(slot);
    if (Either.isLeft(encoded)) {
      const issues = nonEmptyRecordIssues([
        recordIssue("record-schema-invalid", ["expectedSlots", String(index)]),
      ]);
      if (issues === undefined) throw new Error("Expected Slot codec failure must have an issue");
      return Either.left(issues);
    }
    const decoded = RecordSlotIdentityDefinition.decode(encoded.right);
    if (Either.isLeft(decoded)) {
      const issues = nonEmptyRecordIssues([
        recordIssue("record-schema-invalid", ["expectedSlots", String(index)]),
      ]);
      if (issues === undefined) throw new Error("Expected Slot codec failure must have an issue");
      return Either.left(issues);
    }
    slots.push(decoded.right);
  }
  const issues = nonEmptyRecordIssues(validateExpectedSlots(slots));
  return issues === undefined
    ? Either.right(Object.freeze(slots))
    : Either.left(issues);
}

function createFreshAttemptDirectory(
  run: RunRuntime,
  remaining = ENTROPY_RETRY_LIMIT,
): Effect.Effect<AttemptId, RecordWriteError> {
  return Effect.flatMap(mintAttemptId(run.entropy), (attemptId) =>
    run.fileSystem.ensureStagingDirectory(stagedRunPath(run, "attempts")).pipe(
      Effect.zipRight(
        run.fileSystem.createStagingDirectory(stagedRunPath(run, "attempts", attemptId)),
      ),
      Effect.as(attemptId),
      Effect.catchAll((error) =>
        error instanceof RecordPathAlreadyExists && remaining > 0
          ? createFreshAttemptDirectory(run, remaining - 1)
          : Effect.fail(error),
      ),
    ),
  );
}

function beginRunMutation(
  run: RunRuntime,
  input: {
    readonly operation: "create-attempt" | "reference" | "record";
    readonly slotId?: SlotId;
    readonly reservation?: "attempt" | "reference" | "terminal";
  },
): Effect.Effect<Deferred.Deferred<void>, RecordWriteError> {
  return run.mutex.withPermits(1)(
    Effect.gen(function* () {
      yield* assertRunLive(run);
      if (run.state !== "open") {
        return yield* Effect.fail(stateError(input.operation, run.state));
      }
      if (input.slotId !== undefined) {
        if (!run.expectedBySlot.has(input.slotId) || run.slotReservations.has(input.slotId)) {
          return yield* Effect.fail(coreInvalid());
        }
        run.slotReservations.set(input.slotId, input.reservation!);
      }
      const mutation = yield* Deferred.make<void>();
      run.inFlightMutations.add(mutation);
      return mutation;
    }),
  );
}

function finishRunMutation(
  run: RunRuntime,
  mutation: Deferred.Deferred<void>,
  exit: Exit.Exit<unknown, unknown>,
): Effect.Effect<void> {
  return run.mutex.withPermits(1)(
    Effect.sync(() => {
      run.inFlightMutations.delete(mutation);
      if (!Exit.isSuccess(exit) && !run.markerCreated) {
        run.state = "failed";
        consumeRunCapabilities(run);
      }
    }),
  ).pipe(
    Effect.zipRight(Deferred.succeed(mutation, undefined).pipe(Effect.asVoid)),
  );
}

/**
 * Publication consumes every writer capability for the Run, including child
 * Attempt capabilities. Durable visibility is still the complete marker; the
 * in-memory handles must never remain usable after that point.
 */
function consumeRunCapabilities(run: RunRuntime): void {
  run.closed = true;
  if (run.handle !== undefined) {
    runSessions.delete(run.handle);
    run.handle = undefined;
  }
  for (const attempt of run.attempts.values()) {
    consumeAttemptCapability(attempt);
  }
}

/** Remove the exact-object authority before a completed/failed Attempt escapes. */
function consumeAttemptCapability(attempt: AttemptRuntime): void {
  if (attempt.handle !== undefined) {
    attemptSessions.delete(attempt.handle);
    attempt.handle = undefined;
  }
}

function fixedFamilyWriteInvalid() {
  return recordAttachmentClosureInvalid([
    recordAttachmentIssue("record-attachment-schema-id-mismatch", ["family"]),
  ]);
}

function attachmentEncodeFailure(
  error: RecordAttachmentPayloadInvalid,
) {
  return recordAttachmentEncodeError(error);
}

function nextBlobKey(
  entropy: RecordEntropyService,
  forbidden: ReadonlySet<string>,
  remaining = ENTROPY_RETRY_LIMIT,
): Effect.Effect<string, RecordCoreInvalid> {
  return Effect.flatMap(entropy.uuid, (candidate) => {
    if (isPortableSegment(candidate) && !forbidden.has(candidate)) {
      return Effect.succeed(candidate);
    }
    return remaining > 0
      ? nextBlobKey(entropy, forbidden, remaining - 1)
      : Effect.fail(coreInvalid());
  });
}

function allocateBlobKeys(input: {
  readonly entropy: RecordEntropyService;
  readonly payload: RecordAttachmentJson;
  readonly blobs: readonly { readonly ref: RecordBlobRef; readonly stream: unknown }[];
}): Effect.Effect<ReadonlyMap<object, string>, RecordCoreInvalid> {
  return Effect.gen(function* () {
    const forbidden = new Set(attachmentPayloadStrings(input.payload));
    const keys = new Map<object, string>();
    for (const blob of input.blobs) {
      const key = yield* nextBlobKey(input.entropy, forbidden);
      forbidden.add(key);
      keys.set(blob.ref, key);
    }
    return keys;
  });
}

function reserveFixedAttachment(input: {
  readonly run: RunRuntime;
  readonly target: RunRuntime | AttemptRuntime;
  readonly attachment: FixedAttachmentRuntime;
}): Effect.Effect<void, RecordWriteError> {
  return input.run.mutex.withPermits(1)(
    Effect.suspend(() => {
      if (input.run.state !== "open") {
        return Effect.fail(stateError("record", input.run.state));
      }
      if (
        input.target.attachments.has(input.attachment.name) ||
        consumedFixedFamilyWrites.has(input.attachment.write)
      ) {
        return Effect.fail(stateError("record", input.run.state));
      }
      input.target.attachments.set(input.attachment.name, input.attachment);
      consumedFixedFamilyWrites.set(input.attachment.write, input.target);
      return Effect.void;
    }),
  );
}

function assertAttemptCollecting(
  attempt: AttemptRuntime,
): Effect.Effect<void, RecordWriteError> {
  return attempt.mutex.withPermits(1)(
    Effect.suspend(() =>
      attempt.state === "open"
        ? Effect.void
        : Effect.fail(stateError("record", attempt.draft.state)),
    ),
  );
}

function writeFixedAttachment<
  Family extends NiceEvalFamily,
  Owner extends RecordAttachmentOwner,
  Payload,
  E,
  R,
>(input: {
  readonly run: RunRuntime;
  readonly target: RunRuntime | AttemptRuntime;
  readonly owner: Owner;
  readonly baseSegments: readonly string[];
  readonly descriptor: FixedRecordFamilyDescriptor<Family, Owner, Payload>;
  readonly write: RecordAttachmentWrite<Owner, E, R>;
}): Effect.Effect<void, RecordWriteError | E, R> {
  return Effect.flatMap(
    beginRunMutation(input.run, { operation: "record" }),
    (mutation) =>
      Effect.gen(function* () {
        if (input.target !== input.run) {
          yield* assertAttemptCollecting(input.target as AttemptRuntime);
        }
        const captured = recordAttachmentWriteContents(input.write);
        if (Either.isLeft(captured)) return yield* Effect.fail(captured.left);
        if (!sameFixedAttachmentWrite(captured.right.fixed, input.descriptor)) {
          return yield* Effect.fail(fixedFamilyWriteInvalid());
        }
        const encodedPayload = input.descriptor.write.encodePayload(captured.right.payload as Payload);
        if (Either.isLeft(encodedPayload)) {
          return yield* Effect.fail(attachmentEncodeFailure(encodedPayload.left));
        }
        const attachment: FixedAttachmentRuntime = Object.freeze({
          owner: input.owner,
          name: input.descriptor.family,
          baseSegments: Object.freeze([...input.baseSegments]),
          descriptor: input.descriptor as unknown as FixedAttachmentRuntime["descriptor"],
          write: input.write as unknown as RecordAttachmentWrite<
            RecordAttachmentOwner,
            unknown,
            unknown
          >,
          blobCount: captured.right.blobs.length,
          attemptId: input.target === input.run
            ? undefined
            : (input.target as AttemptRuntime).attemptId,
        });
        yield* reserveFixedAttachment({ run: input.run, target: input.target, attachment });
        const blobKeys = yield* allocateBlobKeys({
          entropy: input.run.entropy,
          payload: encodedPayload.right,
          blobs: captured.right.blobs,
        });
        const storedPayload = encodeAttachmentPayloadForStorage({
          payload: encodedPayload.right,
          blobKeys,
        });
        if (Either.isLeft(storedPayload)) {
          return yield* Effect.fail(attachmentEncodeFailure(storedPayload.left));
        }
        const encodedEnvelope = encodeFixedRecordAttachmentEnvelope({
          family: input.descriptor.family,
          schemaVersion: input.descriptor.schemaVersion,
        });
        if (Either.isLeft(encodedEnvelope)) {
          return yield* Effect.fail(fixedFamilyWriteInvalid());
        }
        const attachmentRoot = [...input.baseSegments, input.descriptor.family];
        yield* input.run.fileSystem.ensureStagingDirectory(
          stagedRunPath(input.run, ...input.baseSegments),
        );
        yield* input.run.fileSystem.createStagingDirectory(
          stagedRunPath(input.run, ...attachmentRoot),
        );
        yield* input.run.fileSystem.writeStagingFile({
          file: stagedRunPath(input.run, ...attachmentRoot, "attachment.json"),
          bytes: jsonBytes(encodedEnvelope.right),
          maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
          mode: "exclusive",
        });
        yield* input.run.fileSystem.writeStagingFile({
          file: stagedRunPath(input.run, ...attachmentRoot, "payload.json"),
          bytes: encodeRecordAttachmentJsonBytes(storedPayload.right),
          maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
          mode: "exclusive",
        });
        yield* Effect.forEach(
          captured.right.blobs,
          (blob) => {
            const key = blobKeys.get(blob.ref);
            if (key === undefined) {
              throw new Error("Record fixed Attachment lost its writer-assigned blob key");
            }
            return input.run.fileSystem.writeStagingFileStream({
              file: stagedRunPath(input.run, ...attachmentRoot, "blobs", key),
              stream: blob.stream,
              maximumBytes: Math.min(
                MAXIMUM_ATTACHMENT_BLOB_BYTES,
                input.descriptor.write.budget.maximumBlobBytes,
              ),
              mode: "exclusive",
            });
          },
          { discard: true },
        );
      }).pipe(Effect.onExit((exit) => finishRunMutation(input.run, mutation, exit))),
  );
}

function validateAndSyncFixedAttachment(
  run: RunRuntime,
  attachment: FixedAttachmentRuntime,
): Effect.Effect<void, RecordWriteError> {
  return Effect.gen(function* () {
    const captured = recordAttachmentWriteContents(attachment.write);
    if (Either.isLeft(captured) ||
      !sameFixedAttachmentWrite(captured.right.fixed, attachment.descriptor) ||
      captured.right.blobs.length !== attachment.blobCount) {
      return yield* Effect.fail(
        Either.isLeft(captured) ? captured.left : fixedFamilyWriteInvalid(),
      );
    }
    const encodedPayload = attachment.descriptor.write.encodePayload(captured.right.payload);
    if (Either.isLeft(encodedPayload)) {
      return yield* Effect.fail(attachmentEncodeFailure(encodedPayload.left));
    }
    const rootSegments = [...attachment.baseSegments, attachment.name];
    const blobs = stagedRunPath(run, ...rootSegments, "blobs");
    if ((yield* run.fileSystem.stagingPathKind(blobs)) === "directory") {
      yield* run.fileSystem.syncStagingDirectory(blobs);
    }
    yield* run.fileSystem.syncStagingDirectory(stagedRunPath(run, ...rootSegments));
    yield* run.fileSystem.syncStagingDirectory(stagedRunPath(run, ...attachment.baseSegments));
    const stagedFileSystem = stagingReadFileSystem({
      root: run.root,
      runId: run.runId,
      staging: run.staging,
      fileSystem: run.fileSystem,
    });
    const materialized = yield* readFixedRecordAttachment({
      fileSystem: stagedFileSystem,
      root: run.root,
      location: attachment.owner === "run"
        ? Object.freeze({ owner: "run" as const, runId: run.runId })
        : Object.freeze({
            owner: "attempt" as const,
            runId: run.runId,
            attemptId: attachment.attemptId!,
          }),
      descriptor: attachment.descriptor,
    });
    if (materialized.state !== "available") {
      return yield* Effect.fail(fixedFamilyWriteInvalid());
    }
    const joined = yield* validateFixedCrossFamilyJoin({
      fileSystem: stagedFileSystem,
      root: run.root,
      runId: run.runId,
      ...(attachment.owner === "attempt" ? { attemptId: attachment.attemptId } : {}),
      descriptor: attachment.descriptor,
      payload: materialized.value,
    });
    if (joined.state !== "joined") {
      return yield* Effect.fail(fixedFamilyWriteInvalid());
    }
  });
}

function validateAndSyncFixedAttachments(
  run: RunRuntime,
): Effect.Effect<void, RecordWriteError> {
  return Effect.gen(function* () {
    yield* Effect.forEach(run.attachments.values(), (attachment) =>
      validateAndSyncFixedAttachment(run, attachment), { discard: true });
    for (const attempt of run.attempts.values()) {
      yield* Effect.forEach(attempt.attachments.values(), (attachment) =>
        validateAndSyncFixedAttachment(run, attachment), { discard: true });
      const attemptDirectory = stagedRunPath(run, "attempts", attempt.attemptId);
      if ((yield* run.fileSystem.stagingPathKind(attemptDirectory)) === "directory") {
        yield* run.fileSystem.syncStagingDirectory(attemptDirectory);
      }
    }
    const members = stagedRunPath(run, "members");
    if ((yield* run.fileSystem.stagingPathKind(members)) === "directory") {
      yield* run.fileSystem.syncStagingDirectory(members);
    }
    const attempts = stagedRunPath(run, "attempts");
    if ((yield* run.fileSystem.stagingPathKind(attempts)) === "directory") {
      yield* run.fileSystem.syncStagingDirectory(attempts);
    }
  });
}

function writeRunFamily<
  Family extends NiceEvalFamily,
  Payload,
  E,
  R,
>(input: {
  readonly run: RunRuntime;
  readonly descriptor: FixedRecordFamilyDescriptor<Family, "run", Payload>;
  readonly value: RecordAttachmentWrite<"run", E, R>;
}): Effect.Effect<void, RecordWriteError | E, R> {
  return writeFixedAttachment({
    run: input.run,
    target: input.run,
    owner: "run",
    baseSegments: Object.freeze(["attachments"]),
    descriptor: input.descriptor,
    write: input.value,
  });
}

function writeAttemptFamily<
  Family extends NiceEvalFamily,
  Payload,
  E,
  R,
>(input: {
  readonly attempt: AttemptRuntime;
  readonly descriptor: FixedRecordFamilyDescriptor<Family, "attempt", Payload>;
  readonly value: RecordAttachmentWrite<"attempt", E, R>;
}): Effect.Effect<void, RecordWriteError | E, R> {
  return writeFixedAttachment({
    run: input.attempt.draft,
    target: input.attempt,
    owner: "attempt",
    baseSegments: Object.freeze([
      "attempts",
      input.attempt.attemptId,
      "attachments",
    ]),
    descriptor: input.descriptor,
    write: input.value,
  });
}

function completeAttempt(
  attempt: AttemptRuntime,
  outcome: AttemptDocument["outcome"],
): Effect.Effect<void, RecordWriteError> {
  return Effect.flatMap(
    beginRunMutation(attempt.draft, { operation: "record" }),
    (mutation) =>
      Effect.gen(function* () {
        yield* attempt.mutex.withPermits(1)(
          Effect.gen(function* () {
            yield* assertRunLive(attempt.draft);
            if (attempt.state !== "open") {
              return yield* Effect.fail(stateError("record", attempt.draft.state));
            }
            attempt.state = "completing";
          }),
        );
        const slot = attempt.draft.expectedBySlot.get(attempt.slotId);
        if (slot === undefined) return yield* Effect.fail(coreInvalid());
        const document: AttemptDocument = {
          attemptId: attempt.attemptId,
          originRunId: attempt.draft.runId,
          slotId: attempt.slotId,
          evalId: slot.evalId,
          executionIdentityDigest: slot.executionIdentityDigest,
          outcome,
        };
        const member: MemberDocument = {
          slotId: attempt.slotId,
          action: "executed",
          attempt: { originRunId: attempt.draft.runId, attemptId: attempt.attemptId },
        };
        const encodedAttempt = encodeAttemptDocument(document);
        const encodedMember = encodeMemberDocument(member);
        if (Either.isLeft(encodedAttempt) || Either.isLeft(encodedMember)) {
          return yield* Effect.fail(coreInvalid());
        }
        yield* attempt.draft.fileSystem.writeStagingFile({
          file: stagedRunPath(
            attempt.draft,
            "attempts",
            attempt.attemptId,
            "attempt.json",
          ),
          bytes: jsonBytes(encodedAttempt.right),
          maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
          mode: "exclusive",
        });
        yield* attempt.draft.fileSystem.ensureStagingDirectory(
          stagedRunPath(attempt.draft, "members"),
        );
        yield* attempt.draft.fileSystem.writeStagingFile({
          file: stagedRunPath(attempt.draft, "members", `${attempt.slotId}.json`),
          bytes: jsonBytes(encodedMember.right),
          maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
          mode: "exclusive",
        });
        yield* attempt.mutex.withPermits(1)(
          attempt.draft.mutex.withPermits(1)(
            Effect.sync(() => {
              attempt.state = "completed";
              attempt.document = document;
              attempt.draft.membership.set(attempt.slotId, { document: member });
            }),
          ),
        );
        yield* Deferred.succeed(attempt.settled, undefined).pipe(Effect.asVoid);
      }).pipe(
        Effect.onExit((exit) =>
          attempt.mutex.withPermits(1)(
            Effect.sync(() => {
              if (!Exit.isSuccess(exit) && attempt.state === "completing") {
                attempt.state = "failed";
              }
            }),
          ).pipe(
            Effect.zipRight(Deferred.succeed(attempt.settled, undefined).pipe(Effect.asVoid)),
            Effect.zipRight(finishRunMutation(attempt.draft, mutation, exit)),
          ),
        ),
      ),
  ).pipe(
    // Complete is terminal even when its durable write fails or is interrupted.
    // A leaked session must then fail at the capability boundary, not re-enter
    // the draft state machine.
    Effect.onExit(() => Effect.sync(() => consumeAttemptCapability(attempt))),
  );
}

function makeAttemptSession(attempt: AttemptRuntime): AttemptWriteSession {
  const session: AttemptWriteSession = Object.freeze({
    attemptId: attempt.attemptId,
    slotId: attempt.slotId,
    [attemptWriteSessionBrand]: () => undefined,
    complete(outcome: AttemptDocument["outcome"]) {
      return attemptSessions.get(this) === attempt
        ? completeAttempt(attempt, outcome)
        : Effect.fail(recordWriterClosed());
    },
    writeAssertions<E, R>(
      value: AssertionsWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return attemptSessions.get(this) === attempt
        ? writeAttemptFamily({
            attempt,
            descriptor: NiceEvalRecordFamilyCatalog.assertions,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    writeAgentTurns<E, R>(
      value: AgentTurnsWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return attemptSessions.get(this) === attempt
        ? writeAttemptFamily({
            attempt,
            descriptor: NiceEvalRecordFamilyCatalog.agentTurns,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    writeTurnContexts<E, R>(
      value: TurnContextsWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return attemptSessions.get(this) === attempt
        ? writeAttemptFamily({
            attempt,
            descriptor: NiceEvalRecordFamilyCatalog.turnContexts,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    writeSandboxCommands<E, R>(
      value: SandboxCommandsWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return attemptSessions.get(this) === attempt
        ? writeAttemptFamily({
            attempt,
            descriptor: NiceEvalRecordFamilyCatalog.sandboxCommands,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    writeAttemptRunnerActivities<E, R>(
      value: AttemptRunnerActivitiesWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return attemptSessions.get(this) === attempt
        ? writeAttemptFamily({
            attempt,
            descriptor: NiceEvalRecordFamilyCatalog.runnerActivities.attempt,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    writeAttemptRunnerDiagnostics<E, R>(
      value: AttemptRunnerDiagnosticsWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return attemptSessions.get(this) === attempt
        ? writeAttemptFamily({
            attempt,
            descriptor: NiceEvalRecordFamilyCatalog.runnerDiagnostics.attempt,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    writeFileChanges<E, R>(
      value: FileChangesWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return attemptSessions.get(this) === attempt
        ? writeAttemptFamily({
            attempt,
            descriptor: NiceEvalRecordFamilyCatalog.fileChanges,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    writeAttemptArtifacts<E, R>(
      value: AttemptArtifactsWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return attemptSessions.get(this) === attempt
        ? writeAttemptFamily({
            attempt,
            descriptor: NiceEvalRecordFamilyCatalog.artifacts.attempt,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
  });
  attempt.handle = session;
  attemptSessions.set(session, attempt);
  return session;
}

function createAttempt(
  run: RunRuntime,
  input: { readonly slotId: SlotId },
): Effect.Effect<AttemptWriteSession, RecordWriteError> {
  return Effect.flatMap(
    beginRunMutation(run, {
      operation: "create-attempt",
      slotId: input.slotId,
      reservation: "attempt",
    }),
    (mutation) =>
      Effect.gen(function* () {
        const attemptId = yield* createFreshAttemptDirectory(run);
        const mutex = yield* Effect.makeSemaphore(1);
        const settled = yield* Deferred.make<void>();
        const attempt: AttemptRuntime = {
          draft: run,
          attemptId,
          slotId: input.slotId,
          mutex,
          settled,
          state: "open",
          document: undefined,
          attachments: new Map(),
          handle: undefined,
        };
        yield* run.mutex.withPermits(1)(Effect.sync(() => {
          run.attempts.set(attemptId, attempt);
        }));
        return makeAttemptSession(attempt);
      }).pipe(Effect.onExit((exit) => finishRunMutation(run, mutation, exit))),
  );
}

function assertSelectedReference(
  root: RecordRoot,
  ref: SelectedAttemptRef,
): Effect.Effect<void, RecordReferenceInvalid> {
  const selected = selectedAttemptCapabilities.get(ref);
  return selected === undefined || selected.lifecycle.closed || !sameRoot(selected.root, root)
    ? Effect.fail(referenceInvalid())
    : Effect.void;
}

function referenceAttempt(
  run: RunRuntime,
  input: {
    readonly slotId: SlotId;
    readonly action: "carried" | "accepted";
    readonly attempt: SelectedAttemptRef;
  },
): Effect.Effect<void, RecordWriteError> {
  return Effect.flatMap(assertSelectedReference(run.root, input.attempt), () =>
    Effect.flatMap(
      beginRunMutation(run, {
        operation: "reference",
        slotId: input.slotId,
        reservation: "reference",
      }),
      (mutation) =>
        Effect.gen(function* () {
          const member: MemberDocument = {
            slotId: input.slotId,
            action: input.action,
            attempt: {
              originRunId: input.attempt.originRunId,
              attemptId: input.attempt.attemptId,
            },
          };
          yield* validateReference(run, { document: member });
          const encoded = encodeMemberDocument(member);
          if (Either.isLeft(encoded)) return yield* Effect.fail(coreInvalidFromCodec(encoded.left));
          yield* run.fileSystem.ensureStagingDirectory(stagedRunPath(run, "members"));
          yield* run.fileSystem.writeStagingFile({
            file: stagedRunPath(run, "members", `${input.slotId}.json`),
            bytes: jsonBytes(encoded.right),
            maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
            mode: "exclusive",
          });
          yield* run.mutex.withPermits(1)(
            Effect.sync(() => {
              run.membership.set(input.slotId, { document: member });
            }),
          );
        }).pipe(Effect.onExit((exit) => finishRunMutation(run, mutation, exit))),
    ),
  );
}

function recordTerminalMember(
  run: RunRuntime,
  input: {
    readonly slotId: SlotId;
    readonly action: "not-dispatched" | "interrupted";
  },
): Effect.Effect<void, RecordWriteError> {
  return Effect.flatMap(
    beginRunMutation(run, {
      operation: "record",
      slotId: input.slotId,
      reservation: "terminal",
    }),
    (mutation) =>
      Effect.gen(function* () {
        const member: MemberDocument = {
          slotId: input.slotId,
          action: input.action,
          attempt: null,
        };
        const encoded = encodeMemberDocument(member);
        if (Either.isLeft(encoded)) return yield* Effect.fail(coreInvalidFromCodec(encoded.left));
        yield* run.fileSystem.ensureStagingDirectory(stagedRunPath(run, "members"));
        yield* run.fileSystem.writeStagingFile({
          file: stagedRunPath(run, "members", `${input.slotId}.json`),
          bytes: jsonBytes(encoded.right),
          maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
          mode: "exclusive",
        });
        yield* run.mutex.withPermits(1)(
          Effect.sync(() => {
            run.membership.set(input.slotId, { document: member });
          }),
        );
      }).pipe(Effect.onExit((exit) => finishRunMutation(run, mutation, exit))),
  );
}

function draftRunDocument(
  run: RunRuntime,
  completion: RunCompletion,
): RunDocument {
  return Object.freeze({
    runId: run.runId,
    experimentId: run.experimentId,
    context: run.context,
    startedAt: run.startedAt,
    completedAt: completion.completedAt,
    expectedSlots: Object.freeze([...run.expectedSlots]),
  });
}

function readPublishedAttempts(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runId: RunId,
): Effect.Effect<readonly AttemptDocument[], RecordWriteError> {
  return Effect.flatMap(readRunAttempts(fileSystem, root, runId), (attempts) =>
    attempts === undefined ? Effect.fail(coreInvalid()) : Effect.succeed(attempts),
  );
}

function readPublishedMembers(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runId: RunId,
): Effect.Effect<readonly MemberDocument[], RecordWriteError> {
  return Effect.flatMap(readRunMembers(fileSystem, root, runId), (members) =>
    members === undefined ? Effect.fail(coreInvalid()) : Effect.succeed(members),
  );
}

function scanPublishedCore(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  omitRunId: RunId,
): Effect.Effect<readonly RunCore[], RecordWriteError> {
  return Effect.gen(function* () {
    const entries = orderedEntries(yield* fileSystem.listDirectory({
      directory: recordPath(root, "runs"),
      maximumEntries: MAXIMUM_RUN_ENTRIES,
    }));
    const runs: RunCore[] = [];
    for (const entry of entries) {
      if (entry.kind !== "directory") continue;
      const runId = decodeRunId(entry.name);
      if (runId === undefined || runId === omitRunId) continue;
      if (!(yield* isSealedRun(fileSystem, root, runId))) continue;
      const run = yield* readRunDocument(fileSystem, root, runId);
      if (run === undefined) return yield* Effect.fail(coreInvalid());
      const members = yield* readPublishedMembers(fileSystem, root, runId);
      const attempts = yield* readPublishedAttempts(fileSystem, root, runId);
      runs.push(Object.freeze({ run, members, attempts }));
    }
    return Object.freeze(runs);
  });
}

function validateReference(
  run: RunRuntime,
  member: MembershipRuntime,
): Effect.Effect<void, RecordWriteError> {
  return Effect.gen(function* () {
    const reference = member.document.attempt;
    if (reference === null) return;
    if (!(yield* isSealedRun(run.fileSystem, run.root, reference.originRunId))) {
      return yield* Effect.fail(referenceInvalid());
    }
    const source = yield* readAttemptDocument(run.fileSystem, run.root, reference);
    const originRun = yield* readRunDocument(
      run.fileSystem,
      run.root,
      reference.originRunId,
    );
    const expected = run.expectedBySlot.get(member.document.slotId);
    if (source === undefined || expected === undefined || originRun === undefined) {
      return yield* Effect.fail(referenceInvalid());
    }
    const originExpected = originRun.expectedSlots.find(
      (slot) => slot.slotId === source.slotId,
    );
    if (originExpected === undefined) return yield* Effect.fail(referenceInvalid());
    if (
      source.slotId !== originExpected.slotId
      || source.evalId !== originExpected.evalId
      || source.executionIdentityDigest !== originExpected.executionIdentityDigest
    ) {
      return yield* Effect.fail(referenceInvalid());
    }
    if (member.document.action === "accepted") {
      // Explicit adoption occupies a current target Slot. The origin Attempt
      // keeps its own Slot identity; only the exact sealed reference is required.
      return;
    }
    if (
      expected.slotId !== originExpected.slotId
      || expected.evalId !== originExpected.evalId
      || expected.attemptOrdinal !== originExpected.attemptOrdinal
      || expected.executionIdentityDigest !== originExpected.executionIdentityDigest
    ) {
      return yield* Effect.fail(referenceInvalid());
    }
  });
}

function fixedFamily(value: string): value is FixedRecordFamily {
  return (FIXED_RECORD_FAMILIES as readonly string[]).includes(value);
}

function canonicalRunRelativePath(value: string): CanonicalRunRelativePath | undefined {
  const decoded = Schema.decodeUnknownEither(CanonicalRunRelativePathSchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function recordBlobKey(value: string): RecordBlobKey | undefined {
  const decoded = Schema.decodeUnknownEither(RecordBlobKeySchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function attachmentRuntimeFor(input: {
  readonly run: RunRuntime;
  readonly owner: "run" | AttemptId;
  readonly family: FixedRecordFamily;
}): FixedAttachmentRuntime | undefined {
  return input.owner === "run"
    ? input.run.attachments.get(input.family)
    : input.run.attempts.get(input.owner)?.attachments.get(input.family);
}

function classifyStagedFile(input: {
  readonly run: RunRuntime;
  readonly path: string;
}): {
  readonly kind: SealManifestEntry["kind"];
  readonly owner: "run" | AttemptId;
  readonly family: FixedRecordFamily | null;
} | undefined {
  if (input.path === "run.json") {
    return Object.freeze({ kind: "core" as const, owner: "run" as const, family: null });
  }
  const segments = input.path.split("/");
  if (segments.length === 2 && segments[0] === "members" && segments[1]!.endsWith(".json")) {
    const slotId = decodeSlotId(segments[1]!.slice(0, -".json".length));
    return slotId !== undefined && input.run.membership.has(slotId)
      ? Object.freeze({ kind: "core" as const, owner: "run" as const, family: null })
      : undefined;
  }
  if (segments.length === 3 && segments[0] === "attempts" && segments[2] === "attempt.json") {
    const attemptId = decodeAttemptId(segments[1]!);
    return attemptId !== undefined && input.run.attempts.has(attemptId)
      ? Object.freeze({ kind: "core" as const, owner: attemptId, family: null })
      : undefined;
  }

  let owner: "run" | AttemptId;
  let familyText: string;
  let tail: readonly string[];
  if (segments[0] === "attachments" && segments.length >= 3) {
    owner = "run";
    familyText = segments[1]!;
    tail = segments.slice(2);
  } else if (
    segments[0] === "attempts" &&
    segments[2] === "attachments" &&
    segments.length >= 5
  ) {
    const attemptId = decodeAttemptId(segments[1]!);
    if (attemptId === undefined) return undefined;
    owner = attemptId;
    familyText = segments[3]!;
    tail = segments.slice(4);
  } else {
    return undefined;
  }
  if (!fixedFamily(familyText)) return undefined;
  if (attachmentRuntimeFor({ run: input.run, owner, family: familyText }) === undefined) {
    return undefined;
  }
  if (tail.length === 1 && tail[0] === "attachment.json") {
    return Object.freeze({ kind: "attachment-envelope" as const, owner, family: familyText });
  }
  if (tail.length === 1 && tail[0] === "payload.json") {
    return Object.freeze({ kind: "payload" as const, owner, family: familyText });
  }
  if (tail.length === 2 && tail[0] === "blobs" && recordBlobKey(tail[1]!) !== undefined) {
    return Object.freeze({ kind: "blob" as const, owner, family: familyText });
  }
  return undefined;
}

function expectedStagedCorePaths(run: RunRuntime): readonly string[] {
  return Object.freeze([
    "run.json",
    ...[...run.membership.keys()].map((slotId) => `members/${slotId}.json`),
    ...[...run.attempts.keys()].map((attemptId) => `attempts/${attemptId}/attempt.json`),
  ].sort(compareCanonicalIdentity));
}

function buildStagedInventory(
  run: RunRuntime,
): Effect.Effect<readonly SealManifestEntry[], RecordWriteError> {
  const storage = stagedRunStorage(run.fileSystem, run.staging);
  return Effect.gen(function* () {
    const shape = yield* scanRunStorageShape(storage);
    if (
      shape === undefined ||
      shape.files.includes("complete") ||
      shape.files.includes("seal-manifest.json") ||
      !sameOrderedStrings(shape.directories, expectedInventoryDirectories(shape.files))
    ) return yield* Effect.fail(coreInvalid());

    const entries: SealManifestEntry[] = [];
    for (const pathText of shape.files) {
      const path = canonicalRunRelativePath(pathText);
      const classified = classifyStagedFile({ run, path: pathText });
      if (path === undefined || classified === undefined) {
        return yield* Effect.fail(coreInvalid());
      }
      const maximumBytes = classified.kind === "core"
        ? MAXIMUM_CORE_BYTES
        : classified.kind === "blob"
        ? MAXIMUM_ATTACHMENT_BLOB_BYTES
        : RECORD_JSON_MAXIMUM_BYTES;
      const bytes = yield* readStorageFileForValidation(storage, pathText.split("/"), maximumBytes);
      if (bytes === undefined) return yield* Effect.fail(coreInvalid());
      entries.push(Object.freeze({
        ...classified,
        path,
        byteLength: bytes.byteLength,
        sha256: sha256Bytes(bytes),
      }));
    }
    const corePaths = entries
      .filter((entry) => entry.kind === "core")
      .map((entry) => entry.path);
    if (!sameOrderedStrings(corePaths, expectedStagedCorePaths(run))) {
      return yield* Effect.fail(coreInvalid());
    }
    for (const attachment of [
      ...run.attachments.values(),
      ...[...run.attempts.values()].flatMap((attempt) => [...attempt.attachments.values()]),
    ]) {
      const owned = entries.filter((entry) =>
        entry.owner === (attachment.owner === "run" ? "run" : attachment.attemptId) &&
        entry.family === attachment.name
      );
      if (
        owned.filter((entry) => entry.kind === "attachment-envelope").length !== 1 ||
        owned.filter((entry) => entry.kind === "payload").length !== 1 ||
        owned.filter((entry) => entry.kind === "blob").length !== attachment.blobCount
      ) return yield* Effect.fail(fixedFamilyWriteInvalid());
    }
    return Object.freeze(entries);
  });
}

function sourceManifestSortKey(source: SourceReceiptManifestEntry): string {
  const owner = source.owner.kind === "run" ? "0" : `1:${source.owner.attemptId}`;
  return `${owner}\u0000${source.family}`;
}

function buildSourceManifestEntries(input: {
  readonly run: RunRuntime;
  readonly entries: readonly SealManifestEntry[];
}): Effect.Effect<readonly SourceReceiptManifestEntry[], RecordWriteError> {
  return Effect.gen(function* () {
    const sources: SourceReceiptManifestEntry[] = [];
    const attachments = [
      ...input.run.attachments.values(),
      ...[...input.run.attempts.values()].flatMap((attempt) => [...attempt.attachments.values()]),
    ];
    for (const attachment of attachments) {
      if (!sourceFamily(attachment.name)) continue;
      const captured = recordAttachmentWriteContents(attachment.write);
      if (Either.isLeft(captured)) return yield* Effect.fail(captured.left);
      const segments = sourceSegmentIdentities(captured.right.payload);
      if (segments === undefined) return yield* Effect.fail(fixedFamilyWriteInvalid());
      const owner = attachment.owner === "run"
        ? Object.freeze({ kind: "run" as const })
        : Object.freeze({ kind: "attempt" as const, attemptId: attachment.attemptId! });
      const ownerText = attachment.owner === "run" ? "run" : attachment.attemptId!;
      const owned = input.entries.filter((entry) =>
        entry.owner === ownerText && entry.family === attachment.name
      );
      const payload = owned.find((entry) => entry.kind === "payload");
      if (payload === undefined) return yield* Effect.fail(fixedFamilyWriteInvalid());
      const blobs = owned
        .filter((entry) => entry.kind === "blob")
        .map((entry) => {
          const key = recordBlobKey(entry.path.split("/").at(-1)!);
          if (key === undefined) return undefined;
          return Object.freeze({ key, byteLength: entry.byteLength, sha256: entry.sha256 });
        });
      if (blobs.some((blob) => blob === undefined)) {
        return yield* Effect.fail(fixedFamilyWriteInvalid());
      }
      sources.push(Object.freeze({
        owner,
        family: attachment.name,
        schemaVersion: attachment.descriptor.schemaVersion,
        payload: Object.freeze({ byteLength: payload.byteLength, sha256: payload.sha256 }),
        segments,
        blobs: Object.freeze((blobs as SourceReceiptManifestEntry["blobs"][number][])
          .sort((left, right) => compareCanonicalIdentity(left.key, right.key))),
      }));
    }
    sources.sort((left, right) => compareCanonicalIdentity(
      sourceManifestSortKey(left),
      sourceManifestSortKey(right),
    ));
    return Object.freeze(sources);
  });
}

function buildSealManifest(run: RunRuntime): Effect.Effect<{
  readonly document: SealManifestDocument;
  readonly bytes: Uint8Array;
}, RecordWriteError> {
  return Effect.gen(function* () {
    const entries = yield* buildStagedInventory(run);
    const sources = yield* buildSourceManifestEntries({ run, entries });
    const document: SealManifestDocument = Object.freeze({
      format: SEAL_MANIFEST_FORMAT,
      runId: run.runId,
      entries,
      sources,
    });
    const encoded = encodeSealManifestDocument(document);
    if (Either.isLeft(encoded)) return yield* Effect.fail(coreInvalid());
    return Object.freeze({ document, bytes: jsonBytes(encoded.right) });
  });
}

function syncEntireStaging(run: RunRuntime): Effect.Effect<void, RecordWriteError> {
  return Effect.gen(function* () {
    const shape = yield* scanRunStorageShape(stagedRunStorage(run.fileSystem, run.staging));
    if (shape === undefined) return yield* Effect.fail(coreInvalid());
    const directories = [...shape.directories]
      .sort((left, right) => right.split("/").length - left.split("/").length ||
        compareCanonicalIdentity(left, right));
    for (const directory of directories) {
      yield* run.fileSystem.syncStagingDirectory(stagedRunPath(run, ...directory.split("/")));
    }
    yield* run.fileSystem.syncStagingDirectory(stagedRunPath(run));
  });
}

function startSeal(
  run: RunRuntime,
): Effect.Effect<readonly Deferred.Deferred<void>[], RecordWriteError> {
  return run.mutex.withPermits(1)(
    Effect.gen(function* () {
      yield* assertRunLive(run);
      if (run.state !== "open") return yield* Effect.fail(stateError("publish", run.state));
      run.state = "publishing";
      return Object.freeze([...run.inFlightMutations]);
    }),
  );
}

function sealRun(run: RunRuntime, completion: RunCompletion): Effect.Effect<RecordSealReceipt, RecordWriteError> {
  return Effect.flatMap(startSeal(run), (inFlight) =>
    Effect.gen(function* () {
      yield* Effect.forEach(inFlight, (mutation) => Deferred.await(mutation), {
        discard: true,
      });
      const attempts = yield* run.mutex.withPermits(1)(
        Effect.sync(() => Object.freeze([...run.attempts.values()])),
      );
      yield* Effect.forEach(attempts, (attempt) => Deferred.await(attempt.settled), {
        discard: true,
      });
      yield* run.mutex.withPermits(1)(
        Effect.gen(function* () {
          if (run.state !== "publishing") return yield* Effect.fail(stateError("publish", run.state));
          if (run.inFlightMutations.size !== 0 || attempts.some((attempt) => attempt.state !== "completed")) {
            return yield* Effect.fail(stateError("publish", "failed"));
          }
        }),
      );
      yield* validateAndSyncFixedAttachments(run);
      for (const slot of run.expectedSlots) {
        if (!run.membership.has(slot.slotId)) {
          return yield* Effect.fail(coreInvalid());
        }
      }
      const draft = draftRunDocument(run, completion);
      for (const member of run.membership.values()) {
        if (member.document.attempt !== null && member.document.attempt.originRunId !== run.runId) {
          yield* validateReference(run, member);
        }
      }
      const existing = yield* scanPublishedCore(run.fileSystem, run.root, run.runId);
      const currentAttempts = attempts.map((attempt) => attempt.document);
      if (currentAttempts.some((document) => document === undefined)) {
        return yield* Effect.fail(coreInvalid());
      }
      const currentMembers = [...run.membership.values()]
        .map((member) => member.document)
        .sort((left, right) => compareCanonicalIdentity(left.slotId, right.slotId));
      const aggregate: RecordCore = {
        record: run.record,
        runs: Object.freeze([...existing, Object.freeze({
          run: draft,
          members: Object.freeze(currentMembers),
          attempts: Object.freeze(
            (currentAttempts as AttemptDocument[])
              .sort((left, right) => compareCanonicalIdentity(left.attemptId, right.attemptId)),
          ),
        })].sort((left, right) => compareCanonicalIdentity(left.run.runId, right.run.runId))),
      };
      const aggregateEncoded = encodeRecordCore(aggregate);
      if (Either.isLeft(aggregateEncoded)) return yield* Effect.fail(coreInvalidFromCodec(aggregateEncoded.left));
      const encoded = encodeRunDocument(draft);
      if (Either.isLeft(encoded)) return yield* Effect.fail(coreInvalidFromCodec(encoded.left));
      yield* run.fileSystem.writeStagingFile({
        file: stagedRunPath(run, "run.json"),
        bytes: jsonBytes(encoded.right),
        maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
        mode: "exclusive",
      });
      const sealed = yield* buildSealManifest(run);
      yield* run.fileSystem.writeStagingFile({
        file: stagedRunPath(run, "seal-manifest.json"),
        bytes: sealed.bytes,
        maximumBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
        mode: "exclusive",
      });
      yield* syncEntireStaging(run);

      const paths = yield* run.fileSystem.describeRunStaging(run.staging);
      const recoveryDocument: RecordPublishRecoveryDocument = Object.freeze({
        format: PUBLISH_RECOVERY_FORMAT,
        version: 1,
        recordId: run.record.recordId,
        runId: run.runId,
        stagingPath: paths.stagingPath,
        destinationPath: paths.destinationPath,
        sealManifestSha256: sha256Bytes(sealed.bytes),
        inventory: sealed.document.entries,
      });
      const encodedRecovery = encodeRecordPublishRecoveryDocument(recoveryDocument);
      if (Either.isLeft(encodedRecovery)) return yield* Effect.fail(coreInvalid());
      // Recovery must be discoverable before a publishable `complete` staging
      // can exist. A crash after this write is therefore always inspectable.
      yield* run.fileSystem.writeRunPublishRecovery({
        staging: run.staging,
        bytes: jsonBytes(encodedRecovery.right),
        maximumBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
      });
      yield* run.fileSystem.createStagingCompleteMarker(run.staging);
      yield* syncEntireStaging(run);

      const stagedPublication = yield* validateRunPublication({
        storage: stagedRunStorage(run.fileSystem, run.staging),
        runId: run.runId,
        fullAttachmentHashes: true,
        strictSources: true,
      });
      if (
        stagedPublication === undefined ||
        stagedPublication.manifestSha256 !== recoveryDocument.sealManifestSha256
      ) return yield* Effect.fail(coreInvalid());

      if ((yield* run.fileSystem.pathKind(runPath(run.root, run.runId))) !== "missing") {
        return yield* Effect.fail(new RecordPathAlreadyExists({
          code: "record-path-already-exists",
          path: paths.destinationPath,
        }));
      }
      yield* run.fileSystem.publishRunStaging(run.staging);
      yield* Effect.sync(() => {
        run.markerCreated = true;
        consumeRunCapabilities(run);
      });
      const published = yield* readPublishedRunPublication(
        run.fileSystem,
        run.root,
        run.runId,
        true,
        true,
      );
      if (
        published === undefined ||
        published.manifestSha256 !== recoveryDocument.sealManifestSha256
      ) return yield* Effect.fail(coreInvalid());
      yield* run.fileSystem.removeRunPublishRecovery(run.staging);
      yield* Effect.sync(() => {
        run.state = "published";
      });
      return Object.freeze({ runId: run.runId, state: "sealed" as const });
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          :
        run.mutex.withPermits(1)(
          Effect.sync(() => {
            if (!run.markerCreated) run.state = "failed";
          }),
        ),
      ),
    ),
  ).pipe(
    // `startSeal` itself may fail, so this finalizer belongs outside the
    // flatMap. Both a failed seal and a published Run consume every writer
    // authority.
    Effect.onExit(() => Effect.sync(() => consumeRunCapabilities(run))),
  );
}

function makeRunSession(run: RunRuntime): RunWriteSession {
  const session: RunWriteSession = Object.freeze({
    runId: run.runId,
    [runWriteSessionBrand]: () => undefined,
    createAttempt(input: { readonly slotId: SlotId }) {
      return runSessions.get(this) === run
        ? createAttempt(run, input)
        : Effect.fail(recordWriterClosed());
    },
    referenceAttempt(input: {
      readonly slotId: SlotId;
      readonly action: "carried" | "accepted";
      readonly attempt: SelectedAttemptRef;
    }) {
      return runSessions.get(this) === run
        ? referenceAttempt(run, input)
        : Effect.fail(recordWriterClosed());
    },
    recordAcceptedMembership(input: {
      readonly slotId: SlotId;
      readonly attempt: SelectedAttemptRef;
    }) {
      return runSessions.get(this) === run
        ? referenceAttempt(run, { slotId: input.slotId, action: "accepted", attempt: input.attempt })
        : Effect.fail(recordWriterClosed());
    },
    recordTerminalMember(input: {
      readonly slotId: SlotId;
      readonly action: "not-dispatched" | "interrupted";
    }) {
      return runSessions.get(this) === run
        ? recordTerminalMember(run, input)
        : Effect.fail(recordWriterClosed());
    },
    writeSources<E, R>(
      value: SourcesWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return runSessions.get(this) === run
        ? writeRunFamily({
            run,
            descriptor: NiceEvalRecordFamilyCatalog.sources,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    writeRunRunnerActivities<E, R>(
      value: RunRunnerActivitiesWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return runSessions.get(this) === run
        ? writeRunFamily({
            run,
            descriptor: NiceEvalRecordFamilyCatalog.runnerActivities.run,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    writeRunRunnerDiagnostics<E, R>(
      value: RunRunnerDiagnosticsWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return runSessions.get(this) === run
        ? writeRunFamily({
            run,
            descriptor: NiceEvalRecordFamilyCatalog.runnerDiagnostics.run,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    writeRunArtifacts<E, R>(
      value: RunArtifactsWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return runSessions.get(this) === run
        ? writeRunFamily({
            run,
            descriptor: NiceEvalRecordFamilyCatalog.artifacts.run,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    seal(completion: RunCompletion) {
      return runSessions.get(this) === run
        ? sealRun(run, completion)
        : Effect.fail(recordWriterClosed());
    },
  });
  run.handle = session;
  runSessions.set(session, run);
  return session;
}

function makeReferenceRunSession(run: RunRuntime): ReferenceRunWriteSession {
  const session: ReferenceRunWriteSession = Object.freeze({
    runId: run.runId,
    [runWriteSessionBrand]: () => undefined,
    referenceAttempt(input: {
      readonly slotId: SlotId;
      readonly action: "carried" | "accepted";
      readonly attempt: SelectedAttemptRef;
    }) {
      return runSessions.get(this) === run
        ? referenceAttempt(run, input)
        : Effect.fail(recordWriterClosed());
    },
    recordAcceptedMembership(input: {
      readonly slotId: SlotId;
      readonly attempt: SelectedAttemptRef;
    }) {
      return runSessions.get(this) === run
        ? referenceAttempt(run, { slotId: input.slotId, action: "accepted", attempt: input.attempt })
        : Effect.fail(recordWriterClosed());
    },
    recordTerminalMember(input: {
      readonly slotId: SlotId;
      readonly action: "not-dispatched" | "interrupted";
    }) {
      return runSessions.get(this) === run
        ? recordTerminalMember(run, input)
        : Effect.fail(recordWriterClosed());
    },
    writeRunRunnerActivities<E, R>(
      value: RunRunnerActivitiesWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return runSessions.get(this) === run
        ? writeRunFamily({
            run,
            descriptor: NiceEvalRecordFamilyCatalog.runnerActivities.run,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    writeRunRunnerDiagnostics<E, R>(
      value: RunRunnerDiagnosticsWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return runSessions.get(this) === run
        ? writeRunFamily({
            run,
            descriptor: NiceEvalRecordFamilyCatalog.runnerDiagnostics.run,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    writeRunArtifacts<E, R>(
      value: RunArtifactsWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return runSessions.get(this) === run
        ? writeRunFamily({
            run,
            descriptor: NiceEvalRecordFamilyCatalog.artifacts.run,
            value,
          })
        : Effect.fail(recordWriterClosed());
    },
    seal(completion: RunCompletion) {
      return runSessions.get(this) === run
        ? sealRun(run, completion)
        : Effect.fail(recordWriterClosed());
    },
  });
  run.handle = session;
  runSessions.set(session, run);
  return session;
}

function openNewRuntime(
  request: CreateRunRequest | CreateReferenceRunRequest,
): Effect.Effect<
  RunRuntime,
  RecordReaderOpenError | RecordWriteError,
  import("effect").Scope.Scope | RecordFileSystem | RecordEntropy | RecordCoordination
> {
  return Effect.gen(function* () {
    // This must precede bootstrap as well as staging creation: malformed
    // public JS input must not leave even a newly initialized Record skeleton.
    const expectedSlots = canonicalizeExpectedSlots(request.expectedSlots);
    if (Either.isLeft(expectedSlots)) {
      return yield* Effect.fail(new RecordCoreInvalid({
        code: "record-core-invalid",
        issues: expectedSlots.left,
      }));
    }
    const context = canonicalizeRunContext(request.context);
    if (Either.isLeft(context)) {
      return yield* Effect.fail(new RecordCoreInvalid({
        code: "record-core-invalid",
        issues: context.left,
      }));
    }
    if (context.right.experimentId !== request.experimentId) {
      const issues = nonEmptyRecordIssues([
        recordIssue("record-run-context-experiment-mismatch", ["context", "experimentId"]),
      ]);
      if (issues === undefined) return yield* Effect.fail(coreInvalid());
      return yield* Effect.fail(new RecordCoreInvalid({
        code: "record-core-invalid",
        issues,
      }));
    }
    const expectedBySlot = new Map(expectedSlots.right.map((slot) => [slot.slotId, slot]));
    if (expectedBySlot.size !== expectedSlots.right.length) return yield* Effect.fail(coreInvalid());

    const coordination = yield* RecordCoordination;
    const fileSystem = yield* RecordFileSystem;
    const entropy = yield* RecordEntropy;
    yield* coordination.enterRecordAppend(request.root);
    if (yield* fileSystem.migrationSentinelPresent(request.root)) {
      return yield* Effect.fail(migrationInterrupted());
    }
    yield* initializeRecord({ root: request.root, fileSystem, entropy });
    const current = yield* readCurrentRecordFormat(fileSystem, request.root);
    yield* ensureOrdinaryCurrentAttachments({ fileSystem, root: request.root });
    yield* coordination.verifyRecordIdentity({ root: request.root, recordId: current.document.recordId });
    yield* recoverRunPublications({
      fileSystem,
      root: request.root,
      record: current.document,
    });
    const fresh = yield* createFreshRunStaging(request.root, fileSystem, entropy);
    const runId = fresh.runId;
    const mutex = yield* Effect.makeSemaphore(1);
    const runtime: RunRuntime = {
      root: request.root,
      fileSystem,
      entropy,
      record: current.document,
      staging: fresh.staging,
      runId,
      experimentId: request.experimentId,
      context: context.right,
      startedAt: request.startedAt,
      expectedSlots: expectedSlots.right,
      expectedBySlot,
      mutex,
      attempts: new Map(),
      slotReservations: new Map(),
      membership: new Map(),
      attachments: new Map(),
      inFlightMutations: new Set(),
      closed: false,
      markerCreated: false,
      state: "open",
      handle: undefined,
    };
    yield* Effect.addFinalizer(() =>
      runtime.mutex.withPermits(1)(
        Effect.sync(() => {
          if (!runtime.markerCreated && runtime.state !== "published") runtime.state = "failed";
          consumeRunCapabilities(runtime);
        }),
      ),
    );
    return runtime;
  });
}

function openNewRun(
  request: CreateRunRequest,
): Effect.Effect<
  RunWriteSession,
  RecordReaderOpenError | RecordWriteError,
  import("effect").Scope.Scope | RecordFileSystem | RecordEntropy | RecordCoordination
> {
  return Effect.map(openNewRuntime(request), makeRunSession);
}

function openNewReferenceRun(
  request: CreateReferenceRunRequest,
): Effect.Effect<
  ReferenceRunWriteSession,
  RecordReaderOpenError | RecordWriteError,
  import("effect").Scope.Scope | RecordFileSystem | RecordEntropy | RecordCoordination
> {
  return Effect.map(openNewRuntime(request), makeReferenceRunSession);
}

type AnyMigrationDescriptor = FixedRecordFamilyDescriptor<
  NiceEvalFamily,
  RecordAttachmentOwner,
  unknown
>;

interface KnownMigrationAttachment {
  readonly owner: RecordAttachmentOwner;
  readonly runId: RunId;
  readonly attemptId?: AttemptId;
  readonly descriptor: AnyMigrationDescriptor;
}

type KnownFamilyDescriptor =
  | (typeof NiceEvalRecordFamilyDescriptorsByOwner.attempt)[number]
  | (typeof NiceEvalRecordFamilyDescriptorsByOwner.run)[number];

function migrationDescriptor(descriptor: KnownFamilyDescriptor): AnyMigrationDescriptor {
  return descriptor as unknown as AnyMigrationDescriptor;
}

const runMigrationDescriptors = Object.freeze([
  ...NiceEvalRecordFamilyDescriptorsByOwner.run.map(migrationDescriptor),
]);

const attemptMigrationDescriptors = Object.freeze([
  ...NiceEvalRecordFamilyDescriptorsByOwner.attempt.map(migrationDescriptor),
]);

const runMigrationDescriptorsByFamily: ReadonlyMap<string, AnyMigrationDescriptor> = new Map(
  runMigrationDescriptors.map((descriptor) => [descriptor.family, descriptor] as const),
);

const attemptMigrationDescriptorsByFamily: ReadonlyMap<string, AnyMigrationDescriptor> = new Map(
  attemptMigrationDescriptors.map((descriptor) => [descriptor.family, descriptor] as const),
);

function validateAttachmentDirectoryInventory(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly directory: ReturnType<typeof recordPortablePath>;
  readonly allowed: ReadonlySet<string>;
}): Effect.Effect<void, RecordFileSystemError | RecordFormatUnsupported> {
  return Effect.gen(function* () {
    const kind = yield* input.fileSystem.pathKind(input.directory);
    if (kind === "missing") return;
    if (kind !== "directory") {
      return yield* Effect.fail(new RecordFormatUnsupported({
        code: "record-format-unsupported",
        format: "attachment-inventory",
      }));
    }
    const entries = yield* input.fileSystem.listDirectory({
      directory: input.directory,
      maximumEntries: 256,
    });
    const unsupported = entries.find((entry) => entry.kind !== "directory" || !input.allowed.has(entry.name));
    if (unsupported !== undefined) {
      return yield* Effect.fail(new RecordFormatUnsupported({
        code: "record-format-unsupported",
        format: `unknown-family:${unsupported.name}`,
      }));
    }
  });
}

function validateCurrentFamilyInventory(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runIds?: ReadonlySet<RunId>,
): Effect.Effect<readonly KnownMigrationAttachment[], RecordFileSystemError | RecordFormatUnsupported> {
  const runFamilies = new Set(runMigrationDescriptors.map((descriptor) => descriptor.family));
  const attemptFamilies = new Set(attemptMigrationDescriptors.map((descriptor) => descriptor.family));
  return Effect.gen(function* () {
    const runs = yield* fileSystem.listDirectory({
      directory: recordPortablePath(root, "runs"),
      maximumEntries: MAXIMUM_RUN_ENTRIES,
    });
    for (const entry of runs) {
      if (entry.kind !== "directory") continue;
      const runId = decodeRunId(entry.name);
      if (
        runId === undefined ||
        !(yield* fileSystem.isCompleteMarker({ root, runId }))
      ) continue;
      if (runIds !== undefined && !runIds.has(runId)) continue;
      yield* validateAttachmentDirectoryInventory({
        fileSystem,
        directory: recordPortablePath(root, "runs", runId, "attachments"),
        allowed: runFamilies,
      });
      const attemptsDirectory = recordPortablePath(root, "runs", runId, "attempts");
      if ((yield* fileSystem.pathKind(attemptsDirectory)) !== "directory") continue;
      const attempts = yield* fileSystem.listDirectory({
        directory: attemptsDirectory,
        maximumEntries: MAXIMUM_ATTEMPT_ENTRIES,
      });
      for (const attempt of attempts) {
        if (attempt.kind !== "directory") continue;
        const attemptId = decodeAttemptId(attempt.name);
        if (attemptId === undefined) continue;
        yield* validateAttachmentDirectoryInventory({
          fileSystem,
          directory: recordPortablePath(root, "runs", runId, "attempts", attemptId, "attachments"),
          allowed: attemptFamilies,
        });
      }
    }
    const locations = yield* knownMigrationAttachments(fileSystem, root, runIds);
    for (const location of locations) {
      const envelope = yield* inspectFixedRecordAttachmentEnvelope({
        fileSystem,
        root,
        location: migrationReaderLocation(location),
        descriptor: location.descriptor,
      });
      if (envelope.state === "unsupported") {
        return yield* Effect.fail(new RecordFormatUnsupported({
          code: "record-format-unsupported",
          format: `${envelope.family}@${envelope.schemaVersion}`,
        }));
      }
    }
    return locations;
  });
}

function migrationAttachmentDirectory(
  root: RecordRoot,
  location: KnownMigrationAttachment,
) {
  return location.owner === "run"
    ? recordPortablePath(
        root,
        "runs",
        location.runId,
        "attachments",
        location.descriptor.family,
      )
    : recordPortablePath(
        root,
        "runs",
        location.runId,
        "attempts",
        location.attemptId!,
        "attachments",
        location.descriptor.family,
      );
}

function migrationReaderLocation(location: KnownMigrationAttachment) {
  return location.owner === "run"
    ? Object.freeze({ owner: "run" as const, runId: location.runId })
    : Object.freeze({
        owner: "attempt" as const,
        runId: location.runId,
        attemptId: location.attemptId!,
      });
}

/**
 * This traversal only addresses declared family directories. It deliberately
 * never enumerates an attachment directory, so unknown families cannot enter
 * the migration graph or be rewritten as a side effect.
 */
function knownMigrationAttachments(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runIds?: ReadonlySet<RunId>,
): Effect.Effect<readonly KnownMigrationAttachment[], RecordFileSystemError> {
  return Effect.gen(function* () {
    const locations: KnownMigrationAttachment[] = [];
    const runs = yield* fileSystem.listDirectory({
      directory: recordPortablePath(root, "runs"),
      maximumEntries: MAXIMUM_RUN_ENTRIES,
    });
    for (const entry of runs) {
      if (entry.kind !== "directory") continue;
      const runId = decodeRunId(entry.name);
      if (runId === undefined) continue;
      if (runIds !== undefined && !runIds.has(runId)) continue;
      // Draft directories are not Runs and belong exclusively to `niceeval
      // clean`; maintenance must preserve every byte beneath them.
      if (!(yield* isSealedRun(fileSystem, root, runId))) continue;

      for (const descriptor of runMigrationDescriptors) {
        const location: KnownMigrationAttachment = Object.freeze({
          owner: "run" as const,
          runId,
          descriptor,
        });
        if ((yield* fileSystem.pathKind(migrationAttachmentDirectory(root, location))) !== "missing") {
          locations.push(location);
        }
      }

      const attempts = yield* fileSystem.listDirectory({
        directory: recordPortablePath(root, "runs", runId, "attempts"),
        maximumEntries: MAXIMUM_ATTEMPT_ENTRIES,
      });
      for (const attemptEntry of attempts) {
        if (attemptEntry.kind !== "directory") continue;
        const attemptId = decodeAttemptId(attemptEntry.name);
        if (attemptId === undefined) continue;
        for (const descriptor of attemptMigrationDescriptors) {
          const location: KnownMigrationAttachment = Object.freeze({
            owner: "attempt" as const,
            runId,
            attemptId,
            descriptor,
          });
          if ((yield* fileSystem.pathKind(migrationAttachmentDirectory(root, location))) !== "missing") {
            locations.push(location);
          }
        }
      }
    }
    return Object.freeze(locations);
  });
}

function readKnownMigrationAttachment(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  location: KnownMigrationAttachment,
) {
  return readFixedRecordAttachment({
    fileSystem,
    root,
    location: migrationReaderLocation(location),
    descriptor: location.descriptor,
  });
}

function migrationInvalid(family: string): RecordMigrationInvalid {
  return new RecordMigrationInvalid({ code: "record-migration-invalid", family });
}

function migrationPlanStale(): RecordMigrationPlanStale {
  return new RecordMigrationPlanStale({ code: "record-migration-plan-stale" });
}

function migrationFailureCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "record-command-failed";
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : "record-command-failed";
}

function normalizedMigrationRetention(
  value: unknown,
): import("../definition/attachment.ts").RecordAttachmentMigrationRetention | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const retention = value as Record<string, unknown>;
  const retainedFacts = retention.retainedFacts;
  const droppedFacts = retention.droppedFacts;
  const rerunRecommendation = retention.rerunRecommendation;
  if (
    !Array.isArray(retainedFacts) || retainedFacts.some((fact) => typeof fact !== "string" || fact.length === 0) ||
    !Array.isArray(droppedFacts) || droppedFacts.some((fact) => typeof fact !== "string" || fact.length === 0) ||
    (rerunRecommendation !== null &&
      (typeof rerunRecommendation !== "string" || rerunRecommendation.length === 0))
  ) return undefined;
  return Object.freeze({
    retainedFacts: Object.freeze([...retainedFacts] as string[]),
    droppedFacts: Object.freeze([...droppedFacts] as string[]),
    rerunRecommendation,
  });
}

function migrationTarget(
  location: KnownMigrationAttachment,
  fromSchemaVersion: number,
  toSchemaVersion: number,
  retention: import("../definition/attachment.ts").RecordAttachmentMigrationRetention,
): RecordAttachmentMigrationTarget {
  return Object.freeze({
    family: location.descriptor.family,
    owner: location.owner,
    runId: location.runId,
    ...(location.attemptId === undefined ? {} : { attemptId: location.attemptId }),
    fromSchemaVersion,
    toSchemaVersion,
    retention,
  });
}

function migrationLocationKey(
  owner: RecordAttachmentOwner,
  runId: RunId,
  attemptId: AttemptId | undefined,
  family: string,
): string {
  return `${owner}\u0000${runId}\u0000${attemptId ?? ""}\u0000${family}`;
}

function validateProspectiveCrossFamilyJoins(
  values: readonly { readonly location: KnownMigrationAttachment; readonly payload: unknown }[],
): boolean {
  const byLocation = new Map(values.map(({ location, payload }) => [
    migrationLocationKey(location.owner, location.runId, location.attemptId, location.descriptor.family),
    payload,
  ] as const));
  for (const { location, payload } of values) {
    const runSources = () => byLocation.get(migrationLocationKey(
      "run",
      location.runId,
      undefined,
      NiceEvalRecordFamilyCatalog.sources.family,
    )) as SourcesAttachment | undefined;
    // Source cross-family validity is local to that source. A malformed
    // Runner Diagnostics receipt must not prevent an unrelated Assertions
    // migration from planning or completing.
    if (isAssertionsDescriptor(location.descriptor)) {
      const assertions = payload as AssertionsAttachment;
      if (assertions.sourceSites.length > 0) {
        const sources = runSources();
        if (sources === undefined || assertionsSourceSiteIntegrityIssues(assertions, sources).length > 0) {
          return false;
        }
      }
    }
  }
  return true;
}

interface PlannedMigrationSource {
  readonly target: RecordAttachmentMigrationTarget;
  readonly location: KnownMigrationAttachment;
  readonly envelopeBytes: Uint8Array;
  readonly payloadBytes: Uint8Array;
  readonly removedBlobs: readonly { readonly key: string; readonly bytes: Uint8Array }[];
  readonly rewritePayload: boolean;
}

interface PlannedMigrationManifest {
  readonly runId: RunId;
  readonly bytes: Uint8Array;
  readonly document: SealManifestPublicationDocument;
}

interface PlannedMigrationSources {
  readonly attachments: readonly PlannedMigrationSource[];
  readonly manifests: readonly PlannedMigrationManifest[];
  readonly rootIdentityBytes: Uint8Array;
  readonly implementationIdentity: typeof RECORD_MIGRATION_IMPLEMENTATION_ID;
}

const RECORD_MIGRATION_IMPLEMENTATION_ID = "niceeval.record/current-attachments/v2" as const;
const migrationPlanSources = new WeakMap<object, PlannedMigrationSources>();

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function migrationEnvelopePath(
  root: RecordRoot,
  location: KnownMigrationAttachment,
) {
  return recordPortablePath(
    root,
    ...migrationAttachmentDirectory(root, location).segments,
    "attachment.json",
  );
}

function sameMigrationPlan(left: RecordMigrationPlan, right: RecordMigrationPlan): boolean {
  if (left.state !== right.state || left.format !== right.format) return false;
  if (left.state !== "migration-required" || right.state !== "migration-required") return true;
  if (JSON.stringify(left.backup) !== JSON.stringify(right.backup)) return false;
  if (left.attachments.length !== right.attachments.length) return false;
  if (!left.attachments.every((target, index) => {
    const candidate = right.attachments[index];
    return candidate !== undefined &&
      target.family === candidate.family &&
      target.owner === candidate.owner &&
      target.runId === candidate.runId &&
      target.attemptId === candidate.attemptId &&
      target.fromSchemaVersion === candidate.fromSchemaVersion &&
      target.toSchemaVersion === candidate.toSchemaVersion &&
      JSON.stringify(target.retention) === JSON.stringify(candidate.retention);
  })) return false;
  const leftSources = migrationPlanSources.get(left);
  const rightSources = migrationPlanSources.get(right);
  if (
    leftSources === undefined || rightSources === undefined ||
    leftSources.implementationIdentity !== rightSources.implementationIdentity ||
    !bytesEqual(leftSources.rootIdentityBytes, rightSources.rootIdentityBytes) ||
    leftSources.attachments.length !== rightSources.attachments.length ||
    leftSources.manifests.length !== rightSources.manifests.length ||
    !leftSources.manifests.every((manifest, index) => {
      const candidate = rightSources.manifests[index];
      return candidate !== undefined && manifest.runId === candidate.runId &&
        bytesEqual(manifest.bytes, candidate.bytes);
    })
  ) return false;
  return leftSources.attachments.every((source, index) => {
    const candidate = rightSources.attachments[index];
    return candidate !== undefined &&
      bytesEqual(source.envelopeBytes, candidate.envelopeBytes) &&
      bytesEqual(source.payloadBytes, candidate.payloadBytes) &&
      source.rewritePayload === candidate.rewritePayload &&
      source.removedBlobs.length === candidate.removedBlobs.length &&
      source.removedBlobs.every((blob, blobIndex) => {
        const other = candidate.removedBlobs[blobIndex];
        return other !== undefined && blob.key === other.key && bytesEqual(blob.bytes, other.bytes);
      });
  });
}

function planAttachmentMigration(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runIds?: ReadonlySet<RunId>;
}): Effect.Effect<{
  readonly targets: readonly RecordAttachmentMigrationTarget[];
  readonly sources: readonly PlannedMigrationSource[];
}, RecordFileSystemError | RecordFormatUnsupported | RecordMigrationInvalid> {
  return Effect.gen(function* () {
    yield* validateCurrentFamilyInventory(input.fileSystem, input.root, input.runIds);
    const targets: RecordAttachmentMigrationTarget[] = [];
    const sources: PlannedMigrationSource[] = [];
    const prospective: { readonly location: KnownMigrationAttachment; readonly payload: unknown }[] = [];
    for (const location of yield* knownMigrationAttachments(input.fileSystem, input.root, input.runIds)) {
      const read = yield* readKnownMigrationAttachment(input.fileSystem, input.root, location);
      if (read.state === "available") {
        prospective.push(Object.freeze({ location, payload: read.value }));
        continue;
      }
      const migrationLink = read.state === "migration-required"
        ? location.descriptor.adjacentMigrationLinks.find((link) =>
            link.fromSchemaVersion === read.fromSchemaVersion && link.toSchemaVersion === read.toSchemaVersion)
        : undefined;
      if (read.state === "migration-required" && migrationLink !== undefined) {
        const envelopeBytes = yield* input.fileSystem.readFile({
          file: migrationEnvelopePath(input.root, location),
          maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
        });
        if (envelopeBytes === undefined) {
          return yield* Effect.fail(migrationInvalid(location.descriptor.family));
        }
        const facet = yield* loadAttachmentMaintenance(location.descriptor);
        const historical = facet.historicalCodecs.find((codec) => codec.schemaVersion === read.fromSchemaVersion);
        const step = facet.adjacentMigrations.find((migration) =>
          migration.fromSchemaVersion === read.fromSchemaVersion &&
          migration.toSchemaVersion === read.toSchemaVersion);
        if (historical === undefined || step === undefined) {
          return yield* Effect.fail(migrationInvalid(location.descriptor.family));
        }
        const retention = normalizedMigrationRetention(step.retention);
        if (retention === undefined) {
          return yield* Effect.fail(migrationInvalid(location.descriptor.family));
        }
        const target = migrationTarget(
          location,
          read.fromSchemaVersion,
          read.toSchemaVersion,
          retention,
        );
        const prepared = yield* validateFixedRecordAttachmentMigrationSource({
          fileSystem: input.fileSystem,
          root: input.root,
          location: migrationReaderLocation(location),
          descriptor: location.descriptor,
          fromSchemaVersion: read.fromSchemaVersion,
          decodeHistorical: historical.decode,
          ...(historical.verify === undefined ? {} : { verifyHistorical: historical.verify }),
          migrate: step.migrate,
        });
        if (prepared === false || prepared.rewritePayload !== migrationLink.rewritePayload) {
          return yield* Effect.fail(migrationInvalid(location.descriptor.family));
        }
        prospective.push(Object.freeze({ location, payload: prepared.payload }));
        const payloadBytes = yield* input.fileSystem.readFile({
          file: recordPortablePath(
            input.root,
            ...migrationAttachmentDirectory(input.root, location).segments,
            "payload.json",
          ),
          maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
        });
        if (payloadBytes === undefined) return yield* Effect.fail(migrationInvalid(location.descriptor.family));
        targets.push(target);
        sources.push(Object.freeze({
          target,
          location,
          envelopeBytes,
          payloadBytes,
          removedBlobs: prepared.removedBlobs,
          rewritePayload: migrationLink.rewritePayload,
        }));
        continue;
      }
      if (read.state === "unsupported") {
        return yield* Effect.fail(new RecordFormatUnsupported({
          code: "record-format-unsupported",
          format: `${read.family}@${read.schemaVersion}`,
        }));
      }
      if (
        sourceFamily(location.descriptor.family) &&
        (read.state === "invalid" || read.state === "unavailable")
      ) continue;
      return yield* Effect.fail(migrationInvalid(location.descriptor.family));
    }
    if (!validateProspectiveCrossFamilyJoins(prospective)) {
      return yield* Effect.fail(migrationInvalid("niceeval.record cross-family"));
    }
    return Object.freeze({
      targets: Object.freeze(targets),
      sources: Object.freeze(sources),
    });
  });
}

function inspectOrdinaryCurrentAttachments(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runIds?: ReadonlySet<RunId>;
}): Effect.Effect<RecordMigrationRequired | undefined, RecordReaderOpenError> {
  return Effect.gen(function* () {
    let pendingMigration: RecordMigrationRequired | undefined;
    // Root inventory remains fail-closed: an unknown durable family is not a
    // source-local fact. Known current payload closures are read lazily by
    // their own methods so one invalid source never prevents unrelated sources
    // from being selected and read.
    const inspectDirectory = (
      directory: ReturnType<typeof recordPortablePath>,
      owner: RecordAttachmentOwner,
      runId: RunId,
      attemptId?: AttemptId,
    ): Effect.Effect<void, RecordReaderOpenError> => Effect.gen(function* () {
      const kind = yield* input.fileSystem.pathKind(directory);
      if (kind === "missing") return;
      if (kind !== "directory") {
        return yield* Effect.fail(new RecordFormatUnsupported({
          code: "record-format-unsupported",
          format: "attachment-inventory",
        }));
      }
      const entries = yield* input.fileSystem.listDirectory({ directory, maximumEntries: 256 });
      const descriptors = owner === "run"
        ? runMigrationDescriptorsByFamily
        : attemptMigrationDescriptorsByFamily;
      for (const entry of entries) {
        const descriptor = entry.kind === "directory" ? descriptors.get(entry.name) : undefined;
        if (descriptor === undefined) {
          return yield* Effect.fail(new RecordFormatUnsupported({
            code: "record-format-unsupported",
            format: `unknown-family:${entry.name}`,
          }));
        }
        const location: KnownMigrationAttachment = owner === "run"
          ? Object.freeze({ owner, runId, descriptor })
          : Object.freeze({ owner, runId, attemptId: attemptId!, descriptor });
        const envelope = yield* inspectFixedRecordAttachmentEnvelope({
          fileSystem: input.fileSystem,
          root: input.root,
          location: migrationReaderLocation(location),
          descriptor,
        });
        if (envelope.state === "unsupported") {
          return yield* Effect.fail(new RecordFormatUnsupported({
            code: "record-format-unsupported",
            format: `${envelope.family}@${envelope.schemaVersion}`,
          }));
        }
        if (envelope.state === "migration-required" && pendingMigration === undefined) {
          pendingMigration = new RecordMigrationRequired({
            code: "record-migration-required",
            source: `${envelope.family}@${envelope.fromSchemaVersion}`,
            target: `${envelope.family}@${envelope.toSchemaVersion}`,
            command: envelope.command,
          });
        }
      }
    });

    const runs = yield* input.fileSystem.listDirectory({
      directory: recordPortablePath(input.root, "runs"),
      maximumEntries: MAXIMUM_RUN_ENTRIES,
    });
    for (const entry of runs) {
      if (entry.kind !== "directory") continue;
      const runId = decodeRunId(entry.name);
      if (
        runId === undefined ||
        (input.runIds !== undefined && !input.runIds.has(runId)) ||
        !(yield* input.fileSystem.isCompleteMarker({ root: input.root, runId }))
      ) continue;
      yield* inspectDirectory(
        recordPortablePath(input.root, "runs", runId, "attachments"),
        "run",
        runId,
      );
      const attemptsDirectory = recordPortablePath(input.root, "runs", runId, "attempts");
      if ((yield* input.fileSystem.pathKind(attemptsDirectory)) !== "directory") continue;
      const attempts = yield* input.fileSystem.listDirectory({
        directory: attemptsDirectory,
        maximumEntries: MAXIMUM_ATTEMPT_ENTRIES,
      });
      for (const attempt of attempts) {
        if (attempt.kind !== "directory") continue;
        const attemptId = decodeAttemptId(attempt.name);
        if (attemptId === undefined) continue;
        yield* inspectDirectory(
          recordPortablePath(
            input.root,
            "runs",
            runId,
            "attempts",
            attemptId,
            "attachments",
          ),
          "attempt",
          runId,
          attemptId,
        );
      }
    }
    return pendingMigration;
  });
}

function ensureOrdinaryCurrentAttachments(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runIds?: ReadonlySet<RunId>;
}): Effect.Effect<void, RecordReaderOpenError> {
  return Effect.flatMap(inspectOrdinaryCurrentAttachments(input), (migration) =>
    migration === undefined ? Effect.void : Effect.fail(migration));
}

function migrationPlan(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly git: RecordGitService;
}): Effect.Effect<RecordMigrationPlan, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const format = yield* readRecordFormatForMaintenance(input.fileSystem, input.root);
    // Unknown future families are a compatibility failure even when this
    // package cannot decode their manifest entries to reconstruct Core.
    yield* validateCurrentFamilyInventory(input.fileSystem, input.root);
    yield* validateSealedCoreForMigration(input.fileSystem, input.root, format.document);
    const attachments = yield* planAttachmentMigration(input);
    if (attachments.targets.length === 0) {
      return Object.freeze({ state: "already-current" as const, format: RECORD_FORMAT });
    }
    const backup = yield* input.git.inspectBackupState(input.root);
    const plan = Object.freeze({
      state: "migration-required" as const,
      format: RECORD_FORMAT,
      backup,
      attachments: attachments.targets,
    });
    const manifests: PlannedMigrationManifest[] = [];
    const affectedRunIds = [...new Set(attachments.sources.map((source) => source.location.runId))]
      .sort(compareCanonicalIdentity);
    for (const runId of affectedRunIds) {
      const bytes = yield* input.fileSystem.readFile({
        file: runPath(input.root, runId, "seal-manifest.json"),
        maximumBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
      });
      const json = bytes === undefined ? undefined : parseJson(bytes);
      const decoded = json === undefined ? undefined : decodeSealManifestPublicationDocument(json);
      if (
        bytes === undefined || decoded === undefined || Either.isLeft(decoded) ||
        decoded.right.runId !== runId
      ) return yield* Effect.fail(migrationInvalid("niceeval.core"));
      manifests.push(Object.freeze({ runId, bytes: bytes.slice(), document: decoded.right }));
    }
    migrationPlanSources.set(plan, Object.freeze({
      attachments: attachments.sources,
      manifests: Object.freeze(manifests),
      rootIdentityBytes: format.sourceBytes,
      implementationIdentity: RECORD_MIGRATION_IMPLEMENTATION_ID,
    }));
    return plan;
  });
}

function validateSealedCoreForMigration(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  record: RecordDocument,
): Effect.Effect<void, RecordMaintenanceError> {
  return Effect.flatMap(
    loadSealedCoreSnapshot(maintenanceReaderRuntime(root, record), fileSystem, {
      fullAttachmentHashes: true,
      strictSources: true,
    }),
    (snapshot) => snapshot.state === "available"
      ? Effect.void
      : Effect.fail(migrationInvalid("niceeval.core")),
  );
}

function loadAttachmentMaintenance(descriptor: AnyMigrationDescriptor): Effect.Effect<
  import("../definition/attachment.ts").RecordAttachmentMaintenanceFacet,
  RecordMigrationInvalid
> {
  const loader = descriptor.maintenance;
  if (loader === undefined) return Effect.fail(migrationInvalid(descriptor.family));
  return Effect.tryPromise({
    try: loader,
    catch: () => migrationInvalid(descriptor.family),
  });
}

function migrateKnownAttachment(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: KnownMigrationAttachment;
  readonly target: RecordAttachmentMigrationTarget;
  readonly expectedEnvelopeBytes: Uint8Array;
  readonly expectedPayloadBytes: Uint8Array;
  readonly expectedRemovedBlobs: readonly { readonly key: string; readonly bytes: Uint8Array }[];
  readonly rewritePayload: boolean;
  /** Marks the transaction dirty immediately before its first portable mutation. */
  readonly markPortableWrite: () => void;
}): Effect.Effect<void, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const descriptor = input.location.descriptor;
    const migrationLink = descriptor.adjacentMigrationLinks.find((link) =>
      link.fromSchemaVersion === input.target.fromSchemaVersion &&
      link.toSchemaVersion === input.target.toSchemaVersion);
    if (migrationLink === undefined || migrationLink.rewritePayload !== input.rewritePayload) {
      return yield* Effect.fail(migrationInvalid(input.target.family));
    }
    const location = input.location;
    const facet = yield* loadAttachmentMaintenance(descriptor);
    const historical = facet.historicalCodecs.find((codec) => codec.schemaVersion === input.target.fromSchemaVersion);
    const step = facet.adjacentMigrations.find(
      (migration) => migration.fromSchemaVersion === input.target.fromSchemaVersion &&
        migration.toSchemaVersion === input.target.toSchemaVersion,
    );
    if (historical === undefined || step === undefined) {
      return yield* Effect.fail(migrationInvalid(input.target.family));
    }
    const retention = normalizedMigrationRetention(step.retention);
    if (retention === undefined || JSON.stringify(retention) !== JSON.stringify(input.target.retention)) {
      return yield* Effect.fail(migrationInvalid(input.target.family));
    }
    const envelopePath = migrationEnvelopePath(input.root, location);
    const sourceBeforeValidation = yield* input.fileSystem.readFile({
      file: envelopePath,
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
    });
    if (sourceBeforeValidation === undefined || !bytesEqual(sourceBeforeValidation, input.expectedEnvelopeBytes)) {
      return yield* Effect.fail(migrationPlanStale());
    }
    const payloadPath = recordPortablePath(
      input.root,
      ...migrationAttachmentDirectory(input.root, location).segments,
      "payload.json",
    );
    const payloadBeforeValidation = yield* input.fileSystem.readFile({
      file: payloadPath,
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
    });
    if (payloadBeforeValidation === undefined || !bytesEqual(payloadBeforeValidation, input.expectedPayloadBytes)) {
      return yield* Effect.fail(migrationPlanStale());
    }
    const validated = yield* validateFixedRecordAttachmentMigrationSource({
      fileSystem: input.fileSystem,
      root: input.root,
      location: migrationReaderLocation(location),
      descriptor,
      fromSchemaVersion: input.target.fromSchemaVersion,
      decodeHistorical: historical.decode,
      ...(historical.verify === undefined ? {} : { verifyHistorical: historical.verify }),
      migrate: step.migrate,
    });
    if (validated === false) {
      const sourceAfterInvalid = yield* input.fileSystem.readFile({
        file: envelopePath,
        maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
      });
      if (sourceAfterInvalid === undefined || !bytesEqual(sourceAfterInvalid, input.expectedEnvelopeBytes)) {
        return yield* Effect.fail(migrationPlanStale());
      }
      return yield* Effect.fail(migrationInvalid(input.target.family));
    }
    const envelope = encodeFixedRecordAttachmentEnvelope({
      family: descriptor.family,
      schemaVersion: input.target.toSchemaVersion,
    });
    if (Either.isLeft(envelope)) return yield* Effect.fail(migrationInvalid(input.target.family));
    const sourceBeforeWrite = yield* input.fileSystem.readFile({
      file: envelopePath,
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
    });
    if (sourceBeforeWrite === undefined || !bytesEqual(sourceBeforeWrite, input.expectedEnvelopeBytes)) {
      return yield* Effect.fail(migrationPlanStale());
    }
    if (validated.rewritePayload !== input.rewritePayload) {
      return yield* Effect.fail(migrationInvalid(input.target.family));
    }
    if (
      validated.removedBlobs.length !== input.expectedRemovedBlobs.length ||
      validated.removedBlobs.some((blob, index) => {
        const expected = input.expectedRemovedBlobs[index];
        return expected === undefined || blob.key !== expected.key || !bytesEqual(blob.bytes, expected.bytes);
      })
    ) {
      return yield* Effect.fail(migrationPlanStale());
    }
    if (input.rewritePayload) {
      const encodedPayload = descriptor.write.encodePayload(validated.payload);
      if (Either.isLeft(encodedPayload)) return yield* Effect.fail(migrationInvalid(input.target.family));
      const durablePayload = encodeAttachmentPayloadForStorage({
        payload: encodedPayload.right,
        blobKeys: validated.blobKeys,
      });
      if (Either.isLeft(durablePayload)) return yield* Effect.fail(migrationInvalid(input.target.family));
      input.markPortableWrite();
      yield* input.fileSystem.writeFile({
        file: payloadPath,
        bytes: jsonBytes(durablePayload.right),
        maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
        mode: "replace-no-follow",
      });
    }
    for (const blob of input.expectedRemovedBlobs) {
      const blobPath = recordPortablePath(
        input.root,
        ...migrationAttachmentDirectory(input.root, location).segments,
        "blobs",
        blob.key,
      );
      const beforeDelete = yield* input.fileSystem.readFile({
        file: blobPath,
        maximumBytes: descriptor.write.budget.maximumBlobBytes,
      });
      if (beforeDelete === undefined || !bytesEqual(beforeDelete, blob.bytes)) {
        return yield* Effect.fail(migrationPlanStale());
      }
      input.markPortableWrite();
      yield* input.fileSystem.removeFile(recordPortablePath(
        input.root,
        ...migrationAttachmentDirectory(input.root, location).segments,
        "blobs",
        blob.key,
      ));
    }
    if (input.expectedRemovedBlobs.length > 0) {
      const blobsDirectory = recordPortablePath(
        input.root,
        ...migrationAttachmentDirectory(input.root, location).segments,
        "blobs",
      );
      const kind = yield* input.fileSystem.pathKind(blobsDirectory);
      if (kind !== "directory") {
        return yield* Effect.fail(migrationInvalid(input.target.family));
      }
      const remaining = yield* input.fileSystem.listDirectory({
        directory: blobsDirectory,
        maximumEntries: descriptor.write.budget.maximumBlobs,
      });
      if (remaining.length === 0) {
        input.markPortableWrite();
        yield* input.fileSystem.removeEmptyDirectory(blobsDirectory);
      }
    }
    input.markPortableWrite();
    yield* input.fileSystem.writeFile({
      file: envelopePath,
      bytes: jsonBytes(envelope.right),
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
      mode: "replace-no-follow",
    });
  });
}

function migrationManifestAttachmentKey(
  owner: "run" | AttemptId,
  family: string,
): string {
  return `${owner}\u0000${family}`;
}

function migrationManifestOwner(location: KnownMigrationAttachment): "run" | AttemptId {
  return location.owner === "run" ? "run" : location.attemptId!;
}

function migrationManifestBase(location: KnownMigrationAttachment): string {
  return location.owner === "run"
    ? `attachments/${location.descriptor.family}`
    : `attempts/${location.attemptId!}/attachments/${location.descriptor.family}`;
}

function rewriteMigratedSealManifest(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly planned: PlannedMigrationManifest;
  readonly attachments: readonly PlannedMigrationSource[];
  readonly markPortableWrite: () => void;
}): Effect.Effect<void, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const manifestPath = runPath(input.root, input.planned.runId, "seal-manifest.json");
    const currentBytes = yield* input.fileSystem.readFile({
      file: manifestPath,
      maximumBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
    });
    if (currentBytes === undefined || !bytesEqual(currentBytes, input.planned.bytes)) {
      return yield* Effect.fail(migrationPlanStale());
    }

    const attachments = new Map(input.attachments.map((attachment) => [
      migrationManifestAttachmentKey(
        migrationManifestOwner(attachment.location),
        attachment.location.descriptor.family,
      ),
      attachment,
    ] as const));
    const observedEnvelope = new Set<string>();
    const observedPayload = new Set<string>();
    const entries: SealManifestEntry[] = [];

    for (const entry of input.planned.document.entries) {
      if (entry.family === null) {
        entries.push(entry);
        continue;
      }
      const key = migrationManifestAttachmentKey(entry.owner, entry.family);
      const attachment = attachments.get(key);
      if (attachment === undefined) {
        entries.push(entry);
        continue;
      }
      const base = migrationManifestBase(attachment.location);
      if (
        entry.kind === "blob" &&
        attachment.removedBlobs.some((blob) => entry.path === `${base}/blobs/${blob.key}`)
      ) continue;
      if (entry.kind !== "attachment-envelope" && entry.kind !== "payload") {
        entries.push(entry);
        continue;
      }
      const bytes = yield* input.fileSystem.readFile({
        file: runPath(input.root, input.planned.runId, ...entry.path.split("/")),
        maximumBytes: maximumManifestEntryBytes(entry),
      });
      if (bytes === undefined) return yield* Effect.fail(migrationInvalid(entry.family));
      if (entry.kind === "attachment-envelope") observedEnvelope.add(key);
      else observedPayload.add(key);
      entries.push(Object.freeze({
        ...entry,
        byteLength: bytes.byteLength,
        sha256: sha256Bytes(bytes),
      }));
    }

    for (const key of attachments.keys()) {
      if (!observedEnvelope.has(key) || !observedPayload.has(key)) {
        return yield* Effect.fail(migrationInvalid("niceeval.core"));
      }
    }
    const candidate = Object.freeze({
      ...input.planned.document,
      entries: Object.freeze(entries),
    });
    const validated = decodeSealManifestPublicationDocument(candidate);
    if (Either.isLeft(validated)) return yield* Effect.fail(migrationInvalid("niceeval.core"));
    input.markPortableWrite();
    yield* input.fileSystem.writeFile({
      file: manifestPath,
      bytes: jsonBytes(validated.right),
      maximumBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
      mode: "replace-no-follow",
    });
  });
}

function validateCurrentKnownAttachments(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
}): Effect.Effect<void, RecordMaintenanceError> {
  return Effect.gen(function* () {
    for (const location of yield* knownMigrationAttachments(input.fileSystem, input.root)) {
      const read = yield* readKnownMigrationAttachment(input.fileSystem, input.root, location);
      if (read.state === "unsupported") {
        return yield* Effect.fail(new RecordFormatUnsupported({
          code: "record-format-unsupported",
          format: `${read.family}@${read.schemaVersion}`,
        }));
      }
      if (sourceFamily(location.descriptor.family)) {
        // Damage inside a recognized current source remains source-local. A
        // future envelope is still a format support failure above.
        if (read.state === "migration-required") {
          return yield* Effect.fail(migrationInvalid(location.descriptor.family));
        }
        continue;
      }
      if (read.state !== "available") {
        return yield* Effect.fail(migrationInvalid(location.descriptor.family));
      }
      const joined = yield* validateFixedCrossFamilyJoin({
        fileSystem: input.fileSystem,
        root: input.root,
        runId: location.runId,
        ...(location.attemptId === undefined ? {} : { attemptId: location.attemptId }),
        descriptor: location.descriptor,
        payload: read.value,
      });
      if (joined.state !== "joined") {
        return yield* Effect.fail(migrationInvalid(location.descriptor.family));
      }
    }
  });
}

function migrationRecoveryIsSafe(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly git: RecordGitService;
  readonly root: RecordRoot;
  readonly restoreCommit: string;
  readonly expectedRelativePaths: readonly string[];
}): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const expectedPaths = [
      recordPortablePath(input.root, "migration.in-progress"),
      ...input.expectedRelativePaths.map((relative) => recordPortablePath(input.root, ...relative.split("/"))),
    ];
    return yield* input.git.recoveryChangesAreExpected({
      root: input.root,
      restoreCommit: input.restoreCommit,
      expectedPaths,
    });
  }).pipe(Effect.catchAll(() => Effect.succeed(false)));
}

function openMaintenance(input: {
  readonly root: RecordRoot;
}): Effect.Effect<
  RecordMaintenanceSession,
  RecordMaintenanceOpenError,
  import("effect").Scope.Scope | RecordFileSystem | RecordGit | RecordCoordination
> {
  return Effect.gen(function* () {
    const coordination = yield* RecordCoordination;
    const fileSystem = yield* RecordFileSystem;
    const git = yield* RecordGit;
    yield* coordination.enterRecordMaintenance(input.root);
    if (yield* fileSystem.migrationSentinelPresent(input.root)) {
      const sentinel = yield* fileSystem.readMigrationSentinel(input.root);
      const restoreSafe = sentinel === undefined
        ? false
        : yield* migrationRecoveryIsSafe({
            fileSystem,
            git,
            root: input.root,
            restoreCommit: sentinel.restoreCommit,
            expectedRelativePaths: sentinel.expectedRelativePaths,
          });
      return yield* Effect.fail(migrationInterrupted(sentinel?.restoreCommit, restoreSafe));
    }
    const pendingPublishRecovery = yield* fileSystem.listRunPublishRecoveries({
      root: input.root,
      maximumEntries: MAXIMUM_PUBLISH_RECOVERIES,
      maximumManifestBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
    });
    if (pendingPublishRecovery.length > 0) {
      const current = yield* readRecordFormatForMaintenance(fileSystem, input.root);
      yield* coordination.verifyRecordIdentity({
        root: input.root,
        recordId: current.document.recordId,
      });
      yield* recoverRunPublications({
        fileSystem,
        root: input.root,
        record: current.document,
      });
    }
    const inspect = () => currentFormatInspection(fileSystem, input.root);
    const planMigrate = () => Effect.gen(function* () {
      const format = yield* readRecordFormatForMaintenance(fileSystem, input.root);
      yield* coordination.verifyRecordIdentity({ root: input.root, recordId: format.document.recordId });
      return yield* migrationPlan({ fileSystem, root: input.root, git });
    });
    return Object.freeze({
      inspect,
      planMigrate,
      applyMigrate: (plan: RecordMigrationPlan): Effect.Effect<RecordMigrationReceipt, RecordMaintenanceError> =>
        Effect.gen(function* () {
          const currentPlan = yield* planMigrate();
          if (!sameMigrationPlan(plan, currentPlan)) {
            return yield* Effect.fail(migrationPlanStale());
          }
          if (currentPlan.state === "already-current") {
            return Object.freeze({ state: "already-current" as const, format: RECORD_FORMAT });
          }
          if (currentPlan.state === "unsupported-format") {
            return yield* Effect.fail(new RecordFormatUnsupported({
              code: "record-format-unsupported",
              format: currentPlan.format,
            }));
          }
          if (currentPlan.backup.state !== "git-restore-point") {
            return yield* Effect.fail(new RecordMigrationGitRestoreRequired({
              code: "record-migration-git-restore-required",
            }));
          }
          const restoreCommit = currentPlan.backup.commit;
          const plannedSources = migrationPlanSources.get(currentPlan);
          if (
            plannedSources === undefined ||
            plannedSources.implementationIdentity !== RECORD_MIGRATION_IMPLEMENTATION_ID ||
            plannedSources.attachments.length !== currentPlan.attachments.length
          ) {
            return yield* Effect.fail(migrationInvalid("niceeval.core"));
          }
          let portableTargetWritten = false;
          const expectedRelativePaths = Object.freeze([
            ...plannedSources.attachments.flatMap((source) => {
              const base = migrationAttachmentDirectory(input.root, source.location).segments.join("/");
              return source.rewritePayload
                ? [
                    `${base}/attachment.json`,
                    `${base}/payload.json`,
                    ...source.removedBlobs.map((blob) => `${base}/blobs/${blob.key}`),
                  ]
                : [`${base}/attachment.json`];
            }),
            ...plannedSources.manifests.map((manifest) =>
              `runs/${manifest.runId}/seal-manifest.json`
            ),
          ]);

          const rootBeforeSentinel = yield* fileSystem.readFile({
            file: recordPortablePath(input.root, "record.json"),
            maximumBytes: RECORD_FORMAT_DOCUMENT_MAXIMUM_BYTES,
          });
          if (
            rootBeforeSentinel === undefined ||
            !bytesEqual(rootBeforeSentinel, plannedSources.rootIdentityBytes)
          ) return yield* Effect.fail(migrationPlanStale());
          for (const manifest of plannedSources.manifests) {
            const currentManifest = yield* fileSystem.readFile({
              file: runPath(input.root, manifest.runId, "seal-manifest.json"),
              maximumBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
            });
            if (currentManifest === undefined || !bytesEqual(currentManifest, manifest.bytes)) {
              return yield* Effect.fail(migrationPlanStale());
            }
          }

          // The sentinel is the first portable write. Any later failure or
          // interruption intentionally leaves it behind for Git recovery.
          yield* fileSystem.createMigrationSentinel(input.root, restoreCommit, expectedRelativePaths);
          const sentinelOnly = yield* git.recoveryChangesAreExpected({
            root: input.root,
            restoreCommit,
            expectedPaths: [recordPortablePath(input.root, "migration.in-progress")],
          });
          if (!sentinelOnly) {
            yield* fileSystem.removeMigrationSentinel(input.root);
            return yield* Effect.fail(migrationPlanStale());
          }
          yield* Effect.gen(function* () {
            for (const source of plannedSources.attachments) {
              yield* migrateKnownAttachment({
                fileSystem,
                root: input.root,
                location: source.location,
                target: source.target,
                expectedEnvelopeBytes: source.envelopeBytes,
                expectedPayloadBytes: source.payloadBytes,
                expectedRemovedBlobs: source.removedBlobs,
                rewritePayload: source.rewritePayload,
                markPortableWrite: () => { portableTargetWritten = true; },
              });
            }
            for (const manifest of plannedSources.manifests) {
              yield* rewriteMigratedSealManifest({
                fileSystem,
                root: input.root,
                planned: manifest,
                attachments: plannedSources.attachments.filter((source) =>
                  source.location.runId === manifest.runId
                ),
                markPortableWrite: () => { portableTargetWritten = true; },
              });
            }
            const current = yield* readCurrentRecordFormat(fileSystem, input.root);
            yield* validateSealedCoreForMigration(fileSystem, input.root, current.document);
            yield* validateCurrentKnownAttachments({ fileSystem, root: input.root });
            yield* fileSystem.removeMigrationSentinel(input.root);
          }).pipe(Effect.catchAll((error) => {
            const recoveryRequired = () => Effect.flatMap(
              migrationRecoveryIsSafe({
                fileSystem,
                git,
                root: input.root,
                restoreCommit,
                expectedRelativePaths,
              }),
              (restoreSafe) => Effect.fail(new RecordMigrationRecoveryRequired({
                code: "record-migration-recovery-required",
                causeCode: migrationFailureCode(error),
                restoreCommit,
                restoreSafe,
              })),
            );
            if (error instanceof RecordMigrationPlanStale && !portableTargetWritten) {
              return fileSystem.removeMigrationSentinel(input.root).pipe(
                Effect.matchEffect({
                  onFailure: () => recoveryRequired(),
                  onSuccess: () => Effect.fail(error),
                }),
              );
            }
            return recoveryRequired();
          }));
          return Object.freeze({
            state: "migrated" as const,
            format: RECORD_FORMAT,
            attachments: currentPlan.attachments,
          });
        }),
    });
  });
}

/**
 * The ordinary-entry migration transaction deliberately closes the read
 * Scope before asking Coordination for maintenance. Returning from here also
 * closes maintenance, so the caller's next open is necessarily fresh.
 */
function ensureAutomaticMigration(input: {
  readonly root: RecordRoot;
}) {
  return Effect.gen(function* () {
    const fileSystem = yield* RecordFileSystem;
    if ((yield* fileSystem.pathKind(recordPortablePath(input.root, "record.json"))) === "missing") {
      return Object.freeze({ state: "record-missing" as const });
    }

    const checked = yield* Effect.either(Effect.scoped(openCurrentRead(input)));
    if (Either.isRight(checked)) {
      return Object.freeze({ state: "already-current" as const });
    }
    if (!(checked.left instanceof RecordMigrationRequired)) {
      return yield* Effect.fail(checked.left);
    }

    return yield* Effect.scoped(Effect.gen(function* () {
      const session = yield* openMaintenance(input);
      const plan = yield* session.planMigrate();
      if (plan.state !== "migration-required") {
        return yield* Effect.fail(checked.left);
      }
      if (plan.backup.state !== "git-restore-point") {
        return yield* Effect.fail(new RecordAutoMigrationGitSaveRequired({
          code: "record-auto-migration-git-save-required",
        }));
      }
      const receipt = yield* session.applyMigrate(plan).pipe(
        Effect.catchTag("RecordMigrationGitRestoreRequired", () =>
          Effect.fail(new RecordAutoMigrationGitSaveRequired({
            code: "record-auto-migration-git-save-required",
          }))),
      );
      return Object.freeze({
        state: "migrated" as const,
        restoreCommit: plan.backup.commit,
        attachments: Object.freeze(
          receipt.state === "migrated" ? [...receipt.attachments] : [],
        ),
      }) satisfies RecordAutomaticMigrationResult;
    }));
  });
}

interface CodedRecordMaintenanceFailure {
  readonly code: string;
}

function closeMaintenanceFailure(
  error: CodedRecordMaintenanceFailure,
): RecordMaintenanceOperationFailure {
  if (error instanceof RecordMaintenanceBusy) {
    return Object.freeze({
      _tag: "RecordMaintenanceBusy" as const,
      code: "record-maintenance-busy" as const,
    });
  }
  if (error instanceof RecordMigrationInterruptedState) {
    return Object.freeze({
      _tag: "RecordMigrationInterrupted" as const,
      code: "record-migration-interrupted" as const,
      ...(error.restoreCommit === undefined ? {} : { restoreCommit: error.restoreCommit }),
      ...(error.restoreSafe === undefined ? {} : { restoreSafe: error.restoreSafe }),
    });
  }
  if (error instanceof RecordMigrationPlanStale) {
    return Object.freeze({
      _tag: "RecordMigrationPlanStale" as const,
      code: "record-migration-plan-stale" as const,
    });
  }
  if (error instanceof RecordMigrationGitRestoreRequired) {
    return Object.freeze({
      _tag: "RecordMigrationGitRestoreRequired" as const,
      code: "record-migration-git-restore-required" as const,
    });
  }
  if (error instanceof RecordMigrationInvalid) {
    return Object.freeze({
      _tag: "RecordMigrationInvalid" as const,
      code: "record-migration-invalid" as const,
    });
  }
  if (error instanceof RecordMigrationRecoveryRequired) {
    return Object.freeze({
      _tag: "RecordMigrationRecoveryRequired" as const,
      code: "record-migration-recovery-required" as const,
      causeCode: error.causeCode,
      restoreCommit: error.restoreCommit,
      restoreSafe: error.restoreSafe,
    });
  }
  if (error instanceof RecordFormatUnsupported) {
    return Object.freeze({
      _tag: "RecordFormatUnsupported" as const,
      code: "record-format-unsupported" as const,
    });
  }
  if (error instanceof RecordMigrationRequired) {
    return Object.freeze({
      _tag: "RecordMigrationRequired" as const,
      code: "record-migration-required" as const,
    });
  }
  return Object.freeze({
    _tag: "RecordMaintenanceOperationFailed" as const,
    code: error.code,
  });
}

const migrateOperationPlans = new WeakMap<RecordMigrateReadyPlan, RecordMigrationPlan>();

function planCleanOperation(input: { readonly root: RecordRoot }) {
  return inspectIncompleteRuns(input).pipe(
    Effect.map((incomplete): RecordCleanOperationPlan => incomplete.length === 0
      ? Object.freeze({ _tag: "RecordCleanAlreadyClean" as const })
      : Object.freeze({
          _tag: "RecordCleanConfirmationRequired" as const,
          runIds: Object.freeze(incomplete.map(({ runId }) => runId)),
        })),
    Effect.mapError(closeMaintenanceFailure),
  );
}

function applyCleanOperation(input: {
  readonly root: RecordRoot;
  readonly plan: Extract<RecordCleanOperationPlan, { readonly _tag: "RecordCleanConfirmationRequired" }>;
}) {
  return cleanIncompleteRuns({ root: input.root, runIds: input.plan.runIds }).pipe(
    Effect.map((receipt) => Object.freeze({
      _tag: "RecordCleanApplied" as const,
      deleted: Object.freeze([...receipt.deleted]),
      skipped: Object.freeze([...receipt.skipped]),
    })),
    Effect.mapError(closeMaintenanceFailure),
  );
}

function planMigrateOperation(input: { readonly root: RecordRoot }) {
  return Effect.scoped(Effect.gen(function* () {
    const session = yield* openMaintenance(input);
    const plan = yield* session.planMigrate();
    if (plan.state === "already-current") {
      return Object.freeze({
        _tag: "RecordMigrationAlreadyCurrent" as const,
        format: plan.format,
      }) satisfies RecordMigrateOperationPlan;
    }
    if (plan.state === "unsupported-format") {
      return Object.freeze({
        _tag: "RecordMigrationUnsupported" as const,
        format: plan.format,
      }) satisfies RecordMigrateOperationPlan;
    }
    if (plan.backup.state !== "git-restore-point") {
      return Object.freeze({
        _tag: "RecordMigrationRestoreRequired" as const,
        format: plan.format,
        backup: plan.backup,
        attachments: plan.attachments,
      }) satisfies RecordMigrateOperationPlan;
    }
    const closed = Object.freeze({
      _tag: "RecordMigrationReady" as const,
      format: plan.format,
      restoreCommit: plan.backup.commit,
      attachments: plan.attachments,
    });
    migrateOperationPlans.set(closed, plan);
    return closed satisfies RecordMigrateOperationPlan;
  })).pipe(
    Effect.catchTag("RecordFormatUnsupported", (error) => Effect.succeed(Object.freeze({
      _tag: "RecordMigrationUnsupported" as const,
      format: error.format,
    }) satisfies RecordMigrateOperationPlan)),
    Effect.mapError(closeMaintenanceFailure),
  );
}

function applyMigrateOperation(input: {
  readonly root: RecordRoot;
  readonly plan: RecordMigrateReadyPlan;
}) {
  const sourcePlan = migrateOperationPlans.get(input.plan);
  if (sourcePlan === undefined) {
    return Effect.fail(Object.freeze({
      _tag: "RecordMigrationPlanStale" as const,
      code: "record-migration-plan-stale" as const,
    }));
  }
  return Effect.scoped(Effect.gen(function* () {
    const session = yield* openMaintenance({ root: input.root });
    const receipt = yield* session.applyMigrate(sourcePlan);
    return receipt.state === "already-current"
      ? Object.freeze({
          _tag: "RecordMigrationAlreadyCurrent" as const,
          format: receipt.format,
        })
      : Object.freeze({
          _tag: "RecordMigrationApplied" as const,
          format: receipt.format,
          attachments: receipt.attachments,
        });
  })).pipe(Effect.mapError(closeMaintenanceFailure));
}

export const recordHost: RecordHostSDK = Object.freeze({
  ensureAutomaticMigration,
  current: Object.freeze({
    openRead: openCurrentRead,
    createRun: openNewRun,
    createReferenceRun: openNewReferenceRun,
  }),
  maintenance: Object.freeze({
    planClean: planCleanOperation,
    applyClean: applyCleanOperation,
    planMigrate: planMigrateOperation,
    applyMigrate: applyMigrateOperation,
    open: openMaintenance,
  }),
});
