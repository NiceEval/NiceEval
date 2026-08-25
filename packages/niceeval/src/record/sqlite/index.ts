import {
  closeRecordDatabase,
  openRecordReader,
  openRecordWriter,
  recordSqlitePath,
  validateExactSchema,
} from "./database.ts";
import { createSealedSnapshot } from "./snapshot.ts";
import { sqliteError } from "./errors.ts";
import {
  findAttemptLocatorCandidates as findAttemptLocatorCandidatesOnConnection,
  persistSealedRun as persistSealedRunOnConnection,
  readSealedRunSummaryPage as readSealedRunSummaryPageOnConnection,
  readCollectionItemPage as readCollectionItemPageOnConnection,
  readContentChunkPage as readContentChunkPageOnConnection,
  readSealedRunDocument as readSealedRunDocumentOnConnection,
  readSealedRunCore as readSealedRunCoreOnConnection,
  readSealedRunSummary as readSealedRunSummaryOnConnection,
  verifyAllSealedRuns,
} from "./storage.ts";
import {
  RECORD_SQLITE_VALIDATION_DEADLINE_MS,
  type AttemptLocatorCandidates,
  type CollectionItemPage,
  type ContentChunkPage,
  type PersistSealedRunInput,
  type SealedRunDocument,
  type SealedRunCore,
  type SealedRunSummary,
  type SealedRunSummaryPage,
  type SnapshotResult,
} from "./types.ts";

export { makeStorageWorkerClient, openStorageWorker, type StorageWorkerClient } from "./client.ts";
export { SqliteRecordError, type SqliteRecordErrorCode } from "./errors.ts";
export {
  RECORD_SQLITE_CHUNK_BYTES,
  RECORD_SQLITE_FORMAT,
  RECORD_SQLITE_MAX_PUBLISH_BYTES,
  RECORD_SQLITE_MAX_PUBLISH_ROWS,
  RECORD_SQLITE_MAX_ROW_BYTES,
  RECORD_SQLITE_MAX_PAGE_ROWS,
  RECORD_SQLITE_MAX_PAGE_BYTES,
  RECORD_SQLITE_MAX_SNAPSHOT_BYTES,
  RECORD_SQLITE_MAX_VALIDATION_ROWS,
  RECORD_SQLITE_MAX_VALIDATION_RUNS,
  RECORD_SQLITE_VALIDATION_DEADLINE_MS,
  RECORD_SQLITE_STORAGE_REVISION,
  type AdmitAttachmentInput,
  type AdmitAttemptInput,
  type AdmitContentInput,
  type AppendContentChunksInput,
  type BeginRunInput,
  type AttemptLocatorCandidateRun,
  type AttemptLocatorCandidates,
  type CollectionItemPage,
  type ContentChunkPage,
  type FinalizeRunInput,
  type FinalizedAttachmentMetadata,
  type FinalizedAttachmentClosure,
  type FenceRunFinalizationInput,
  type PersistedAttachment,
  type PersistedAttachmentReference,
  type PersistedCollectionItem,
  type PersistedContent,
  type PersistedContentMetadata,
  type PersistedContentChunk,
  type PersistedMember,
  type PersistedSlot,
  type PersistedAttempt,
  type PersistSealedRunInput,
  type PrepareRunFinalizationInput,
  type PreparedRunFinalization,
  type RunFinalization,
  type SealEntry,
  type SealedAttachmentDocument,
  type SealedAttachmentMetadata,
  type SealedRunCore,
  type SealedRunDocument,
  type SealedRunSummary,
  type SealedRunCutoff,
  type SealedRunSummaryPage,
  type SnapshotResult,
  type SealRunInput,
  type StageAttachmentInput,
  type StageAttachmentReferencesInput,
  type StageCollectionItemsInput,
  type StageSealEntriesInput,
  type StageSealEntriesResult,
  type StageRunCoreInput,
} from "./types.ts";

export { recordSqlitePath };

/** Fixed Host-private read surface. The SQLite connection and SQL stay encapsulated. */
export interface PinnedRecordReadSession {
  readonly kind: "operational" | "snapshot";
  readonly deadlineEpochMs: number;
  readonly readSealedRunSummary: (runId: string) => SealedRunSummary | undefined;
  readonly readSealedRunSummaryPage: (afterRunId?: string, pageSize?: number, expectedCutoffIdentity?: string) => SealedRunSummaryPage;
  readonly findAttemptLocatorCandidates: (locator: string, maximumCandidateRuns: number) => AttemptLocatorCandidates;
  readonly readSealedRunDocument: (runId: string) => SealedRunDocument | undefined;
  readonly readSealedRunCore: (runId: string) => SealedRunCore | undefined;
  readonly readContentChunkPage: (contentId: string, afterOrdinal: number, pageSize: number) => ContentChunkPage;
  readonly readCollectionItemPage: (attachmentId: string, afterOrdinal: number, pageSize: number) => CollectionItemPage;
  readonly close: () => void;
}

