import { Schema } from "effect";
import type { RecordCoordinationError } from "../../coordination/record-leases.ts";
import type { RecordFileSystemError } from "../platform/errors.ts";
import type { RecordWriteError } from "../writer/types.ts";
import type { SqliteRecordError } from "../sqlite/errors.ts";
import { RECORD_ATTACHMENT_OWNERS } from "../model/core.ts";

/** `record.json` could not be safely recognized as a usable Record root. */
export class RecordBootstrapInvalid extends Schema.TaggedError<RecordBootstrapInvalid>()("RecordBootstrapInvalid", {
  code: Schema.Literal("record-bootstrap-invalid"),
  reason: Schema.Literals(["record-document-invalid", "record-format-document-limit-exceeded"]),
}) {}

/** Future, foreign, or malformed format identities are not migration inputs. */
export class RecordFormatUnsupported extends Schema.TaggedError<RecordFormatUnsupported>()("RecordFormatUnsupported", {
  code: Schema.Literal("record-format-unsupported"),
  format: Schema.String,
}) {}

/** A live frozen capability escaped its Effect Scope. */
export class RecordReaderClosed extends Schema.TaggedError<RecordReaderClosed>()("RecordReaderClosed", {
  code: Schema.Literal("record-reader-closed"),
}) {}

/** A forged, copied, cross-snapshot, or wrong-kind frozen capability was supplied. */
export class RecordHandleInvalid extends Schema.TaggedError<RecordHandleInvalid>()("RecordHandleInvalid", {
  code: Schema.Literal("record-handle-invalid"),
}) {}

/** Persisted publication facts exist, but do not form one closed readable truth. */
export class RecordIntegrityFailure extends Schema.TaggedError<RecordIntegrityFailure>()("RecordIntegrityFailure", {
  code: Schema.Literal("record-integrity-failure"),
  runId: Schema.String,
  reason: Schema.Literals(["publication-closure-invalid", "core-invalid"]),
}) {}

/** The session catalog did not contribute the exact definition needed now. */
export class FamilyDefinitionRequired extends Schema.TaggedError<FamilyDefinitionRequired>()(
  "FamilyDefinitionRequired",
  {
    code: Schema.Literal("family-definition-required"),
    owner: Schema.Literals(RECORD_ATTACHMENT_OWNERS),
    family: Schema.String,
    revision: Schema.optional(Schema.Number),
  },
) {}

/** A frozen selection cannot be certified as a complete current Seal. */
export class RecordSealIncomplete extends Schema.TaggedError<RecordSealIncomplete>()("RecordSealIncomplete", {
  code: Schema.Literal("record-seal-incomplete"),
  reason: Schema.Literals([
    "selection-invalid",
    "inventory-invalid",
    "attachment-invalid",
    "reference-closure-invalid",
  ]),
  family: Schema.optional(Schema.String),
}) {}

export type RecordReaderOpenError =
  | RecordCoordinationError
  | RecordFileSystemError
  | SqliteRecordError
  | RecordBootstrapInvalid
  | RecordFormatUnsupported;

export type RecordMaintenanceOpenError = RecordReaderOpenError | RecordWriteError;

export type RecordMaintenanceError = RecordMaintenanceOpenError | RecordFileSystemError | FamilyDefinitionRequired;

export type RecordReaderReadError =
  | RecordFileSystemError
  | SqliteRecordError
  | RecordReaderClosed
  | RecordHandleInvalid
  | RecordIntegrityFailure
  | FamilyDefinitionRequired;

export type RecordCompletenessError = RecordReaderReadError | RecordSealIncomplete;
