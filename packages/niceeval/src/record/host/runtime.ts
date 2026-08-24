import { createHash } from "node:crypto";
import { Deferred, Effect, Either, Exit, Schema, Stream } from "effect";
import { RecordCoordination } from "../../coordination/record-leases.ts";
import {
  isRecordAttachmentDefinition,
  makeRecordAttachmentCatalog,
  type RecordAttachmentCatalog,
  type RecordAttachmentDefinition,
  type RecordAttachmentPersistence,
} from "../attachment/index.ts";
import type { AnyRecordAttachmentPersistence } from "../attachment/catalog.ts";
import {
  hydrateRecordMigrationValue,
  makeRecordMigrationContent,
  mintRecordAttachmentReference,
  recordAttachmentMigrationAt,
  recordMigrationDocumentFromResult,
  runRecordMigration,
  RecordAttachmentReference,
  RecordMigrationContent,
  unwrapRecordMigrationTargetContent,
  type RecordMigrationDocument,
  type RecordMigrationImpact,
} from "../attachment/protocol.ts";
import {
  recordAttachmentClosureInvalid,
  recordAttachmentIssue,
  type RecordAttachmentPayloadInvalid,
} from "../attachment/errors.ts";
import {
  AttemptIdSchema,
  CanonicalRunRelativePathSchema,
  RecordBlobKeySchema,
  RecordFormatSchema,
  RecordIdSchema,
  RunIdSchema,
  Sha256DigestSchema,
  SlotIdSchema,
  decodeRecordPublishRecoveryDocument,
  decodeRecordAttachmentEnvelope,
  decodeSealManifestPublicationDocument,
  decodeSealManifestDocument,
  decodeLegacySealManifestDocument,
  decodeAttemptDocument,
  decodeMemberDocument,
  decodeRunDocument,
  encodeAttemptDocument,
  encodeMemberDocument,
  encodeRecordDocument,
  encodeRecordAttachmentEnvelope,
  encodeRecordPublishRecoveryDocument,
  encodeRecordCore,
  encodeRunDocument,
  encodeSealManifestDocument,
  recordPublishRecoveryMatches,
  RecordExactParseOptions,
} from "../codec/index.ts";
import type { SealManifestPublicationDocument } from "../codec/seal-manifest.ts";
import {
  decodeLegacyRecordAttachmentHeader,
  encodeDurableRecordAttachmentEnvelope,
} from "../codec/attachment.ts";
import {
  RecordCoreInvalid,
  RecordReferenceInvalid,
  nonEmptyRecordIssues,
  recordIssue,
  type RecordCodecError,
  type NonEmptyRecordIssues,
} from "../errors/record-errors.ts";
import { NiceEvalRecordAttachmentPersistences } from "../family/catalog.ts";
import {
  recordDefinitionAttachment,
  recordContributionFromAttachmentPersistence,
  recordContributionRuntime,
  recordWriteCommandPayload,
  type AnyRecordDefinition,
  type RecordContribution,
  type RecordDefinitionValue,
  type RecordWriteCommand,
} from "../authoring.ts";
import type {
  AttemptDocument,
  MemberDocument,
  RecordAttachmentOwner,
  RecordAttachmentEnvelope,
  RecordAttemptRef,
  RecordDocument,
  RecordCore,
  RecordSlotIdentity,
  RunCore,
  RunDocument,
} from "../model/core.ts";
import type { DurableRecordAttachmentEnvelope } from "../model/attachment.ts";
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
} from "../model/identifiers.ts";
import {
  PUBLISH_RECOVERY_FORMAT,
  SEAL_MANIFEST_FORMAT,
  type RecordPublishRecoveryDocument,
  type SealManifestDocument,
  type SealManifestEntry,
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
  RecordResourceLimitExceeded,
  type RecordFileSystemError,
} from "../platform/errors.ts";
import { recordRootPaths, type RecordRoot } from "../platform/root.ts";
import {
  RecordEntropy,
  RecordFileSystem,
  recordPortablePath,
  recordStagingPath,
  type RecordDirectoryEntry,
  type RecordEntropyService,
  type RecordFileSystemService,
  type RecordPortablePath,
  type RecordRunStaging,
  type RecordStagingPath,
} from "../platform/services.ts";
import {
  RecordBootstrapInvalid,
  RecordFormatUnsupported,
  RecordHandleInvalid,
  FamilyDefinitionRequired,
  RecordMigrationInvalid,
  RecordMigrationRequired,
  RecordMigrationPlanStale,
  RecordReaderClosed,
  RecordSealIncomplete,
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
  inspectRecordAttachmentEnvelope,
  readCurrentRecordAttachment,
  readVerifiedRecordAttachmentPhysical,
} from "../reader/runtime.ts";
import {
  recordAlreadyWritten,
  recordAttachmentEncodeError,
  recordDraftStateError,
  recordOwnerDefinitionMismatch,
  recordWriterClosed,
  type RecordDraftLifecycleState,
} from "../writer/errors.ts";
import {
  prepareCurrentRecordAttachment,
  RECORD_ATTACHMENT_MAXIMUM_CONTENTS,
  RECORD_ATTACHMENT_MAXIMUM_TOTAL_CONTENT_BYTES,
  type AttachedContentError,
  type AttachedContentRequirements,
  type PreparedCurrentAttachment,
  type RecordAttachmentSessionBuilder,
} from "../writer/current-attachment.ts";
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
  type CreateReferenceRunRequest,
  type CreateRunRequest,
  type RecordAttachmentRead,
  type RecordCompleteView,
  type ReadableAttempt,
  type ReadableRun,
  type RecordFormatInspection,
  type RecordHostSDK,
  type RecordCleanOperationPlan,
  type RecordMaintenanceOperationFailure,
  type RecordAttachmentMigrationTarget,
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
  type RunWriteSession,
  type SelectedAttemptRef,
  type SelectedOwnerRef,
  type SelectedRunRef,
} from "./types.ts";

type AnyDefinition<Owner extends RecordAttachmentOwner = RecordAttachmentOwner> =
  RecordAttachmentDefinition<Owner, string, Schema.Schema.AnyNoContext>;
type DefinitionValue<Definition extends AnyDefinition> = Schema.Schema.Type<Definition["schema"]>;
type RecordFamilyDescriptorCatalog = RecordAttachmentCatalog;

const MAXIMUM_RUN_ENTRIES = 100_000;
const MAXIMUM_ATTEMPT_ENTRIES = 100_000;
const MAXIMUM_CORE_BYTES = 1024 * 1024;
const ENTROPY_RETRY_LIMIT = 16;
const MAXIMUM_ATTACHMENT_BLOB_BYTES = 64 * 1024 * 1024;
const MAXIMUM_SEAL_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAXIMUM_PUBLISH_RECOVERIES = 100_000;
const MAXIMUM_STAGED_INVENTORY_ENTRIES = 400_000;
const MAXIMUM_REFERENCE_CLOSURE_NODES = 1_024;

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
  readonly attachmentCatalog: RecordFamilyDescriptorCatalog;
  readonly runs: WeakMap<SelectedRunRef, SelectedRunRuntime>;
  readonly attempts: WeakMap<SelectedAttemptRef, SelectedAttemptRuntime>;
  readonly owners: WeakMap<SelectedOwnerRef, SelectedOwnerRuntime>;
  readonly runsById: Map<RunId, SelectedRunRef>;
  readonly attemptsByKey: Map<string, SelectedAttemptRef>;
  readonly manifestsByRunId: Map<RunId, SealManifestPublicationDocument>;
  readonly selections: WeakSet<RecordSelection>;
  sealedCoreSnapshot: Deferred.Deferred<SealedCoreSnapshot, RecordFileSystemError> | undefined;
}

interface AttemptRuntime {
  readonly draft: RunRuntime;
  readonly attemptId: AttemptId;
  readonly slotId: SlotId;
  readonly settled: Deferred.Deferred<void>;
  state: "open" | "completing" | "completed" | "failed";
  document: AttemptDocument | undefined;
  readonly attachments: Map<string, FixedAttachmentRuntime>;
  readonly reservedFamilies: Set<string>;
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
  readonly attachmentCatalog: RecordFamilyDescriptorCatalog;
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
  readonly reservedFamilies: Set<string>;
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
  readonly persistence: AnyRecordAttachmentPersistence;
  readonly prepared: PreparedCurrentAttachment;
  readonly physicalBlobCount: number;
  readonly attemptId: AttemptId | undefined;
}

const selectedAttemptCapabilities = new WeakMap<
  SelectedAttemptRef,
  SelectedAttemptRuntime
