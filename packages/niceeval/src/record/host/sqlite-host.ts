import { createHash } from "node:crypto";
import { Effect, Result, Exit, Option, Queue, Schema, Semaphore, Stream } from "effect";
import { encodeAttemptLocator } from "../../attempt-locator.ts";
import { RecordCoordination, type RecordCoordinationService } from "../../coordination/record-leases.ts";
import { makeRecordAttachmentCatalog, type AnyRecordAttachmentPersistence, type RecordAttachmentCatalog, type RecordAttachmentDefinition, type RecordAttachmentPersistence } from "../attachment/index.ts";
import { enumerateRecordAttachmentClosure, hydrateRecordAttachmentCurrent, isRecordAttachmentSchema, mintRecordAttachmentReference, recordAttachmentReferenceWire, resolveRecordAttachmentDefinition, RecordAttachmentReference } from "../attachment/protocol.ts";
import { isRecordTextContentHandle, mintRecordContentHandle, type RecordContentHandle, type RecordTextContentHandle } from "../attachment/content.ts";
import { AttemptIdSchema, RecordFormatSchema, RecordIdSchema, RunIdSchema, Sha256DigestSchema } from "../codec/identifiers.ts";
import { decodeAttemptDocument, decodeMemberDocument, decodeRecordDocument, decodeRunDocument, encodeAttemptDocument, encodeMemberDocument, encodeRecordDocument, encodeRunDocument } from "../codec/index.ts";
import { canonicalizeRecordJson } from "../definition/canonical.ts";
import { RecordCoreInvalid, RecordReferenceInvalid, nonEmptyRecordIssues, recordIssue, type NonEmptyRecordIssues } from "../errors/record-errors.ts";
import { NiceEvalRecordAttachmentPersistences } from "../family/catalog.ts";
import { attemptRecordAppendCommandRuntime, attemptRecordCollectionRuntime, recordContributionFromAttachmentPersistence, recordContributionRuntime, recordDefinitionAttachment, recordWriteCommandPayload, type AttemptRecordAppendCommand, type AttemptRecordCollectionDefinition, type AttemptRecordCollectionLimitation, type AttemptRecordCollectionRuntime, type RecordContribution, type RecordWriteCommand } from "../authoring.ts";
import type { AttemptDocument, MemberDocument, RecordAttachmentOwner, RecordDocument, RecordSlotIdentity, RunDocument } from "../model/core.ts";
import { canonicalizeRunContext, type RunContext } from "../model/run-context.ts";
import { RECORD_FORMAT, compareCanonicalIdentity, type AttemptId, type RunId, type Sha256Digest, type SlotId } from "../model/identifiers.ts";
import type { RecordCoreRead, RecordWarning } from "../model/read-state.ts";
import { validateExpectedSlots } from "../model/validation.ts";
import { RecordResourceLimitExceeded } from "../platform/errors.ts";
import { recordRootPaths, type RecordRoot } from "../platform/root.ts";
import { RecordEntropy, type RecordEntropyService } from "../platform/services.ts";
import { FamilyDefinitionRequired, RecordBootstrapInvalid, RecordFormatUnsupported, RecordHandleInvalid, RecordMigrationInvalid, RecordMigrationPlanStale, RecordReaderClosed, RecordSealIncomplete, type RecordMaintenanceOpenError, type RecordReaderOpenError, type RecordReaderReadError } from "../reader/errors.ts";
import { cleanIncompleteRuns, inspectIncompleteRuns } from "../maintenance/index.ts";
import { RECORD_SQLITE_CHUNK_BYTES, RECORD_SQLITE_MAX_PAGE_ROWS, RECORD_SQLITE_MAX_PUBLISH_BYTES, RECORD_SQLITE_MAX_PUBLISH_ROWS, RECORD_SQLITE_MAX_ROW_BYTES, SqliteRecordError, inspectProjectRecordDatabase, openStorageWorker, recordSqlitePath, type FinalizedAttachmentMetadata, type PersistedAttachmentReference, type PersistedCollectionItem, type PersistedContentChunk, type PersistedContentMetadata, type ProjectRecordDatabaseInspection, type SealedAttachmentMetadata, type SealedRunCore, type StorageWorkerClient } from "../sqlite/index.ts";
import { compareCanonicalCodeUnits, hashCanonicalTuple } from "../sqlite/seal.ts";
import { prepareStreamingRecordAttachment, type AttachedContentError, type AttachedContentRequirements, type PreparedStreamingRecordAttachment, type RecordAttachmentSessionBuilder } from "../writer/current-attachment.ts";
import { recordAlreadyWritten, recordAppendCommandInvalid, recordAttachmentEncodeError, recordCollectionDefinitionInvalid, recordCollectionNotClosed, recordDraftStateError, recordOwnerDefinitionMismatch, recordWriterClosed } from "../writer/errors.ts";
import { encodeRecordJsonUtf8, RECORD_JSON_MAXIMUM_BYTES } from "../writer/limits.ts";
import type { RecordWriteError } from "../writer/types.ts";
import type { AttemptRecordsWriter, AttemptWriteSession, CreateRunRequest, OwnerRecordsWriter, ReadableAttempt, ReadableRun, RecordAttachmentContentReader, RecordAttachmentRead, RecordCleanOperationPlan, RecordCleanOperationReceipt, RecordCompleteView, RecordHostSDK, RecordMaintenanceOperationFailure, RecordMaintenanceSession, RecordMigrateOperationPlan, RecordMigrateOperationReceipt, RecordMigrationPlan, RecordReadSession, RecordSealReceipt, RecordSelection, RecordSelectionProblem, RecordSelectionRequest, ReferenceRunWriteSession, RunCompletion, RunWriteSession, SelectedAttemptRef, SelectedOwnerRef, SelectedRunFacts, SelectedRunRef } from "./types.ts";
import { attemptWriteSessionBrand, runWriteSessionBrand, selectedAttemptRefBrand, selectedOwnerRefBrand, selectedRunRefBrand } from "./types.ts";

type AnyDefinition<Owner extends RecordAttachmentOwner = RecordAttachmentOwner> = RecordAttachmentDefinition<Owner, string, Schema.Top>;
type AnyPersistence = RecordAttachmentPersistence<AnyDefinition, number>;
const WRITE_DEADLINE_MS = 30_000;
const MAILBOX_COMMANDS = 64;
const COLLECTION_READ_MAX_ROWS = 10_000;
const WHOLE_VALUE_MAX_BYTES = 16 * 1024 * 1024;
const CONTENT_BATCH_CHUNKS = Math.min(4, Math.max(1, Math.floor(RECORD_SQLITE_MAX_PUBLISH_BYTES / RECORD_SQLITE_CHUNK_BYTES)));
const CONTENT_READ_PAGE_ROWS = Math.min(4, RECORD_SQLITE_MAX_PAGE_ROWS);
const canonicalLimits = Object.freeze({ maximumJsonBytes: RECORD_JSON_MAXIMUM_BYTES, maximumDepth: 64, maximumNodes: 100_000, maximumObjectKeys: 10_000, maximumArrayItems: 100_000, maximumKeyUtf8Bytes: 16_384, maximumStringUtf8Bytes: 1_048_576 });

function digest(bytes: Uint8Array): Sha256Digest {
  const value = createHash("sha256").update(bytes).digest("hex");
  const decoded = Schema.decodeUnknownResult(Sha256DigestSchema)(value);
  if (Result.isFailure(decoded)) throw new Error("invalid SHA-256");
  return decoded.success;
}
function canonicalBytes(value: unknown): Uint8Array | undefined {
  const canonical = canonicalizeRecordJson(value, canonicalLimits);
  return Result.isFailure(canonical) ? undefined : encodeRecordJsonUtf8(canonical.success);
}
function parseJson(bytes: Uint8Array): unknown | undefined {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; } catch { return undefined; }
}
function invalidIssues(path: readonly string[] = []): NonEmptyRecordIssues { return nonEmptyRecordIssues([recordIssue("record-schema-invalid", path)])!; }
function coreInvalid(): RecordCoreInvalid { return new RecordCoreInvalid({ code: "record-core-invalid", issues: invalidIssues(["core"]) }); }
function deadline(): number { return Date.now() + WRITE_DEADLINE_MS; }
function storageRoot(root: RecordRoot): string | undefined { return recordRootPaths(root)?.portableRoot; }
function sameRoot(a: RecordRoot, b: RecordRoot): boolean { return storageRoot(a) !== undefined && storageRoot(a) === storageRoot(b); }
function sqliteEffect<A>(operation: () => Promise<A>): Effect.Effect<A, SqliteRecordError> {
  return Effect.tryPromise({ try: operation, catch: (cause) => cause instanceof SqliteRecordError ? cause : new SqliteRecordError("record-sqlite-error", "record-host", "storage worker failed", { cause }) });
}
function withWriteAdmission<A>(
  coordination: RecordCoordinationService,
  root: RecordRoot,
  operation: (deadlineEpochMs: number) => Promise<A>,
): Effect.Effect<A, RecordWriteError> {
  const deadlineEpochMs = deadline();
  return Effect.uninterruptibleMask((restore) => Effect.scoped(Effect.gen(function* () {
    yield* restore(coordination.enterRecordWriteBatch({
      root,
      deadlineEpochMs,
    }));
    // The storage worker owns the synchronous SQLite transaction. Once it has
    // admission, interruption waits for its Promise to settle so the scope
    // cannot release the writer owner before COMMIT or ROLLBACK.
    return yield* sqliteEffect(() => operation(deadlineEpochMs));
  })));
}
function exactMarker(value: unknown, key: string): unknown | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value); if (keys.length !== 1 || keys[0] !== key) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
}
function hasOwnMarker(value: unknown, key: string): boolean { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key); }

interface StoredAttachment { readonly metadata: FinalizedAttachmentMetadata; readonly ownerKind: RecordAttachmentOwner; readonly ownerAttemptId?: AttemptId; readonly family: string; readonly revision: number }
interface CollectionState {
  readonly authoring: AttemptRecordCollectionRuntime; readonly attachmentId: string; nextOrdinal: number; encodedBytes: number; readonly itemHash: ReturnType<typeof createHash>;
  completion?: { readonly state: "complete" } | { readonly state: "partial"; readonly limitations: readonly [AttemptRecordCollectionLimitation, ...AttemptRecordCollectionLimitation[]] };
}
interface AttemptRuntime {
  readonly run: RunRuntime; readonly attemptId: AttemptId; readonly slotId: SlotId; state: "open" | "completing" | "completed" | "failed"; outcome?: AttemptDocument["outcome"];
  readonly families: Set<string>; readonly collections: Map<string, CollectionState>; pendingAppends: number; readonly appendAcks: Queue.Queue<void>; handle?: AttemptWriteSession;
}
interface AppendCommand { readonly attempt: AttemptRuntime; readonly attachmentId: string; readonly bytes: number; readonly item: PersistedCollectionItem }
interface RunRuntime {
  readonly root: RecordRoot; readonly client: StorageWorkerClient; readonly coordination: RecordCoordinationService; readonly entropy: RecordEntropyService; readonly catalog: RecordAttachmentCatalog;
  readonly record: RecordDocument; readonly writerGeneration: string; readonly runId: RunId; readonly experimentId: CreateRunRequest["experimentId"]; readonly context: RunContext;
  readonly startedAt: CreateRunRequest["startedAt"]; readonly expectedSlots: readonly RecordSlotIdentity[]; readonly expectedBySlot: ReadonlyMap<SlotId, RecordSlotIdentity>;
  readonly lock: Semaphore.Semaphore; readonly queue: Queue.Queue<AppendCommand>; readonly attempts: Map<AttemptId, AttemptRuntime>; readonly members: Map<SlotId, MemberDocument>;
  readonly reservations: Set<SlotId>; readonly families: Set<string>; readonly attachments: Map<string, StoredAttachment>;
  state: "open" | "sealing" | "sealed" | "failed"; failure?: RecordWriteError; handle?: object;
}
interface ReaderLifecycle { closed: boolean }
type OwnerRuntime =
  | { readonly kind: "run"; readonly runId: RunId }
  | { readonly kind: "attempt"; readonly runId: RunId; readonly attemptId: AttemptId };
