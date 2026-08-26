/**
 * Public, supported Host composition boundary for named dispatch claims and
 * scoped Record leases. It is not a generic lock API or a Record writer.
 */
export { coordinationHost } from "./runtime.ts";
export type {
  ClaimExecutionRequest,
  CoordinationHostSDK,
  ExecutionClaim,
} from "./types.ts";
export type {
  RecordCoordinationCanceled,
  RecordCoordinationDeadlineInvalid,
  RecordCoordinationError,
  RecordCoordinationStateInvalid,
  RecordCoordinationTimedOut,
  RecordCoordinationWaitRequest,
  RecordSnapshotBarrier,
  RecordWriteBatchAdmission,
} from "../record-leases.ts";
