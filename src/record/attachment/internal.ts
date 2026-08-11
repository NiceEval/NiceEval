/**
 * Storage, reader, migration, and projection integration may import this
 * module. It is deliberately not re-exported by `attachment/index.ts`.
 */
export {
  defineBuiltinJsonRecordAttachment,
  defineRecordAttachmentRegistry,
  isJsonRecordAttachmentDefinition,
  isRecordAttachmentFamily,
  isRecordAttachmentRegistry,
  isRecordAttachmentValue,
  makeRecordAttachmentValue,
  makeRecordBlobRef,
  recordAttachmentFamilyCurrentDefinition,
  recordAttachmentFamilyOwner,
  recordAttachmentRegistryFamily,
  recordAttachmentValueDefinition,
  recordAttachmentWriteContents,
  resolveRecordAttachmentMigration,
  runRecordAttachmentMigration,
} from "./runtime.ts";

export type {
  RecordAttachmentMaterializedBlob,
  RecordAttachmentWriteContents,
} from "./runtime.ts";