function openPinnedRecordReadSession(
  path: string,
  kind: "operational" | "snapshot",
  deadlineEpochMs: number,
): PinnedRecordReadSession {
  if (!Number.isSafeInteger(deadlineEpochMs) || deadlineEpochMs <= Date.now()) {
    throw sqliteError("record-resource-limit-exceeded", "open-read-session", "pinned read deadline must be a future safe integer");
  }
  const connection = openRecordReader(path, kind);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    try {
      if (connection.db.isTransaction) connection.db.exec("ROLLBACK");
    } finally {
      closeRecordDatabase(connection);
    }
  };
  const assertUsable = (operation: string): void => {
    if (closed) throw sqliteError("record-database-invalid", operation, "pinned read session is closed");
    if (Date.now() >= deadlineEpochMs) {
      close();
      throw sqliteError("record-resource-limit-exceeded", operation, "pinned read session exceeded its deadline and was closed");
    }
  };
  const readBounded = <A>(operation: string, read: () => A): A => {
    assertUsable(operation);
    const result = read();
    // Synchronous SQLite work may only observe the deadline at its boundary;
    // never release a result if that work crossed the session deadline.
    assertUsable(operation);
    return result;
  };
  try {
    // BEGIN occurs before the authoritative schema + Seal pass. Every later
    // read observes this same WAL/file generation until close rolls it back.
    connection.db.exec("BEGIN");
    validateExactSchema(connection, kind);
    verifyAllSealedRuns(connection, kind === "snapshot", deadlineEpochMs);
    assertUsable("open-read-session");
    return Object.freeze({
      kind,
      deadlineEpochMs,
      readSealedRunSummary: (runId: string) => readBounded("read-sealed-run-summary", () => readSealedRunSummaryOnConnection(connection, runId)),
      readSealedRunSummaryPage: (afterRunId = "", pageSize = 100, expectedCutoffIdentity?: string) => readBounded("page-sealed-runs", () =>
        readSealedRunSummaryPageOnConnection(connection, afterRunId, pageSize, expectedCutoffIdentity, deadlineEpochMs)),
      findAttemptLocatorCandidates: (locator: string, maximumCandidateRuns: number) => readBounded("find-attempt-locator", () =>
        findAttemptLocatorCandidatesOnConnection(connection, locator, maximumCandidateRuns)),
      readSealedRunDocument: (runId: string) => readBounded("read-sealed-run-document", () => readSealedRunDocumentOnConnection(connection, runId)),
      readSealedRunCore: (runId: string) => readBounded("read-sealed-run-core", () => readSealedRunCoreOnConnection(connection, runId)),
      readContentChunkPage: (contentId: string, afterOrdinal: number, pageSize: number) => readBounded("read-content-page", () =>
        readContentChunkPageOnConnection(connection, contentId, afterOrdinal, pageSize)),
      readCollectionItemPage: (attachmentId: string, afterOrdinal: number, pageSize: number) => readBounded("read-collection-page", () =>
        readCollectionItemPageOnConnection(connection, attachmentId, afterOrdinal, pageSize)),
      close,
    });
  } catch (cause) {
    close();
    throw cause;
  }
}

export function openOperationalRecordReadSession(
  recordStorageRoot: string,
  deadlineEpochMs = Date.now() + RECORD_SQLITE_VALIDATION_DEADLINE_MS,
): PinnedRecordReadSession {
  return openPinnedRecordReadSession(recordSqlitePath(recordStorageRoot), "operational", deadlineEpochMs);
}

export function openSnapshotRecordReadSession(
  snapshotPath: string,
  deadlineEpochMs = Date.now() + RECORD_SQLITE_VALIDATION_DEADLINE_MS,
): PinnedRecordReadSession {
  return openPinnedRecordReadSession(snapshotPath, "snapshot", deadlineEpochMs);
}

function withSession<A>(session: PinnedRecordReadSession, use: (session: PinnedRecordReadSession) => A): A {
  try {
    return use(session);
  } finally {
    session.close();
  }
}

/** Host-private synchronous primitive; production writers normally call it on the dedicated worker. */
export function persistSealedRun(
  recordStorageRoot: string,
  input: PersistSealedRunInput,
  busyTimeoutMs = 5_000,
): SealedRunSummary {
  const connection = openRecordWriter(recordSqlitePath(recordStorageRoot), busyTimeoutMs);
  try {
    return persistSealedRunOnConnection(connection, input);
  } finally {
    closeRecordDatabase(connection);
  }
}

/** Alias kept explicit for the Record Run finalizer integration point. */
export const publishSealedRun = persistSealedRun;

export function readSealedRunSummary(recordStorageRoot: string, runId: string): SealedRunSummary | undefined {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) => session.readSealedRunSummary(runId));
}

export function listSealedRunSummaries(
  recordStorageRoot: string,
  afterRunId = "",
  pageSize = 100,
): readonly SealedRunSummary[] {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) =>
    session.readSealedRunSummaryPage(afterRunId, pageSize).summaries);
}