>();
const runSessions = new WeakMap<object, RunRuntime>();
const attemptSessions = new WeakMap<AttemptWriteSession, AttemptRuntime>();

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
  attachmentCatalog: RecordFamilyDescriptorCatalog,
): Effect.Effect<RecordFormatInspection, RecordMaintenanceError> {
  return buildMigrationPlan({ fileSystem, root, attachmentCatalog }).pipe(
    Effect.map((plan): RecordFormatInspection => plan.state === "already-current"
      ? Object.freeze({ state: "already-current" as const, format: RECORD_FORMAT })
      : plan.state === "migration-required"
      ? Object.freeze({ state: "migration-required" as const, format: RECORD_FORMAT })
      : Object.freeze({ state: "unsupported-format" as const, format: plan.format })),
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
    const kind = yield* fileSystem.pathKind(directory);
    if (kind === "missing") return Object.freeze([]);
    if (kind !== "directory") return undefined;
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

function maintenanceReaderRuntime(
  root: RecordRoot,
  record: RecordDocument,
  attachmentCatalog: RecordFamilyDescriptorCatalog,
): ReaderRuntime {
  return {
    root,
    record,
    lifecycle: { closed: false },
    attachmentCatalog,
    runs: new WeakMap(),
    attempts: new WeakMap(),
    owners: new WeakMap(),
    runsById: new Map(),
    attemptsByKey: new Map(),
    manifestsByRunId: new Map(),
    selections: new WeakSet(),
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
  contents: Extract<SelectedOwnerRuntime, { readonly kind: "run" }>,
): SelectedOwnerRef<"run">;
function makeOwner(
  runtime: ReaderRuntime,
  contents: Extract<SelectedOwnerRuntime, { readonly kind: "attempt" }>,
): SelectedOwnerRef<"attempt">;
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
    const selection = Object.freeze({
      runRefs: Object.freeze(refs),
      runFacts: Object.freeze(runFacts),
      expectedSlots: Object.freeze(expectedSlots),
      problems: Object.freeze(problems),
      warnings: Object.freeze(warnings),
    });
    runtime.selections.add(selection);
    return selection;
  });
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

function invalidAttachmentRead<Payload>(): RecordAttachmentRead<Payload> {
  return Object.freeze({ state: "invalid" as const, issues: coreInvalid().issues });
}

function familyDefinitionRequired(input: {
  readonly owner: RecordAttachmentOwner;
  readonly family: string;
  readonly revision?: number;
}): FamilyDefinitionRequired {
  return new FamilyDefinitionRequired({
    code: "family-definition-required",
    owner: input.owner,
    family: input.family,
    revision: input.revision ?? 0,
  });
}

function ownerClosureKey(owner: SelectedOwnerRuntime, family: string): string {
  return owner.kind === "run"
    ? `run\u0000${owner.runId}\u0000${family}`
    : `attempt\u0000${owner.ref.originRunId}\u0000${owner.ref.attemptId}\u0000${family}`;
}

function referencedOwner(
  owner: SelectedOwnerRuntime,
  required: RecordAttachmentOwner,
): SelectedOwnerRuntime | undefined {
  if (required === "run") {
    return owner.kind === "run"
      ? owner
      : Object.freeze({ kind: "run" as const, runId: owner.ref.originRunId });
  }
  return owner.kind === "attempt" ? owner : undefined;
}

function readCatalogAttachment<Definition extends AnyDefinition>(input: {
  readonly runtime: ReaderRuntime;
  readonly fileSystem: RecordFileSystemService;
  readonly owner: SelectedOwnerRuntime;
  readonly persistence: RecordAttachmentPersistence<Definition, number>;
  readonly visited: Set<string>;
}): Effect.Effect<RecordAttachmentRead<DefinitionValue<Definition>>, RecordReaderReadError> {
  return Effect.gen(function* () {
    const definition = input.persistence.attachment;
    const key = ownerClosureKey(input.owner, definition.family);
    if (input.visited.has(key)) {
      // A previously validated node closes a repeated/cyclic reference.
      return Object.freeze({ state: "not-recorded" as const });
    }
    if (input.visited.size >= MAXIMUM_REFERENCE_CLOSURE_NODES) {
      return invalidAttachmentRead<DefinitionValue<Definition>>();
    }
    input.visited.add(key);

    const gate = yield* validateAttachmentManifestGate({
      runtime: input.runtime,
      fileSystem: input.fileSystem,
      owner: input.owner,
      family: definition.family,
    });
    if (gate.state === "not-recorded") {
      return Object.freeze({ state: "not-recorded" as const });
    }
    if (gate.state === "invalid") return invalidAttachmentRead<DefinitionValue<Definition>>();

    const read = input.owner.kind === "run"
      ? yield* readCurrentRecordAttachment({
          fileSystem: input.fileSystem,
          root: input.runtime.root,
          location: Object.freeze({ owner: "run" as const, runId: input.owner.runId }),
          persistence: input.persistence as RecordAttachmentPersistence<AnyDefinition<"run">, number>,
          lifecycle: input.runtime.lifecycle,
          expectedManifestEntries: gate.entries,
        })
      : yield* readCurrentRecordAttachment({
          fileSystem: input.fileSystem,
          root: input.runtime.root,
          location: Object.freeze({
            owner: "attempt" as const,
            runId: input.owner.ref.originRunId,
            attemptId: input.owner.ref.attemptId,
          }),
          persistence: input.persistence as RecordAttachmentPersistence<AnyDefinition<"attempt">, number>,
          lifecycle: input.runtime.lifecycle,
          expectedManifestEntries: gate.entries,
        });
    if (read.state !== "available") {
      return read.state === "unavailable"
        ? invalidAttachmentRead<DefinitionValue<Definition>>()
        : read as RecordAttachmentRead<DefinitionValue<Definition>>;
    }

    for (const reference of read.references) {
      const dependency = input.runtime.attachmentCatalog.persistence(reference.definition);
      if (
        dependency === undefined ||
        dependency.attachment !== reference.definition ||
        input.runtime.attachmentCatalog.get(reference.owner, reference.family) !== dependency
      ) {
        return yield* Effect.fail(familyDefinitionRequired(reference));
      }
      const dependencyOwner = referencedOwner(input.owner, reference.owner);
      if (dependencyOwner === undefined) return invalidAttachmentRead<DefinitionValue<Definition>>();
      const dependencyKey = ownerClosureKey(dependencyOwner, dependency.attachment.family);
      if (input.visited.has(dependencyKey)) continue;
      const dependencyRead = yield* readCatalogAttachment({
        runtime: input.runtime,
        fileSystem: input.fileSystem,
        owner: dependencyOwner,
        persistence: dependency,
        visited: input.visited,
      });
      if (dependencyRead.state === "migration-required" || dependencyRead.state === "unsupported") {
        return dependencyRead as RecordAttachmentRead<DefinitionValue<Definition>>;
      }
      if (dependencyRead.state !== "available") return invalidAttachmentRead<DefinitionValue<Definition>>();
    }
    return read as RecordAttachmentRead<DefinitionValue<Definition>>;
  });
}

function readFixedFamily<Definition extends AnyDefinition>(input: {
  readonly runtime: ReaderRuntime;
  readonly fileSystem: RecordFileSystemService;
  readonly owner: SelectedOwnerRef;
  readonly persistence: RecordAttachmentPersistence<Definition, number>;
}): Effect.Effect<RecordAttachmentRead<DefinitionValue<Definition>>, RecordReaderReadError> {
  return Effect.suspend(() => {
    if (input.runtime.lifecycle.closed) return Effect.fail(readerClosed());
    const owner = input.runtime.owners.get(input.owner);
    if (owner === undefined || owner.kind !== input.persistence.attachment.owner) {
      return Effect.fail(handleInvalid());
    }
    return readCatalogAttachment({
      runtime: input.runtime,
      fileSystem: input.fileSystem,
      owner,
      persistence: input.persistence,
      visited: new Set(),
    });
  });
}

function readDescriptorForDefinition(input: {
  readonly runtime: ReaderRuntime;
  readonly owner: SelectedOwnerRuntime;
  readonly definition: unknown;
}): Effect.Effect<
  AnyRecordAttachmentPersistence,
  FamilyDefinitionRequired
> {
  if (!isRecordAttachmentDefinition(input.definition)) {
    return Effect.fail(familyDefinitionRequired({
      owner: input.owner.kind,
      family: "unbranded.record-attachment",
    }));
  }
  const definition = input.definition;
  if (definition.owner !== input.owner.kind) {
    return Effect.fail(familyDefinitionRequired({
      owner: input.owner.kind,
      family: definition.family,
      revision: 0,
    }));
  }
  const descriptor = input.runtime.attachmentCatalog.persistence(definition);
  if (
    descriptor === undefined ||
    descriptor.attachment !== definition ||
    input.runtime.attachmentCatalog.get(definition.owner, definition.family) !== descriptor
  ) {
    return Effect.fail(familyDefinitionRequired({
      owner: definition.owner,
      family: definition.family,
      revision: descriptor?.revision ?? 0,
    }));
  }
  return Effect.succeed(descriptor);
}

function sealIncomplete(
  reason: RecordSealIncomplete["reason"],
  family?: string,
): RecordSealIncomplete {
  return new RecordSealIncomplete({
    code: "record-seal-incomplete",
    reason,
    ...(family === undefined ? {} : { family }),
  });
}

function requireCompleteSelection(input: {
  readonly runtime: ReaderRuntime;
  readonly fileSystem: RecordFileSystemService;
  readonly selection: RecordSelection;
}): Effect.Effect<RecordCompleteView, import("../reader/errors.ts").RecordCompletenessError> {
  return Effect.gen(function* () {
    if (input.runtime.lifecycle.closed) return yield* Effect.fail(readerClosed());
    if (
      !input.runtime.selections.has(input.selection) ||
      input.selection.problems.length > 0
    ) return yield* Effect.fail(sealIncomplete("selection-invalid"));

    const snapshot = yield* readSealedCoreSnapshot(input.runtime, input.fileSystem);
    if (snapshot.state !== "available") {
      return yield* Effect.fail(sealIncomplete("selection-invalid"));
    }

    const scopes = new Map<RunId, {
      readonly owners: Set<"run" | AttemptId>;
      allOwners: boolean;
    }>();
    const scopeFor = (runId: RunId) => {
      const existing = scopes.get(runId);
      if (existing !== undefined) return existing;
      const created = { owners: new Set<"run" | AttemptId>(), allOwners: false };
      scopes.set(runId, created);
      return created;
    };
    for (const ref of input.selection.runRefs) {
      const selectedCore = snapshot.byRunId.get(ref.runId);
      if (!input.runtime.runs.has(ref) || selectedCore === undefined) {
        return yield* Effect.fail(sealIncomplete("selection-invalid"));
      }
      scopeFor(ref.runId).allOwners = true;
      for (const member of selectedCore.members) {
        const attempt = member.attempt;
        if (attempt === null || attempt.originRunId === ref.runId) continue;
        const origin = snapshot.byRunId.get(attempt.originRunId);
        if (
          origin === undefined ||
          !origin.attempts.some((document) => document.attemptId === attempt.attemptId)
        ) {
          return yield* Effect.fail(sealIncomplete("selection-invalid"));
        }
        const referenced = scopeFor(attempt.originRunId);
        referenced.owners.add("run");
        referenced.owners.add(attempt.attemptId);
      }
    }

    const orderedScopes = [...scopes.entries()]
      .sort(([left], [right]) => compareCanonicalIdentity(left, right));
    for (const [runId, scope] of orderedScopes) {
      const core = snapshot.byRunId.get(runId);
      if (core === undefined) return yield* Effect.fail(sealIncomplete("selection-invalid"));
      const publication = yield* readPublishedRunPublication(
        input.fileSystem,
        input.runtime.root,
        runId,
        true,
        true,
      );
      if (publication === undefined || publication.strictManifest === undefined) {
        return yield* Effect.fail(sealIncomplete("inventory-invalid"));
      }
      for (const entry of publication.manifest.entries) {
        if (entry.kind !== "attachment-envelope" || entry.family === null) continue;
        if (!scope.allOwners && !scope.owners.has(entry.owner)) continue;
        const ownerKind: RecordAttachmentOwner = entry.owner === "run" ? "run" : "attempt";
        if (
          ownerKind === "attempt" &&
          !core.attempts.some((attempt) => attempt.attemptId === entry.owner)
        ) {
          return yield* Effect.fail(sealIncomplete("inventory-invalid", entry.family));
        }
        const descriptor = input.runtime.attachmentCatalog.get(ownerKind, entry.family);
        if (descriptor === undefined) {
          return yield* Effect.fail(familyDefinitionRequired({
            owner: ownerKind,
            family: entry.family,
          }));
        }
        const owner: SelectedOwnerRuntime = entry.owner === "run"
          ? Object.freeze({ kind: "run" as const, runId })
          : Object.freeze({
              kind: "attempt" as const,
              ref: Object.freeze({ originRunId: runId, attemptId: entry.owner }),
            });
        const read = yield* readCatalogAttachment({
          runtime: input.runtime,
          fileSystem: input.fileSystem,
          owner,
          persistence: descriptor,
          visited: new Set(),
        });
        if (read.state === "migration-required") {
          return yield* Effect.fail(new RecordMigrationRequired({
            code: "record-migration-required",
            source: `${read.family}@${read.fromRevision}`,
            target: `${read.family}@${read.toRevision}`,
            command: read.command,
          }));
        }
        if (read.state === "unsupported") {
          return yield* Effect.fail(new RecordMigrationRequired({
            code: "record-migration-required",
            source: `${read.family}@${read.revision}`,
            target: `${descriptor.attachment.family}@${descriptor.revision}`,
            command: "niceeval migrate",
          }));
        }
        if (read.state !== "available") {
          return yield* Effect.fail(sealIncomplete(
            read.state === "invalid" ? "attachment-invalid" : "reference-closure-invalid",
            descriptor.attachment.family,
          ));
        }
      }
    }
    return Object.freeze({
      selection: input.selection,
      attachments: input.runtime.attachmentCatalog,
    });
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
    read<
      Owner extends RecordAttachmentOwner,
      Definition extends AnyDefinition<Owner> | AnyRecordDefinition<Owner>,
    >(
      owner: SelectedOwnerRef<Owner>,
      definition: Definition,
    ): Effect.Effect<
      RecordAttachmentRead<
        Definition extends AnyRecordDefinition<Owner>
          ? RecordDefinitionValue<Definition>
          : Definition extends AnyDefinition<Owner>
          ? DefinitionValue<Definition>
          : never
      >,
      RecordReaderReadError
    > {
      return Effect.gen(function* () {
        if (runtime.lifecycle.closed) return yield* Effect.fail(readerClosed());
        const ownerRuntime = runtime.owners.get(owner);
        if (ownerRuntime === undefined) return yield* Effect.fail(handleInvalid());
        const attachment = isRecordAttachmentDefinition(definition)
          ? definition
          : recordDefinitionAttachment(definition);
        const descriptor = yield* readDescriptorForDefinition({
          runtime,
          owner: ownerRuntime,
          definition: attachment,
        });
        return (yield* readFixedFamily({
          runtime,
          fileSystem,
          owner,
          persistence: descriptor,
        })) as RecordAttachmentRead<
          Definition extends AnyRecordDefinition<Owner>
            ? RecordDefinitionValue<Definition>
            : Definition extends AnyDefinition<Owner>
            ? DefinitionValue<Definition>
            : never
        >;
      });
    },
    requireComplete: (selection: RecordSelection) =>
      requireCompleteSelection({ runtime, fileSystem, selection }),
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
  catalog: RecordFamilyDescriptorCatalog,
  owner: RecordAttachmentOwner,
  family: string,
): AnyRecordAttachmentPersistence | undefined {
  return catalog.get(owner, family);
}

function validateRecoveredAttachmentClosures(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runId: RunId;
  readonly manifest: SealManifestDocument;
  readonly attachmentCatalog: RecordFamilyDescriptorCatalog;
}): Effect.Effect<boolean, RecordFileSystemError> {
  return Effect.gen(function* () {
    const envelopes = input.manifest.entries.filter((entry) => entry.kind === "attachment-envelope");
    for (const envelope of envelopes) {
      if (envelope.family === null) return false;
      const ownerKind: RecordAttachmentOwner = envelope.owner === "run" ? "run" : "attempt";
      const descriptor = descriptorForRecoveredAttachment(
        input.attachmentCatalog,
        ownerKind,
        envelope.family,
      );
      if (descriptor === undefined) return false;
      const lifecycle = { closed: false };
      const read = envelope.owner === "run"
        ? yield* readCurrentRecordAttachment({
            fileSystem: input.fileSystem,
            root: input.root,
            location: Object.freeze({ owner: "run" as const, runId: input.runId }),
            persistence: descriptor as RecordAttachmentPersistence<AnyDefinition<"run">, number>,
            lifecycle,
          })
        : yield* readCurrentRecordAttachment({
            fileSystem: input.fileSystem,
            root: input.root,
            location: Object.freeze({
              owner: "attempt" as const,
              runId: input.runId,
              attemptId: envelope.owner,
            }),
            persistence: descriptor as RecordAttachmentPersistence<AnyDefinition<"attempt">, number>,
            lifecycle,
          });
      if (read.state !== "available") return false;
      for (const reference of read.references) {
        if (input.attachmentCatalog.get(reference.owner, reference.family) === undefined) {
          return false;
        }
        const targetOwner = reference.owner === "run"
          ? "run"
          : envelope.owner === "run"
          ? undefined
          : envelope.owner;
        if (
          targetOwner === undefined ||
          !input.manifest.entries.some((entry) =>
            entry.kind === "attachment-envelope" &&
            entry.owner === targetOwner &&
            entry.family === reference.family
          )
        ) return false;
      }
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
  readonly attachmentCatalog: RecordFamilyDescriptorCatalog;
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
        maintenanceReaderRuntime(input.root, input.record, input.attachmentCatalog),
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
        attachmentCatalog: input.attachmentCatalog,
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
  readonly attachmentCatalog: RecordFamilyDescriptorCatalog;
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
        const sealed = yield* validateRecoveredPublication({
          fileSystem: input.fileSystem,
          root: input.root,
          record: input.record,
          runId: recovery.runId,
          staging,
          attachmentCatalog: input.attachmentCatalog,
        });
        if (
          sealed === undefined ||
          !recordPublishRecoveryMatches({
            recovery,
            recordId: input.record.recordId,
            sealManifest: sealed.strictManifest,
            sealManifestSha256: sealed.manifestSha256,
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
        attachmentCatalog: input.attachmentCatalog,
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
  readonly attachmentCatalog: RecordFamilyDescriptorCatalog;
}): Effect.Effect<
  RecordReadSession,
  RecordReaderOpenError,
  import("effect").Scope.Scope | RecordFileSystem | RecordCoordination
> {
  return Effect.gen(function* () {
    const coordination = yield* RecordCoordination;
    const fileSystem = yield* RecordFileSystem;
    yield* coordination.enterRecordRead(input.root);
    const current = yield* readCurrentRecordFormat(fileSystem, input.root);
    const lifecycle: ReaderLifecycle = { closed: false };
    const runtime: ReaderRuntime = {
      root: input.root,
      record: current.document,
      lifecycle,
      attachmentCatalog: input.attachmentCatalog,
      runs: new WeakMap(),
      attempts: new WeakMap(),
      owners: new WeakMap(),
      runsById: new Map(),
      attemptsByKey: new Map(),
      manifestsByRunId: new Map(),
      selections: new WeakSet(),
      sealedCoreSnapshot: undefined,
    };
    const snapshot = yield* readSealedCoreSnapshot(runtime, fileSystem);
    if (snapshot.state === "core-invalid") return yield* Effect.fail(bootstrapInvalid());
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

function concatByteChunks(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function collectAttachmentBlob<E, R>(input: {
  readonly stream: Stream.Stream<Uint8Array, E, R>;
  readonly maximumBytes: number;
  readonly family: string;
}): Effect.Effect<Uint8Array, E | RecordWriteError, R> {
  interface FoldState {
    chunks: Uint8Array[];
    byteLength: number;
  }
  const initial: FoldState = { chunks: [], byteLength: 0 };
  return input.stream.pipe(
    Stream.runFoldEffect(
      initial,
      (state, chunk): Effect.Effect<FoldState, RecordWriteError> => {
      if (!(chunk instanceof Uint8Array)) return Effect.fail(fixedFamilyWriteInvalid());
      const observedAtLeast = state.byteLength + chunk.byteLength;
      if (observedAtLeast > input.maximumBytes) {
        return Effect.fail(new RecordResourceLimitExceeded({
          code: "record-resource-limit-exceeded",
          resource: "file-bytes",
          maximum: input.maximumBytes,
          observedAtLeast,
          path: input.family,
        }));
      }
      state.chunks.push(chunk.slice());
      state.byteLength = observedAtLeast;
      return Effect.succeed(state);
      },
    ),
    Effect.map((state) => concatByteChunks(state.chunks, state.byteLength)),
  );
}

function beginAttachmentMutation(input: {
  readonly run: RunRuntime;
  readonly target: RunRuntime | AttemptRuntime;
  readonly owner: RecordAttachmentOwner;
  readonly family: string;
}): Effect.Effect<Deferred.Deferred<void>, RecordWriteError> {
  return input.run.mutex.withPermits(1)(
    Effect.gen(function* () {
      yield* assertRunLive(input.run);
      if (input.run.state !== "open") {
        return yield* Effect.fail(stateError("record", input.run.state));
      }
      if (input.target !== input.run && (input.target as AttemptRuntime).state !== "open") {
        return yield* Effect.fail(stateError("record", input.run.state));
      }
      if (input.target.reservedFamilies.has(input.family)) {
        input.run.state = "failed";
        consumeRunCapabilities(input.run);
        return yield* Effect.fail(recordAlreadyWritten({
          owner: input.owner,
          family: input.family,
        }));
      }
      input.target.reservedFamilies.add(input.family);
      const mutation = yield* Deferred.make<void>();
      input.run.inFlightMutations.add(mutation);
      return mutation;
    }),
  );
}

function writeCurrentAttachment<
  Owner extends RecordAttachmentOwner,
  Definition extends AnyDefinition<Owner>,
  Value extends DefinitionValue<Definition>,
>(input: {
  readonly run: RunRuntime;
  readonly target: RunRuntime | AttemptRuntime;
  readonly owner: Owner;
  readonly baseSegments: readonly string[];
  readonly persistence: RecordAttachmentPersistence<Definition, number>;
  readonly value: Value | ((build: RecordAttachmentSessionBuilder) => Value);
}): Effect.Effect<
  void,
  RecordWriteError | AttachedContentError<Value>,
  AttachedContentRequirements<Value>
> {
  return Effect.flatMap(
    beginAttachmentMutation({
      run: input.run,
      target: input.target,
      owner: input.owner,
      family: input.persistence.attachment.family,
    }),
    (mutation) =>
      Effect.gen(function* () {
        const prepared = yield* prepareCurrentRecordAttachment({
          definition: input.persistence.attachment,
          value: input.value,
          digest: sha256Bytes,
        });
        const payloadDigest = sha256Bytes(prepared.payloadBytes);
        const envelope: DurableRecordAttachmentEnvelope = Object.freeze({
          format: "niceeval.record-attachment",
          ownerKind: input.owner,
          family: input.persistence.attachment.family,
          revision: input.persistence.revision,
          payload: Object.freeze({ sha256: payloadDigest, byteLength: prepared.payloadBytes.byteLength }),
          contents: Object.freeze(prepared.contents.map(({ key, sha256, bytes }) =>
            Object.freeze({ key, sha256, byteLength: bytes.byteLength })
          )),
          references: prepared.references,
        });
        const encodedEnvelope = encodeDurableRecordAttachmentEnvelope(envelope);
        if (Either.isLeft(encodedEnvelope)) {
          return yield* Effect.fail(fixedFamilyWriteInvalid());
        }
        const physicalContents = new Map<Sha256Digest, Uint8Array>();
        for (const content of prepared.contents) physicalContents.set(content.sha256, content.bytes);
        const attachment: FixedAttachmentRuntime = Object.freeze({
          owner: input.owner,
          name: input.persistence.attachment.family,
          baseSegments: Object.freeze([...input.baseSegments]),
          persistence: input.persistence as AnyRecordAttachmentPersistence,
          prepared,
          physicalBlobCount: physicalContents.size,
          attemptId: input.target === input.run
            ? undefined
            : (input.target as AttemptRuntime).attemptId,
        });
        const attachmentRoot = [...input.baseSegments, input.persistence.attachment.family];
        yield* input.run.fileSystem.ensureStagingDirectory(
          stagedRunPath(input.run, ...input.baseSegments),
        );
        yield* input.run.fileSystem.createStagingDirectory(
          stagedRunPath(input.run, ...attachmentRoot),
        );
        yield* input.run.fileSystem.writeStagingFile({
          file: stagedRunPath(input.run, ...attachmentRoot, "payload", "sha256", payloadDigest),
          bytes: prepared.payloadBytes,
          maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
          mode: "exclusive",
        });
        yield* Effect.forEach(
          physicalContents,
          ([contentDigest, bytes]) =>
            input.run.fileSystem.writeStagingFile({
              file: stagedRunPath(input.run, ...attachmentRoot, "content", "sha256", contentDigest),
              bytes,
              maximumBytes: MAXIMUM_ATTACHMENT_BLOB_BYTES,
              mode: "exclusive",
            }),
          { discard: true },
        );
        // The envelope is the only commit record and is therefore written last.
        yield* input.run.fileSystem.writeStagingFile({
          file: stagedRunPath(input.run, ...attachmentRoot, "attachment.json"),
          bytes: jsonBytes(encodedEnvelope.right),
          maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
          mode: "exclusive",
        });
        yield* Effect.sync(() => {
          input.target.attachments.set(attachment.name, attachment);
        });
      }).pipe(Effect.onExit((exit) => finishRunMutation(input.run, mutation, exit))),
  ) as Effect.Effect<void, RecordWriteError | AttachedContentError<Value>, AttachedContentRequirements<Value>>;
}

function validateAndSyncFixedAttachment(
  run: RunRuntime,
  attachment: FixedAttachmentRuntime,
): Effect.Effect<void, RecordWriteError> {
  return Effect.gen(function* () {
    const rootSegments = [...attachment.baseSegments, attachment.name];
    for (const suffix of [
      ["payload", "sha256"],
      ["payload"],
      ["content", "sha256"],
      ["content"],
    ] as const) {
      const directory = stagedRunPath(run, ...rootSegments, ...suffix);
      if ((yield* run.fileSystem.stagingPathKind(directory)) === "directory") {
        yield* run.fileSystem.syncStagingDirectory(directory);
      }
    }
    yield* run.fileSystem.syncStagingDirectory(stagedRunPath(run, ...rootSegments));
    yield* run.fileSystem.syncStagingDirectory(stagedRunPath(run, ...attachment.baseSegments));
    const stagedFileSystem = stagingReadFileSystem({
      root: run.root,
      runId: run.runId,
      staging: run.staging,
      fileSystem: run.fileSystem,
    });
    const lifecycle = { closed: false };
    const materialized = yield* readCurrentRecordAttachment({
      fileSystem: stagedFileSystem,
      root: run.root,
      location: attachment.owner === "run"
        ? Object.freeze({ owner: "run" as const, runId: run.runId })
        : Object.freeze({
            owner: "attempt" as const,
            runId: run.runId,
            attemptId: attachment.attemptId!,
          }),
      persistence: attachment.persistence,
      lifecycle,
    });
    if (materialized.state !== "available") {
      return yield* Effect.fail(fixedFamilyWriteInvalid());
    }
    for (let index = 0; index < materialized.references.length; index += 1) {
      const reference = materialized.references[index]!;
      const referenceDefinition = attachment.prepared.referenceDefinitions[index];
      const exactPersistence = referenceDefinition === undefined
        ? undefined
        : run.attachmentCatalog.persistence(referenceDefinition);
      if (
        exactPersistence === undefined ||
        exactPersistence.attachment !== referenceDefinition ||
        exactPersistence.attachment.owner !== reference.owner ||
        exactPersistence.attachment.family !== reference.family ||
        run.attachmentCatalog.get(reference.owner, reference.family) !== exactPersistence
      ) {
        return yield* Effect.fail(familyDefinitionRequired(reference));
      }
      const dependency = reference.owner === "run"
        ? run.attachments.get(reference.family)
        : attachment.owner === "attempt"
        ? run.attempts.get(attachment.attemptId!)?.attachments.get(reference.family)
        : undefined;
      if (dependency === undefined || dependency.owner !== reference.owner) {
        return yield* Effect.fail(fixedFamilyWriteInvalid());
      }
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
  Definition extends AnyDefinition<"run">,
  Value extends DefinitionValue<Definition>,
>(input: {
  readonly run: RunRuntime;
  readonly persistence: RecordAttachmentPersistence<Definition, number>;
  readonly value: Value | ((build: RecordAttachmentSessionBuilder) => Value);
}): Effect.Effect<void, RecordWriteError | AttachedContentError<Value>, AttachedContentRequirements<Value>> {
  return writeCurrentAttachment({
    run: input.run,
    target: input.run,
    owner: "run",
    baseSegments: Object.freeze(["attachments"]),
    persistence: input.persistence,
    value: input.value,
  });
}

function writeAttemptFamily<
  Definition extends AnyDefinition<"attempt">,
  Value extends DefinitionValue<Definition>,
>(input: {
  readonly attempt: AttemptRuntime;
  readonly persistence: RecordAttachmentPersistence<Definition, number>;
  readonly value: Value | ((build: RecordAttachmentSessionBuilder) => Value);
}): Effect.Effect<void, RecordWriteError | AttachedContentError<Value>, AttachedContentRequirements<Value>> {
  return writeCurrentAttachment({
    run: input.attempt.draft,
    target: input.attempt,
    owner: "attempt",
    baseSegments: Object.freeze([
      "attempts",
      input.attempt.attemptId,
      "attachments",
    ]),
    persistence: input.persistence,
    value: input.value,
  });
}

function writeDescriptorForDefinition<Owner extends RecordAttachmentOwner>(input: {
  readonly run: RunRuntime;
  readonly expectedOwner: Owner;
  readonly definition: unknown;
}): Effect.Effect<
  RecordAttachmentPersistence<AnyDefinition<Owner>, number>,
  RecordWriteError
> {
  if (!isRecordAttachmentDefinition(input.definition)) {
    return Effect.fail(familyDefinitionRequired({
      owner: input.expectedOwner,
      family: "unbranded.record-attachment",
    }));
  }
  const definition = input.definition;
  if (definition.owner !== input.expectedOwner) {
    return Effect.fail(recordOwnerDefinitionMismatch({
      expected: input.expectedOwner,
      actual: definition.owner,
    }));
  }
  const descriptor = input.run.attachmentCatalog.persistence(definition);
  if (
    descriptor === undefined ||
    descriptor.attachment !== definition ||
    input.run.attachmentCatalog.get(definition.owner, definition.family) !== descriptor
  ) {
    return Effect.fail(familyDefinitionRequired({
      owner: definition.owner,
      family: definition.family,
      revision: descriptor?.revision ?? 0,
    }));
  }
  return Effect.succeed(
    descriptor as RecordAttachmentPersistence<AnyDefinition<Owner>, number>,
  );
}

function beginAttemptCompletion(
  attempt: AttemptRuntime,
): Effect.Effect<Deferred.Deferred<void>, RecordWriteError> {
  return attempt.draft.mutex.withPermits(1)(
    Effect.gen(function* () {
      yield* assertRunLive(attempt.draft);
      if (attempt.draft.state !== "open") {
        return yield* Effect.fail(stateError("record", attempt.draft.state));
      }
      if (attempt.state !== "open") {
        return yield* Effect.fail(recordWriterClosed());
      }
      attempt.state = "completing";
      const mutation = yield* Deferred.make<void>();
      attempt.draft.inFlightMutations.add(mutation);
      return mutation;
    }),
  );
}

function completeAttempt(
  attempt: AttemptRuntime,
  outcome: AttemptDocument["outcome"],
): Effect.Effect<void, RecordWriteError> {
  return Effect.flatMap(
    beginAttemptCompletion(attempt),
    (mutation) =>
      Effect.gen(function* () {
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
        yield* attempt.draft.mutex.withPermits(1)(Effect.sync(() => {
          attempt.state = "completed";
          attempt.document = document;
          attempt.draft.membership.set(attempt.slotId, { document: member });
        }));
        yield* Deferred.succeed(attempt.settled, undefined).pipe(Effect.asVoid);
      }).pipe(
        Effect.onExit((exit) =>
          attempt.draft.mutex.withPermits(1)(
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
    attach<Definition extends AnyDefinition<"attempt">, Value extends DefinitionValue<Definition>>(
      definition: Definition,
      value: Value | ((build: RecordAttachmentSessionBuilder) => Value),
    ): Effect.Effect<void, RecordWriteError | AttachedContentError<Value>, AttachedContentRequirements<Value>> {
      if (attemptSessions.get(this) !== attempt) return Effect.fail(recordWriterClosed());
      return Effect.flatMap(
        writeDescriptorForDefinition({
          run: attempt.draft,
          expectedOwner: "attempt",
          definition,
        }),
        (persistence) => writeAttemptFamily({
          attempt,
          persistence: persistence as RecordAttachmentPersistence<Definition, number>,
          value,
        }),
      ) as Effect.Effect<void, RecordWriteError | AttachedContentError<Value>, AttachedContentRequirements<Value>>;
    },
    record: Object.freeze({
      write<Value, Error, Requirements>(
        command: RecordWriteCommand<"attempt", Value, Error, Requirements>,
      ): Effect.Effect<void, RecordWriteError | Error, Requirements> {
        if (attempt.handle === undefined) return Effect.fail(recordWriterClosed());
        const payload = recordWriteCommandPayload(command, "attempt");
        if (payload === undefined) {
          return Effect.fail(familyDefinitionRequired({
            owner: "attempt",
            family: "unbranded.record-command",
          }));
        }
        return Effect.flatMap(
          writeDescriptorForDefinition({
            run: attempt.draft,
            expectedOwner: "attempt",
            definition: payload.definition,
          }),
          (persistence) => writeAttemptFamily({
            attempt,
            persistence,
            value: payload.input,
          }),
        ) as Effect.Effect<void, RecordWriteError | Error, Requirements>;
      },
    }),
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
        const settled = yield* Deferred.make<void>();
        const attempt: AttemptRuntime = {
          draft: run,
          attemptId,
          slotId: input.slotId,
          settled,
          state: "open",
          document: undefined,
          attachments: new Map(),
          reservedFamilies: new Set(),
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
  readonly family: string;
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
  readonly family: string | null;
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
  if (attachmentRuntimeFor({ run: input.run, owner, family: familyText }) === undefined) {
    return undefined;
  }
  if (tail.length === 1 && tail[0] === "attachment.json") {
    return Object.freeze({ kind: "attachment-envelope" as const, owner, family: familyText });
  }
  if (
    tail.length === 3 && tail[0] === "payload" && tail[1] === "sha256" &&
    Schema.is(Sha256DigestSchema)(tail[2])
  ) {
    return Object.freeze({ kind: "payload" as const, owner, family: familyText });
  }
  if (
    tail.length === 3 && tail[0] === "content" && tail[1] === "sha256" &&
    Schema.is(Sha256DigestSchema)(tail[2])
  ) {
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
        owned.filter((entry) => entry.kind === "blob").length !== attachment.physicalBlobCount
      ) return yield* Effect.fail(fixedFamilyWriteInvalid());
    }
    return Object.freeze(entries);
  });
}

function buildSealManifest(run: RunRuntime): Effect.Effect<{
  readonly document: SealManifestDocument;
  readonly bytes: Uint8Array;
}, RecordWriteError> {
  return Effect.gen(function* () {
    const entries = yield* buildStagedInventory(run);
    const document: SealManifestDocument = Object.freeze({
      format: SEAL_MANIFEST_FORMAT,
      runId: run.runId,
      entries,
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

function makeRunRecordWriter(run: RunRuntime): RunWriteSession["record"] {
  return Object.freeze({
    write<Value, Error, Requirements>(
      command: RecordWriteCommand<"run", Value, Error, Requirements>,
    ): Effect.Effect<void, RecordWriteError | Error, Requirements> {
      if (run.handle === undefined) return Effect.fail(recordWriterClosed());
      const payload = recordWriteCommandPayload(command, "run");
      if (payload === undefined) {
        return Effect.fail(familyDefinitionRequired({
          owner: "run",
          family: "unbranded.record-command",
        }));
      }
      return Effect.flatMap(
        writeDescriptorForDefinition({
          run,
          expectedOwner: "run",
          definition: payload.definition,
        }),
        (persistence) => writeRunFamily({
          run,
          persistence,
          value: payload.input,
        }),
      ) as Effect.Effect<void, RecordWriteError | Error, Requirements>;
    },
  });
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
    attach<Definition extends AnyDefinition<"run">, Value extends DefinitionValue<Definition>>(
      definition: Definition,
      value: Value | ((build: RecordAttachmentSessionBuilder) => Value),
    ): Effect.Effect<void, RecordWriteError | AttachedContentError<Value>, AttachedContentRequirements<Value>> {
      if (runSessions.get(this) !== run) return Effect.fail(recordWriterClosed());
      return Effect.flatMap(
        writeDescriptorForDefinition({ run, expectedOwner: "run", definition }),
        (persistence) => writeRunFamily({
          run,
          persistence: persistence as RecordAttachmentPersistence<Definition, number>,
          value,
        }),
      ) as Effect.Effect<void, RecordWriteError | AttachedContentError<Value>, AttachedContentRequirements<Value>>;
    },
    record: makeRunRecordWriter(run),
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
    attach<Definition extends AnyDefinition<"run">, Value extends DefinitionValue<Definition>>(
      definition: Definition,
      value: Value | ((build: RecordAttachmentSessionBuilder) => Value),
    ): Effect.Effect<void, RecordWriteError | AttachedContentError<Value>, AttachedContentRequirements<Value>> {
      if (runSessions.get(this) !== run) return Effect.fail(recordWriterClosed());
      return Effect.flatMap(
        writeDescriptorForDefinition({ run, expectedOwner: "run", definition }),
        (persistence) => writeRunFamily({
          run,
          persistence: persistence as RecordAttachmentPersistence<Definition, number>,
          value,
        }),
      ) as Effect.Effect<void, RecordWriteError | AttachedContentError<Value>, AttachedContentRequirements<Value>>;
    },
    record: makeRunRecordWriter(run),
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
  attachmentCatalog: RecordFamilyDescriptorCatalog,
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
    yield* initializeRecord({ root: request.root, fileSystem, entropy });
    const current = yield* readCurrentRecordFormat(fileSystem, request.root);
    yield* coordination.verifyRecordIdentity({ root: request.root, recordId: current.document.recordId });
    yield* recoverRunPublications({
      fileSystem,
      root: request.root,
      record: current.document,
      attachmentCatalog,
    });
    const fresh = yield* createFreshRunStaging(request.root, fileSystem, entropy);
    const runId = fresh.runId;
    const mutex = yield* Effect.makeSemaphore(1);
    const runtime: RunRuntime = {
      root: request.root,
      fileSystem,
      entropy,
      record: current.document,
      attachmentCatalog,
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
      reservedFamilies: new Set(),
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
  attachmentCatalog: RecordFamilyDescriptorCatalog,
): Effect.Effect<
  RunWriteSession,
  RecordReaderOpenError | RecordWriteError,
  import("effect").Scope.Scope | RecordFileSystem | RecordEntropy | RecordCoordination
> {
  return Effect.map(openNewRuntime(request, attachmentCatalog), makeRunSession);
}

function openNewReferenceRun(
  request: CreateReferenceRunRequest,
  attachmentCatalog: RecordFamilyDescriptorCatalog,
): Effect.Effect<
  ReferenceRunWriteSession,
  RecordReaderOpenError | RecordWriteError,
  import("effect").Scope.Scope | RecordFileSystem | RecordEntropy | RecordCoordination
> {
  return Effect.map(openNewRuntime(request, attachmentCatalog), makeReferenceRunSession);
}

interface AnyMigrationDescriptor {
  readonly persistence: AnyRecordAttachmentPersistence;
  readonly attachment: AnyRecordAttachmentPersistence["attachment"];
  readonly family: string;
}

function migrationDescriptor(
  persistence: AnyRecordAttachmentPersistence,
): AnyMigrationDescriptor {
  return Object.freeze({
    persistence,
    attachment: persistence.attachment,
    family: persistence.attachment.family,
  });
}

interface KnownMigrationAttachment {
  readonly owner: RecordAttachmentOwner;
  readonly runId: RunId;
  readonly attemptId?: AttemptId;
  readonly descriptor: AnyMigrationDescriptor;
}

interface MigrationFileSnapshot {
  readonly path: RecordPortablePath;
  readonly bytes: Uint8Array;
  readonly maximumBytes: number;
}

interface MigrationContent {
  readonly key: RecordBlobKey;
  readonly sha256: Sha256Digest;
  readonly bytes: Uint8Array;
}

interface MaterializedMigrationState {
  readonly revision: number;
  readonly document?: RecordMigrationDocument;
  readonly payloadBytes: Uint8Array;
  readonly contents: readonly MigrationContent[];
  readonly envelope: DurableRecordAttachmentEnvelope | RecordAttachmentEnvelope | undefined;
  readonly envelopeBytes: Uint8Array;
  readonly legacyPhysical: boolean;
}

interface PlannedMigrationStep {
  readonly location: KnownMigrationAttachment;
  readonly target: RecordAttachmentMigrationTarget;
  readonly sourceEnvelopeBytes: Uint8Array;
  readonly targetEnvelope: DurableRecordAttachmentEnvelope | RecordAttachmentEnvelope;
  readonly targetEnvelopeBytes: Uint8Array;
  readonly payloadBytes: Uint8Array;
  readonly contents: readonly MigrationContent[];
}

interface PlannedMigrationAttachment {
  readonly location: KnownMigrationAttachment;
  readonly initialFiles: readonly MigrationFileSnapshot[];
  readonly initialShape: AttachmentShape;
  readonly steps: readonly PlannedMigrationStep[];
  readonly finalState: MaterializedMigrationState;
  readonly orphanFiles: readonly RecordPortablePath[];
  readonly orphanDirectories: readonly RecordPortablePath[];
  readonly cleanupRequired: boolean;
}

interface PlannedMigrationRun {
  readonly runId: RunId;
  readonly sourceSealBytes: Uint8Array;
  readonly targetSealBytes: Uint8Array;
  readonly targetSeal: SealManifestDocument;
  readonly core: RunCore;
  readonly replaceSeal: boolean;
}

interface InternalMigrationPlan {
  readonly sourceFormat: "niceeval.record.attachments" | "niceeval.record.source-receipts";
  readonly rootSourceBytes: Uint8Array;
  readonly rootTargetBytes: Uint8Array;
  readonly attachments: readonly PlannedMigrationAttachment[];
  readonly runs: readonly PlannedMigrationRun[];
  readonly fingerprint: string;
  readonly skipped: number;
}

interface AttachmentShape {
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

const migrationPlanInternals = new WeakMap<object, InternalMigrationPlan>();

function migrationInvalid(family: string): RecordMigrationInvalid {
  return new RecordMigrationInvalid({ code: "record-migration-invalid", family });
}

function migrationPlanStale(): RecordMigrationPlanStale {
  return new RecordMigrationPlanStale({ code: "record-migration-plan-stale" });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);
}

function migrationLocationKey(location: KnownMigrationAttachment): string {
  return [
    location.runId,
    location.owner === "run" ? "0" : "1",
    location.attemptId ?? "",
    location.descriptor.attachment.family,
  ].join("\u0000");
}

function migrationAttachmentDirectory(
  root: RecordRoot,
  location: KnownMigrationAttachment,
): RecordPortablePath {
  return location.owner === "run"
    ? recordPortablePath(
        root,
        "runs",
        location.runId,
        "attachments",
        location.descriptor.attachment.family,
      )
    : recordPortablePath(
        root,
        "runs",
        location.runId,
        "attempts",
        location.attemptId!,
        "attachments",
        location.descriptor.attachment.family,
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

function migrationRunRelativeBase(location: KnownMigrationAttachment): string {
  return location.owner === "run"
    ? "attachments/" + location.descriptor.attachment.family
    : "attempts/" + location.attemptId + "/attachments/" + location.descriptor.attachment.family;
}

function migrationPath(
  root: RecordRoot,
  location: KnownMigrationAttachment,
  ...segments: readonly string[]
): RecordPortablePath {
  const base = migrationAttachmentDirectory(root, location);
  return recordPortablePath(root, ...base.segments, ...segments);
}

function readMigrationBytes(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly path: RecordPortablePath;
  readonly maximumBytes: number;
  readonly family: string;
}): Effect.Effect<Uint8Array, RecordMaintenanceError> {
  return input.fileSystem.readFile({
    file: input.path,
    maximumBytes: input.maximumBytes,
  }).pipe(
    Effect.flatMap((bytes) =>
      bytes === undefined ? Effect.fail(migrationInvalid(input.family)) : Effect.succeed(bytes)
    ),
  );
}

function scanAttachmentShape(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: KnownMigrationAttachment;
}): Effect.Effect<AttachmentShape, RecordMaintenanceError> {
  const base = migrationAttachmentDirectory(input.root, input.location);
  return Effect.gen(function* () {
    const files: string[] = [];
    const directories: string[] = [];
    const visit = (
      segments: readonly string[],
      depth: number,
    ): Effect.Effect<void, RecordMaintenanceError> => Effect.gen(function* () {
      if (depth > 8) return yield* Effect.fail(migrationInvalid(input.location.descriptor.family));
      const directory = recordPortablePath(input.root, ...base.segments, ...segments);
      const entries = yield* input.fileSystem.listDirectory({
        directory,
        maximumEntries: MAXIMUM_STAGED_INVENTORY_ENTRIES,
      });
      for (const entry of entries) {
        if (!isPortableSegment(entry.name) || entry.kind === "other") {
          return yield* Effect.fail(migrationInvalid(input.location.descriptor.family));
        }
        const next = [...segments, entry.name];
        const text = next.join("/");
        if (entry.kind === "file") files.push(text);
        else {
          directories.push(text);
          yield* visit(next, depth + 1);
        }
      }
    });
    yield* visit([], 0);
    files.sort(compareCanonicalIdentity);
    directories.sort(compareCanonicalIdentity);
    return Object.freeze({
      files: Object.freeze(files),
      directories: Object.freeze(directories),
    });
  });
}

function finalAttachmentFiles(
  root: RecordRoot,
  attachment: {
    readonly location: KnownMigrationAttachment;
    readonly finalState: MaterializedMigrationState;
  },
): Either.Either<readonly MigrationFileSnapshot[], RecordMigrationInvalid> {
  const envelope = attachment.finalState.envelope;
  if (envelope === undefined) {
    return Either.left(migrationInvalid(attachment.location.descriptor.family));
  }
  const files: MigrationFileSnapshot[] = [
    Object.freeze({
      path: migrationPath(root, attachment.location, "attachment.json"),
      bytes: attachment.finalState.envelopeBytes,
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
    }),
    Object.freeze({
      path: migrationPath(root, attachment.location, "payload", "sha256", envelope.payload.sha256),
      bytes: attachment.finalState.payloadBytes,
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
    }),
  ];
  const byDigest = new Map<Sha256Digest, Uint8Array>();
  for (const content of attachment.finalState.contents) byDigest.set(content.sha256, content.bytes);
  for (const [digest, bytes] of byDigest) {
    files.push(Object.freeze({
      path: migrationPath(root, attachment.location, "content", "sha256", digest),
      bytes,
      maximumBytes: MAXIMUM_ATTACHMENT_BLOB_BYTES,
    }));
  }
  return Either.right(Object.freeze(files));
}

function migrationMarker(value: unknown, key: string): unknown | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== key) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && descriptor.enumerable && "value" in descriptor
    ? descriptor.value
    : undefined;
}

interface VerifiedMigrationPhysical {
  readonly payload: unknown;
  readonly contents: ReadonlyMap<string, Uint8Array>;
  readonly references: readonly {
    readonly owner: RecordAttachmentOwner;
    readonly family: string;
  }[];
}

function migrationDocumentFromPhysical(input: {
  readonly physical: VerifiedMigrationPhysical;
  readonly catalog: RecordAttachmentCatalog;
  readonly family: string;
}): RecordMigrationDocument {
  const contentByKey = new Map<string, import("../attachment/protocol.ts").RecordMigrationContent>();
  const usedContent = new Set<string>();
  const references: import("../attachment/protocol.ts").RecordAttachmentReference<any, unknown>[] = [];
  const referenceIdentities = new Set<string>();
  const visit = (value: unknown): unknown => {
    const contentKey = migrationMarker(value, "$niceeval.record.content") ??
      migrationMarker(value, "$niceeval.record.blob");
    if (typeof contentKey === "string") {
      const bytes = input.physical.contents.get(contentKey);
      if (bytes === undefined || usedContent.has(contentKey)) throw migrationInvalid(input.family);
      usedContent.add(contentKey);
      let token = contentByKey.get(contentKey);
      if (token === undefined) {
        token = makeRecordMigrationContent(bytes);
        contentByKey.set(contentKey, token);
      }
      return token;
    }
    const referenceMarker = migrationMarker(value, "$niceeval.record.reference");
    if (referenceMarker !== undefined) {
      if (typeof referenceMarker !== "object" || referenceMarker === null || Array.isArray(referenceMarker)) {
        throw migrationInvalid(input.family);
      }
      const marker = referenceMarker as Record<string, unknown>;
      if (
        Reflect.ownKeys(marker).length !== 3 ||
        (marker.owner !== "run" && marker.owner !== "attempt") ||
        typeof marker.family !== "string" ||
        !("value" in marker)
      ) throw migrationInvalid(input.family);
      const target = input.catalog.get(marker.owner, marker.family);
      if (target === undefined) throw familyDefinitionRequired({ owner: marker.owner, family: marker.family });
      const token = mintRecordAttachmentReference(
        RecordAttachmentReference.to(target.attachment),
        marker.value,
      );
      references.push(token);
      referenceIdentities.add(`${marker.owner}\u0000${marker.family}`);
      return token;
    }
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(visit);
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor) || !descriptor.enumerable) throw migrationInvalid(input.family);
      output[key] = visit(descriptor.value);
    }
    return output;
  };
  const value = visit(input.physical.payload);
  if (usedContent.size !== input.physical.contents.size) throw migrationInvalid(input.family);
  const declaredReferences = input.physical.references.map(({ owner, family }) => `${owner}\u0000${family}`);
  const observedReferences = [...referenceIdentities].sort(compareCanonicalIdentity);
  if (!sameOrderedStrings(declaredReferences, observedReferences)) throw migrationInvalid(input.family);
  const contents = Object.freeze([...contentByKey.values()]);
  return Object.freeze({
    value,
    contents,
    references: Object.freeze(references),
    content: RecordMigrationContent.access(contents),
  });
}

function verifyMigrationPhysicalAgainstSeal(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: KnownMigrationAttachment;
  readonly snapshots: readonly MigrationFileSnapshot[];
}): Effect.Effect<void, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const family = input.location.descriptor.family;
    const sealBytes = yield* readMigrationBytes({
      fileSystem: input.fileSystem,
      path: runPath(input.root, input.location.runId, "seal-manifest.json"),
      maximumBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
      family,
    });
    const json = parseJson(sealBytes);
    if (json === undefined) return yield* Effect.fail(migrationInvalid(family));
    const current = decodeSealManifestDocument(json);
    const legacy = Either.isLeft(current) ? decodeLegacySealManifestDocument(json) : undefined;
    const manifest = Either.isRight(current)
      ? current.right
      : legacy !== undefined && Either.isRight(legacy)
      ? legacy.right
      : undefined;
    if (manifest === undefined || manifest.runId !== input.location.runId) {
      return yield* Effect.fail(migrationInvalid(family));
    }
    const expectedOwner = input.location.owner === "run" ? "run" : input.location.attemptId!;
    const base = migrationRunRelativeBase(input.location);
    const expectedPaths = new Set<string>();
    for (const snapshot of input.snapshots) {
      const suffix = snapshot.path.segments.slice(
        migrationAttachmentDirectory(input.root, input.location).segments.length,
      ).join("/");
      const path = `${base}/${suffix}`;
      expectedPaths.add(path);
      const entry = manifest.entries.find((candidate) => candidate.path === path);
      const kind: SealManifestEntry["kind"] = suffix === "attachment.json"
        ? "attachment-envelope"
        : suffix === "payload.json" || suffix.startsWith("payload/")
        ? "payload"
        : "blob";
      if (
        entry === undefined ||
        entry.kind !== kind ||
        entry.owner !== expectedOwner ||
        entry.family !== family ||
        entry.byteLength !== snapshot.bytes.byteLength ||
        entry.sha256 !== sha256Bytes(snapshot.bytes)
      ) return yield* Effect.fail(migrationInvalid(family));
    }
    const declared = manifest.entries.filter((entry) =>
      entry.owner === expectedOwner && entry.family === family
    );
    if (
      declared.length !== expectedPaths.size ||
      declared.some((entry) => !expectedPaths.has(entry.path))
    ) return yield* Effect.fail(migrationInvalid(family));
  });
}

function loadLegacyMigrationAttachmentV2(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: KnownMigrationAttachment;
  readonly catalog: RecordAttachmentCatalog;
}): Effect.Effect<{
  readonly state: MaterializedMigrationState;
  readonly snapshots: readonly MigrationFileSnapshot[];
}, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const family = input.location.descriptor.family;
    const envelopePath = migrationPath(input.root, input.location, "attachment.json");
    const envelopeBytes = yield* readMigrationBytes({
      fileSystem: input.fileSystem,
      path: envelopePath,
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
      family,
    });
    const envelopeJson = parseJson(envelopeBytes);
    if (envelopeJson === undefined) return yield* Effect.fail(migrationInvalid(family));
    const addressed = decodeRecordAttachmentEnvelope(envelopeJson);
    const legacy = Either.isLeft(addressed)
      ? decodeLegacyRecordAttachmentHeader(envelopeJson)
      : undefined;
    const addressedEnvelope = Either.isRight(addressed) ? addressed.right : undefined;
    const legacyEnvelope = legacy !== undefined && Either.isRight(legacy) ? legacy.right : undefined;
    if (
      addressedEnvelope === undefined && legacyEnvelope === undefined ||
      addressedEnvelope !== undefined && (
        addressedEnvelope.ownerKind !== input.location.owner ||
        addressedEnvelope.family !== family
      ) ||
      legacyEnvelope !== undefined && legacyEnvelope.family !== family
    ) return yield* Effect.fail(migrationInvalid(family));

    const revision = addressedEnvelope?.schemaVersion ?? legacyEnvelope!.schemaVersion;
    const snapshots: MigrationFileSnapshot[] = [Object.freeze({
      path: envelopePath,
      bytes: envelopeBytes,
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
    })];
    let payloadBytes: Uint8Array;
    const contents = new Map<string, Uint8Array>();
    const materialized: MigrationContent[] = [];
    if (addressedEnvelope !== undefined) {
      if (addressedEnvelope.contents.length > RECORD_ATTACHMENT_MAXIMUM_CONTENTS) {
        return yield* Effect.fail(migrationInvalid(family));
      }
      const payloadPath = migrationPath(
        input.root,
        input.location,
        "payload",
        "sha256",
        addressedEnvelope.payload.sha256,
      );
      payloadBytes = yield* readMigrationBytes({
        fileSystem: input.fileSystem,
        path: payloadPath,
        maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
        family,
      });
      if (
        payloadBytes.byteLength !== addressedEnvelope.payload.byteLength ||
        sha256Bytes(payloadBytes) !== addressedEnvelope.payload.sha256
      ) return yield* Effect.fail(migrationInvalid(family));
      snapshots.push(Object.freeze({
        path: payloadPath,
        bytes: payloadBytes,
        maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
      }));
      let totalBytes = 0;
      for (const pointer of addressedEnvelope.contents) {
        if (contents.has(pointer.key) || pointer.byteLength > MAXIMUM_ATTACHMENT_BLOB_BYTES) {
          return yield* Effect.fail(migrationInvalid(family));
        }
        const path = migrationPath(
          input.root,
          input.location,
          "content",
          "sha256",
          pointer.sha256,
        );
        const bytes = yield* readMigrationBytes({
          fileSystem: input.fileSystem,
          path,
          maximumBytes: MAXIMUM_ATTACHMENT_BLOB_BYTES,
          family,
        });
        if (bytes.byteLength !== pointer.byteLength || sha256Bytes(bytes) !== pointer.sha256) {
          return yield* Effect.fail(migrationInvalid(family));
        }
        totalBytes += bytes.byteLength;
        if (totalBytes > RECORD_ATTACHMENT_MAXIMUM_TOTAL_CONTENT_BYTES) {
          return yield* Effect.fail(migrationInvalid(family));
        }
        contents.set(pointer.key, bytes);
        materialized.push(Object.freeze({ key: pointer.key, sha256: pointer.sha256, bytes }));
        if (!snapshots.some((snapshot) => snapshot.path.segments.join("/") === path.segments.join("/"))) {
          snapshots.push(Object.freeze({ path, bytes, maximumBytes: MAXIMUM_ATTACHMENT_BLOB_BYTES }));
        }
      }
    } else {
      const payloadPath = migrationPath(input.root, input.location, "payload.json");
      payloadBytes = yield* readMigrationBytes({
        fileSystem: input.fileSystem,
        path: payloadPath,
        maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
        family,
      });
      snapshots.push(Object.freeze({
        path: payloadPath,
        bytes: payloadBytes,
        maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
      }));
      const blobDirectory = migrationPath(input.root, input.location, "blobs");
      const kind = yield* input.fileSystem.pathKind(blobDirectory);
      const entries = kind === "missing"
        ? []
        : kind === "directory"
        ? yield* input.fileSystem.listDirectory({
            directory: blobDirectory,
            maximumEntries: RECORD_ATTACHMENT_MAXIMUM_CONTENTS,
          })
        : undefined;
      if (entries === undefined || entries.some((entry) => entry.kind !== "file")) {
        return yield* Effect.fail(migrationInvalid(family));
      }
      let totalBytes = 0;
      for (const entry of [...entries].sort((left, right) => compareCanonicalIdentity(left.name, right.name))) {
        const key = recordBlobKey(entry.name);
        if (key === undefined || contents.has(key)) return yield* Effect.fail(migrationInvalid(family));
        const path = migrationPath(input.root, input.location, "blobs", key);
        const bytes = yield* readMigrationBytes({
          fileSystem: input.fileSystem,
          path,
          maximumBytes: MAXIMUM_ATTACHMENT_BLOB_BYTES,
          family,
        });
        totalBytes += bytes.byteLength;
        if (totalBytes > RECORD_ATTACHMENT_MAXIMUM_TOTAL_CONTENT_BYTES) {
          return yield* Effect.fail(migrationInvalid(family));
        }
        const sha256 = sha256Bytes(bytes);
        contents.set(key, bytes);
        materialized.push(Object.freeze({ key, sha256, bytes }));
        snapshots.push(Object.freeze({ path, bytes, maximumBytes: MAXIMUM_ATTACHMENT_BLOB_BYTES }));
      }
    }

    const payload = parseJson(payloadBytes);
    if (payload === undefined) return yield* Effect.fail(migrationInvalid(family));
    yield* verifyMigrationPhysicalAgainstSeal({
      fileSystem: input.fileSystem,
      root: input.root,
      location: input.location,
      snapshots,
    });
    const references = addressedEnvelope?.references ?? Object.freeze([]);
    const document = yield* Effect.try({
      try: () => migrationDocumentFromPhysical({
        physical: { payload, contents, references },
        catalog: input.catalog,
        family,
      }),
      catch: (cause) => cause instanceof FamilyDefinitionRequired ? cause : migrationInvalid(family),
    });
    return Object.freeze({
      state: Object.freeze({
        revision,
        document,
        payloadBytes,
        contents: Object.freeze(materialized),
        envelope: addressedEnvelope,
        envelopeBytes,
        legacyPhysical: true,
      }),
      snapshots: Object.freeze(snapshots),
    });
  });
}

function loadMigrationAttachmentV2(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: KnownMigrationAttachment;
  readonly catalog: RecordAttachmentCatalog;
}): Effect.Effect<{
  readonly state: MaterializedMigrationState;
  readonly snapshots: readonly MigrationFileSnapshot[];
}, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const persistence = input.location.descriptor.persistence;
    const family = persistence.attachment.family;
    const physical = yield* readVerifiedRecordAttachmentPhysical({
      fileSystem: input.fileSystem,
      root: input.root,
      location: migrationReaderLocation(input.location),
      family,
    });
    if (physical === undefined) return yield* loadLegacyMigrationAttachmentV2(input);
    const contents: MigrationContent[] = physical.envelope.contents.map((pointer) => Object.freeze({
      key: pointer.key,
      sha256: pointer.sha256,
      bytes: physical.contents.get(pointer.key)!,
    }));
    const snapshots: MigrationFileSnapshot[] = [
      Object.freeze({
        path: migrationPath(input.root, input.location, "attachment.json"),
        bytes: physical.envelopeBytes,
        maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
      }),
      Object.freeze({
        path: migrationPath(input.root, input.location, "payload", "sha256", physical.envelope.payload.sha256),
        bytes: physical.payloadBytes,
        maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
      }),
      ...[...new Map(contents.map((content) => [content.sha256, content.bytes] as const))].map(([sha256, bytes]) =>
        Object.freeze({
          path: migrationPath(input.root, input.location, "content", "sha256", sha256),
          bytes,
          maximumBytes: MAXIMUM_ATTACHMENT_BLOB_BYTES,
        })
      ),
    ];
    yield* verifyMigrationPhysicalAgainstSeal({
      fileSystem: input.fileSystem,
      root: input.root,
      location: input.location,
      snapshots,
    });
    const document = yield* Effect.try({
      try: () => migrationDocumentFromPhysical({
        physical: {
          payload: physical.payload,
          contents: physical.contents,
          references: physical.envelope.references,
        },
        catalog: input.catalog,
        family,
      }),
      catch: (cause) => cause instanceof FamilyDefinitionRequired ? cause : migrationInvalid(family),
    });
    return Object.freeze({
      state: Object.freeze({
        revision: physical.envelope.revision,
        document,
        payloadBytes: physical.payloadBytes,
        contents: Object.freeze(contents),
        envelope: physical.envelope,
        envelopeBytes: physical.envelopeBytes,
        legacyPhysical: false,
      }),
      snapshots: Object.freeze(snapshots),
    });
  });
}

function prepareMigrationCurrentV2(input: {
  readonly location: KnownMigrationAttachment;
  readonly source: MaterializedMigrationState;
}): Effect.Effect<{ readonly step: PlannedMigrationStep; readonly next: MaterializedMigrationState }, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const persistence = input.location.descriptor.persistence;
    const family = persistence.attachment.family;
    let revision = input.source.revision;
    const initialDocument = input.source.document;
    if (initialDocument === undefined) return yield* Effect.fail(migrationInvalid(family));
    let document: RecordMigrationDocument = initialDocument;
    const impacts: RecordMigrationImpact[] = [];
    while (revision < persistence.revision) {
      const migration = recordAttachmentMigrationAt(persistence, revision);
      if (migration === undefined) return yield* Effect.fail(migrationInvalid(family));
      const sourceDocument = document;
      const migrated = yield* Effect.suspend(() => runRecordMigration(migration, sourceDocument)).pipe(
        Effect.mapError(() => migrationInvalid(family)),
        Effect.catchAllDefect(() => Effect.fail(migrationInvalid(family))),
      );
      impacts.push(...migrated.impact);
      document = yield* Effect.try({
        try: () => recordMigrationDocumentFromResult(migrated),
        catch: () => migrationInvalid(family),
      });
      revision += 1;
    }

    const prepared = yield* (prepareCurrentRecordAttachment({
      definition: persistence.attachment,
      value: (build: RecordAttachmentSessionBuilder) => {
        const hydrated = hydrateRecordMigrationValue(
          persistence.attachment,
          document!.value,
          (token, declaration) => {
            const bytes = unwrapRecordMigrationTargetContent(token);
            if (bytes === undefined) return Either.left({ code: "migration-content-hydration-failed" as const });
            if (declaration.kind === "bytes") return Either.right(build.content.bytes(bytes));
            try {
              return Either.right(build.content.text(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
            } catch {
              return Either.left({ code: "migration-content-hydration-failed" as const });
            }
          },
        );
        if (Either.isLeft(hydrated)) throw migrationInvalid(family);
        return hydrated.right;
      },
      digest: sha256Bytes,
    }).pipe(Effect.mapError(() => migrationInvalid(family))) as Effect.Effect<
      import("../writer/current-attachment.ts").PreparedCurrentAttachment,
      RecordMaintenanceError,
      never
    >);
    const payloadDigest = sha256Bytes(prepared.payloadBytes);
    const envelope: DurableRecordAttachmentEnvelope = Object.freeze({
      format: "niceeval.record-attachment",
      ownerKind: input.location.owner,
      family,
      revision: persistence.revision,
      payload: Object.freeze({ sha256: payloadDigest, byteLength: prepared.payloadBytes.byteLength }),
      contents: Object.freeze(prepared.contents.map(({ key, sha256, bytes }) => Object.freeze({
        key,
        sha256,
        byteLength: bytes.byteLength,
      }))),
      references: prepared.references,
    });
    const encoded = encodeDurableRecordAttachmentEnvelope(envelope);
    if (Either.isLeft(encoded)) return yield* Effect.fail(migrationInvalid(family));
    const envelopeBytes = jsonBytes(encoded.right);
    const contents: MigrationContent[] = prepared.contents.map(({ key, sha256, bytes }) =>
      Object.freeze({ key, sha256, bytes })
    );
    const retainedFacts = impacts.filter(({ code }) => code === "migration-content-retained")
      .map(({ path }) => path.join("."));
    const droppedFacts = impacts.filter(({ code }) => code === "migration-content-dropped")
      .map(({ path }) => path.join("."));
    const target: RecordAttachmentMigrationTarget = Object.freeze({
      family,
      owner: input.location.owner,
      runId: input.location.runId,
      ...(input.location.attemptId === undefined ? {} : { attemptId: input.location.attemptId }),
      fromRevision: input.source.revision,
      toRevision: persistence.revision,
      retention: Object.freeze({
        retainedFacts: Object.freeze(retainedFacts),
        droppedFacts: Object.freeze(droppedFacts),
        rerunRecommendation: impacts.some(({ recommendation }) => recommendation === "rerun") ? "rerun" : null,
      }),
    });
    const step: PlannedMigrationStep = Object.freeze({
      location: input.location,
      target,
      sourceEnvelopeBytes: input.source.envelopeBytes,
      targetEnvelope: envelope,
      targetEnvelopeBytes: envelopeBytes,
      payloadBytes: prepared.payloadBytes,
      contents: Object.freeze(contents),
    });
    return Object.freeze({
      step,
      next: Object.freeze({
        revision: persistence.revision,
        document,
        payloadBytes: prepared.payloadBytes,
        contents: Object.freeze(contents),
        envelope,
        envelopeBytes,
        legacyPhysical: false,
      }),
    });
  });
}

function planMigrationAttachmentV2(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: KnownMigrationAttachment;
  readonly catalog: RecordAttachmentCatalog;
}): Effect.Effect<PlannedMigrationAttachment, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const loaded = yield* loadMigrationAttachmentV2(input);
    const persistence = input.location.descriptor.persistence;
    if (loaded.state.revision > persistence.revision) {
      return yield* Effect.fail(new RecordFormatUnsupported({
        code: "record-format-unsupported",
        format: `${persistence.attachment.family}@${loaded.state.revision}`,
      }));
    }
    let current = loaded.state;
    const steps: PlannedMigrationStep[] = [];
    if (current.revision < persistence.revision || current.legacyPhysical) {
      const prepared = yield* prepareMigrationCurrentV2({ location: input.location, source: current });
      steps.push(prepared.step);
      current = prepared.next;
    } else {
      const read = yield* readCurrentRecordAttachment({
        fileSystem: input.fileSystem,
        root: input.root,
        location: migrationReaderLocation(input.location),
        persistence,
        lifecycle: { closed: false },
      });
      if (read.state !== "available") return yield* Effect.fail(migrationInvalid(persistence.attachment.family));
    }

    const shape = yield* scanAttachmentShape(input);
    const finalFiles = yield* finalAttachmentFiles(input.root, {
      location: input.location,
      finalState: current,
    });
    const expectedFiles = new Set(finalFiles.map((file) => file.path.segments.slice(
      migrationAttachmentDirectory(input.root, input.location).segments.length,
    ).join("/")));
    const expectedDirectories = new Set(expectedInventoryDirectories([...expectedFiles]));
    const orphanFiles = shape.files.filter((path) => !expectedFiles.has(path))
      .map((path) => migrationPath(input.root, input.location, ...path.split("/")));
    const orphanDirectories = shape.directories.filter((path) => !expectedDirectories.has(path))
      .sort((left, right) => right.split("/").length - left.split("/").length || compareCanonicalIdentity(left, right))
      .map((path) => migrationPath(input.root, input.location, ...path.split("/")));
    return Object.freeze({
      location: input.location,
      initialFiles: loaded.snapshots,
      initialShape: shape,
      steps: Object.freeze(steps),
      finalState: current,
      orphanFiles: Object.freeze(orphanFiles),
      orphanDirectories: Object.freeze(orphanDirectories),
      cleanupRequired: orphanFiles.length > 0 || orphanDirectories.length > 0,
    });
  });
}

function planMigrationAttachment(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly location: KnownMigrationAttachment;
  readonly catalog: RecordAttachmentCatalog;
}): Effect.Effect<PlannedMigrationAttachment, RecordMaintenanceError> {
  return planMigrationAttachmentV2(input);
}

