/** Public Effect-native Record and generic Attachment composition surface. */
export { makeRecordHost, recordHost } from "./host/index.ts";
export type {
  AttemptWriteSession,
  RecordAttachmentRead,
  RecordCompleteView,
  RecordHostSDK,
  RecordReadSession,
  ReferenceRunWriteSession,
  RunWriteSession,
} from "./host/index.ts";

export {
  defineRecordAttachment,
  makeRecordAttachmentBlobDrafts,
  makeRecordAttachmentCatalog,
  recordAttachmentIssue,
  recordAttachmentMigration,
  recordAttachmentVersion,
  RecordAttachmentSpiDefinitionError,
  RecordContent,
  RecordContentHandleSchema,
  RecordOwner,
} from "./attachment/index.ts";
export type {
  AnyRecordAttachmentFamilyDefinition,
  AnyRecordAttachmentMigration,
  AnyRecordAttachmentVersion,
  NonEmptyRecordAttachmentIssues,
  RecordAttachmentBlobBuilder,
  RecordAttachmentBlobDraft,
  RecordAttachmentCatalog,
  RecordAttachmentContentDescriptor,
  RecordAttachmentDefinition,
  RecordAttachmentFamilyDefinition,
  RecordAttachmentInvariants,
  RecordAttachmentIssue,
  RecordAttachmentIssueCode,
  RecordAttachmentMigration,
  RecordAttachmentMigrationInput,
  RecordAttachmentMigrationOutput,
  RecordAttachmentOwner,
  RecordAttachmentReferenceDescriptor,
  RecordAttachmentReferencesDescriptor,
  RecordAttachmentSpiFailure,
  RecordAttachmentVersion,
  RecordAttachmentVersionValue,
  RecordContentHandle,
  RecordContentSource,
} from "./attachment/index.ts";

export {
  cleanIncompleteRuns,
  incompleteRunWarnings,
  inspectIncompleteRuns,
  inspectIncompleteRunWarnings,
} from "./maintenance/index.ts";
export type {
  RecordCleanReceipt,
  RecordIncompleteRun,
} from "./maintenance/index.ts";

export { RunIdSchema } from "./codec/identifiers.ts";
export type { AttemptId } from "./model/identifiers.ts";

export { NodeRecordLive } from "./platform/node.ts";
export { makeRecordRoot } from "./platform/root.ts";
export type {
  RecordRoot,
  RecordRootConstructionError,
  RecordRootInput,
} from "./platform/root.ts";
