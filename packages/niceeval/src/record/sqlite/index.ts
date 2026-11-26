import { Effect } from "effect";
import {
  closeRecordDatabase,
  inspectProjectRecordDatabase,
  openImmutableRecordReader,
  reopenProjectDatabase,
  recordSqlitePath,
  validateExactSchema,
  type ProjectRecordDatabaseInspection,
} from "./database.ts";
import { sqliteError } from "./errors.ts";
import { readAttemptSandboxState } from "./state-repository.ts";
import type { AttemptStateResult } from "../../state/protocol.ts";
import {
  findAttemptLocatorCandidates as findAttemptLocatorCandidatesOnConnection,
  findExperimentRunIds as findExperimentRunIdsOnConnection,
  findSourceBarrierCandidate as findSourceBarrierCandidateOnConnection,
  findAcceptedAttemptRunIds as findAcceptedAttemptRunIdsOnConnection,
  readSealedRunCutoff as readSealedRunCutoffOnConnection,
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
  type SourceBarrierRequest,
  type SourceBarrierCandidate,
  type CollectionItemPage,
  type ContentChunkPage,
  type SealedRunDocument,
  type SealedRunCore,
  type SealedRunCutoff,
  type SealedRunSummary,
  type SealedRunSummaryPage,
} from "./types.ts";
import {
  currentPublicationCutoffOnConnection,
  readRunResourceOnConnection,
  listRunResourcesOnConnection,
} from "../../run/storage/sqlite.ts";
import { publicationCutoffIdentity } from "../../run/storage/cutoff.ts";
import type { PublicationCutoff, ReadableRunResource } from "../../run/storage/types.ts";

export { makeStorageWorkerClient, openStorageWorker, type StorageWorkerClient } from "./client.ts";
export {
  ProjectStateDatabase,
  ProjectStateDatabaseLive,
  type ProjectStateDatabaseService,
  type ProjectStateFacets,
} from "./project-state-database.ts";
export { SqliteRecordError, type SqliteRecordErrorCode } from "./errors.ts";
export {
  RECORD_SQLITE_CHUNK_BYTES,
  RECORD_SQLITE_FORMAT,
  RECORD_SQLITE_MAX_PUBLISH_BYTES,
  RECORD_SQLITE_MAX_PUBLISH_ROWS,
  RECORD_SQLITE_MAX_ROW_BYTES,
  RECORD_SQLITE_MAX_PAGE_ROWS,
  RECORD_SQLITE_MAX_PAGE_BYTES,
  RECORD_SQLITE_VALIDATION_DEADLINE_MS,
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
  type SealRunInput,
  type StageAttachmentInput,
  type StageAttachmentReferencesInput,
  type StageCollectionItemsInput,
  type StageSealEntriesInput,
  type StageSealEntriesResult,
  type StageRunCoreInput,
} from "./types.ts";

export { inspectProjectRecordDatabase, recordSqlitePath, reopenProjectDatabase, type ProjectRecordDatabaseInspection };

/** Fixed Host-private read surface. The SQLite connection and SQL stay encapsulated. */
export interface PinnedRecordReadSession {
  readonly readAttemptState?: (attemptId: string, originRunId: string) => AttemptStateResult;
  readonly kind: "canonical" | "private-generation";
  /** Without an aggregate deadline, each bounded read gets its own budget at the same cutoff. */
  readonly beginOperation: (deadlineEpochMs?: number) => void;
  readonly publicationCutoff: () => PublicationCutoff;
  readonly sealedCutoff: () => SealedRunCutoff;
  readonly findExperimentRunIds: (experimentId: string) => readonly string[];
  readonly findSourceBarrierCandidate: (request: SourceBarrierRequest) => SourceBarrierCandidate | undefined;
  readonly findAcceptedAttemptRunIds: (
    request: Parameters<typeof findAcceptedAttemptRunIdsOnConnection>[1],
  ) => readonly string[];
  readonly readRunResource: (runId: string) => ReadableRunResource | undefined;
  readonly listRunResources: (
    input?: Parameters<typeof listRunResourcesOnConnection>[1],
  ) => ReturnType<typeof listRunResourcesOnConnection>;
  readonly readSealedRunSummary: (runId: string) => SealedRunSummary | undefined;
  readonly readSealedRunSummaryPage: (
    afterRunId?: string,
    pageSize?: number,
    expectedCutoffIdentity?: string,
  ) => SealedRunSummaryPage;
  readonly findAttemptLocatorCandidates: (
    locator: string,
    maximumCandidateRuns: number,
    includeTargets?: boolean,
  ) => AttemptLocatorCandidates;
  readonly readSealedRunDocument: (runId: string) => SealedRunDocument | undefined;
  readonly readSealedRunCore: (runId: string, lazyAttachments?: boolean) => SealedRunCore | undefined;
  readonly readContentChunkPage: (contentId: string, afterOrdinal: number, pageSize: number) => ContentChunkPage;
  readonly readCollectionItemPage: (attachmentId: string, afterOrdinal: number, pageSize: number) => CollectionItemPage;
  readonly close: () => void;
}

