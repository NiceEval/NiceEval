import { isMainThread, parentPort } from "node:worker_threads";
import {
  closeRecordDatabase,
  openRecordWriter,
  recordSqlitePath,
  validateExactSchema,
  type RecordDatabase,
} from "./database.ts";
import {
  appendContentChunks,
  admitAttachment,
  admitAttempt,
  admitContent,
  beginRun,
  finalizeRun,
  fenceRunFinalization,
  listSealedRunSummaries,
  persistSealedRun,
  publishRunSeal,
  prepareRunFinalization,
  readContentChunkPage,
  readCollectionItemPage,
  readSealedRunDocument,
  readSealedRunCore,
  readSealedRunSummary,
  sealRun,
  stageAttachmentReferences,
  stageCollectionItems,
  stageRunFinalMetadata,
  stageSealEntries,
  verifyAllSealedRuns,
} from "./storage.ts";
import { createSealedSnapshot } from "./snapshot.ts";
import type { StorageWorkerRequest, StorageWorkerResponse, StorageWorkerResult } from "./worker-protocol.ts";

function responseTransferList(value: unknown): readonly ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  const seen = new Set<object>();
  const visit = (current: unknown): void => {
    if (typeof current !== "object" || current === null || seen.has(current)) return;
    seen.add(current);
    if (current instanceof Uint8Array) {
      if (current.buffer instanceof ArrayBuffer && !buffers.includes(current.buffer)) {
        buffers.push(current.buffer);
      }
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    for (const item of Object.values(current)) visit(item);
  };
  visit(value);
  return buffers;
}

if (!isMainThread && parentPort !== null) {
  let connection: RecordDatabase | undefined;
  let queue = Promise.resolve();

  const requireConnection = (): RecordDatabase => {
    if (connection === undefined) throw new Error("Record storage worker is not initialized");
    return connection;
  };

  const execute = async (request: StorageWorkerRequest): Promise<StorageWorkerResult> => {
    switch (request.operation) {
      case "initialize":
        if (connection !== undefined) throw new Error("Record storage worker is already initialized");
        connection = openRecordWriter(recordSqlitePath(request.recordStorageRoot), request.busyTimeoutMs);
        return undefined;
      case "persist-sealed-run":
        return persistSealedRun(requireConnection(), request.input);
      case "begin-run":
        beginRun(requireConnection(), request.input);
        return undefined;
      case "admit-attempt":
        admitAttempt(requireConnection(), request.input);
        return undefined;
      case "admit-attachment":
        admitAttachment(requireConnection(), request.input);
        return undefined;
      case "admit-content":
        admitContent(requireConnection(), request.input);
        return undefined;
      case "finalize-run":
        return finalizeRun(requireConnection(), request.input);
      case "stage-final-metadata":
        stageRunFinalMetadata(requireConnection(), request.input);
        return undefined;
      case "prepare-finalization":
        return prepareRunFinalization(requireConnection(), request.input);
      case "fence-finalization":
        return fenceRunFinalization(requireConnection(), request.input);
      case "stage-attachment-references":
        stageAttachmentReferences(requireConnection(), request.input);
        return undefined;
      case "stage-collection-items":
        stageCollectionItems(requireConnection(), request.input);
        return undefined;
      case "stage-seal-entries":
        return stageSealEntries(requireConnection(), request.input);
      case "append-content-chunks":
        appendContentChunks(requireConnection(), request.input);
        // SQLite has synchronously consumed these immutable buffers. Return
        // their ownership to the producer so a bounded pool can reuse them.
        return Object.freeze(request.input.chunks.map((chunk) => chunk.bytes));
      case "seal-run":
        return sealRun(requireConnection(), request.input);
      case "publish-run-seal":
        publishRunSeal(requireConnection(), request.input);
        return undefined;
      case "read-sealed-run-summary":
        return readSealedRunSummary(requireConnection(), request.runId);
      case "list-sealed-run-summaries":
        return listSealedRunSummaries(requireConnection(), request.afterRunId, request.pageSize);
      case "read-collection-item-page":
        return readCollectionItemPage(requireConnection(), request.attachmentId, request.afterOrdinal, request.pageSize);
      case "read-sealed-run-document":
        return readSealedRunDocument(requireConnection(), request.runId);
      case "read-sealed-run-core":
        return readSealedRunCore(requireConnection(), request.runId);
      case "read-content-chunk-page":
        return readContentChunkPage(requireConnection(), request.contentId, request.afterOrdinal, request.pageSize);
      case "create-snapshot":
        return createSealedSnapshot(requireConnection(), request.destination, request.deadlineEpochMs);
      case "validate":
        validateExactSchema(requireConnection());
        return verifyAllSealedRuns(requireConnection());
      case "close":
        if (connection !== undefined) closeRecordDatabase(connection);
        connection = undefined;
        return undefined;
    }
  };

  parentPort.on("message", (request: StorageWorkerRequest) => {
    queue = queue.then(async () => {
      let response: StorageWorkerResponse;
      try {
        response = { id: request.id, state: "success", result: await execute(request) };
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        const code = typeof Reflect.get(error, "code") === "string" ? String(Reflect.get(error, "code")) : "record-sqlite-error";
        const operation = typeof Reflect.get(error, "operation") === "string" ? String(Reflect.get(error, "operation")) : request.operation;
        response = { id: request.id, state: "failure", error: { code, operation, message: error.message, stack: error.stack } };
      }
      // Successful read buffers are handed to main rather than cloned. The
      // worker must not retain or reuse them after this response.
      parentPort!.postMessage(response, responseTransferList(response));
    });
  });
}