interface ReaderRuntime {
  readonly root: RecordRoot; readonly client: StorageWorkerClient; readonly catalog: RecordAttachmentCatalog; readonly lifecycle: ReaderLifecycle;
  readonly runs: WeakMap<SelectedRunRef, RunId>; readonly attempts: WeakMap<SelectedAttemptRef, { readonly runId: RunId; readonly attemptId: AttemptId }>;
  readonly owners: WeakMap<SelectedOwnerRef, OwnerRuntime>; readonly selections: WeakSet<RecordSelection>; readonly coreCache: Map<RunId, SealedRunCore>;
  readonly runRefs: Map<RunId, SelectedRunRef>; readonly attemptRefs: Map<string, SelectedAttemptRef>;
  readonly content: WeakMap<RecordContentHandle, { readonly contentId: string; readonly logicalHandle: string; readonly byteLength: number; readonly digest: string; readonly chunkCount: number }>;
}
const runSessions = new WeakMap<object, RunRuntime>();
const attemptSessions = new WeakMap<object, AttemptRuntime>();
const selectedAttemptCapabilities = new WeakMap<SelectedAttemptRef, { readonly root: RecordRoot; readonly lifecycle: ReaderLifecycle }>();

function attachmentIdentity(owner: OwnerRuntime, family: string): string {
  return hashCanonicalTuple("niceeval.record.attachment-id/v1", [owner.runId, owner.kind, owner.kind === "attempt" ? owner.attemptId : null, family]);
}
function contentIdentity(attachmentId: string, logicalHandle: string): string {
  return hashCanonicalTuple("niceeval.record.content-id/v1", [attachmentId, logicalHandle]);
}
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}
function attachmentMetadata(input: { readonly attachmentId: string; readonly payloadBytes: Uint8Array; readonly references: readonly PersistedAttachmentReference[]; readonly contents: readonly PersistedContentMetadata[]; readonly collection?: { readonly count: number; readonly byteLength: number; readonly digest: string } }): FinalizedAttachmentMetadata {
  const canonicalDigest = digest(input.payloadBytes);
  const inventoryBytes = canonicalBytes({ references: input.references.map(({ ordinal, owner, family, referenceDigest }) => ({ ordinal, owner, family, digest: referenceDigest })), contents: input.contents, ...(input.collection === undefined ? {} : { collection: input.collection }) });
  if (inventoryBytes === undefined) throw new Error("invalid attachment inventory");
  const inventoryDigest = digest(inventoryBytes);
  return Object.freeze({ attachmentId: input.attachmentId, logicalIdentity: hashCanonicalTuple("niceeval.record.attachment-logical-identity/v1", [input.attachmentId, canonicalDigest, inventoryDigest]), canonicalBytes: input.payloadBytes, canonicalDigest, logicalInventoryBytes: inventoryBytes, inventoryDigest, contents: Object.freeze([...input.contents]) });
}
function resolvePersistence(catalog: RecordAttachmentCatalog, definition: unknown, owner: RecordAttachmentOwner): Result.Result<AnyPersistence, RecordWriteError> {
  const attachment = recordDefinitionAttachment(definition) ?? resolveRecordAttachmentDefinition(definition);
  if (attachment === undefined) return Result.fail(recordCollectionDefinitionInvalid());
  if (attachment.owner !== owner) return Result.fail(recordOwnerDefinitionMismatch({ expected: owner, actual: attachment.owner }));
  const persistence = catalog.persistence(attachment);
  return persistence === undefined ? Result.fail(new FamilyDefinitionRequired({ code: "family-definition-required", owner, family: attachment.family, revision: 1 })) : Result.succeed(persistence as AnyPersistence);
}
function poison(run: RunRuntime, error: RecordWriteError): void { if (run.failure === undefined) run.failure = error; run.state = "failed"; }
function assertRunOpen(run: RunRuntime): Effect.Effect<void, RecordWriteError> {
  if (run.failure !== undefined) return Effect.fail(run.failure);
  return run.state === "open" ? Effect.void : Effect.fail(recordDraftStateError({ code: "record-draft-state-invalid", operation: "record", state: run.state === "sealed" ? "published" : run.state === "failed" ? "failed" : "publishing" }));
}

function makeBatches(commands: readonly AppendCommand[]): readonly (readonly AppendCommand[])[] {
  const result: AppendCommand[][] = []; let batch: AppendCommand[] = []; let bytes = 0;
  for (const command of commands) {
    if (batch.length > 0 && (command.attachmentId !== batch[0]!.attachmentId || batch.length >= RECORD_SQLITE_MAX_PUBLISH_ROWS || bytes + command.bytes > RECORD_SQLITE_MAX_PUBLISH_BYTES)) {
      result.push(batch); batch = []; bytes = 0;
    }
    batch.push(command); bytes += command.bytes;
  }
  if (batch.length > 0) result.push(batch); return result;
}
function collectionWorker(run: RunRuntime): Effect.Effect<never, never> {
  return Effect.forever(Effect.gen(function* () {
    const first = yield* Queue.take(run.queue);
    const tail = yield* Queue.clear(run.queue);
    for (const batch of makeBatches(Object.freeze([first, ...tail]))) {
      const exit = yield* Effect.exit(withWriteAdmission(run.coordination, run.root, (deadlineEpochMs) => run.client.stageCollectionItems({ runId: run.runId, writerGeneration: run.writerGeneration, attachmentId: batch[0]!.attachmentId, items: Object.freeze(batch.map(({ item }) => item)), deadlineEpochMs })));
      const attempt = batch[0]!.attempt;
      attempt.pendingAppends -= batch.length;
      yield* Queue.offer(attempt.appendAcks, undefined);
      if (Exit.isFailure(exit)) yield* Effect.sync(() => poison(run, new SqliteRecordError("record-sqlite-error", "stage-collection-items", "collection batch failed")));
    }
  })).pipe(Effect.catchCause(() => Effect.never));
}
function snapshotItem(authoring: AttemptRecordCollectionRuntime, item: unknown, ordinal: number): Result.Result<PersistedCollectionItem, RecordWriteError> {
  if (!isRecordAttachmentSchema(authoring.item)) return Result.fail(recordAppendCommandInvalid());
  const encoded = Schema.encodeUnknownResult(authoring.item)(item);
  if (Result.isFailure(encoded)) return Result.fail(recordAppendCommandInvalid());
  const bytes = canonicalBytes(encoded.success);
  if (bytes === undefined || bytes.byteLength > RECORD_SQLITE_MAX_ROW_BYTES) return Result.fail(new RecordResourceLimitExceeded({ code: "record-resource-limit-exceeded", resource: "file-bytes", maximum: RECORD_SQLITE_MAX_ROW_BYTES, observedAtLeast: bytes?.byteLength ?? RECORD_SQLITE_MAX_ROW_BYTES + 1, path: authoring.attachment.family }));
  const canonicalDigest = digest(bytes);
  return Result.succeed(Object.freeze({ ordinal, logicalIdentity: hashCanonicalTuple("niceeval.record.collection-item-logical-identity/v1", [ordinal, canonicalDigest]), canonicalBytes: bytes, canonicalDigest }));
}
function admitCollection(run: RunRuntime, attempt: AttemptRuntime, authoring: AttemptRecordCollectionRuntime): Effect.Effect<CollectionState, RecordWriteError> {
  const current = attempt.collections.get(authoring.attachment.family); if (current !== undefined) return Effect.succeed(current);
  const attachmentId = attachmentIdentity({ kind: "attempt", runId: run.runId, attemptId: attempt.attemptId }, authoring.attachment.family);
  return Effect.gen(function* () {
    yield* withWriteAdmission(run.coordination, run.root, (deadlineEpochMs) => run.client.admitAttachment({ runId: run.runId, writerGeneration: run.writerGeneration, attachmentId, ownerKind: "attempt", ownerRunId: run.runId, ownerAttemptId: attempt.attemptId, family: authoring.attachment.family, familyRevision: authoring.persistence.revision, deadlineEpochMs }));
    const state: CollectionState = { authoring, attachmentId, nextOrdinal: 0, encodedBytes: 0, itemHash: createHash("sha256") };
    attempt.collections.set(authoring.attachment.family, state); attempt.families.add(authoring.attachment.family); return state;
  });
}
function appendCollectionBatch(attempt: AttemptRuntime, definition: unknown, items: readonly unknown[]): Effect.Effect<{ readonly state: "retained" }, RecordWriteError> {
  const run = attempt.run;
  return Effect.uninterruptibleMask(() => run.lock.withPermits(1)(Effect.gen(function* () {
    yield* assertRunOpen(run); if (attempt.state !== "open") return yield* Effect.fail(recordWriterClosed());
    const authoring = attemptRecordCollectionRuntime(definition); if (authoring === undefined) return yield* Effect.fail(recordCollectionDefinitionInvalid());
    const collection = yield* admitCollection(run, attempt, authoring); if (collection.completion !== undefined) return yield* Effect.fail(recordWriterClosed());
    const commands: AppendCommand[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const frozen = snapshotItem(authoring, items[index], collection.nextOrdinal + index); if (Result.isFailure(frozen)) return yield* Effect.fail(frozen.failure);
      commands.push(Object.freeze({ attempt, attachmentId: collection.attachmentId, bytes: frozen.success.canonicalBytes.byteLength, item: frozen.success }));
    }
    attempt.pendingAppends += commands.length;
    // One bounded batch is offered atomically with respect to interruption;
    // the worker can always drain it without acquiring this lock.
    yield* Queue.offerAll(run.queue, commands);
    for (const command of commands) {
      collection.nextOrdinal += 1; collection.encodedBytes += command.bytes; collection.itemHash.update(command.item.canonicalBytes).update("\n");
    }
    return Object.freeze({ state: "retained" as const });
  })));
}
function appendCollection(attempt: AttemptRuntime, definition: unknown, item: unknown): Effect.Effect<{ readonly state: "retained" }, RecordWriteError> {
  return appendCollectionBatch(attempt, definition, [item]);
}
function closeCollection(attempt: AttemptRuntime, definition: unknown, completion: CollectionState["completion"]): Effect.Effect<void, RecordWriteError> {
  return attempt.run.lock.withPermits(1)(Effect.gen(function* () {
    yield* assertRunOpen(attempt.run); if (attempt.state !== "open") return yield* Effect.fail(recordWriterClosed());
    const authoring = attemptRecordCollectionRuntime(definition); if (authoring === undefined || completion === undefined) return yield* Effect.fail(recordCollectionDefinitionInvalid());
    const collection = yield* admitCollection(attempt.run, attempt, authoring); if (collection.completion !== undefined) return yield* Effect.fail(recordWriterClosed());
    collection.completion = completion.state === "complete" ? Object.freeze({ state: "complete" as const }) : Object.freeze({ state: "partial" as const, limitations: Object.freeze(completion.limitations.map((value) => Object.freeze({ ...value }))) as readonly [AttemptRecordCollectionLimitation, ...AttemptRecordCollectionLimitation[]] });
  }));
}

