import { Schema } from "effect";
import type {
  RecordFileSystemError,
  RecordMaintenanceLockError,
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
  | RecordMaintenanceLockError
  | RecordBootstrapInvalid
  | RecordMigrationRequired
  | RecordFormatUnsupported
  | RecordMigrationInterruptedState;

export type RecordReaderReadError =
  | RecordFileSystemError
  | RecordReaderClosed
  | RecordHandleInvalid;
