// @concord-file
// @concord-implements docs/feature/inspection/README.md
// @concord-implements docs/feature/inspection/architecture.md
// @concord-implements docs/feature/insight/README.md
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Data, Effect } from "effect";
import type * as Scope from "effect/Scope";

import { RecordIntegrityFailure } from "../record/reader/errors.ts";
import { SqliteRecordError } from "../record/sqlite/errors.ts";
import { normalizeExternalCause, type ExternalCause } from "../shared/external-cause.ts";
import { EMPTY_PUBLICATION_CUTOFF_IDENTITY } from "../run/protocol.ts";

import {
  openHostOwnedRecordReadSession,
  acquireProjectRecordReadSession,
  RECORD_SQLITE_VALIDATION_DEADLINE_MS,
  type AttemptLocatorCandidates,
  type CollectionItemPage,
  type ContentChunkPage,
  type PinnedRecordReadSession,
  type SealedRunCore,
  type SealedRunSummaryPage,
} from "../record/sqlite/index.ts";
import { startExternalRecordImport } from "../record/sqlite/external-record-import.ts";
import { publicationCutoffIdentity } from "../run/storage/cutoff.ts";
import type { PublicationCutoff, ReadableRunResource, RunResourcePage } from "../run/storage/types.ts";

export type InspectionSource =
  | {
      readonly kind: "project-record";
      readonly databasePath: string;
    }
  | {
      readonly kind: "external-record";
      readonly recordPath: string;
    };

export class InspectionSourceError extends Data.TaggedError("InspectionSourceError")<{
  readonly code: "inspection-source-invalid";
  readonly reason: string;
  readonly cause: SqliteRecordError | ExternalCause | undefined;
}> {}

/** Safe Inspection identity for a Record publication that is not closed. */
export class InspectionIntegrityError extends Data.TaggedError("InspectionIntegrityError")<{
  readonly code: "inspection-record-integrity-failure";
  readonly runId: string;
}> {}

/** Browser-neutral fixed reader capability backed by one pinned Record generation. */
export interface InspectionFactSource {
  readonly kind: InspectionSource["kind"];
  readonly beginOperation: (deadlineEpochMs?: number) => void;
  readonly cutoff: () => PublicationCutoff & { readonly identity: string };
  readonly findExperimentRunIds: (experimentId: string) => readonly string[];
  readonly readRunResource: (runId: string) => ReadableRunResource | undefined;
  readonly readRunResourcePage: (afterRunId?: string, pageSize?: number) => RunResourcePage;
  readonly readSealedRunSummaryPage: (
    afterRunId?: string,
    pageSize?: number,
    expectedCutoffIdentity?: string,
  ) => SealedRunSummaryPage;
  readonly findAttemptLocatorCandidates: (locator: string, maximumCandidateRuns: number) => AttemptLocatorCandidates;
  readonly readSealedRunCore: (runId: string) => SealedRunCore | undefined;
  readonly readContentPage: (contentId: string, afterOrdinal: number, pageSize: number) => ContentChunkPage;
  readonly readCollectionPage: (attachmentId: string, afterOrdinal: number, pageSize: number) => CollectionItemPage;
}

/** Pure source selection; opening and validation happen only inside a Scope. */
export function operationalInspectionSource(cwd: string): InspectionSource {
  return {
    kind: "project-record" as const,
    databasePath: resolve(cwd, ".niceeval/record.sqlite"),
  };
}

export function externalInspectionSource(cwd: string, pathname: string): InspectionSource {
  return {
    kind: "external-record" as const,
    recordPath: resolve(cwd, pathname),
  };
}

/**
 * Acquires exactly one pinned Record reader. Every fixed operation in the
 * returned source sees the same generation, and Scope closes the session on
 * success, typed failure, defect, or interruption.
 */
export function openInspectionSource(
  source: InspectionSource,
): Effect.Effect<InspectionFactSource, InspectionSourceError | InspectionIntegrityError, Scope.Scope> {
  return Effect.gen(function* () {
    let session: PinnedRecordReadSession;
    if (source.kind === "project-record") {
      if (!existsSync(source.databasePath)) return emptyOperationalFacts();
      session = yield* acquireProjectRecordReadSession(dirname(source.databasePath), { operationScoped: true }).pipe(
        Effect.mapError(inspectionSourceError),
      );
    } else {
      const importDeadline = Date.now() + RECORD_SQLITE_VALIDATION_DEADLINE_MS;
      const importer = yield* Effect.acquireRelease(
        Effect.try({
          try: () => startExternalRecordImport(source.recordPath, importDeadline),
          catch: inspectionSourceError,
        }),
        (handle) => Effect.promise(() => handle.close().catch(() => undefined)),
      );
      const generation = yield* Effect.tryPromise({
        // Declaring the AbortSignal keeps this await interruptible. Scope then
        // terminates the Worker and removes its private generation.
        try: (_signal) => importer.result,
        catch: inspectionSourceError,
      });
      session = yield* Effect.acquireRelease(
        Effect.try({
          try: () => openHostOwnedRecordReadSession(generation.path, undefined, true),
          catch: inspectionSourceError,
        }),
        (opened) => Effect.sync(() => opened.close()),
      );
    }
    return sessionFacts(session, source.kind);
  });
}