function processContent<Error, Requirements>(input: { readonly run: RunRuntime; readonly attachmentId: string; readonly source: PreparedStreamingRecordAttachment<Error, Requirements>["contents"][number] }): Effect.Effect<PersistedContentMetadata, RecordWriteError | Error, Requirements> {
  const contentId = contentIdentity(input.attachmentId, input.source.logicalHandle);
  return Effect.gen(function* () {
    yield* withWriteAdmission(input.run.coordination, input.run.root, (deadlineEpochMs) => input.run.client.admitContent({ runId: input.run.runId, writerGeneration: input.run.writerGeneration, attachmentId: input.attachmentId, contentId, logicalHandle: input.source.logicalHandle, deadlineEpochMs }));
    const overall = createHash("sha256"); let ordinal = 0; let byteLength = 0; const available: Uint8Array[] = [];
    const takePending = (): Uint8Array => available.pop() ?? new Uint8Array(RECORD_SQLITE_CHUNK_BYTES);
    let pending = takePending(); let pendingLength = 0; let batch: PersistedContentChunk[] = []; let batchBytes = 0;
    const flushBatch = (): Effect.Effect<void, RecordWriteError> => {
      if (batch.length === 0) return Effect.void; const frozen = Object.freeze(batch); batch = []; batchBytes = 0;
      return withWriteAdmission(input.run.coordination, input.run.root, (deadlineEpochMs) => input.run.client.appendContentChunks({ runId: input.run.runId, writerGeneration: input.run.writerGeneration, contentId, chunks: frozen, deadlineEpochMs }))
        .pipe(Effect.map((returned) => { for (const value of returned) available.push(value); }));
    };
    const emit = (frozen: Uint8Array): Effect.Effect<void, RecordWriteError> => Effect.gen(function* () {
      overall.update(frozen); byteLength += frozen.byteLength;
      if (input.source.maximumBytes !== undefined && byteLength > input.source.maximumBytes) return yield* Effect.fail(new RecordResourceLimitExceeded({ code: "record-resource-limit-exceeded", resource: "file-bytes", maximum: input.source.maximumBytes, observedAtLeast: byteLength, path: input.source.logicalHandle }));
      batch.push(Object.freeze({ ordinal: ordinal++, bytes: frozen, chunkDigest: digest(frozen) })); batchBytes += frozen.byteLength;
      if (batch.length >= CONTENT_BATCH_CHUNKS || batchBytes >= RECORD_SQLITE_MAX_PUBLISH_BYTES) yield* flushBatch();
    });
    yield* Stream.runForEach(input.source.stream, (incoming) => Effect.gen(function* () {
      if (!(incoming instanceof Uint8Array)) return yield* Effect.fail(recordAppendCommandInvalid());
      let offset = 0;
      while (offset < incoming.byteLength) {
        const take = Math.min(RECORD_SQLITE_CHUNK_BYTES - pendingLength, incoming.byteLength - offset); pending.set(incoming.subarray(offset, offset + take), pendingLength); pendingLength += take; offset += take;
        if (pendingLength === RECORD_SQLITE_CHUNK_BYTES) { yield* emit(pending); pending = takePending(); pendingLength = 0; }
      }
    }));
    // A full pending buffer is uniquely owned here and can be transferred
    // directly. Only the final partial chunk needs an exact-size copy.
    if (pendingLength > 0) yield* emit(pending.slice(0, pendingLength)); yield* flushBatch();
    return Object.freeze({ contentId, logicalHandle: input.source.logicalHandle, byteLength, digest: overall.digest("hex"), chunkCount: ordinal });
  });
}

function writeAttachment<Owner extends RecordAttachmentOwner, Value>(input: { readonly run: RunRuntime; readonly owner: Owner; readonly attempt?: AttemptRuntime; readonly persistence: AnyPersistence; readonly value: Value | ((builder: RecordAttachmentSessionBuilder) => Value) }): Effect.Effect<void, RecordWriteError | AttachedContentError<Value>, AttachedContentRequirements<Value>> {
  const targetFamilies = input.attempt?.families ?? input.run.families; const family = input.persistence.attachment.family;
  const ownerRuntime: OwnerRuntime = input.owner === "run" ? { kind: "run", runId: input.run.runId } : { kind: "attempt", runId: input.run.runId, attemptId: input.attempt!.attemptId };
  return Effect.gen(function* () {
    yield* input.run.lock.withPermits(1)(Effect.gen(function* () { yield* assertRunOpen(input.run); if (input.attempt !== undefined && input.attempt.state !== "open") return yield* Effect.fail(recordWriterClosed()); if (targetFamilies.has(family)) return yield* Effect.fail(recordAlreadyWritten({ owner: input.owner, family })); targetFamilies.add(family); }));
    const prepared = yield* prepareStreamingRecordAttachment({ definition: input.persistence.attachment, value: input.value as never });
    const attachmentId = attachmentIdentity(ownerRuntime, family);
    yield* withWriteAdmission(input.run.coordination, input.run.root, (deadlineEpochMs) => input.run.client.admitAttachment({ runId: input.run.runId, writerGeneration: input.run.writerGeneration, attachmentId, ownerKind: input.owner, ownerRunId: input.run.runId, ...(input.attempt === undefined ? {} : { ownerAttemptId: input.attempt.attemptId }), family, familyRevision: input.persistence.revision, deadlineEpochMs }));
    const contents = yield* Effect.forEach(prepared.contents, (source) => processContent({ run: input.run, attachmentId, source }), { concurrency: 1 });
    const references: PersistedAttachmentReference[] = prepared.references.map((reference, ordinal) => { const bytes = canonicalBytes(reference); if (bytes === undefined) throw new Error("invalid reference"); return Object.freeze({ ordinal, owner: reference.owner, family: reference.family, canonicalBytes: bytes, referenceDigest: digest(bytes) }); });
    for (let offset = 0; offset < references.length; offset += RECORD_SQLITE_MAX_PUBLISH_ROWS) { const refs = Object.freeze(references.slice(offset, offset + RECORD_SQLITE_MAX_PUBLISH_ROWS)); yield* withWriteAdmission(input.run.coordination, input.run.root, (deadlineEpochMs) => input.run.client.stageAttachmentReferences({ runId: input.run.runId, writerGeneration: input.run.writerGeneration, attachmentId, references: refs, deadlineEpochMs })); }
    const metadata = attachmentMetadata({ attachmentId, payloadBytes: prepared.payloadBytes, references, contents });
    input.run.attachments.set(attachmentId, Object.freeze({ metadata, ownerKind: input.owner, ...(input.attempt === undefined ? {} : { ownerAttemptId: input.attempt.attemptId }), family, revision: input.persistence.revision }));
  }).pipe(Effect.tapError((error) => Effect.sync(() => poison(input.run, error as RecordWriteError)))) as Effect.Effect<void, RecordWriteError | AttachedContentError<Value>, AttachedContentRequirements<Value>>;
}

