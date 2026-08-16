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
  RecordFormatSchema,
  RecordIdSchema,
  RunIdSchema,
  SlotIdSchema,
  decodeAttemptDocument,
  decodeMemberDocument,
  decodeRunDocument,
  encodeAttemptDocument,
  encodeMemberDocument,
  encodeRecordDocument,
  encodeRecordCore,
  encodeRunDocument,
  RecordExactParseOptions,
} from "../codec/index.ts";
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
  NiceEvalRecordFamilyCatalog,
  type FixedRecordFamilyDescriptor,
  type NiceEvalFamily,
} from "../family/catalog.ts";
import {
  observabilitySourceFrameIntegrityIssues,
  type AttemptObservabilityAttachment,
  type ObservabilityAttachment,
} from "../family/observability.ts";
import {
  assertionsSourceSiteIntegrityIssues,
  type AssertionsAttachment,
} from "../family/assertions.ts";
import {
  sourceNavigationIntegrityIssues,
  type SourceNavigationAttachment,
} from "../family/source-navigation.ts";
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
  RECORD_SCHEMA_VERSION,
  compareCanonicalIdentity,
  isPortableSegment,
  type AttemptId,
  type RecordId,
  type RunId,
  type SlotId,
} from "../model/identifiers.ts";
import type {
  RecordCoreRead,
  RecordWarning,
} from "../model/read-state.ts";
import {
  RecordPathAlreadyExists,
  RecordPathTypeInvalid,
  type RecordFileSystemError,
} from "../platform/errors.ts";
import { recordRootPaths, type RecordRoot } from "../platform/root.ts";
import {
  RecordEntropy,
  RecordFileSystem,
  recordPortablePath,
  type RecordDirectoryEntry,
  type RecordEntropyService,
  type RecordFileSystemService,
} from "../platform/services.ts";
import {
  RecordBootstrapInvalid,
  RecordFormatUnsupported,
  RecordHandleInvalid,
  RecordMigrationInterruptedState,
  RecordReaderClosed,
  type RecordReaderOpenError,
  type RecordReaderReadError,
} from "../reader/errors.ts";
import {
  RECORD_FORMAT_DOCUMENT_MAXIMUM_BYTES,
  readCurrentRecordFormat,
} from "../reader/format.ts";
import { readFixedRecordAttachment } from "../reader/runtime.ts";
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
  attemptWriteSessionBrand,
  runWriteSessionBrand,
  selectedAttemptRefBrand,
  selectedOwnerRefBrand,
  selectedRunRefBrand,
  type AttemptWriteSession,
  type AttemptArtifactsWrite,
  type AttemptObservabilityWrite,
  type AssertionsWrite,
  type CreateReferenceRunRequest,
  type CreateRunRequest,
  type FileChangesWrite,
  type FixedFamilyRead,
  type ReadableAttempt,
  type ReadableRun,
  type RecordFormatInspection,
  type RecordHostSDK,
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
  type RunObservabilityWrite,
  type RunWriteSession,
  type SelectedAttemptRef,
  type SelectedOwnerRef,
  type SelectedRunRef,
  type SourcesWrite,
  type SourceNavigationWrite,
} from "./types.ts";

const MAXIMUM_RUN_ENTRIES = 100_000;
const MAXIMUM_ATTEMPT_ENTRIES = 100_000;
const MAXIMUM_CORE_BYTES = 1024 * 1024;
const ENTROPY_RETRY_LIMIT = 16;
const MAXIMUM_ATTACHMENT_BLOB_BYTES = 64 * 1024 * 1024;

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
  readonly base: ReturnType<typeof recordPortablePath>;
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

function readerClosed(): RecordReaderClosed {
  return new RecordReaderClosed({ code: "record-reader-closed" });
}

function handleInvalid(): RecordHandleInvalid {
  return new RecordHandleInvalid({ code: "record-handle-invalid" });
}

