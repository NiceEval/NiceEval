import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Data, Effect } from "effect";
import type * as Scope from "effect/Scope";

import {
  openHostOwnedSnapshotRecordReadSession,
  openOperationalRecordReadSession,
  RECORD_SQLITE_VALIDATION_DEADLINE_MS,
  type AttemptLocatorCandidates,
  type CollectionItemPage,
  type ContentChunkPage,
  type PinnedRecordReadSession,
  type SealedRunCore,
  type SealedRunCutoff,
  type SealedRunSummaryPage,
} from "../record/sqlite/index.ts";
import { startSnapshotImport } from "../record/sqlite/snapshot-import.ts";

export type InspectionSource =
  | {
      readonly kind: "operational";
      readonly databasePath: string;
    }
  | {
      readonly kind: "record-snapshot";
      readonly snapshotPath: string;
    };

export class InspectionSourceError extends Data.TaggedError("InspectionSourceError")<{
  readonly code: "inspection-source-invalid";
  readonly reason: string;
  readonly cause?: unknown;
}> {}

/** Browser-neutral fixed reader capability backed by one pinned Record generation. */
export interface InspectionFactSource {
  readonly kind: InspectionSource["kind"];
  readonly cutoff: () => SealedRunCutoff;
  readonly readSealedRunSummaryPage: (
    afterRunId?: string,
    pageSize?: number,
    expectedCutoffIdentity?: string,
  ) => SealedRunSummaryPage;
  readonly findAttemptLocatorCandidates: (
    locator: string,
    maximumCandidateRuns: number,
  ) => AttemptLocatorCandidates;
  readonly readSealedRunCore: (runId: string) => SealedRunCore | undefined;
  readonly readContentPage: (
    contentId: string,
    afterOrdinal: number,
    pageSize: number,
  ) => ContentChunkPage;
  readonly readCollectionPage: (
    attachmentId: string,
    afterOrdinal: number,
    pageSize: number,
  ) => CollectionItemPage;
}

/** Pure source selection; opening and validation happen only inside a Scope. */
export function operationalInspectionSource(cwd: string): InspectionSource {
  return Object.freeze({
    kind: "operational" as const,
    databasePath: resolve(cwd, ".niceeval/record.sqlite"),
  });
}

export function snapshotInspectionSource(cwd: string, pathname: string): InspectionSource {
  return Object.freeze({
    kind: "record-snapshot" as const,
    snapshotPath: resolve(cwd, pathname),
  });
}

/**
 * Acquires exactly one pinned Record reader. Every fixed operation in the
 * returned source sees the same generation, and Scope closes the session on
 * success, typed failure, defect, or interruption.
 */
export function openInspectionSource(
  source: InspectionSource,
): Effect.Effect<InspectionFactSource, InspectionSourceError, Scope.Scope> {
  return Effect.gen(function* () {
    let session: PinnedRecordReadSession;
    if (source.kind === "operational") {
      if (!existsSync(source.databasePath)) return emptyOperationalFacts();
      session = yield* Effect.acquireRelease(
        Effect.try({
          try: () => openOperationalRecordReadSession(dirname(source.databasePath)),
          catch: (cause) => sourceError(cause),
        }),
        (opened) => Effect.sync(() => opened.close()),
      );
    } else {
      const importDeadline = Date.now() + RECORD_SQLITE_VALIDATION_DEADLINE_MS;
      const importer = yield* Effect.acquireRelease(
        Effect.try({
          try: () => startSnapshotImport(source.snapshotPath, importDeadline),
          catch: (cause) => sourceError(cause),
        }),
        (handle) => Effect.promise(() => handle.close().catch(() => undefined)),
      );
      const generation = yield* Effect.tryPromise({
        // Declaring the AbortSignal keeps this await interruptible. Scope then
        // terminates the Worker and removes its private generation.
        try: (_signal) => importer.result,
        catch: (cause) => sourceError(cause),
      });
      session = yield* Effect.acquireRelease(
        Effect.try({
          try: () => openHostOwnedSnapshotRecordReadSession(generation.path),
          catch: (cause) => sourceError(cause),
        }),
        (opened) => Effect.sync(() => opened.close()),
      );
    }
    return sessionFacts(session, source.kind);
  });
}