function finishCollections(attempt: AttemptRuntime): Effect.Effect<void, RecordWriteError> {
  return Effect.gen(function* () {
    for (const collection of attempt.collections.values()) if (collection.completion === undefined) return yield* Effect.fail(recordCollectionNotClosed(collection.authoring.attachment.family));
    while (attempt.pendingAppends > 0) yield* Queue.take(attempt.appendAcks);
    if (attempt.run.failure !== undefined) return yield* Effect.fail(attempt.run.failure);
    for (const collection of attempt.collections.values()) {
      const completion = collection.completion!;
      const shell = { collection: completion.state === "complete" ? { state: "complete" as const, limitations: [] as const } : { state: "partial" as const, limitations: completion.limitations }, items: [] as const };
      if (!isRecordAttachmentSchema(collection.authoring.attachment.schema)) return yield* Effect.fail(recordCollectionDefinitionInvalid());
      const encoded = Schema.encodeUnknownResult(collection.authoring.attachment.schema)(shell); if (Result.isFailure(encoded)) return yield* Effect.fail(recordCollectionDefinitionInvalid());
      const payloadBytes = canonicalBytes(encoded.success); if (payloadBytes === undefined) return yield* Effect.fail(recordCollectionDefinitionInvalid());
      const metadata = attachmentMetadata({ attachmentId: collection.attachmentId, payloadBytes, references: [], contents: [], collection: { count: collection.nextOrdinal, byteLength: collection.encodedBytes, digest: collection.itemHash.digest("hex") } });
      attempt.run.attachments.set(collection.attachmentId, Object.freeze({ metadata, ownerKind: "attempt", ownerAttemptId: attempt.attemptId, family: collection.authoring.attachment.family, revision: collection.authoring.persistence.revision }));
    }
  });
}
function completeAttempt(attempt: AttemptRuntime, outcome: AttemptDocument["outcome"]): Effect.Effect<void, RecordWriteError> {
  return Effect.gen(function* () {
    yield* attempt.run.lock.withPermits(1)(Effect.gen(function* () {
      yield* assertRunOpen(attempt.run); if (attempt.state !== "open") return yield* Effect.fail(recordWriterClosed()); attempt.state = "completing";
      const unclosed = [...attempt.collections.values()].find(({ completion }) => completion === undefined); if (unclosed !== undefined) { attempt.state = "failed"; return yield* Effect.fail(recordCollectionNotClosed(unclosed.authoring.attachment.family)); }
    }));
    yield* finishCollections(attempt);
    const slot = attempt.run.expectedBySlot.get(attempt.slotId); if (slot === undefined) return yield* Effect.fail(coreInvalid());
    attempt.outcome = outcome;
    attempt.run.members.set(attempt.slotId, Object.freeze({ slotId: attempt.slotId, action: "executed", attempt: Object.freeze({ originRunId: attempt.run.runId, attemptId: attempt.attemptId }) }));
    attempt.state = "completed"; if (attempt.handle !== undefined) attemptSessions.delete(attempt.handle);
    const metadata = buildRunMetadata(attempt.run, Date.now() as RunDocument["completedAt"]);
    yield* withWriteAdmission(attempt.run.coordination, attempt.run.root, (deadlineEpochMs) =>
      attempt.run.client.stageRunPublicationMetadata({ ...metadata, deadlineEpochMs }));
  }).pipe(Effect.tapError((error) => Effect.sync(() => { attempt.state = "failed"; poison(attempt.run, error); })));
}
function makeAttemptSession(attempt: AttemptRuntime): AttemptWriteSession {
  const writeDefinition = (definition: unknown, value: unknown) => { const persistence = resolvePersistence(attempt.run.catalog, definition, "attempt"); return Result.isFailure(persistence) ? Effect.fail(persistence.failure) : writeAttachment({ run: attempt.run, owner: "attempt", attempt, persistence: persistence.success, value }); };
  const record = Object.freeze({
    write<Value, Error, Requirements>(command: RecordWriteCommand<"attempt", Value, Error, Requirements>) { const payload = recordWriteCommandPayload(command, "attempt"); return payload === undefined ? Effect.fail(recordAppendCommandInvalid()) : writeDefinition(payload.definition, payload.input); },
    start(definition: AttemptRecordCollectionDefinition<string, Schema.Top>) { const authoring = attemptRecordCollectionRuntime(definition); return authoring === undefined ? Effect.fail(recordCollectionDefinitionInvalid()) : admitCollection(attempt.run, attempt, authoring).pipe(Effect.asVoid); },
    append<Item>(command: AttemptRecordAppendCommand<Item>) { const runtime = attemptRecordAppendCommandRuntime(command); return runtime === undefined ? Effect.fail(recordAppendCommandInvalid()) : appendCollection(attempt, runtime.definition, runtime.item); },
  }) as AttemptWriteSession["record"];
  const append: AttemptRecordsWriter["append"] = (definition, item) => appendCollection(attempt, definition, item);
  const appendAll: AttemptRecordsWriter["appendAll"] = <Definition extends AttemptRecordCollectionDefinition<string, Schema.Top>, Error, Requirements>(definition: Definition, items: Stream.Stream<Schema.Schema.Type<Definition["item"]>, Error, Requirements>) =>
    items.pipe(Stream.grouped(MAILBOX_COMMANDS), Stream.runForEach((group) => appendCollectionBatch(attempt, definition, group).pipe(Effect.asVoid)));
  const close: AttemptRecordsWriter["close"] = (definition, completion) => closeCollection(attempt, definition, completion);
  const records: AttemptRecordsWriter = Object.freeze({ write: writeDefinition as AttemptRecordsWriter["write"], append, appendAll, close });
  const session: AttemptWriteSession = Object.freeze({ attemptId: attempt.attemptId, slotId: attempt.slotId, [attemptWriteSessionBrand]: () => undefined, complete: (outcome: AttemptDocument["outcome"]) => attemptSessions.get(session) === attempt ? completeAttempt(attempt, outcome) : Effect.fail(recordWriterClosed()), attach: writeDefinition as AttemptWriteSession["attach"], record, records });
  attempt.handle = session; attemptSessions.set(session, attempt); return session;
}
function mintId<A>(entropy: RecordEntropyService, schema: Schema.Codec<A, string>): Effect.Effect<A, RecordWriteError> {
  return Effect.flatMap(entropy.uuid, (raw) => { const decoded = Schema.decodeUnknownResult(schema)(raw); return Result.isFailure(decoded) ? Effect.fail(coreInvalid()) : Effect.succeed(decoded.success); });
}
function createAttempt(run: RunRuntime, slotId: SlotId): Effect.Effect<AttemptWriteSession, RecordWriteError> {
  return run.lock.withPermits(1)(Effect.gen(function* () {
    yield* assertRunOpen(run); if (!run.expectedBySlot.has(slotId) || run.reservations.has(slotId)) return yield* Effect.fail(coreInvalid());
    const attemptId = yield* mintId(run.entropy, AttemptIdSchema);
    yield* withWriteAdmission(run.coordination, run.root, (deadlineEpochMs) => run.client.admitAttempt({ runId: run.runId, writerGeneration: run.writerGeneration, attemptId, attemptLocator: encodeAttemptLocator(attemptId), deadlineEpochMs }));
    const appendAcks = yield* Queue.unbounded<void>();
    const attempt: AttemptRuntime = { run, attemptId, slotId, state: "open", families: new Set(), collections: new Map(), pendingAppends: 0, appendAcks };
    run.attempts.set(attemptId, attempt); run.reservations.add(slotId); return makeAttemptSession(attempt);
  }));
}
function selectedReference(run: RunRuntime, ref: SelectedAttemptRef): boolean { const capability = selectedAttemptCapabilities.get(ref); return capability !== undefined && !capability.lifecycle.closed && sameRoot(capability.root, run.root); }
function referenceAttempt(run: RunRuntime, input: { readonly slotId: SlotId; readonly action: "carried" | "accepted"; readonly attempt: SelectedAttemptRef }): Effect.Effect<void, RecordWriteError> {
  return run.lock.withPermits(1)(Effect.gen(function* () { yield* assertRunOpen(run); if (!selectedReference(run, input.attempt)) return yield* Effect.fail(new RecordReferenceInvalid({ code: "record-reference-invalid" })); if (!run.expectedBySlot.has(input.slotId) || run.reservations.has(input.slotId)) return yield* Effect.fail(coreInvalid()); run.members.set(input.slotId, Object.freeze({ slotId: input.slotId, action: input.action, attempt: Object.freeze({ originRunId: input.attempt.originRunId, attemptId: input.attempt.attemptId }) })); run.reservations.add(input.slotId); }));
}
function terminalMember(run: RunRuntime, slotId: SlotId, action: "not-dispatched" | "interrupted"): Effect.Effect<void, RecordWriteError> {
  return run.lock.withPermits(1)(Effect.gen(function* () { yield* assertRunOpen(run); if (!run.expectedBySlot.has(slotId) || run.reservations.has(slotId)) return yield* Effect.fail(coreInvalid()); run.members.set(slotId, Object.freeze({ slotId, action, attempt: null })); run.reservations.add(slotId); }));
}
function encodeCore(value: unknown): { readonly bytes: Uint8Array; readonly digest: string } | undefined { const bytes = canonicalBytes(value); return bytes === undefined ? undefined : Object.freeze({ bytes, digest: digest(bytes) }); }
function buildRunMetadata(run: RunRuntime, completedAt: RunDocument["completedAt"]) {
  const runDocument: RunDocument = Object.freeze({ runId: run.runId, experimentId: run.experimentId, context: run.context, startedAt: run.startedAt, completedAt, expectedSlots: run.expectedSlots });
  const recordEncoded = encodeRecordDocument(run.record), runEncoded = encodeRunDocument(runDocument); if (Result.isFailure(recordEncoded) || Result.isFailure(runEncoded)) throw new Error("invalid run core");
  const recordCore = encodeCore(recordEncoded.success), runCore = encodeCore(runEncoded.success); if (recordCore === undefined || runCore === undefined) throw new Error("invalid run core");
  const slots = run.expectedSlots.map((slot, ordinal) => { const core = encodeCore(slot)!; return Object.freeze({ slotId: slot.slotId, ordinal, coreBytes: core.bytes, coreDigest: core.digest }); });
  const attempts = [...run.attempts.values()].filter((attempt) => attempt.state === "completed").sort((a, b) => compareCanonicalIdentity(a.attemptId, b.attemptId)).map((attempt) => { const slot = run.expectedBySlot.get(attempt.slotId)!; const encoded = encodeAttemptDocument(Object.freeze({ attemptId: attempt.attemptId, originRunId: run.runId, slotId: attempt.slotId, evalId: slot.evalId, executionIdentityDigest: slot.executionIdentityDigest, outcome: attempt.outcome! })); if (Result.isFailure(encoded)) throw new Error("invalid attempt"); const core = encodeCore(encoded.success)!; return Object.freeze({ attemptId: attempt.attemptId, attemptLocator: encodeAttemptLocator(attempt.attemptId), coreBytes: core.bytes, coreDigest: core.digest }); });
  const members = [...run.members.values()].sort((a, b) => compareCanonicalIdentity(a.slotId, b.slotId)).map((member) => { const encoded = encodeMemberDocument(member); if (Result.isFailure(encoded)) throw new Error("invalid member"); const core = encodeCore(encoded.success)!; return Object.freeze({ slotId: member.slotId, ...(member.attempt === null ? {} : { originRunId: member.attempt.originRunId, attemptId: member.attempt.attemptId }), action: member.action, coreBytes: core.bytes, coreDigest: core.digest }); });
  return Object.freeze({ runId: run.runId, writerGeneration: run.writerGeneration, startedAt: new Date(run.startedAt).toISOString(), recordCoreBytes: recordCore.bytes, recordCoreDigest: recordCore.digest, runCoreBytes: runCore.bytes, runCoreDigest: runCore.digest, slots: Object.freeze(slots), attempts: Object.freeze(attempts), members: Object.freeze(members), attachments: Object.freeze([...run.attachments.values()].map(({ metadata, ownerKind, ownerAttemptId, family, revision }) => Object.freeze({ ...metadata, ownerKind, ownerRunId: run.runId, ...(ownerAttemptId === undefined ? {} : { ownerAttemptId }), family, familyRevision: revision }))) });
}
function sealRun(run: RunRuntime, completion: RunCompletion): Effect.Effect<RecordSealReceipt, RecordWriteError> {
  return Effect.gen(function* () {
    yield* run.lock.withPermits(1)(Effect.gen(function* () { yield* assertRunOpen(run); if ([...run.attempts.values()].some(({ state }) => state !== "completed") || run.members.size !== run.expectedSlots.length) return yield* Effect.fail(coreInvalid()); run.state = "sealing"; }));
    const finalMetadata = buildRunMetadata(run, completion.completedAt);
    yield* withWriteAdmission(run.coordination, run.root, (deadlineEpochMs) => run.client.stageRunFinalMetadata({ ...finalMetadata, deadlineEpochMs }));
    // Full Content/collection closure verification is read-only and does not
    // monopolize the FIFO writer ticket. The following fence is one short txn.
    const prepared = yield* sqliteEffect(() => run.client.prepareRunFinalization({ runId: run.runId, writerGeneration: run.writerGeneration, deadlineEpochMs: deadline() }));
    const finalized = yield* withWriteAdmission(run.coordination, run.root, (deadlineEpochMs) => run.client.fenceRunFinalization({
      runId: run.runId,
      writerGeneration: run.writerGeneration,
      mutationSequence: prepared.mutationSequence,
      expectedLogicalSealIdentity: prepared.logicalSealIdentity,
      expectedSealEntryCount: prepared.sealEntryCount,
      deadlineEpochMs,
    }));
    let sealOrdinal: number | null = 0;
    while (sealOrdinal !== null) {
      const staged = yield* withWriteAdmission(run.coordination, run.root, (deadlineEpochMs) => run.client.stageSealEntries({
        runId: run.runId,
        writerGeneration: run.writerGeneration,
        expectedLogicalSealIdentity: finalized.logicalSealIdentity,
        startOrdinal: sealOrdinal!,
        maximumRows: 256,
        deadlineEpochMs,
      }));
      sealOrdinal = staged.nextOrdinal;
    }
    yield* withWriteAdmission(run.coordination, run.root, (deadlineEpochMs) => run.client.publishRunSeal({ runId: run.runId, writerGeneration: run.writerGeneration, expectedLogicalSealIdentity: finalized.logicalSealIdentity, deadlineEpochMs }));
    run.state = "sealed";
    if (run.handle !== undefined) runSessions.delete(run.handle);
    // Publication consumed the writer capability. Releasing its dedicated
    // worker here prevents a later read session from keeping two SQLite/V8
    // workers resident until the caller's outer Scope closes. The registered
    // Scope finalizer remains an idempotent fallback.
    yield* Effect.promise(() => run.client.close().catch(() => undefined));
    return Object.freeze({ runId: run.runId, state: "sealed" as const });
  }).pipe(Effect.tapError((error) => Effect.sync(() => poison(run, error))));
}
function makeRunSession(run: RunRuntime, referenceOnly: boolean): RunWriteSession | ReferenceRunWriteSession {
  const writeDefinition = (definition: unknown, value: unknown) => { const persistence = resolvePersistence(run.catalog, definition, "run"); return Result.isFailure(persistence) ? Effect.fail(persistence.failure) : writeAttachment({ run, owner: "run", persistence: persistence.success, value }); };
  const record = Object.freeze({ write<Value, Error, Requirements>(command: RecordWriteCommand<"run", Value, Error, Requirements>) { const payload = recordWriteCommandPayload(command, "run"); return payload === undefined ? Effect.fail(recordAppendCommandInvalid()) : writeDefinition(payload.definition, payload.input); } }) as RunWriteSession["record"];
  const records: OwnerRecordsWriter<"run"> = Object.freeze({ write: writeDefinition as OwnerRecordsWriter<"run">["write"] });
  let session: RunWriteSession | ReferenceRunWriteSession;
  const common = { runId: run.runId, [runWriteSessionBrand]: () => undefined, referenceAttempt: (input: Parameters<RunWriteSession["referenceAttempt"]>[0]) => referenceAttempt(run, input), recordAcceptedMembership: (input: Parameters<RunWriteSession["recordAcceptedMembership"]>[0]) => referenceAttempt(run, { ...input, action: "accepted" }), recordTerminalMember: (input: Parameters<RunWriteSession["recordTerminalMember"]>[0]) => terminalMember(run, input.slotId, input.action), attach: writeDefinition as RunWriteSession["attach"], record, records, seal: (completion: RunCompletion) => runSessions.get(session) === run ? sealRun(run, completion) : Effect.fail(recordWriterClosed()) };
  session = Object.freeze(referenceOnly ? common : { ...common, createAttempt: ({ slotId }: { readonly slotId: SlotId }) => createAttempt(run, slotId) }) as RunWriteSession | ReferenceRunWriteSession;
  run.handle = session; runSessions.set(session, run); return session;
}
function deterministicRecord(root: RecordRoot): RecordDocument | undefined {
  const path = storageRoot(root); if (path === undefined) return undefined;
  const format = Schema.decodeUnknownResult(RecordFormatSchema)(RECORD_FORMAT); const id = Schema.decodeUnknownResult(RecordIdSchema)(`record-${createHash("sha256").update(path).digest("hex")}`);
  return Result.isFailure(format) || Result.isFailure(id) ? undefined : Object.freeze({ format: format.success, recordId: id.success });
}
function openNewRuntime(request: CreateRunRequest, catalog: RecordAttachmentCatalog, referenceOnly: boolean): Effect.Effect<RunWriteSession | ReferenceRunWriteSession, RecordReaderOpenError | RecordWriteError, import("effect").Scope.Scope | RecordEntropy | RecordCoordination> {
  return Effect.gen(function* () {
    const expectedIssues = validateExpectedSlots(request.expectedSlots), context = canonicalizeRunContext(request.context);
    if (expectedIssues.length > 0 || Result.isFailure(context) || context.success.experimentId !== request.experimentId) return yield* Effect.fail(new RecordCoreInvalid({ code: "record-core-invalid", issues: nonEmptyRecordIssues(expectedIssues) ?? invalidIssues(["context"]) }));
    const rootPath = storageRoot(request.root), record = deterministicRecord(request.root); if (rootPath === undefined || record === undefined) return yield* Effect.fail(coreInvalid());
    const coordination = yield* RecordCoordination, entropy = yield* RecordEntropy; const client = yield* openStorageWorker(rootPath);
    const runId = yield* mintId(entropy, RunIdSchema), writerGeneration = yield* entropy.uuid;
    yield* withWriteAdmission(coordination, request.root, (deadlineEpochMs) => client.beginRun({ runId, writerGeneration, startedAt: new Date(request.startedAt).toISOString(), deadlineEpochMs }));
    const lock = yield* Semaphore.make(1), queue = yield* Queue.bounded<AppendCommand>(MAILBOX_COMMANDS);
    const run: RunRuntime = { root: request.root, client, coordination, entropy, catalog, record, writerGeneration, runId, experimentId: request.experimentId, context: context.success, startedAt: request.startedAt, expectedSlots: Object.freeze([...request.expectedSlots]), expectedBySlot: new Map(request.expectedSlots.map((slot) => [slot.slotId, slot])), lock, queue, attempts: new Map(), members: new Map(), reservations: new Set(), families: new Set(), attachments: new Map(), state: "open" };
    yield* Effect.forkScoped(collectionWorker(run)); yield* Effect.addFinalizer(() => Effect.sync(() => { if (run.state !== "sealed") run.state = "failed"; if (run.handle !== undefined) runSessions.delete(run.handle); for (const attempt of run.attempts.values()) if (attempt.handle !== undefined) attemptSessions.delete(attempt.handle); }));
    return makeRunSession(run, referenceOnly);
  });
}