function ensureOrdinaryCurrentAttachments(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly attachmentCatalog: RecordFamilyDescriptorCatalog;
}): Effect.Effect<void, RecordReaderOpenError> {
  return Effect.gen(function* () {
    const inspectDirectory = (
      directory: RecordPortablePath,
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
      for (const entry of entries) {
        if (entry.kind !== "directory") continue;
        const descriptor = input.attachmentCatalog.get(owner, entry.name);
        if (descriptor === undefined) continue;
        const location: KnownMigrationAttachment = Object.freeze({
          owner,
          runId,
          ...(attemptId === undefined ? {} : { attemptId }),
          descriptor: migrationDescriptor(descriptor),
        });
        const inspected = yield* inspectRecordAttachmentEnvelope({
          fileSystem: input.fileSystem,
          root: input.root,
          location: migrationReaderLocation(location),
          persistence: descriptor,
        });
        if (inspected.state === "migration-required") {
          return yield* Effect.fail(new RecordMigrationRequired({
            code: "record-migration-required",
            source: inspected.family + "@" + inspected.fromRevision,
            target: inspected.family + "@" + inspected.toRevision,
            command: inspected.command,
          }));
        }
        if (inspected.state === "unsupported") {
          return yield* Effect.fail(new RecordFormatUnsupported({
            code: "record-format-unsupported",
            format: inspected.family + "@" + inspected.revision,
          }));
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
      if (runId === undefined || !(yield* input.fileSystem.isCompleteMarker({ root: input.root, runId }))) {
        continue;
      }
      yield* inspectDirectory(
        recordPortablePath(input.root, "runs", runId, "attachments"),
        "run",
        runId,
      );
      const attemptsRoot = recordPortablePath(input.root, "runs", runId, "attempts");
      if ((yield* input.fileSystem.pathKind(attemptsRoot)) !== "directory") continue;
      const attempts = yield* input.fileSystem.listDirectory({
        directory: attemptsRoot,
        maximumEntries: MAXIMUM_ATTEMPT_ENTRIES,
      });
      for (const attempt of attempts) {
        if (attempt.kind !== "directory") continue;
        const attemptId = decodeAttemptId(attempt.name);
        if (attemptId === undefined) continue;
        yield* inspectDirectory(
          recordPortablePath(input.root, "runs", runId, "attempts", attemptId, "attachments"),
          "attempt",
          runId,
          attemptId,
        );
      }
    }
  });
}

function readKnownAttachmentLocations(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly catalog: RecordFamilyDescriptorCatalog;
}): Effect.Effect<readonly KnownMigrationAttachment[], RecordMaintenanceError> {
  return Effect.gen(function* () {
    const locations: KnownMigrationAttachment[] = [];
    const readFamilies = (
      directory: RecordPortablePath,
      owner: RecordAttachmentOwner,
      runId: RunId,
      attemptId?: AttemptId,
    ): Effect.Effect<void, RecordMaintenanceError> => Effect.gen(function* () {
      const kind = yield* input.fileSystem.pathKind(directory);
      if (kind === "missing") return;
      if (kind !== "directory") return yield* Effect.fail(migrationInvalid("attachment-inventory"));
      const entries = yield* input.fileSystem.listDirectory({ directory, maximumEntries: 256 });
      for (const entry of entries) {
        if (entry.kind !== "directory") return yield* Effect.fail(migrationInvalid(entry.name));
        const descriptor = input.catalog.get(owner, entry.name);
        if (descriptor === undefined) {
          return yield* Effect.fail(familyDefinitionRequired({ owner, family: entry.name }));
        }
        locations.push(Object.freeze({
          owner,
          runId,
          ...(attemptId === undefined ? {} : { attemptId }),
          descriptor: migrationDescriptor(descriptor),
        }));
      }
    });

    const runs = yield* input.fileSystem.listDirectory({
      directory: recordPortablePath(input.root, "runs"),
      maximumEntries: MAXIMUM_RUN_ENTRIES,
    });
    for (const entry of runs) {
      if (entry.kind !== "directory") continue;
      const runId = decodeRunId(entry.name);
      if (runId === undefined || !(yield* input.fileSystem.isCompleteMarker({ root: input.root, runId }))) {
        continue;
      }
      yield* readFamilies(
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
        yield* readFamilies(
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
    return Object.freeze(locations.sort((left, right) =>
      compareCanonicalIdentity(migrationLocationKey(left), migrationLocationKey(right))
    ));
  });
}

function sealEntryForFile(input: {
  readonly runId: RunId;
  readonly owner: "run" | AttemptId;
  readonly family: string | null;
  readonly kind: SealManifestEntry["kind"];
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}): SealManifestEntry | undefined {
  const path = canonicalRunRelativePath(input.relativePath);
  return path === undefined
    ? undefined
    : Object.freeze({
        kind: input.kind,
        owner: input.owner,
        family: input.family,
        path,
        byteLength: input.bytes.byteLength,
        sha256: sha256Bytes(input.bytes),
      });
}

function planRunCore(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runId: RunId;
  readonly sourceSealBytes: Uint8Array;
}): Effect.Effect<{
  readonly core: RunCore;
  readonly entries: readonly SealManifestEntry[];
}, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const complete = yield* readMigrationBytes({
      fileSystem: input.fileSystem,
      path: runPath(input.root, input.runId, "complete"),
      maximumBytes: 0,
      family: "niceeval.core",
    });
    if (complete.byteLength !== 0) return yield* Effect.fail(migrationInvalid("niceeval.core"));
    const run = yield* readRunDocument(input.fileSystem, input.root, input.runId);
    const members = yield* readRunMembers(input.fileSystem, input.root, input.runId);
    const attempts = yield* readRunAttempts(input.fileSystem, input.root, input.runId);
    if (run === undefined || members === undefined || attempts === undefined) {
      return yield* Effect.fail(migrationInvalid("niceeval.core"));
    }
    const core: RunCore = Object.freeze({ run, members, attempts });
    const paths = [
      "run.json",
      ...members.map((member) => "members/" + member.slotId + ".json"),
      ...attempts.map((attempt) => "attempts/" + attempt.attemptId + "/attempt.json"),
    ].sort(compareCanonicalIdentity);
    const entries: SealManifestEntry[] = [];
    for (const relativePath of paths) {
      const bytes = yield* readMigrationBytes({
        fileSystem: input.fileSystem,
        path: runPath(input.root, input.runId, ...relativePath.split("/")),
        maximumBytes: MAXIMUM_CORE_BYTES,
        family: "niceeval.core",
      });
      const owner = relativePath.startsWith("attempts/")
        ? decodeAttemptId(relativePath.split("/")[1]!) ?? "run"
        : "run";
      const entry = sealEntryForFile({
        runId: input.runId,
        owner,
        family: null,
        kind: "core",
        relativePath,
        bytes,
      });
      if (entry === undefined) return yield* Effect.fail(migrationInvalid("niceeval.core"));
      entries.push(entry);
    }

    const sealJson = parseJson(input.sourceSealBytes);
    if (sealJson === undefined) return yield* Effect.fail(migrationInvalid("niceeval.core"));
    const current = decodeSealManifestDocument(sealJson);
    const legacy = Either.isLeft(current) ? decodeLegacySealManifestDocument(sealJson) : undefined;
    const source = Either.isRight(current)
      ? current.right
      : legacy !== undefined && Either.isRight(legacy)
      ? legacy.right
      : undefined;
    if (source === undefined || source.runId !== input.runId) {
      return yield* Effect.fail(migrationInvalid("niceeval.core"));
    }
    const declaredCore = source.entries.filter((entry) => entry.kind === "core")
      .sort((left, right) => compareCanonicalIdentity(left.path, right.path));
    const expectedCore = [...entries].sort((left, right) =>
      compareCanonicalIdentity(left.path, right.path)
    );
    if (
      declaredCore.length !== expectedCore.length ||
      declaredCore.some((entry, index) => {
        const expected = expectedCore[index];
        return expected === undefined ||
          entry.path !== expected.path ||
          entry.owner !== expected.owner ||
          entry.family !== null ||
          entry.byteLength !== expected.byteLength ||
          entry.sha256 !== expected.sha256;
      })
    ) return yield* Effect.fail(migrationInvalid("niceeval.core"));
    return Object.freeze({ core, entries: Object.freeze(entries) });
  });
}

