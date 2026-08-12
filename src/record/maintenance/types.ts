import type { Effect } from "effect";
import type { RunId } from "../model/identifiers.ts";
import type { RecordIncompleteRunWarning } from "../model/read-state.ts";
import type {
  RecordMaintenanceLockError,
  RecordWriterLockError,
} from "../platform/errors.ts";
import type { RecordRoot } from "../platform/root.ts";
import type {
  RecordFileSystem,
  RecordMaintenanceLock,
  RecordWriterLock,
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
export type RecordIncompleteRunScanError = RecordMaintenanceLockError;

/** Clean adds the real writer-lock acquisition failure channel. */
export type RecordCleanError =
  | RecordMaintenanceLockError
  | RecordWriterLockError;

export type InspectIncompleteRuns = (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
  readonly RecordIncompleteRun[],
  RecordIncompleteRunScanError,
  RecordFileSystem | RecordMaintenanceLock
>;

export type InspectIncompleteRunWarnings = (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
  readonly RecordIncompleteRunWarning[],
  RecordIncompleteRunScanError,
  RecordFileSystem | RecordMaintenanceLock
>;

export type CleanIncompleteRuns = (input: {
  readonly root: RecordRoot;
  readonly runIds: readonly RunId[];
}) => Effect.Effect<
  RecordCleanReceipt,
  RecordCleanError,
  RecordFileSystem | RecordMaintenanceLock | RecordWriterLock
>;