function decodeCore(core: SealedRunCore): { readonly record: RecordDocument; readonly run: RunDocument; readonly attempts: readonly AttemptDocument[]; readonly members: readonly MemberDocument[] } | undefined {
  const rj = parseJson(core.recordCoreBytes), uj = parseJson(core.runCoreBytes); const record = rj === undefined ? undefined : decodeRecordDocument(rj), run = uj === undefined ? undefined : decodeRunDocument(uj);
  if (record === undefined || run === undefined || Result.isFailure(record) || Result.isFailure(run) || run.success.runId !== core.runId) return undefined;
  const attempts: AttemptDocument[] = [], members: MemberDocument[] = [];
  for (const value of core.attempts) { const json = parseJson(value.coreBytes), decoded = json === undefined ? undefined : decodeAttemptDocument(json); if (decoded === undefined || Result.isFailure(decoded)) return undefined; attempts.push(decoded.success); }
  for (const value of core.members) { const json = parseJson(value.coreBytes), decoded = json === undefined ? undefined : decodeMemberDocument(json); if (decoded === undefined || Result.isFailure(decoded)) return undefined; members.push(decoded.success); }
  return Object.freeze({ record: record.success, run: run.success, attempts: Object.freeze(attempts), members: Object.freeze(members) });
}
function readCore(runtime: ReaderRuntime, runId: RunId): Effect.Effect<SealedRunCore | undefined, RecordReaderReadError> {
  if (runtime.lifecycle.closed) return Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" })); const cached = runtime.coreCache.get(runId);
  return cached === undefined ? sqliteEffect(() => runtime.client.readSealedRunCore(runId)).pipe(Effect.tap((core) => Effect.sync(() => { if (core !== undefined) runtime.coreCache.set(runId, core); }))) : Effect.succeed(cached);
}
function runRef(runtime: ReaderRuntime, runId: RunId): SelectedRunRef {
  const old = runtime.runRefs.get(runId); if (old !== undefined) return old; const ref: SelectedRunRef = Object.freeze({ runId, [selectedRunRefBrand]: () => undefined }); runtime.runRefs.set(runId, ref); runtime.runs.set(ref, runId); return ref;
}
function attemptRef(runtime: ReaderRuntime, runId: RunId, attemptId: AttemptId): SelectedAttemptRef {
  const key = hashCanonicalTuple("niceeval.record.attempt-ref/v1", [runId, attemptId]), old = runtime.attemptRefs.get(key); if (old !== undefined) return old;
  const ref: SelectedAttemptRef = Object.freeze({ originRunId: runId, attemptId, [selectedAttemptRefBrand]: () => undefined }); runtime.attemptRefs.set(key, ref); runtime.attempts.set(ref, { runId, attemptId }); selectedAttemptCapabilities.set(ref, { root: runtime.root, lifecycle: runtime.lifecycle }); return ref;
}
function ownerRef<Owner extends "run" | "attempt">(runtime: ReaderRuntime, owner: Extract<OwnerRuntime, { readonly kind: Owner }>): SelectedOwnerRef<Owner> { const ref: SelectedOwnerRef<Owner> = Object.freeze({ [selectedOwnerRefBrand]: () => undefined }); runtime.owners.set(ref, owner); return ref; }
function readRun(runtime: ReaderRuntime, ref: SelectedRunRef): Effect.Effect<RecordCoreRead<ReadableRun>, RecordReaderReadError> {
  if (runtime.lifecycle.closed) return Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
  const runId = runtime.runs.get(ref); if (runId === undefined) return Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" }));
  return Effect.map(readCore(runtime, runId), (core): RecordCoreRead<ReadableRun> => { if (core === undefined) return Object.freeze({ state: "missing" }); const decoded = decodeCore(core); if (decoded === undefined) return Object.freeze({ state: "core-invalid", issues: invalidIssues(["run"]) }); return Object.freeze({ state: "available", value: Object.freeze({ ref, owner: ownerRef(runtime, { kind: "run", runId }), document: decoded.run, members: Object.freeze(decoded.members.map((document) => Object.freeze({ document, attempt: document.attempt === null ? null : attemptRef(runtime, document.attempt.originRunId, document.attempt.attemptId) }))) }) }); });
}
function readAttempt(runtime: ReaderRuntime, ref: SelectedAttemptRef): Effect.Effect<RecordCoreRead<ReadableAttempt>, RecordReaderReadError> {
  if (runtime.lifecycle.closed) return Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
  const location = runtime.attempts.get(ref); if (location === undefined) return Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" }));
  return Effect.map(readCore(runtime, location.runId), (core): RecordCoreRead<ReadableAttempt> => { if (core === undefined) return Object.freeze({ state: "missing" }); const decoded = decodeCore(core); if (decoded === undefined) return Object.freeze({ state: "core-invalid", issues: invalidIssues(["attempt"]) }); const document = decoded.attempts.find(({ attemptId }) => attemptId === location.attemptId); if (document === undefined) return Object.freeze({ state: "missing" }); return Object.freeze({ state: "available", value: Object.freeze({ ref, owner: ownerRef(runtime, { kind: "attempt", runId: location.runId, attemptId: location.attemptId }), document, origin: Object.freeze({ owner: ownerRef(runtime, { kind: "run", runId: location.runId }), runId: location.runId, experimentId: decoded.run.experimentId, startedAt: decoded.run.startedAt, context: decoded.run.context }) }) }); });
}
function findAttachment(core: SealedRunCore, owner: OwnerRuntime, family: string): SealedAttachmentMetadata | undefined { return core.attachments.find((a) => a.family === family && a.ownerKind === owner.kind && (owner.kind === "run" || a.ownerAttemptId === owner.attemptId)); }
function contentStream(runtime: ReaderRuntime, handle: RecordContentHandle): Stream.Stream<Uint8Array, RecordReaderReadError> {
  if (runtime.lifecycle.closed) return Stream.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
  const metadata = runtime.content.get(handle); if (metadata === undefined) return Stream.fail(new RecordHandleInvalid({ code: "record-handle-invalid" }));
  return Stream.unwrap(Effect.suspend(() => {
    if (runtime.lifecycle.closed) return Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
    const hash = createHash("sha256");
    type ContentReadState = { readonly after: number; readonly ordinal: number; readonly byteLength: number };
    return Effect.succeed(Stream.paginate<ContentReadState, Uint8Array, RecordReaderReadError>({ after: -1, ordinal: 0, byteLength: 0 }, (state): Effect.Effect<readonly [readonly Uint8Array[], Option.Option<ContentReadState>], RecordReaderReadError> => {
      if (runtime.lifecycle.closed) return Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
      return sqliteEffect(() => runtime.client.readContentChunkPage(metadata.contentId, state.after, CONTENT_READ_PAGE_ROWS)).pipe(Effect.flatMap((page): Effect.Effect<readonly [readonly Uint8Array[], Option.Option<ContentReadState>], RecordReaderReadError> => {
        if (page.chunks.length === 0) {
          return state.ordinal === metadata.chunkCount && state.byteLength === metadata.byteLength && hash.digest("hex") === metadata.digest
            ? Effect.succeed([[], Option.none()] as const)
            : Effect.fail(new SqliteRecordError("record-content-invalid", "read-content", "Content closure does not match sealed metadata"));
        }
        let ordinal = state.ordinal; let byteLength = state.byteLength;
        const output: Uint8Array[] = [];
        for (const chunk of page.chunks) {
          if (chunk.ordinal !== ordinal || digest(chunk.bytes) !== chunk.chunkDigest) return Effect.fail(new SqliteRecordError("record-content-invalid", "read-content", "Content chunk inventory is invalid"));
          const bytes = chunk.bytes; hash.update(bytes); byteLength += bytes.byteLength; ordinal += 1; output.push(bytes);
        }
        const after = page.chunks[page.chunks.length - 1]!.ordinal;
        return Effect.succeed([output, Option.some({ after, ordinal, byteLength })] as const);
      }));
    }));
  }));
}
function contentReader(runtime: ReaderRuntime): RecordAttachmentContentReader {
  const byteLength = (handle: RecordContentHandle): Effect.Effect<number, RecordReaderReadError> => { if (runtime.lifecycle.closed) return Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" })); const metadata = runtime.content.get(handle); return metadata === undefined ? Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" })) : Effect.succeed(metadata.byteLength); };
  const bytes = (handle: RecordContentHandle): Effect.Effect<Uint8Array, RecordReaderReadError> => Effect.flatMap(byteLength(handle), (size) => size > WHOLE_VALUE_MAX_BYTES ? Effect.fail(new RecordResourceLimitExceeded({ code: "record-resource-limit-exceeded", resource: "file-bytes", maximum: WHOLE_VALUE_MAX_BYTES, observedAtLeast: size, path: "content" })) : Stream.runCollect(contentStream(runtime, handle)).pipe(Effect.map((chunks) => { const output = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output; })));
  return Object.freeze({ byteLength, bytes, text: (handle: RecordTextContentHandle) => !isRecordTextContentHandle(handle) ? Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" })) : Effect.flatMap(bytes(handle), (value) => Effect.try({ try: () => new TextDecoder("utf-8", { fatal: true }).decode(value), catch: () => new RecordHandleInvalid({ code: "record-handle-invalid" }) })), stream: (handle: RecordContentHandle) => contentStream(runtime, handle) });
}
function hydrateAttachment(runtime: ReaderRuntime, attachment: SealedAttachmentMetadata, persistence: AnyPersistence): RecordAttachmentRead<unknown> {
  if (attachment.familyRevision !== persistence.revision) return Object.freeze({ state: "unsupported", family: attachment.family, revision: attachment.familyRevision });
  const payload = parseJson(attachment.canonicalBytes); if (payload === undefined) return Object.freeze({ state: "invalid", issues: invalidIssues(["attachment"]) });
  if (digest(attachment.canonicalBytes) !== attachment.canonicalDigest || digest(attachment.logicalInventoryBytes) !== attachment.inventoryDigest) return Object.freeze({ state: "invalid", issues: invalidIssues(["attachment", "digest"]) });
  const byHandle = new Map(attachment.contents.map((content) => [content.logicalHandle, content])), used = new Set<string>();
  const hydrated = hydrateRecordAttachmentCurrent(persistence.attachment, payload, { content: (token, declaration) => { const logicalHandle = exactMarker(token, "$niceeval.record.content"); if (logicalHandle === undefined && !hasOwnMarker(token, "$niceeval.record.content")) return Result.succeed(undefined); const metadata = typeof logicalHandle === "string" ? byHandle.get(logicalHandle) : undefined; if (metadata === undefined || declaration.maximumBytes !== undefined && metadata.byteLength > declaration.maximumBytes) return Result.fail({ code: "current-content-bind-failed" as const }); const handle = mintRecordContentHandle(declaration.kind); runtime.content.set(handle, metadata); used.add(logicalHandle as string); return Result.succeed(handle); }, reference: (token, declaration) => { const marker = exactMarker(token, "$niceeval.record.reference"); if (marker === undefined && !hasOwnMarker(token, "$niceeval.record.reference")) return Result.succeed(undefined); if (typeof marker !== "object" || marker === null || Array.isArray(marker)) return Result.fail({ code: "current-reference-bind-failed" as const }); const value = marker as Record<string, unknown>; if (value.owner !== declaration.definition.owner || value.family !== declaration.definition.family || !("value" in value)) return Result.fail({ code: "current-reference-bind-failed" as const }); return Result.succeed(mintRecordAttachmentReference(RecordAttachmentReference.to(declaration.definition, declaration.valueSchema), value.value)); } });
  if (Result.isFailure(hydrated) || used.size !== attachment.contents.length) return Object.freeze({ state: "invalid", issues: invalidIssues(["closure"]) });
  const closure = enumerateRecordAttachmentClosure(persistence.attachment, hydrated.success);
  if (Result.isFailure(closure)) return Object.freeze({ state: "invalid", issues: invalidIssues(["closure"]) });
  const logicalReferences = new Map<string, { readonly owner: RecordAttachmentOwner; readonly family: string }>();
  for (const reference of closure.success.references) {
    const wire = recordAttachmentReferenceWire(reference); if (wire === undefined) return Object.freeze({ state: "invalid", issues: invalidIssues(["reference"]) });
    logicalReferences.set(hashCanonicalTuple("niceeval.record.reference-family/v1", [wire.owner, wire.family]), Object.freeze({ owner: wire.owner, family: wire.family }));
  }
  const ordered = [...logicalReferences.values()].sort((left, right) =>
    compareCanonicalCodeUnits(left.owner, right.owner) || compareCanonicalCodeUnits(left.family, right.family));
  if (ordered.length !== attachment.references.length) return Object.freeze({ state: "invalid", issues: invalidIssues(["reference", "count"]) });
  for (let ordinal = 0; ordinal < ordered.length; ordinal += 1) {
    const logical = ordered[ordinal]!, physical = attachment.references[ordinal]!, canonical = canonicalBytes(logical);
    if (canonical === undefined || physical.ordinal !== ordinal || physical.owner !== logical.owner || physical.family !== logical.family || !bytesEqual(physical.canonicalBytes, canonical) || digest(physical.canonicalBytes) !== physical.referenceDigest) return Object.freeze({ state: "invalid", issues: invalidIssues(["reference", String(ordinal)]) });
  }
  return Object.freeze({ state: "available", value: hydrated.success, content: contentReader(runtime) });
}
function readFamily(runtime: ReaderRuntime, ownerValue: SelectedOwnerRef, definition: unknown): Effect.Effect<RecordAttachmentRead<unknown>, RecordReaderReadError> {
  if (runtime.lifecycle.closed) return Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
  const owner = runtime.owners.get(ownerValue); if (owner === undefined) return Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" })); const resolved = recordDefinitionAttachment(definition) ?? resolveRecordAttachmentDefinition(definition); if (resolved === undefined || resolved.owner !== owner.kind) return Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" })); const persistence = runtime.catalog.persistence(resolved); if (persistence === undefined) return Effect.fail(new FamilyDefinitionRequired({ code: "family-definition-required", owner: owner.kind, family: resolved.family, revision: 1 }));
  return Effect.map(readCore(runtime, owner.runId), (core) => { if (core === undefined) return Object.freeze({ state: "not-recorded" as const }); const attachment = findAttachment(core, owner, resolved.family); return attachment === undefined ? Object.freeze({ state: "not-recorded" as const }) : hydrateAttachment(runtime, attachment, persistence as AnyPersistence); });
}
function collectionStream(runtime: ReaderRuntime, attachment: SealedAttachmentMetadata, authoring: AttemptRecordCollectionRuntime, expectedDigest: string): Stream.Stream<unknown, RecordReaderReadError> {
  if (runtime.lifecycle.closed) return Stream.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
  return Stream.unwrap(Effect.suspend(() => {
    if (runtime.lifecycle.closed) return Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
    const hash = createHash("sha256");
    type CollectionReadState = { readonly after: number; readonly ordinal: number; readonly byteLength: number };
    return Effect.succeed(Stream.paginate<CollectionReadState, unknown, RecordReaderReadError>({ after: -1, ordinal: 0, byteLength: 0 }, (state): Effect.Effect<readonly [readonly unknown[], Option.Option<CollectionReadState>], RecordReaderReadError> => {
      if (runtime.lifecycle.closed) return Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
      return sqliteEffect(() => runtime.client.readCollectionItemPage(attachment.attachmentId, state.after, RECORD_SQLITE_MAX_PAGE_ROWS)).pipe(Effect.flatMap((page): Effect.Effect<readonly [readonly unknown[], Option.Option<CollectionReadState>], RecordReaderReadError> => {
        if (page.items.length === 0) {
          return state.ordinal === attachment.collectionItemCount && state.byteLength === attachment.collectionItemByteLength && hash.digest("hex") === expectedDigest
            ? Effect.succeed([[], Option.none()] as const)
            : Effect.fail(new SqliteRecordError("record-content-invalid", "read-collection", "Collection closure does not match sealed metadata"));
        }
        let ordinal = state.ordinal; let byteLength = state.byteLength;
        const output: unknown[] = [];
        for (const item of page.items) {
          const value = parseJson(item.canonicalBytes), canonicalDigest = digest(item.canonicalBytes);
          if (item.ordinal !== ordinal || canonicalDigest !== item.canonicalDigest || item.logicalIdentity !== hashCanonicalTuple("niceeval.record.collection-item-logical-identity/v1", [ordinal, canonicalDigest]) || value === undefined) return Effect.fail(new SqliteRecordError("record-content-invalid", "read-collection", "Collection item inventory is invalid"));
          if (!isRecordAttachmentSchema(authoring.item)) return Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" }));
          const decoded = Schema.decodeUnknownResult(authoring.item)(value); if (Result.isFailure(decoded)) return Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" }));
          hash.update(item.canonicalBytes).update("\n"); byteLength += item.canonicalBytes.byteLength; ordinal += 1; output.push(decoded.success);
        }
        const after = page.items[page.items.length - 1]!.ordinal;
        return Effect.succeed([output, Option.some({ after, ordinal, byteLength })] as const);
      }));
    }));
  }));
}
type OpenCollectionResult =
  | { readonly state: "not-recorded" }
  | { readonly state: "unsupported"; readonly family: string; readonly revision: number }
  | { readonly state: "invalid"; readonly issues: NonEmptyRecordIssues }
  | { readonly state: "available"; readonly collection: unknown; readonly logicalIdentity: string; readonly logicalSealIdentity: string; readonly count: number; readonly digest: string; readonly canonicalBytes: number; readonly items: Stream.Stream<unknown, RecordReaderReadError> };
