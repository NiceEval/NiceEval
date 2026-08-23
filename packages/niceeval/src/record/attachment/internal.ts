/**
 * Storage, reader, migration, and projection integration may import this
 * module. It is deliberately not re-exported by `attachment/index.ts`.
 */
export {
  isRecordBlobRef,
  makeFixedRecordAttachmentWrite,
  makeFixedRecordAttachmentWriteFromDrafts,
  makeRecordAttachmentBlobDrafts,
  makeRecordAttachmentWriteSpec,
  makeFixedRecordAttachmentValueFromDecoded,
  makeRecordBlobRef,
  recordAttachmentWriteContents,
  validateRecordAttachmentWriteOwner,
} from "./runtime.ts";

export {
  getRecordAttachmentFixedWriteSpec,
  getRecordAttachmentVersionWriteSpec,
} from "./family.ts";
export { withRecordAttachmentMaterializedRefine } from "./compatibility.ts";

export type {
  FixedMaterializedAttachment,
  RecordAttachmentWriteContents,
} from "./runtime.ts";

export type { RecordAttachmentMaterializedBlob } from "./types.ts";
