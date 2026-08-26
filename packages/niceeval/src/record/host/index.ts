/**
 * Public, supported high-level Host composition boundary for scoped Record
 * I/O. `niceeval/record` re-exports this same Host; durable definitions,
 * fixed-family registration, and migration factories remain package-private.
 */
export { makeRecordHost, recordHost } from "./runtime.ts";
export type {
  AttemptWriteSession,
  RecordAttachmentRead,
  RecordCleanOperationPlan,
  RecordCleanOperationReceipt,
  RecordCompleteView,
  RecordHostSDK,
  RecordMaintenanceOperationFailure,
  RecordMigrateOperationPlan,
  RecordMigrateOperationReceipt,
  RecordMigrateReadyPlan,
  RecordReadSession,
  ReferenceRunWriteSession,
  RunWriteSession,
} from "./types.ts";
