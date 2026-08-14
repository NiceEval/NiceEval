import { Effect, Either, Schema } from "effect";
import { RecordCoordination } from "../../coordination/record-leases.ts";
import { RunIdSchema } from "../codec/identifiers.ts";
import {
  compareCanonicalIdentity,
  type RunId,
} from "../model/identifiers.ts";
import type { RecordIncompleteRunWarning } from "../model/read-state.ts";
import { recordPortablePath } from "../platform/services.ts";
import {
  RecordFileSystem,
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
 * Discover incomplete Runs under the exclusive maintenance lease. This keeps
 * the scan truthful for a following clean/migrate decision and never shares a
 * lease with portable mutation.
 */
export const inspectIncompleteRuns: InspectIncompleteRuns = ({ root }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* RecordFileSystem;
      const coordination = yield* RecordCoordination;
      yield* coordination.enterRecordMaintenance(root);

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
 * removal, and its directory sync within the maintenance-lease lifetime while an
 * interruption still propagates after the current deletion boundary.
 */
export const cleanIncompleteRuns: CleanIncompleteRuns = ({ root, runIds }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* RecordFileSystem;
      const coordination = yield* RecordCoordination;
      yield* coordination.enterRecordMaintenance(root);

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
