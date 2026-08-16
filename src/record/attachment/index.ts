export {
  makeFixedRecordAttachmentWrite,
  makeRecordBlobSource,
  validateRecordAttachmentWrite,
} from "./runtime.ts";

export type {
  RecordAttachmentBlobBuild,
  RecordAttachmentBlobBuilder,
  RecordAttachmentBlobDraft,
  RecordAttachmentBlobs,
  RecordAttachmentJson,
  RecordAttachmentPayloadSnapshot,
  RecordAttachmentWrite,
  FixedAttachmentWriteSpec,
  RecordBlobDrafts,
  RecordBlobErrors,
  RecordBlobHandleInvalid,
  RecordBlobRef,
  RecordBlobRequirements,
  RecordBlobSource,
} from "./types.ts";

export type {
  NonEmptyRecordAttachmentIssues,
  RecordAttachmentClosureInvalid,
  RecordAttachmentIssue,
  RecordAttachmentIssueCode,
  RecordAttachmentPayloadInvalid,
} from "./errors.ts";