type PublicOpenCollectionResult =
  | Exclude<OpenCollectionResult, { readonly state: "available" }>
  | Omit<Extract<OpenCollectionResult, { readonly state: "available" }>, "canonicalBytes">;
function publicOpenCollectionResult(opened: OpenCollectionResult): PublicOpenCollectionResult {
  if (opened.state !== "available") return opened;
  return Object.freeze({
    state: "available",
    collection: opened.collection,
    logicalIdentity: opened.logicalIdentity,
    logicalSealIdentity: opened.logicalSealIdentity,
    count: opened.count,
    digest: opened.digest,
    items: opened.items,
  });
}
function openCollection(runtime: ReaderRuntime, ownerValue: SelectedOwnerRef<"attempt">, definition: unknown): Effect.Effect<OpenCollectionResult, RecordReaderReadError> {
  if (runtime.lifecycle.closed) return Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
  const owner = runtime.owners.get(ownerValue), authoring = attemptRecordCollectionRuntime(definition); if (owner === undefined || owner.kind !== "attempt" || authoring === undefined) return Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" }));
  return Effect.map(readCore(runtime, owner.runId), (core) => {
    if (core === undefined) return Object.freeze({ state: "not-recorded" }); const attachment = findAttachment(core, owner, authoring.attachment.family); if (attachment === undefined) return Object.freeze({ state: "not-recorded" });
    if (attachment.familyRevision !== authoring.persistence.revision) return Object.freeze({ state: "unsupported", family: attachment.family, revision: attachment.familyRevision });
    if (digest(attachment.canonicalBytes) !== attachment.canonicalDigest || digest(attachment.logicalInventoryBytes) !== attachment.inventoryDigest) return Object.freeze({ state: "invalid", issues: invalidIssues(["collection", "digest"]) });
    const payload = parseJson(attachment.canonicalBytes) as { readonly collection?: unknown } | undefined;
    const inventory = parseJson(attachment.logicalInventoryBytes) as { readonly collection?: { readonly count?: unknown; readonly byteLength?: unknown; readonly digest?: unknown } } | undefined;
    const collection = inventory?.collection;
    if (payload?.collection === undefined || collection === undefined || collection.count !== attachment.collectionItemCount || collection.byteLength !== attachment.collectionItemByteLength || typeof collection.digest !== "string") return Object.freeze({ state: "invalid", issues: invalidIssues(["collection"]) });
    return Object.freeze({ state: "available", collection: payload.collection, logicalIdentity: attachment.logicalIdentity, logicalSealIdentity: core.logicalSealIdentity, count: attachment.collectionItemCount, digest: collection.digest, canonicalBytes: attachment.collectionItemByteLength, items: collectionStream(runtime, attachment, authoring, collection.digest) });
  });
}
function readCollectionWhole(runtime: ReaderRuntime, owner: SelectedOwnerRef<"attempt">, definition: unknown): Effect.Effect<RecordAttachmentRead<unknown>, RecordReaderReadError> {
  return Effect.flatMap(openCollection(runtime, owner, definition), (opened): Effect.Effect<RecordAttachmentRead<unknown>, RecordReaderReadError> => {
    if (opened.state !== "available") return Effect.succeed(opened);
    if (opened.count > COLLECTION_READ_MAX_ROWS || opened.canonicalBytes > WHOLE_VALUE_MAX_BYTES) return Effect.fail(new RecordResourceLimitExceeded({ code: "record-resource-limit-exceeded", resource: "file-bytes", maximum: WHOLE_VALUE_MAX_BYTES, observedAtLeast: opened.canonicalBytes, path: "collection" }));
    return Stream.runCollect(opened.items).pipe(Effect.map((items): RecordAttachmentRead<unknown> => Object.freeze({ state: "available", value: Object.freeze({ collection: opened.collection, items: Object.freeze(items) }), content: contentReader(runtime) })));
  });
}