function planMigrationRun(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runId: RunId;
  readonly attachments: readonly PlannedMigrationAttachment[];
}): Effect.Effect<PlannedMigrationRun, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const sealPath = runPath(input.root, input.runId, "seal-manifest.json");
    const sourceSealBytes = yield* readMigrationBytes({
      fileSystem: input.fileSystem,
      path: sealPath,
      maximumBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
      family: "niceeval.core",
    });
    const plannedCore = yield* planRunCore({
      fileSystem: input.fileSystem,
      root: input.root,
      runId: input.runId,
      sourceSealBytes,
    });
    const entries: SealManifestEntry[] = [...plannedCore.entries];
    for (const attachment of input.attachments) {
      const owner = attachment.location.owner === "run"
        ? "run"
        : attachment.location.attemptId!;
      const base = migrationRunRelativeBase(attachment.location);
      const envelope = attachment.finalState.envelope;
      if (envelope === undefined) return yield* Effect.fail(migrationInvalid(attachment.location.descriptor.family));
      const physical = yield* finalAttachmentFiles(input.root, attachment);
      for (const file of physical) {
        const suffix = file.path.segments.slice(
          migrationAttachmentDirectory(input.root, attachment.location).segments.length,
        ).join("/");
        const kind: SealManifestEntry["kind"] = suffix === "attachment.json"
          ? "attachment-envelope"
          : suffix.startsWith("payload/")
          ? "payload"
          : "blob";
        const entry = sealEntryForFile({
          runId: input.runId,
          owner,
          family: attachment.location.descriptor.family,
          kind,
          relativePath: base + "/" + suffix,
          bytes: file.bytes,
        });
        if (entry === undefined) {
          return yield* Effect.fail(migrationInvalid(attachment.location.descriptor.family));
        }
        entries.push(entry);
      }
    }
    entries.sort((left, right) => compareCanonicalIdentity(left.path, right.path));
    const document: SealManifestDocument = Object.freeze({
      format: SEAL_MANIFEST_FORMAT,
      runId: input.runId,
      entries: Object.freeze(entries),
    });
    const encoded = encodeSealManifestDocument(document);
    if (Either.isLeft(encoded)) return yield* Effect.fail(migrationInvalid("niceeval.core"));
    const targetSealBytes = jsonBytes(encoded.right);
    return Object.freeze({
      runId: input.runId,
      sourceSealBytes,
      targetSealBytes,
      targetSeal: document,
      core: plannedCore.core,
      replaceSeal: !bytesEqual(sourceSealBytes, targetSealBytes),
    });
  });
}

