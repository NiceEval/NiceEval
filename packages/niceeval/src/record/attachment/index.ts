export {
  makeRecordAttachmentBlobDrafts,
  makeFixedRecordAttachmentWrite,
  makeRecordBlobSource,
  validateRecordAttachmentWrite,
  validateRecordAttachmentWriteOwner,
} from "./runtime.ts";

export {
  defineRecordAttachment,
  isRecordAttachmentFamilyDefinition,
  validateRecordAttachmentDefinitionOwner,
} from "./family.ts";

export {
  RecordContentHandleSchema,
  isRecordAttachmentVersion,
  recordAttachmentVersion,
} from "./version.ts";

export {
  isRecordAttachmentMigration,
  recordAttachmentMigration,
  runRecordAttachmentMigration,
} from "./migration.ts";

export {
  isRecordAttachmentCatalog,
  makeRecordAttachmentCatalog,
} from "./catalog.ts";

export { RecordContent } from "./content.ts";
export { RecordOwner } from "./owner.ts";

export {
  RecordAttachmentSpiDefinitionError,
  recordAttachmentIssue,
} from "./errors.ts";

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
  AnyRecordAttachmentFamilyDefinition,
  RecordAttachmentFamilyDefinition,
  RecordAttachmentFamilyDefinition as RecordAttachmentDefinition,
} from "./family.ts";

export type {
  AnyRecordAttachmentVersion,
  RecordAttachmentContentDescriptor,
  RecordAttachmentInvariants,
  RecordAttachmentReferenceDescriptor,
  RecordAttachmentReferencesDescriptor,
  RecordAttachmentVersion,
  RecordAttachmentVersionValue,
  RecordContentHandle,
  RecordContentSourceDraft,
  RecordContentSourceDrafts,
} from "./version.ts";

export type {
  AnyRecordAttachmentMigration,
  RecordAttachmentMigration,
  RecordAttachmentMigrationInput,
  RecordAttachmentMigrationOutput,
} from "./migration.ts";

export type { RecordAttachmentCatalog } from "./catalog.ts";
export type { RecordContentSource } from "./content.ts";
export type { RecordAttachmentOwner } from "./owner.ts";

export type {
  NonEmptyRecordAttachmentIssues,
  RecordAttachmentClosureInvalid,
  RecordAttachmentIssue,
  RecordAttachmentIssueCode,
  RecordAttachmentPayloadInvalid,
  RecordAttachmentSpiFailure,
} from "./errors.ts";
