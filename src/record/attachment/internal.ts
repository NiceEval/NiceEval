/**
 * Storage, reader, migration, and projection integration may import this
 * module. It is deliberately not re-exported by `attachment/index.ts`.
 */
export {
  defineBuiltinJsonRecordAttachment,
  isRecordAttachmentValue,
  makeRecordAttachmentValue,
  makeRecordBlobRef,
  recordAttachmentValueDefinition,
  recordAttachmentWriteContents,
} from "./runtime.ts";

export type {
  RecordAttachmentMaterializedBlob,
  RecordAttachmentWriteContents,
} from "./runtime.ts";
