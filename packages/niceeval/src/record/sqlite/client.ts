import { Worker } from "node:worker_threads";
import { Effect, Scope } from "effect";
import { isSqliteRecordErrorCode, SqliteRecordError } from "./errors.ts";
import { recordSqlitePath } from "./database.ts";
import type {
  AppendContentChunksInput,
  AdmitAttachmentInput,
  AdmitAttemptInput,
  AdmitContentInput,
  DiscardAttemptInput,
  BeginRunInput,
  ContentChunkPage,
  CollectionItemPage,
  FenceRunFinalizationInput,
  PersistSealedRunInput,
  PrepareRunFinalizationInput,
  PreparedRunFinalization,
  RunFinalization,
  SealedRunCore,
  SealedRunDocument,
  SealedRunSummary,
  SealRunInput,
  StageAttachmentReferencesInput,
  StageCollectionItemsInput,
  StageSealEntriesInput,
  StageSealEntriesResult,
  StageRunCoreInput,
} from "./types.ts";
import { isStorageWorkerResponse, type CaseCoordinationCommand, type InvocationCommand, type RegistryCommand, type RunCommand, type StorageWorkerRequest, type StorageWorkerResult } from "./worker-protocol.ts";
import type { AdmissionInput } from "../../coordination/platform/node-record-admission-protocol.ts";

export interface StorageWorkerClient {
  readonly persistSealedRun: (input: PersistSealedRunInput) => Promise<SealedRunSummary>;
  readonly beginRun: (input: BeginRunInput) => Promise<void>;
  readonly admitAttempt: (input: AdmitAttemptInput) => Promise<void>;
  readonly discardAttempt: (input: DiscardAttemptInput) => Promise<void>;
  readonly admitAttachment: (input: AdmitAttachmentInput) => Promise<void>;
  readonly admitContent: (input: AdmitContentInput) => Promise<void>;
  readonly finalizeRun: (input: StageRunCoreInput) => Promise<RunFinalization>;
  readonly stageRunFinalMetadata: (input: StageRunCoreInput) => Promise<void>;
  readonly stageRunPublicationMetadata: (input: StageRunCoreInput) => Promise<void>;
  readonly prepareRunFinalization: (input: PrepareRunFinalizationInput) => Promise<PreparedRunFinalization>;
  readonly fenceRunFinalization: (input: FenceRunFinalizationInput) => Promise<RunFinalization>;
  readonly stageAttachmentReferences: (input: StageAttachmentReferencesInput) => Promise<void>;
  readonly stageCollectionItems: (input: StageCollectionItemsInput) => Promise<void>;
  readonly stageSealEntries: (input: StageSealEntriesInput) => Promise<StageSealEntriesResult>;
  /** Returns the exact transferred backing stores after SQLite has consumed them. */
  readonly appendContentChunks: (input: AppendContentChunksInput) => Promise<readonly Uint8Array[]>;
  readonly sealRun: (input: SealRunInput) => Promise<SealedRunSummary>;
  readonly publishRunSeal: (input: SealRunInput) => Promise<void>;
  readonly readSealedRunSummary: (runId: string) => Promise<SealedRunSummary | undefined>;
  readonly listSealedRunSummaries: (afterRunId?: string, pageSize?: number) => Promise<readonly SealedRunSummary[]>;
  readonly readCollectionItemPage: (attachmentId: string, afterOrdinal: number, pageSize: number) => Promise<CollectionItemPage>;
  readonly readSealedRunDocument: (runId: string) => Promise<SealedRunDocument | undefined>;
  readonly readSealedRunCore: (runId: string) => Promise<SealedRunCore | undefined>;
  readonly readContentChunkPage: (contentId: string, afterOrdinal: number, pageSize: number) => Promise<ContentChunkPage>;
  readonly validate: () => Promise<number>;
  readonly registry: <A extends StorageWorkerResult>(command: RegistryCommand, deadlineEpochMs: number) => Promise<A>;
  readonly caseCoordination: <A extends StorageWorkerResult>(command: CaseCoordinationCommand) => Promise<A>;
  readonly invocation: <A extends StorageWorkerResult>(command: InvocationCommand) => Promise<A>;
  readonly run: <A extends StorageWorkerResult>(command: RunCommand) => Promise<A>;
  readonly admission: <A extends StorageWorkerResult>(command: AdmissionInput) => Promise<A>;
  readonly close: () => Promise<void>;
}

