import { Schema } from "effect";

const fields = { operation: Schema.String, path: Schema.optional(Schema.String), message: Schema.String };

export class FeedbackFileMissing extends Schema.TaggedError<FeedbackFileMissing>(
  "@niceeval/repo-tools/FeedbackFileMissing",
)("FeedbackFileMissing", fields) {}

export class FeedbackContentInvalid extends Schema.TaggedError<FeedbackContentInvalid>(
  "@niceeval/repo-tools/FeedbackContentInvalid",
)("FeedbackContentInvalid", fields) {}

export class FeedbackReferenceConflict extends Schema.TaggedError<FeedbackReferenceConflict>(
  "@niceeval/repo-tools/FeedbackReferenceConflict",
)("FeedbackReferenceConflict", fields) {}

export class FeedbackLockConflict extends Schema.TaggedError<FeedbackLockConflict>(
  "@niceeval/repo-tools/FeedbackLockConflict",
)("FeedbackLockConflict", fields) {}

export class FeedbackIoError extends Schema.TaggedError<FeedbackIoError>(
  "@niceeval/repo-tools/FeedbackIoError",
)("FeedbackIoError", fields) {}

export type FeedbackError = FeedbackFileMissing | FeedbackContentInvalid | FeedbackReferenceConflict |
  FeedbackLockConflict | FeedbackIoError;
