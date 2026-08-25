import { dirname, resolve } from "node:path";
import { Data, Effect } from "effect";
import type * as Scope from "effect/Scope";

import {
  openOperationalRecordReadSession,
  openSnapshotRecordReadSession,
  type AttemptLocatorCandidates,
  type CollectionItemPage,
  type ContentChunkPage,
  type PinnedRecordReadSession,
  type SealedRunCore,
  type SealedRunCutoff,
  type SealedRunSummaryPage,
} from "../record/sqlite/index.ts";

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

/** Host-private fixed reader capability backed by one pinned Record generation. */
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

export interface OpenInspectionSource {
  readonly source: InspectionSource;
  readonly facts: InspectionFactSource;
}

/** Pure source selection; opening and validation happen only inside a Scope. */
export function operationalInspectionSource(cwd: string): InspectionSource {
  return Object.freeze({
    kind: "operational" as const,
    databasePath: resolve(cwd, ".niceeval/record/record.sqlite"),
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
): Effect.Effect<OpenInspectionSource, InspectionSourceError, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.try({
      try: () => source.kind === "record-snapshot"
        ? openSnapshotRecordReadSession(source.snapshotPath)
        : openOperationalRecordReadSession(dirname(source.databasePath)),
      catch: (cause) => sourceError(cause),
    }),
    (session) => Effect.sync(() => session.close()),
  ).pipe(
    Effect.map((session) => Object.freeze({
      source,
      facts: sessionFacts(session, source.kind),
    })),
  );
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