function migrationFingerprint(input: Omit<InternalMigrationPlan, "fingerprint">): string {
  const value = {
    sourceFormat: input.sourceFormat,
    rootSource: sha256Bytes(input.rootSourceBytes),
    rootTarget: sha256Bytes(input.rootTargetBytes),
    attachments: input.attachments.map((attachment) => ({
      key: migrationLocationKey(attachment.location),
      shape: attachment.initialShape,
      initial: attachment.initialFiles.map((file) => [
        file.path.segments.join("/"),
        sha256Bytes(file.bytes),
      ]),
      steps: attachment.steps.map((step) => [
        step.target.fromRevision,
        step.target.toRevision,
        sha256Bytes(step.sourceEnvelopeBytes),
        sha256Bytes(step.targetEnvelopeBytes),
        sha256Bytes(step.payloadBytes),
        step.contents.map((content) => [content.key, content.sha256, content.bytes.byteLength]),
      ]),
      cleanup: attachment.cleanupRequired,
    })),
    runs: input.runs.map((run) => [
      run.runId,
      sha256Bytes(run.sourceSealBytes),
      sha256Bytes(run.targetSealBytes),
    ]),
  };
  return sha256Bytes(new TextEncoder().encode(JSON.stringify(value)));
}

function buildMigrationPlan(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly attachmentCatalog: RecordFamilyDescriptorCatalog;
}): Effect.Effect<RecordMigrationPlan, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const format = yield* readRecordFormatForMaintenance(input.fileSystem, input.root);
    const locations = yield* readKnownAttachmentLocations({
      fileSystem: input.fileSystem,
      root: input.root,
      catalog: input.attachmentCatalog,
    });
    const attachments: PlannedMigrationAttachment[] = [];
    for (const location of locations) {
      attachments.push(yield* planMigrationAttachment({
        fileSystem: input.fileSystem,
        root: input.root,
        location,
        catalog: input.attachmentCatalog,
      }));
    }

    const runsById = new Map<RunId, PlannedMigrationAttachment[]>();
    for (const attachment of attachments) {
      const bucket = runsById.get(attachment.location.runId) ?? [];
      bucket.push(attachment);
      runsById.set(attachment.location.runId, bucket);
    }
    const runs: PlannedMigrationRun[] = [];
    const runEntries = yield* input.fileSystem.listDirectory({
      directory: recordPortablePath(input.root, "runs"),
      maximumEntries: MAXIMUM_RUN_ENTRIES,
    });
    for (const entry of runEntries) {
      if (entry.kind !== "directory") continue;
      const runId = decodeRunId(entry.name);
      if (runId === undefined || !(yield* input.fileSystem.isCompleteMarker({ root: input.root, runId }))) {
        continue;
      }
      runs.push(yield* planMigrationRun({
        fileSystem: input.fileSystem,
        root: input.root,
        runId,
        attachments: Object.freeze(runsById.get(runId) ?? []),
      }));
    }
    runs.sort((left, right) => compareCanonicalIdentity(left.runId, right.runId));

    const aggregate: RecordCore = Object.freeze({
      record: format.document,
      runs: Object.freeze(runs.map((run) => run.core)),
    });
    if (Either.isLeft(encodeRecordCore(aggregate))) {
      return yield* Effect.fail(migrationInvalid("niceeval.core"));
    }
    const encodedRoot = encodeRecordDocument(format.document);
    if (Either.isLeft(encodedRoot)) return yield* Effect.fail(migrationInvalid("niceeval.core"));
    const rootTargetBytes = jsonBytes(encodedRoot.right);
    const skipped = attachments.filter((attachment) => attachment.steps.length === 0).length;
    const base = {
      sourceFormat: format.sourceFormat,
      rootSourceBytes: format.sourceBytes,
      rootTargetBytes,
      attachments: Object.freeze(attachments),
      runs: Object.freeze(runs),
      skipped,
    };
    const internal: InternalMigrationPlan = Object.freeze({
      ...base,
      fingerprint: migrationFingerprint(base),
    });
    const targets = Object.freeze(attachments.flatMap((attachment) =>
      attachment.steps.map((step) => step.target)
    ));
    const pendingSeals = Object.freeze(runs.filter((run) => run.replaceSeal).map((run) => run.runId));
    const requiresMigration =
      format.sourceFormat !== RECORD_FORMAT ||
      targets.length > 0 ||
      pendingSeals.length > 0 ||
      attachments.some((attachment) => attachment.cleanupRequired);
    if (!requiresMigration) {
      const plan = Object.freeze({
        state: "already-current" as const,
        format: RECORD_FORMAT,
      });
      migrationPlanInternals.set(plan, internal);
      return plan;
    }
    const plan = Object.freeze({
      state: "migration-required" as const,
      format: RECORD_FORMAT,
      sourceFormat: format.sourceFormat,
      attachments: targets,
      pendingSeals,
      resumedSteps: skipped,
    });
    migrationPlanInternals.set(plan, internal);
    return plan;
  });
}