/** Opens one already-imported private generation without accepting a public path. */
export function openHostOwnedInspectionSource(
  recordPath: string,
): Effect.Effect<InspectionFactSource, InspectionSourceError | InspectionIntegrityError, Scope.Scope> {
  return Effect.gen(function* () {
    const session = yield* Effect.acquireRelease(
      Effect.try({
        try: () => openHostOwnedRecordReadSession(recordPath, undefined, true),
        catch: inspectionSourceError,
      }),
      (opened) => Effect.sync(() => opened.close()),
    );
    return sessionFacts(session, "external-record");
  });
}

const EMPTY_OPERATIONAL_CUTOFF = {
  identity: EMPTY_PUBLICATION_CUTOFF_IDENTITY,
  storeGeneration: EMPTY_PUBLICATION_CUTOFF_IDENTITY,
  revision: 0,
};

function emptyOperationalFacts(): InspectionFactSource {
  return {
    kind: "project-record" as const,
    cutoff: () => EMPTY_OPERATIONAL_CUTOFF,
    findExperimentRunIds: () => [],
    readRunResource: () => undefined,
    readRunResourcePage: () => ({
      cutoff: { storeGeneration: EMPTY_PUBLICATION_CUTOFF_IDENTITY, revision: 0 },
      runs: [],
      nextAfterRunId: null,
    }),
    readSealedRunSummaryPage: (afterRunId = "", _pageSize = 100, expectedCutoffIdentity?: string) => {
      if (expectedCutoffIdentity !== undefined && expectedCutoffIdentity !== EMPTY_OPERATIONAL_CUTOFF.identity) {
        throw new InspectionSourceError({
          code: "inspection-source-invalid",
          reason: "The empty operational publication cutoff changed; restart pagination.",
          cause: undefined,
        });
      }
      return {
        cutoff: { identity: EMPTY_OPERATIONAL_CUTOFF.identity, runCount: 0 },
        afterRunId,
        summaries: [],
        nextAfterRunId: null,
      };
    },
    findAttemptLocatorCandidates: (locator: string) => ({
      locator,
      ambiguous: false,
      candidates: [],
    }),
    readSealedRunCore: () => undefined,
    readContentPage: (contentId: string, afterOrdinal: number) => ({
      contentId,
      afterOrdinal,
      chunks: [],
      nextOrdinal: null,
    }),
    readCollectionPage: (attachmentId: string, afterOrdinal: number) => ({
      attachmentId,
      afterOrdinal,
      items: [],
      nextOrdinal: null,
    }),
    beginOperation: () => {},
  };
}

function sessionFacts(session: PinnedRecordReadSession, kind: InspectionSource["kind"]): InspectionFactSource {
  const publication = session.publicationCutoff();
  const cutoff = { ...publication, identity: publicationCutoffIdentity(publication) };
  const readPage = (afterRunId = "", pageSize = 100, expectedCutoffIdentity?: string): SealedRunSummaryPage =>
    session.readSealedRunSummaryPage(afterRunId, pageSize, expectedCutoffIdentity ?? cutoff.identity);
  return {
    kind,
    beginOperation: session.beginOperation ?? (() => {}),
    cutoff: () => cutoff,
    findExperimentRunIds: session.findExperimentRunIds,
    readRunResource: (runId: string) => session.readRunResource(runId),
    readRunResourcePage: (afterRunId = "", pageSize = 100) =>
      session.listRunResources({
        afterRunId,
        pageSize,
        cutoff: undefined,
        invocationId: undefined,
      }),
    readSealedRunSummaryPage: readPage,
    findAttemptLocatorCandidates: (locator: string, maximumCandidateRuns: number) =>
      session.findAttemptLocatorCandidates(locator, maximumCandidateRuns),
    readSealedRunCore: (runId: string) => session.readSealedRunCore(runId, true),
    readContentPage: (contentId: string, afterOrdinal: number, pageSize: number) =>
      session.readContentChunkPage(contentId, afterOrdinal, pageSize),
    readCollectionPage: (attachmentId: string, afterOrdinal: number, pageSize: number) =>
      session.readCollectionItemPage(attachmentId, afterOrdinal, pageSize),
  };
}

export function inspectionSourceError(cause: unknown): InspectionSourceError | InspectionIntegrityError {
  if (cause instanceof InspectionSourceError || cause instanceof InspectionIntegrityError) return cause;
  if (cause instanceof RecordIntegrityFailure) {
    return new InspectionIntegrityError({
      code: "inspection-record-integrity-failure",
      runId: cause.runId,
    });
  }
  return new InspectionSourceError({
    code: "inspection-source-invalid",
    reason: cause instanceof Error ? cause.message : "Record source validation failed",
    cause: cause instanceof SqliteRecordError ? cause : normalizeExternalCause(cause),
  });
}
