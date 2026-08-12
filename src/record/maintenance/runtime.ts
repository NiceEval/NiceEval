import { Effect, Either, Schema } from "effect";
import { RunIdSchema } from "../codec/identifiers.ts";
import {
  compareCanonicalIdentity,
  type RunId,
} from "../model/identifiers.ts";
import type { RecordIncompleteRunWarning } from "../model/read-state.ts";
import { recordPortablePath } from "../platform/services.ts";
import {
  RecordFileSystem,
  RecordMaintenanceLock,
  RecordWriterLock,
} from "../platform/services.ts";
import {
  RECORD_MAINTENANCE_MAXIMUM_RUNS,
  type CleanIncompleteRuns,
  type InspectIncompleteRunWarnings,
  type InspectIncompleteRuns,
  type RecordCleanReceipt,
  type RecordIncompleteRun,
} from "./types.ts";

function canonicalRunIds(runIds: readonly RunId[]): readonly RunId[] {
  return Object.freeze(
    [...new Set(runIds)].sort(compareCanonicalIdentity),
  );
}

function incompleteRun(runId: RunId): RecordIncompleteRun {
  return Object.freeze({ runId });
}

function incompleteRunWarning(
  runId: RunId,
): RecordIncompleteRunWarning {
  return Object.freeze({
    code: "incomplete-run",
    runId,
    cleanupCommand: "niceeval clean",
  });
}

/**
 * Translate bounded discovery output into the exact warning model shared with
 * readers. The canonical ordering also makes this safe for a CLI that merges
 * results from multiple maintenance calls.
 */
export function incompleteRunWarnings(
  incompleteRuns: readonly RecordIncompleteRun[],
): readonly RecordIncompleteRunWarning[] {
  return Object.freeze(
    canonicalRunIds(incompleteRuns.map((entry) => entry.runId)).map(
      incompleteRunWarning,
    ),
  );
}

/**
 * Discover only Run directories whose final publication marker is absent.
 * The shared maintenance lock prevents a migration from changing the layout
 * while the bounded snapshot is formed; it intentionally does not acquire the
 * writer lock, so a writer may continue creating an unpublished draft.
 */
export const inspectIncompleteRuns: InspectIncompleteRuns = ({ root }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* RecordFileSystem;
      const maintenanceLock = yield* RecordMaintenanceLock;
      yield* maintenanceLock.acquireShared(root);

      const entries = yield* fileSystem.listDirectory({
        directory: recordPortablePath(root, "runs"),
        maximumEntries: RECORD_MAINTENANCE_MAXIMUM_RUNS,
      });
      const incomplete: RecordIncompleteRun[] = [];

      for (const entry of entries) {
        if (entry.kind !== "directory") {
          continue;
        }

        const decoded = Schema.decodeUnknownEither(RunIdSchema)(entry.name);
        if (Either.isLeft(decoded)) {
          continue;
        }

        const completeKind = yield* fileSystem.pathKind(
          recordPortablePath(root, "runs", decoded.right, "complete"),
        );
        if (completeKind === "missing") {
          incomplete.push(incompleteRun(decoded.right));
        }
      }

      return Object.freeze(
        canonicalRunIds(incomplete.map((entry) => entry.runId)).map(
          incompleteRun,
        ),
      );
    }),
  );

/** A convenience composition for reader and CLI layers that need warnings. */
export const inspectIncompleteRunWarnings: InspectIncompleteRunWarnings = (
  input,
) => Effect.map(inspectIncompleteRuns(input), incompleteRunWarnings);

function cleanReceipt(input: {
  readonly deleted: readonly RunId[];
  readonly skipped: readonly RunId[];
}): RecordCleanReceipt {
  return Object.freeze({
    deleted: Object.freeze([...input.deleted]),
    skipped: Object.freeze([...input.skipped]),
  });
}

/**
 * Explicitly remove selected unpublished Run directories. The platform owns
 * the final `complete` recheck; one uninterruptible deletion keeps that check,
 * removal, and its directory sync within the writer-lock lifetime while an
 * interruption still propagates after the current deletion boundary.
 */
export const cleanIncompleteRuns: CleanIncompleteRuns = ({ root, runIds }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* RecordFileSystem;
      const maintenanceLock = yield* RecordMaintenanceLock;
      const writerLock = yield* RecordWriterLock;
      yield* maintenanceLock.acquireShared(root);
      yield* writerLock.acquire(root);

      const deleted: RunId[] = [];
      const skipped: RunId[] = [];
      for (const runId of canonicalRunIds(runIds)) {
        const outcome = yield* Effect.uninterruptible(
          fileSystem.deleteIncompleteRun({ root, runId }),
        );
        if (outcome.state === "deleted") {
          deleted.push(runId);
        } else {
          skipped.push(runId);
        }
      }

      return cleanReceipt({ deleted, skipped });
    }),
  );