function sameMigrationPlan(left: RecordMigrationPlan, right: RecordMigrationPlan): boolean {
  const leftInternal = migrationPlanInternals.get(left);
  const rightInternal = migrationPlanInternals.get(right);
  return left.state === right.state &&
    leftInternal !== undefined &&
    rightInternal !== undefined &&
    leftInternal.fingerprint === rightInternal.fingerprint;
}

function verifyMigrationPlanSources(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly plan: InternalMigrationPlan;
}): Effect.Effect<void, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const root = yield* input.fileSystem.readFile({
      file: recordPortablePath(input.root, "record.json"),
      maximumBytes: RECORD_FORMAT_DOCUMENT_MAXIMUM_BYTES,
    });
    if (root === undefined || !bytesEqual(root, input.plan.rootSourceBytes)) {
      return yield* Effect.fail(migrationPlanStale());
    }
    for (const run of input.plan.runs) {
      const seal = yield* input.fileSystem.readFile({
        file: runPath(input.root, run.runId, "seal-manifest.json"),
        maximumBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
      });
      if (seal === undefined || !bytesEqual(seal, run.sourceSealBytes)) {
        return yield* Effect.fail(migrationPlanStale());
      }
    }
    for (const attachment of input.plan.attachments) {
      const shape = yield* scanAttachmentShape({
        fileSystem: input.fileSystem,
        root: input.root,
        location: attachment.location,
      });
      if (
        !sameOrderedStrings(shape.files, attachment.initialShape.files) ||
        !sameOrderedStrings(shape.directories, attachment.initialShape.directories)
      ) return yield* Effect.fail(migrationPlanStale());
      for (const snapshot of attachment.initialFiles) {
        const bytes = yield* input.fileSystem.readFile({
          file: snapshot.path,
          maximumBytes: snapshot.maximumBytes,
        });
        if (bytes === undefined || !bytesEqual(bytes, snapshot.bytes)) {
          return yield* Effect.fail(migrationPlanStale());
        }
      }
    }
  });
}

