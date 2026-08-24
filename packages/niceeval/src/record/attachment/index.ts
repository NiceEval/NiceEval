export {
  isRecordAttachmentCatalog,
  makeRecordAttachmentCatalog,
} from "./catalog.ts";
export type {
  AnyRecordAttachmentPersistence,
  RecordAttachmentCatalog,
} from "./catalog.ts";

export {
  RecordBytesContentSchema,
  RecordTextContentSchema,
  recordContent,
} from "./content.ts";
export type {
  RecordBytesContentHandle,
  RecordContentHandle,
  RecordTextContentHandle,
} from "./content.ts";

export {
  defineRecordAttachment,
  isRecordAttachmentDefinition,
} from "./definition.ts";
export type { RecordAttachmentDefinition } from "./definition.ts";

export {
  defineRecordAttachmentPersistence,
  isRecordAttachmentPersistence,
} from "./persistence.ts";
export type { RecordAttachmentPersistence } from "./persistence.ts";

export {
  defineRecordMigration,
  RecordMigrationContent,
} from "./migration.ts";
export type {
  RecordAttachmentMigration,
  RecordMigrationBuilder,
  RecordMigrationDocument,
  RecordMigrationImpact,
  RecordMigrationResult,
} from "./migration.ts";

export { RecordAttachmentReference } from "./reference.ts";
export type { RecordAttachmentReferenceToken } from "./reference.ts";

export { RecordOwner } from "./owner.ts";
export type { RecordAttachmentOwner } from "./owner.ts";

export {
  RecordAttachmentSpiDefinitionError,
  recordAttachmentIssue,
} from "./errors.ts";
export type {
  NonEmptyRecordAttachmentIssues,
  RecordAttachmentClosureInvalid,
  RecordAttachmentIssue,
  RecordAttachmentIssueCode,
  RecordAttachmentPayloadInvalid,
  RecordAttachmentSpiFailure,
} from "./errors.ts";