function openPinnedRecordReadSession(
  path: string,
  kind: "canonical" | "private-generation",
  deadlineEpochMs: number,
  operationScoped = false,
): PinnedRecordReadSession {
  if (!Number.isSafeInteger(deadlineEpochMs) || deadlineEpochMs <= Date.now()) {
    throw sqliteError(
      "record-resource-limit-exceeded",
      "open-read-session",
      "pinned read deadline must be a future safe integer",
    );
  }
  // SQLite arbitrates the WAL open/close boundary within the original read
  // deadline. Schema admission and all result reads share the same snapshot.
  const connection = openImmutableRecordReader(path, Math.max(0, deadlineEpochMs - Date.now()));
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
  let operationDeadline: number | undefined = deadlineEpochMs;
  const assertUsable = (operation: string, deadline: number): void => {
    if (closed) throw sqliteError("record-database-invalid", operation, "pinned read session is closed");
    if (Date.now() >= deadline) {
      close();
      throw sqliteError(
        "record-resource-limit-exceeded",
        operation,
        "pinned read exceeded its deadline and the session was closed",
      );
    }
  };
  const readBounded = <A>(operation: string, read: (deadline: number) => A): A => {
    const deadline = operationDeadline ?? Date.now() + RECORD_SQLITE_VALIDATION_DEADLINE_MS;
    assertUsable(operation, deadline);
    const result = read(deadline);
    // Synchronous SQLite work may only observe the deadline at its boundary;
    // never release a result if that work crossed its deadline.
    assertUsable(operation, deadline);
    return result;
  };
  try {
    const publicationCutoff = currentPublicationCutoffOnConnection(connection);
    const cutoffIdentity = publicationCutoffIdentity(publicationCutoff);
    // Both sources have an admission owner: the project writer or the hostile
    // importer. Re-check selected facts, not every historical Seal, on reads.
    let sealedCutoff: SealedRunCutoff | undefined;
    const readCutoff = () =>
      (sealedCutoff ??= readBounded("read-sealed-cutoff", () =>
        readSealedRunCutoffOnConnection(connection, cutoffIdentity),
      ));
    assertUsable("open-read-session", deadlineEpochMs);
    return {
      kind,
      beginOperation: (nextDeadline?: number) => {
        if (!operationScoped) return;
        if (closed)
          throw sqliteError("record-database-invalid", "begin-read-operation", "pinned read session is closed");
        if (nextDeadline !== undefined && (!Number.isSafeInteger(nextDeadline) || nextDeadline <= Date.now()))
          throw sqliteError(
            "record-resource-limit-exceeded",
            "begin-read-operation",
            "operation deadline must be a future safe integer",
          );
        operationDeadline = nextDeadline;
      },
      publicationCutoff: () => publicationCutoff,
      sealedCutoff: readCutoff,
      findExperimentRunIds: (experimentId: string) =>
        readBounded("find-experiment-runs", () => findExperimentRunIdsOnConnection(connection, experimentId)),
      readRunResource: (runId: string) =>
        readBounded("read-run-resource", () => readRunResourceOnConnection(connection, runId, publicationCutoff)),
      readAttemptState: (attemptId, originRunId) =>
        readBounded("read-attempt-state", () => readAttemptSandboxState(connection, attemptId, originRunId)),
      listRunResources: (input: Parameters<typeof listRunResourcesOnConnection>[1]) =>
        readBounded("list-run-resources", () =>
          listRunResourcesOnConnection(connection, { ...input, cutoff: input?.cutoff ?? publicationCutoff }),
        ),
      readSealedRunSummary: (runId: string) =>
        readBounded("read-sealed-run-summary", () => readSealedRunSummaryOnConnection(connection, runId)),
      readSealedRunSummaryPage: (afterRunId = "", pageSize = 100, expectedCutoffIdentity?: string) =>
        readBounded("page-sealed-runs", (deadline) => {
          if (expectedCutoffIdentity !== undefined && expectedCutoffIdentity !== cutoffIdentity) {
            throw sqliteError(
              "record-command-conflict",
              "page-sealed-runs",
              "publication cutoff changed; restart pagination",
            );
          }
          const page = readSealedRunSummaryPageOnConnection(
            connection,
            afterRunId,
            pageSize,
            undefined,
            deadline,
            readCutoff(),
          );
          return {
            ...page,
            cutoff: { ...page.cutoff, identity: cutoffIdentity },
          };
        }),
      findSourceBarrierCandidate: (request: SourceBarrierRequest) =>
        readBounded("find-source-barrier", () =>
          findSourceBarrierCandidateOnConnection(connection, request, publicationCutoff.revision),
        ),
      findAcceptedAttemptRunIds: (request: Parameters<typeof findAcceptedAttemptRunIdsOnConnection>[1]) =>
        readBounded("find-accepted-attempt-runs", () =>
          findAcceptedAttemptRunIdsOnConnection(connection, request, publicationCutoff.revision),
        ),
      findAttemptLocatorCandidates: (locator: string, maximumCandidateRuns: number, includeTargets = true) =>
        readBounded("find-attempt-locator", () =>
          findAttemptLocatorCandidatesOnConnection(connection, locator, maximumCandidateRuns, includeTargets),
        ),
      readSealedRunDocument: (runId: string) =>
        readBounded("read-sealed-run-document", () => readSealedRunDocumentOnConnection(connection, runId)),
      readSealedRunCore: (runId: string, lazyAttachments = false) =>
        readBounded("read-sealed-run-core", () =>
          readSealedRunCoreOnConnection(
            connection,
            runId,
            lazyAttachments ? (read) => readBounded("read-sealed-attachment", read) : undefined,
          ),
        ),
      readContentChunkPage: (contentId: string, afterOrdinal: number, pageSize: number) =>
        readBounded("read-content-page", () =>
          readContentChunkPageOnConnection(connection, contentId, afterOrdinal, pageSize),
        ),
      readCollectionItemPage: (attachmentId: string, afterOrdinal: number, pageSize: number) =>
        readBounded("read-collection-page", () =>
          readCollectionItemPageOnConnection(connection, attachmentId, afterOrdinal, pageSize),
        ),
      close,
    };
  } catch (cause) {
    close();
    throw cause;
  }
}

