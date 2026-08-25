import type { Effect } from "effect";
import type {
  RecordCoordination,
  RecordCoordinationError,
} from "../../coordination/record-leases.ts";
import type { RunId } from "../model/identifiers.ts";
import type { RecordIncompleteRunWarning } from "../model/read-state.ts";
import type { RecordRoot } from "../platform/root.ts";
import type { SqliteRecordError } from "../sqlite/errors.ts";
import type {
  RecordFileSystem,
} from "../platform/services.ts";

/**
 * Record v1 is for ordinary bounded projects. This cap keeps maintenance
 * discovery and its user-visible warnings finite before any Run is inspected.
 */
export const RECORD_MAINTENANCE_MAXIMUM_RUNS = 10_000;

/** A Run directory without the durable `complete` publication marker. */
export interface RecordIncompleteRun {
  readonly runId: RunId;
}

/** The result of an explicit clean operation. */
export interface RecordCleanReceipt {
  readonly deleted: readonly RunId[];
  readonly skipped: readonly RunId[];
}

/** Scan failures come only from the real filesystem or shared maintenance lock. */
export type RecordIncompleteRunScanError = RecordCoordinationError | SqliteRecordError;

export type RecordCleanError = RecordCoordinationError | SqliteRecordError;

export type InspectIncompleteRuns = (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
  readonly RecordIncompleteRun[],
  RecordIncompleteRunScanError,
  RecordFileSystem | RecordCoordination
>;

export type InspectIncompleteRunWarnings = (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
  readonly RecordIncompleteRunWarning[],
  RecordIncompleteRunScanError,
  RecordFileSystem | RecordCoordination
>;

export type CleanIncompleteRuns = (input: {
  readonly root: RecordRoot;
  readonly runIds: readonly RunId[];
}) => Effect.Effect<
  RecordCleanReceipt,
  RecordCleanError,
  RecordFileSystem | RecordCoordination
>;
