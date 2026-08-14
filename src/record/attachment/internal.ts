/**
 * Storage, reader, migration, and projection integration may import this
 * module. It is deliberately not re-exported by `attachment/index.ts`.
 */
export {
  isRecordBlobRef,
  makeFixedAttachmentWriteSpec,
  makeFixedRecordAttachmentWrite,
  makeFixedRecordAttachmentValue,
  makeRecordBlobRef,
  recordAttachmentWriteContents,
} from "./runtime.ts";

export type {
  FixedMaterializedAttachment,
  RecordAttachmentWriteContents,
} from "./runtime.ts";

export type { RecordAttachmentMaterializedBlob } from "./types.ts";