type RequestWithoutId = StorageWorkerRequest extends infer Request
  ? Request extends StorageWorkerRequest ? Omit<Request, "id"> : never
  : never;

function ownedArrayBuffer(value: Uint8Array): ArrayBuffer | undefined {
  return value.buffer instanceof ArrayBuffer && value.byteOffset === 0 && value.byteLength === value.buffer.byteLength
    ? value.buffer
    : undefined;
}

/** Buffers listed here are immutable command payloads whose ownership ends at postMessage. */
function requestTransferList(message: RequestWithoutId): readonly ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  const add = (value: Uint8Array): void => {
    const buffer = ownedArrayBuffer(value);
    if (buffer !== undefined && !buffers.includes(buffer)) buffers.push(buffer);
  };
  if (message.operation === "append-content-chunks") {
    for (const chunk of message.input.chunks) add(chunk.bytes);
  } else if (message.operation === "stage-collection-items") {
    for (const item of message.input.items) add(item.canonicalBytes);
  } else if (message.operation === "stage-attachment-references") {
    for (const reference of message.input.references) add(reference.canonicalBytes);
  } else if (message.operation === "stage-final-metadata" || message.operation === "finalize-run") {
    add(message.input.recordCoreBytes);
    add(message.input.runCoreBytes);
    for (const slot of message.input.slots) add(slot.coreBytes);
    for (const attempt of message.input.attempts) add(attempt.coreBytes);
    for (const member of message.input.members) add(member.coreBytes);
    for (const attachment of message.input.attachments) {
      add(attachment.canonicalBytes);
      add(attachment.logicalInventoryBytes);
    }
  }
  return buffers;
}

