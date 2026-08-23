import { Schema } from "effect";
import type { RecordCoordinationError } from "../../coordination/record-leases.ts";
import type { RecordFileSystemError } from "../platform/errors.ts";
import type { RecordWriteError } from "../writer/types.ts";

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

/** A previously shown migration plan no longer matches the leased Record. */
export class RecordMigrationPlanStale extends Schema.TaggedError<RecordMigrationPlanStale>(
  "@niceeval/record/RecordMigrationPlanStale",
)("RecordMigrationPlanStale", {
  code: Schema.Literal("record-migration-plan-stale"),
}) {}

/** A known historical attachment cannot be proven safe to advance in place. */
export class RecordMigrationInvalid extends Schema.TaggedError<RecordMigrationInvalid>(
  "@niceeval/record/RecordMigrationInvalid",
)("RecordMigrationInvalid", {
  code: Schema.Literal("record-migration-invalid"),
  family: Schema.String,
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

/** The session catalog did not contribute the exact definition needed now. */
export class FamilyDefinitionRequired extends Schema.TaggedError<FamilyDefinitionRequired>(
  "@niceeval/record/FamilyDefinitionRequired",
)("FamilyDefinitionRequired", {
  code: Schema.Literal("family-definition-required"),
  owner: Schema.Literal("run", "attempt"),
  family: Schema.String,
  schemaVersion: Schema.Number,
}) {}

/** A frozen selection cannot be certified as a complete current Seal. */
export class RecordSealIncomplete extends Schema.TaggedError<RecordSealIncomplete>(
  "@niceeval/record/RecordSealIncomplete",
)("RecordSealIncomplete", {
  code: Schema.Literal("record-seal-incomplete"),
  reason: Schema.Literal(
    "selection-invalid",
    "inventory-invalid",
    "attachment-invalid",
    "reference-closure-invalid",
  ),
  family: Schema.optional(Schema.String),
}) {}

export type RecordReaderOpenError =
  | RecordCoordinationError
  | RecordFileSystemError
  | RecordBootstrapInvalid
  | RecordMigrationRequired
  | RecordFormatUnsupported;

export type RecordMaintenanceOpenError =
  | RecordReaderOpenError
  | RecordMigrationInvalid
  | RecordWriteError;

export type RecordMaintenanceError =
  | RecordMaintenanceOpenError
  | RecordFileSystemError
  | RecordMigrationPlanStale
  | RecordMigrationInvalid
  | FamilyDefinitionRequired;

export type RecordReaderReadError =
  | RecordFileSystemError
  | RecordReaderClosed
  | RecordHandleInvalid
  | FamilyDefinitionRequired;

export type RecordCompletenessError =
  | RecordReaderReadError
  | RecordMigrationRequired
  | RecordSealIncomplete;