function writeImmutableMigrationFile(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly path: RecordPortablePath;
  readonly bytes: Uint8Array;
  readonly maximumBytes: number;
  readonly family: string;
}): Effect.Effect<void, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const kind = yield* input.fileSystem.pathKind(input.path);
    if (kind === "file") {
      const existing = yield* input.fileSystem.readFile({
        file: input.path,
        maximumBytes: input.maximumBytes,
      });
      if (existing === undefined || !bytesEqual(existing, input.bytes)) {
        return yield* Effect.fail(migrationInvalid(input.family));
      }
      return;
    }
    if (kind !== "missing") return yield* Effect.fail(migrationInvalid(input.family));
    yield* input.fileSystem.writeFile({
      file: input.path,
      bytes: input.bytes,
      maximumBytes: input.maximumBytes,
      mode: "exclusive",
    }).pipe(
      Effect.catchTag("RecordPathAlreadyExists", () =>
        input.fileSystem.readFile({
          file: input.path,
          maximumBytes: input.maximumBytes,
        }).pipe(
          Effect.flatMap((existing) =>
            existing !== undefined && bytesEqual(existing, input.bytes)
              ? Effect.void
              : Effect.fail(migrationInvalid(input.family))
          ),
        )
      ),
    );
  });
}

function applyMigrationStep(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly step: PlannedMigrationStep;
}): Effect.Effect<void, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const family = input.step.location.descriptor.family;
    const envelopePath = migrationPath(input.root, input.step.location, "attachment.json");
    const source = yield* input.fileSystem.readFile({
      file: envelopePath,
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
    });
    if (source === undefined || !bytesEqual(source, input.step.sourceEnvelopeBytes)) {
      return yield* Effect.fail(migrationPlanStale());
    }
    const payloadDigest = input.step.targetEnvelope.payload.sha256;
    yield* writeImmutableMigrationFile({
      fileSystem: input.fileSystem,
      path: migrationPath(
        input.root,
        input.step.location,
        "payload",
        "sha256",
        payloadDigest,
      ),
      bytes: input.step.payloadBytes,
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
      family,
    });
    const physical = new Map<Sha256Digest, Uint8Array>();
    for (const content of input.step.contents) physical.set(content.sha256, content.bytes);
    for (const [digest, bytes] of physical) {
      yield* writeImmutableMigrationFile({
        fileSystem: input.fileSystem,
        path: migrationPath(
          input.root,
          input.step.location,
          "content",
          "sha256",
          digest,
        ),
        bytes,
        maximumBytes: MAXIMUM_ATTACHMENT_BLOB_BYTES,
        family,
      });
    }
    yield* input.fileSystem.replaceFileAtomic({
      file: envelopePath,
      bytes: input.step.targetEnvelopeBytes,
      maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
    });
  });
}