function makeReadSession(runtime: ReaderRuntime): RecordReadSession {
  const selectRuns: RecordReadSession["selectRuns"] = (request?: RecordSelectionRequest) => Effect.gen(function* () {
    if (runtime.lifecycle.closed) return yield* Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
    const requested = request?.runIds === undefined ? undefined : new Set(request.runIds); const cores: { readonly core: SealedRunCore; readonly decoded: NonNullable<ReturnType<typeof decodeCore>> }[] = []; let after = "";
    while (true) {
      const page = yield* sqliteEffect(() => runtime.client.listSealedRunSummaries(after, 100)); if (page.length === 0) break;
      for (const summary of page) { after = summary.runId; if (requested !== undefined && !requested.has(summary.runId as RunId)) continue; const core = yield* readCore(runtime, summary.runId as RunId); if (core === undefined) continue; const decoded = decodeCore(core); if (decoded !== undefined) cores.push({ core, decoded }); }
      if (page.length < 100) break;
    }
    const problems: RecordSelectionProblem[] = []; if (requested !== undefined) for (const id of requested) if (!cores.some(({ core }) => core.runId === id)) problems.push(Object.freeze({ code: "selection-run-missing", runId: id }));
    const runRefs = cores.map(({ core }) => runRef(runtime, core.runId as RunId)); const runFacts: SelectedRunFacts[] = cores.map(({ core, decoded }) => Object.freeze({ run: runRef(runtime, core.runId as RunId), experimentId: decoded.run.experimentId, startedAt: decoded.run.startedAt, completedAt: decoded.run.completedAt, expectedSlots: decoded.run.expectedSlots }));
    for (const { core, decoded } of cores) for (const attempt of decoded.attempts) attemptRef(runtime, core.runId as RunId, attempt.attemptId);
    const selection: RecordSelection = Object.freeze({ runRefs: Object.freeze(runRefs), runFacts: Object.freeze(runFacts), expectedSlots: Object.freeze(runFacts.flatMap(({ run, experimentId, expectedSlots }) => expectedSlots.map((slot) => Object.freeze({ run, experimentId, slot })))), problems: Object.freeze(problems), warnings: Object.freeze([]) as readonly RecordWarning[] }); runtime.selections.add(selection); return selection;
  });
  const readRunEntry: RecordReadSession["readRun"] = (ref: SelectedRunRef) => readRun(runtime, ref);
  const readAttemptEntry: RecordReadSession["readAttempt"] = (ref: SelectedAttemptRef) => readAttempt(runtime, ref);
  const openCollectionEntry = ((owner: SelectedOwnerRef<"attempt">, definition: unknown) => Effect.map(openCollection(runtime, owner, definition), publicOpenCollectionResult)) as RecordReadSession["openCollection"];
  const requireComplete: RecordReadSession["requireComplete"] = (selection: RecordSelection) => Effect.gen(function* () {
    if (runtime.lifecycle.closed) return yield* Effect.fail(new RecordReaderClosed({ code: "record-reader-closed" }));
    if (!runtime.selections.has(selection)) return yield* Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" }));
    if (selection.problems.length > 0) return yield* Effect.fail(new RecordSealIncomplete({ code: "record-seal-incomplete", reason: "selection-invalid" }));
    for (const ref of selection.runRefs) {
      const runId = runtime.runs.get(ref); if (runId === undefined) return yield* Effect.fail(new RecordHandleInvalid({ code: "record-handle-invalid" }));
      const core = yield* readCore(runtime, runId); if (core === undefined) return yield* Effect.fail(new RecordSealIncomplete({ code: "record-seal-incomplete", reason: "inventory-invalid" }));
      const attemptIds = new Set(core.attempts.map(({ attemptId }) => attemptId));
      for (const attachment of core.attachments) {
        if (attachment.ownerRunId !== core.runId || attachment.ownerKind === "attempt" && (attachment.ownerAttemptId === undefined || !attemptIds.has(attachment.ownerAttemptId))) return yield* Effect.fail(new RecordSealIncomplete({ code: "record-seal-incomplete", reason: "inventory-invalid", family: attachment.family }));
        const persistence = runtime.catalog.get(attachment.ownerKind, attachment.family);
        if (persistence === undefined) return yield* Effect.fail(new FamilyDefinitionRequired({ code: "family-definition-required", owner: attachment.ownerKind, family: attachment.family, revision: attachment.familyRevision }));
        for (const reference of attachment.references) if (runtime.catalog.get(reference.owner, reference.family) === undefined) return yield* Effect.fail(new FamilyDefinitionRequired({ code: "family-definition-required", owner: reference.owner, family: reference.family, revision: 1 }));
        const hydrated = hydrateAttachment(runtime, attachment, persistence as AnyPersistence);
        if (hydrated.state !== "available") return yield* Effect.fail(new RecordSealIncomplete({ code: "record-seal-incomplete", reason: "attachment-invalid", family: attachment.family }));
      }
    }
    return Object.freeze({ selection, attachments: runtime.catalog }) satisfies RecordCompleteView;
  });
  return Object.freeze({
    selectRuns,
    readRun: readRunEntry,
    readAttempt: readAttemptEntry,
    read: ((owner: SelectedOwnerRef, definition: unknown) => attemptRecordCollectionRuntime(definition) !== undefined ? readCollectionWhole(runtime, owner as SelectedOwnerRef<"attempt">, definition) : readFamily(runtime, owner, definition)) as RecordReadSession["read"],
    openCollection: openCollectionEntry,
    requireComplete,
  });
}
function openRead(root: RecordRoot, catalog: RecordAttachmentCatalog): Effect.Effect<RecordReadSession, RecordReaderOpenError, import("effect").Scope.Scope> {
  return Effect.gen(function* () {
    const rootPath = storageRoot(root); if (rootPath === undefined) return yield* Effect.fail(new RecordBootstrapInvalid({ code: "record-bootstrap-invalid", reason: "record-document-invalid" }));
    const client = yield* openStorageWorker(rootPath); const lifecycle: ReaderLifecycle = { closed: false };
    const runtime: ReaderRuntime = { root, client, catalog, lifecycle, runs: new WeakMap(), attempts: new WeakMap(), owners: new WeakMap(), selections: new WeakSet(), coreCache: new Map(), runRefs: new Map(), attemptRefs: new Map(), content: new WeakMap() };
    yield* Effect.addFinalizer(() => Effect.sync(() => { lifecycle.closed = true; })); return makeReadSession(runtime);
  });
}
function closeMaintenanceFailure(error: { readonly code?: string }): RecordMaintenanceOperationFailure { return Object.freeze({ _tag: "RecordMaintenanceOperationFailed", code: error.code ?? "record-maintenance-failed" }); }
interface IssuedMigrationPlan {
  readonly path: string;
  readonly fromRevision: number;
  readonly toRevision: number;
}

