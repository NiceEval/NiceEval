/**
 * Public, supported high-level Host composition boundary for scoped Record
 * I/O. `niceeval/record` re-exports this same Host; durable definitions,
 * and fixed-family registration remain package-private.
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
  RecordReadSession,
  ReferenceRunWriteSession,
  RunWriteSession,
} from "./types.ts";