export function openOperationalRecordReadSession(
  recordStorageRoot: string,
  deadlineEpochMs = Date.now() + RECORD_SQLITE_VALIDATION_DEADLINE_MS,
  operationScoped = false,
): PinnedRecordReadSession {
  return openPinnedRecordReadSession(
    recordSqlitePath(recordStorageRoot),
    "canonical",
    deadlineEpochMs,
    operationScoped,
  );
}

/** Read admission never binds a project writer or mutates historical input. */
export const acquireProjectRecordReadSession = Effect.fn("acquireProjectRecordReadSession")(function* (
  recordStorageRoot: string,
  options: { readonly operationScoped: boolean | undefined } = { operationScoped: undefined },
) {
  return yield* Effect.acquireRelease(
    Effect.try({
      try: () => openOperationalRecordReadSession(recordStorageRoot, undefined, options.operationScoped),
      catch: (cause) => cause,
    }),
    (session) => Effect.sync(() => session.close()),
  );
});

/** Opens only a private generation already admitted by the hostile importer. */
export function openHostOwnedRecordReadSession(
  generationPath: string,
  deadlineEpochMs = Date.now() + RECORD_SQLITE_VALIDATION_DEADLINE_MS,
  operationScoped = false,
): PinnedRecordReadSession {
  return openPinnedRecordReadSession(generationPath, "private-generation", deadlineEpochMs, operationScoped);
}

function withSession<A>(session: PinnedRecordReadSession, use: (session: PinnedRecordReadSession) => A): A {
  try {
    return use(session);
  } finally {
    session.close();
  }
}

export function readSealedRunSummary(recordStorageRoot: string, runId: string): SealedRunSummary | undefined {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) =>
    session.readSealedRunSummary(runId),
  );
}

export function listSealedRunSummaries(
  recordStorageRoot: string,
  afterRunId = "",
  pageSize = 100,
): readonly SealedRunSummary[] {
  return withSession(
    openOperationalRecordReadSession(recordStorageRoot),
    (session) => session.readSealedRunSummaryPage(afterRunId, pageSize).summaries,
  );
}

export function readSealedRunSummaryPage(
  recordStorageRoot: string,
  afterRunId = "",
  pageSize = 100,
  expectedCutoffIdentity?: string,
): SealedRunSummaryPage {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) =>
    session.readSealedRunSummaryPage(afterRunId, pageSize, expectedCutoffIdentity),
  );
}

export function findAttemptLocatorCandidates(
  recordStorageRoot: string,
  locator: string,
  maximumCandidateRuns: number,
): AttemptLocatorCandidates {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) =>
    session.findAttemptLocatorCandidates(locator, maximumCandidateRuns),
  );
}

export function readCollectionItemPage(
  recordStorageRoot: string,
  attachmentId: string,
  afterOrdinal: number,
  pageSize: number,
): CollectionItemPage {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) =>
    session.readCollectionItemPage(attachmentId, afterOrdinal, pageSize),
  );
}

export function readSealedRunDocument(recordStorageRoot: string, runId: string): SealedRunDocument | undefined {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) =>
    session.readSealedRunDocument(runId),
  );
}

export function readSealedRunCore(recordStorageRoot: string, runId: string): SealedRunCore | undefined {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) =>
    session.readSealedRunCore(runId),
  );
}

export function readContentChunkPage(
  recordStorageRoot: string,
  contentId: string,
  afterOrdinal: number,
  pageSize: number,
): ContentChunkPage {
  return withSession(openOperationalRecordReadSession(recordStorageRoot), (session) =>
    session.readContentChunkPage(contentId, afterOrdinal, pageSize),
  );
}

export function validateRecordDatabase(recordStorageRoot: string, sealedOnly = false): number {
  const connection = openImmutableRecordReader(recordSqlitePath(recordStorageRoot));
  try {
    validateExactSchema(connection);
    return verifyAllSealedRuns(connection, sealedOnly);
  } finally {
    closeRecordDatabase(connection);
  }
}