const issuedMigrationPlans = new WeakMap<object, IssuedMigrationPlan>();
const operationMigrationPlans = new WeakMap<object, RecordMigrationPlan>();

function inspectMaintenanceDatabase(root: RecordRoot): Effect.Effect<ProjectRecordDatabaseInspection, SqliteRecordError> {
  const rootPath = storageRoot(root);
  if (rootPath === undefined) {
    return Effect.fail(new SqliteRecordError("record-database-invalid", "locate", "Record root is invalid"));
  }
  return Effect.try({
    try: () => inspectProjectRecordDatabase(recordSqlitePath(rootPath)),
    catch: (cause) => cause instanceof SqliteRecordError
      ? cause
      : new SqliteRecordError("record-sqlite-error", "inspect-maintenance", "Record maintenance inspection failed", { cause }),
  });
}

function publicFormatInspection(inspection: ProjectRecordDatabaseInspection) {
  switch (inspection.state) {
    case "current":
      return Object.freeze({ state: "already-current" as const, format: RECORD_FORMAT });
    case "migration-required":
      return Object.freeze({ state: "migration-required" as const, format: RECORD_FORMAT });
    case "unsupported":
      return Object.freeze({ state: "unsupported-format" as const, format: inspection.format });
    case "foreign":
      return Object.freeze({ state: "unsupported-format" as const, format: "foreign-sqlite" });
  }
}

function migrationPlan(root: RecordRoot, inspection: ProjectRecordDatabaseInspection) {
  switch (inspection.state) {
    case "current":
      return Object.freeze({ state: "already-current" as const, format: RECORD_FORMAT });
    case "migration-required": {
      // Revision 1 has no 0.13.x converter. This branch only describes a
      // same-format predecessor; apply remains fail-closed until a checked-in
      // adjacent physical migration exists.
      const plan = Object.freeze({
        state: "migration-required" as const,
        format: RECORD_FORMAT,
        sourceFormat: RECORD_FORMAT,
        attachments: Object.freeze([]),
        pendingSeals: Object.freeze([]),
        resumedSteps: 0,
      });
      const rootPath = storageRoot(root);
      if (rootPath !== undefined) {
        issuedMigrationPlans.set(plan, Object.freeze({
          path: recordSqlitePath(rootPath),
          fromRevision: inspection.fromRevision,
          toRevision: inspection.toRevision,
        }));
      }
      return plan;
    }
    case "unsupported":
      return Object.freeze({ state: "unsupported-format" as const, format: inspection.format });
    case "foreign":
      return Object.freeze({ state: "unsupported-format" as const, format: "foreign-sqlite" });
  }
}

function maintenanceSession(root: RecordRoot): Effect.Effect<RecordMaintenanceSession, RecordMaintenanceOpenError, import("effect").Scope.Scope | RecordCoordination> {
  return Effect.gen(function* () {
    const first = yield* inspectMaintenanceDatabase(root);
    if (first.state === "current" && first.exists) {
      const coordination = yield* RecordCoordination;
      yield* coordination.enterRecordMaintenance(root);
    }
    const inspect = () => inspectMaintenanceDatabase(root);
    return Object.freeze({
      inspect: () => Effect.map(inspect(), publicFormatInspection),
      planMigrate: () => Effect.map(inspect(), (inspection) => migrationPlan(root, inspection)),
      applyMigrate: (plan: RecordMigrationPlan) => Effect.gen(function* () {
        if (plan.state === "already-current") {
          return Object.freeze({ state: "already-current" as const, format: RECORD_FORMAT });
        }
        if (plan.state === "unsupported-format") {
          return yield* Effect.fail(new RecordFormatUnsupported({
            code: "record-format-unsupported",
            format: plan.format,
          }));
        }
        const issued = issuedMigrationPlans.get(plan);
        const rootPath = storageRoot(root);
        if (issued === undefined || rootPath === undefined || issued.path !== recordSqlitePath(rootPath)) {
          return yield* Effect.fail(new RecordMigrationPlanStale({ code: "record-migration-plan-stale" }));
        }
        const current = yield* inspect();
        if (current.state === "current") {
          return Object.freeze({ state: "already-current" as const, format: RECORD_FORMAT });
        }
        if (current.state !== "migration-required") {
          return yield* Effect.fail(new RecordFormatUnsupported({
            code: "record-format-unsupported",
            format: current.state === "unsupported" ? current.format : "foreign-sqlite",
          }));
        }
        if (current.fromRevision !== issued.fromRevision || current.toRevision !== issued.toRevision) {
          return yield* Effect.fail(new RecordMigrationPlanStale({ code: "record-migration-plan-stale" }));
        }
        return yield* Effect.fail(new RecordMigrationInvalid({
          code: "record-migration-invalid",
          family: "project-database-storage",
        }));
      }),
    });
  });
}

export function makeRecordHost(input: { readonly records: readonly RecordContribution[] }): RecordHostSDK {
  const persistences = input.records.map((record) => { const runtime = recordContributionRuntime(record); if (runtime === undefined) throw new TypeError("invalid Record contribution"); return runtime.persistence; }); const composed = makeRecordAttachmentCatalog(persistences); if (Result.isFailure(composed)) throw new TypeError(`invalid Record composition: ${composed.failure.code}`); const catalog = composed.success;
  const currentOpenRead: RecordHostSDK["current"]["openRead"] = ({ root }) => openRead(root, catalog);
  const currentCreateRun: RecordHostSDK["current"]["createRun"] = (request) => openNewRuntime(request, catalog, false) as ReturnType<RecordHostSDK["current"]["createRun"]>;
  const currentCreateReferenceRun: RecordHostSDK["current"]["createReferenceRun"] = (request) => openNewRuntime(request, catalog, true) as ReturnType<RecordHostSDK["current"]["createReferenceRun"]>;
  const current: RecordHostSDK["current"] = Object.freeze({ openRead: currentOpenRead, createRun: currentCreateRun, createReferenceRun: currentCreateReferenceRun });
  const normalize = (request: CreateRunRequest | { readonly root: RecordRoot; readonly core: Omit<CreateRunRequest, "root"> }): CreateRunRequest => "core" in request ? Object.freeze({ root: request.root, ...request.core }) : request;
  const createRunPublic: RecordHostSDK["createRun"] = (request) => current.createRun(normalize(request));
  const createReferenceRunPublic: RecordHostSDK["createReferenceRun"] = (request) => current.createReferenceRun(normalize(request));
  const planClean: RecordHostSDK["maintenance"]["planClean"] = (request) => inspectIncompleteRuns(request).pipe(Effect.map((runs): RecordCleanOperationPlan => runs.length === 0 ? Object.freeze({ _tag: "RecordCleanAlreadyClean" }) : Object.freeze({ _tag: "RecordCleanConfirmationRequired", runIds: Object.freeze(runs.map(({ runId }) => runId)) })), Effect.mapError(closeMaintenanceFailure));
  const applyClean: RecordHostSDK["maintenance"]["applyClean"] = ({ root, plan }) => cleanIncompleteRuns({ root, runIds: plan.runIds }).pipe(Effect.map((receipt): RecordCleanOperationReceipt => Object.freeze({ _tag: "RecordCleanApplied", ...receipt })), Effect.mapError(closeMaintenanceFailure));
  const planMigrate: RecordHostSDK["maintenance"]["planMigrate"] = ({ root }) => Effect.scoped(
    Effect.flatMap(maintenanceSession(root), (session) => session.planMigrate()),
  ).pipe(
    Effect.map((plan): RecordMigrateOperationPlan => {
      if (plan.state === "already-current") {
        return Object.freeze({ _tag: "RecordMigrationAlreadyCurrent", format: RECORD_FORMAT });
      }
      if (plan.state === "unsupported-format") {
        return Object.freeze({ _tag: "RecordMigrationUnsupported", format: plan.format });
      }
      const operationPlan = Object.freeze({
        _tag: "RecordMigrationReady" as const,
        format: plan.format,
        sourceFormat: plan.sourceFormat,
        attachments: plan.attachments,
        pendingSeals: plan.pendingSeals,
        resumedSteps: plan.resumedSteps,
      });
      operationMigrationPlans.set(operationPlan, plan);
      return operationPlan;
    }),
    Effect.mapError(closeMaintenanceFailure),
  );
  const applyMigrate: RecordHostSDK["maintenance"]["applyMigrate"] = ({ root, plan }) => {
    const internal = operationMigrationPlans.get(plan);
    if (internal === undefined) {
      return Effect.fail(Object.freeze({
        _tag: "RecordMigrationPlanStale" as const,
        code: "record-migration-plan-stale" as const,
      }));
    }
    return Effect.scoped(Effect.flatMap(
      maintenanceSession(root),
      (session) => session.applyMigrate(internal),
    )).pipe(
      Effect.map((receipt): RecordMigrateOperationReceipt => receipt.state === "already-current"
        ? Object.freeze({ _tag: "RecordMigrationAlreadyCurrent", format: RECORD_FORMAT })
        : Object.freeze({
            _tag: "RecordMigrationApplied",
            format: receipt.format,
            attachments: receipt.attachments,
            committed: receipt.committed,
            skipped: receipt.skipped,
            failed: receipt.failed,
            rebuiltSeals: receipt.rebuiltSeals,
          })),
      Effect.mapError(closeMaintenanceFailure),
    );
  };
  const openMaintenance: RecordHostSDK["maintenance"]["open"] = ({ root }) => maintenanceSession(root);
  return Object.freeze({ openRead: current.openRead, createRun: createRunPublic, createReferenceRun: createReferenceRunPublic, current, maintenance: Object.freeze({ planClean, applyClean, planMigrate, applyMigrate, open: openMaintenance }) });
}
export const recordHost: RecordHostSDK = makeRecordHost({ records: (NiceEvalRecordAttachmentPersistences as readonly AnyRecordAttachmentPersistence[]).map((persistence) => recordContributionFromAttachmentPersistence(persistence)) });
