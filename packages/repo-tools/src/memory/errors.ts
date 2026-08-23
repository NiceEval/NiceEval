import { Schema } from "effect";

const fields = { operation: Schema.String, path: Schema.optional(Schema.String), message: Schema.String };

export class MemoryFileMissing extends Schema.TaggedError<MemoryFileMissing>(
  "@niceeval/repo-tools/MemoryFileMissing",
)("MemoryFileMissing", fields) {}

export class MemoryContentInvalid extends Schema.TaggedError<MemoryContentInvalid>(
  "@niceeval/repo-tools/MemoryContentInvalid",
)("MemoryContentInvalid", fields) {}

export class MemoryReferenceConflict extends Schema.TaggedError<MemoryReferenceConflict>(
  "@niceeval/repo-tools/MemoryReferenceConflict",
)("MemoryReferenceConflict", fields) {}

export class LegacyMemoryReadOnly extends Schema.TaggedError<LegacyMemoryReadOnly>(
  "@niceeval/repo-tools/LegacyMemoryReadOnly",
)("LegacyMemoryReadOnly", fields) {}

export class MemoryLockConflict extends Schema.TaggedError<MemoryLockConflict>(
  "@niceeval/repo-tools/MemoryLockConflict",
)("MemoryLockConflict", fields) {}

export class MemoryIoError extends Schema.TaggedError<MemoryIoError>(
  "@niceeval/repo-tools/MemoryIoError",
)("MemoryIoError", fields) {}

export type MemoryError = MemoryFileMissing | MemoryContentInvalid | MemoryReferenceConflict |
  LegacyMemoryReadOnly | MemoryLockConflict | MemoryIoError;
