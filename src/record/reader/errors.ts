import { Schema } from "effect";
import type { RecordCoordinationError } from "../../coordination/record-leases.ts";
import type {
  RecordFileSystemError,
  RecordGitError,
} from "../platform/errors.ts";

/** `record.json` could not be safely recognized as a usable Record root. */
export class RecordBootstrapInvalid extends Schema.TaggedError<RecordBootstrapInvalid>(
  "@niceeval/record/RecordBootstrapInvalid",
)("RecordBootstrapInvalid", {
  code: Schema.Literal("record-bootstrap-invalid"),
  reason: Schema.Literal("record-document-invalid", "record-format-document-limit-exceeded"),
}) {}

/** A known, older major is never opened through a compatibility reader. */
export class RecordMigrationRequired extends Schema.TaggedError<RecordMigrationRequired>(
  "@niceeval/record/RecordMigrationRequired",
)("RecordMigrationRequired", {
  code: Schema.Literal("record-migration-required"),
  source: Schema.String,
  target: Schema.String,
  command: Schema.Literal("niceeval migrate"),
}) {}

/** Future, foreign, or malformed format identities are not migration inputs. */
export class RecordFormatUnsupported extends Schema.TaggedError<RecordFormatUnsupported>(
  "@niceeval/record/RecordFormatUnsupported",
)("RecordFormatUnsupported", {
  code: Schema.Literal("record-format-unsupported"),
  format: Schema.String,
}) {}

/** An existing sentinel means a migration was interrupted or cannot be proven complete. */
export class RecordMigrationInterruptedState extends Schema.TaggedError<RecordMigrationInterruptedState>(
  "@niceeval/record/RecordMigrationInterruptedState",
)("RecordMigrationInterruptedState", {
  code: Schema.Literal("record-migration-interrupted"),
  restoreCommit: Schema.optional(Schema.String),
}) {}

/** A previously shown migration plan no longer matches the leased Record. */
export class RecordMigrationPlanStale extends Schema.TaggedError<RecordMigrationPlanStale>(
  "@niceeval/record/RecordMigrationPlanStale",
)("RecordMigrationPlanStale", {
  code: Schema.Literal("record-migration-plan-stale"),
}) {}

/** In-place migration is permitted only with a clean Git restore point. */
export class RecordMigrationGitRestoreRequired extends Schema.TaggedError<RecordMigrationGitRestoreRequired>(
  "@niceeval/record/RecordMigrationGitRestoreRequired",
)("RecordMigrationGitRestoreRequired", {
  code: Schema.Literal("record-migration-git-restore-required"),
}) {}

/** A known historical attachment cannot be proven safe to advance in place. */
export class RecordMigrationInvalid extends Schema.TaggedError<RecordMigrationInvalid>(
  "@niceeval/record/RecordMigrationInvalid",
)("RecordMigrationInvalid", {
  code: Schema.Literal("record-migration-invalid"),
  family: Schema.String,
}) {}

/** The migration sentinel exists, so the Record must be restored before reuse. */
export class RecordMigrationRecoveryRequired extends Schema.TaggedError<RecordMigrationRecoveryRequired>(
  "@niceeval/record/RecordMigrationRecoveryRequired",
)("RecordMigrationRecoveryRequired", {
  code: Schema.Literal("record-migration-recovery-required"),
  causeCode: Schema.String,
  restoreCommit: Schema.String,
}) {}

/** A live frozen capability escaped its Effect Scope. */
export class RecordReaderClosed extends Schema.TaggedError<RecordReaderClosed>(
  "@niceeval/record/RecordReaderClosed",
)("RecordReaderClosed", {
  code: Schema.Literal("record-reader-closed"),
}) {}

/** A forged, copied, cross-snapshot, or wrong-kind frozen capability was supplied. */
export class RecordHandleInvalid extends Schema.TaggedError<RecordHandleInvalid>(
  "@niceeval/record/RecordHandleInvalid",
)("RecordHandleInvalid", {
  code: Schema.Literal("record-handle-invalid"),
}) {}

export type RecordReaderOpenError =
  | RecordCoordinationError
  | RecordBootstrapInvalid
  | RecordMigrationRequired
  | RecordFormatUnsupported
  | RecordMigrationInterruptedState;

export type RecordMaintenanceOpenError = RecordReaderOpenError;

export type RecordMaintenanceError =
  | RecordMaintenanceOpenError
  | RecordMigrationPlanStale
  | RecordMigrationGitRestoreRequired
  | RecordMigrationInvalid
  | RecordMigrationRecoveryRequired
  | RecordGitError;

export type RecordReaderReadError =
  | RecordFileSystemError
  | RecordReaderClosed
  | RecordHandleInvalid;
