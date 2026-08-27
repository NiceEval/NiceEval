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
  Record,
  defineAttemptRecord,
  defineAttemptRecordCollection,
  defineRunRecord,
  recordContributionFromAttachmentPersistence,
} from "./authoring.ts";
export type {
  AttemptRecordAppendCommand,
  AttemptRecordAppendReceipt,
  AttemptRecordCollectionLimitation,
  AttemptRecordCollectionDefinition,
  AttemptRecordDefinition,
  RecordContribution,
  RecordDefinition,
  RecordWriteCommand,
  RunRecordDefinition,
} from "./authoring.ts";
export type { RecordWriteError } from "./writer/types.ts";
export type { RecordAlreadyWritten } from "./writer/errors.ts";

export {
  defineRecordAttachment,
  makeRecordAttachmentCatalog,
  defineRecordAttachmentPersistence,
  defineRecordMigration,
  RecordAttachmentReference,
  recordAttachmentIssue,
  RecordAttachmentSpiDefinitionError,
  RecordTextContentSchema,
  RecordBytesContentSchema,
  recordContent,
  RecordOwner,
} from "./attachment/index.ts";
export type {
  AnyRecordAttachmentPersistence,
  NonEmptyRecordAttachmentIssues,
  RecordAttachmentCatalog,
  RecordAttachmentDefinition,
  RecordAttachmentPersistence,
  RecordMigrationDocument,
  RecordMigrationResult,
  RecordMigrationContent,
  RecordMigrationImpact,
  RecordMigrationBuilder,
  RecordAttachmentIssue,
  RecordAttachmentIssueCode,
  RecordAttachmentMigration,
  RecordAttachmentOwner,
  RecordAttachmentReferenceToken,
  RecordAttachmentSpiFailure,
  RecordContentHandle,
  RecordTextContentHandle,
  RecordBytesContentHandle,
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