function migrationInterrupted(): RecordMigrationInterruptedState {
  return new RecordMigrationInterruptedState({
    code: "record-migration-interrupted",
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
): Effect.Effect<RecordFormatInspection, RecordReaderOpenError> {
  return readCurrentRecordFormat(fileSystem, root).pipe(
    Effect.map(() => ({
      state: "already-current" as const,
      format: RECORD_FORMAT,
    })),
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

function isSealedRun(
  fileSystem: RecordFileSystemService,
  root: RecordRoot,
  runId: RunId,
): Effect.Effect<boolean, RecordFileSystemError> {
  return Effect.map(
    fileSystem.pathKind(runPath(root, runId, "complete")),
    (kind) => kind === "file",
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

/**
 * The reader deliberately reconstructs the complete published aggregate only
 * at the point where it is about to sign a Run/Attempt as available. This is
 * the same `RecordCoreDefinition` refine used by the writer's seal boundary,
 * so a marker cannot promote a partial Member denominator to availability.
 */
function loadSealedCoreSnapshot(
  runtime: ReaderRuntime,
  fileSystem: RecordFileSystemService,
): Effect.Effect<SealedCoreSnapshot, RecordFileSystemError> {
  return Effect.gen(function* () {
    const entries = orderedEntries(yield* fileSystem.listDirectory({
      directory: recordPath(runtime.root, "runs"),
      maximumEntries: MAXIMUM_RUN_ENTRIES,
    }));
    const cores: RunCore[] = [];
    for (const entry of entries) {
      if (entry.kind !== "directory") continue;
      const runId = decodeRunId(entry.name);
      if (runId === undefined || !(yield* isSealedRun(fileSystem, runtime.root, runId))) {
        continue;
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
    const entries = orderedEntries(
      yield* fileSystem.listDirectory({
        directory: recordPath(runtime.root, "runs"),
        maximumEntries: MAXIMUM_RUN_ENTRIES,
      }),
    );
    const snapshot = yield* readSealedCoreSnapshot(runtime, fileSystem);
    const found = new Set<RunId>();
    const warnings: RecordWarning[] = [];
    const problems: RecordSelectionProblem[] = [];
    const documents: RunDocument[] = [];

    for (const entry of entries) {
      if (entry.kind !== "directory") continue;
      const runId = decodeRunId(entry.name);
      if (runId === undefined) continue;
      found.add(runId);
      const sealed = yield* isSealedRun(fileSystem, runtime.root, runId);
      if (!sealed) {
        warnings.push(Object.freeze({
          code: "incomplete-run" as const,
          runId,
          cleanupCommand: "niceeval clean" as const,
        }));
        if (wanted?.has(runId)) {
          problems.push(Object.freeze({ code: "incomplete-run" as const, runId }));
        }
        continue;
      }
      if (wanted !== undefined && !wanted.has(runId)) continue;
      const core = snapshot.state === "available" ? snapshot.byRunId.get(runId) : undefined;
      if (core === undefined) {
        problems.push(Object.freeze({ code: "record-core-invalid" as const, runId }));
      } else {
        documents.push(core.run);
      }
    }

    if (wanted !== undefined) {
      for (const runId of wanted) {
        if (!found.has(runId)) {
          problems.push(Object.freeze({ code: "selection-run-missing" as const, runId }));
        }
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
    if (owner.kind === "run") {
      const descriptor = input.descriptor as FixedRecordFamilyDescriptor<Family, "run", Payload>;
      return readFixedRecordAttachment({
        fileSystem: input.fileSystem,
        root: input.runtime.root,
        location: Object.freeze({ owner: "run" as const, runId: owner.runId }),
        descriptor,
      }).pipe(Effect.flatMap((value): Effect.Effect<FixedFamilyRead<Payload>, RecordFileSystemError> => {
        if (value.state !== "available") {
          return Effect.succeed(value.state === "unavailable"
            ? Object.freeze({ state: "not-recorded" as const })
            : value);
        }
        return validateFixedCrossFamilyJoin({
          fileSystem: input.fileSystem,
          root: input.runtime.root,
          runId: owner.runId,
          descriptor: descriptor as FixedRecordFamilyDescriptor<NiceEvalFamily, RecordAttachmentOwner, unknown>,
          payload: value.value,
        }).pipe(Effect.map((joined): FixedFamilyRead<Payload> =>
          joined
            ? value
            : Object.freeze({ state: "invalid" as const, issues: coreInvalid().issues })),
        );
      }));
    }
    const descriptor = input.descriptor as FixedRecordFamilyDescriptor<Family, "attempt", Payload>;
    return readFixedRecordAttachment({
      fileSystem: input.fileSystem,
      root: input.runtime.root,
      location: Object.freeze({
        owner: "attempt" as const,
        runId: owner.ref.originRunId,
        attemptId: owner.ref.attemptId,
      }),
      descriptor,
    }).pipe(Effect.flatMap((value): Effect.Effect<FixedFamilyRead<Payload>, RecordFileSystemError> => {
      if (value.state !== "available") {
        return Effect.succeed(value.state === "unavailable"
          ? Object.freeze({ state: "not-recorded" as const })
          : value);
      }
      return validateFixedCrossFamilyJoin({
        fileSystem: input.fileSystem,
        root: input.runtime.root,
        runId: owner.ref.originRunId,
        attemptId: owner.ref.attemptId,
        descriptor: descriptor as FixedRecordFamilyDescriptor<NiceEvalFamily, RecordAttachmentOwner, unknown>,
        payload: value.value,
      }).pipe(Effect.map((joined): FixedFamilyRead<Payload> =>
        joined
          ? value
          : Object.freeze({ state: "invalid" as const, issues: coreInvalid().issues })),
      );
    }));
  });
}

function isObservabilityDescriptor(
  descriptor: FixedRecordFamilyDescriptor<
    NiceEvalFamily,
    RecordAttachmentOwner,
    unknown
  >,
): boolean {
  return descriptor === NiceEvalRecordFamilyCatalog.observability.attempt ||
    descriptor === NiceEvalRecordFamilyCatalog.observability.run;
}

function isAssertionsDescriptor(
  descriptor: FixedRecordFamilyDescriptor<NiceEvalFamily, RecordAttachmentOwner, unknown>,
): boolean {
  return descriptor === NiceEvalRecordFamilyCatalog.assertions;
}

function isSourceNavigationDescriptor(
  descriptor: FixedRecordFamilyDescriptor<NiceEvalFamily, RecordAttachmentOwner, unknown>,
): boolean {
  return descriptor === NiceEvalRecordFamilyCatalog.sourceNavigation;
}

function hasSourceFrames(payload: ObservabilityAttachment): boolean {
  return payload.diagnostics.diagnostics.some((diagnostic) => diagnostic.sourceFrame !== null);
}

/** Common cross-family closure boundary used by both reader and writer seal. */
function validateObservabilitySourceFrameJoin(input: {
  readonly fileSystem: RecordFileSystemService;
  readonly root: RecordRoot;
  readonly runId: RunId;
  readonly payload: ObservabilityAttachment;
}): Effect.Effect<boolean, RecordFileSystemError> {
  return Effect.gen(function* () {
    if (!hasSourceFrames(input.payload)) return true;
    const sources = yield* readFixedRecordAttachment({
      fileSystem: input.fileSystem,
      root: input.root,
      location: Object.freeze({ owner: "run" as const, runId: input.runId }),
      descriptor: NiceEvalRecordFamilyCatalog.sources,
    });
    if (sources.state !== "available") return false;
    return observabilitySourceFrameIntegrityIssues(
      input.payload,
      sources.value as SourcesAttachment,
    ).length === 0;
  });
}

function hasMappedNavigationRows(payload: SourceNavigationAttachment): boolean {
  return payload.rows.some((row) => row.source.state === "mapped");
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
}): Effect.Effect<boolean, RecordFileSystemError> {
  if (isObservabilityDescriptor(input.descriptor)) {
    return validateObservabilitySourceFrameJoin({
      fileSystem: input.fileSystem,
      root: input.root,
      runId: input.runId,
      payload: input.payload as ObservabilityAttachment,
    });
  }
  if (isAssertionsDescriptor(input.descriptor)) {
    const payload = input.payload as AssertionsAttachment;
    if (payload.sourceSites.length === 0) return Effect.succeed(true);
    return Effect.gen(function* () {
      const sources = yield* readFixedRecordAttachment({
        fileSystem: input.fileSystem,
        root: input.root,
        location: Object.freeze({ owner: "run" as const, runId: input.runId }),
        descriptor: NiceEvalRecordFamilyCatalog.sources,
      });
      return sources.state === "available" &&
        assertionsSourceSiteIntegrityIssues(payload, sources.value as SourcesAttachment).length === 0;
    });
  }
  if (isSourceNavigationDescriptor(input.descriptor)) {
    const payload = input.payload as SourceNavigationAttachment;
    if (input.attemptId === undefined) return Effect.succeed(false);
    return Effect.gen(function* () {
      const observability = yield* readFixedRecordAttachment({
        fileSystem: input.fileSystem,
        root: input.root,
        location: Object.freeze({
          owner: "attempt" as const,
          runId: input.runId,
          attemptId: input.attemptId!,
        }),
        descriptor: NiceEvalRecordFamilyCatalog.observability.attempt,
      });
      if (observability.state !== "available") return false;
      const sources = hasMappedNavigationRows(payload)
        ? yield* readFixedRecordAttachment({
            fileSystem: input.fileSystem,
            root: input.root,
            location: Object.freeze({ owner: "run" as const, runId: input.runId }),
            descriptor: NiceEvalRecordFamilyCatalog.sources,
          })
        : undefined;
      if (sources !== undefined && sources.state !== "available") return false;
      return sourceNavigationIntegrityIssues({
        payload,
        observability: observability.value as AttemptObservabilityAttachment,
        sources: sources?.state === "available" ? sources.value as SourcesAttachment : undefined,
      }).length === 0;
    });
  }
  return Effect.succeed(true);
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
        if (!(yield* isSealedRun(fileSystem, contents.root, exact.originRunId))) {
          return Object.freeze({ state: "missing" as const }) satisfies RecordCoreRead<ReadableAttempt>;
        }
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
    readAttemptObservability: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.observability.attempt,
      }),
    readFileChanges: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.fileChanges,
      }),
    readSourceNavigation: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.sourceNavigation,
      }),
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
    readRunObservability: (owner: SelectedOwnerRef) =>
      readFixedFamily({
        runtime,
        fileSystem,
        owner,
        descriptor: NiceEvalRecordFamilyCatalog.observability.run,
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
          schemaVersion: RECORD_SCHEMA_VERSION,
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
    yield* coordination.verifyRecordIdentity({ root: input.root, recordId: current.document.recordId });
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
      sealedCoreSnapshot: undefined,
    };
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

function createFreshRunDirectory(
  root: RecordRoot,
  fileSystem: RecordFileSystemService,
  entropy: RecordEntropyService,
  remaining = ENTROPY_RETRY_LIMIT,
): Effect.Effect<RunId, RecordWriteError> {
  return Effect.flatMap(mintRunId(entropy), (runId) =>
    fileSystem.createRunDirectory({ root, runId }).pipe(
      Effect.as(runId),
      Effect.catchAll((error) =>
        error instanceof RecordPathAlreadyExists && remaining > 0
          ? createFreshRunDirectory(root, fileSystem, entropy, remaining - 1)
          : Effect.fail(error),
      ),
    ),
  );
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
    run.fileSystem.ensureDirectory(runPath(run.root, run.runId, "attempts")).pipe(
      Effect.zipRight(
        run.fileSystem.createDirectory(runPath(run.root, run.runId, "attempts", attemptId)),
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
  readonly base: ReturnType<typeof recordPortablePath>;
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
          base: input.base,
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
        const attachmentRoot = recordPortablePath(
          input.base.root,
          ...input.base.segments,
          input.descriptor.family,
        );
        yield* input.run.fileSystem.ensureDirectory(input.base);
        yield* input.run.fileSystem.createDirectory(attachmentRoot);
        yield* input.run.fileSystem.writeFile({
          file: recordPortablePath(
            input.base.root,
            ...attachmentRoot.segments,
            "attachment.json",
          ),
          bytes: jsonBytes(encodedEnvelope.right),
          maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
          mode: "exclusive",
        });
        yield* input.run.fileSystem.writeFile({
          file: recordPortablePath(
            input.base.root,
            ...attachmentRoot.segments,
            "payload.json",
          ),
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
            return input.run.fileSystem.writeFileStream({
              file: recordPortablePath(
                input.base.root,
                ...attachmentRoot.segments,
                "blobs",
                key,
              ),
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
    const root = recordPortablePath(
      attachment.base.root,
      ...attachment.base.segments,
      attachment.name,
    );
    const blobs = recordPortablePath(
      attachment.base.root,
      ...root.segments,
      "blobs",
    );
    if ((yield* run.fileSystem.pathKind(blobs)) === "directory") {
      yield* run.fileSystem.syncDirectory(blobs);
    }
    yield* run.fileSystem.syncDirectory(root);
    yield* run.fileSystem.syncDirectory(attachment.base);
    const materialized = yield* readFixedRecordAttachment({
      fileSystem: run.fileSystem,
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
    if (!(yield* validateFixedCrossFamilyJoin({
      fileSystem: run.fileSystem,
      root: run.root,
      runId: run.runId,
      ...(attachment.owner === "attempt" ? { attemptId: attachment.attemptId } : {}),
      descriptor: attachment.descriptor,
      payload: materialized.value,
    }))) {
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
      const attemptDirectory = runPath(run.root, run.runId, "attempts", attempt.attemptId);
      if ((yield* run.fileSystem.pathKind(attemptDirectory)) === "directory") {
        yield* run.fileSystem.syncDirectory(attemptDirectory);
      }
    }
    const members = runPath(run.root, run.runId, "members");
    if ((yield* run.fileSystem.pathKind(members)) === "directory") {
      yield* run.fileSystem.syncDirectory(members);
    }
    const attempts = runPath(run.root, run.runId, "attempts");
    if ((yield* run.fileSystem.pathKind(attempts)) === "directory") {
      yield* run.fileSystem.syncDirectory(attempts);
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
    base: runPath(input.run.root, input.run.runId, "attachments"),
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
    base: runPath(
      input.attempt.draft.root,
      input.attempt.draft.runId,
      "attempts",
      input.attempt.attemptId,
      "attachments",
    ),
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
        yield* attempt.draft.fileSystem.writeFile({
          file: runPath(
            attempt.draft.root,
            attempt.draft.runId,
            "attempts",
            attempt.attemptId,
            "attempt.json",
          ),
          bytes: jsonBytes(encodedAttempt.right),
          maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
          mode: "exclusive",
        });
        yield* attempt.draft.fileSystem.writeFile({
          file: runPath(
            attempt.draft.root,
            attempt.draft.runId,
            "members",
            `${attempt.slotId}.json`,
          ),
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
    writeAttemptObservability<E, R>(
      value: AttemptObservabilityWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return attemptSessions.get(this) === attempt
        ? writeAttemptFamily({
            attempt,
            descriptor: NiceEvalRecordFamilyCatalog.observability.attempt,
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
    writeSourceNavigation<E, R>(
      value: SourceNavigationWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return attemptSessions.get(this) === attempt
        ? writeAttemptFamily({
            attempt,
            descriptor: NiceEvalRecordFamilyCatalog.sourceNavigation,
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
          yield* run.fileSystem.ensureDirectory(runPath(run.root, run.runId, "members"));
          yield* run.fileSystem.writeFile({
            file: runPath(run.root, run.runId, "members", `${input.slotId}.json`),
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
        yield* run.fileSystem.ensureDirectory(runPath(run.root, run.runId, "members"));
        yield* run.fileSystem.writeFile({
          file: runPath(run.root, run.runId, "members", `${input.slotId}.json`),
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
      yield* run.fileSystem.writeFile({
        file: runPath(run.root, run.runId, "run.json"),
        bytes: jsonBytes(encoded.right),
        maximumBytes: RECORD_JSON_MAXIMUM_BYTES,
        mode: "exclusive",
      });
      yield* Effect.uninterruptibleMask(() =>
        Effect.gen(function* () {
          yield* run.fileSystem.syncDirectory(runPath(run.root, run.runId));
          yield* run.fileSystem.createCompleteMarker({ root: run.root, runId: run.runId });
          yield* Effect.sync(() => {
            run.markerCreated = true;
            run.state = "published";
            consumeRunCapabilities(run);
          });
          yield* run.fileSystem.syncDirectory(runPath(run.root, run.runId));
          yield* run.fileSystem.syncDirectory(recordPath(run.root, "runs"));
        }),
      );
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
    writeRunObservability<E, R>(
      value: RunObservabilityWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return runSessions.get(this) === run
        ? writeRunFamily({
            run,
            descriptor: NiceEvalRecordFamilyCatalog.observability.run,
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
    writeRunObservability<E, R>(
      value: RunObservabilityWrite<E, R>,
    ): Effect.Effect<void, RecordWriteError | E, R> {
      return runSessions.get(this) === run
        ? writeRunFamily({
            run,
            descriptor: NiceEvalRecordFamilyCatalog.observability.run,
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
    // This must precede bootstrap as well as `createRunDirectory`: malformed
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
    yield* coordination.verifyRecordIdentity({ root: request.root, recordId: current.document.recordId });
    const runId = yield* createFreshRunDirectory(request.root, fileSystem, entropy);
    const mutex = yield* Effect.makeSemaphore(1);
    const runtime: RunRuntime = {
      root: request.root,
      fileSystem,
      entropy,
      record: current.document,
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

function openMaintenance(input: {
  readonly root: RecordRoot;
}): Effect.Effect<
  RecordMaintenanceSession,
  RecordReaderOpenError,
  import("effect").Scope.Scope | RecordFileSystem | RecordCoordination
> {
  return Effect.gen(function* () {
    const coordination = yield* RecordCoordination;
    const fileSystem = yield* RecordFileSystem;
    yield* coordination.enterRecordMaintenance(input.root);
    if (yield* fileSystem.migrationSentinelPresent(input.root)) {
      return yield* Effect.fail(migrationInterrupted());
    }
    const inspect = () => currentFormatInspection(fileSystem, input.root);
    return Object.freeze({
      inspect,
      planMigrate: () => Effect.map(inspect(), (inspection): RecordMigrationPlan =>
        inspection.state === "already-current"
          ? Object.freeze({ state: "already-current", format: inspection.format })
          : Object.freeze({ state: "unsupported-format", format: inspection.format }),
      ),
      applyMigrate: (plan: RecordMigrationPlan): Effect.Effect<RecordMigrationReceipt, RecordReaderOpenError> =>
        plan.state === "already-current" && plan.format === RECORD_FORMAT
          ? Effect.succeed(Object.freeze({ state: "already-current" as const, format: RECORD_FORMAT }))
          : Effect.fail(new RecordFormatUnsupported({
              code: "record-format-unsupported",
              format: plan.format,
            })),
    });
  });
}

export const recordHost: RecordHostSDK = Object.freeze({
  current: Object.freeze({
    openRead: openCurrentRead,
    createRun: openNewRun,
    createReferenceRun: openNewReferenceRun,
  }),
  maintenance: Object.freeze({ open: openMaintenance }),
});