export async function makeStorageWorkerClient(
  recordStorageRoot: string,
  busyTimeoutMs = 5_000,
  databasePath = recordSqlitePath(recordStorageRoot),
): Promise<StorageWorkerClient> {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const worker = new Worker(new URL(`./storage-worker.${extension}`, import.meta.url), {
    execArgv: (extension === "ts" ? ["--import", "tsx"] : process.execArgv.filter((argument) =>
      !argument.startsWith("--input-type") && argument !== "--expose-gc" &&
      !argument.startsWith("--max-old-space-size") && !argument.startsWith("--max_old_space_size") &&
      !argument.startsWith("--max-semi-space-size") && !argument.startsWith("--max_semi_space_size"))),
  });
  let nextId = 1;
  let closed = false;
  const pending = new Map<number, { readonly resolve: (value: StorageWorkerResult) => void; readonly reject: (cause: unknown) => void }>();

  worker.on("message", (value: unknown) => {
    if (!isStorageWorkerResponse(value)) return;
    const request = pending.get(value.id);
    if (request === undefined) return;
    pending.delete(value.id);
    if (value.state === "success") request.resolve(value.result);
    else request.reject(new SqliteRecordError(
      isSqliteRecordErrorCode(value.error.code) ? value.error.code : "record-sqlite-error",
      value.error.operation,
      value.error.message,
    ));
  });
  const rejectAll = (cause: unknown): void => {
    for (const request of pending.values()) request.reject(cause);
    pending.clear();
  };
  worker.on("error", rejectAll);
  worker.on("exit", (code) => {
    if (!closed) rejectAll(new Error(`Record storage worker exited unexpectedly with code ${code}`));
  });

  const request = <Result extends StorageWorkerResult>(message: RequestWithoutId): Promise<Result> => {
    if (closed) return Promise.reject(new Error("Record storage worker is closed"));
    const id = nextId++;
    return new Promise<Result>((resolve, reject) => {
      pending.set(id, { resolve: (value) => resolve(value as Result), reject });
      worker.postMessage({ ...message, id }, requestTransferList(message));
    });
  };

  await request<undefined>({ operation: "initialize", databasePath, busyTimeoutMs });
  return Object.freeze({
    persistSealedRun: (input: PersistSealedRunInput) => request<SealedRunSummary>({ operation: "persist-sealed-run", input }),
    beginRun: async (input: BeginRunInput) => { await request<undefined>({ operation: "begin-run", input }); },
    admitAttempt: async (input: AdmitAttemptInput) => { await request<undefined>({ operation: "admit-attempt", input }); },
    discardAttempt: async (input: DiscardAttemptInput) => { await request<undefined>({ operation: "discard-attempt", input }); },
    admitAttachment: async (input: AdmitAttachmentInput) => { await request<undefined>({ operation: "admit-attachment", input }); },
    admitContent: async (input: AdmitContentInput) => { await request<undefined>({ operation: "admit-content", input }); },
    finalizeRun: (input: StageRunCoreInput) => request<RunFinalization>({ operation: "finalize-run", input }),
    stageRunFinalMetadata: async (input: StageRunCoreInput) => { await request<undefined>({ operation: "stage-final-metadata", input }); },
    stageRunPublicationMetadata: async (input: StageRunCoreInput) => { await request<undefined>({ operation: "stage-publication-metadata", input }); },
    prepareRunFinalization: (input: PrepareRunFinalizationInput) => request<PreparedRunFinalization>({ operation: "prepare-finalization", input }),
    fenceRunFinalization: (input: FenceRunFinalizationInput) => request<RunFinalization>({ operation: "fence-finalization", input }),
    stageAttachmentReferences: async (input: StageAttachmentReferencesInput) => { await request<undefined>({ operation: "stage-attachment-references", input }); },
    stageCollectionItems: async (input: StageCollectionItemsInput) => { await request<undefined>({ operation: "stage-collection-items", input }); },
    stageSealEntries: (input: StageSealEntriesInput) => request<StageSealEntriesResult>({ operation: "stage-seal-entries", input }),
    appendContentChunks: (input: AppendContentChunksInput) => request<readonly Uint8Array[]>({ operation: "append-content-chunks", input }),
    sealRun: (input: SealRunInput) => request<SealedRunSummary>({ operation: "seal-run", input }),
    publishRunSeal: async (input: SealRunInput) => { await request<undefined>({ operation: "publish-run-seal", input }); },
    readSealedRunSummary: (runId: string) => request<SealedRunSummary | undefined>({ operation: "read-sealed-run-summary", runId }),
    listSealedRunSummaries: (afterRunId = "", pageSize = 100) => request<readonly SealedRunSummary[]>({ operation: "list-sealed-run-summaries", afterRunId, pageSize }),
    readCollectionItemPage: (attachmentId: string, afterOrdinal: number, pageSize: number) => request<CollectionItemPage>({ operation: "read-collection-item-page", attachmentId, afterOrdinal, pageSize }),
    readSealedRunDocument: (runId: string) => request<SealedRunDocument | undefined>({ operation: "read-sealed-run-document", runId }),
    readSealedRunCore: (runId: string) => request<SealedRunCore | undefined>({ operation: "read-sealed-run-core", runId }),
    readContentChunkPage: (contentId: string, afterOrdinal: number, pageSize: number) => request<ContentChunkPage>({ operation: "read-content-chunk-page", contentId, afterOrdinal, pageSize }),
    validate: () => request<number>({ operation: "validate" }),
    registry: <A extends StorageWorkerResult>(command: RegistryCommand, deadlineEpochMs: number) =>
      request<A>({ operation: "registry", command, deadlineEpochMs }),
    caseCoordination: <A extends StorageWorkerResult>(command: CaseCoordinationCommand) =>
      request<A>({ operation: "case-coordination", command }),
    invocation: <A extends StorageWorkerResult>(command: InvocationCommand) =>
      request<A>({ operation: "invocation", command }),
    run: <A extends StorageWorkerResult>(command: RunCommand) => request<A>({ operation: "run", command }),
    admission: <A extends StorageWorkerResult>(command: AdmissionInput) => request<A>({ operation: "admission", command }),
    close: async () => {
      if (closed) return;
      try {
        await request<undefined>({ operation: "close" });
      } finally {
        closed = true;
        rejectAll(new Error("Record storage worker is closed"));
        await worker.terminate();
      }
    },
  });
}

export function openStorageWorker(
  recordStorageRoot: string,
  busyTimeoutMs = 5_000,
  databasePath?: string,
): Effect.Effect<StorageWorkerClient, SqliteRecordError, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: () => makeStorageWorkerClient(recordStorageRoot, busyTimeoutMs, databasePath),
      catch: (cause) => cause instanceof SqliteRecordError
        ? cause
        : new SqliteRecordError("record-sqlite-error", "open-worker", "failed to start Record storage worker", { cause }),
    }),
    (client) => Effect.promise(() => client.close().catch(() => undefined)),
  );
}