const EMPTY_OPERATIONAL_CUTOFF = Object.freeze({
  identity: "niceeval.empty-publication-cutoff/v1",
  runCount: 0,
});

function emptyOperationalFacts(): InspectionFactSource {
  return Object.freeze({
    kind: "operational" as const,
    cutoff: () => EMPTY_OPERATIONAL_CUTOFF,
    readSealedRunSummaryPage: (afterRunId = "", _pageSize = 100, expectedCutoffIdentity?: string) => {
      if (expectedCutoffIdentity !== undefined && expectedCutoffIdentity !== EMPTY_OPERATIONAL_CUTOFF.identity) {
        throw new InspectionSourceError({
          code: "inspection-source-invalid",
          reason: "The empty operational publication cutoff changed; restart pagination.",
        });
      }
      return Object.freeze({
        cutoff: EMPTY_OPERATIONAL_CUTOFF,
        afterRunId,
        summaries: Object.freeze([]),
        nextAfterRunId: null,
      });
    },
    findAttemptLocatorCandidates: (locator: string) => Object.freeze({
      locator,
      ambiguous: false,
      candidates: Object.freeze([]),
    }),
    readSealedRunCore: () => undefined,
    readContentPage: (contentId: string, afterOrdinal: number) => Object.freeze({
      contentId,
      afterOrdinal,
      chunks: Object.freeze([]),
      nextOrdinal: null,
    }),
    readCollectionPage: (attachmentId: string, afterOrdinal: number) => Object.freeze({
      attachmentId,
      afterOrdinal,
      items: Object.freeze([]),
      nextOrdinal: null,
    }),
  });
}

function sessionFacts(
  session: PinnedRecordReadSession,
  kind: InspectionSource["kind"],
): InspectionFactSource {
  let observedCutoff: SealedRunCutoff | undefined;
  const remember = (page: SealedRunSummaryPage): SealedRunSummaryPage => {
    if (observedCutoff !== undefined && observedCutoff.identity !== page.cutoff.identity) {
      throw new InspectionSourceError({
        code: "inspection-source-invalid",
        reason: "Pinned Record session changed its sealed cutoff.",
      });
    }
    observedCutoff = page.cutoff;
    return page;
  };
  const readPage = (
    afterRunId = "",
    pageSize = 100,
    expectedCutoffIdentity?: string,
  ): SealedRunSummaryPage => remember(session.readSealedRunSummaryPage(
    afterRunId,
    pageSize,
    expectedCutoffIdentity ?? observedCutoff?.identity,
  ));
  return Object.freeze({
    kind,
    cutoff: () => observedCutoff ?? readPage("", 1).cutoff,
    readSealedRunSummaryPage: readPage,
    findAttemptLocatorCandidates: (locator: string, maximumCandidateRuns: number) =>
      session.findAttemptLocatorCandidates(locator, maximumCandidateRuns),
    readSealedRunCore: (runId: string) => session.readSealedRunCore(runId),
    readContentPage: (contentId: string, afterOrdinal: number, pageSize: number) =>
      session.readContentChunkPage(contentId, afterOrdinal, pageSize),
    readCollectionPage: (attachmentId: string, afterOrdinal: number, pageSize: number) =>
      session.readCollectionItemPage(attachmentId, afterOrdinal, pageSize),
  });
}

function sourceError(cause: unknown): InspectionSourceError {
  return new InspectionSourceError({
    code: "inspection-source-invalid",
    reason: cause instanceof Error ? cause.message : "Record source validation failed",
    cause,
  });
}