function cleanupMigratedAttachment(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly attachment: PlannedMigrationAttachment;
}): Effect.Effect<void, RecordMaintenanceError> {
  return Effect.gen(function* () {
    for (const file of input.attachment.orphanFiles) {
      yield* input.fileSystem.removeFile(file);
    }
    for (const directory of input.attachment.orphanDirectories) {
      yield* input.fileSystem.removeEmptyDirectory(directory);
    }
  });
}

function validateAppliedMigration(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly catalog: RecordFamilyDescriptorCatalog;
}): Effect.Effect<void, RecordMaintenanceError> {
  return Effect.gen(function* () {
    const current = yield* readCurrentRecordFormat(input.fileSystem, input.root);
    const snapshot = yield* loadSealedCoreSnapshot(
      maintenanceReaderRuntime(input.root, current.document, input.catalog),
      input.fileSystem,
      { fullAttachmentHashes: true, strictSources: true },
    );
    if (snapshot.state !== "available") return yield* Effect.fail(migrationInvalid("niceeval.core"));
  });
}

function openMaintenance(input: {
  readonly root: RecordRoot;
}, attachmentCatalog: RecordFamilyDescriptorCatalog): Effect.Effect<
  RecordMaintenanceSession,
  RecordMaintenanceOpenError,
  import("effect").Scope.Scope | RecordFileSystem | RecordCoordination
> {
  return Effect.gen(function* () {
    const coordination = yield* RecordCoordination;
    const fileSystem = yield* RecordFileSystem;
    yield* coordination.enterRecordMaintenance(input.root);
    let format = yield* readRecordFormatForMaintenance(fileSystem, input.root);
    const pendingPublishRecovery = yield* fileSystem.listRunPublishRecoveries({
      root: input.root,
      maximumEntries: MAXIMUM_PUBLISH_RECOVERIES,
      maximumManifestBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
    });
    if (pendingPublishRecovery.length > 0) {
      if (format.sourceFormat !== RECORD_FORMAT) {
        return yield* Effect.fail(migrationInvalid("run-publication-recovery"));
      }
      yield* coordination.verifyRecordIdentity({
        root: input.root,
        recordId: format.document.recordId,
      });
      yield* recoverRunPublications({
        fileSystem,
        root: input.root,
        record: format.document,
        attachmentCatalog,
      });
      format = yield* readRecordFormatForMaintenance(fileSystem, input.root);
    }
    yield* coordination.verifyRecordIdentity({
      root: input.root,
      recordId: format.document.recordId,
    });

    const planMigrate = () => buildMigrationPlan({
      fileSystem,
      root: input.root,
      attachmentCatalog,
    });
    const inspect = () => planMigrate().pipe(
      Effect.map((plan): RecordFormatInspection => plan.state === "already-current"
        ? Object.freeze({ state: "already-current" as const, format: RECORD_FORMAT })
        : plan.state === "migration-required"
        ? Object.freeze({ state: "migration-required" as const, format: RECORD_FORMAT })
        : Object.freeze({ state: "unsupported-format" as const, format: plan.format })),
    );
    return Object.freeze({
      inspect,
      planMigrate,
      applyMigrate: (plan: RecordMigrationPlan): Effect.Effect<RecordMigrationReceipt, RecordMaintenanceError> =>
        Effect.gen(function* () {
          const fresh = yield* planMigrate();
          if (!sameMigrationPlan(plan, fresh)) return yield* Effect.fail(migrationPlanStale());
          if (fresh.state === "already-current") {
            return Object.freeze({ state: "already-current" as const, format: RECORD_FORMAT });
          }
          if (fresh.state === "unsupported-format") {
            return yield* Effect.fail(new RecordFormatUnsupported({
              code: "record-format-unsupported",
              format: fresh.format,
            }));
          }
          const internal = migrationPlanInternals.get(fresh);
          if (internal === undefined) return yield* Effect.fail(migrationPlanStale());
          yield* verifyMigrationPlanSources({
            fileSystem,
            root: input.root,
            plan: internal,
          });
          for (const attachment of internal.attachments) {
            for (const step of attachment.steps) {
              yield* applyMigrationStep({
                fileSystem,
                root: input.root,
                step,
              });
            }
          }
          const rebuiltSeals: RunId[] = [];
          for (const run of internal.runs) {
            if (!run.replaceSeal) continue;
            const current = yield* fileSystem.readFile({
              file: runPath(input.root, run.runId, "seal-manifest.json"),
              maximumBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
            });
            if (current === undefined || !bytesEqual(current, run.sourceSealBytes)) {
              return yield* Effect.fail(migrationPlanStale());
            }
            yield* fileSystem.replaceFileAtomic({
              file: runPath(input.root, run.runId, "seal-manifest.json"),
              bytes: run.targetSealBytes,
              maximumBytes: MAXIMUM_SEAL_MANIFEST_BYTES,
            });
            rebuiltSeals.push(run.runId);
          }
          if (!bytesEqual(internal.rootSourceBytes, internal.rootTargetBytes)) {
            const currentRoot = yield* fileSystem.readFile({
              file: recordPortablePath(input.root, "record.json"),
              maximumBytes: RECORD_FORMAT_DOCUMENT_MAXIMUM_BYTES,
            });
            if (currentRoot === undefined || !bytesEqual(currentRoot, internal.rootSourceBytes)) {
              return yield* Effect.fail(migrationPlanStale());
            }
            yield* fileSystem.replaceFileAtomic({
              file: recordPortablePath(input.root, "record.json"),
              bytes: internal.rootTargetBytes,
              maximumBytes: RECORD_FORMAT_DOCUMENT_MAXIMUM_BYTES,
            });
          }
          // Keep old physical files recoverable until every authoritative seal
          // and the root publication point at the new closure.
          for (const attachment of internal.attachments) {
            yield* cleanupMigratedAttachment({ fileSystem, attachment });
          }
          yield* validateAppliedMigration({
            fileSystem,
            root: input.root,
            catalog: attachmentCatalog,
          });
          return Object.freeze({
            state: "migrated" as const,
            format: RECORD_FORMAT,
            attachments: fresh.attachments,
            committed: fresh.attachments.length,
            skipped: internal.skipped,
            failed: 0,
            rebuiltSeals: Object.freeze(rebuiltSeals),
          });
        }),
    });
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
  if (error instanceof RecordMigrationPlanStale) {
    return Object.freeze({
      _tag: "RecordMigrationPlanStale" as const,
      code: "record-migration-plan-stale" as const,
    });
  }
  if (error instanceof RecordMigrationInvalid) {
    return Object.freeze({
      _tag: "RecordMigrationInvalid" as const,
      code: "record-migration-invalid" as const,
      family: error.family,
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

const migrateOperationPlans = new WeakMap<RecordMigrateReadyPlan, {
  readonly plan: RecordMigrationPlan;
  readonly attachmentCatalog: RecordFamilyDescriptorCatalog;
}>();

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

function planMigrateOperation(
  input: { readonly root: RecordRoot },
  attachmentCatalog: RecordFamilyDescriptorCatalog,
) {
  return Effect.scoped(Effect.gen(function* () {
    const session = yield* openMaintenance(input, attachmentCatalog);
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
    const closed = Object.freeze({
      _tag: "RecordMigrationReady" as const,
      format: plan.format,
      sourceFormat: plan.sourceFormat,
      attachments: plan.attachments,
      pendingSeals: plan.pendingSeals,
      resumedSteps: plan.resumedSteps,
    });
    migrateOperationPlans.set(closed, Object.freeze({ plan, attachmentCatalog }));
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
}, attachmentCatalog: RecordFamilyDescriptorCatalog) {
  const source = migrateOperationPlans.get(input.plan);
  if (source === undefined || source.attachmentCatalog !== attachmentCatalog) {
    return Effect.fail(Object.freeze({
      _tag: "RecordMigrationPlanStale" as const,
      code: "record-migration-plan-stale" as const,
    }));
  }
  return Effect.scoped(Effect.gen(function* () {
    const session = yield* openMaintenance({ root: input.root }, attachmentCatalog);
    const receipt = yield* session.applyMigrate(source.plan);
    return receipt.state === "already-current"
      ? Object.freeze({
          _tag: "RecordMigrationAlreadyCurrent" as const,
          format: receipt.format,
        })
      : Object.freeze({
          _tag: "RecordMigrationApplied" as const,
          format: receipt.format,
          attachments: receipt.attachments,
          committed: receipt.committed,
          skipped: receipt.skipped,
          failed: receipt.failed,
          rebuiltSeals: receipt.rebuiltSeals,
        });
  })).pipe(Effect.mapError(closeMaintenanceFailure));
}

/** Bind one immutable, explicitly composed Attachment catalog to all sessions. */
export function makeRecordHost(input: {
  readonly records: readonly RecordContribution[];
}): RecordHostSDK {
  const persistences = input.records.map((record) => {
    const runtime = recordContributionRuntime(record);
    if (runtime === undefined) {
      throw new TypeError("makeRecordHost rejected an invalid Record contribution");
    }
    return runtime.persistence;
  });
  const composed = makeRecordAttachmentCatalog(persistences);
  if (Either.isLeft(composed)) {
    throw new TypeError(`makeRecordHost rejected Attachment composition: ${composed.left.code}`);
  }
  const attachmentCatalog = composed.right;
  return Object.freeze({
    current: Object.freeze({
      openRead: (request: { readonly root: RecordRoot }) =>
        openCurrentRead({ ...request, attachmentCatalog }),
      createRun: (request: CreateRunRequest) => openNewRun(request, attachmentCatalog),
      createReferenceRun: (request: CreateReferenceRunRequest) =>
        openNewReferenceRun(request, attachmentCatalog),
    }),
    maintenance: Object.freeze({
      planClean: planCleanOperation,
      applyClean: applyCleanOperation,
      planMigrate: (request: { readonly root: RecordRoot }) =>
        planMigrateOperation(request, attachmentCatalog),
      applyMigrate: (request: {
        readonly root: RecordRoot;
        readonly plan: RecordMigrateReadyPlan;
      }) => applyMigrateOperation(request, attachmentCatalog),
      open: (request: { readonly root: RecordRoot }) =>
        openMaintenance(request, attachmentCatalog),
    }),
  });
}

export const recordHost: RecordHostSDK = makeRecordHost({
  records: (NiceEvalRecordAttachmentPersistences as readonly AnyRecordAttachmentPersistence[]).map(
    (persistence) => recordContributionFromAttachmentPersistence(persistence),
  ),
});
