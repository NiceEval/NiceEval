import { Schema } from "effect";

/** Bounded operation names are safe to surface in Record diagnostics. */
export const RecordPlatformOperationSchema = Schema.Literals([
  "create-directory",
  "list-directory",
  "read-file",
  "write-file",
  "sync-file",
  "sync-directory",
  "remove-path",
  "release-record-lease",
]);

export type RecordPlatformOperation = Schema.Schema.Type<
  typeof RecordPlatformOperationSchema
>;

export const RecordPathKindSchema = Schema.Literals([
  "missing",
  "file",
  "directory",
  "other",
]);

export type RecordPathKind = Schema.Schema.Type<typeof RecordPathKindSchema>;

export const RecordPlatformResourceSchema = Schema.Literals([
  "directory-entries",
  "file-bytes",
]);

export type RecordPlatformResource = Schema.Schema.Type<
  typeof RecordPlatformResourceSchema
>;

const FiniteNonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter(
    (value) =>
      Number.isFinite(value) && Number.isInteger(value) && value >= 0,
    {
      identifier: "FiniteNonNegativeInteger",
      description: "a finite non-negative integer",
    },
  )),
);

/** A caller supplied an invalid bound before any filesystem work began. */
export class RecordResourceLimitInvalid extends Schema.TaggedError<RecordResourceLimitInvalid>()("RecordResourceLimitInvalid", {
  code: Schema.Literal("record-resource-limit-invalid"),
  resource: RecordPlatformResourceSchema,
  maximum: Schema.Number,
}) {}

/** A forged or malformed host-local root never reaches Node filesystem calls. */
export class RecordRootInvalid extends Schema.TaggedError<RecordRootInvalid>()("RecordRootInvalid", {
  code: Schema.Literal("record-root-invalid"),
}) {}

/** A portable relative location cannot address a host path outside its root. */
export class RecordPathInvalid extends Schema.TaggedError<RecordPathInvalid>()("RecordPathInvalid", {
  code: Schema.Literal("record-path-invalid"),
  reason: Schema.Literals(["segment-invalid", "file-path-empty"]),
  segments: Schema.Array(Schema.String),
}) {}

/** A caller expected a file or directory but durable storage has another shape. */
export class RecordPathTypeInvalid extends Schema.TaggedError<RecordPathTypeInvalid>()("RecordPathTypeInvalid", {
  code: Schema.Literal("record-path-type-invalid"),
  path: Schema.String,
  expected: Schema.Literals(["file", "directory"]),
  actual: RecordPathKindSchema,
}) {}

/** An exclusive create found an existing file or directory. */
export class RecordPathAlreadyExists extends Schema.TaggedError<RecordPathAlreadyExists>()("RecordPathAlreadyExists", {
  code: Schema.Literal("record-path-already-exists"),
  path: Schema.String,
}) {}

/** A bounded platform operation would exceed its declared resource limit. */
export class RecordResourceLimitExceeded extends Schema.TaggedError<RecordResourceLimitExceeded>()("RecordResourceLimitExceeded", {
  code: Schema.Literal("record-resource-limit-exceeded"),
  resource: RecordPlatformResourceSchema,
  maximum: FiniteNonNegativeIntegerSchema,
  /** May be the first value beyond the cap; callers need not scan to an exact total. */
  observedAtLeast: FiniteNonNegativeIntegerSchema,
  path: Schema.String,
}) {}

/** Node I/O outside permission failures, with the native cause retained only for diagnostics. */
export class RecordIoError extends Schema.TaggedError<RecordIoError>()("RecordIoError", {
  code: Schema.Literal("record-io-error"),
  operation: RecordPlatformOperationSchema,
  path: Schema.String,
  cause: Schema.Unknown,
}) {}

/** Permission failures remain distinct so readers can report an actionable error. */
export class RecordPermissionError extends Schema.TaggedError<RecordPermissionError>()("RecordPermissionError", {
  code: Schema.Literal("record-permission-denied"),
  operation: RecordPlatformOperationSchema,
  path: Schema.String,
  cause: Schema.Unknown,
}) {}

/** A migrate lease conflicts with a reader, writer, or clean operation. */
export class RecordMaintenanceBusy extends Schema.TaggedError<RecordMaintenanceBusy>()("RecordMaintenanceBusy", {
  code: Schema.Literal("record-maintenance-busy"),
  requested: Schema.Literals(["shared", "exclusive"]),
}) {}

export type RecordFileSystemError =
  | RecordRootInvalid
  | RecordPathInvalid
  | RecordPathTypeInvalid
  | RecordPathAlreadyExists
  | RecordResourceLimitInvalid
  | RecordResourceLimitExceeded
  | RecordIoError
  | RecordPermissionError;
