import { isMainThread, parentPort } from "node:worker_threads";
import {
  closeRecordDatabase,
  openRecordWriter,
  validateExactSchema,
  type RecordDatabase,
} from "./database.ts";
import {
  appendContentChunks,
  admitAttachment,
  admitAttempt,
  admitContent,
  discardAttempt,
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
  stageRunPublicationMetadata,
  stageSealEntries,
  verifyAllSealedRuns,
} from "./storage.ts";
import type { StorageWorkerRequest, StorageWorkerResponse, StorageWorkerResult } from "./worker-protocol.ts";
import { withImmediateTransaction } from "./transaction.ts";
import {
  acquireKeptSandboxLease,
  appendSharedStateGeneration,
  claimTeardownObligation,
  deleteKeptSandbox,
  getKeptSandbox,
  getKeptSandboxLease,
  getTeardownObligation,
  listKeptSandboxes,
  listSharedStateGenerations,
  listTeardownObligations,
  putKeptSandbox,
  putTeardownObligation,
  releaseKeptSandboxLease,
  updateKeptSandbox,
  updateSharedStateHeartbeat,
} from "./registry-repository.ts";
import type { RegistryCommand } from "./worker-protocol.ts";
import { executeCaseCommand } from "./case-repository.ts";
import {
  closeInvocationOnConnection,
  createInvocationOnConnection,
  listInvocationsOnConnection,
  updateInvocationActiveProjectionOnConnection,
} from "./coordination-repository.ts";
import type { InvocationCommand } from "./worker-protocol.ts";
import type { RunCommand } from "./worker-protocol.ts";
import {
  bindAttemptReferenceOnConnection,
  closeRunResourceOnConnection,
  createRunResourceOnConnection,
  currentPublicationCutoffOnConnection,
  deleteRunResourceOnConnection,
  publishOriginAttemptOnConnection,
  readPublishedAttemptOnConnection,
  readRunResourceOnConnection,
  recoverRunResourceOnConnection,
  listRunResourcesOnConnection,
} from "../../run/storage/sqlite.ts";
import { executeAdmissionCommand } from "./admission-repository.ts";

function executeRegistry(connection: RecordDatabase, command: RegistryCommand): StorageWorkerResult {
  switch (command._tag) {
    case "teardown-put": putTeardownObligation({ connection, ...command }); return undefined;
    case "teardown-get": return getTeardownObligation(connection, command.id);
    case "teardown-list": return listTeardownObligations(connection);
    case "teardown-claim": return claimTeardownObligation(connection, command.id);
    case "shared-list": return listSharedStateGenerations(connection, command.key);
    case "shared-append": return appendSharedStateGeneration({ connection, ...command });
    case "shared-heartbeat": return updateSharedStateHeartbeat({ connection, ...command });
    case "keep-put": putKeptSandbox({ connection, ...command }); return undefined;
    case "keep-get": return getKeptSandbox(connection, command.id);
    case "keep-list": return listKeptSandboxes(connection);
    case "keep-update": return updateKeptSandbox(connection, command.id, command.payload);
    case "keep-delete": deleteKeptSandbox(connection, command.id); return undefined;
    case "keep-lease-get": return getKeptSandboxLease(connection, command.id);
    case "keep-lease-acquire": return acquireKeptSandboxLease({ connection, ...command });
    case "keep-lease-release": return releaseKeptSandboxLease({ connection, ...command });
  }
}

function executeInvocation(connection: RecordDatabase, command: InvocationCommand): StorageWorkerResult {
  switch (command._tag) {
    case "invocation-create": return createInvocationOnConnection(connection, command.input);
    case "invocation-list": return listInvocationsOnConnection(connection);
    case "invocation-update-projection":
      updateInvocationActiveProjectionOnConnection(connection, command.invocationId, command.owner, command.at, command.projection, command.deadlineEpochMs);
      return undefined;
    case "invocation-close":
      closeInvocationOnConnection(connection, command.invocationId, command.owner, command.state, command.at, command.projection, command.deadlineEpochMs);
      return undefined;
  }
}

function executeRun(connection: RecordDatabase, command: RunCommand): StorageWorkerResult {
  switch (command._tag) {
    case "run-cutoff": return currentPublicationCutoffOnConnection(connection);
    case "run-create": return createRunResourceOnConnection(connection, command.input);
    case "run-publish-attempt": return publishOriginAttemptOnConnection(connection, command.input);
    case "run-bind-reference": return bindAttemptReferenceOnConnection(connection, command.input);
    case "run-close": return closeRunResourceOnConnection(connection, command.input);
    case "run-recover": return recoverRunResourceOnConnection(connection, command.input);
    case "run-delete": return deleteRunResourceOnConnection(connection, command.input);
    case "run-read": return readRunResourceOnConnection(connection, command.runId, command.cutoff);
    case "run-list": return listRunResourcesOnConnection(connection, command.input);
    case "run-read-attempt": return readPublishedAttemptOnConnection(connection, command.attemptId, command.cutoff);
  }
}

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
        connection = openRecordWriter(request.databasePath, request.busyTimeoutMs);
        return undefined;
      case "persist-sealed-run":
        return persistSealedRun(requireConnection(), request.input);
      case "begin-run":
        beginRun(requireConnection(), request.input);
        return undefined;
      case "admit-attempt":
        admitAttempt(requireConnection(), request.input);
        return undefined;
      case "discard-attempt":
        discardAttempt(requireConnection(), request.input);
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
      case "stage-publication-metadata":
        stageRunPublicationMetadata(requireConnection(), request.input);
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
      case "validate":
        validateExactSchema(requireConnection());
        return verifyAllSealedRuns(requireConnection());
      case "registry":
        return withImmediateTransaction(
          requireConnection(),
          request.deadlineEpochMs,
          request.command._tag,
          () => executeRegistry(requireConnection(), request.command),
        );
      case "case-coordination":
        return executeCaseCommand(requireConnection(), request.command);
      case "invocation":
        return executeInvocation(requireConnection(), request.command);
      case "run":
        return executeRun(requireConnection(), request.command);
      case "admission":
        return executeAdmissionCommand(requireConnection(), request.command) as StorageWorkerResult;
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