export function readSealedRunSummaryPage(
  recordStorageRoot: string,
  afterRunId = "",
  pageSize = 100,
  expectedCutoffIdentity?: string,
): SealedRunSummaryPage {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) =>
    session.readSealedRunSummaryPage(afterRunId, pageSize, expectedCutoffIdentity));
}

export function findAttemptLocatorCandidates(
  recordStorageRoot: string,
  locator: string,
  maximumCandidateRuns: number,
): AttemptLocatorCandidates {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) =>
    session.findAttemptLocatorCandidates(locator, maximumCandidateRuns));
}

export function readCollectionItemPage(
  recordStorageRoot: string,
  attachmentId: string,
  afterOrdinal: number,
  pageSize: number,
): CollectionItemPage {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) =>
    session.readCollectionItemPage(attachmentId, afterOrdinal, pageSize));
}

export function readSealedRunDocument(recordStorageRoot: string, runId: string): SealedRunDocument | undefined {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) => session.readSealedRunDocument(runId));
}

export function readSealedRunCore(recordStorageRoot: string, runId: string): SealedRunCore | undefined {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) => session.readSealedRunCore(runId));
}

export function readContentChunkPage(
  recordStorageRoot: string,
  contentId: string,
  afterOrdinal: number,
  pageSize: number,
): ContentChunkPage {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) =>
    session.readContentChunkPage(contentId, afterOrdinal, pageSize));
}

/** Opens a nominal snapshot file directly; it never infers an operational root. */
export function readSnapshotSealedRunDocument(snapshotPath: string, runId: string): SealedRunDocument | undefined {
  return withSession(openSnapshotRecordReadSession(snapshotPath), (session) => session.readSealedRunDocument(runId));
}

export function readSnapshotSealedRunCore(snapshotPath: string, runId: string): SealedRunCore | undefined {
  return withSession(openSnapshotRecordReadSession(snapshotPath), (session) => session.readSealedRunCore(runId));
}

export function listSnapshotSealedRunSummaries(
  snapshotPath: string,
  afterRunId = "",
  pageSize = 100,
): readonly SealedRunSummary[] {
  return withSession(openSnapshotRecordReadSession(snapshotPath), (session) =>
    session.readSealedRunSummaryPage(afterRunId, pageSize).summaries);
}

export function readSnapshotSealedRunSummaryPage(
  snapshotPath: string,
  afterRunId = "",
  pageSize = 100,
  expectedCutoffIdentity?: string,
): SealedRunSummaryPage {
  return withSession(openSnapshotRecordReadSession(snapshotPath), (session) =>
    session.readSealedRunSummaryPage(afterRunId, pageSize, expectedCutoffIdentity));
}

export function findSnapshotAttemptLocatorCandidates(
  snapshotPath: string,
  locator: string,
  maximumCandidateRuns: number,
): AttemptLocatorCandidates {
  return withSession(openSnapshotRecordReadSession(snapshotPath), (session) =>
    session.findAttemptLocatorCandidates(locator, maximumCandidateRuns));
}

export function readSnapshotContentChunkPage(
  snapshotPath: string,
  contentId: string,
  afterOrdinal: number,
  pageSize: number,
): ContentChunkPage {
  return withSession(openSnapshotRecordReadSession(snapshotPath), (session) =>
    session.readContentChunkPage(contentId, afterOrdinal, pageSize));
}

export function readSnapshotCollectionItemPage(
  snapshotPath: string,
  attachmentId: string,
  afterOrdinal: number,
  pageSize: number,
): CollectionItemPage {
  return withSession(openSnapshotRecordReadSession(snapshotPath), (session) =>
    session.readCollectionItemPage(attachmentId, afterOrdinal, pageSize));
}

export function validateRecordSnapshot(snapshotPath: string): number {
  const connection = openRecordReader(snapshotPath, "snapshot");
  try {
    validateExactSchema(connection, "snapshot");
    return verifyAllSealedRuns(connection, true);
  } finally {
    closeRecordDatabase(connection);
  }
}

export function validateRecordDatabase(recordStorageRoot: string, sealedOnly = false): number {
  const connection = openRecordReader(recordSqlitePath(recordStorageRoot));
  try {
    validateExactSchema(connection);
    return verifyAllSealedRuns(connection, sealedOnly);
  } finally {
    closeRecordDatabase(connection);
  }
}

/** Caller owns the coordination snapshot barrier around this operation. */
export async function createRecordSnapshot(
  recordStorageRoot: string,
  destination: string,
  deadlineEpochMs: number,
  afterBackup?: () => Promise<void>,
): Promise<SnapshotResult> {
  const connection = openRecordWriter(recordSqlitePath(recordStorageRoot));
  try {
    return await createSealedSnapshot(connection, destination, deadlineEpochMs, afterBackup);
  } finally {
    closeRecordDatabase(connection);
  }
}
