import { Schema } from "effect";

/** Bounded operation names are safe to surface in Record diagnostics. */
export const RecordPlatformOperationSchema = Schema.Literal(
  "create-directory",
  "list-directory",
  "read-file",
  "write-file",
  "sync-file",
  "sync-directory",
  "remove-path",
  "acquire-maintenance-lock",
  "release-maintenance-lock",
  "acquire-writer-lock",
  "release-writer-lock",
  "inspect-git",
);

export type RecordPlatformOperation = Schema.Schema.Type<
  typeof RecordPlatformOperationSchema
>;

export const RecordPathKindSchema = Schema.Literal(
  "missing",
  "file",
  "directory",
  "other",
);

export type RecordPathKind = Schema.Schema.Type<typeof RecordPathKindSchema>;

export const RecordPlatformResourceSchema = Schema.Literal(
  "directory-entries",
  "file-bytes",
  "git-output",
);

export type RecordPlatformResource = Schema.Schema.Type<
  typeof RecordPlatformResourceSchema
>;

/** A forged or malformed host-local root never reaches Node filesystem calls. */
export class RecordRootInvalid extends Schema.TaggedError<RecordRootInvalid>(
  "@niceeval/record/RecordRootInvalid",
)("RecordRootInvalid", {
  code: Schema.Literal("record-root-invalid"),
}) {}

/** A portable relative location cannot address a host path outside its root. */
export class RecordPathInvalid extends Schema.TaggedError<RecordPathInvalid>(
  "@niceeval/record/RecordPathInvalid",
)("RecordPathInvalid", {
  code: Schema.Literal("record-path-invalid"),
  reason: Schema.Literal("segment-invalid", "file-path-empty"),
  segments: Schema.Array(Schema.String),
}) {}

/** A caller expected a file or directory but durable storage has another shape. */
export class RecordPathTypeInvalid extends Schema.TaggedError<RecordPathTypeInvalid>(
  "@niceeval/record/RecordPathTypeInvalid",
)("RecordPathTypeInvalid", {
  code: Schema.Literal("record-path-type-invalid"),
  path: Schema.String,
  expected: Schema.Literal("file", "directory"),
  actual: RecordPathKindSchema,
}) {}

/** An exclusive create found an existing file or directory. */
export class RecordPathAlreadyExists extends Schema.TaggedError<RecordPathAlreadyExists>(
  "@niceeval/record/RecordPathAlreadyExists",
)("RecordPathAlreadyExists", {
  code: Schema.Literal("record-path-already-exists"),
  path: Schema.String,
}) {}

/** A bounded platform operation would exceed its declared resource limit. */
export class RecordResourceLimitExceeded extends Schema.TaggedError<RecordResourceLimitExceeded>(
  "@niceeval/record/RecordResourceLimitExceeded",
)("RecordResourceLimitExceeded", {
  code: Schema.Literal("record-resource-limit-exceeded"),
  resource: RecordPlatformResourceSchema,
  maximum: Schema.Number,
  observed: Schema.Number,
  path: Schema.String,
}) {}

/** Node I/O outside permission failures, with the native cause retained only for diagnostics. */
export class RecordIoError extends Schema.TaggedError<RecordIoError>(
  "@niceeval/record/RecordIoError",
)("RecordIoError", {
  code: Schema.Literal("record-io-error"),
  operation: RecordPlatformOperationSchema,
  path: Schema.String,
  cause: Schema.Defect,
}) {}

/** Permission failures remain distinct so readers can report an actionable error. */
export class RecordPermissionError extends Schema.TaggedError<RecordPermissionError>(
  "@niceeval/record/RecordPermissionError",
)("RecordPermissionError", {
  code: Schema.Literal("record-permission-denied"),
  operation: RecordPlatformOperationSchema,
  path: Schema.String,
  cause: Schema.Defect,
}) {}

/** A migrate lease conflicts with a reader, writer, or clean operation. */
export class RecordMaintenanceBusy extends Schema.TaggedError<RecordMaintenanceBusy>(
  "@niceeval/record/RecordMaintenanceBusy",
)("RecordMaintenanceBusy", {
  code: Schema.Literal("record-maintenance-busy"),
  requested: Schema.Literal("shared", "exclusive"),
}) {}

/** A second cooperative writer or clean operation attempted to own a root. */
export class RecordWriterBusy extends Schema.TaggedError<RecordWriterBusy>(
  "@niceeval/record/RecordWriterBusy",
)("RecordWriterBusy", {
  code: Schema.Literal("record-writer-busy"),
}) {}

/** Git inspection failed for a reason other than an ordinary no-restore-point state. */
export class RecordGitCommandError extends Schema.TaggedError<RecordGitCommandError>(
  "@niceeval/record/RecordGitCommandError",
)("RecordGitCommandError", {
  code: Schema.Literal("record-git-command-failed"),
  operation: Schema.Literal("locate-worktree", "read-head", "inspect-status"),
  cause: Schema.Defect,
}) {}

export type RecordFileSystemError =
  | RecordRootInvalid
  | RecordPathInvalid
  | RecordPathTypeInvalid
  | RecordPathAlreadyExists
  | RecordResourceLimitExceeded
  | RecordIoError
  | RecordPermissionError;

export type RecordMaintenanceLeaseError =
  | RecordFileSystemError
  | RecordMaintenanceBusy;

export type RecordWriterLockError = RecordFileSystemError | RecordWriterBusy;

export type RecordGitError =
  | RecordRootInvalid
  | RecordResourceLimitExceeded
  | RecordGitCommandError;
